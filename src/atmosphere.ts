// Idle motion.
//
// A page where nothing moves until you touch it does not read as quiet — it
// reads as broken, or as a screenshot. The difference between "waiting" and
// "paused" is that something is always drifting, and it costs almost nothing:
// a hundred motes on slow diagonal courses, and two enormous soft clouds
// wandering behind them.
//
// All of it is deliberately below the threshold where you would call it an
// animation. If a viewer notices the dust, it is too strong.

type Mote = {
  x: number;
  y: number;
  /** World units per second. */
  driftX: number;
  driftY: number;
  radius: number;
  brightness: number;
  /** Twinkle phase and rate. */
  phase: number;
  rate: number;
};

type Cloud = {
  x: number;
  y: number;
  radius: number;
  hueOffset: number;
  alpha: number;
  /** Radians per second around its own slow ellipse. */
  speed: number;
  wanderX: number;
  wanderY: number;
};

export type Atmosphere = {
  resize: (width: number, height: number) => void;
  update: (dt: number) => void;
  /** Drawn behind everything. `hue` follows whatever instrument is in front. */
  draw: (c: CanvasRenderingContext2D, t: number, hue: number) => void;
};

export function makeAtmosphere(): Atmosphere {
  let width = 1;
  let height = 1;
  let motes: Mote[] = [];
  let clouds: Cloud[] = [];

  function seed(): void {
    // Density by area, so a wide window does not look emptier than a tall one.
    const count = Math.min(150, Math.round((width * height) / 13000));
    motes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      // Mostly sideways and slightly upward: falling dust reads as snow, and
      // rising dust reads as embers. Neither is what this wants.
      driftX: (Math.random() - 0.5) * 7,
      driftY: (Math.random() - 0.62) * 4,
      radius: Math.random() < 0.85 ? 0.5 + Math.random() * 0.7 : 1.2 + Math.random() * 0.9,
      brightness: 0.1 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      rate: 0.15 + Math.random() * 0.5,
    }));

    clouds = [
      { x: 0.3, y: 0.34, radius: 0.62, hueOffset: -14, alpha: 0.05, speed: 0.021, wanderX: 0.05, wanderY: 0.035 },
      { x: 0.72, y: 0.66, radius: 0.5, hueOffset: 22, alpha: 0.04, speed: -0.016, wanderX: 0.04, wanderY: 0.03 },
    ];
  }

  return {
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      seed();
    },

    update(dt) {
      for (const mote of motes) {
        mote.x += mote.driftX * dt;
        mote.y += mote.driftY * dt;
        mote.phase += mote.rate * dt;

        // Wrap rather than respawn, so the field never visibly thins or clumps.
        const margin = 8;
        if (mote.x < -margin) mote.x = width + margin;
        if (mote.x > width + margin) mote.x = -margin;
        if (mote.y < -margin) mote.y = height + margin;
        if (mote.y > height + margin) mote.y = -margin;
      }
    },

    draw(c, t, hue) {
      for (const cloud of clouds) {
        const cx = (cloud.x + Math.sin(t * cloud.speed) * cloud.wanderX) * width;
        const cy = (cloud.y + Math.cos(t * cloud.speed * 1.3) * cloud.wanderY) * height;
        const radius = cloud.radius * Math.max(width, height);
        const haze = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
        haze.addColorStop(0, `hsla(${hue + cloud.hueOffset}, 58%, 44%, ${cloud.alpha})`);
        haze.addColorStop(1, `hsla(${hue + cloud.hueOffset}, 58%, 40%, 0)`);
        c.fillStyle = haze;
        c.fillRect(0, 0, width, height);
      }

      for (const mote of motes) {
        // Twinkle never reaches zero: motes fade, they do not blink.
        const shimmer = 0.55 + 0.45 * Math.sin(mote.phase);
        c.fillStyle = `hsla(${hue + 6}, 32%, 86%, ${mote.brightness * shimmer})`;
        c.beginPath();
        c.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
}
