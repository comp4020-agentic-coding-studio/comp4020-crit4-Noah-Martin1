// Karplus–Strong: the cheapest piece of physical modelling there is, and it
// sounds like a plucked string because it *is* one, structurally.
//
// Fill a delay line as long as one period of the note with noise — that is the
// pluck, a chaotic displacement of the whole string. Then walk the line round
// and round, and each time a sample comes out, replace it with the average of
// it and its neighbour. That average is a lowpass filter, so every trip round
// the loop loses a little more of the high end: the noise decays into a pitched
// tone, brightness first, exactly as a real string does.
//
// It is rendered into an AudioBuffer here rather than built out of Web Audio
// nodes on purpose. A feedback loop of DelayNodes cannot be shorter than one
// render quantum — 128 samples, about 375 Hz — which would put a ceiling right
// in the middle of the instrument's range. Rendering the samples ourselves has
// no such limit, and it means pitch can be bent afterwards with playbackRate.

/** How the string was struck. */
export type Pluck = {
  /** 0 = struck softly with a thumb, 1 = hard with a nail. */
  hardness: number;
  /** 0 = plucked at the middle (hollow), 1 = near the bridge (nasal). */
  position: number;
  /** Seconds of audible ring. */
  duration: number;
};

const DEFAULT: Pluck = { hardness: 0.6, position: 0.35, duration: 4.2 };

/**
 * One pluck, rendered at `frequency`.
 *
 * Buffers are cached and re-pitched by the caller with `playbackRate`, so this
 * runs a handful of times per session rather than once per note.
 */
export function renderPluck(
  context: BaseAudioContext,
  frequency: number,
  options: Partial<Pluck> = {},
): AudioBuffer {
  const { hardness, position, duration } = { ...DEFAULT, ...options };
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const buffer = context.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);

  // The delay line is one period long. Fractional periods are ignored: the
  // caller tunes precisely with playbackRate.
  const period = Math.max(2, Math.round(rate / frequency));
  const line = new Float32Array(period);

  // --- the excitation --------------------------------------------------------
  // A hard pluck is close to raw noise; a soft one has had the top taken off
  // it. A one-pole lowpass over the noise is the whole difference between a
  // nail and a thumb.
  const smoothing = 1 - hardness * 0.92;
  let previous = 0;
  for (let i = 0; i < period; i++) {
    const white = Math.random() * 2 - 1;
    previous += (white - previous) * (1 - smoothing);
    line[i] = previous;
  }

  // Plucking away from the middle suppresses the harmonics that have a node
  // where you plucked. Subtracting a delayed copy of the excitation is exactly
  // that comb filter, and it is what makes bridge-plucks sound nasal.
  const comb = Math.max(1, Math.round(period * (0.5 - position * 0.42)));
  const combed = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    combed[i] = line[i] - line[(i + comb) % period] * 0.7;
  }
  line.set(combed);

  // Normalise, so hardness changes timbre rather than volume.
  let peak = 0;
  for (let i = 0; i < period; i++) peak = Math.max(peak, Math.abs(line[i]));
  if (peak > 0) for (let i = 0; i < period; i++) line[i] /= peak;

  // --- the loop --------------------------------------------------------------
  // Damping is per trip round the line, so a fixed value would make low notes
  // (few trips per second) ring for minutes and high notes die instantly.
  // Deriving it from the number of trips the note will make keeps the decay
  // time roughly even across the range, the way a real instrument's does.
  const trips = duration * (rate / period);
  const damping = Math.exp(Math.log(0.0006) / trips);
  // A touch of stretch: mixing in a little more of the neighbour makes the
  // lowpass in the loop gentler, which lengthens the sustain of the harmonics.
  const stretch = 0.5 - hardness * 0.06;

  let index = 0;
  for (let i = 0; i < length; i++) {
    const current = line[index];
    const next = line[(index + 1) % period];
    out[i] = current;
    line[index] = (current * stretch + next * (1 - stretch)) * damping;
    index = (index + 1) % period;
  }

  // A short fade in and a long fade out: the fade-in hides the click of
  // starting mid-noise, the fade-out guarantees silence at the end of the
  // buffer however the damping worked out.
  const fadeIn = Math.min(64, length);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  const fadeOut = Math.min(Math.floor(rate * 0.35), length);
  for (let i = 0; i < fadeOut; i++) {
    const at = length - fadeOut + i;
    out[at] *= 1 - i / fadeOut;
  }

  return buffer;
}

// --- the cache ---------------------------------------------------------------
// Rendering four seconds of audio takes a millisecond or so, which is fine
// occasionally and not fine on every pluck of a fast strum. One buffer is
// rendered per (pitch bucket, hardness bucket) and everything else is reached
// by re-pitching it.

/** Semitones between cached buffers. Re-pitching further than this starts to
 *  audibly stretch the decay, so it is kept small. */
const BUCKET_SEMITONES = 3;
const REFERENCE_HZ = 55; // A1

const cache = new Map<string, { buffer: AudioBuffer; frequency: number }>();

/**
 * A buffer for this note, plus the `playbackRate` needed to bring it exactly to
 * pitch. Re-pitching also shortens or lengthens the decay slightly, which is
 * what a real string does when you bend it, so it works in our favour.
 */
export function pluckBuffer(
  context: BaseAudioContext,
  frequency: number,
  hardness: number,
): { buffer: AudioBuffer; playbackRate: number } {
  const semitones = Math.log2(frequency / REFERENCE_HZ) * 12;
  const bucket = Math.round(semitones / BUCKET_SEMITONES);
  const hardBucket = Math.round(Math.min(1, Math.max(0, hardness)) * 4);
  const key = `${bucket}:${hardBucket}`;

  let entry = cache.get(key);
  if (!entry) {
    const bucketHz = REFERENCE_HZ * 2 ** ((bucket * BUCKET_SEMITONES) / 12);
    // Low notes need a longer buffer to ring believably; high ones do not.
    const duration = 2.6 + Math.min(3.4, 180 / bucketHz);
    entry = {
      buffer: renderPluck(context, bucketHz, {
        hardness: hardBucket / 4,
        position: 0.3 + (hardBucket / 4) * 0.25,
        duration,
      }),
      frequency: bucketHz,
    };
    cache.set(key, entry);
  }

  return { buffer: entry.buffer, playbackRate: frequency / entry.frequency };
}
