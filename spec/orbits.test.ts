// The archived Osmos instrument's orbital contract. Kept green so the
// archive cannot rot silently, even though it is no longer worked on.
//
// The singularity level's promise: a satellite left alone stays where it was
// put, and the only thing that takes it off its orbit is being hit. Both halves
// matter — a system that drifts on its own makes the player's interference
// unreadable, and a system nothing can disturb is not an instrument.

import { describe, expect, it } from "vitest";
import { type World, makeOrb, orbitalSpeed, step } from "../archive/osmos/world.ts";

const SUB_STEP = 1 / 120;

function arena(): World {
  return { orbs: [], width: 6000, height: 6000, clock: 0 };
}

/** Place a satellite on a circular orbit at `distance` from the central orb. */
function orbit(world: World, centre: { x: number; y: number; radius: number }, distance: number, angle: number, radius: number) {
  const speed = orbitalSpeed(centre.radius, distance);
  const orb = makeOrb(
    centre.x + Math.cos(angle) * distance,
    centre.y + Math.sin(angle) * distance,
    radius,
    { vx: -Math.sin(angle) * speed, vy: Math.cos(angle) * speed },
  );
  world.orbs.push(orb);
  return orb;
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / SUB_STEP); i++) step(world, SUB_STEP);
}

describe("orbits are stable", () => {
  it("a shell of satellites holds its radius for minutes", () => {
    const world = arena();
    const centre = makeOrb(3000, 3000, 132);
    world.orbs.push(centre);

    const distances = [400, 700, 1000];
    const satellites = distances.map((distance, i) =>
      orbit(world, centre, distance, (i / 3) * Math.PI * 2, 14),
    );

    run(world, 240);

    satellites.forEach((orb, i) => {
      const distance = Math.hypot(orb.x - centre.x, orb.y - centre.y);
      const drift = Math.abs(distance - distances[i]) / distances[i];
      expect(
        drift,
        `satellite ${i} drifted ${(drift * 100).toFixed(1)}% from its orbit`,
      ).toBeLessThan(0.02);
    });
  });

  it("the central orb is not dragged around by what orbits it", () => {
    const world = arena();
    const centre = makeOrb(3000, 3000, 132);
    world.orbs.push(centre);
    // Deliberately lopsided: every satellite on one side.
    for (let i = 0; i < 4; i++) orbit(world, centre, 520 + i * 90, i * 0.22, 20);

    run(world, 120);

    expect(Math.hypot(centre.x - 3000, centre.y - 3000)).toBeLessThan(1);
  });

  it("satellites do not perturb each other", () => {
    // Two satellites sharing an orbit, close together. Under full n-body
    // attraction they would swap energy and separate; they must not.
    const world = arena();
    const centre = makeOrb(3000, 3000, 132);
    world.orbs.push(centre);
    const a = orbit(world, centre, 600, 0, 22);
    const b = orbit(world, centre, 600, 0.12, 22);

    run(world, 180);

    const distanceA = Math.hypot(a.x - centre.x, a.y - centre.y);
    const distanceB = Math.hypot(b.x - centre.x, b.y - centre.y);
    expect(Math.abs(distanceA - distanceB)).toBeLessThan(12);
  });

  it("but a collision does knock one off", () => {
    const world = arena();
    const centre = makeOrb(3000, 3000, 132);
    world.orbs.push(centre);
    const satellite = orbit(world, centre, 700, 0, 16);

    // The player, arriving across the orbit rather than along it.
    world.orbs.push(
      makeOrb(satellite.x + 120, satellite.y, 26, { isPlayer: true, vx: -900, vy: 0 }),
    );

    run(world, 30);

    const distance = Math.hypot(satellite.x - centre.x, satellite.y - centre.y);
    expect(
      Math.abs(distance - 700),
      "a hit from the player has to actually change the orbit",
    ).toBeGreaterThan(20);
  });
});
