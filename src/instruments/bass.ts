// The bass: four thick strings, lying flat.
//
// This is the instrument the kit was missing. Drums give the loop its pulse but
// they are transients — they say *when* without saying *what*. Bass says both,
// and everything above it stops sounding like it is floating.
//
// Same Karplus–Strong as the harp with three things changed: an octave and a
// half lower, plucked much softer so the top end never arrives, and almost no
// reverb. Bass in a hall is mud, and that is a mixing decision the instrument
// has to make for the player rather than leave to them.

import { type PluckVoice, chordLadder, playPluck } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 49; // around a low G
const COUNT = 4;
const KEYS = "fghj";
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

export function makeBass(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let strings: StringLine[] = [];
  let held: { index: number; id: number } | null = null;
  let last: { x: number; y: number } | null = null;

  const left = (): number => rect.x + rect.width * 0.08;
  const right = (): number => rect.x + rect.width * 0.92;

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    const slot = (next.height * 0.62) / COUNT;
    strings = ladder.map((hz, i) => {
      const kept = strings[i];
      return {
        // Lowest at the bottom, thickest — as it would lie on an instrument.
        y: next.y + next.height * 0.78 - slot * i,
        hz,
        thickness: 5.5 - i * 0.9,
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
        // Deliberately soft even at full force. A hard, bright bass pluck fights
        // everything above it for the same space in the mix.
        hardness: 0.1 + force * 0.28,
        level: 0.16 + force * 0.42,
        pan: (note.at ?? 0.5) * 0.5 - 0.25,
        channel: "bass",
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
    id: "bass",
    name: "Bass",
    invitation: "Pluck the low strings",
    hint: "four notes · it holds everything else up",
    hue: 24,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const line of strings) {
        // Low strings visibly move slower, which is true and also reads well.
        const visualHz = 1.1 + Math.log2(line.hz / LOWEST_HZ) * 0.9;
        line.phase += dt * visualHz * Math.PI * 2;
        line.amplitude *= Math.exp(-dt * 1.15);
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
        const hue = 22 + i * 5;

        const path = new Path2D();
        path.moveTo(x0, line.y);
        if (isHeld || Math.abs(line.push) > 0.5) {
          path.lineTo(x0 + span * 0.5, line.y + line.push);
          path.lineTo(x1, line.y);
        } else {
          const swing = line.amplitude * 15 * scale;
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
          () => emit({ instrument: "bass", index: Math.min(index, COUNT - 1), force: 0.5 }),
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
      // A bass is plucked, not strummed: pressing sounds it straight away and
      // the push is the finger displacing it as it goes.
      strings[index].push = 8;
      emit({
        instrument: "bass",
        index,
        force: 0.62 + Math.random() * 0.2,
        at: (p.x - left()) / Math.max(1, right() - left()),
      });
    },

    pointerMove(p, _down, emit) {
      const previous = last;
      last = { x: p.x, y: p.y };
      if (!previous || held) return;
      // Dragging across them sounds each in turn — a walk up the strings.
      for (const index of crossed(previous.y, p.y)) {
        emit({
          instrument: "bass",
          index,
          force: 0.34,
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
      emit({ instrument: "bass", index: slot, force: shift ? 0.9 : 0.6 });
      return true;
    },

    keyUp() {},

    blur() {
      held = null;
      last = null;
    },
  };
}
