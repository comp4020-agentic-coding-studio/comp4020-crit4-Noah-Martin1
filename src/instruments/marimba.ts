// The marimba: struck wooden bars, laid out flat.
//
// Wood and metal are the same synthesis with different numbers. A marimba bar's
// partials sit at roughly 1 : 3.9 : 9.2 — wide apart and quickly gone — which is
// why it reads as warm and woody and stops sounding almost immediately. The
// bells next door use the same function with inharmonic ratios and a decay ten
// times longer.

import { chordLadder, playStruck } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 196;
const COUNT = 9;
const KEYS = "qwertyuio";

type Bar = {
  x: number;
  y: number;
  width: number;
  height: number;
  hz: number;
  /** Vertical dip after being struck, decaying. */
  dip: number;
  glow: number;
  /** Where along the bar it was last hit, 0..1. */
  struckAt: number;
};

export function makeMarimba(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let bars: Bar[] = [];

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    const gap = next.height * 0.02;
    const slot = (next.height * 0.76) / COUNT;

    bars = ladder.map((hz, i) => {
      // Low bars are longer — the physical reason they are lower.
      const length = next.width * (0.82 - (i / COUNT) * 0.34);
      const kept = bars[i];
      return {
        // Laid out low at the bottom, so pitch rises as you go up the screen.
        x: next.x + (next.width - length) / 2,
        y: next.y + next.height * 0.88 - slot * (i + 1),
        width: length,
        height: slot - gap,
        hz,
        dip: kept?.dip ?? 0,
        glow: kept?.glow ?? 0,
        struckAt: kept?.struckAt ?? 0.5,
      };
    });
  }

  function panFor(bar: Bar, at: number): number {
    const x = bar.x + bar.width * at;
    const across = (x - rect.x) / Math.max(1, rect.width);
    return Math.max(-1, Math.min(1, across * 1.4 - 0.7));
  }

  function play(note: Note): void {
    const bar = bars[note.index];
    if (!bar) return;
    const force = Math.min(1, Math.max(0.05, note.force));
    const at = Math.min(1, Math.max(0, note.at ?? 0.5));
    // Struck at the end rather than the middle, a bar gives you much less
    // fundamental and a drier, harder sound.
    const centred = 1 - Math.abs(at - 0.5) * 2;

    playStruck(bar.hz, {
      ratios: [1, 3.932, 9.196, 15.4],
      gains: [1, 0.24 + (1 - centred) * 0.3, 0.1, 0.04],
      decay: 0.5 + centred * 0.55,
      level: 0.1 + force * 0.3,
      pan: panFor(bar, at),
      noise: 0.16 + force * 0.3,
      damping: 0.72,
      channel: "marimba",
      // The tuned tube under the bar. This is the whole instrument: the same bar
      // over no resonator is a xylophone, and that is the difference you hear.
      resonance: { q: 11, gain: 0.55 + centred * 0.3 },
    });

    bar.dip = Math.min(1, bar.dip * 0.4 + force);
    bar.glow = 1;
    bar.struckAt = at;
  }

  return {
    id: "marimba",
    name: "Marimba",
    invitation: "Tap the bars",
    hint: "the middle rings · the ends knock",
    hue: 64,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const bar of bars) {
        bar.dip *= Math.exp(-dt * 7);
        bar.glow = Math.max(0, bar.glow - dt * 2.8);
      }
    },

    draw(c, t, preview) {
      const scale = preview ? 0.6 : 1;

      for (const bar of bars) {
        const lit = Math.min(1, bar.glow);
        // The bar bows where it was struck. A bar that moved as a rigid block
        // would look like a button being pressed.
        const bow = bar.dip * 5 * scale;
        const y = bar.y + bow * 0.4;
        const radius = Math.min(bar.height / 2, 9);

        // A struck bar is warmer and brighter for a moment.
        const wood = c.createLinearGradient(bar.x, y, bar.x, y + bar.height);
        wood.addColorStop(0, `hsla(${44 + lit * 8}, ${38 + lit * 26}%, ${40 + lit * 26}%, 0.96)`);
        wood.addColorStop(0.55, `hsla(${34 + lit * 6}, ${40 + lit * 22}%, ${28 + lit * 20}%, 0.96)`);
        wood.addColorStop(1, "hsla(28, 44%, 16%, 0.96)");
        c.fillStyle = wood;
        c.beginPath();
        c.roundRect(bar.x, y, bar.width, bar.height, radius);
        c.fill();

        // Grain: a couple of faint lengthwise lines. Cheap, and it stops the
        // bars reading as plastic.
        c.save();
        c.beginPath();
        c.roundRect(bar.x, y, bar.width, bar.height, radius);
        c.clip();
        for (let g = 1; g <= 2; g++) {
          c.strokeStyle = `hsla(30, 40%, 62%, ${0.05 + lit * 0.05})`;
          c.lineWidth = 1;
          c.beginPath();
          const gy = y + (bar.height * g) / 3 + Math.sin(t * 0.2 + g) * 0.5;
          c.moveTo(bar.x + 6, gy);
          c.lineTo(bar.x + bar.width - 6, gy);
          c.stroke();
        }
        c.restore();

        c.strokeStyle = `hsla(48, ${46 + lit * 30}%, ${58 + lit * 30}%, ${0.24 + lit * 0.55})`;
        c.lineWidth = (1.1 + lit * 0.9) * scale;
        c.beginPath();
        c.roundRect(bar.x, y, bar.width, bar.height, radius);
        c.stroke();

        if (lit > 0.02) {
          // The bloom sits over the point of impact, not the whole bar.
          const hx = bar.x + bar.width * bar.struckAt;
          const hy = y + bar.height / 2;
          const bloom = c.createRadialGradient(hx, hy, 0, hx, hy, bar.height * 2.6);
          bloom.addColorStop(0, `hsla(52, 92%, 66%, ${lit * 0.3})`);
          bloom.addColorStop(1, "hsla(52, 92%, 66%, 0)");
          c.fillStyle = bloom;
          c.fillRect(
            hx - bar.height * 2.6,
            hy - bar.height * 2.6,
            bar.height * 5.2,
            bar.height * 5.2,
          );
        }
      }
    },

    play,

    flourish(emit) {
      [0, 2, 4, 6].forEach((index, i) => {
        window.setTimeout(
          () =>
            emit({
              instrument: "marimba",
              index: Math.min(index, bars.length - 1),
              force: 0.45,
              at: 0.5,
            }),
          i * 100,
        );
      });
    },

    retune() {
      const ladder = chordLadder(COUNT, LOWEST_HZ);
      bars.forEach((bar, i) => {
        if (ladder[i]) bar.hz = ladder[i];
      });
    },

    pointerDown(p, emit) {
      bars.forEach((bar, i) => {
        if (p.x < bar.x || p.x > bar.x + bar.width) return;
        if (p.y < bar.y || p.y > bar.y + bar.height) return;
        emit({
          instrument: "marimba",
          index: i,
          force: 0.6 + Math.random() * 0.2,
          at: (p.x - bar.x) / bar.width,
        });
      });
    },

    pointerMove(p, down, emit) {
      // Only a pressed drag runs the mallet along the bars — a glissando. A bare
      // hover would fire the whole instrument off every stray mouse movement.
      if (!down) return;
      bars.forEach((bar, i) => {
        if (p.x < bar.x || p.x > bar.x + bar.width) return;
        if (p.y < bar.y || p.y > bar.y + bar.height) return;
        if (bar.glow > 0.55) return; // already just struck
        emit({
          instrument: "marimba",
          index: i,
          force: 0.34,
          at: (p.x - bar.x) / bar.width,
        });
      });
    },

    pointerUp() {},

    keyDown(key, shift, emit) {
      const slot = KEYS.indexOf(key);
      if (slot === -1 || slot >= bars.length) return false;
      emit({
        instrument: "marimba",
        index: slot,
        force: shift ? 0.95 : 0.6,
        at: shift ? 0.14 : 0.5,
      });
      return true;
    },

    keyUp() {},
    blur() {},
  };
}
