// The blocks: six small dry pitched knocks.
//
// The other half of what the kit was missing. Drums are big and boomy, so they
// can mark a beat but not subdivide one — hit them fast and they smear into each
// other. Blocks are almost pure transient: nothing sustains, so they can carry
// the fast, fussy rhythm a loop needs to feel like it is going somewhere, and
// they sit in a frequency band nothing else is using.
//
// Same struck synthesis as the marimba, with harmonically-unrelated partials, a
// decay measured in tenths of a second, and a lot of mallet noise.

import { chordLadder, playStruck } from "../audio.ts";
import type { Instrument, Note, Rect } from "../kit.ts";

const LOWEST_HZ = 392;
const COUNT = 6;
const KEYS = "nm,./";

type Block = {
  x: number;
  y: number;
  width: number;
  height: number;
  hz: number;
  /** Squash after being hit — very fast, like the sound. */
  squash: number;
  glow: number;
  /** Small rotation kick, so repeated hits do not look identical either. */
  tilt: number;
};

export function makeBlocks(): Instrument {
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let blocks: Block[] = [];

  function layout(next: Rect): void {
    rect = next;
    const ladder = chordLadder(COUNT, LOWEST_HZ);
    // Two rows of three: a hand-percussion layout, reachable rather than a
    // keyboard you have to travel along.
    const columns = 3;
    const rows = Math.ceil(COUNT / columns);
    const gap = Math.min(next.width, next.height) * 0.05;
    const cellWidth = (next.width * 0.7 - gap * (columns - 1)) / columns;
    const cellHeight = (next.height * 0.5 - gap * (rows - 1)) / rows;
    const startX = next.x + (next.width - (cellWidth * columns + gap * (columns - 1))) / 2;
    const startY = next.y + (next.height - (cellHeight * rows + gap * (rows - 1))) / 2;

    blocks = ladder.map((hz, i) => {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const kept = blocks[i];
      // Higher blocks are smaller, as they would be.
      const shrink = 1 - (i / COUNT) * 0.22;
      return {
        x: startX + column * (cellWidth + gap) + (cellWidth * (1 - shrink)) / 2,
        y: startY + row * (cellHeight + gap) + (cellHeight * (1 - shrink)) / 2,
        width: cellWidth * shrink,
        height: cellHeight * shrink,
        hz,
        squash: kept?.squash ?? 0,
        glow: kept?.glow ?? 0,
        tilt: kept?.tilt ?? 0,
      };
    });
  }

  function panFor(block: Block): number {
    const across = (block.x + block.width / 2 - rect.x) / Math.max(1, rect.width);
    return Math.max(-1, Math.min(1, across * 1.6 - 0.8));
  }

  function play(note: Note): void {
    const block = blocks[note.index];
    if (!block) return;
    const force = Math.min(1, Math.max(0.05, note.force));

    playStruck(block.hz, {
      // Deliberately unmusical ratios: a block has a pitch you can hear but no
      // real harmonic series, which is why it cuts through without adding
      // anything to the harmony.
      ratios: [1, 2.41, 4.17],
      gains: [1, 0.3 + force * 0.22, 0.12],
      decay: 0.16 + force * 0.12,
      level: 0.11 + force * 0.26,
      pan: panFor(block),
      noise: 0.45 + force * 0.4,
      damping: 0.9,
      channel: "blocks",
    });

    block.squash = Math.min(1, block.squash * 0.3 + force);
    block.glow = 1;
    block.tilt = (Math.random() - 0.5) * 0.08 * force;
  }

  return {
    id: "blocks",
    name: "Blocks",
    invitation: "Knock on the blocks",
    hint: "dry and quick · this is where the groove goes",
    hue: 42,
    // The narrowest window still gives this many.
    elements: COUNT,

    layout,

    update(dt) {
      for (const block of blocks) {
        block.squash *= Math.exp(-dt * 14);
        block.glow = Math.max(0, block.glow - dt * 5.5);
        block.tilt *= Math.exp(-dt * 7);
      }
    },

    draw(c, _t, preview) {
      const scale = preview ? 0.6 : 1;

      for (const block of blocks) {
        const lit = Math.min(1, block.glow);
        // Squash and stretch. On something this short it is the only way the eye
        // registers a hit at all.
        const squash = 1 - block.squash * 0.09;
        const w = block.width * (2 - squash);
        const h = block.height * squash;
        const cx = block.x + block.width / 2;
        const cy = block.y + block.height / 2;
        const radius = Math.min(w, h) * 0.22;

        c.save();
        c.translate(cx, cy);
        c.rotate(block.tilt);

        const wood = c.createLinearGradient(0, -h / 2, 0, h / 2);
        wood.addColorStop(0, `hsla(${38 + lit * 8}, ${34 + lit * 26}%, ${44 + lit * 26}%, 0.96)`);
        wood.addColorStop(0.6, `hsla(${30 + lit * 6}, ${36 + lit * 20}%, ${26 + lit * 18}%, 0.96)`);
        wood.addColorStop(1, "hsla(26, 40%, 15%, 0.96)");
        c.fillStyle = wood;
        c.beginPath();
        c.roundRect(-w / 2, -h / 2, w, h, radius);
        c.fill();

        // The slot cut in a woodblock — the reason it has a pitch at all.
        c.strokeStyle = `hsla(24, 44%, ${11 + lit * 6}%, 0.85)`;
        c.lineWidth = Math.max(2, h * 0.1) * scale;
        c.beginPath();
        c.moveTo(-w * 0.3, 0);
        c.lineTo(w * 0.3, 0);
        c.stroke();

        c.strokeStyle = `hsla(46, ${40 + lit * 34}%, ${56 + lit * 32}%, ${0.22 + lit * 0.6})`;
        c.lineWidth = (1.1 + lit * 1.4) * scale;
        c.beginPath();
        c.roundRect(-w / 2, -h / 2, w, h, radius);
        c.stroke();
        c.restore();

        if (lit > 0.02) {
          const bloom = c.createRadialGradient(cx, cy, 0, cx, cy, block.width * 1.1);
          bloom.addColorStop(0, `hsla(44, 92%, 66%, ${lit * 0.26})`);
          bloom.addColorStop(1, "hsla(44, 92%, 66%, 0)");
          c.fillStyle = bloom;
          c.beginPath();
          c.arc(cx, cy, block.width * 1.1, 0, Math.PI * 2);
          c.fill();
        }
      }
    },

    play,

    flourish(emit) {
      [0, 3, 1, 4, 2].forEach((index, i) => {
        window.setTimeout(
          () => emit({ instrument: "blocks", index: Math.min(index, COUNT - 1), force: 0.45 }),
          i * 88,
        );
      });
    },

    retune() {
      const ladder = chordLadder(COUNT, LOWEST_HZ);
      blocks.forEach((block, i) => {
        if (ladder[i]) block.hz = ladder[i];
      });
    },

    pointerDown(p, emit) {
      blocks.forEach((block, i) => {
        if (p.x < block.x || p.x > block.x + block.width) return;
        if (p.y < block.y || p.y > block.y + block.height) return;
        emit({ instrument: "blocks", index: i, force: 0.6 + Math.random() * 0.25 });
      });
    },

    pointerMove(p, down, emit) {
      if (!down) return;
      blocks.forEach((block, i) => {
        if (block.glow > 0.4) return;
        if (p.x < block.x || p.x > block.x + block.width) return;
        if (p.y < block.y || p.y > block.y + block.height) return;
        emit({ instrument: "blocks", index: i, force: 0.36 });
      });
    },

    pointerUp() {},

    keyDown(key, shift, emit) {
      const slot = KEYS.indexOf(key);
      if (slot === -1 || slot >= blocks.length) return false;
      emit({ instrument: "blocks", index: slot, force: shift ? 0.92 : 0.6 + Math.random() * 0.2 });
      return true;
    },

    keyHints() {
      return blocks.map((block, i) => ({
        label: KEYS[i] ?? "",
        x: block.x + block.width / 2,
        y: block.y + block.height + 16,
      }));
    },

    keyUp() {},
    blur() {},
  };
}
