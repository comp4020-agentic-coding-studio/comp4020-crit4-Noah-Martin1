// The drums: a row of skins, low and wide.
//
// Where you strike a drum matters as much as how hard. Hit the centre and you
// get the fundamental — deep and short. Hit near the rim and the skin can't move
// as far, so it tightens and rings. That one relationship is what makes a drum
// playable rather than a row of buttons, so it is what the radius of the strike
// controls here.

import { chordLadder, playDrum } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 55;
const COUNT = 5;
const KEYS = "zxcvb";

type Skin = {
  x: number;
  y: number;
  radius: number;
  hz: number;
  /** Ripples travelling out from the last strike. */
  ripples: { at: number; force: number; age: number }[];
  /** Whole-membrane displacement, decaying. */
  swell: number;
  glow: number;
};

export function makeDrum(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let skins: Skin[] = [];

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    // Biggest drum on the left, as a kit is usually laid out. Sizes follow the
    // pitches, because a bigger skin really does sound lower.
    const slot = next.width / COUNT;
    const maxRadius = Math.min(slot * 0.42, next.height * 0.3);

    skins = ladder.map((hz, i) => {
      const scale = 1 - (i / COUNT) * 0.42;
      const kept = skins[i];
      return {
        x: next.x + slot * (i + 0.5),
        y: next.y + next.height * 0.54,
        radius: maxRadius * scale,
        hz,
        ripples: kept?.ripples ?? [],
        swell: kept?.swell ?? 0,
        glow: kept?.glow ?? 0,
      };
    });
  }

  function panFor(x: number): number {
    const across = (x - rect.x) / Math.max(1, rect.width);
    return Math.max(-1, Math.min(1, across * 1.5 - 0.75));
  }

  function play(note: Note): void {
    const skin = skins[note.index];
    if (!skin) return;
    const force = Math.min(1, Math.max(0.05, note.force));
    // `at` is how far from the centre the strike landed, 0..1.
    const edge = Math.min(1, Math.max(0, note.at ?? 0.2));

    playDrum(skin.hz, {
      // Rim strikes ring longer and tighter; centre strikes are short and deep.
      decay: 0.85 - edge * 0.34,
      level: 0.14 + force * 0.42,
      pan: panFor(skin.x),
      snap: 0.18 + edge * 0.62,
      bend: 2.4 - edge * 1.1,
      channel: "drum",
    });

    skin.ripples.push({ at: edge, force, age: 0 });
    if (skin.ripples.length > 5) skin.ripples.shift();
    skin.swell = Math.min(1, skin.swell * 0.4 + force);
    skin.glow = 1;
  }

  return {
    id: "drum",
    name: "Drums",
    invitation: "Strike the skins",
    hint: "the middle is deep · the rim is tight",
    hue: 14,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const skin of skins) {
        skin.swell *= Math.exp(-dt * 5.5);
        skin.glow = Math.max(0, skin.glow - dt * 2.4);
        for (const ripple of skin.ripples) ripple.age += dt;
        skin.ripples = skin.ripples.filter((ripple) => ripple.age < 1.2);
      }
    },

    draw(c, t, preview) {
      const scale = preview ? 0.6 : 1;

      for (const skin of skins) {
        const lit = Math.min(1, skin.glow);
        const breathe = 1 + Math.sin(t * 0.6 + skin.hz) * 0.008;
        const r = skin.radius * breathe * (1 + skin.swell * 0.035);

        // The shell: a ring of warm metal the skin is stretched over.
        const shell = c.createLinearGradient(skin.x, skin.y - r, skin.x, skin.y + r);
        shell.addColorStop(0, `hsla(20, 42%, ${26 + lit * 12}%, 0.85)`);
        shell.addColorStop(1, "hsla(16, 46%, 11%, 0.9)");
        c.fillStyle = shell;
        c.beginPath();
        c.arc(skin.x, skin.y, r * 1.07, 0, Math.PI * 2);
        c.fill();

        // The skin. Lighter at the top where the light is, and it brightens as
        // a whole for a moment when struck.
        const head = c.createRadialGradient(
          skin.x - r * 0.3,
          skin.y - r * 0.36,
          0,
          skin.x,
          skin.y,
          r,
        );
        head.addColorStop(0, `hsla(28, ${44 + lit * 30}%, ${34 + lit * 26}%, 0.95)`);
        head.addColorStop(0.7, `hsla(20, ${40 + lit * 24}%, ${22 + lit * 16}%, 0.95)`);
        head.addColorStop(1, `hsla(16, 44%, ${14 + lit * 8}%, 0.95)`);
        c.fillStyle = head;
        c.beginPath();
        c.arc(skin.x, skin.y, r, 0, Math.PI * 2);
        c.fill();

        // Ripples: rings expanding from wherever the skin was hit. Drawn inside
        // the head so they read as the surface moving, not as decoration on it.
        c.save();
        c.beginPath();
        c.arc(skin.x, skin.y, r, 0, Math.PI * 2);
        c.clip();
        for (const ripple of skin.ripples) {
          const spread = ripple.age / 1.2;
          const fade = (1 - spread) ** 2 * ripple.force;
          c.strokeStyle = `hsla(34, 88%, 74%, ${fade * 0.5})`;
          c.lineWidth = (1 + ripple.force * 2) * scale;
          c.beginPath();
          c.arc(skin.x, skin.y, r * (ripple.at + spread * 1.5), 0, Math.PI * 2);
          c.stroke();
        }
        c.restore();

        // The rim highlight, and a bloom while it rings.
        c.strokeStyle = `hsla(32, 60%, ${58 + lit * 30}%, ${0.4 + lit * 0.5})`;
        c.lineWidth = (1.6 + lit) * scale;
        c.beginPath();
        c.arc(skin.x, skin.y, r, 0, Math.PI * 2);
        c.stroke();

        if (lit > 0.02) {
          const bloom = c.createRadialGradient(skin.x, skin.y, r, skin.x, skin.y, r * 2.4);
          bloom.addColorStop(0, `hsla(24, 90%, 58%, ${lit * 0.22})`);
          bloom.addColorStop(1, "hsla(24, 90%, 58%, 0)");
          c.fillStyle = bloom;
          c.beginPath();
          c.arc(skin.x, skin.y, r * 2.4, 0, Math.PI * 2);
          c.fill();
        }
      }
    },

    play,

    flourish(emit) {
      [0, 2, 1, 3].forEach((index, i) => {
        window.setTimeout(
          () => emit({ instrument: "drum", index: Math.min(index, COUNT - 1), force: 0.5, at: 0.25 }),
          i * 135,
        );
      });
    },

    retune() {
      const ladder = chordLadder(COUNT, LOWEST_HZ);
      skins.forEach((skin, i) => {
        if (ladder[i]) skin.hz = ladder[i];
      });
    },

    pointerDown(p, emit) {
      for (let i = 0; i < skins.length; i++) {
        const skin = skins[i];
        const distance = Math.hypot(p.x - skin.x, p.y - skin.y);
        if (distance > skin.radius * 1.07) continue;
        emit({
          instrument: "drum",
          index: i,
          // No velocity to read from a tap, so a firm default with a little
          // variation — a drum that always hits identically sounds mechanical.
          force: 0.62 + Math.random() * 0.22,
          at: Math.min(1, distance / skin.radius),
        });
        return;
      }
    },

    pointerMove() {
      // Drums are struck, not brushed. Dragging across them does nothing, which
      // is what stops a stray mouse move turning into a drum roll.
    },

    pointerUp() {},

    keyDown(key, shift, emit) {
      const slot = KEYS.indexOf(key);
      if (slot === -1 || slot >= skins.length) return false;
      emit({
        instrument: "drum",
        index: slot,
        force: shift ? 0.95 : 0.6 + Math.random() * 0.2,
        at: shift ? 0.08 : 0.3,
      });
      return true;
    },

    keyHints() {
      return skins.map((skin, i) => ({
        label: KEYS[i] ?? "",
        x: skin.x,
        y: skin.y + skin.radius + 20,
      }));
    },

    keyUp() {},
    blur() {},
  };
}
