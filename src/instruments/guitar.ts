// The guitar: six strings, lying flat, tuned to the chord.
//
// This is the instrument that holds the bottom of the kit — drums give the loop
// its pulse but they are transients, they say *when* without saying *what*.
//
// It started an octave lower and it was twangy, which in Karplus–Strong is three
// faults at once, and only one of them is pitch:
//
//   · Too low. At 49Hz a string makes only 49 trips round its delay line per
//     second, and the loop's lowpass acts per trip, not per second — so it needs
//     a perceptible half-second to take the top off, and the bright part of the
//     attack outstays its welcome. That is what reads as a rubber band. A
//     guitar's low E at 82Hz gets nearly twice the trips in the same time.
//   · Too little damping. That loop filter is a two-tap average, the gentlest
//     lowpass there is. Real strings shed their high partials far faster, so the
//     voice now also runs through a lowpass that closes as the note rings.
//   · No body. A string in a vacuum is a rubber band by definition. The guitar
//     channel carries the three resonances a guitar box actually has: the
//     Helmholtz note of the air in the cavity, the top plate, and one above it.
//
// All six strings are chord tones, so dragging across them is a strum and the
// chord is wherever the progression has got to.

import { type PluckVoice, chordLadder, playPluck } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 82; // a guitar's low E
const COUNT = 6;
const KEYS = "fghjkl";
/** Horizontal, so it cannot be mistaken for the harp at a glance. */
const GRAB = 26;

type StringLine = {
  y: number;
  hz: number;
  thickness: number;
  /** Displacement of the string, vertical here. */
  push: number;
  amplitude: number;
  phase: number;
  glow: number;
  voice: PluckVoice | null;
};

export function makeGuitar(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let strings: StringLine[] = [];
  let held: { index: number; id: number } | null = null;
  let last: { x: number; y: number } | null = null;

  const left = (): number => rect.x + rect.width * 0.08;
  const right = (): number => rect.x + rect.width * 0.92;

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    const slot = (next.height * 0.66) / COUNT;
    strings = ladder.map((hz, i) => {
      const kept = strings[i];
      return {
        // Lowest at the bottom, thickest — as it would lie on an instrument.
        y: next.y + next.height * 0.78 - slot * i,
        hz,
        thickness: 4.6 - i * 0.52,
        push: kept?.push ?? 0,
        amplitude: kept?.amplitude ?? 0,
        phase: kept?.phase ?? Math.random() * Math.PI * 2,
        glow: kept?.glow ?? 0,
        voice: kept?.voice ?? null,
      };
    });
  }

  function play(note: Note): void {
    const line = strings[note.index];
    if (!line) return;
    const force = Math.min(1, Math.max(0.05, note.force));

    line.voice?.damp();
    line.voice =
      playPluck(line.hz, {
        // Some attack — a guitar is plucked with a nail, not a thumb — but the
        // shading below is what keeps that attack from becoming a twang.
        hardness: 0.2 + force * 0.34,
        level: 0.15 + force * 0.4,
        // Harder plucks are brighter, but the ceiling is deliberately low. This
        // is the single biggest lever on the twang.
        tone: 0.26 + force * 0.22,
        // A guitar note is done in about three seconds. The cached buffer runs
        // longer than that, so it is faded rather than left to ring on.
        decay: 2.4 + force * 1.3,
        pan: (note.at ?? 0.5) * 0.6 - 0.3,
        channel: "guitar",
      }) ?? null;

    line.amplitude = Math.min(1, line.amplitude * 0.3 + force);
    line.glow = 1;
    line.phase = 0;
  }

  function nearest(y: number): number {
    let best = -1;
    let bestDistance = GRAB;
    strings.forEach((line, i) => {
      const distance = Math.abs(line.y + line.push - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  function crossed(fromY: number, toY: number): number[] {
    const hits: number[] = [];
    strings.forEach((line, i) => {
      const at = line.y + line.push;
      if ((fromY - at) * (toY - at) <= 0 && fromY !== toY) hits.push(i);
    });
    return hits;
  }

  return {
    id: "guitar",
    name: "Guitar",
    invitation: "Strum the strings",
    hint: "drag across for a chord · press one for a note",
    hue: 28,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const line of strings) {
        // Low strings visibly move slower, which is true and also reads well.
        const visualHz = 1.4 + Math.log2(line.hz / LOWEST_HZ) * 1.2;
        line.phase += dt * visualHz * Math.PI * 2;
        line.amplitude *= Math.exp(-dt * 1.5);
        line.glow = Math.max(0, line.glow - dt * 1.9);
        line.push *= Math.exp(-dt * 9);
      }
    },

    draw(c, _t, preview) {
      const x0 = left();
      const x1 = right();
      const span = x1 - x0;
      const scale = preview ? 0.6 : 1;

      // The nut and the bridge.
      for (const x of [x0, x1]) {
        const bar = c.createLinearGradient(x - 3, 0, x + 3, 0);
        bar.addColorStop(0, "rgba(240, 224, 200, 0.03)");
        bar.addColorStop(0.5, `rgba(240, 224, 200, ${preview ? 0.14 : 0.22})`);
        bar.addColorStop(1, "rgba(240, 224, 200, 0.03)");
        c.fillStyle = bar;
        c.fillRect(x - 2, rect.y + rect.height * 0.1, 4, rect.height * 0.75);
      }

      c.lineCap = "round";

      strings.forEach((line, i) => {
        const isHeld = held?.index === i && !preview;
        const lit = Math.min(1, line.glow * 0.75 + line.amplitude * 0.45);
        const hue = 26 + i * 3.5;

        const path = new Path2D();
        path.moveTo(x0, line.y);
        if (isHeld || Math.abs(line.push) > 0.5) {
          path.lineTo(x0 + span * 0.5, line.y + line.push);
          path.lineTo(x1, line.y);
        } else {
          const swing = line.amplitude * 12 * scale;
          const steps = preview ? 12 : 26;
          for (let s = 1; s <= steps; s++) {
            const along = s / steps;
            const wave = Math.sin(Math.PI * along) * Math.sin(line.phase);
            path.lineTo(x0 + span * along, line.y + wave * swing);
          }
        }

        c.strokeStyle = `hsla(${hue}, 80%, 58%, ${(0.05 + lit * 0.14) * scale})`;
        c.lineWidth = (line.thickness + 9 + lit * 10) * scale;
        c.stroke(path);

        // Wound strings: a bright core with a darker outline, which is what
        // makes them read as thick rather than just wide.
        c.strokeStyle = `hsla(${hue}, 30%, 14%, 0.9)`;
        c.lineWidth = (line.thickness + 1.6) * scale;
        c.stroke(path);
        c.strokeStyle = `hsla(${hue}, ${34 + lit * 34}%, ${52 + lit * 28}%, ${0.66 + lit * 0.3})`;
        c.lineWidth = line.thickness * scale;
        c.stroke(path);
        c.strokeStyle = `hsla(${hue + 14}, 90%, ${78 + lit * 14}%, ${0.14 + lit * 0.5})`;
        c.lineWidth = Math.max(0.7, line.thickness * 0.3) * scale;
        c.stroke(path);
      });
    },

    play,

    flourish(emit) {
      [0, 2].forEach((index, i) => {
        window.setTimeout(
          () => emit({ instrument: "guitar", index: Math.min(index, COUNT - 1), force: 0.5 }),
          i * 220,
        );
      });
    },

    retune() {
      const ladder = chordLadder(COUNT, LOWEST_HZ);
      strings.forEach((line, i) => {
        if (ladder[i]) line.hz = ladder[i];
      });
    },

    pointerDown(p, emit) {
      last = { x: p.x, y: p.y };
      const index = nearest(p.y);
      if (index === -1) return;
      held = { index, id: p.id };
      // Pressing one string sounds it at once; the push is the finger
      // displacing it on the way through.
      strings[index].push = 8;
      emit({
        instrument: "guitar",
        index,
        force: 0.62 + Math.random() * 0.2,
        at: (p.x - left()) / Math.max(1, right() - left()),
      });
    },

    pointerMove(p, _down, emit) {
      const previous = last;
      last = { x: p.x, y: p.y };
      if (!previous || held) return;
      // Dragging across them sounds each in turn: a strum, and how hard depends
      // on how fast the hand went through.
      const speed = Math.hypot(p.x - previous.x, p.y - previous.y);
      for (const index of crossed(previous.y, p.y)) {
        emit({
          instrument: "guitar",
          index,
          force: Math.min(0.7, 0.2 + speed / 110),
          at: (p.x - left()) / Math.max(1, right() - left()),
        });
      }
    },

    pointerUp() {
      held = null;
      last = null;
    },

    keyDown(key, shift, emit) {
      const slot = KEYS.indexOf(key);
      if (slot === -1 || slot >= strings.length) return false;
      emit({ instrument: "guitar", index: slot, force: shift ? 0.9 : 0.6 });
      return true;
    },

    keyHints() {
      return strings.map((line, i) => ({
        label: KEYS[i] ?? "",
        x: left() - 18,
        y: line.y,
      }));
    },

    keyUp() {},

    blur() {
      held = null;
      last = null;
    },
  };
}
