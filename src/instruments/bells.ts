// The bells: struck metal rings, hung in a row.
//
// The same struck-resonator synthesis as the marimba, with two numbers changed
// and everything following from them. The partials sit at 1 : 2.76 : 5.40 : 8.93
// — the Risset bell ratios, which are deliberately *not* whole-number multiples,
// and that inharmonicity is the entire difference between metal and wood. The
// decay is ten times longer, so bells overlap each other and the instrument
// accumulates into a chord as you play it.

import { chordLadder, playStruck } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 294;
const COUNT = 7;
const KEYS = "12345678";
/** Risset's bell, trimmed to four partials. */
const PARTIALS = [1, 2.76, 5.4, 8.93];

type Bell = {
  x: number;
  y: number;
  radius: number;
  hz: number;
  /** Swing about the hanger, in radians. */
  angle: number;
  velocity: number;
  /** Ring brightness, decaying slowly — bells stay lit a long time. */
  ring: number;
  /** Radial wobble of the rim, the visible mode of a struck bell. */
  wobble: number;
  phase: number;
};

export function makeBells(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let bells: Bell[] = [];

  const beamY = (): number => rect.y + rect.height * 0.16;

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    const slot = next.width / COUNT;
    const maxRadius = Math.min(slot * 0.36, next.height * 0.14);

    bells = ladder.map((hz, i) => {
      const scale = 1 - (i / COUNT) * 0.36;
      const kept = bells[i];
      return {
        x: next.x + slot * (i + 0.5),
        // Bigger, lower bells hang lower, so the row makes a curve.
        y: beamY() + next.height * (0.3 + (1 - scale) * 0.16),
        radius: maxRadius * scale,
        hz,
        angle: kept?.angle ?? 0,
        velocity: kept?.velocity ?? 0,
        ring: kept?.ring ?? 0,
        wobble: kept?.wobble ?? 0,
        phase: kept?.phase ?? Math.random() * Math.PI * 2,
      };
    });
  }

  function panFor(x: number): number {
    const across = (x - rect.x) / Math.max(1, rect.width);
    return Math.max(-1, Math.min(1, across * 1.7 - 0.85));
  }

  function play(note: Note): void {
    const bell = bells[note.index];
    if (!bell) return;
    const force = Math.min(1, Math.max(0.05, note.force));

    playStruck(bell.hz, {
      ratios: PARTIALS,
      // A soft strike barely wakes the upper partials; a hard one lights them
      // all. That is why a gentle bell sounds round and a hard one sounds harsh.
      gains: PARTIALS.map((_, i) => (i === 0 ? 1 : (0.42 - i * 0.08) * (0.35 + force * 0.75))),
      decay: 3.4 + force * 2.2,
      level: 0.075 + force * 0.2,
      pan: panFor(bell.x),
      noise: 0.1 + force * 0.22,
      damping: 0.38,
      channel: "bells",
    });

    bell.velocity += (Math.random() - 0.5) * 0.5 * (0.4 + force);
    bell.ring = Math.min(1, bell.ring * 0.5 + force);
    bell.wobble = Math.min(1, bell.wobble * 0.4 + force);
    bell.phase = 0;
  }

  return {
    id: "bells",
    name: "Bells",
    invitation: "Ring the bells",
    hint: "they hang on · play over the top of them",
    hue: 186,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const bell of bells) {
        // A damped pendulum, pulled back to hanging.
        bell.velocity += -bell.angle * 11 * dt;
        bell.velocity *= Math.exp(-dt * 1.3);
        bell.angle += bell.velocity * dt;
        // Bells hold their light far longer than the other instruments — it is
        // the visual counterpart of the long decay.
        bell.ring = Math.max(0, bell.ring - dt * 0.32);
        bell.wobble *= Math.exp(-dt * 2.4);
        bell.phase += dt * 26;
      }
    },

    draw(c, t, preview) {
      const scale = preview ? 0.6 : 1;
      const top = beamY();

      // The beam they hang from.
      c.strokeStyle = "rgba(214, 236, 244, 0.22)";
      c.lineWidth = 2 * scale;
      c.beginPath();
      c.moveTo(rect.x + rect.width * 0.06, top);
      c.lineTo(rect.x + rect.width * 0.94, top);
      c.stroke();

      for (const bell of bells) {
        const lit = Math.min(1, bell.ring);
        const hang = bell.y - top;
        const cx = bell.x + Math.sin(bell.angle) * hang;
        const cy = top + Math.cos(bell.angle) * hang;

        // The cord.
        c.strokeStyle = "rgba(214, 236, 244, 0.14)";
        c.lineWidth = 1 * scale;
        c.beginPath();
        c.moveTo(bell.x, top);
        c.lineTo(cx, cy);
        c.stroke();

        // The ring itself, drawn as an ellipse whose axes wobble in opposition
        // — the actual lowest vibration mode of a struck bell, and the reason a
        // ringing bell looks alive rather than lit.
        const breathe = Math.sin(bell.phase) * bell.wobble * 0.13;
        const rx = bell.radius * (1 + breathe) * (1 + Math.sin(t * 0.5) * 0.006);
        const ry = bell.radius * (1 - breathe);

        if (lit > 0.02) {
          const bloom = c.createRadialGradient(cx, cy, 0, cx, cy, bell.radius * 3.2);
          bloom.addColorStop(0, `hsla(188, 82%, 68%, ${lit * 0.22})`);
          bloom.addColorStop(1, "hsla(188, 82%, 68%, 0)");
          c.fillStyle = bloom;
          c.beginPath();
          c.arc(cx, cy, bell.radius * 3.2, 0, Math.PI * 2);
          c.fill();
        }

        // Metal: a bright top edge falling to a dark underside, plus a second
        // bounce of light from below. Two highlights is what reads as polished.
        const metal = c.createLinearGradient(cx, cy - ry, cx, cy + ry);
        metal.addColorStop(0, `hsla(190, ${34 + lit * 40}%, ${72 + lit * 22}%, 0.92)`);
        metal.addColorStop(0.45, `hsla(196, ${28 + lit * 30}%, ${40 + lit * 22}%, 0.9)`);
        metal.addColorStop(0.82, `hsla(200, 30%, ${22 + lit * 14}%, 0.9)`);
        metal.addColorStop(1, `hsla(186, ${30 + lit * 30}%, ${50 + lit * 22}%, 0.9)`);
        c.strokeStyle = metal;
        c.lineWidth = (bell.radius * 0.3 + lit * 2) * scale;
        c.beginPath();
        c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        c.stroke();

        // A hot inner line while it rings.
        if (lit > 0.03) {
          c.strokeStyle = `hsla(184, 96%, ${84 + lit * 12}%, ${lit * 0.6})`;
          c.lineWidth = 1 * scale;
          c.beginPath();
          c.ellipse(cx, cy, rx * 0.86, ry * 0.86, 0, 0, Math.PI * 2);
          c.stroke();
        }
      }
    },

    play,

    flourish(emit) {
      [0, 2, 4, 5].forEach((index, i) => {
        window.setTimeout(
          () =>
            emit({
              instrument: "bells",
              index: Math.min(index, bells.length - 1),
              force: 0.38,
            }),
          i * 165,
        );
      });
    },

    retune() {
      const ladder = chordLadder(COUNT, LOWEST_HZ);
      bells.forEach((bell, i) => {
        if (ladder[i]) bell.hz = ladder[i];
      });
    },

    pointerDown(p, emit) {
      bells.forEach((bell, i) => {
        const hang = bell.y - beamY();
        const cx = bell.x + Math.sin(bell.angle) * hang;
        const cy = beamY() + Math.cos(bell.angle) * hang;
        const distance = Math.hypot(p.x - cx, p.y - cy);
        // Generous: the ring is thin, and missing a bell you aimed at is worse
        // than occasionally ringing one you did not.
        if (distance > bell.radius * 1.35) return;
        emit({ instrument: "bells", index: i, force: 0.55 + Math.random() * 0.25 });
      });
    },

    pointerMove(p, down, emit) {
      if (!down) return;
      bells.forEach((bell, i) => {
        if (bell.ring > 0.6) return;
        const hang = bell.y - beamY();
        const cx = bell.x + Math.sin(bell.angle) * hang;
        const cy = beamY() + Math.cos(bell.angle) * hang;
        if (Math.hypot(p.x - cx, p.y - cy) > bell.radius * 1.2) return;
        emit({ instrument: "bells", index: i, force: 0.3 });
      });
    },

    pointerUp() {},

    keyDown(key, shift, emit) {
      const slot = KEYS.indexOf(key);
      if (slot === -1 || slot >= bells.length) return false;
      emit({ instrument: "bells", index: slot, force: shift ? 0.9 : 0.5 });
      return true;
    },

    keyHints() {
      return bells.map((bell, i) => ({
        label: KEYS[i] ?? "",
        x: bell.x,
        y: bell.y + bell.radius + 22,
      }));
    },

    keyUp() {},
    blur() {},
  };
}
