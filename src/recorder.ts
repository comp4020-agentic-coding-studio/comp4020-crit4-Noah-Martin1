// The loop recorder.
//
// It records gestures, not audio. A take is a list of (time, note) pairs, and
// playing it back means calling the same `play` the player's finger calls. That
// makes a recording weigh almost nothing, keeps it perfectly in tune when the
// chord turns underneath it, and means a played-back note is indistinguishable
// from a live one because it *is* one.
//
// One fixed loop, no metronome and no quantising. Quantising would be the
// instrument telling the player they were wrong about when the beat was, and
// nothing here is allowed to do that.

import type { Note } from "./kit.ts";

export const LOOP_SECONDS = 8;

export type Event = { at: number; note: Note };

export type Transport = "idle" | "playing" | "recording";

export type Recorder = {
  state: () => Transport;
  /** Position in the loop, 0..LOOP_SECONDS. */
  position: () => number;
  events: () => readonly Event[];
  /** Where the loop is currently reading from — for the playhead. */
  isEmpty: () => boolean;

  /** Start recording. Any existing take keeps playing underneath, so a second
   *  pass overdubs rather than replacing. */
  record: () => void;
  play: () => void;
  stop: () => void;
  clear: () => void;

  /** Capture a note that was just played live. Ignored unless recording. */
  capture: (note: Note) => void;

  /** Replace the take with a prepared one and play it from the top. */
  load: (events: Event[]) => void;

  /**
   * Advance the loop, sounding anything the playhead crossed.
   * `sound` is called for each due note — the caller routes it to the right
   * instrument, which may not be the one currently on screen.
   */
  advance: (dt: number, sound: (note: Note) => void) => void;
};

export function makeRecorder(): Recorder {
  let events: Event[] = [];
  let transport: Transport = "idle";
  let position = 0;

  function begin(next: Transport): void {
    if (transport === "idle") position = 0;
    transport = next;
  }

  return {
    state: () => transport,
    position: () => position,
    events: () => events,
    isEmpty: () => events.length === 0,

    record() {
      begin("recording");
    },

    play() {
      if (events.length === 0) return;
      begin("playing");
    },

    stop() {
      transport = "idle";
      position = 0;
    },

    clear() {
      events = [];
      transport = "idle";
      position = 0;
    },

    capture(note) {
      if (transport !== "recording") return;
      events.push({ at: position, note });
    },

    load(prepared) {
      // Copied, not aliased: the loaded take is then just an ordinary
      // recording, and the player can overdub on top of it or clear it.
      events = prepared.map((event) => ({ at: event.at, note: { ...event.note } }));
      position = 0;
      transport = "playing";
    },

    advance(dt, sound) {
      if (transport === "idle") return;
      const from = position;
      let to = from + dt;

      // A note recorded at almost exactly the loop point must not be missed on
      // the wrap, so the window is walked in two pieces rather than one.
      const fire = (start: number, end: number): void => {
        for (const event of events) {
          if (event.at >= start && event.at < end) sound(event.note);
        }
      };

      if (to >= LOOP_SECONDS) {
        fire(from, LOOP_SECONDS);
        to -= LOOP_SECONDS;
        fire(0, to);
      } else {
        fire(from, to);
      }
      position = to;
    },
  };
}
