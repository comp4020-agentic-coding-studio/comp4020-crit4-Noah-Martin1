// The instrument's voice. Everything you hear is synthesised here — there are
// no audio files in this repo — so the browser really is the instrument rather
// than a player for one.
//
// Two rules hold the sound design together:
//   1. Every pitch comes from one minor pentatonic scale, so no combination of
//      orbs can clash. There is no wrong note to hit.
//   2. Size decides pitch. Big orbs speak low and slow, small ones high and
//      short, which is what makes the picture and the sound feel like one
//      thing.

const PENTATONIC_STEPS = [0, 3, 5, 7, 10];
const ROOT_HZ = 55; // A1

/** A minor pentatonic ladder, low to high. */
function buildScale(octaves: number): number[] {
  const scale: number[] = [];
  for (let octave = 0; octave < octaves; octave++) {
    for (const step of PENTATONIC_STEPS) {
      scale.push(ROOT_HZ * 2 ** (octave + step / 12));
    }
  }
  return scale;
}

// Four octaves, not six: the top of a six-octave ladder is up near 3.5kHz,
// which is where small orbs were screaming. The whole instrument now lives
// between A1 and roughly G5, and absorption sits low in that.
const SCALE = buildScale(4);

/**
 * Radius to pitch, logarithmically: doubling an orb's size drops it by a
 * consistent musical interval rather than a consistent number of hertz.
 * Largest orb → lowest note.
 */
export function pitchForRadius(radius: number, minRadius: number, maxRadius: number): number {
  const span = Math.log(maxRadius) - Math.log(minRadius);
  const t = (Math.log(Math.max(radius, minRadius)) - Math.log(minRadius)) / span;
  const clamped = Math.min(1, Math.max(0, t));
  const index = Math.round((1 - clamped) * (SCALE.length - 1));
  return SCALE[index];
}

// --- the graph ---------------------------------------------------------------
// Nothing here is constructed until the player's first gesture. The autoplay
// policy would leave a context suspended anyway, but not building one at all
// means the page is provably silent until it is played.

/** A note that keeps sounding until released, and can be re-pitched while it does. */
export type HeldVoice = {
  /** Glide to a new pitch. */
  follow: (hz: number) => void;
  release: () => void;
};

let ac: AudioContext | null = null;
let voiceBus: GainNode | null = null;
let masterGain: GainNode | null = null;
let padGain: GainNode | null = null;
let noise: AudioBuffer | null = null;
let activeVoices = 0;

/** Output level when unmuted. */
const OUTPUT = 1.35;

/** Above this many simultaneous notes the mix turns to mud, so new ones are
 *  dropped rather than allowed to smear everything already ringing. */
const MAX_VOICES = 32;

function impulseResponse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

function build(): AudioContext {
  if (ac) return ac;

  const context = new AudioContext();
  ac = context;

  // A compressor before the output keeps a busy screen — a dozen orbs all
  // colliding at once — from clipping, without having to make single notes
  // timid.
  const compressor = new DynamicsCompressorNode(context, {
    threshold: -22,
    knee: 14,
    ratio: 3,
    attack: 0.006,
    release: 0.25,
  });
  masterGain = new GainNode(context, { gain: OUTPUT });
  compressor.connect(masterGain).connect(context.destination);

  // A short noise buffer, reused by every impact. Two saws alone give a note
  // but no *contact*; a few milliseconds of filtered noise on the attack is
  // what makes two orbs sound like they touched.
  const length = Math.floor(context.sampleRate * 0.4);
  noise = context.createBuffer(1, length, context.sampleRate);
  const grain = noise.getChannelData(0);
  for (let i = 0; i < length; i++) grain[i] = Math.random() * 2 - 1;

  const reverb = new ConvolverNode(context, { buffer: impulseResponse(context, 4.5, 2.4) });
  const wet = new GainNode(context, { gain: 0.42 });
  reverb.connect(wet).connect(compressor);

  voiceBus = new GainNode(context, { gain: 1 });
  voiceBus.connect(compressor);
  voiceBus.connect(reverb);

  padGain = new GainNode(context, { gain: 0 });
  padGain.connect(compressor);
  padGain.connect(reverb);

  startPad(context, padGain);
  return context;
}

/** Resume on a user gesture. Safe to call on every gesture. */
export function wake(): void {
  const context = build();
  if (context.state !== "running") void context.resume();
  // The pad fades in rather than snapping on, so the first click doesn't
  // arrive with a wall of sound behind it.
  padGain?.gain.setTargetAtTime(1, context.currentTime, 2.5);
}

export function isAwake(): boolean {
  return ac !== null;
}

// --- harmony -----------------------------------------------------------------
// The scale alone was not enough. Any two notes of a pentatonic sound fine
// together, but a field of orbs picking freely from four octaves of it never
// forms a *chord* — it just sounds like a scale being sprayed, which is why the
// only harmony you could hear was the pad droning underneath.
//
// So there is now one shared harmony at any moment, and everything obeys it:
// the pad plays it, and every orb note is snapped to the nearest member of it.
// Two orbs sounding at once are then always an interval of the same chord, and
// when the chord turns, the whole field turns with it.

/** Chords as semitone classes above the root. All drawn from the scale, so the
 *  progression can never fight the orbs. */
const PROGRESSION: number[][] = [
  [0, 3, 7], // A  C  E   — Am
  [3, 7, 10], // C  E  G   — C
  [5, 0, 3], // D  A  C   — Dm7
  [10, 5, 0], // G  D  A   — G
];

/** Which octave each pad voice sits in, low to high. */
const PAD_OCTAVES = [1, 2, 2, 3];

const CHORD_SECONDS = 19;
const GLIDE_SECONDS = 8;

let chordIndex = 0;

/**
 * The nearest note of the current chord, keeping the pitch roughly where it
 * was. Octaves are free — a pitch class is a pitch class — so an orb keeps its
 * register and only its note moves.
 */
export function snapToChord(hz: number): number {
  const semitones = Math.log2(hz / ROOT_HZ) * 12;
  let best = hz;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pitchClass of PROGRESSION[chordIndex]) {
    const octave = Math.round((semitones - pitchClass) / 12);
    const candidate = pitchClass + octave * 12;
    const distance = Math.abs(candidate - semitones);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ROOT_HZ * 2 ** (candidate / 12);
    }
  }
  return best;
}

function padFrequency(voice: number, chord: number[]): number {
  const pitchClass = chord[voice % chord.length];
  return ROOT_HZ * 2 ** (PAD_OCTAVES[voice] + pitchClass / 12);
}

function startPad(context: AudioContext, out: GainNode): void {
  // Quieter than it was: the harmony is now carried by the orbs themselves, and
  // the pad is only the room they are in.
  const level = new GainNode(context, { gain: 0.075 });
  const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: 900, Q: 0.8 });
  level.connect(filter).connect(out);

  // A very slow sweep keeps the pad from sitting still, which is the difference
  // between "atmosphere" and "a held chord".
  const sweep = new OscillatorNode(context, { type: "sine", frequency: 0.021 });
  const sweepDepth = new GainNode(context, { gain: 380 });
  sweep.connect(sweepDepth).connect(filter.frequency);
  sweep.start();

  const voices = PAD_OCTAVES.map((_, i) => {
    const hz = padFrequency(i, PROGRESSION[0]);
    // Triangle plus a detuned sine an octave down: warm, and thick enough to
    // sit under the saw-based orb voices without competing with them.
    const osc = new OscillatorNode(context, { type: "triangle", frequency: hz });
    const sub = new OscillatorNode(context, { type: "sine", frequency: hz / 2, detune: 4 });
    const subLevel = new GainNode(context, { gain: 0.45 });
    const pan = new StereoPannerNode(context, { pan: (i / (PAD_OCTAVES.length - 1)) * 1.2 - 0.6 });
    const voiceLevel = new GainNode(context, { gain: 0.25 });

    osc.connect(voiceLevel);
    sub.connect(subLevel).connect(voiceLevel);
    voiceLevel.connect(pan).connect(level);
    osc.start();
    sub.start();
    return { osc, sub };
  });

  const step = (): void => {
    chordIndex = (chordIndex + 1) % PROGRESSION.length;
    const chord = PROGRESSION[chordIndex];
    const now = context.currentTime;
    voices.forEach(({ osc, sub }, i) => {
      // Gliding rather than re-triggering makes the change feel like weather
      // instead of a new bar.
      const hz = padFrequency(i, chord);
      osc.frequency.exponentialRampToValueAtTime(hz, now + GLIDE_SECONDS);
      sub.frequency.exponentialRampToValueAtTime(hz / 2, now + GLIDE_SECONDS);
    });
    window.setTimeout(step, CHORD_SECONDS * 1000);
  };
  window.setTimeout(step, CHORD_SECONDS * 1000);
}

// --- the sustained voices ----------------------------------------------------
// Each of the largest orbs on screen holds a quiet continuous note for as long
// as it is there. This is the layer that was missing: the orbs *are* the chord,
// so the field has a harmony of its own that swells and re-voices as orbs grow,
// arrive and are eaten — with the rhythmic pulses landing on top of it as
// accents rather than being the only thing you hear.

export type Drone = {
  /** Glide toward a pitch, level and stereo position. */
  set: (hz: number, level: number, pan: number) => void;
  release: () => void;
};

export function makeDrone(): Drone | null {
  const context = build();
  if (!voiceBus) return null;
  const now = context.currentTime;

  const out = new GainNode(context, { gain: 0 });
  const panner = new StereoPannerNode(context, { pan: 0 });
  const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: 700, Q: 1.4 });
  const sawA = new OscillatorNode(context, { type: "sawtooth", frequency: 110, detune: -6 });
  const sawB = new OscillatorNode(context, { type: "sawtooth", frequency: 110, detune: 7 });
  const sub = new OscillatorNode(context, { type: "sine", frequency: 55 });
  const subLevel = new GainNode(context, { gain: 0.6 });
  const sawLevel = new GainNode(context, { gain: 0.4 });

  sawA.connect(sawLevel);
  sawB.connect(sawLevel);
  sawLevel.connect(filter);
  sub.connect(subLevel).connect(filter);
  filter.connect(out).connect(panner).connect(voiceBus);
  for (const node of [sawA, sawB, sub]) node.start(now);

  let released = false;

  return {
    set(hz, level, pan) {
      if (released) return;
      const at = context.currentTime;
      const safe = Math.max(20, hz);
      // Long time constants throughout: a drone that snapped to each new pitch
      // would click, and these are meant to swell.
      sawA.frequency.setTargetAtTime(safe, at, 0.7);
      sawB.frequency.setTargetAtTime(safe, at, 0.7);
      sub.frequency.setTargetAtTime(safe / 2, at, 0.7);
      filter.frequency.setTargetAtTime(safe * 4 + 260, at, 0.7);
      out.gain.setTargetAtTime(level, at, 0.45);
      panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), at, 0.3);
    },
    release() {
      if (released) return;
      released = true;
      const at = context.currentTime;
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.linearRampToValueAtTime(0, at + 1.4);
      for (const node of [sawA, sawB, sub]) node.stop(at + 1.5);
    },
  };
}

// --- the orb voice -----------------------------------------------------------

export type ToneOptions = {
  /** Seconds until silence. */
  duration?: number;
  /** Peak level, before the compressor. */
  level?: number;
  /** 0 = dark and muffled, 1 = open and present. */
  brightness?: number;
  /** -1 left, 1 right. */
  pan?: number;
  /** 0 = pure tone, 1 = a full noise transient on the attack. */
  noise?: number;
};

/**
 * The sound of an orb: two saws a few cents apart plus a sine sub, behind a
 * lowpass that closes as the note decays. The detuning is the whole reason it
 * reads as an instrument rather than a test tone.
 */
export function playTone(frequency: number, options: ToneOptions = {}): void {
  const context = build();
  if (!voiceBus || activeVoices >= MAX_VOICES) return;

  const { duration = 1, level = 0.08, brightness = 0.5, pan = 0, noise: grit = 0 } = options;
  const now = context.currentTime;

  const out = new GainNode(context, { gain: 0 });
  const panner = new StereoPannerNode(context, { pan: Math.max(-1, Math.min(1, pan)) });

  // The filter opens on the attack and closes over the decay, so a note has a
  // shape — a "ping" that settles — instead of a flat sustain.
  const open = frequency * (3 + brightness * 9) + 220;
  const filter = new BiquadFilterNode(context, { type: "lowpass", frequency: open, Q: 3.5 });
  filter.frequency.setValueAtTime(open, now);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(140, frequency * 1.6),
    now + duration * 0.85,
  );

  const sawA = new OscillatorNode(context, { type: "sawtooth", frequency, detune: -7 });
  const sawB = new OscillatorNode(context, { type: "sawtooth", frequency, detune: +8 });
  const sub = new OscillatorNode(context, { type: "sine", frequency: frequency / 2 });
  const subLevel = new GainNode(context, { gain: 0.55 });
  const sawLevel = new GainNode(context, { gain: 0.5 });

  sawA.connect(sawLevel);
  sawB.connect(sawLevel);
  sawLevel.connect(filter);
  sub.connect(subLevel).connect(filter);
  filter.connect(out).connect(panner).connect(voiceBus);

  const attack = 0.006 + (1 - brightness) * 0.05;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(level, now + attack);
  out.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  // The contact transient: a band of noise around the note's own pitch, gone
  // in a few dozen milliseconds. It reads as the surfaces meeting rather than
  // as a separate sound.
  if (grit > 0.01 && noise) {
    const burst = new AudioBufferSourceNode(context, { buffer: noise });
    const band = new BiquadFilterNode(context, {
      type: "bandpass",
      frequency: Math.min(6000, frequency * 3.2),
      Q: 1.1,
    });
    const shape = new GainNode(context, { gain: 0 });
    const tail = 0.05 + grit * 0.16;
    shape.gain.setValueAtTime(0, now);
    shape.gain.linearRampToValueAtTime(level * grit * 1.5, now + 0.004);
    shape.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    burst.connect(band).connect(shape).connect(panner);
    burst.start(now);
    burst.stop(now + tail + 0.02);
  }

  activeVoices++;
  for (const node of [sawA, sawB, sub]) {
    node.start(now);
    node.stop(now + duration + 0.05);
  }
  sawA.onended = () => {
    activeVoices--;
  };
}

/**
 * A held voice whose pitch can be moved — used while the player holds to grow
 * a new orb, so growing it is something you hear as well as see.
 */
export function holdTone(frequency: number, level = 0.055): HeldVoice | null {
  const context = build();
  if (!voiceBus) return null;
  const now = context.currentTime;

  const out = new GainNode(context, { gain: 0 });
  const filter = new BiquadFilterNode(context, {
    type: "lowpass",
    frequency: frequency * 6 + 300,
    Q: 2,
  });
  const sawA = new OscillatorNode(context, { type: "sawtooth", frequency, detune: -7 });
  const sawB = new OscillatorNode(context, { type: "sawtooth", frequency, detune: +8 });
  const sub = new OscillatorNode(context, { type: "sine", frequency: frequency / 2 });
  const subLevel = new GainNode(context, { gain: 0.5 });
  const sawLevel = new GainNode(context, { gain: 0.45 });

  sawA.connect(sawLevel);
  sawB.connect(sawLevel);
  sawLevel.connect(filter);
  sub.connect(subLevel).connect(filter);
  filter.connect(out).connect(voiceBus);

  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(level, now + 0.08);
  for (const node of [sawA, sawB, sub]) node.start(now);

  return {
    follow(hz: number) {
      // Gliding, not stepping: the pitch slides down as the orb grows, which
      // is the feedback that makes holding feel like shaping something.
      const safe = Math.max(20, hz);
      const at = context.currentTime;
      sawA.frequency.setTargetAtTime(safe, at, 0.05);
      sawB.frequency.setTargetAtTime(safe, at, 0.05);
      sub.frequency.setTargetAtTime(safe / 2, at, 0.05);
      filter.frequency.setTargetAtTime(safe * 6 + 300, at, 0.08);
    },
    release() {
      const at = context.currentTime;
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      for (const node of [sawA, sawB, sub]) node.stop(at + 0.45);
    },
  };
}

export function now(): number {
  return ac ? ac.currentTime : 0;
}

// --- output control ----------------------------------------------------------

let muted = false;

export function toggleMuted(): boolean {
  muted = !muted;
  const context = build();
  masterGain?.gain.setTargetAtTime(muted ? 0 : OUTPUT, context.currentTime, 0.05);
  return muted;
}

export function isMuted(): boolean {
  return muted;
}
