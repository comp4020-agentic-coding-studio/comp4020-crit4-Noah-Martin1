// The stage: the kit laid out as cards, one instrument opened at a time, and a
// loop running underneath all of it.
//
// Two ideas hold this together.
//
// Every instrument draws into a rectangle it is handed, which means opening one
// is just a matter of interpolating that rectangle from its card to the whole
// window. There is no separate "preview" drawing and no second code path to
// keep in step — the card *is* the instrument, small.
//
// And the recorder plays notes by calling the same `play` a finger calls, so a
// loop keeps sounding while you browse, lights up the cards of instruments that
// are not open, and stays in tune when the chord turns under it.

import { makeAtmosphere } from "./atmosphere.ts";
import {
  chordRevision,
  configureChannel,
  isMuted,
  setPadEnabled,
  toggleMuted,
  wake,
} from "./audio.ts";
import { need } from "./dom.ts";
import { makeGuitar } from "./instruments/guitar.ts";
import { makeBells } from "./instruments/bells.ts";
import { makeBlocks } from "./instruments/blocks.ts";
import { makeDrum } from "./instruments/drum.ts";
import { makeHarp } from "./instruments/harp.ts";
import { makeMarimba } from "./instruments/marimba.ts";
import { demoLoop } from "./demo.ts";
import { type Instrument, type Note, type Rect, insideRect, lerpRect } from "./kit.ts";
import { LOOP_SECONDS, makeRecorder } from "./recorder.ts";

const OPEN_SECONDS = 0.5;
/** Air between the top bar and the loop timeline drawn under it. */
const LOOP_GAP = 14;

type Mode = "gallery" | "opening" | "open" | "closing";

export function start(): void {
  const canvas = need(document.querySelector<HTMLCanvasElement>("#stage"), "#stage canvas");
  const c = need(canvas.getContext("2d"), "2d context");
  const invitation = document.querySelector<HTMLElement>("#invitation");
  const invitationTitle = document.querySelector<HTMLElement>("#invitation p");
  const invitationHint = document.querySelector<HTMLElement>("#invitation small");
  const nowPlaying = document.querySelector<HTMLElement>("#now-playing");
  const keyLegend = document.querySelector<HTMLElement>("#instrument-keys");
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-instrument]")];
  const topBar = document.querySelector<HTMLElement>(".bar--top");
  const bottomBar = document.querySelector<HTMLElement>(".bar--bottom");
  const transport = document.querySelector<HTMLElement>("#transport");
  const backButton = document.querySelector<HTMLButtonElement>("#back");
  const recordButton = document.querySelector<HTMLButtonElement>("#record");
  const playButton = document.querySelector<HTMLButtonElement>("#play");
  const clearButton = document.querySelector<HTMLButtonElement>("#clear");
  const demoButton = document.querySelector<HTMLButtonElement>("#demo");
  const muteButton = document.querySelector<HTMLButtonElement>("#mute");

  // A harp does not want a drone sitting under every note.
  setPadEnabled(false);

  // Where each instrument stands. This is the mix, and it is the difference
  // between six instruments in six rooms and six instruments in a heap:
  // percussion close and dry, bells at the far end of a hall, bass with almost
  // no reverb at all because low frequencies in a long tail are just mud.
  configureChannel("harp", {
    dry: 0.9,
    room: 0.34,
    hall: 0.26,
    // The box the strings are mounted on.
    body: [
      [104, 7, 0.42],
      [217, 9, 0.3],
      [420, 4, 0.16],
    ],
  });
  // A guitar's box: the Helmholtz note of the air inside it, the top plate, and
  // one above that. A plucked string with no body is a rubber band, and this is
  // most of the rest of the difference.
  configureChannel("guitar", {
    dry: 1,
    room: 0.2,
    hall: 0.05,
    body: [
      [104, 8, 0.4],
      [201, 7, 0.3],
      [415, 5, 0.15],
    ],
  });
  configureChannel("marimba", { dry: 1, room: 0.26, hall: 0.05 });
  configureChannel("drum", { dry: 1, room: 0.2, hall: 0.03 });
  configureChannel("blocks", { dry: 1, room: 0.28, hall: 0.04 });
  configureChannel("bells", { dry: 0.66, room: 0.18, hall: 0.66 });

  const instruments: Instrument[] = [
    makeHarp(),
    makeGuitar(),
    makeMarimba(),
    makeBlocks(),
    makeDrum(),
    makeBells(),
  ];
  const byId = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const recorder = makeRecorder();
  const atmosphere = makeAtmosphere();

  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = 1;
  let started = false;
  let revision = chordRevision();

  let mode: Mode = "gallery";
  let active = -1;
  let progress = 0;
  let hovered = -1;
  let cards: Rect[] = [];
  /**
   * How much room the HTML bars take, measured rather than assumed. Hard-coded
   * numbers here are how the loop timeline came to be drawn straight through the
   * title and the buttons: the CSS moved and the canvas did not know.
   */
  let headroom = 76;
  let footer = 88;
  let loopY = 58;
  /** Pointers currently pressed, so instruments can tell a drag from a hover. */
  const pressed = new Set<number>();
  /** Recent activity per instrument, so a card visibly answers when its part
   *  fires — this is what makes a loop legible while you are looking at all six
   *  of them rather than playing one. */
  const activity = new Map<string, number>();
  /** Fades the on-screen key labels from prominent to merely legible. */
  let hintFade = 0;
  /** Whether this instrument's opening line is still on screen. */
  let inviting = false;

  // --- layout ----------------------------------------------------------------

  /** Read the bars' real heights and keep everything the canvas draws clear of
   *  them. Called on resize, and whenever the bars' contents change. */
  function measureChrome(): void {
    const top = topBar?.getBoundingClientRect().height ?? 44;
    const bottom = bottomBar?.getBoundingClientRect().height ?? 80;
    loopY = top + LOOP_GAP;
    // The timeline sits below the bar, and the instruments below the timeline.
    headroom = loopY + 16;
    footer = bottom + 8;
  }

  function fullRect(): Rect {
    return { x: 0, y: headroom, width, height: height - headroom - footer };
  }

  function layout(): void {
    const columns = width < 620 ? 1 : width < 1080 ? 2 : 3;
    const rows = Math.ceil(instruments.length / columns);
    const outer = Math.min(46, width * 0.05);
    const gap = Math.min(30, width * 0.028);
    const usableWidth = width - outer * 2 - gap * (columns - 1);
    const usableHeight = height - headroom - footer - outer * 2 - gap * (rows - 1);
    const cardWidth = usableWidth / columns;
    const cardHeight = usableHeight / rows;

    cards = instruments.map((_, i) => ({
      x: outer + (i % columns) * (cardWidth + gap),
      y: headroom + outer + Math.floor(i / columns) * (cardHeight + gap),
      width: cardWidth,
      // The label sits inside the card, below the instrument.
      height: cardHeight,
    }));

    instruments.forEach((instrument, i) => {
      if (i === active && mode !== "gallery") return;
      instrument.layout(instrumentRectFor(i));
    });
    if (active >= 0 && mode === "open") instruments[active].layout(fullRect());
  }

  /** The part of a card the instrument itself draws into. */
  function instrumentRectFor(index: number): Rect {
    const card = cards[index];
    if (!card) return fullRect();
    return { x: card.x, y: card.y, width: card.width, height: card.height - 34 };
  }

  // --- sounding --------------------------------------------------------------

  /** Live play: sound it, and record it if we are recording. */
  function emit(note: Note): void {
    // Playing is the answer to the instrument's invitation, so the invitation
    // goes. `firstGesture` cannot do this: by the time an instrument is open the
    // session has long since started.
    if (inviting) {
      inviting = false;
      invitation?.classList.add("gone");
    }
    sound(note);
    recorder.capture(note);
  }

  /** Playback and flourishes: sound only, never captured. */
  function sound(note: Note): void {
    byId.get(note.instrument)?.play(note);
    activity.set(note.instrument, Math.min(1, (activity.get(note.instrument) ?? 0) + note.force));
  }

  // --- opening and closing ---------------------------------------------------

  function open(index: number): void {
    if (mode !== "gallery" || !instruments[index]) return;
    active = index;
    mode = "opening";
    progress = 0;
    const instrument = instruments[index];
    invitation?.classList.remove("gone");
    inviting = true;
    hintFade = 1;
    if (invitationTitle) invitationTitle.textContent = instrument.invitation;
    if (invitationHint) invitationHint.textContent = instrument.hint;
    if (nowPlaying) nowPlaying.textContent = instrument.name;
    if (keyLegend) {
      const keys = instrument
        .keyHints()
        .map((hint) => hint.label)
        .filter(Boolean);
      keyLegend.textContent = keys.length ? `keys ${keys.join(" ")}` : "";
    }
    document.body.dataset.mode = "open";
    markNav();
    // The bar just gained the instrument's name and key row, which may have
    // wrapped it onto a second line.
    measureChrome();
    layout();
    // The click that opens an instrument is itself the first sound.
    instrument.flourish(sound);
  }

  /** Keeps the nav in step with what is open, for anyone reading it rather than
   *  looking at the cards. */
  function markNav(): void {
    navLinks.forEach((link, i) => {
      if (i === active && mode !== "gallery") link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  function close(): void {
    if (mode !== "open") return;
    instruments[active]?.blur();
    mode = "closing";
    progress = 0;
    invitation?.classList.add("gone");
    inviting = false;
    document.body.dataset.mode = "gallery";
    if (nowPlaying) nowPlaying.textContent = "";
    if (keyLegend) keyLegend.textContent = "";
    markNav();
    measureChrome();
  }

  // --- input -----------------------------------------------------------------

  function firstGesture(): void {
    wake();
    if (started) return;
    started = true;
    invitation?.classList.add("gone");
  }

  function localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (event) => {
    firstGesture();
    canvas.setPointerCapture(event.pointerId);
    pressed.add(event.pointerId);
    const point = localPoint(event);

    if (mode === "gallery") {
      const index = cards.findIndex((card) => insideRect(card, point.x, point.y));
      if (index !== -1) open(index);
      return;
    }
    if (mode !== "open") return;
    instruments[active].pointerDown({ ...point, id: event.pointerId }, emit);
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = localPoint(event);

    if (mode === "gallery") {
      hovered = cards.findIndex((card) => insideRect(card, point.x, point.y));
      canvas.style.cursor = hovered === -1 ? "default" : "pointer";
      return;
    }
    if (mode !== "open") return;
    // A hover with nothing pressed is a real gesture on the harp — it brushes
    // the strings — so it is passed through, with `down` telling the instrument
    // which it is.
    instruments[active].pointerMove(
      { ...point, id: event.pointerId },
      pressed.has(event.pointerId),
      emit,
    );
  });

  function endPointer(event: PointerEvent): void {
    pressed.delete(event.pointerId);
    if (mode !== "open") return;
    instruments[active].pointerUp({ ...localPoint(event), id: event.pointerId }, emit);
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (event) => {
    pressed.delete(event.pointerId);
    hovered = -1;
    if (mode === "open") instruments[active].blur();
  });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();

    // Mute is "0", not "m": the blocks instrument uses m as one of its keys, and
    // a global shortcut that steals a note from an open instrument is worse than
    // an unusual one.
    if (key === "0") {
      firstGesture();
      applyMute(toggleMuted());
      return;
    }

    if (event.key === "Escape") {
      firstGesture();
      close();
      return;
    }

    if (event.code === "Space") {
      // Space is the transport, everywhere. An instrument that wanted space for
      // itself would be fighting the one control that has to be reachable.
      event.preventDefault();
      if (event.repeat) return;
      firstGesture();
      toggleRecord();
      return;
    }

    if (mode === "gallery") {
      // Number keys open instruments, so the kit is reachable without a pointer.
      const slot = Number.parseInt(event.key, 10);
      if (slot >= 1 && slot <= Math.min(9, instruments.length)) {
        firstGesture();
        open(slot - 1);
      }
      return;
    }

    // Playable as soon as it starts opening: waiting out the half-second zoom
    // before the keyboard works feels like the page ignoring you.
    if (mode !== "open" && mode !== "opening") return;
    firstGesture();
    // Single characters arrive lowercased; named keys ("ArrowUp") as they are.
    const token = event.key.length === 1 ? key : event.key;
    if (instruments[active].keyDown(token, event.shiftKey, emit)) event.preventDefault();
  });

  window.addEventListener("keyup", (event) => {
    if (mode !== "open") return;
    instruments[active].keyUp(event.key.length === 1 ? event.key.toLowerCase() : event.key, emit);
  });

  window.addEventListener("blur", () => {
    pressed.clear();
    if (mode === "open") instruments[active].blur();
  });

  // --- transport -------------------------------------------------------------

  /** Buttons keep focus after a click, and then space activates them again as
   *  well as reaching the transport. Handing focus back stops the double-fire. */
  function release(event: Event): void {
    (event.currentTarget as HTMLElement | null)?.blur();
  }

  function applyMute(nowMuted: boolean): void {
    if (!muteButton) return;
    muteButton.setAttribute("aria-pressed", String(nowMuted));
    muteButton.textContent = nowMuted ? "sound off" : "sound on";
  }

  function toggleRecord(): void {
    if (recorder.state() !== "recording") {
      recorder.record();
    } else if (recorder.isEmpty()) {
      // Nothing was played this pass. `play` refuses an empty take, so without
      // this the transport would sit stuck on "recording".
      recorder.stop();
    } else {
      recorder.play();
    }
    refreshTransport();
  }

  function refreshTransport(): void {
    const state = recorder.state();
    recordButton?.setAttribute("aria-pressed", String(state === "recording"));
    if (recordButton) {
      recordButton.textContent = state === "recording" ? "recording" : "record";
    }
    if (playButton) {
      playButton.textContent = state === "playing" ? "playing" : "play";
      playButton.disabled = recorder.isEmpty();
      playButton.setAttribute("aria-pressed", String(state === "playing"));
    }
    if (clearButton) clearButton.disabled = recorder.isEmpty();
    transport?.setAttribute("data-state", state);
  }

  recordButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    toggleRecord();
  });

  playButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    // Playing → stop. Anything else, including mid-record, → play: leaving a
    // recording running when you asked to hear it back would be a trap.
    if (recorder.state() === "playing") recorder.stop();
    else recorder.play();
    refreshTransport();
  });

  demoButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    recorder.load(demoLoop());
    refreshTransport();
  });

  clearButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    recorder.clear();
    refreshTransport();
  });

  backButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    close();
  });

  // The gallery cards live on a canvas, which a keyboard and a screen reader
  // cannot reach. These links are the accessible way in, so they have to do
  // exactly what clicking a card does.
  for (const [index, link] of navLinks.entries()) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      link.blur();
      firstGesture();
      if (mode === "open" && active === index) close();
      else if (mode === "open") {
        // Straight from one instrument to another, without a trip through the
        // gallery: closing first would swallow the click.
        instruments[active].blur();
        mode = "gallery";
        active = -1;
        layout();
        open(index);
      } else {
        open(index);
      }
    });
  }

  muteButton?.addEventListener("click", (event) => {
    release(event);
    firstGesture();
    applyMute(toggleMuted());
  });

  // --- drawing ---------------------------------------------------------------

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    atmosphere.resize(width, height);
    measureChrome();
    layout();
  }

  function drawBackground(t: number): void {
    const sky = c.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#0a0910");
    sky.addColorStop(0.6, "#0d0b14");
    sky.addColorStop(1, "#070609");
    c.fillStyle = sky;
    c.fillRect(0, 0, width, height);

    // A slow warm bloom low in the frame — a floor for the instruments to stand
    // on, so the black does not read as empty.
    const hue = active >= 0 ? instruments[active].hue : 34;

    // Drifting haze and dust, so the page is never actually still.
    atmosphere.draw(c, t, hue);

    const glowY = height * 0.78;
    const bloom = c.createRadialGradient(width / 2, glowY, 0, width / 2, glowY, width * 0.7);
    bloom.addColorStop(0, `hsla(${hue}, 68%, 44%, ${0.1 + 0.022 * Math.sin(t * 0.35)})`);
    bloom.addColorStop(1, `hsla(${hue}, 68%, 40%, 0)`);
    c.fillStyle = bloom;
    c.fillRect(0, 0, width, height);
  }

  function drawCardFrame(index: number, alpha: number): void {
    const card = cards[index];
    const instrument = instruments[index];
    const playing = activity.get(instrument.id) ?? 0;
    const lit = Math.min(1, (hovered === index ? 1 : 0) + playing * 0.85);

    c.save();
    c.globalAlpha = alpha;

    const radius = 14;
    c.beginPath();
    c.roundRect(card.x, card.y, card.width, card.height, radius);
    c.fillStyle = `hsla(${instrument.hue}, 30%, 12%, ${0.34 + lit * 0.16})`;
    c.fill();
    c.strokeStyle = `hsla(${instrument.hue}, ${40 + lit * 30}%, ${44 + lit * 26}%, ${
      0.18 + lit * 0.4
    })`;
    c.lineWidth = 1;
    c.stroke();

    c.fillStyle = `hsla(${instrument.hue}, 24%, ${68 + lit * 22}%, ${0.5 + lit * 0.4})`;
    c.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    // The number is the keyboard shortcut, so the label teaches the shortcut.
    c.letterSpacing = "0.14em";
    c.fillText(
      `${index + 1} · ${instrument.name.toUpperCase()}`,
      card.x + card.width / 2,
      card.y + card.height - 17,
    );
    c.letterSpacing = "0px";
    c.restore();
  }

  /**
   * The playing keys, written on the instrument. Bright when it opens and then
   * settling back to something you can still read — the way fret markers are
   * always there without ever being the point.
   */
  function drawKeyHints(instrument: Instrument): void {
    const alpha = 0.32 + hintFade * 0.5;
    c.font = "500 10.5px ui-sans-serif, system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";

    for (const { label, x, y } of instrument.keyHints()) {
      if (!label) continue;
      const text = label.toUpperCase();
      const w = Math.max(16, c.measureText(text).width + 11);
      c.fillStyle = `hsla(${instrument.hue}, 24%, 8%, ${alpha * 0.72})`;
      c.beginPath();
      c.roundRect(x - w / 2, y - 8, w, 16, 5);
      c.fill();
      c.strokeStyle = `hsla(${instrument.hue}, 34%, 62%, ${alpha * 0.4})`;
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = `hsla(${instrument.hue}, 26%, 88%, ${alpha})`;
      c.fillText(text, x, y + 0.5);
    }
  }

  /** The loop, as a line across the top with a mark for every note in it. */
  function drawLoop(): void {
    const state = recorder.state();
    if (state === "idle" && recorder.isEmpty()) return;

    const y = loopY;
    const left = 26;
    const right = width - 26;
    const span = right - left;

    c.strokeStyle = "rgba(240, 230, 216, 0.1)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(left, y);
    c.lineTo(right, y);
    c.stroke();

    for (const event of recorder.events()) {
      const instrument = byId.get(event.note.instrument);
      const x = left + (event.at / LOOP_SECONDS) * span;
      const height = 3 + event.note.force * 7;
      c.strokeStyle = `hsla(${instrument?.hue ?? 34}, 70%, 62%, 0.62)`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, y - height / 2);
      c.lineTo(x, y + height / 2);
      c.stroke();
    }

    if (state !== "idle") {
      const x = left + (recorder.position() / LOOP_SECONDS) * span;
      const colour = state === "recording" ? "hsla(4, 88%, 62%, 0.9)" : "rgba(240, 230, 216, 0.7)";
      c.strokeStyle = colour;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x, y - 9);
      c.lineTo(x, y + 9);
      c.stroke();
      c.fillStyle = colour;
      c.beginPath();
      c.arc(x, y, 2.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  let lastFrame = performance.now();

  function frame(nowMs: number): void {
    const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
    lastFrame = nowMs;
    const t = nowMs / 1000;

    if (chordRevision() !== revision) {
      revision = chordRevision();
      for (const instrument of instruments) instrument.retune();
    }

    recorder.advance(dt, sound);

    if (mode === "opening" || mode === "closing") {
      progress = Math.min(1, progress + dt / OPEN_SECONDS);
      if (progress >= 1) {
        if (mode === "opening") {
          mode = "open";
          instruments[active].layout(fullRect());
        } else {
          mode = "gallery";
          active = -1;
          layout();
        }
      }
    }

    atmosphere.update(dt);
    // Settles over a few seconds rather than snapping, so the labels are loud
    // exactly when a new player needs them.
    if (hintFade > 0) hintFade = Math.max(0, hintFade - dt * 0.22);
    for (const [id, level] of activity) {
      const next = level - dt * 2.6;
      if (next <= 0) activity.delete(id);
      else activity.set(id, next);
    }
    for (const instrument of instruments) instrument.update(dt, t);

    drawBackground(t);

    if (mode === "gallery") {
      instruments.forEach((instrument, i) => {
        drawCardFrame(i, 1);
        instrument.draw(c, t, true);
      });
    } else {
      // The instrument being opened travels from its card to the full window;
      // the others fade out behind it.
      const from = mode === "opening" ? instrumentRectFor(active) : fullRect();
      const to = mode === "opening" ? fullRect() : instrumentRectFor(active);
      const eased = mode === "open" ? fullRect() : lerpRect(from, to, progress);
      const fade = mode === "open" ? 0 : (mode === "opening" ? 1 - progress : progress) * 0.5;

      if (fade > 0.01) {
        instruments.forEach((instrument, i) => {
          if (i === active) return;
          drawCardFrame(i, fade);
          c.save();
          c.globalAlpha = fade;
          instrument.draw(c, t, true);
          c.restore();
        });
      }

      instruments[active].layout(eased);
      instruments[active].draw(c, t, mode !== "open");
      if (mode === "open") drawKeyHints(instruments[active]);
    }

    drawLoop();
    requestAnimationFrame(frame);
  }

  document.body.dataset.mode = "gallery";
  applyMute(isMuted());
  refreshTransport();
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
}
