// FROZEN. This is the archived Osmos-style instrument, kept as process
// evidence and still deployed under /archive/osmos/. It is not the current
// prototype and is not worked on any more — see src/strings.ts for that.
// It shares src/audio.ts, so extend that file rather than changing it.

// The instrument: input in, physics forward, sound and pixels out.
//
// Both pages run this same file; they differ only in the arena they ask for.
// The arena is a fixed size in world units and is larger than any window, so
// the window is a viewport onto it. Resizing the browser changes how much of
// the world you can see, not how big the world is.

import {
  type Drone,
  type HeldVoice,
  holdTone,
  isMuted,
  makeDrone,
  pitchForRadius,
  playTone,
  snapToChord,
  toggleMuted,
  wake,
} from "../../src/audio.ts";
import {
  type Camera,
  clampCamera,
  clampZoom,
  fitZoom,
  screenToWorld,
  visibleRect,
} from "./camera.ts";
import { need } from "../../src/dom.ts";
import { type Overlay, drawScene } from "./render.ts";
import {
  MAX_RADIUS,
  MIN_RADIUS,
  type Orb,
  type World,
  type WorldEvent,
  isAttractor,
  makeOrb,
  orbitalSpeed,
  step,
} from "./world.ts";

const PLAYER_START_RADIUS = 26;
const SPAWN_MIN_RADIUS = 9;
const SPAWN_MAX_RADIUS = 118;
/** Holding this long grows a new orb to its full size. */
const GROW_SECONDS = 2.1;
const MAX_ORBS = 64;
// Accelerations and throws are expressed per simulation-second, so both are
// scaled up by 1/TIME_SCALE: the world moves slowly, but the player's own hand
// should never feel like it is dragging.
const THRUST = 2600;
/** Screen pixels per second, before conversion to world units. */
const MAX_FLICK = 1400;
/** Physics runs at a fixed small step regardless of frame rate: strong gravity
 *  and a 30ms frame do not survive each other. */
const SUB_STEP = 1 / 120;
/** How quickly the camera settles onto the player. */
const FOLLOW = 5.5;

/**
 * The simulation runs at this fraction of real time. Absorption, orbits and
 * drift are all meant to be watched and listened to rather than kept up with,
 * and slowing the clock does that uniformly — no single rate to re-tune.
 */
const TIME_SCALE = 0.34;

// --- the rhythm --------------------------------------------------------------
// Every orb speaks on its own repeating cycle, and every cycle is a whole
// number of the same beat. That is the whole trick: nothing is random, so the
// field keeps time with itself, and because the cycle lengths are 2, 3, 4, 6
// and 8 beats they drift in and out of phase instead of locking into a single
// bar. The pattern only truly repeats every 24 beats.

/** Seconds per beat. Everything rhythmic is a whole multiple of this. */
const BEAT = 0.92;
/** At most this many orbs speak on any one beat, loudest — biggest — first. */
const PULSE_BUDGET = 6;

/** How many of the largest visible orbs hold a continuous note. */
const DRONE_VOICES = 8;

/** How many beats between this orb's pulses. Small orbs tick, big ones toll. */
function divisionFor(radius: number): number {
  if (radius < 12) return 2;
  if (radius < 20) return 3;
  if (radius < 34) return 4;
  if (radius < 60) return 6;
  return 8;
}

export type LevelName = "open" | "singularity";

/** Arena size in world units, per level. Independent of the window. */
const ARENAS: Record<LevelName, { width: number; height: number }> = {
  open: { width: 2600, height: 1900 },
  singularity: { width: 3000, height: 2200 },
};

type Grow = {
  x: number;
  y: number;
  radius: number;
  voice: HeldVoice | null;
  source: "pointer" | "key";
};

type Drag = {
  orb: Orb;
  /** Pointer position in world units. */
  x: number;
  y: number;
  /** Where the grab began, in world units — the camera moves during a drag, so
   *  re-deriving this from the screen sample would make the aim line drift. */
  fromX: number;
  fromY: number;
  /** Recent samples in *screen* pixels, for working out the release velocity. */
  samples: { x: number; y: number; t: number }[];
};

export function start(level: LevelName): void {
  const canvas = need(document.querySelector<HTMLCanvasElement>("#stage"), "#stage canvas");
  const c = need(canvas.getContext("2d"), "2d context");
  const invitation = document.querySelector<HTMLElement>("#invitation");
  const muteButton = document.querySelector<HTMLButtonElement>("#mute");

  const arena = ARENAS[level];
  const world: World = { orbs: [], width: arena.width, height: arena.height, clock: 0 };
  const view = { width: window.innerWidth, height: window.innerHeight };
  const camera: Camera = { x: arena.width / 2, y: arena.height / 2, zoom: 1 };
  let dpr = 1;

  let grow: Grow | null = null;
  let drag: Drag | null = null;
  let reticle: { x: number; y: number } | null = null;
  let started = false;
  const held = new Set<string>();
  /** Live pointers, in screen pixels, for pinch-to-zoom. */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance: number | null = null;
  /** Beat clock. Real time, not simulation time: the tempo should not change
   *  when the physics is slowed. */
  let beatClock = 0;
  let beatIndex = 0;
  /** The orbs currently holding a sustained note, and the voice each one has. */
  const drones = new Map<Orb, Drone>();

  // --- level setup -----------------------------------------------------------

  function populate(): void {
    world.orbs = [];
    const { width, height } = world;

    if (level === "open") {
      // A near-empty field and one blue orb: the whole first page is "there is
      // a thing here, touch it".
      world.orbs.push(
        makeOrb(width / 2, height / 2, PLAYER_START_RADIUS, { isPlayer: true, vx: 30, vy: -16 }),
      );
      // A handful of small motes scattered wide, so there is something to find
      // when you zoom out — an empty arena reads as a bug.
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2 + 0.4;
        const distance = 420 + (i % 3) * 260;
        world.orbs.push(
          makeOrb(
            width / 2 + Math.cos(angle) * distance,
            height / 2 + Math.sin(angle) * distance,
            8 + (i % 4) * 4,
            { vx: -Math.sin(angle) * 40, vy: Math.cos(angle) * 40 },
          ),
        );
      }
      camera.x = width / 2;
      camera.y = height / 2;
      return;
    }

    // The singularity: one heavy orb holding shells of satellites, with the
    // player parked outside. Every satellite gets exactly the speed a circular
    // orbit needs, so the level is stable until the player disturbs it — which
    // is the whole invitation.
    const cx = width / 2;
    const cy = height / 2;
    const centralRadius = 132;
    world.orbs.push(makeOrb(cx, cy, centralRadius));

    const shells = [
      { distance: 0.26, count: 5, radius: 13 },
      { distance: 0.42, count: 4, radius: 21 },
      { distance: 0.58, count: 3, radius: 9 },
      { distance: 0.72, count: 6, radius: 16 },
    ];
    const reach = Math.min(width, height) / 2;

    for (const shell of shells) {
      const distance = reach * shell.distance + centralRadius;
      const speed = orbitalSpeed(centralRadius, distance);
      for (let i = 0; i < shell.count; i++) {
        const angle = (i / shell.count) * Math.PI * 2 + shell.distance * 3;
        // Velocity perpendicular to the radius: that is what an orbit is.
        world.orbs.push(
          makeOrb(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance, shell.radius, {
            vx: -Math.sin(angle) * speed,
            vy: Math.cos(angle) * speed,
          }),
        );
      }
    }

    const playerDistance = reach * 0.88 + centralRadius;
    const playerAngle = -Math.PI / 2.6;
    const playerSpeed = orbitalSpeed(centralRadius, playerDistance);
    world.orbs.push(
      makeOrb(
        cx + Math.cos(playerAngle) * playerDistance,
        cy + Math.sin(playerAngle) * playerDistance,
        PLAYER_START_RADIUS,
        {
          isPlayer: true,
          vx: -Math.sin(playerAngle) * playerSpeed,
          vy: Math.cos(playerAngle) * playerSpeed,
        },
      ),
    );
    camera.x = cx;
    camera.y = cy;
  }

  function playerOrb(): Orb {
    const found = world.orbs.find((orb) => orb.isPlayer);
    if (found) return found;
    // The simulation never removes the player, but the instrument should still
    // be playable if a level ever shipped without one.
    const fresh = makeOrb(world.width / 2, world.height / 2, PLAYER_START_RADIUS, {
      isPlayer: true,
    });
    world.orbs.push(fresh);
    return fresh;
  }

  /** The zoom a level wants to open at: the singularity wants to be read whole. */
  function openingZoom(): number {
    const fit = fitZoom(world, view);
    return clampZoom(level === "singularity" ? fit : Math.max(fit, view.width / 1750), world, view);
  }

  // --- sound -----------------------------------------------------------------

  function panFor(x: number): number {
    // Pan follows position on *screen*, not in the world: what you hear should
    // match where you can see it.
    const screenX = (x - camera.x) * camera.zoom + view.width / 2;
    return Math.max(-1, Math.min(1, (screenX / Math.max(view.width, 1)) * 1.6 - 0.8));
  }

  function voiceFor(orb: Orb): number {
    // Snapped to the chord of the moment, so any two orbs sounding together are
    // an interval of one harmony rather than two unrelated notes. Octaves and
    // fifths of a chord tone are still chord tones, so callers are free to
    // halve this or multiply it by 1.5 without going out of key.
    return snapToChord(pitchForRadius(orb.radius, MIN_RADIUS, MAX_RADIUS));
  }

  function sonify(events: WorldEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case "wall": {
          // Quiet and harmonic: the walls are the body of the instrument, not
          // a drum kit.
          const force = Math.min(1, event.impact / 620);
          if (force < 0.05) break;
          event.orb.flash = Math.max(event.orb.flash, 0.55 + force * 0.45);
          playTone(voiceFor(event.orb), {
            duration: 0.8 + event.orb.radius / 80,
            level: 0.05 + force * 0.14,
            brightness: 0.22 + force * 0.3,
            noise: 0.25 + force * 0.2,
            pan: panFor(event.orb.x),
          });
          break;
        }

        case "bump": {
          const force = Math.min(1, event.impact / 520);
          playTone(voiceFor(event.orb), {
            duration: 0.95 + event.orb.radius / 70,
            level: 0.06 + force * 0.15,
            brightness: 0.4 + force * 0.35,
            noise: 0.35 + force * 0.25,
            pan: panFor(event.orb.x),
          });
          break;
        }

        case "bite": {
          // Being eaten has a texture rather than one blip: a soft, low pull
          // repeating slowly while the transfer runs. An octave down from the
          // prey's own voice, so a small orb being taken is not a shriek.
          playTone(voiceFor(event.prey) / 2, {
            duration: 0.9,
            level: 0.055,
            brightness: 0.34,
            noise: 0.12,
            pan: panFor(event.prey.x),
          });
          break;
        }

        case "consumed": {
          // The note the brief asks for, arriving when an orb is fully taken:
          // the prey's pitch and a fifth above it, over the predator's new
          // lower voice. A small resolution.
          // An octave below the prey's voice, with a fifth over it and the
          // predator's new lower note underneath: a resolution downwards,
          // which is what swallowing something should sound like.
          const prey =
            pitchForRadius(Math.max(event.radius, MIN_RADIUS), MIN_RADIUS, MAX_RADIUS) / 2;
          playTone(prey, {
            duration: 2.8,
            level: 0.15,
            brightness: 0.42,
            noise: 0.2,
            pan: panFor(event.prey.x),
          });
          playTone(prey * 1.5, {
            duration: 2.2,
            level: 0.085,
            brightness: 0.34,
            pan: panFor(event.prey.x) * 0.6,
          });
          playTone(voiceFor(event.predator), {
            duration: 3.4,
            level: 0.12,
            brightness: 0.2,
            pan: panFor(event.predator.x),
          });
          break;
        }

        case "spare": {
          // The player at their floor, pushed clear instead of killed: a low,
          // soft chord, so it reads as a limit and not a punishment.
          playTone(voiceFor(event.orb) / 2, {
            duration: 2.8,
            level: 0.12,
            brightness: 0.16,
            pan: panFor(event.orb.x),
          });
          break;
        }
      }
    }
  }

  // --- the pulse -------------------------------------------------------------

  /**
   * One beat of the field. Every orb whose cycle lands on this beat sounds its
   * own note, so the rhythm is the population: add a big orb and a slow low
   * pulse joins the pattern, feed it and the pattern re-tunes itself.
   */
  function onBeat(): void {
    // Nothing may sound — or even construct an AudioContext — before the player
    // has acted.
    if (!started) return;
    const seen = visibleRect(camera, view);
    const margin = 240;

    const due = world.orbs.filter((orb) => {
      const division = divisionFor(orb.radius);
      if (beatIndex % division !== orb.beatOffset % division) return false;
      // Only what you can see is allowed to speak, so the rhythm belongs to
      // the view rather than to a corner of the arena you are not looking at.
      return (
        orb.x > seen.left - margin &&
        orb.x < seen.right + margin &&
        orb.y > seen.top - margin &&
        orb.y < seen.bottom + margin
      );
    });

    // When more orbs are due than the budget allows, the big ones win: losing
    // a tick is far less noticeable than losing the bass note of the bar.
    due.sort((a, b) => b.radius - a.radius);

    for (const orb of due.slice(0, PULSE_BUDGET)) {
      const weight = Math.min(1, orb.radius / 90);
      orb.pulse = 1;
      playTone(voiceFor(orb), {
        // Big orbs ring on well past the next beat, which is what layers the
        // pattern instead of just filling it in.
        duration: 1.1 + weight * 3.4,
        level: 0.05 + weight * 0.075,
        // Rounder than an impact: a pulse should breathe, not click.
        brightness: 0.46 - weight * 0.26,
        noise: 0.06,
        pan: panFor(orb.x),
      });
    }
  }

  /** Is this orb within the frame, give or take a margin? */
  function onScreen(orb: Orb, margin = 240): boolean {
    const seen = visibleRect(camera, view);
    return (
      orb.x > seen.left - margin &&
      orb.x < seen.right + margin &&
      orb.y > seen.top - margin &&
      orb.y < seen.bottom + margin
    );
  }

  /**
   * Hand the sustained voices to the biggest orbs on screen, and take them back
   * when an orb is eaten or drifts out of frame. The set changes slowly, and
   * each voice glides, so the chord re-voices itself rather than switching.
   */
  function updateDrones(): void {
    if (!started) return;

    const holders = world.orbs
      .filter((orb) => onScreen(orb))
      .sort((a, b) => b.radius - a.radius)
      .slice(0, DRONE_VOICES);
    const keep = new Set(holders);

    for (const [orb, drone] of drones) {
      if (!keep.has(orb)) {
        drone.release();
        drones.delete(orb);
      }
    }

    for (const orb of holders) {
      let drone = drones.get(orb);
      if (!drone) {
        const made = makeDrone();
        if (!made) continue;
        drone = made;
        drones.set(orb, drone);
      }
      const weight = Math.min(1, orb.radius / 100);
      // Big orbs hold the bass of the chord and are allowed to be heard; small
      // ones are barely there, so eight at once is a chord and not a wall.
      drone.set(voiceFor(orb), 0.012 + weight * 0.034, panFor(orb.x));
    }
  }

  // --- growing a new orb -----------------------------------------------------

  function beginGrow(x: number, y: number, source: "pointer" | "key"): void {
    if (grow || world.orbs.length >= MAX_ORBS) return;
    grow = {
      x,
      y,
      radius: SPAWN_MIN_RADIUS,
      source,
      voice: holdTone(pitchForRadius(SPAWN_MIN_RADIUS, MIN_RADIUS, MAX_RADIUS), 0.05),
    };
  }

  function advanceGrow(dt: number): void {
    if (!grow) return;
    // Eases towards the maximum, so the first moment of holding grows fast and
    // the last stretch is fine control.
    grow.radius += (SPAWN_MAX_RADIUS - grow.radius) * (1 - Math.exp(-dt / (GROW_SECONDS / 3)));
    grow.voice?.follow(pitchForRadius(grow.radius, MIN_RADIUS, MAX_RADIUS));
  }

  function releaseGrow(): void {
    if (!grow) return;
    const { x, y, radius, voice } = grow;
    grow = null;
    voice?.release();

    // Launch it along a tangent to whatever dominates nearby, so a new orb
    // takes up an orbit instead of dropping straight into the biggest mass.
    let vx = (Math.random() - 0.5) * 40;
    let vy = (Math.random() - 0.5) * 40;
    const heaviest = world.orbs.reduce<Orb | null>(
      (best, orb) => (!best || orb.radius > best.radius ? orb : best),
      null,
    );
    // Only aim for an orbit if there is something that actually attracts: with
    // restricted gravity, a tangent around a light orb would just be drift.
    if (heaviest && isAttractor(heaviest) && heaviest.radius > radius) {
      const dx = x - heaviest.x;
      const dy = y - heaviest.y;
      const distance = Math.hypot(dx, dy);
      if (distance > heaviest.radius + radius) {
        const speed = orbitalSpeed(heaviest.radius, distance) * (0.75 + Math.random() * 0.25);
        const spin = Math.random() < 0.5 ? 1 : -1;
        vx = (-dy / distance) * speed * spin + heaviest.vx;
        vy = (dx / distance) * speed * spin + heaviest.vy;
      }
    }

    world.orbs.push(makeOrb(x, y, radius, { vx, vy }));
    playTone(snapToChord(pitchForRadius(radius, MIN_RADIUS, MAX_RADIUS)), {
      duration: 1.2 + radius / 90,
      level: 0.075,
      brightness: 0.55,
      pan: panFor(x),
    });
  }

  // --- zoom ------------------------------------------------------------------

  function setZoom(next: number): void {
    camera.zoom = clampZoom(next, world, view);
    clampCamera(camera, world, view);
  }

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      firstGesture();
      setZoom(camera.zoom * Math.exp(-event.deltaY * 0.0016));
    },
    { passive: false },
  );

  // --- input -----------------------------------------------------------------

  function firstGesture(): void {
    wake();
    if (started) return;
    started = true;
    invitation?.classList.add("gone");
  }

  function screenPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pinchSpan(): number | null {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  canvas.addEventListener("pointerdown", (event) => {
    firstGesture();
    canvas.setPointerCapture(event.pointerId);
    const screen = screenPoint(event);
    pointers.set(event.pointerId, screen);

    if (pointers.size >= 2) {
      // A second finger means the gesture is a pinch, not a drag: abandon
      // whatever the first finger had started.
      drag = null;
      if (grow) {
        grow.voice?.release();
        grow = null;
      }
      pinchDistance = pinchSpan();
      return;
    }

    const point = screenToWorld(camera, view, screen.x, screen.y);
    const player = playerOrb();

    // A generous grab radius, measured in screen pixels so it feels the same
    // at every zoom: missing your own orb is the most annoying way to fail at
    // a toy.
    if (Math.hypot(player.x - point.x, player.y - point.y) < player.radius + 26 / camera.zoom) {
      drag = {
        orb: player,
        x: point.x,
        y: point.y,
        fromX: point.x,
        fromY: point.y,
        samples: [{ ...screen, t: performance.now() }],
      };
      return;
    }

    beginGrow(point.x, point.y, "pointer");
  });

  canvas.addEventListener("pointermove", (event) => {
    const screen = screenPoint(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, screen);

    if (pointers.size >= 2) {
      const span = pinchSpan();
      if (span && pinchDistance) setZoom(camera.zoom * (span / pinchDistance));
      pinchDistance = span;
      return;
    }

    const point = screenToWorld(camera, view, screen.x, screen.y);
    if (drag) {
      drag.x = point.x;
      drag.y = point.y;
      drag.samples.push({ ...screen, t: performance.now() });
      if (drag.samples.length > 6) drag.samples.shift();
    } else if (grow && grow.source === "pointer") {
      // Let the player slide the orb they are growing into place.
      grow.x = point.x;
      grow.y = point.y;
    }
  });

  function endPointer(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = null;
    // Lifting one finger of a pinch should not throw the player.
    if (pointers.size >= 1 && !drag && !grow) return;

    if (drag) {
      const samples = drag.samples;
      const last = samples[samples.length - 1];
      // Measure over the tail of the gesture only: what the hand was doing at
      // the moment of release is the throw, not the average of the whole drag.
      const first = samples.find((sample) => last.t - sample.t < 110) ?? samples[0];
      const seconds = Math.max(0.016, (last.t - first.t) / 1000);
      let vx = ((last.x - first.x) / seconds) * 0.85;
      let vy = ((last.y - first.y) / seconds) * 0.85;
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_FLICK) {
        vx = (vx / speed) * MAX_FLICK;
        vy = (vy / speed) * MAX_FLICK;
      }
      // Screen pixels per second become world units per simulation-second: the
      // zoom division keeps a flick covering the same distance on screen at any
      // zoom, and the TIME_SCALE division means the orb leaves your hand at the
      // speed you actually threw it rather than at a third of it.
      const toWorld = 1 / (camera.zoom * TIME_SCALE);
      drag.orb.vx = drag.orb.vx * 0.2 + vx * toWorld;
      drag.orb.vy = drag.orb.vy * 0.2 + vy * toWorld;
      drag = null;
      return;
    }
    releaseGrow();
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();

    if (key === "m") {
      firstGesture();
      applyMute(toggleMuted());
      return;
    }

    if (key === "r") {
      firstGesture();
      populate();
      setZoom(openingZoom());
      return;
    }

    if (key === "+" || key === "=") {
      firstGesture();
      setZoom(camera.zoom * 1.18);
      return;
    }

    if (key === "-" || key === "_") {
      firstGesture();
      setZoom(camera.zoom / 1.18);
      return;
    }

    if (key === "0") {
      firstGesture();
      setZoom(openingZoom());
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (event.repeat) return;
      firstGesture();
      const spot = reticle ?? { x: camera.x, y: camera.y };
      reticle = spot;
      beginGrow(spot.x, spot.y, "key");
      return;
    }

    if (["w", "a", "s", "d"].includes(key)) {
      firstGesture();
      held.add(key);
      event.preventDefault();
      return;
    }

    if (event.key.startsWith("Arrow")) {
      firstGesture();
      held.add(event.key);
      event.preventDefault();
      if (!reticle) reticle = { x: camera.x, y: camera.y };
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      releaseGrow();
      return;
    }
    held.delete(event.key.toLowerCase());
    held.delete(event.key);
  });

  // A key released while the tab is unfocused would otherwise leave the player
  // thrusting forever.
  window.addEventListener("blur", () => {
    held.clear();
    releaseGrow();
    pointers.clear();
    pinchDistance = null;
    drag = null;
  });

  function applyMute(nowMuted: boolean): void {
    if (!muteButton) return;
    muteButton.setAttribute("aria-pressed", String(nowMuted));
    muteButton.textContent = nowMuted ? "sound off" : "sound on";
  }

  muteButton?.addEventListener("click", () => {
    firstGesture();
    applyMute(toggleMuted());
  });

  function applyHeld(dt: number): void {
    const player = playerOrb();
    if (held.has("w")) player.vy -= THRUST * dt;
    if (held.has("s")) player.vy += THRUST * dt;
    if (held.has("a")) player.vx -= THRUST * dt;
    if (held.has("d")) player.vx += THRUST * dt;

    if (reticle) {
      // The reticle travels at a constant speed on screen, so it stays usable
      // whether you are zoomed right in or looking at the whole arena.
      const speed = (520 / camera.zoom) * dt;
      if (held.has("ArrowLeft")) reticle.x -= speed;
      if (held.has("ArrowRight")) reticle.x += speed;
      if (held.has("ArrowUp")) reticle.y -= speed;
      if (held.has("ArrowDown")) reticle.y += speed;
      reticle.x = Math.min(world.width, Math.max(0, reticle.x));
      reticle.y = Math.min(world.height, Math.max(0, reticle.y));
      if (grow && grow.source === "key") {
        grow.x = reticle.x;
        grow.y = reticle.y;
      }
    }
  }

  // --- resize ----------------------------------------------------------------

  function resize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = window.innerWidth;
    view.height = window.innerHeight;
    canvas.width = Math.floor(view.width * dpr);
    canvas.height = Math.floor(view.height * dpr);
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${view.height}px`;
    // The arena does not change size; only how much of it fits on screen.
    setZoom(camera.zoom);
  }

  // --- loop ------------------------------------------------------------------

  let lastFrame = performance.now();

  function frame(nowMs: number): void {
    const dt = Math.min(0.04, (nowMs - lastFrame) / 1000);
    lastFrame = nowMs;

    // Thrust belongs to the simulation; growing an orb is a UI gesture and
    // stays on the wall clock.
    applyHeld(dt * TIME_SCALE);
    advanceGrow(dt);

    if (drag) {
      // A dragged orb is carried, not pushed: it follows the hand exactly and
      // ignores gravity until it is let go.
      drag.orb.x = drag.x;
      drag.orb.y = drag.y;
      drag.orb.vx = 0;
      drag.orb.vy = 0;
    }

    updateDrones();

    // The beat runs on the wall clock so the tempo is steady, while the
    // simulation below it runs slow.
    beatClock += dt;
    while (beatClock >= BEAT) {
      beatClock -= BEAT;
      beatIndex++;
      onBeat();
    }

    let remaining = dt * TIME_SCALE;
    while (remaining > 0) {
      const slice = Math.min(SUB_STEP, remaining);
      sonify(step(world, slice));
      remaining -= slice;
    }

    // The camera keeps the player in the middle, the way Osmos does — you are
    // always the centre of your own view.
    const player = playerOrb();
    const settle = 1 - Math.exp(-dt * FOLLOW);
    camera.x += (player.x - camera.x) * settle;
    camera.y += (player.y - camera.y) * settle;
    clampCamera(camera, world, view);

    const overlay: Overlay = {};
    if (grow) overlay.growing = { x: grow.x, y: grow.y, radius: grow.radius };
    if (drag) {
      overlay.aim = { fromX: drag.fromX, fromY: drag.fromY, toX: drag.x, toY: drag.y };
    }
    if (reticle && !drag) overlay.reticle = reticle;

    drawScene(c, world, camera, view, dpr, nowMs / 1000, overlay);
    requestAnimationFrame(frame);
  }

  applyMute(isMuted());
  resize();
  window.addEventListener("resize", resize);
  populate();
  setZoom(openingZoom());
  requestAnimationFrame(frame);
}
