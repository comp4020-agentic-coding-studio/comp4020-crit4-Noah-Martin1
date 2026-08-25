// FROZEN — part of the archived Osmos instrument. See instrument.ts.

// Drawing, in two coordinate systems: the starfield and the vignette live in
// screen space so they parallax behind everything, and the arena itself is
// drawn in world units under the camera transform.

import { type Camera, type Viewport, visibleRect } from "./camera.ts";
import { type Colour, type Variant, orbSprite } from "./orb-sprite.ts";
import { type Orb, type World, orbitRadius } from "./world.ts";

export type { Colour } from "./orb-sprite.ts";

/** Light blue, and only ever the player: it is how you find yourself. */
const PLAYER_COLOUR: Colour = { hue: 192, saturation: 86, lightness: 70 };

/**
 * Size relative to the player decides the colour, which makes the palette a
 * readout rather than decoration: green means safe to eat, yellow means an even
 * match, red means it will eat you.
 */
export function colourFor(radius: number, playerRadius: number, isPlayer: boolean): Colour {
  if (isPlayer) return PLAYER_COLOUR;
  const ratio = radius / Math.max(playerRadius, 1);

  if (ratio <= 1) {
    const t = Math.min(1, Math.max(0, (ratio - 0.2) / 0.8));
    return {
      hue: 142 - t * 88, // green → pale yellow as it nears your size
      saturation: 62 + t * 24,
      lightness: 54 + t * 15,
    };
  }

  const t = Math.min(1, (ratio - 1) / 1.4);
  return {
    hue: 48 - t * 44, // amber → red, and dimmer as it gets dangerous
    saturation: 86,
    lightness: 64 - t * 30,
  };
}

function css({ hue, saturation, lightness }: Colour, alpha: number): string {
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

// --- the starfield -----------------------------------------------------------
// One tile, drawn as many times as it takes to cover the window, offset by a
// fraction of the camera position. Tiling means the field is effectively
// infinite no matter how far the arena is panned.

const TILE = 512;
/** How much the stars move relative to the world. Low = very far away. */
const PARALLAX = 0.12;

let starTile: HTMLCanvasElement | null = null;

function buildStarTile(): HTMLCanvasElement {
  if (starTile) return starTile;
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const c = canvas.getContext("2d");
  if (c) {
    const count = 190;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * TILE;
      const y = Math.random() * TILE;
      const big = Math.random() > 0.9;
      const r = big ? 1.1 + Math.random() * 1.0 : 0.45 + Math.random() * 0.6;
      const brightness = (big ? 0.5 : 0.2) + Math.random() * 0.45;
      // A hint of colour temperature stops the field looking like dust.
      const hue = 210 + (Math.random() - 0.5) * 60;
      c.fillStyle = `hsla(${hue}, 45%, 88%, ${brightness})`;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();

      if (big) {
        const halo = c.createRadialGradient(x, y, 0, x, y, r * 5);
        halo.addColorStop(0, `hsla(${hue}, 60%, 85%, 0.16)`);
        halo.addColorStop(1, "hsla(0, 0%, 0%, 0)");
        c.fillStyle = halo;
        c.beginPath();
        c.arc(x, y, r * 5, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  starTile = canvas;
  return canvas;
}

function drawBackground(
  c: CanvasRenderingContext2D,
  camera: Camera,
  view: Viewport,
  t: number,
): void {
  const base = c.createLinearGradient(0, 0, view.width * 0.35, view.height);
  base.addColorStop(0, "#05060d");
  base.addColorStop(0.55, "#070a14");
  base.addColorStop(1, "#020308");
  c.fillStyle = base;
  c.fillRect(0, 0, view.width, view.height);

  // Three enormous, almost invisible clouds on different clocks. Individually
  // nothing; together they stop the black from being flat.
  const clouds = [
    { hue: 214, x: 0.26, y: 0.3, r: 0.66, speed: 0.021, alpha: 0.15 },
    { hue: 272, x: 0.76, y: 0.66, r: 0.58, speed: -0.017, alpha: 0.12 },
    { hue: 176, x: 0.55, y: 0.1, r: 0.46, speed: 0.013, alpha: 0.085 },
  ];
  const driftX = -camera.x * PARALLAX * 0.5;
  const driftY = -camera.y * PARALLAX * 0.5;
  for (const cloud of clouds) {
    const cx = (cloud.x + Math.sin(t * cloud.speed) * 0.05) * view.width + driftX;
    const cy = (cloud.y + Math.cos(t * cloud.speed * 1.3) * 0.04) * view.height + driftY;
    const radius = cloud.r * Math.max(view.width, view.height);
    const nebula = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
    nebula.addColorStop(0, `hsla(${cloud.hue}, 70%, 42%, ${cloud.alpha})`);
    nebula.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    c.fillStyle = nebula;
    c.fillRect(0, 0, view.width, view.height);
  }

  const tile = buildStarTile();
  // A single global shimmer stands in for per-star twinkling, at a fraction of
  // the cost of animating two hundred of them.
  c.globalAlpha = 0.66 + 0.14 * Math.sin(t * 0.7);
  const offsetX = ((-camera.x * PARALLAX) % TILE + TILE) % TILE;
  const offsetY = ((-camera.y * PARALLAX) % TILE + TILE) % TILE;
  for (let x = offsetX - TILE; x < view.width; x += TILE) {
    for (let y = offsetY - TILE; y < view.height; y += TILE) {
      c.drawImage(tile, Math.round(x), Math.round(y));
    }
  }
  c.globalAlpha = 1;
}

function drawVignette(c: CanvasRenderingContext2D, view: Viewport): void {
  const radius = Math.hypot(view.width, view.height) / 2;
  const vignette = c.createRadialGradient(
    view.width / 2,
    view.height / 2,
    radius * 0.55,
    view.width / 2,
    view.height / 2,
    radius,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  c.fillStyle = vignette;
  c.fillRect(0, 0, view.width, view.height);
}

// --- the arena ---------------------------------------------------------------

function drawBounds(c: CanvasRenderingContext2D, world: World, camera: Camera, view: Viewport): void {
  const seen = visibleRect(camera, view);
  const margin = 4000;

  // Darken everything outside the walls, so "out of bounds" is visible rather
  // than merely enforced. Even-odd fill: the outer rectangle minus the arena.
  c.beginPath();
  c.rect(seen.left - margin, seen.top - margin, seen.right - seen.left + margin * 2, seen.bottom - seen.top + margin * 2);
  c.rect(0, 0, world.width, world.height);
  c.fillStyle = "rgba(2, 3, 8, 0.55)";
  c.fill("evenodd");

  // The walls themselves: the body of the instrument, so they get a glow.
  const px = 1 / camera.zoom;
  c.strokeStyle = "rgba(127, 212, 242, 0.16)";
  c.lineWidth = px * 2;
  c.strokeRect(0, 0, world.width, world.height);
  c.strokeStyle = "rgba(127, 212, 242, 0.05)";
  c.lineWidth = px * 10;
  c.strokeRect(0, 0, world.width, world.height);
}

function drawOrb(
  c: CanvasRenderingContext2D,
  orb: Orb,
  playerRadius: number,
  camera: Camera,
  t: number,
): void {
  const colour = colourFor(orb.radius, playerRadius, orb.isPlayer);
  const variant: Variant = orb.isPlayer ? "player" : "mote";
  const px = 1 / camera.zoom;

  // The orbit halo: bigger orb, wider ring. It is also an honest picture of
  // this orb's reach, since gravity here really does scale with area.
  const halo = orbitRadius(orb);
  c.strokeStyle = css(colour, 0.075);
  c.lineWidth = px;
  c.beginPath();
  c.arc(orb.x, orb.y, halo, 0, Math.PI * 2);
  c.stroke();

  // A slow arc travelling that ring, so an orbit looks like a path and not a
  // decoration.
  const sweep = (t * (0.4 + 30 / orb.radius)) % (Math.PI * 2);
  c.strokeStyle = css(colour, 0.2);
  c.lineWidth = px * 1.6;
  c.beginPath();
  c.arc(orb.x, orb.y, halo, sweep, sweep + 0.45);
  c.stroke();

  // The sprite is asked for at the resolution it will actually be drawn at, so
  // zooming in gets sharper instead of blurrier.
  const screenDiameter = orb.radius * 2 * camera.zoom;
  const { canvas, bodyFraction } = orbSprite(colour, variant, screenDiameter);
  const size = (orb.radius * 2) / bodyFraction;
  c.drawImage(canvas, orb.x - size / 2, orb.y - size / 2, size, size);

  // The rhythmic pulse, made visible: a ring leaving the surface as the note
  // sounds. Seeing the beat is half of feeling it.
  if (orb.pulse > 0.01) {
    const spread = 1 + (1 - orb.pulse) * 1.1;
    c.strokeStyle = css({ ...colour, lightness: Math.min(94, colour.lightness + 18) }, orb.pulse * 0.42);
    c.lineWidth = px * (1 + orb.pulse * 2.2);
    c.beginPath();
    c.arc(orb.x, orb.y, orb.radius * spread, 0, Math.PI * 2);
    c.stroke();
  }

  if (orb.flash > 0.01) {
    c.strokeStyle = `rgba(255, 255, 255, ${orb.flash * 0.45})`;
    c.lineWidth = px * (1 + orb.flash * 2.5);
    c.beginPath();
    c.arc(orb.x, orb.y, orb.radius + orb.flash * 6 * px, 0, Math.PI * 2);
    c.stroke();
  }

  if (orb.isPlayer) {
    const pulse = 1 + 0.06 * Math.sin(t * 1.9);
    c.strokeStyle = css(PLAYER_COLOUR, 0.3);
    c.lineWidth = px * 1.4;
    c.beginPath();
    c.arc(orb.x, orb.y, orb.radius * 1.26 * pulse, 0, Math.PI * 2);
    c.stroke();
  }
}

/** A soft flare on whatever is currently being eaten. */
function drawFeeding(c: CanvasRenderingContext2D, world: World, playerRadius: number): void {
  for (const prey of world.orbs) {
    if (prey.feeding < 0.05) continue;
    const colour = colourFor(prey.radius, playerRadius, prey.isPlayer);
    const reach = prey.radius * 2.6;
    const glow = c.createRadialGradient(prey.x, prey.y, 0, prey.x, prey.y, reach);
    glow.addColorStop(0, css({ ...colour, lightness: 88 }, prey.feeding * 0.28));
    glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    c.fillStyle = glow;
    c.beginPath();
    c.arc(prey.x, prey.y, reach, 0, Math.PI * 2);
    c.fill();
  }
}

// --- overlays ----------------------------------------------------------------

export type Overlay = {
  /** An orb being grown under a held pointer or key, in world units. */
  growing?: { x: number; y: number; radius: number };
  /** The throw currently being aimed, in world units. */
  aim?: { fromX: number; fromY: number; toX: number; toY: number };
  /** The keyboard reticle, in world units. */
  reticle?: { x: number; y: number };
};

function drawOverlay(
  c: CanvasRenderingContext2D,
  overlay: Overlay,
  playerRadius: number,
  camera: Camera,
): void {
  const px = 1 / camera.zoom;

  if (overlay.growing) {
    const { x, y, radius } = overlay.growing;
    const colour = colourFor(radius, playerRadius, false);
    const { canvas, bodyFraction } = orbSprite(colour, "mote", radius * 2 * camera.zoom);
    const size = (radius * 2) / bodyFraction;
    c.globalAlpha = 0.82;
    c.drawImage(canvas, x - size / 2, y - size / 2, size, size);
    c.globalAlpha = 1;

    // A dashed shell showing the size it will be, which makes "hold longer"
    // legible without a word of instruction.
    c.strokeStyle = css(colour, 0.55);
    c.setLineDash([6 * px, 7 * px]);
    c.lineWidth = px * 1.4;
    c.beginPath();
    c.arc(x, y, radius + 5 * px, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
  }

  if (overlay.aim) {
    const { fromX, fromY, toX, toY } = overlay.aim;
    const line = c.createLinearGradient(fromX, fromY, toX, toY);
    line.addColorStop(0, css(PLAYER_COLOUR, 0.04));
    line.addColorStop(1, css(PLAYER_COLOUR, 0.5));
    c.strokeStyle = line;
    c.lineWidth = px * 2;
    c.beginPath();
    c.moveTo(fromX, fromY);
    c.lineTo(toX, toY);
    c.stroke();
    c.fillStyle = css(PLAYER_COLOUR, 0.45);
    c.beginPath();
    c.arc(toX, toY, px * 3.5, 0, Math.PI * 2);
    c.fill();
  }

  if (overlay.reticle) {
    const { x, y } = overlay.reticle;
    c.strokeStyle = "rgba(214, 232, 255, 0.38)";
    c.lineWidth = px;
    c.beginPath();
    c.arc(x, y, px * 13, 0, Math.PI * 2);
    c.stroke();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      c.beginPath();
      c.moveTo(x + dx * px * 17, y + dy * px * 17);
      c.lineTo(x + dx * px * 23, y + dy * px * 23);
      c.stroke();
    }
  }
}

// --- the whole scene ---------------------------------------------------------

export function drawScene(
  c: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  view: Viewport,
  dpr: number,
  t: number,
  overlay: Overlay,
): void {
  // Screen space: background.
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackground(c, camera, view, t);

  // World space: the arena, under the camera.
  const scale = dpr * camera.zoom;
  c.setTransform(
    scale,
    0,
    0,
    scale,
    dpr * (view.width / 2 - camera.x * camera.zoom),
    dpr * (view.height / 2 - camera.y * camera.zoom),
  );

  drawBounds(c, world, camera, view);

  const playerRadius = world.orbs.find((orb) => orb.isPlayer)?.radius ?? 26;
  drawFeeding(c, world, playerRadius);

  // Cull to what the camera can see, generously — the halo and bloom of an
  // off-screen orb still reach into the frame.
  const seen = visibleRect(camera, view);
  const visible = world.orbs.filter((orb) => {
    const reach = orbitRadius(orb) + orb.radius;
    return (
      orb.x + reach > seen.left &&
      orb.x - reach < seen.right &&
      orb.y + reach > seen.top &&
      orb.y - reach < seen.bottom
    );
  });

  // Biggest first, so the small ones you are steering stay on top and visible
  // through the giants.
  visible.sort((a, b) => b.radius - a.radius);
  for (const orb of visible) drawOrb(c, orb, playerRadius, camera, t);

  drawOverlay(c, overlay, playerRadius, camera);

  // Screen space again: the vignette sits over everything.
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawVignette(c, view);
}
