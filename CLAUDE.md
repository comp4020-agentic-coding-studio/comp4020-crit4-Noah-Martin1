im using claude to create a user interactive sound / musical website. I want the website to be like a sound garden, but have the aesthetics of the video game "osmos" the orbiting blob game. I want the user the be able to:

AESTHETICS:
aesthetic space website that uses modern stylign and is neat

SOUND DESIGN:
there is a subtle soudntrack playing in the background to compliment the orb interaction sound effects.

depending on their size they have a different colour and sound when they bounce off something. sound should be two detuned saws plus a sub - to create a harmonic interface size could effect the pitch and minor pentatonic, so nothing clashes.

INTERACTION:
I want to have smaller orbs be absorved by larger ones when they collide, and they will make a note when this happens. 

FIRST PAGE:

The screen starts with the main ball - just like in osmos its the light blue one, the user can interact with this by swiping at it to "flick" it around the container (fullscreen). it bounces off the walls making a quiet harmonic noise when it does. 

the user clicks the container to add more orbs, click and hold to make them larger. their colour changes depending on their size. From a green hue when realy small to a lighter yellow when theyre almost the size of the main orb and red and darker red when theyre larger. Each of the orbs have orbits - just like osmos. The larger they are the greater the orbit.

SECOND PAGE:
prompted by a “next” button the second page will have the same emchanics but intsead of a blank canvas, there will be a container pre filled just like an osmos level, this one will be one large singularity orbs with smaller orbs orbiting it. Refer to the approriate osmos level for reference. 

FOR UNANSWERED QUESTIONS:
refer to screenshots and game design of the osmos game.



## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## What this prototype holds to

Conventions the work has earned. Break them deliberately, not by accident.

- **One scale, everywhere.** Every pitch comes from the minor pentatonic built
  in `src/audio.ts`. Nothing picks a frequency of its own, which is what makes
  "no way to play it wrong" true of the sound and not just the rules.
- **Size is the only voice control.** Radius decides pitch (log-mapped, big =
  low) and colour. Adding a second, independent mapping would break the link
  between what you see and what you hear.
- **The player is never eaten.** `PLAYER_FLOOR` in `src/world.ts` is the whole
  no-fail-state guarantee: at the floor the player is pushed clear with a low
  note. Anything that can remove the player orb is a bug against the spec.
- **No score, no failure text.** `spec/instrument.test.ts` asserts this, so
  adding a counter to the UI turns the suite red on purpose.
- **Nothing sounds before the first gesture.** No `AudioContext` is constructed
  until `wake()` is called from a real event. Don't build one at module load.
- **Synthesis only.** No audio files, ever — the spec test fails on any
  `.mp3`/`.wav`/etc. in `dist/`.

## Stack facts that bite

- **`tsconfig.json`'s `include` is a whitelist, and `*.ts` is root-level only.**
  A new source directory left off that list is not typechecked, and
  `pnpm typecheck` passes in silence. `src` and `prototypes` are listed; add the
  next one.
- **`prototypes/` is in `vite.config.ts`'s `SKIP`.** Sketches stay in git as
  process evidence and out of `dist/`. A page you actually want deployed has to
  live outside that directory.
- **The card check.** `spec/instrument.test.ts` resolves each page's `og:image`
  against that page's directory and asserts the file is in the build — the gap
  the shipped invariants leave open. Both levels sit at the root, so
  `./card.png` is right for them; a page in a subdirectory needs `../card.png`.

## The arena and the camera

- **The window is a viewport, not the container.** Arena size lives in `ARENAS`
  in `src/instrument.ts`, in world units, and is deliberately bigger than any
  screen. Resizing the browser changes how much you can see; it never changes
  the world. Nothing outside `src/camera.ts` should convert between screen and
  world coordinates — use `screenToWorld`/`worldToScreen`.
- **Two coordinate systems, one transform switch.** `drawScene` draws the
  starfield and vignette in screen space and the arena in world space. Anything
  that must keep a constant thickness on screen while zoomed divides by
  `camera.zoom` (the `px` local in `src/render.ts`).
- **Orb sprites are cached per colour *and* per resolution tier.** A single
  fixed sprite size goes soft as soon as you zoom in, so `src/orb-sprite.ts`
  rasterises at the tier matching the orb's current on-screen diameter and
  evicts the coldest entries past `MAX_CACHED`. If you add a visual variant, add
  it to the cache key or every orb will share one look.
- **Gestures are measured in screen pixels, then converted.** A flick divides by
  zoom on release, so the same hand movement throws the same distance on screen
  at any zoom. The grab radius does the same in reverse.

## The rhythm

The field keeps time with itself. This is the spine of the sound design, not a
decoration on it.

- **One beat, whole multiples of it.** `BEAT` in `src/instrument.ts` is the only
  tempo. Every orb pulses on a cycle of 2, 3, 4, 6 or 8 beats, chosen by size in
  `divisionFor`. Nothing sounds off the grid, so nothing can sound arrhythmic.
- **The cycle lengths are not powers of two on purpose.** 3-against-4 and
  6-against-8 drift in and out of phase, so the pattern takes 24 beats to
  repeat. Replacing them with 2/4/8/16 would collapse the polyrhythm into one
  bar.
- **The beat clock runs on real time; the simulation runs on `TIME_SCALE`.**
  Slowing the physics must never change the tempo. Keep the two clocks separate.
- **The population *is* the composition.** An orb's size sets its pitch, its
  cycle and its loudness, so growing one, feeding one, or letting one be eaten
  re-tunes the pattern. Any new mechanic should change the music by changing the
  orbs, not by adding a separate music system.
- **Only what is on screen speaks,** and at most `PULSE_BUDGET` orbs per beat,
  biggest first. A dropped tick is far less audible than a dropped bass note.

## Orbits and gravity

- **Gravity is restricted, not n-body.** Only orbs at or above
  `ATTRACTOR_RADIUS` pull, and never on something bigger than themselves. Full
  n-body attraction had every satellite tugging every other one, so a stable
  ring tore itself apart unaided and you could not tell your own interference
  from the system's drift. `spec/orbits.test.ts` pins this down: a shell holds
  its radius for four simulated minutes, the central orb never moves, and a
  player collision *does* knock a satellite off. All four assertions are the
  contract — don't loosen them to make a physics change pass.
- **No drag, anywhere.** A damping term is orbital decay by another name.
- **The integrator is leapfrog, not Euler.** Kick, drift, kick. Plain Euler
  bleeds energy every step, which reads as orbits mysteriously spiralling in.
- **Two clocks.** `TIME_SCALE` slows the simulation; the beat clock and the
  growth gesture stay on the wall clock. Anything expressed per
  simulation-second that a hand controls — `THRUST`, the flick velocity — is
  divided by `TIME_SCALE` so the player's own gestures keep full authority
  while the world stays slow.
