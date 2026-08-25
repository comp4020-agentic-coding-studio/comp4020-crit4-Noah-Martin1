// What an Osmos mote actually looks like, layer by layer.
//
// It is not a filled circle. It is a translucent shell: you can see the ones
// behind it, the interior is mottled and darker than the edge, there is a
// bright band of surface tension right at the rim, a hard specular pin on the
// upper left, and a soft caustic crescent on the lower right where light has
// bent through the body. Every one of those layers is doing work — drop any and
// it stops reading as a bubble.
//
// Because the view zooms, one fixed sprite size will not do: a 256px sprite
// stretched over a 900px orb is visibly soft. Sprites are therefore cached per
// resolution tier as well as per colour, and the renderer asks for the tier
// that matches the orb's size on screen right now.

export type Colour = { hue: number; saturation: number; lightness: number };

export type Variant = "mote" | "player";

/** Body diameter as a fraction of the sprite's width; the rest is bloom. */
const BODY_FRACTION = 0.52;

const TIERS = [64, 128, 256, 512, 1024];
/** Sprites are big; keep a lid on the cache and evict the coldest. */
const MAX_CACHED = 96;

const cache = new Map<string, HTMLCanvasElement>();

function css({ hue, saturation, lightness }: Colour, alpha: number): string {
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

/** Deterministic noise, so an orb's mottling is stable frame to frame. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tierFor(screenDiameter: number): number {
  // The sprite's body is only part of its width, so ask for enough pixels that
  // the body itself is at least as wide as it will be drawn.
  const needed = screenDiameter / BODY_FRACTION;
  for (const tier of TIERS) if (tier >= needed) return tier;
  return TIERS[TIERS.length - 1];
}

/**
 * A sprite for this colour at a resolution that suits `screenDiameter`.
 * Colours are bucketed so a slowly growing orb reuses one sprite instead of
 * rasterising a new one every frame.
 */
export function orbSprite(
  colour: Colour,
  variant: Variant,
  screenDiameter: number,
): { canvas: HTMLCanvasElement; bodyFraction: number } {
  const tier = tierFor(screenDiameter);
  const bucket = `${Math.round(colour.hue / 4)}:${Math.round(colour.saturation / 8)}:${Math.round(
    colour.lightness / 4,
  )}`;
  const key = `${variant}:${bucket}:${tier}`;

  const cached = cache.get(key);
  if (cached) {
    // Refresh its place in insertion order so it survives the next eviction.
    cache.delete(key);
    cache.set(key, cached);
    return { canvas: cached, bodyFraction: BODY_FRACTION };
  }

  const canvas = paint(colour, variant, tier, hashOf(bucket));
  cache.set(key, canvas);
  if (cache.size > MAX_CACHED) {
    const coldest = cache.keys().next();
    if (!coldest.done) cache.delete(coldest.value);
  }
  return { canvas, bodyFraction: BODY_FRACTION };
}

function hashOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function paint(colour: Colour, variant: Variant, size: number, seed: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  if (!c) return canvas;

  const centre = size / 2;
  const bodyRadius = (size * BODY_FRACTION) / 2;
  const random = mulberry32(seed);

  const bright: Colour = { ...colour, lightness: Math.min(96, colour.lightness + 26) };
  const deep: Colour = {
    hue: colour.hue,
    saturation: Math.min(100, colour.saturation + 8),
    lightness: Math.max(6, colour.lightness - 34),
  };

  // ---------------------------------------------------------------- 1. bloom
  // The light the orb throws into the dark. Wide and very faint — it is what
  // makes a crowded field feel lit rather than pasted together.
  const bloom = c.createRadialGradient(centre, centre, bodyRadius * 0.7, centre, centre, centre);
  bloom.addColorStop(0, css(colour, 0.22));
  bloom.addColorStop(0.35, css(colour, 0.075));
  bloom.addColorStop(1, css(colour, 0));
  c.fillStyle = bloom;
  c.fillRect(0, 0, size, size);

  // Everything from here is inside the body.
  c.save();
  c.beginPath();
  c.arc(centre, centre, bodyRadius, 0, Math.PI * 2);
  c.clip();

  // ------------------------------------------------------------------ 2. body
  // Dark and clear at the centre, gathering towards the edge. This is the
  // Fresnel effect, and it is the single most important layer: it is why you
  // can see through the middle of a mote to whatever is behind it.
  const body = c.createRadialGradient(centre, centre, 0, centre, centre, bodyRadius);
  body.addColorStop(0, css(deep, 0.3));
  body.addColorStop(0.45, css(colour, 0.2));
  body.addColorStop(0.78, css(colour, 0.3));
  body.addColorStop(0.93, css(colour, 0.52));
  body.addColorStop(1, css(bright, 0.72));
  c.fillStyle = body;
  c.fillRect(0, 0, size, size);

  // ------------------------------------------------------------- 3. mottling
  // Soft cells of slightly different tint drifting inside the body. Osmos
  // motes are not homogeneous; this is what keeps a big orb from looking like
  // flat vector art when you zoom in on it.
  const blobs = 7 + Math.floor(random() * 5);
  for (let i = 0; i < blobs; i++) {
    const angle = random() * Math.PI * 2;
    const distance = random() ** 0.65 * bodyRadius * 0.82;
    const bx = centre + Math.cos(angle) * distance;
    const by = centre + Math.sin(angle) * distance;
    const br = bodyRadius * (0.16 + random() * 0.3);
    const tint: Colour = {
      hue: colour.hue + (random() - 0.5) * 22,
      saturation: colour.saturation,
      lightness: colour.lightness + (random() - 0.5) * 26,
    };
    const blob = c.createRadialGradient(bx, by, 0, bx, by, br);
    blob.addColorStop(0, css(tint, 0.16 + random() * 0.1));
    blob.addColorStop(1, css(tint, 0));
    c.fillStyle = blob;
    c.beginPath();
    c.arc(bx, by, br, 0, Math.PI * 2);
    c.fill();
  }

  // ---------------------------------------------------------- 4. inner rings
  // Faint concentric shells, like surface layers seen through the body.
  for (const [at, alpha] of [
    [0.54, 0.055],
    [0.74, 0.075],
    [0.88, 0.1],
  ] as const) {
    c.strokeStyle = css(bright, alpha);
    c.lineWidth = Math.max(1, size * 0.004);
    c.beginPath();
    c.arc(centre, centre, bodyRadius * at, 0, Math.PI * 2);
    c.stroke();
  }

  // ------------------------------------------------------------- 5. caustic
  // Light that entered the top-left and refocused on the lower-right inner
  // wall. A sphere does this, and the eye reads it instantly as volume.
  const causticX = centre + bodyRadius * 0.3;
  const causticY = centre + bodyRadius * 0.34;
  const caustic = c.createRadialGradient(
    causticX,
    causticY,
    bodyRadius * 0.12,
    causticX,
    causticY,
    bodyRadius * 0.78,
  );
  caustic.addColorStop(0, css(bright, 0.3));
  caustic.addColorStop(0.55, css(bright, 0.1));
  caustic.addColorStop(1, css(bright, 0));
  c.fillStyle = caustic;
  c.fillRect(0, 0, size, size);

  // --------------------------------------------------------------- 6. sheen
  // A broad soft wash on the lit side, under the hard specular below.
  const sheenX = centre - bodyRadius * 0.3;
  const sheenY = centre - bodyRadius * 0.36;
  const sheen = c.createRadialGradient(sheenX, sheenY, 0, sheenX, sheenY, bodyRadius * 0.92);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.2)");
  sheen.addColorStop(0.45, "rgba(255, 255, 255, 0.06)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  c.fillStyle = sheen;
  c.fillRect(0, 0, size, size);

  if (variant === "player") {
    // The player reads as alive: a lit nucleus and a scatter of bright specks
    // suspended in it. It is the one orb you must never lose in a crowd.
    const core = c.createRadialGradient(centre, centre, 0, centre, centre, bodyRadius * 0.46);
    core.addColorStop(0, css(bright, 0.34));
    core.addColorStop(0.6, css(colour, 0.12));
    core.addColorStop(1, css(colour, 0));
    c.fillStyle = core;
    c.fillRect(0, 0, size, size);

    for (let i = 0; i < 14; i++) {
      const angle = random() * Math.PI * 2;
      const distance = random() ** 0.5 * bodyRadius * 0.8;
      const sx = centre + Math.cos(angle) * distance;
      const sy = centre + Math.sin(angle) * distance;
      const sr = Math.max(size * 0.004, bodyRadius * (0.012 + random() * 0.022));
      c.fillStyle = `rgba(232, 250, 255, ${0.18 + random() * 0.3})`;
      c.beginPath();
      c.arc(sx, sy, sr, 0, Math.PI * 2);
      c.fill();
    }
  }

  // ------------------------------------------------------------ 7. inner rim
  // A dark hairline just inside the bright edge. Two adjacent values of
  // opposite sign is what makes an edge look refractive instead of drawn.
  c.strokeStyle = css(deep, 0.5);
  c.lineWidth = Math.max(1, bodyRadius * 0.05);
  c.beginPath();
  c.arc(centre, centre, bodyRadius * 0.945, 0, Math.PI * 2);
  c.stroke();

  c.restore();

  // ------------------------------------------------------------------ 8. rim
  // Surface tension: the brightest thing on the orb, and slightly brighter at
  // the top where the light is.
  const rimWidth = Math.max(1.2, bodyRadius * 0.055);
  const rim = c.createLinearGradient(0, centre - bodyRadius, 0, centre + bodyRadius);
  rim.addColorStop(0, css({ ...bright, lightness: Math.min(98, bright.lightness + 8) }, 0.95));
  rim.addColorStop(0.5, css(bright, 0.72));
  rim.addColorStop(1, css(colour, 0.6));
  c.strokeStyle = rim;
  c.lineWidth = rimWidth;
  c.beginPath();
  c.arc(centre, centre, bodyRadius - rimWidth / 2, 0, Math.PI * 2);
  c.stroke();

  // ------------------------------------------------------------- 9. specular
  // The hard pin of reflected light. Small, bright, off-centre.
  const pinX = centre - bodyRadius * 0.42;
  const pinY = centre - bodyRadius * 0.46;
  const pin = c.createRadialGradient(pinX, pinY, 0, pinX, pinY, bodyRadius * 0.3);
  pin.addColorStop(0, "rgba(255, 255, 255, 0.78)");
  pin.addColorStop(0.28, "rgba(255, 255, 255, 0.24)");
  pin.addColorStop(1, "rgba(255, 255, 255, 0)");
  c.save();
  c.beginPath();
  c.arc(centre, centre, bodyRadius - rimWidth * 0.5, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = pin;
  c.fillRect(0, 0, size, size);
  c.restore();

  return canvas;
}
