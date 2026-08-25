// What every instrument in the kit agrees to.
//
// The contract is deliberately narrow, and the important line in it is `play`.
// An instrument's input handlers never make a sound directly — they work out
// which note was asked for and hand it back, and something else decides whether
// to sound it, record it, or both. That is the only reason recording can be
// exact: playback calls the same `play` the player's own finger does, so a
// recording cannot drift out of step with live performance.

export type Rect = { x: number; y: number; width: number; height: number };

/** One event: this element of this instrument, struck this hard. */
export type Note = {
  instrument: string;
  /** Which string, bar, drum or bell. */
  index: number;
  /** 0..1. Moves loudness, brightness and how far the thing visibly moves. */
  force: number;
  /** Where along the element it was struck, 0..1. Changes timbre. */
  at?: number;
  /** Semitones of bend applied as it was sounded. */
  bend?: number;
};

/** How an instrument reports what a gesture asked for. */
export type Emit = (note: Note) => void;

export type Pointer = { x: number; y: number; id: number };

export type Instrument = {
  id: string;
  /** Shown under its card, and as the heading once it is open. */
  name: string;
  /** One line, shown when it opens. Has to invite the first sound. */
  invitation: string;
  /** Second line: the gesture, in as few words as possible. */
  hint: string;
  /** Hue that identifies it across the kit. */
  hue: number;
  /**
   * How many elements it is guaranteed to have, at any window size. A `Note`
   * whose index is past this is silently dropped by `play`, which is exactly the
   * kind of bug you would never hear — so anything writing notes by hand (the
   * example beat) is checked against it.
   */
  elements: number;

  /** Called whenever the rectangle it lives in changes — including every frame
   *  of the zoom transition, so it must be cheap. */
  layout(rect: Rect): void;

  /** Advance visual state. Never makes sound. */
  update(dt: number, t: number): void;

  /** Draw into its rect. `preview` means it is a card in the gallery: smaller,
   *  quieter, and not interactive. */
  draw(c: CanvasRenderingContext2D, t: number, preview: boolean): void;

  /** Sound and animate one note. The single path for live play and playback. */
  play(note: Note): void;

  /** A short flourish, played as the instrument opens, so the click that opened
   *  it is itself the first sound. */
  flourish(emit: Emit): void;

  /** Retune to the current chord. Called when the progression turns. */
  retune(): void;

  // Input. Only called while this instrument is open and settled.
  pointerDown(p: Pointer, emit: Emit): void;
  pointerMove(p: Pointer, down: boolean, emit: Emit): void;
  pointerUp(p: Pointer, emit: Emit): void;
  keyDown(key: string, shift: boolean, emit: Emit): boolean;
  keyUp(key: string, emit: Emit): void;
  /** Release any held state — called when the instrument closes or loses focus. */
  blur(): void;
};

/** Linear interpolation between two rectangles, for the open/close zoom. */
export function lerpRect(from: Rect, to: Rect, t: number): Rect {
  const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return {
    x: from.x + (to.x - from.x) * ease,
    y: from.y + (to.y - from.y) * ease,
    width: from.width + (to.width - from.width) * ease,
    height: from.height + (to.height - from.height) * ease,
  };
}

export function insideRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
