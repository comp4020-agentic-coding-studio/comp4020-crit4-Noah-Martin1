// C4's spec, in the parts a machine can settle.
//
// The lines about latency, expressiveness and whether a stranger can pick it up
// are left to the crit — a test cannot listen. What is asserted here is the
// mechanically checkable half, and it is asserted against *every* page the build
// emits rather than a hand-kept list, so an archived page cannot quietly stop
// meeting the spec and a new page cannot be added without meeting it.

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

const pages = shipped
  .filter((name) => name.endsWith(".html"))
  .map((name) => ({
    name,
    html: readFileSync(join(DIST, name), "utf8"),
    doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
  }));

describe("spec: the site ships", () => {
  it("has a home page", () => {
    expect(shipped).toContain("index.html");
  });

  it("still ships the archived instrument", () => {
    // Kept deployed on purpose: it is the process evidence for how the current
    // prototype was arrived at.
    expect(shipped).toContain("archive/osmos/open-field.html");
    expect(shipped).toContain("archive/osmos/singularity.html");
  });

  it("built more than one page", () => {
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe("spec: the browser is the instrument", () => {
  it("ships no audio files", () => {
    // Sound has to be generated live by the player. A sample in the bundle would
    // mean the page is a player, not an instrument.
    const media = shipped.filter((name) => /\.(mp3|wav|ogg|m4a|flac|aac|opus|webm)$/i.test(name));
    expect(media, `these look like recordings: ${media.join(", ")}`).toEqual([]);
  });

  it("synthesises through the Web Audio API", () => {
    const scripts = shipped.filter((name) => name.endsWith(".js"));
    const source = scripts.map((name) => readFileSync(join(DIST, name), "utf8")).join("\n");
    expect(scripts.length).toBeGreaterThan(0);
    expect(source).toContain("AudioContext");
  });

  for (const { name, doc } of pages) {
    it(`${name} has no media elements`, () => {
      expect(doc.querySelector("audio, video"), `${name} plays back instead of synthesising`).toBe(
        null,
      );
    });
  }
});

describe("spec: a stranger can start", () => {
  for (const { name, doc } of pages) {
    it(`${name} opens with an invitation`, () => {
      const invitation = doc.querySelector("#invitation");
      expect(invitation, "the opening screen has to ask for the first sound").toBeTruthy();
      expect(invitation?.textContent?.trim().length ?? 0).toBeGreaterThan(8);
    });

    it(`${name} gives the player a stage to touch`, () => {
      expect(doc.querySelector("canvas#stage")).toBeTruthy();
    });
  }
});

describe("spec: no way to play it wrong", () => {
  for (const { name, doc } of pages) {
    it(`${name} keeps no score and states no failure`, () => {
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
  // actually points at a file, and a card that 404s only shows up in the course
  // gallery. The archived pages sit two directories down, which is exactly where
  // this goes wrong.
  for (const { name, doc } of pages) {
    it(`${name}'s og:image exists in the build`, () => {
      const card = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
      expect(card).toBeTruthy();
      if (!card || /^https?:/i.test(card)) return;
      expect(
        existsSync(resolve(DIST, dirname(name), card)),
        `${name} points og:image at ${card}, which is not in the build`,
      ).toBe(true);
    });
  }
});

describe("spec: every link resolves", () => {
  // A dead link between the current page and the archive would be invisible
  // until someone clicked it.
  for (const { name, doc } of pages) {
    it(`${name}'s internal links all exist`, () => {
      for (const anchor of doc.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        if (/^(https?:|mailto:|#)/i.test(href)) continue;
        const target = href.endsWith("/") ? `${href}index.html` : href;
        expect(
          existsSync(resolve(DIST, dirname(name), target)),
          `${name} links to ${href}, which is not in the build`,
        ).toBe(true);
      }
    });
  }
});
