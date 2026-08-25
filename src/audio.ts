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

import { pluckBuffer } from "./karplus.ts";

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
let masterGain: GainNode | null = null;
let padGain: GainNode | null = null;
let noise: AudioBuffer | null = null;
let dryBus: GainNode | null = null;
let roomIn: ConvolverNode | null = null;
let hallIn: ConvolverNode | null = null;
let activeVoices = 0;

/** Output level when unmuted. */
const OUTPUT = 1.35;

/** Above this many simultaneous notes the mix turns to mud, so new ones are
 *  dropped rather than allowed to smear everything already ringing. */
const MAX_VOICES = 32;

type Space = {
  seconds: number;
  /** How fast the tail dies. Higher is shorter. */
  decay: number;
  /** Silence before the first reflection. This is what tells the ear how big
   *  the room is, and leaving it out is why most synthetic reverb sounds like a
   *  wash rather than a space. */
  preDelay: number;
  /** How much faster the highs die than the lows, 0..1. Real rooms lose treble
   *  first — soft surfaces absorb it — so a tail that keeps its brightness all
   *  the way out sounds synthetic however long it is. */
  damping: number;
};

function impulseResponse(context: AudioContext, space: Space): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.floor(rate * (space.preDelay + space.seconds));
  const buffer = context.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * space.preDelay);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);

    // A handful of discrete early reflections — the walls, before the room
    // blurs into a tail. Slightly different per channel, which is most of what
    // makes the result feel wide.
    const reflections = 7;
    for (let r = 0; r < reflections; r++) {
      const at = preDelay + Math.floor(rate * (0.004 + Math.random() * 0.05));
      if (at < length) data[at] += (Math.random() * 2 - 1) * (0.7 - r * 0.08);
    }

    // The diffuse tail: noise, shaped by the decay envelope, and progressively
    // lowpassed as it goes so the ending is darker than the beginning.
    let previous = 0;
    for (let i = preDelay; i < length; i++) {
      const along = (i - preDelay) / (length - preDelay);
      const alpha = Math.max(0.06, 1 - space.damping * along);
      previous += ((Math.random() * 2 - 1) - previous) * alpha;
      data[i] += previous * (1 - along) ** space.decay;
    }
  }
  return buffer;
}

// Two rooms, and every instrument decides how much of each it wants. A marimba
// in a four-second hall is a marimba in the wrong building; bells in a dry room
// are a wasted bell.
const ROOM: Space = { seconds: 0.9, decay: 2.4, preDelay: 0.007, damping: 0.62 };
const HALL: Space = { seconds: 4.6, decay: 2.1, preDelay: 0.034, damping: 0.88 };

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

  dryBus = new GainNode(context, { gain: 1 });
  dryBus.connect(compressor);

  roomIn = new ConvolverNode(context, { buffer: impulseResponse(context, ROOM) });
  const roomLevel = new GainNode(context, { gain: 0.5 });
  roomIn.connect(roomLevel).connect(compressor);

  hallIn = new ConvolverNode(context, { buffer: impulseResponse(context, HALL) });
  const hallLevel = new GainNode(context, { gain: 0.44 });
  hallIn.connect(hallLevel).connect(compressor);

  padGain = new GainNode(context, { gain: 0 });
  padGain.connect(channelNode("pad"));

  startPad(context, padGain);
  return context;
}

/**
 * The ambient pad. Off for the instrument kit — a harp wants a room, not a
 * drone sitting under every note — and left on for the archived orb garden,
 * which was built around it.
 */
let padEnabled = true;

export function setPadEnabled(on: boolean): void {
  padEnabled = on;
  if (ac && padGain) padGain.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 1.2);
}

// --- channels ----------------------------------------------------------------
// Each instrument gets its own send into the two rooms, and optionally a set of
// resonant peaks standing in for a body. This is the difference between six
// instruments recorded in one place and six instruments in a heap.

export type ChannelConfig = {
  dry?: number;
  room?: number;
  hall?: number;
  /** Resonant peaks the whole channel runs through — the box the instrument is
   *  mounted on. `[frequency, Q, gain]`. */
  body?: [number, number, number][];
};

const DEFAULT_CHANNEL: ChannelConfig = { dry: 1, room: 0.3, hall: 0.42 };

const configs = new Map<string, ChannelConfig>();
const channels = new Map<string, GainNode>();

/**
 * Declare how a channel sits in the room. Safe to call before any audio exists —
 * the nodes are built on first use.
 */
export function configureChannel(id: string, config: ChannelConfig): void {
  configs.set(id, config);
  channels.delete(id); // rebuilt with the new config on next use
}

function channelNode(id: string): GainNode {
  const context = build();
  const existing = channels.get(id);
  if (existing) return existing;

  const config = { ...DEFAULT_CHANNEL, ...(configs.get(id) ?? {}) };
  const node = new GainNode(context, { gain: 1 });

  // The body, if it has one, sits between the instrument and its sends, so the
  // room hears the resonances too rather than being pasted on beside them.
  let source: AudioNode = node;
  if (config.body?.length) {
    const bodied = new GainNode(context, { gain: 1 });
    node.connect(bodied); // the direct path, un-resonated
    for (const [frequency, q, gain] of config.body) {
      const peak = new BiquadFilterNode(context, { type: "bandpass", frequency, Q: q });
      const level = new GainNode(context, { gain });
      node.connect(peak).connect(level).connect(bodied);
    }
    source = bodied;
  }

  if (dryBus && config.dry) {
    source.connect(new GainNode(context, { gain: config.dry })).connect(dryBus);
  }
  if (roomIn && config.room) {
    source.connect(new GainNode(context, { gain: config.room })).connect(roomIn);
  }
  if (hallIn && config.hall) {
    source.connect(new GainNode(context, { gain: config.hall })).connect(hallIn);
  }

  channels.set(id, node);
  return node;
}

/** Resume on a user gesture. Safe to call on every gesture. */
export function wake(): void {
  const context = build();
  if (context.state !== "running") void context.resume();
  // Fades in rather than snapping on, so the first gesture doesn't arrive with
  // a wall of sound behind it.
  padGain?.gain.setTargetAtTime(padEnabled ? 1 : 0, context.currentTime, 2.5);
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

/** Bumped every time the chord turns, so callers know to retune. */
let chordTurns = 0;

export function chordRevision(): number {
  return chordTurns;
}

/**
 * The current chord as a rising ladder of frequencies from `lowestHz` up.
 *
 * Tuning an instrument to this rather than to the whole scale is what makes
 * "there is no wrong note" literally true: every string is a member of the
 * chord, so any set of them sounded together is that chord.
 */
export function chordLadder(count: number, lowestHz = 82): number[] {
  const tones: number[] = [];
  for (let octave = 0; octave < 7; octave++) {
    for (const pitchClass of PROGRESSION[chordIndex]) {
      tones.push(ROOT_HZ * 2 ** (octave + pitchClass / 12));
    }
  }
  return tones
    .sort((a, b) => a - b)
    .filter((hz) => hz >= lowestHz)
    .slice(0, count);
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
    chordTurns++;
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

export function makeDrone(channel = "main"): Drone | null {
  const context = build();
  if (!ac) return null;
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
  filter.connect(out).connect(panner).connect(channelNode(channel));
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
  /** Which channel — and so which room — this note lives in. */
  channel?: string;
};

/**
 * The sound of an orb: two saws a few cents apart plus a sine sub, behind a
 * lowpass that closes as the note decays. The detuning is the whole reason it
 * reads as an instrument rather than a test tone.
 */
export function playTone(frequency: number, options: ToneOptions = {}): void {
  const context = build();
  if (!ac || activeVoices >= MAX_VOICES) return;

  const {
    duration = 1,
    level = 0.08,
    brightness = 0.5,
    pan = 0,
    noise: grit = 0,
    channel = "main",
  } = options;
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
  filter.connect(out).connect(panner).connect(channelNode(channel));

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
export function holdTone(frequency: number, level = 0.055, channel = "main"): HeldVoice | null {
  const context = build();
  if (!ac) return null;
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
  filter.connect(out).connect(channelNode(channel));

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

// --- the plucked string ------------------------------------------------------

/** A ringing string. Its pitch can be bent while it sounds. */
export type PluckVoice = {
  /** Bend to a new pitch. Re-pitching a Karplus–Strong buffer also stretches
   *  its decay a little, which is what a bent string actually does. */
  bend: (hz: number) => void;
  /** Damp the string — a palm on it, not a fade-out. */
  damp: () => void;
};

export function playPluck(
  frequency: number,
  options: { hardness?: number; level?: number; pan?: number; channel?: string } = {},
): PluckVoice | null {
  const context = build();
  if (activeVoices >= MAX_VOICES) return null;

  const { hardness = 0.6, level = 0.3, pan = 0, channel = "main" } = options;
  const { buffer, playbackRate } = pluckBuffer(context, frequency, hardness);
  // The pitch the cached buffer was rendered at; bends are expressed against it.
  const rendered = frequency / playbackRate;
  const now = context.currentTime;

  // Three per-hit variations, all tiny, all load-bearing. Buffers are cached, so
  // without these the same string struck twice is bit-identical samples — which
  // is precisely what makes a fast strum sound like a machine gun.
  const detune = 1 + (Math.random() - 0.5) * 0.004;
  const skip = Math.random() * 0.0025;

  const source = new AudioBufferSourceNode(context, {
    buffer,
    playbackRate: playbackRate * detune,
  });
  const gain = new GainNode(context, { gain: level * (0.94 + Math.random() * 0.12) });
  const panner = new StereoPannerNode(context, { pan: Math.max(-1, Math.min(1, pan)) });
  source.connect(gain).connect(panner).connect(channelNode(channel));

  activeVoices++;
  source.onended = () => {
    activeVoices--;
  };
  source.start(now, skip);

  let stopped = false;

  return {
    bend(hz) {
      if (stopped) return;
      source.playbackRate.setTargetAtTime(
        Math.max(0.25, (hz / rendered) * detune),
        context.currentTime,
        0.035,
      );
    },
    damp() {
      if (stopped) return;
      stopped = true;
      const at = context.currentTime;
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      source.stop(at + 0.2);
    },
  };
}

// --- struck things -----------------------------------------------------------
// A plucked string is a delay line; a struck bar or bell is a stack of decaying
// sine partials. What separates a marimba from a bell is almost entirely the
// ratios of those partials and how fast each one dies — so both instruments come
// out of this one function, and the difference lives in their own files where it
// belongs.

export type StruckOptions = {
  /** Partial frequencies as multiples of the fundamental. Inharmonic ratios
   *  give metal; near-harmonic ones give wood. */
  ratios?: number[];
  /** Relative loudness of each partial. Defaults to falling away with height. */
  gains?: number[];
  /** Seconds for the fundamental to fade out. Partials scale down from this. */
  decay?: number;
  level?: number;
  pan?: number;
  /** A noise transient on the attack — the sound of the mallet, not the bar. */
  noise?: number;
  /** How much faster the upper partials die than the fundamental. */
  damping?: number;
  channel?: string;
  /**
   * A resonator tuned to the fundamental. This is what a marimba's tubes are,
   * and they are the whole instrument: the same bar over no tube is a xylophone.
   */
  resonance?: { q: number; gain: number };
};

export function playStruck(frequency: number, options: StruckOptions = {}): void {
  const context = build();
  if (!ac || activeVoices >= MAX_VOICES) return;

  const {
    ratios = [1, 2, 3],
    gains,
    decay = 1.6,
    level = 0.2,
    pan = 0,
    noise: grit = 0.2,
    damping = 0.55,
    channel = "main",
    resonance,
  } = options;

  const now = context.currentTime;
  const panner = new StereoPannerNode(context, { pan: Math.max(-1, Math.min(1, pan)) });
  const destination = channelNode(channel);
  panner.connect(destination);

  if (resonance) {
    // A tube tuned to the bar, in parallel with the bar itself.
    const tube = new BiquadFilterNode(context, { type: "bandpass", frequency, Q: resonance.q });
    const level = new GainNode(context, { gain: resonance.gain });
    panner.connect(tube).connect(level).connect(destination);
  }

  activeVoices++;
  let longest = decay;

  ratios.forEach((ratio, i) => {
    // A few tenths of a percent of drift per partial per strike. Inaudible on one
    // note; the difference between an instrument and a sample when the same note
    // is struck four times running.
    const hz = frequency * ratio * (1 + (Math.random() - 0.5) * 0.006);
    if (hz > 17000) return;
    // Upper partials die first. That single fact is most of what makes a struck
    // sound decay "naturally" rather than fading like a volume knob.
    const life = decay * (1 / ratio ** damping) * (0.94 + Math.random() * 0.12);
    longest = Math.max(longest, life);
    const peak = level * (gains?.[i] ?? 1 / (i + 1) ** 1.15);

    const osc = new OscillatorNode(context, { type: "sine", frequency: hz });
    const gain = new GainNode(context, { gain: 0 });
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + life);
    osc.connect(gain).connect(panner);
    osc.start(now);
    osc.stop(now + life + 0.05);
    if (i === 0) {
      osc.onended = () => {
        activeVoices--;
      };
    }
  });

  if (grit > 0.01 && noise) {
    const burst = new AudioBufferSourceNode(context, { buffer: noise });
    const band = new BiquadFilterNode(context, {
      type: "bandpass",
      frequency: Math.min(9000, frequency * 4),
      Q: 0.9,
    });
    const shape = new GainNode(context, { gain: 0 });
    const tail = 0.02 + grit * 0.05;
    shape.gain.setValueAtTime(0, now);
    shape.gain.linearRampToValueAtTime(level * grit * 1.4, now + 0.002);
    shape.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    burst.connect(band).connect(shape).connect(panner);
    burst.start(now);
    burst.stop(now + tail + 0.02);
  }
  void longest;
}

/**
 * A membrane. A drum is not a stack of partials but a body of air with a pitch
 * that *falls* as the skin relaxes — that downward slide in the first hundred
 * milliseconds is the whole character of a struck drum, and leaving it out is
 * what makes synthesised drums sound like beeps.
 */
export function playDrum(
  frequency: number,
  options: {
    decay?: number;
    level?: number;
    pan?: number;
    snap?: number;
    bend?: number;
    channel?: string;
  } = {},
): void {
  const context = build();
  if (!ac || activeVoices >= MAX_VOICES) return;

  const {
    decay = 0.7,
    level = 0.4,
    pan = 0,
    snap = 0.4,
    bend = 2.1,
    channel = "main",
  } = options;
  const now = context.currentTime;

  const panner = new StereoPannerNode(context, { pan: Math.max(-1, Math.min(1, pan)) });
  panner.connect(channelNode(channel));

  // A drum that returns to exactly the same pitch every strike is a drum
  // machine. Real skin tension varies with where and how hard it was hit.
  const drift = 1 + (Math.random() - 0.5) * 0.05;
  const body = new OscillatorNode(context, { type: "sine", frequency: frequency * bend * drift });
  body.frequency.exponentialRampToValueAtTime(frequency * drift, now + decay * 0.22);
  const bodyGain = new GainNode(context, { gain: 0 });
  bodyGain.gain.setValueAtTime(0, now);
  bodyGain.gain.linearRampToValueAtTime(level, now + 0.004);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  body.connect(bodyGain).connect(panner);

  // A quieter overtone a little above the fundamental gives the skin some
  // tension without turning the drum into a pitched note.
  const ring = new OscillatorNode(context, { type: "sine", frequency: frequency * 1.58 * drift });
  const ringGain = new GainNode(context, { gain: 0 });
  ringGain.gain.setValueAtTime(0, now);
  ringGain.gain.linearRampToValueAtTime(level * 0.22, now + 0.004);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, now + decay * 0.5);
  ring.connect(ringGain).connect(panner);

  activeVoices++;
  body.onended = () => {
    activeVoices--;
  };
  body.start(now);
  body.stop(now + decay + 0.05);
  ring.start(now);
  ring.stop(now + decay * 0.5 + 0.05);

  if (snap > 0.01 && noise) {
    const burst = new AudioBufferSourceNode(context, { buffer: noise });
    const band = new BiquadFilterNode(context, {
      type: "highpass",
      frequency: 900 + snap * 2600,
    });
    const shape = new GainNode(context, { gain: 0 });
    const tail = 0.015 + snap * 0.07;
    shape.gain.setValueAtTime(0, now);
    shape.gain.linearRampToValueAtTime(level * snap * 0.85, now + 0.002);
    shape.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    burst.connect(band).connect(shape).connect(panner);
    burst.start(now);
    burst.stop(now + tail + 0.02);
  }
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
