// The harp: a field of strings you can reach into.
//
// Three gestures, none of which needs explaining. Move across them and they ring
// as you pass. Press one and pull, and it bends. Pull hard enough and it slips
// off your finger and the next one catches — which is what a strum is, and which
// falls out of the same rule rather than being a separate feature.

import { type PluckVoice, chordLadder, playPluck } from "../audio.ts";
import type { Emit, Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 98;
const SPACING = 62;
const MIN_STRINGS = 8;
const MAX_STRINGS = 22;
const GRAB = 30;
/** Pull a string further than this and it slips off your finger. */
const SLIP = 46;
const BEND_SEMITONES = 2.4;

type Line = {
  x: number;
  hz: number;
  bentHz: number;
  pull: number;
  holdAt: number;
  amplitude: number;
  phase: number;
  glow: number;
  voice: PluckVoice | null;
};

export function makeHarp(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let lines: Line[] = [];
  let held: { index: number; id: number } | null = null;
  let last: { x: number; y: number } | null = null;
  let lastPlayed = 0;

  /** The strings run down most of the rect, leaving room for the bridges. */
  const top = (): number => rect.y + rect.height * 0.12;
  const bottom = (): number => rect.y + rect.height * 0.9;

  function tune(count: number): number[] {
    return chordLadder(count, LOWEST_HZ);
  }

  function layout(next: Rect): void {
    rect = next;
    const count = Math.min(MAX_STRINGS, Math.max(MIN_STRINGS, Math.round(next.width / SPACING)));
    const ladder = tune(count);
    const gap = next.width / (count + 1);
    const previous = lines;
    lines = ladder.map((hz, i) => {
      const kept = previous[i];
      return {
        x: next.x + gap * (i + 1),
        hz,
        bentHz: kept?.pull ? kept.bentHz : hz,
        pull: kept?.pull ?? 0,
        holdAt: kept?.holdAt ?? 0.5,
        // Anything already ringing keeps ringing through a resize or a retune.
        amplitude: kept?.amplitude ?? 0,
        phase: kept?.phase ?? Math.random() * Math.PI * 2,
        glow: kept?.glow ?? 0,
        voice: kept?.voice ?? null,
      };
    });
  }

  function panFor(x: number): number {
    const across = (x - rect.x) / Math.max(1, rect.width);
    return Math.max(-1, Math.min(1, across * 1.7 - 0.85));
  }

  function hueFor(line: Line): number {
    const t = Math.min(1, Math.max(0, Math.log2(line.hz / LOWEST_HZ) / 3));
    return 30 + t * 22;
  }

  function play(note: Note): void {
    const line = lines[note.index];
    if (!line) return;
    const force = Math.min(1, Math.max(0.04, note.force));
    const bend = note.bend ?? 0;
    const hz = line.hz * 2 ** (bend / 12);

    // A second strike damps whatever was ringing, as a finger would.
    line.voice?.damp();
    line.voice =
      playPluck(hz, {
        hardness: 0.28 + force * 0.62,
        level: 0.07 + force * 0.48,
        pan: panFor(line.x),
        channel: "harp",
      }) ?? null;

    line.bentHz = hz;
    line.amplitude = Math.min(1, line.amplitude * 0.3 + force);
    line.glow = 1;
    line.holdAt = note.at ?? 0.5;
    line.phase = 0;
    lastPlayed = note.index;

    sympathy(note.index, force);
  }

  /**
   * Sympathetic resonance. Striking one string sets the others going a little
   * where they share partials. Real physics, nearly free, and it is what stops a
   * single pluck sounding like a single pluck.
   */
  function sympathy(index: number, force: number): void {
    if (force < 0.3) return;
    const struck = lines[index].bentHz;
    lines.forEach((line, i) => {
      if (i === index) return;
      const ratio = line.hz > struck ? line.hz / struck : struck / line.hz;
      const nearest = Math.round(ratio);
      const octaveish = Math.abs(ratio - nearest) < 0.03 && nearest >= 2 && nearest <= 4;
      const fifth = Math.abs(ratio - 1.5) < 0.03;
      if (!octaveish && !fifth) return;
      const share = (fifth ? 0.07 : 0.1) * force;
      line.voice?.damp();
      line.voice = playPluck(line.hz, {
        hardness: 0.2,
        level: share,
        pan: panFor(line.x),
        channel: "harp",
      }) ?? null;
      line.amplitude = Math.max(line.amplitude, share * 2.6);
      line.glow = Math.max(line.glow, 0.35);
    });
  }

  function heightFraction(y: number): number {
    return Math.min(0.92, Math.max(0.08, (y - top()) / Math.max(1, bottom() - top())));
  }

  function nearest(x: number): number {
    let best = -1;
    let bestDistance = GRAB;
    lines.forEach((line, i) => {
      const distance = Math.abs(line.x + line.pull - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  /** Everything the pointer passed between two positions, in travel order. */
  function crossed(fromX: number, toX: number): number[] {
    const hits: number[] = [];
    lines.forEach((line, i) => {
      const at = line.x + line.pull;
      if ((fromX - at) * (toX - at) <= 0 && fromX !== toX) hits.push(i);
    });
    return toX >= fromX ? hits : hits.reverse();
  }

  /** Let a held string go, sounding whatever the pull stored up. */
  function release(index: number, emit: Emit, force = 1): void {
    const line = lines[index];
    if (!line) return;
    const stored = Math.abs(line.pull) / SLIP;
    const bend = (Math.abs(line.pull) / SLIP) * BEND_SEMITONES;
    line.pull = 0;
    if (stored > 0.06) {
      emit({
        instrument: "harp",
        index,
        force: Math.min(1, stored * 1.15 * force),
        at: line.holdAt,
        bend,
      });
    } else {
      line.bentHz = line.hz;
    }
  }

  return {
    id: "harp",
    name: "Harp",
    invitation: "Move across the strings",
    hint: "press one and pull to bend it · pull harder and it slips",
    hue: 38,
    // The narrowest window still gives this many.
    elements: MIN_STRINGS,

    layout,

    update(dt) {
      for (const line of lines) {
        // The visible wobble runs far slower than the note — a 200 Hz string
        // drawn at 200 Hz is a grey blur. Scaled to keep the relationship, so
        // higher strings still visibly shiver faster.
        const visualHz = 1.6 + Math.log2(line.hz / LOWEST_HZ) * 1.5;
        line.phase += dt * visualHz * Math.PI * 2;
        line.amplitude *= Math.exp(-dt * 1.5);
        line.glow = Math.max(0, line.glow - dt * 2.2);
      }
    },

    draw(c, _t, preview) {
      const y0 = top();
      const y1 = bottom();
      const span = y1 - y0;
      const scale = preview ? 0.55 : 1;

      // The bridges the strings are stretched between.
      for (const y of [y0, y1]) {
        const bar = c.createLinearGradient(0, y - 3, 0, y + 3);
        bar.addColorStop(0, "rgba(238, 226, 208, 0.03)");
        bar.addColorStop(0.5, `rgba(238, 226, 208, ${preview ? 0.16 : 0.26})`);
        bar.addColorStop(1, "rgba(238, 226, 208, 0.03)");
        c.fillStyle = bar;
        c.fillRect(rect.x, y - 2, rect.width, 4);
      }

      c.lineCap = "round";
      c.lineJoin = "round";

      lines.forEach((line, i) => {
        const isHeld = held?.index === i && !preview;
        const hue = hueFor(line);
        const lit = Math.min(1, line.glow * 0.8 + line.amplitude * 0.5);

        const path = new Path2D();
        path.moveTo(line.x, y0);

        if (isHeld || Math.abs(line.pull) > 0.5) {
          // A pulled string is two straight segments meeting at the finger.
          // Curves would be prettier and wrong.
          path.lineTo(line.x + line.pull, y0 + span * line.holdAt);
          path.lineTo(line.x, y1);
        } else {
          // A ringing string is a standing wave: the fundamental plus a little
          // of the second partial, which is what gives the wobble its life.
          const swing = line.amplitude * 24 * scale;
          const steps = preview ? 14 : 28;
          for (let s = 1; s <= steps; s++) {
            const along = s / steps;
            const fundamental = Math.sin(Math.PI * along) * Math.sin(line.phase);
            const partial = Math.sin(Math.PI * 2 * along) * Math.sin(line.phase * 2) * 0.28;
            path.lineTo(line.x + (fundamental + partial) * swing, y0 + span * along);
          }
        }

        c.strokeStyle = `hsla(${hue}, 85%, 62%, ${(0.05 + lit * 0.16) * scale})`;
        c.lineWidth = (8 + lit * 12) * scale;
        c.stroke(path);

        c.strokeStyle = `hsla(${hue}, ${52 + lit * 34}%, ${58 + lit * 26}%, ${0.45 + lit * 0.45})`;
        c.lineWidth = (1.4 + lit * 1.2) * scale;
        c.stroke(path);

        if (lit > 0.05) {
          c.strokeStyle = `hsla(${hue + 12}, 96%, ${78 + lit * 16}%, ${lit * 0.7})`;
          c.lineWidth = 0.9 * scale;
          c.stroke(path);
        }

        if (isHeld) {
          const hx = line.x + line.pull;
          const hy = y0 + span * line.holdAt;
          const touch = c.createRadialGradient(hx, hy, 0, hx, hy, 26);
          touch.addColorStop(0, `hsla(${hue + 16}, 96%, 82%, 0.5)`);
          touch.addColorStop(1, "hsla(30, 90%, 70%, 0)");
          c.fillStyle = touch;
          c.beginPath();
          c.arc(hx, hy, 26, 0, Math.PI * 2);
          c.fill();
        }
      });
    },

    play,

    flourish(emit) {
      // A rising arpeggio as it opens, so the click that opened it is itself the
      // first sound.
      const pick = [0, 2, 4, 6].map((n) => Math.min(lines.length - 1, n));
      pick.forEach((index, i) => {
        window.setTimeout(() => emit({ instrument: "harp", index, force: 0.42 }), i * 105);
      });
    },

    retune() {
      const ladder = tune(lines.length);
      lines.forEach((line, i) => {
        if (!ladder[i]) return;
        line.hz = ladder[i];
        if (!line.pull) line.bentHz = ladder[i];
        line.glow = Math.max(line.glow, 0.45);
      });
    },

    pointerDown(p, _emit) {
      const index = nearest(p.x);
      last = { x: p.x, y: p.y };
      if (index === -1) return;
      held = { index, id: p.id };
      lines[index].holdAt = heightFraction(p.y);
    },

    pointerMove(p, _down, emit) {
      const previous = last;
      last = { x: p.x, y: p.y };
      if (!previous) return;

      if (held) {
        const line = lines[held.index];
        line.holdAt = heightFraction(p.y);
        const pull = p.x - line.x;

        if (Math.abs(pull) > SLIP) {
          // Slipped: released hard, and the pointer carries into the next one.
          const direction = Math.sign(pull);
          line.pull = direction * SLIP;
          release(held.index, emit, 1);
          const next = held.index + direction;
          held =
            next >= 0 && next < lines.length ? { index: next, id: p.id } : null;
          if (held) lines[held.index].holdAt = heightFraction(p.y);
          return;
        }

        line.pull = pull;
        // Pulling sharpens the string whether or not it is already sounding.
        const bend = (Math.abs(pull) / SLIP) * BEND_SEMITONES;
        line.bentHz = line.hz * 2 ** (bend / 12);
        line.voice?.bend(line.bentHz);
        return;
      }

      // Not holding anything: brush past whatever the pointer crosses. This is
      // the gesture a stranger makes by accident, so it has to sound good.
      const speed = Math.hypot(p.x - previous.x, p.y - previous.y);
      const at = heightFraction(p.y);
      for (const index of crossed(previous.x, p.x)) {
        emit({ instrument: "harp", index, force: Math.min(0.6, 0.1 + speed / 95), at });
      }
    },

    pointerUp(p, emit) {
      if (held && held.id === p.id) {
        release(held.index, emit);
        held = null;
      }
      last = null;
    },

    keyDown(key, shift, emit) {
      const KEYS = "asdfghjkl;";
      if (key === "ArrowUp" || key === "ArrowDown") {
        const line = lines[lastPlayed];
        if (!line) return true;
        const bend = (key === "ArrowUp" ? 1 : -1) * BEND_SEMITONES * 0.5;
        line.bentHz = line.hz * 2 ** (bend / 12);
        line.pull = Math.sign(bend) * SLIP * 0.5;
        line.voice?.bend(line.bentHz);
        return true;
      }
      const slot = KEYS.indexOf(key);
      if (slot === -1) return false;
      const index =
        lines.length <= KEYS.length
          ? Math.min(slot, lines.length - 1)
          : Math.round((slot / (KEYS.length - 1)) * (lines.length - 1));
      emit({ instrument: "harp", index, force: shift ? 0.95 : 0.55 });
      return true;
    },

    keyUp(key) {
      if (key !== "ArrowUp" && key !== "ArrowDown") return;
      const line = lines[lastPlayed];
      if (!line) return;
      line.bentHz = line.hz;
      line.pull = 0;
      line.voice?.bend(line.hz);
    },

    blur() {
      if (held) lines[held.index].pull = 0;
      held = null;
      last = null;
    },
  };
}
