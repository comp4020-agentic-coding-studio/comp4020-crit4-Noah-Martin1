// The example beat.
//
// Every note in it is written by hand, and a note addressed at an element that
// does not exist is dropped in silence by `play` — no error, no warning, just a
// hole in the groove that you would have to notice by ear. So the arrangement is
// checked against the instruments it is arranged for.

import { describe, expect, it } from "vitest";
import { DEMO_LAST_BEAT, demoLoop } from "../src/demo.ts";
import { makeGuitar } from "../src/instruments/guitar.ts";
import { makeBells } from "../src/instruments/bells.ts";
import { makeBlocks } from "../src/instruments/blocks.ts";
import { makeDrum } from "../src/instruments/drum.ts";
import { makeHarp } from "../src/instruments/harp.ts";
import { makeMarimba } from "../src/instruments/marimba.ts";
import type { Instrument } from "../src/kit.ts";
import { LOOP_SECONDS } from "../src/recorder.ts";

const kit: Instrument[] = [
  makeHarp(),
  makeGuitar(),
  makeMarimba(),
  makeBlocks(),
  makeDrum(),
  makeBells(),
];
const byId = new Map(kit.map((instrument) => [instrument.id, instrument]));
const events = demoLoop();

describe("the example beat", () => {
  it("addresses only instruments that exist", () => {
    for (const { note } of events) {
      expect(byId.has(note.instrument), `no instrument called "${note.instrument}"`).toBe(true);
    }
  });

  it("never reaches past an instrument's elements", () => {
    for (const { note } of events) {
      const instrument = byId.get(note.instrument);
      if (!instrument) continue;
      expect(
        note.index,
        `${note.instrument} has ${instrument.elements} elements at the narrowest window, ` +
          `so index ${note.index} would be silently dropped`,
      ).toBeLessThan(instrument.elements);
      expect(note.index).toBeGreaterThanOrEqual(0);
    }
  });

  it("fits inside the loop", () => {
    // A note past the loop point would never sound at all.
    expect(DEMO_LAST_BEAT * 0.5).toBeLessThan(LOOP_SECONDS);
    for (const event of events) {
      expect(event.at).toBeGreaterThanOrEqual(0);
      expect(event.at).toBeLessThan(LOOP_SECONDS);
    }
  });

  it("uses every instrument in the kit", () => {
    const used = new Set(events.map((event) => event.note.instrument));
    for (const instrument of kit) {
      expect(used.has(instrument.id), `${instrument.name} sits out the whole beat`).toBe(true);
    }
  });

  it("is in time order and inside a sane dynamic range", () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
    }
    for (const { note } of events) {
      expect(note.force).toBeGreaterThan(0);
      expect(note.force).toBeLessThanOrEqual(1);
    }
  });

  it("leaves the guitar and bells sparse enough to breathe", () => {
    // Both ring for seconds, and crowding them is the fastest way to turn the
    // loop into a wash — so restraint is part of the arrangement's contract.
    //
    // Counted in gestures rather than notes. A strum is three strings 50ms
    // apart: one movement of one hand, and one thing the ear hears. Counting its
    // notes separately would have this fail an arrangement that is not actually
    // dense, which is exactly what it did on the first attempt.
    const gestures = (id: string): number => {
      const times = events
        .filter((event) => event.note.instrument === id)
        .map((event) => event.at);
      return times.filter((at, i) => i === 0 || at - times[i - 1] > 0.08).length;
    };
    expect(gestures("bells")).toBeLessThanOrEqual(4);
    expect(gestures("guitar")).toBeLessThanOrEqual(14);
  });
});
