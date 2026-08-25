// The keyboard.
//
// Every instrument writes its playing keys on itself, and those labels are a
// promise: press this and that element sounds. This checks the promise, because
// a label pointing at a key the instrument ignores is worse than no label — the
// player concludes the keyboard is broken and stops trying.
//
// It also guards the collision that actually happened: mute was bound to "m",
// which is one of the blocks' own keys, so opening the blocks and reaching for a
// note muted the page instead.

import { describe, expect, it } from "vitest";
import { makeBells } from "../src/instruments/bells.ts";
import { makeBlocks } from "../src/instruments/blocks.ts";
import { makeDrum } from "../src/instruments/drum.ts";
import { makeGuitar } from "../src/instruments/guitar.ts";
import { makeHarp } from "../src/instruments/harp.ts";
import { makeMarimba } from "../src/instruments/marimba.ts";
import type { Instrument, Note } from "../src/kit.ts";

/** Keys the stage handles itself, and which no instrument may claim. */
const RESERVED = ["0", " ", "escape"];

function laidOut(make: () => Instrument): Instrument {
  const instrument = make();
  // A realistic full-window rect; instruments size themselves from it.
  instrument.layout({ x: 0, y: 46, width: 1280, height: 620 });
  return instrument;
}

const kit = [makeHarp, makeGuitar, makeMarimba, makeBlocks, makeDrum, makeBells].map(laidOut);

describe("every instrument is playable from the keyboard", () => {
  for (const instrument of kit) {
    const labels = instrument.keyHints().map((hint) => hint.label).filter(Boolean);

    it(`${instrument.name} labels at least a few keys`, () => {
      expect(labels.length).toBeGreaterThan(3);
    });

    it(`${instrument.name} sounds a note for every key it labels`, () => {
      // Note that `elements` is a floor, not a ceiling: the harp gives itself as
      // many strings as the window has room for, and its keys spread across all
      // of them. So what is checked here is not a bound but the mapping — the
      // keys must land on elements in the same order the labels are written, or
      // the leftmost label is sitting on the wrong string.
      const indices: number[] = [];
      for (const label of labels) {
        const heard: Note[] = [];
        const handled = instrument.keyDown(label.toLowerCase(), false, (note) => heard.push(note));
        expect(handled, `${instrument.name} ignores "${label}", which it advertises`).toBe(true);
        expect(heard.length, `"${label}" produced ${heard.length} notes`).toBe(1);
        expect(heard[0].instrument).toBe(instrument.id);
        expect(heard[0].index).toBeGreaterThanOrEqual(0);
        indices.push(heard[0].index);
      }

      for (let i = 1; i < indices.length; i++) {
        expect(
          indices[i],
          `${instrument.name}: "${labels[i]}" plays ${indices[i]} but ` +
            `"${labels[i - 1]}" plays ${indices[i - 1]} — the labels are out of order`,
        ).toBeGreaterThan(indices[i - 1]);
      }
      expect(new Set(indices).size, "keys collapsed onto too few elements").toBeGreaterThan(3);
    });

    it(`${instrument.name} responds harder with shift held`, () => {
      const soft: Note[] = [];
      const hard: Note[] = [];
      instrument.keyDown(labels[0].toLowerCase(), false, (n) => soft.push(n));
      instrument.keyDown(labels[0].toLowerCase(), true, (n) => hard.push(n));
      expect(hard[0].force).toBeGreaterThan(soft[0].force);
    });

    it(`${instrument.name} declines keys that are not its own`, () => {
      // "\`" is on no instrument's row.
      const heard: Note[] = [];
      expect(instrument.keyDown("`", false, (n) => heard.push(n))).toBe(false);
      expect(heard).toEqual([]);
    });

    it(`${instrument.name} claims none of the stage's own keys`, () => {
      for (const key of RESERVED) {
        expect(
          labels.map((l) => l.toLowerCase()),
          `${instrument.name} advertises "${key}", which the stage handles first`,
        ).not.toContain(key);
        const heard: Note[] = [];
        instrument.keyDown(key, false, (n) => heard.push(n));
        expect(heard, `${instrument.name} responds to the reserved key "${key}"`).toEqual([]);
      }
    });
  }

  it("labels sit inside the instrument's own area", () => {
    // A label drawn off the edge of the rect is invisible, which is the same as
    // not having one.
    for (const instrument of kit) {
      for (const hint of instrument.keyHints()) {
        if (!hint.label) continue;
        expect(hint.x, `${instrument.name} label "${hint.label}" x`).toBeGreaterThan(-40);
        expect(hint.x).toBeLessThan(1320);
        expect(hint.y, `${instrument.name} label "${hint.label}" y`).toBeGreaterThan(6);
        expect(hint.y).toBeLessThan(700);
      }
    }
  });
});
