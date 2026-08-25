// The camera. The arena is a fixed size in world units and is deliberately
// larger than the window, so the window is a viewport onto it rather than the
// container itself — resizing the browser changes how much you can see, not how
// big the world is.

export type Camera = {
  /** Centre of the view, in world units. */
  x: number;
  y: number;
  /** Screen pixels per world unit. */
  zoom: number;
};

export type Viewport = { width: number; height: number };

export type Bounds = { width: number; height: number };

export const MAX_ZOOM = 3.2;

/** The zoom at which the whole arena just fits, with a little air around it. */
export function fitZoom(bounds: Bounds, view: Viewport): number {
  return Math.min(view.width / bounds.width, view.height / bounds.height) * 0.94;
}

export function minZoom(bounds: Bounds, view: Viewport): number {
  return fitZoom(bounds, view);
}

export function clampZoom(zoom: number, bounds: Bounds, view: Viewport): number {
  return Math.min(MAX_ZOOM, Math.max(minZoom(bounds, view), zoom));
}

/**
 * Keep the view inside the arena. When the arena is narrower than the view at
 * this zoom there is nothing to pan, so it locks to the centre — which is what
 * stops a fully zoomed-out view from sliding around off-centre.
 */
export function clampCamera(camera: Camera, bounds: Bounds, view: Viewport): void {
  const halfWidth = view.width / (2 * camera.zoom);
  const halfHeight = view.height / (2 * camera.zoom);

  camera.x =
    halfWidth * 2 >= bounds.width
      ? bounds.width / 2
      : Math.min(bounds.width - halfWidth, Math.max(halfWidth, camera.x));

  camera.y =
    halfHeight * 2 >= bounds.height
      ? bounds.height / 2
      : Math.min(bounds.height - halfHeight, Math.max(halfHeight, camera.y));
}

export function screenToWorld(
  camera: Camera,
  view: Viewport,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - view.width / 2) / camera.zoom + camera.x,
    y: (screenY - view.height / 2) / camera.zoom + camera.y,
  };
}

export function worldToScreen(
  camera: Camera,
  view: Viewport,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.zoom + view.width / 2,
    y: (worldY - camera.y) * camera.zoom + view.height / 2,
  };
}

/** The world-space rectangle currently on screen, for culling. */
export function visibleRect(
  camera: Camera,
  view: Viewport,
): { left: number; top: number; right: number; bottom: number } {
  const halfWidth = view.width / (2 * camera.zoom);
  const halfHeight = view.height / (2 * camera.zoom);
  return {
    left: camera.x - halfWidth,
    top: camera.y - halfHeight,
    right: camera.x + halfWidth,
    bottom: camera.y + halfHeight,
  };
}
