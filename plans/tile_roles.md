# Kenney tiny-battle tile roles — confirmed map

Authoritative gid→role table for the generator, built from user identification
of the labelled tile renders (2026-11-01) plus rendered tiling tests.

`gid = tile index in the sheet + 1` (Tiled `firstgid = 1`).
Sheet: `assets/import/kenney_tiny-battle/Tilemap/tilemap.png`, 18 columns,
16 px tiles, 1 px spacing, 198 tiles.

> **`assets/generator/palette.json` is currently WRONG** and must be rewritten
> from this table. Its "forest" (27–31) is actually buildings, and its
> "mountain" (111, 129, 131, …) is actually roads/stone.

## Confirmed by the user

### Terrain
| gid | role |
|-----|------|
| 1 | grass plain (base fill) |
| 2, 3 | grass variants (2 = speckles, 3 = flowers) |
| 95 | **forest** — single pine; use at forest edges |
| 113 | **forest** — two pines; use in the interior/thick parts |
| 6 | **mountain** — the only mountain tile in the sheet |
| 38 | **water** fill |
| 58 | waterfall / water-flow indicator (not a fill tile) |

### Coastline (water ↔ grass, with a sand band on the land side)
| gid | orientation |
|-----|-------------|
| 19 | corner, land **top-left** |
| 21 | corner, land **top-right** |
| 20 | edge, land **north** (straight) |
| 37 | edge, land **west** |
| 39 | edge, land **east** |
| 56 | edge, land **south** |
| 4 | land bank along top-left edge, running bottom→top |
| 5 | land bank along top-right edge, running top→bottom |
| 22 | corner, land bottom-left, **plus a stray land speck top-right** |
| 23 | corner, land bottom-right, **plus the same stray speck** |
| 55 | corner, land bottom-left (paired with 22 — unconfirmed difference) |
| 57 | corner, land bottom-right (paired with 23 — unconfirmed difference) |
| 40 | water with tiny land bits at bottom-left and bottom-right (bridge/inlet/pipe context) |
| 94 | water fill **plus a tiny land speck at bottom-left** |
| 73 | water, land notch **top-right** |
| 75 | water, land corner **top-left** |
| 76 | water, land corner **top-left** (larger/different case than 75) |
| 91 | water, land **top-left**, larger again |
| 92 | water, land **top-right** with a sand/beach edge joining the green |
| 93 | water fill plus a green speck bottom-right |
| 74 | water, land band **north**, with **reflections of pillars** — designed to sit behind a bridge or other structure |

**Rendering test result:** the sheet's own bottom corners (22/23) produce odd
pale patches and break the beach line. Building all four corners from **19 plus
horizontal/vertical flips** gives a continuous sand ring and correct rounding —
see `tools/tiles/coast-test-a.png` vs `coast-test-b.png`. Tiled/Phaser gids
carry flip flags, so this needs no extra art.

### Roads and bridges
| gid | role |
|-----|------|
| 111 | road, horizontal (x-axis) |
| 145 | road, vertical (y-axis) |
| 127 | road dead end, open to the bottom, closed at the top |
| 163 | 127 flipped (dead end open upward) |
| 128 | road bend, upper-right |
| 130 | road bend, upper-left |
| 164 | road bend, lower-left |
| 129 | three-way intersection connecting 128 and 130 |
| 146 | three-way intersection, branch pointing right |
| 148 | 146 flipped — branch pointing left |
| 165 | three-way intersection, branch pointing up |
| 147 | four-way intersection |
| 166 | road bend, lower-right |
| 131 | **bridge** (plain, over water or a gap) |
| 167 | **bridge**, vertical |
| 149 | **bridge, horizontal** — the deck's underside; struts extend into the water, pairs with 74 (pillar reflections) |

Roads can be mirrored with flip flags to fill the remaining orientations
(e.g. a lower-right bend = 128 flipped, a dead end open left = 127 rotated).
`166`, `167` are unconfirmed candidates for the missing pieces.

### Buildings
| gid | role |
|-----|------|
| 27 | city — generic, most common (generates income) |
| 28, 29 | city variants (special buildings) |
| 30 | factory — produces land units |
| 31 | dockyard — produces naval units |

The whole sheet repeats building/unit sets per faction colour: gray, green,
blue, red, orange.

## UI sprites — never terrain

The blue "movement arrow" is UI, **not water**. Confirmed parts:

| gid | role |
|-----|------|
| 41 | arrow head, up |
| 42 | arrow head, left |
| 44 | arrow head, right |
| 77 | arrow head, down |
| 43 | arrow body, horizontal |
| 59 | arrow body, vertical |
| 60 | arrow bend, upper-right |
| 61 | arrow bend, upper-left |
| 78 | arrow bend, lower-left |
| 62 | **unit selection cursor / main game cursor** — the most important sprite in the sheet |

`palette.json` must never map any of these to terrain. The first draft of this
file wrongly assumed 59–62 and 77–78 were river channel pieces.

### There are no river tiles

Because 59–62/77–78 are the arrow UI, the sheet has **no 1-tile river channel**.
Water is either fill (38) with the coast set around land, or the flow marker
(58). AW-style rivers running edge-to-edge **cannot be reproduced with this
tileset** — water has to be lakes/coast, and any "river" would have to be a
thin lake using the coast tiles.

## Obstacles and vehicles
| gid | role |
|-----|------|
| 24 | Czech hedgehog — grey/neutral anti-tank defence; obstacle, blocks pathing |
| 25 | grey/neutral car — vehicle; blocks pathing, maybe environment interactivity much later |

## Pending
- **26** — looks like a signboard but is unconfirmed. **Do not use it anywhere**
  until the user verifies what it is.
- Whether `55`/`57` differ meaningfully from `22`/`23`.
- Water variants: only 38 (fill), 58 (flow marker), 94 (fill + land speck) and
  the coast set are confirmed. `72–76`, `91–93` and `149` still need identification.

## Mountain: confirmed, but only one tile

The user confirmed **gid 6 is the mountain** (the tan/brown dome with the band
along its bottom edge). Consequences:

- `TerrainType.Mountain` **does** have art — it is not a dead terrain type.
- There is exactly **one** mountain tile and **no variants** (contrast: grass
  1–3, forest 95/113). A ridge built from repeated gid 6 will read as a flat
  repeated stamp.
- The tile carries a band along its bottom edge, so it is likely drawn to sit
  where the mountain meets another surface; worth a rendering test before it is
  used in bulk.
- Practical guidance for the composer: use mountains sparingly as accents —
  small clusters at the border band, or as ridge punctuation — and carry the
  AW "framing" look mostly with forest (which has two variants and blends).

## Tileset source: individual vs contiguous — RESOLVED

Rendered the same 13×9 coast test from `Tiles/tile_NNNN.png` (individual) and
from `Tilemap/tilemap.png` (contiguous): **visually identical**. Programmatic
diff of all 198 tiles: **197 identical, 1 differing** — gid 43 (128 px), which
is a UI arrow, not terrain.

Consequences:
- The stray pixels in the coast tiles are **real art**, not slicing bleed.
  Switching to `kenney_tinybattle_indiv.tsx` would not fix them.
- No reason to change source; keep the contiguous sheet (one texture for Phaser,
  simple `gid - 1` maths).
- `tilemap_packed.png` (288×176, spacing 0, 18 cols) carries the same art and
  would simplify offsets, but offers no visual gain.

## Tooling notes
- Kenney's individual tiles mix PNG formats: `tile_0000.png` is RGBA 8-bit,
  `tile_0037.png` is **2-bit indexed**. Any decoder must handle indexed bit
  depths 1/2/4/8. `tools/compare-tileset-sources.cjs` does; the older
  `tools/tile-rgb.cjs`, `tools/upscale-png.cjs` and `tools/render-map-preview.cjs`
  are 8-bit only and will silently mis-read the individual tiles.
- `tools/render-tile-test.cjs` renders arbitrary gid layouts with flip support —
  use it to settle autotile questions before writing them into the generator.
