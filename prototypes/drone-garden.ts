// Drone Garden — click to plant a sustained voice. Each bloom is a detuned
// oscillator stack behind a slowly drifting filter; together they stack into a
// chord that never resolves. Pitch comes from height, quantised to a minor
// pentatonic so there is no wrong note to hit.

import { need } from "../src/dom.ts";

const canvas = need(document.querySelector<HTMLCanvasElement>("#field"), "#field canvas");
const ctx2d = need(canvas.getContext("2d"), "2d context");
const invitation = document.querySelector<HTMLElement>("#invitation");

// --- scale -----------------------------------------------------------------
// A minor pentatonic over four octaves. Quantising here is what makes the
// "no way to play it wrong" line true: every reachable pitch is consonant.
const ROOT = 55; // A1
const STEPS = [0, 3, 5, 7, 10];
const PITCHES: number[] = [];
for (let octave = 0; octave < 4; octave++) {
  for (const step of STEPS) {
    PITCHES.push(ROOT * 2 ** (octave + step / 12));
  }
}

const MAX_BLOOMS = 14;
const ATTACK = 1.4;
const RELEASE = 3.2;
const VOICE_GAIN = 0.13;

// --- audio graph, built lazily on the first gesture -------------------------
// The autoplay policy leaves a context suspended until a user gesture, so we
// don't even construct one until the player acts. Nothing sounds before then.
type Engine = {
  ac: AudioContext;
  destination: GainNode;
  reverb: ConvolverNode;
};

let engine: Engine | null = null;

function impulseResponse(ac: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ac.sampleRate * seconds);
  const buffer = ac.createBuffer(2, length, ac.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

function startEngine(): Engine {
  if (engine) return engine;

  const ac = new AudioContext();

  // A compressor at the end keeps fourteen simultaneous drones from clipping
  // as the player stacks them up.
  const master = new DynamicsCompressorNode(ac, {
    threshold: -18,
    ratio: 4,
    attack: 0.02,
    release: 0.3,
  });
  const masterGain = new GainNode(ac, { gain: 0.9 });
  master.connect(masterGain).connect(ac.destination);

  const reverb = new ConvolverNode(ac, { buffer: impulseResponse(ac, 3.4, 2.2) });
  const wet = new GainNode(ac, { gain: 0.55 });
  reverb.connect(wet).connect(master);

  const destination = new GainNode(ac, { gain: 1 });
  destination.connect(master);
  destination.connect(reverb);

  engine = { ac, destination, reverb };
  return engine;
}

// --- one bloom --------------------------------------------------------------
type Bloom = {
  x: number;
  y: number;
  freq: number;
  born: number;
  fading: boolean;
  gain: GainNode;
  stop: (at: number) => void;
};

const blooms: Bloom[] = [];

function plant(x: number, y: number): void {
  if (blooms.length >= MAX_BLOOMS) return;

  const { ac, destination } = startEngine();
  const now = ac.currentTime;

  // Height picks the pitch: low notes at the bottom, the way a keyboard reads.
  const index = Math.min(
    PITCHES.length - 1,
    Math.floor((1 - y / canvas.height) * PITCHES.length),
  );
  const freq = PITCHES[index];

  // Two saws a few cents apart, plus a sine an octave down for body. The
  // detune is what stops it sounding like a test tone.
  const oscA = new OscillatorNode(ac, { type: "sawtooth", frequency: freq, detune: -6 });
  const oscB = new OscillatorNode(ac, { type: "sawtooth", frequency: freq, detune: +7 });
  const sub = new OscillatorNode(ac, { type: "sine", frequency: freq / 2 });
  const subGain = new GainNode(ac, { gain: 0.5 });

  // Brightness follows the horizontal position, then drifts on its own.
  const cutoff = 320 + (x / canvas.width) * 2600;
  const filter = new BiquadFilterNode(ac, { type: "lowpass", frequency: cutoff, Q: 6 });

  const lfo = new OscillatorNode(ac, { type: "sine", frequency: 0.04 + Math.random() * 0.16 });
  const lfoDepth = new GainNode(ac, { gain: cutoff * 0.45 });
  lfo.connect(lfoDepth).connect(filter.frequency);

  const panner = new StereoPannerNode(ac, { pan: (x / canvas.width) * 1.6 - 0.8 });
  const gain = new GainNode(ac, { gain: 0 });

  oscA.connect(filter);
  oscB.connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(gain).connect(panner).connect(destination);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(VOICE_GAIN, now + ATTACK);

  for (const node of [oscA, oscB, sub, lfo]) node.start(now);

  blooms.push({
    x,
    y,
    freq,
    born: now,
    fading: false,
    gain,
    stop(at) {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + RELEASE);
      for (const node of [oscA, oscB, sub, lfo]) node.stop(at + RELEASE + 0.1);
    },
  });
}

function radiusOf(bloom: Bloom): number {
  // Low notes read as big slow circles, high notes as small bright ones.
  return 26 + 900 / bloom.freq;
}

function uproot(bloom: Bloom): void {
  if (bloom.fading || !engine) return;
  bloom.fading = true;
  bloom.stop(engine.ac.currentTime);
  window.setTimeout(() => {
    const i = blooms.indexOf(bloom);
    if (i !== -1) blooms.splice(i, 1);
  }, RELEASE * 1000 + 200);
}

// --- input ------------------------------------------------------------------
let invited = false;

function firstGesture(): void {
  if (invited) return;
  invited = true;
  invitation?.classList.add("gone");
  void startEngine().ac.resume();
}

function pointAt(x: number, y: number): void {
  firstGesture();
  const hit = blooms.find(
    (bloom) => !bloom.fading && Math.hypot(bloom.x - x, bloom.y - y) < radiusOf(bloom),
  );
  if (hit) uproot(hit);
  else plant(x, y);
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointAt(event.clientX - rect.left, event.clientY - rect.top);
});

// Keyboard players get the same instrument: the home row walks up the scale,
// and each key plants at a position that matches where the mouse would be.
const KEYS = "asdfghjkl;";
window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey) return;

  if (event.key === "Backspace" || event.key === "Escape") {
    event.preventDefault();
    const last = [...blooms].reverse().find((bloom) => !bloom.fading);
    if (last) {
      firstGesture();
      uproot(last);
    }
    return;
  }

  const slot = KEYS.indexOf(event.key.toLowerCase());
  if (slot === -1) return;
  event.preventDefault();
  firstGesture();
  const x = ((slot + 0.5) / KEYS.length) * canvas.width;
  const y = canvas.height * (0.22 + Math.random() * 0.56);
  pointAt(x, y);
});

// --- drawing ----------------------------------------------------------------
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Everything below works in CSS pixels; the transform handles the rest.
}
resize();
window.addEventListener("resize", resize);

function cssSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

function draw(): void {
  const { w, h } = cssSize();
  const t = engine ? engine.ac.currentTime : 0;

  const sky = ctx2d.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0b0b16");
  sky.addColorStop(1, "#05050a");
  ctx2d.fillStyle = sky;
  ctx2d.fillRect(0, 0, w, h);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const bloom of blooms) {
    const x = bloom.x / dpr;
    const y = bloom.y / dpr;
    const age = t - bloom.born;
    const envelope = bloom.fading
      ? Math.max(0, 1 - age / RELEASE)
      : Math.min(1, age / ATTACK);
    const pulse = 1 + 0.09 * Math.sin(t * (0.5 + bloom.freq / 900));
    const r = (radiusOf(bloom) / dpr) * pulse * (0.4 + 0.6 * envelope);
    const hue = 190 + ((bloom.freq * 7) % 130);

    const glow = ctx2d.createRadialGradient(x, y, 0, x, y, r * 3);
    glow.addColorStop(0, `hsla(${hue}, 85%, 68%, ${0.5 * envelope})`);
    glow.addColorStop(0.35, `hsla(${hue}, 80%, 55%, ${0.16 * envelope})`);
    glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    ctx2d.fillStyle = glow;
    ctx2d.beginPath();
    ctx2d.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx2d.fill();

    ctx2d.fillStyle = `hsla(${hue}, 90%, 78%, ${0.85 * envelope})`;
    ctx2d.beginPath();
    ctx2d.arc(x, y, r * 0.32, 0, Math.PI * 2);
    ctx2d.fill();
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
