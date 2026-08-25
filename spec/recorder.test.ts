// The loop recorder. Wrap-around windows are the classic place for a sequencer
// to drop or double-fire a note, and neither is something you would reliably
// catch by ear over four instruments — so it is checked here instead.

import { describe, expect, it } from "vitest";
import type { Note } from "../src/kit.ts";
import { LOOP_SECONDS, makeRecorder } from "../src/recorder.ts";

function note(index = 0): Note {
  return { instrument: "harp", index, force: 0.5 };
}

/** Run the loop forward in fixed steps, collecting everything it sounds. */
function run(
  recorder: ReturnType<typeof makeRecorder>,
  seconds: number,
  step = 1 / 60,
): Note[] {
  const heard: Note[] = [];
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    recorder.advance(step, (n) => heard.push(n));
  }
  return heard;
}

describe("recorder", () => {
  it("ignores notes when it is not recording", () => {
    const recorder = makeRecorder();
    recorder.capture(note());
    expect(recorder.isEmpty()).toBe(true);
    recorder.play();
    // Nothing to play, so it must not start.
    expect(recorder.state()).toBe("idle");
  });

  it("captures while recording and plays back once per lap", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note(3));
    expect(recorder.events()).toHaveLength(1);

    // Two full laps: the note should come back exactly twice.
    const heard = run(recorder, LOOP_SECONDS * 2);
    expect(heard).toHaveLength(2);
    expect(heard[0].index).toBe(3);
  });

  it("fires a note recorded at the very end of the loop", () => {
    // The wrap is walked in two pieces; a note in the last few milliseconds is
    // the one a single-window implementation loses. Advanced in exact steps
    // rather than a frame loop, so the position is where the test says it is.
    const recorder = makeRecorder();
    recorder.record();
    recorder.advance(LOOP_SECONDS - 0.02, () => {});
    recorder.capture(note(7));
    expect(recorder.events()[0].at).toBeCloseTo(LOOP_SECONDS - 0.02, 5);

    // One step straddling the loop point: the note is behind the playhead in the
    // old lap, so it must be caught by the first half of the split window.
    const heard: Note[] = [];
    recorder.advance(0.05, (n) => heard.push(n));
    expect(heard.map((n) => n.index)).toEqual([7]);
    expect(recorder.position()).toBeCloseTo(0.03, 5);
  });

  it("never fires the same note twice in one lap", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note(1));
    recorder.capture(note(2));
    // Deliberately lumpy steps, including ones far larger than the gap between
    // the notes, to make sure the window arithmetic never overlaps itself. They
    // sum to less than one lap, so each note is owed exactly one hearing.
    const steps = [0.4, 1.9, 0.05, 3.2, 2.0];
    expect(steps.reduce((a, b) => a + b, 0)).toBeLessThan(LOOP_SECONDS);
    const heard: Note[] = [];
    for (const step of steps) {
      recorder.advance(step, (n) => heard.push(n));
    }
    expect(heard).toHaveLength(2);
  });

  it("overdubs: a second pass adds to the take rather than replacing it", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note(1));
    run(recorder, 2);
    recorder.capture(note(2));
    expect(recorder.events()).toHaveLength(2);
    // And the two sit at different points in the loop.
    expect(recorder.events()[1].at).toBeGreaterThan(recorder.events()[0].at);
  });

  it("keeps playing the existing take while recording over it", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note(1));
    run(recorder, LOOP_SECONDS + 0.2);
    // Still recording, and the first note has come round again.
    expect(recorder.state()).toBe("recording");
  });

  it("stop rewinds and clear empties", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note());
    run(recorder, 2);
    expect(recorder.position()).toBeGreaterThan(1);

    recorder.stop();
    expect(recorder.state()).toBe("idle");
    expect(recorder.position()).toBe(0);
    expect(recorder.isEmpty()).toBe(false);

    recorder.clear();
    expect(recorder.isEmpty()).toBe(true);
    expect(run(recorder, LOOP_SECONDS)).toEqual([]);
  });

  it("does nothing at all while idle", () => {
    const recorder = makeRecorder();
    recorder.record();
    recorder.capture(note());
    recorder.stop();
    expect(run(recorder, LOOP_SECONDS)).toEqual([]);
  });
});
