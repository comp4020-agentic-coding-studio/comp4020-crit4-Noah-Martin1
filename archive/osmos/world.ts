// FROZEN — part of the archived Osmos instrument. See instrument.ts.

// The world: orbs, gravity, walls, and absorption. This module knows nothing
// about sound or pixels — it reports what happened as a list of events, and
// the caller decides what that should look and sound like.

export const MIN_RADIUS = 5;
export const MAX_RADIUS = 190;
/** The player can be eaten down to here and no further. See `resolvePair`. */
export const PLAYER_FLOOR = 13;

/** Newtonian-ish attraction. Tuned by ear and eye, not derived. */
const GRAVITY = 1700;
/** Softening length: stops the force exploding when two orbs touch. */
const SOFTENING = 34;

/**
 * Only orbs this big pull on anything, and they never pull on something bigger
 * than themselves.
 *
 * This is what makes an orbit an orbit. Full n-body attraction meant every
 * satellite tugged every other satellite, so a ring that started stable slowly
 * tore itself apart on its own — and it was impossible to tell your own
 * interference from the system's drift. Restricted this way, a shell around a
 * heavy orb is a two-body problem and stays exactly where it was put. The only
 * thing that can take a satellite off its orbit is a collision.
 */
const ATTRACTOR_RADIUS = 45;
const RESTITUTION = 0.9;
/**
 * How fast mass flows from the smaller orb to the larger while they overlap.
 * Deliberately slow: absorption is the thing you are meant to watch and hear,
 * so a meal takes ten seconds or more, not a frame.
 */
const TRANSFER_RATE = 0.3;
/** Below this size ratio two orbs just bump instead of eating each other. */
const EVEN_MATCH = 1.03;

export type Orb = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  isPlayer: boolean;
  /** Counts down after a bounce or a bite; drives the rim flash. */
  flash: number;
  /** Set while overlapping something bigger, for the feeding glow. */
  feeding: number;
  /** Guards against a single contact firing a note every frame. */
  quietUntil: number;
  /** Decays after the orb's rhythmic pulse; drives the expanding ring. */
  pulse: number;
  /** Which beat of its bar this orb speaks on. Fixed for its lifetime, so an
   *  orb keeps its place in the pattern even as growth changes its division. */
  beatOffset: number;
};

export type WorldEvent =
  | { kind: "wall"; orb: Orb; impact: number }
  | { kind: "bump"; orb: Orb; impact: number }
  | { kind: "bite"; predator: Orb; prey: Orb }
  | { kind: "consumed"; predator: Orb; prey: Orb; radius: number }
  | { kind: "spare"; orb: Orb };

export type World = {
  orbs: Orb[];
  width: number;
  height: number;
  /** Seconds since the world began; used for the sound rate limiter. */
  clock: number;
};

export function makeOrb(
  x: number,
  y: number,
  radius: number,
  options: { vx?: number; vy?: number; isPlayer?: boolean } = {},
): Orb {
  return {
    x,
    y,
    radius,
    vx: options.vx ?? 0,
    vy: options.vy ?? 0,
    isPlayer: options.isPlayer ?? false,
    flash: 0,
    feeding: 0,
    quietUntil: 0,
    pulse: 0,
    beatOffset: Math.floor(Math.random() * 32),
  };
}

/** Mass is area: a 2D world, so doubling the radius quadruples the pull. */
export function massOf(orb: Orb): number {
  return orb.radius * orb.radius;
}

export function player(world: World): Orb | undefined {
  return world.orbs.find((orb) => orb.isPlayer);
}

/**
 * The speed a body needs to hold a circular orbit at `distance` from an orb of
 * `radius`. Levels use this to place satellites that actually stay up, rather
 * than ones that spiral in within seconds.
 */
export function orbitalSpeed(centralRadius: number, distance: number): number {
  return Math.sqrt((GRAVITY * centralRadius * centralRadius) / Math.max(distance, 1));
}

/** The visible orbit halo scales with size, so bigger orbs read as heavier. */
export function orbitRadius(orb: Orb): number {
  return orb.radius * 2.15 + 26;
}

/** Does `source` pull on `target`? See ATTRACTOR_RADIUS. */
export function attracts(source: Orb, target: Orb): boolean {
  return source.radius >= ATTRACTOR_RADIUS && source.radius > target.radius;
}

/** True if this orb is heavy enough to hold others in orbit around it. */
export function isAttractor(orb: Orb): boolean {
  return orb.radius >= ATTRACTOR_RADIUS;
}

// Scratch space for the integrator, reused rather than reallocated every step.
const accelX: number[] = [];
const accelY: number[] = [];

function computeAcceleration(orbs: Orb[]): void {
  for (let i = 0; i < orbs.length; i++) {
    accelX[i] = 0;
    accelY[i] = 0;
    const target = orbs[i];
    for (let j = 0; j < orbs.length; j++) {
      if (i === j) continue;
      const source = orbs[j];
      if (!attracts(source, target)) continue;
      const dx = source.x - target.x;
      const dy = source.y - target.y;
      const distanceSquared = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const distance = Math.sqrt(distanceSquared);
      const scale = (GRAVITY * massOf(source)) / (distanceSquared * distance);
      accelX[i] += dx * scale;
      accelY[i] += dy * scale;
    }
  }
}

export function step(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  world.clock += dt;
  const { orbs } = world;

  // --- gravity, integrated symplectically ------------------------------------
  // Kick, drift, kick: half a velocity step, a full position step, then the
  // other half against the new positions. Plain Euler bleeds energy every
  // frame, which reads as orbits slowly spiralling in for no visible reason.
  // Leapfrog conserves it, so a ring placed at orbital speed stays a ring.
  computeAcceleration(orbs);
  for (let i = 0; i < orbs.length; i++) {
    orbs[i].vx += accelX[i] * dt * 0.5;
    orbs[i].vy += accelY[i] * dt * 0.5;
  }
  for (const orb of orbs) {
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;
  }
  computeAcceleration(orbs);
  for (let i = 0; i < orbs.length; i++) {
    orbs[i].vx += accelX[i] * dt * 0.5;
    orbs[i].vy += accelY[i] * dt * 0.5;
  }

  // --- walls -----------------------------------------------------------------
  // No drag anywhere: a damping term is orbital decay by another name, and the
  // whole point is that an undisturbed orbit holds.
  for (const orb of orbs) {
    orb.flash = Math.max(0, orb.flash - dt * 2.6);
    orb.feeding = Math.max(0, orb.feeding - dt * 3.5);
    orb.pulse = Math.max(0, orb.pulse - dt * 1.15);

    // The container is the instrument's body: every wall is a soft harmonic
    // strike, quieter the gentler the touch.
    if (orb.x - orb.radius < 0) {
      orb.x = orb.radius;
      if (orb.vx < 0) {
        events.push({ kind: "wall", orb, impact: Math.abs(orb.vx) });
        orb.vx = -orb.vx * RESTITUTION;
      }
    } else if (orb.x + orb.radius > world.width) {
      orb.x = world.width - orb.radius;
      if (orb.vx > 0) {
        events.push({ kind: "wall", orb, impact: Math.abs(orb.vx) });
        orb.vx = -orb.vx * RESTITUTION;
      }
    }

    if (orb.y - orb.radius < 0) {
      orb.y = orb.radius;
      if (orb.vy < 0) {
        events.push({ kind: "wall", orb, impact: Math.abs(orb.vy) });
        orb.vy = -orb.vy * RESTITUTION;
      }
    } else if (orb.y + orb.radius > world.height) {
      orb.y = world.height - orb.radius;
      if (orb.vy > 0) {
        events.push({ kind: "wall", orb, impact: Math.abs(orb.vy) });
        orb.vy = -orb.vy * RESTITUTION;
      }
    }
  }

  // --- contact ---------------------------------------------------------------
  for (let i = 0; i < orbs.length; i++) {
    for (let j = i + 1; j < orbs.length; j++) {
      resolvePair(world, orbs[i], orbs[j], dt, events);
    }
  }

  // Anything eaten down to nothing leaves the world.
  for (let i = orbs.length - 1; i >= 0; i--) {
    if (orbs[i].radius < MIN_RADIUS && !orbs[i].isPlayer) orbs.splice(i, 1);
  }

  return events;
}

function resolvePair(world: World, a: Orb, b: Orb, dt: number, events: WorldEvent[]): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 0.0001;
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;

  const nx = dx / distance;
  const ny = dy / distance;
  const ratio = a.radius > b.radius ? a.radius / b.radius : b.radius / a.radius;

  // Evenly matched orbs can't eat each other, so they bump — the sound of two
  // equals meeting. This is also what stops a stable pair from grinding.
  if (ratio < EVEN_MATCH) {
    separate(a, b, nx, ny, overlap);
    const impact = Math.abs((b.vx - a.vx) * nx + (b.vy - a.vy) * ny);
    bounce(a, b, nx, ny);
    if (world.clock > a.quietUntil && impact > 12) {
      a.quietUntil = world.clock + 0.09;
      a.flash = 1;
      b.flash = 1;
      events.push({ kind: "bump", orb: a.radius > b.radius ? a : b, impact });
    }
    return;
  }

  const predator = a.radius > b.radius ? a : b;
  const prey = predator === a ? b : a;

  // The one line that keeps this a garden rather than a game: the player can
  // be nibbled down, but never eaten. At the floor they are pushed clear with
  // a low note instead of dying. There is no fail state to find.
  if (prey.isPlayer && prey.radius <= PLAYER_FLOOR) {
    separate(a, b, nx, ny, overlap);
    bounce(a, b, nx, ny);
    if (world.clock > prey.quietUntil) {
      prey.quietUntil = world.clock + 0.5;
      prey.flash = 1;
      events.push({ kind: "spare", orb: prey });
    }
    return;
  }

  // Osmos-style gradual transfer: area flows across the contact patch, so
  // being eaten is something you watch happen and can still escape.
  // Scaled by the predator, not the prey: scaling by the smaller orb meant the
  // flow died away as the prey shrank, and the last scrap took forever.
  const areaFlow = TRANSFER_RATE * overlap * Math.max(20, predator.radius) * dt;
  const preyArea = prey.radius * prey.radius;
  const predatorArea = predator.radius * predator.radius;
  const floorArea = prey.isPlayer ? PLAYER_FLOOR * PLAYER_FLOOR : 0;
  const taken = Math.min(areaFlow, Math.max(0, preyArea - floorArea));

  prey.radius = Math.sqrt(preyArea - taken);
  predator.radius = Math.min(MAX_RADIUS, Math.sqrt(predatorArea + taken));
  prey.feeding = 1;
  predator.feeding = Math.max(predator.feeding, 0.6);

  // Momentum comes across with the mass, so a big orb is nudged by what it
  // eats rather than snapping to a new speed.
  const share = taken / Math.max(predatorArea, 1);
  predator.vx += (prey.vx - predator.vx) * share;
  predator.vy += (prey.vy - predator.vy) * share;

  if (world.clock > prey.quietUntil) {
    prey.quietUntil = world.clock + 0.6;
    events.push({ kind: "bite", predator, prey });
  }

  if (prey.radius < MIN_RADIUS && !prey.isPlayer) {
    events.push({ kind: "consumed", predator, prey, radius: prey.radius });
    predator.flash = 1;
  }
}

function separate(a: Orb, b: Orb, nx: number, ny: number, overlap: number): void {
  // Split the correction by mass: the heavier orb barely moves.
  const massA = massOf(a);
  const massB = massOf(b);
  const total = massA + massB;
  a.x -= nx * overlap * (massB / total);
  a.y -= ny * overlap * (massB / total);
  b.x += nx * overlap * (massA / total);
  b.y += ny * overlap * (massA / total);
}

function bounce(a: Orb, b: Orb, nx: number, ny: number): void {
  const massA = massOf(a);
  const massB = massOf(b);
  const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relative > 0) return; // already separating
  const impulse = (-(1 + RESTITUTION) * relative) / (1 / massA + 1 / massB);
  a.vx -= (impulse / massA) * nx;
  a.vy -= (impulse / massA) * ny;
  b.vx += (impulse / massB) * nx;
  b.vy += (impulse / massB) * ny;
}
