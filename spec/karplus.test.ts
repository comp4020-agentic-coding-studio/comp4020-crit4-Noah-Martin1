// The synthesis, checked numerically.
//
// Whether the instrument *sounds* good is a question for the crit and for a
// pair of ears. Whether it is producing a pitched note at the frequency asked
// for, that decays, is arithmetic — and getting that silently wrong is exactly
// the kind of bug you cannot hear over a reverb.

import { describe, expect, it } from "vitest";
import { renderPluck } from "../src/karplus.ts";

const SAMPLE_RATE = 44100;

/** Enough of a BaseAudioContext for renderPluck: a sample rate and a buffer. */
function stubContext(): BaseAudioContext {
  return {
    sampleRate: SAMPLE_RATE,
    createBuffer(channels: number, length: number, rate: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        length,
        sampleRate: rate,
        numberOfChannels: channels,
        getChannelData: (channel: number) => data[channel],
      };
    },
  } as unknown as BaseAudioContext;
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, samples.length);
  for (let i = from; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, end - from));
}

/**
 * Estimate the fundamental by autocorrelation: slide the signal over itself and
 * find the lag that matches best. The strongest lag is one period.
 */
function detectPitch(samples: Float32Array, from: number, windowLength: number): number {
  const minLag = Math.floor(SAMPLE_RATE / 1200);
  const maxLag = Math.floor(SAMPLE_RATE / 60);
  let bestLag = minLag;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = 0; i < windowLength; i++) {
      score += samples[from + i] * samples[from + i + lag];
    }
    // Normalise so long lags are not penalised for drifting amplitude.
    const normalised = score / lag ** 0.08;
    if (normalised > bestScore) {
      bestScore = normalised;
      bestLag = lag;
    }
  }
  return SAMPLE_RATE / bestLag;
}

describe("karplus-strong", () => {
  it("produces sound", () => {
    const buffer = renderPluck(stubContext(), 220, { duration: 2 });
    const samples = buffer.getChannelData(0);
    expect(samples.length).toBe(SAMPLE_RATE * 2);
    expect(rms(samples, 0, SAMPLE_RATE / 4)).toBeGreaterThan(0.01);
  });

  it("is pitched at the frequency it was asked for", () => {
    for (const target of [110, 165, 220, 330, 440, 587]) {
      const buffer = renderPluck(stubContext(), target, { duration: 2 });
      const samples = buffer.getChannelData(0);
      // Measure a little way in, once the initial noise has filtered down into
      // a tone.
      const detected = detectPitch(samples, Math.floor(SAMPLE_RATE * 0.25), 4096);
      const cents = 1200 * Math.log2(detected / target);
      expect(
        Math.abs(cents),
        `asked for ${target}Hz, got ${detected.toFixed(1)}Hz (${cents.toFixed(0)} cents off)`,
      ).toBeLessThan(60);
    }
  });

  it("decays rather than sustaining forever", () => {
    const buffer = renderPluck(stubContext(), 220, { duration: 3 });
    const samples = buffer.getChannelData(0);
    const early = rms(samples, 0, Math.floor(SAMPLE_RATE * 0.2));
    const late = rms(samples, Math.floor(SAMPLE_RATE * 2.2), Math.floor(SAMPLE_RATE * 2.4));
    expect(late).toBeLessThan(early * 0.25);
  });

  it("ends in silence, so a buffer can never click at its tail", () => {
    const buffer = renderPluck(stubContext(), 147, { duration: 2 });
    const samples = buffer.getChannelData(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(1e-6);
  });

  it("keeps decay times comparable across the range", () => {
    // Damping is applied per trip round the delay line, so a naive fixed value
    // makes low notes ring for minutes and high notes vanish. This is the check
    // that the per-note correction is doing its job.
    const halfLives = [110, 440].map((hz) => {
      const samples = renderPluck(stubContext(), hz, { duration: 3 }).getChannelData(0);
      const peak = rms(samples, 0, Math.floor(SAMPLE_RATE * 0.1));
      for (let second = 0; second < 30; second++) {
        const at = Math.floor((SAMPLE_RATE * second) / 10);
        if (rms(samples, at, at + 2048) < peak * 0.25) return second / 10;
      }
      return 3;
    });
    const [low, high] = halfLives;
    expect(Math.abs(low - high), `low decayed in ${low}s, high in ${high}s`).toBeLessThan(0.9);
  });

  it("a harder pluck is brighter, not just louder", () => {
    const context = stubContext();
    const soft = renderPluck(context, 220, { hardness: 0.05, duration: 2 }).getChannelData(0);
    const hard = renderPluck(context, 220, { hardness: 1, duration: 2 }).getChannelData(0);

    // High-frequency content, as the mean absolute sample-to-sample difference:
    // a bright signal moves further between neighbouring samples.
    const slope = (samples: Float32Array): number => {
      let sum = 0;
      const window = Math.floor(SAMPLE_RATE * 0.05);
      for (let i = 1; i < window; i++) sum += Math.abs(samples[i] - samples[i - 1]);
      return sum / window / (rms(samples, 0, window) || 1);
    };

    expect(slope(hard)).toBeGreaterThan(slope(soft));
  });
});
