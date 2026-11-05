# Composer brief — map generator rewrite (handoff to Pro)

**State:** planned, not started.
**Rule for the next agent:** on taking over, **halt and confirm the plan with the user
before writing any code.** The user asked for this explicitly (2026-11-01).

---

## Goal

Replace the `@reldens/tile-map-generator` scatter step in `scripts/generate-map.cjs`
with a purpose-built composer that produces Advance Wars 1 style battle maps.
The scatter placer reserves `(w+2f)×(h+2f)` per element and drops non-overlapping
copies, so it cannot express border bands, attached clusters, roads or coastlines —
that is why the current map reads as uniform noise.

## Settled decisions

| Decision | Value |
|---|---|
| Board | 64×48 tiles, 16 px → 1024×768 world px, displayed at 48 px/tile |
| Obstacle coverage | 36 % (band 32–42 %, asserted) |
| Scope this pass | **terrain + roads + bridges** — buildings deferred |
| Tileset source | contiguous `Tilemap/tilemap.png` (art identical to the individual tiles: 197/198, one UI-arrow pixel diff) |
| Water | lakes/coast only — **no rivers exist in the sheet** |
| Coast corners | gid **19 + flip flags** (H/V/both); straights 20 / 37 / 39; south is `20|V`, **not** 56; fill 38; inner corners 91–94 |
| Mountains | gid 6, single tile, **accents only**; forest carries the framing |
| Determinism | same seed ⇒ byte-identical output, as today |
| Verification | keep and extend `verifyMap` (occupancy band, connectivity, footprints) |

## Reference documents

- [`tile_roles.md`](./tile_roles.md) — authoritative gid → role table (terrain,
  coast, roads, bridges, buildings, UI sprites that must **never** be terrain)
- [`aw_style.md`](./aw_style.md) — the AW1 grammar being imitated and the
  reference renders in `tools/previews/`
- [`phase_4.md`](./phase_4.md) — G1/G2 done, G3 (terrain sidecar) and G4 (layer
  merge) still pending; the composer should deliver both naturally

## Work items

1. **`assets/generator/palette.json`** — rewrite from `tile_roles.md`. It is
   currently wrong: forest maps to buildings (27–31), mountain maps to roads
   (111/129/…), and the movement-arrow gids would be usable as terrain.
   New structure should describe *roles*, not just a terrain colour table.
2. **`scripts/lib/compose-map.cjs`** (new) — the composer:
   - fill ground (grass 1, variations 2/3)
   - irregular border band: forest-heavy (95 at edges, 113 inside), mountain
     accents (6), thickness 1–4 varying per side, 2–4 deliberate openings
   - clusters grown *from* the band inward (random-walk blobs, size distribution)
     rather than placed at random positions
   - 1–2 lakes, rectangular-ish with the coast autotile (19 + flips + 20/37/39 + 38;
     the south bank is `20|V`, **not** 56 — see progress.md fact 10)
   - 1–2 roads edge to edge with bends and a bridge crossing a lake
     (131 / 167 / 149 + 74 for pillar reflections)
   - keep 2–3 wide open plains lanes through the middle
   - emit ~5 layers: `ground`, `ground-variations`, per-terrain or merged visual
     layers, one merged `collisions` layer; plus the G3 `level_01.terrain.json`
     sidecar
3. **`scripts/generate-map.cjs`** — wire the composer in, keep the CLI
   (`--seed`, `--width`, `--height`), keep the tile-sheet copy and every
   `verifyMap` assertion.
4. **`verifyMap`** — mask flip bits before gid→role lookup; keep occupancy band,
   flood-fill connectivity (one component), visual/collision footprint agreement,
   board-size guard; add role-aware checks (e.g. every road tile has a road
   neighbour, coast tiles only border water/land consistently).

## Hard constraints

- **Never use UI gids as terrain:** 41, 42, 43, 44, 59, 60, 61, 62, 77, 78
  (movement arrow + main cursor).
- **Never use gid 26** — unconfirmed role ("signboard?"), user asked to hold off.
- Flips: horizontal `0x80000000`, vertical `0x40000000`; mask before role lookup.
- Board must stay exactly the requested size — the generator silently growing the
  map was a real past failure.
- Same seed ⇒ byte-identical JSON + sidecar.

## Definition of done

- `npm run map:generate` prints occupancy inside 32–42 %, connectivity = 1
  component, and the board size it was asked for.
- A rendered preview (`node tools/render-map-preview.cjs`) shows: framed
  border band with openings, clusters attached to it, at least one lake with a
  continuous sand coastline, at least one road with bends and a bridge, and open
  central lanes.
- Same-seed determinism verified; `npx tsc --noEmit` clean.
- Reference renders live in `tools/previews/` (gitignored); update the docs when they change.

## Visual iteration loop

Implementation and verification are Pro work. **Judging the render is Flash work**
(it can read images): after the composer runs, swap to Flash, run
`node tools/render-map-preview.cjs`, look at the PNG, and iterate on shapes and
density. Useful helpers already exist:

- `tools/render-map-preview.cjs` — full-board PNG from the map JSON
- `tools/render-tile-test.cjs` — hand-authored gid layouts with flip support
- `tools/make-montage.cjs` — compile several PNGs into one comparison sheet
- `tools/upscale-png.cjs` — nearest-neighbour zoom for reading 16 px art

## Water (as implemented)

The board has **one** water region spanning the full height, so it splits the map
into two landmasses and the single horizontal bridge is a real chokepoint. Two
looks exist; a seed draws one at random (2:1 in favour of `river`), and
`--water strait|river|auto` on `generate-map.cjs` forces it.

- **`strait`** — constant centre, constant width (5 or 7 tiles), width sd exactly
  0.00. The absence of variance is the point: it reads as an engineered cut, a
  legitimate AW look and the cleanest chokepoint. Kept deliberately.
- **`river`** — the centreline is a sum of two sines (a broad bend plus a smaller
  kink) so the banks curve instead of stepping one tile at a time; half-width
  breathes along the course, and ~60% of rivers widen into a pool. Measured over
  12 seeds: width 4..18, width sd 1.3..3.3, meander (centroid travel) 11..20
  tiles, where the old strait measured a flat 7 wide with sd 0.00 and no travel.

Three invariants, each of which was a real bug first:

- **Exactly one bridge.** `setRoad(x, y, orientation, allowBridge = false)` only
  lets the main horizontal road build over water; district roads are refused and
  `connectPoint` now treats water as blocking. Before that, a district could route
  across the channel and silently make a second bridge, splitting the water into
  three bodies (seed 42).
- **Tributaries cannot float free.** A spur leaves the bank as a funnel (3 tiles
  tall, then 2, then 1) and starts from the *actually carved* bank, not the
  analytic centreline — a pool pushes the real bank further out, and a spur begun
  inside the channel reads as a notch. Spurs never reach the map edge, or they
  would seal a pocket behind them.
- **No land pockets.** After carving, any land not reachable from the left or
  right edge is enclosed by water and gets filled. A spur curling back at a sharp
  bend otherwise left a 2-cell island that `verifyMap` rejected — and on seed 16
  that starved city placement completely (0 buildings).

`verifyMap` enforces the result: 1 walkable component, 1 road component, bridge
deck only on the main road. 80/80 seeds pass, and output is byte-identical for a
repeated seed in both styles.

## Road planning (as implemented)

The AW road grammar settled over several iterations. The rules below are the
current behaviour in `scripts/lib/compose-map.cjs` and are non-obvious enough to
keep documented:

- **Main skeleton (step 3b), the only roads that reach the map edge:** one
  horizontal road spanning the full width (bridges the channel with deck 131 over
  struts 149 — the only road allowed to build over water), one vertical road
  spanning the full height with a single step. Laid *before* cities so the channel
  is crossable when the connectivity guard runs.
- **Orphan prune (5b2):** after district routing, any road component that does not
  contain the main-road cell is cleared back to grass. `routeDistrict`'s return
  value is ignored by its caller, so a district that could not reach the network
  (now common, since it may no longer bridge) would otherwise leave a detached
  fragment. Runs *before* 5c/5d so those passes can still reconnect it over land.
- **District roads (routeDistrict):** each city cluster gets a **main road
  through it** — the row or column with the most building frontage — connected to
  the network at both ends, not a box/ring (a ring's 4-way corners read as
  unnatural roundabouts). Short **spurs** reach off-road cities; a city is only
  skipped when 8-adjacent to an already-served city.
- **Tip extension (5c):** dead-ends extend up to 12 tiles to serve a city or join
  a road. They **never run to the map frame** — trailing a road into the top or
  bottom edge reads as junk (tried and rejected: 3/4 looked wrong).
- **Side roads (5d):** any city still without road access gets a short spur to
  the nearest road, so the network reaches every city.
- **Roundabout guard:** `connectPoint` refuses any path that would complete a
  2×2 all-road square (`formsBlock`), and the tip extension blocks a cell with
  ≥3 road neighbours. T-junctions and bends are allowed; 4-ways are the thing to
  avoid.
- **Dead-end caps:** a road cell with one neighbour uses the cul-de-sac tile —
  127 (open bottom), 163 (open top), 110 (open right), 112 (open left); isolated
  single tiles use 109.
- **Coverage:** after normalisation grows forest to the 35% floor, a **forest-trim
  pass** thins interior forest (never the border band, roads, buildings or water)
  back to grass if dense roads + max cities push non-grass past the 42% ceiling.
