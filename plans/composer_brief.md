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
| Coast corners | gid **19 + flip flags** (H/V/both); straights 20/37/39/56; fill 38 |
| Mountains | gid 6, single tile, **accents only**; forest carries the framing |
| Determinism | same seed ⇒ byte-identical output, as today |
| Verification | keep and extend `verifyMap` (occupancy band, connectivity, footprints) |

## Reference documents

- [`tile_roles.md`](./tile_roles.md) — authoritative gid → role table (terrain,
  coast, roads, bridges, buildings, UI sprites that must **never** be terrain)
- [`aw_style.md`](./aw_style.md) — the AW1 grammar being imitated and the
  reference renders in `tools/tiles/`
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
   - 1–2 lakes, rectangular-ish with the coast autotile (19 + flips + 20/37/39/56 + 38)
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
- Reference renders committed to `tools/tiles/` are gitignored; update the docs.

## Visual iteration loop

Implementation and verification are Pro work. **Judging the render is Flash work**
(it can read images): after the composer runs, swap to Flash, run
`node tools/render-map-preview.cjs`, look at the PNG, and iterate on shapes and
density. Useful helpers already exist:

- `tools/render-map-preview.cjs` — full-board PNG from the map JSON
- `tools/render-tile-test.cjs` — hand-authored gid layouts with flip support
- `tools/make-montage.cjs` — compile several PNGs into one comparison sheet
- `tools/upscale-png.cjs` — nearest-neighbour zoom for reading 16 px art
