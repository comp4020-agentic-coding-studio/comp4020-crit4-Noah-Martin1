// C4's spec, in the parts a machine can settle.
//
// The lines about latency, expressiveness and whether a stranger can pick it up
// are left to the crit — a test cannot listen. What is asserted here is the
// mechanically checkable half: both levels ship, the sound is synthesised
// rather than played back, each page opens with an invitation, and nothing
// keeps score.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const DIST = resolve("dist");

function walk(dir: string = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const shipped = walk().map((path) => relative(DIST, path).split(sep).join("/"));

const LEVELS = ["index.html", "singularity.html"];

describe("spec: both levels ship", () => {
  for (const level of LEVELS) {
    it(`${level} is in the build`, () => {
      expect(
        shipped,
        "a level that isn't in dist/ is a 404 on the deployed site",
      ).toContain(level);
    });
  }
});

describe("spec: the browser is the instrument", () => {
  it("ships no audio files", () => {
    // Sound has to be generated live by the player. A sample in the bundle
    // would mean the page is a player, not an instrument.
    const media = shipped.filter((name) => /\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i.test(name));
    expect(media, `these look like recordings: ${media.join(", ")}`).toEqual([]);
  });

  it("has no media elements in the markup", () => {
    for (const level of LEVELS) {
      const doc = new JSDOM(readFileSync(join(DIST, level), "utf8")).window.document;
      expect(doc.querySelector("audio, video"), `${level} plays back instead of synthesising`).toBe(
        null,
      );
    }
  });

  it("synthesises through the Web Audio API", () => {
    const scripts = shipped.filter((name) => name.endsWith(".js"));
    const source = scripts.map((name) => readFileSync(join(DIST, name), "utf8")).join("\n");
    expect(scripts.length).toBeGreaterThan(0);
    expect(source).toContain("AudioContext");
    expect(source).toContain("OscillatorNode");
  });
});

describe("spec: a stranger can start", () => {
  for (const level of LEVELS) {
    it(`${level} opens with an invitation`, () => {
      const doc = new JSDOM(readFileSync(join(DIST, level), "utf8")).window.document;
      const invitation = doc.querySelector("#invitation");
      expect(invitation, "the opening screen has to ask for the first sound").toBeTruthy();
      expect(invitation?.textContent?.trim().length ?? 0).toBeGreaterThan(8);
    });

    it(`${level} gives the player a stage to touch`, () => {
      const doc = new JSDOM(readFileSync(join(DIST, level), "utf8")).window.document;
      expect(doc.querySelector("canvas#stage")).toBeTruthy();
    });
  }
});

describe("spec: no way to play it wrong", () => {
  for (const level of LEVELS) {
    it(`${level} keeps no score and states no failure`, () => {
      const html = readFileSync(join(DIST, level), "utf8");
      const doc = new JSDOM(html).window.document;
      expect(doc.querySelector("[id*='score'], [class*='score']")).toBe(null);
      const text = doc.body.textContent?.toLowerCase() ?? "";
      for (const phrase of ["game over", "you lose", "you win", "try again", "final score"]) {
        expect(text, `"${phrase}" implies a fail state`).not.toContain(phrase);
      }
    });
  }
});

describe("spec: the link-preview card resolves", () => {
  // The shipped invariants check the card is *named*; nothing checks the URL
  // actually points at a file, and a card that 404s only shows up in the
  // course gallery. One page one directory down is all it takes to break.
  for (const level of LEVELS) {
    it(`${level}'s og:image exists in the build`, () => {
      const doc = new JSDOM(readFileSync(join(DIST, level), "utf8")).window.document;
      const card = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
      expect(card).toBeTruthy();
      if (!card || /^https?:/i.test(card)) return;
      const resolved = resolve(DIST, dirname(level), card);
      expect(
        existsSync(resolved),
        `${level} points og:image at ${card}, which is not in the build`,
      ).toBe(true);
    });
  }
});
