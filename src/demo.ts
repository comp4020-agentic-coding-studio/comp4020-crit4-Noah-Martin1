// A worked example, written in beats.
//
// Four bars at 120bpm fits the eight-second loop exactly, so this is a real
// groove rather than a phrase that limps at the wrap. It is here because the
// hardest moment for this page is the first ten seconds: a stranger who has
// never heard the instruments has no idea what they can do, and asking them to
// compose something before they have heard anything is backwards. Press play,
// hear what the kit sounds like when it is played properly, then go and take it
// apart.
//
// Pitches are never written down. Every index is a rung on the chord ladder, so
// the whole arrangement re-harmonises itself when the progression turns — the
// same beat, in a new key, without a transposition step existing anywhere.

import type { Event } from "./recorder.ts";

/** 120bpm. Sixteen of these is exactly one loop. */
const BEAT = 0.5;

/** `[instrument, index, beat, force, at?]` */
type Hit = [string, number, number, number, number?];

const HITS: Hit[] = [
  // --- drums: the floor -----------------------------------------------------
  // Struck in the middle, where a drum is deepest and shortest.
  ["drum", 0, 0, 0.9, 0.06],
  ["drum", 0, 2.5, 0.62, 0.1],
  ["drum", 0, 4, 0.85, 0.06],
  ["drum", 0, 6.5, 0.6, 0.1],
  ["drum", 0, 8, 0.9, 0.06],
  ["drum", 0, 10.5, 0.62, 0.1],
  ["drum", 0, 12, 0.85, 0.06],
  ["drum", 0, 14, 0.66, 0.1],
  // Higher skins near the rim, answering at the end of each phrase.
  ["drum", 2, 3, 0.5, 0.45],
  ["drum", 2, 7, 0.52, 0.45],
  ["drum", 2, 11, 0.5, 0.45],
  ["drum", 3, 15, 0.55, 0.5],
  ["drum", 3, 15.5, 0.42, 0.6],

  // --- blocks: the subdivision ---------------------------------------------
  // Off the beat, never on it. On the beat they would only double the drums;
  // between the beats they are what makes it feel like it is moving.
  ["blocks", 0, 0.5, 0.42],
  ["blocks", 0, 2.5, 0.4],
  ["blocks", 0, 4.5, 0.42],
  ["blocks", 0, 6.5, 0.4],
  ["blocks", 0, 8.5, 0.42],
  ["blocks", 0, 10.5, 0.4],
  ["blocks", 0, 12.5, 0.42],
  ["blocks", 0, 14.5, 0.4],
  // A pair of pushes just before the third beat of every other bar.
  ["blocks", 2, 1.75, 0.5],
  ["blocks", 2, 5.75, 0.48],
  ["blocks", 2, 9.75, 0.5],
  ["blocks", 2, 13.75, 0.48],
  ["blocks", 4, 3.25, 0.44],
  ["blocks", 4, 11.25, 0.44],

  // --- bass: the anchor -----------------------------------------------------
  // Sparse on purpose. The notes ring for seconds, so more than a handful per
  // bar and it stops being a bass line and starts being a chord.
  ["bass", 0, 0, 0.78, 0.35],
  ["bass", 0, 2.5, 0.55, 0.4],
  ["bass", 1, 3.5, 0.5, 0.45],
  ["bass", 0, 4, 0.72, 0.35],
  ["bass", 2, 6, 0.58, 0.5],
  ["bass", 0, 8, 0.78, 0.35],
  ["bass", 1, 10.5, 0.55, 0.45],
  ["bass", 2, 12, 0.7, 0.5],
  ["bass", 1, 14, 0.5, 0.45],
  ["bass", 0, 15.5, 0.44, 0.4], // a pickup, leaning into the wrap

  // --- marimba: the figure --------------------------------------------------
  // The same five-note shape four times, walking up a rung each phrase, struck
  // in the middle of the bar where the tube rings hardest.
  ["marimba", 4, 0.25, 0.6, 0.5],
  ["marimba", 2, 0.75, 0.44, 0.5],
  ["marimba", 0, 1.5, 0.5, 0.5],
  ["marimba", 2, 2.25, 0.44, 0.5],
  ["marimba", 4, 3, 0.52, 0.5],

  ["marimba", 6, 4.25, 0.6, 0.5],
  ["marimba", 4, 4.75, 0.44, 0.5],
  ["marimba", 2, 5.5, 0.5, 0.5],
  ["marimba", 4, 6.25, 0.44, 0.5],
  ["marimba", 6, 7, 0.52, 0.5],

  ["marimba", 4, 8.25, 0.6, 0.5],
  ["marimba", 2, 8.75, 0.44, 0.5],
  ["marimba", 0, 9.5, 0.5, 0.5],
  ["marimba", 2, 10.25, 0.44, 0.5],
  ["marimba", 4, 11, 0.52, 0.5],

  ["marimba", 6, 12.25, 0.6, 0.5],
  ["marimba", 4, 12.75, 0.44, 0.5],
  ["marimba", 2, 13.5, 0.5, 0.5],
  ["marimba", 0, 14.25, 0.44, 0.5],
  ["marimba", 2, 15, 0.5, 0.5],

  // --- harp: the flourish ---------------------------------------------------
  // Two rolls, at the ends of the second and fourth phrases. Rolled rather than
  // struck together: the notes are a hundred milliseconds apart, which is what
  // makes it a harp and not a chord.
  ["harp", 0, 7, 0.5, 0.35],
  ["harp", 2, 7.12, 0.48, 0.4],
  ["harp", 4, 7.24, 0.46, 0.45],
  ["harp", 6, 7.36, 0.44, 0.5],

  ["harp", 7, 15, 0.46, 0.5],
  ["harp", 5, 15.12, 0.44, 0.45],
  ["harp", 3, 15.24, 0.42, 0.4],
  ["harp", 1, 15.36, 0.4, 0.35],

  // --- bells: the colour ----------------------------------------------------
  // Two in eight seconds. They ring for four, so a third would be a wash.
  ["bells", 5, 0, 0.46],
  ["bells", 2, 8, 0.4],
];

/** The example groove, as recorder events. */
export function demoLoop(): Event[] {
  return HITS.map(([instrument, index, beat, force, at]) => ({
    at: beat * BEAT,
    note: { instrument, index, force, ...(at === undefined ? {} : { at }) },
  })).sort((a, b) => a.at - b.at);
}

/** Longest beat used, so a test can prove the groove fits its loop. */
export const DEMO_LAST_BEAT = Math.max(...HITS.map(([, , beat]) => beat));
