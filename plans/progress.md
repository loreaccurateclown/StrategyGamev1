# Progress — handoff summary

**Date:** 2026-11-02
**Goal of this session:** rewrite the map generator into a purpose-built Advance Wars–style composer (`scripts/lib/compose-map.cjs`), replacing the `@reldens/tile-map-generator` scatter step entirely. This supersedes the 2026-11-01 handoff. The game engine (`BattleScene`, `TileMapManager`, pathfinding, units) is **unchanged** — the map generator is the only area that moved.

---

## Verified state (2026-11-02)

Everything below was re-run at the end of this session, not copied forward.

| Item | Evidence | Status |
|------|----------|--------|
| Board + map | `64x48 @ 16px = 1024x768px` world, **4 layers**, JSON **26 KB** (was 551 KB) | ✅ |
| Layer names | `ground`, `ground-variations`, `terrain`, `collisions` | ✅ |
| Terrain sidecar | `level_01.terrain.json`, 6 KB, keys `width height tileSize seed paletteHash terrain` | ✅ (G3 done) |
| Layer collapse | 87 → **4** layers | ✅ (G4 done) |
| Determinism | same seed → byte-identical, SHA256 `A0E17FE7…D55C` | ✅ |
| Seed robustness | **20/20 seeds** pass `verifyMap` (1,2,3,4,5,6,7,8,9,10,42,55,88,99,101,1234,2026,314,777,999) | ✅ |
| Typecheck | `npx tsc --noEmit` → exit 0 | ✅ |
| Terrain mix (seed 1234) | forest 10.5 %, water 10.7 %, road 10.5 %, building 2.9 %, mountain 0.6 %, grass 64.9 % | ✅ in band |
| Ranges across 20 seeds | forest 8.7–16.1 %, road 8.4–14.6 %, building 2.3–4.0 % | ✅ |
| Connectivity | **1 component**, 2654/2654 walkable cells | ✅ |
| Roads | **322 cells, 1 component**; 3× (2×2 road blocks), 3 four-ways, 40 T-junctions | ✅ |
| Cities | **89 buildings, 88 with road frontage** (the 1 remainder is 2 tiles from a road) | ✅ |
| Version control | `origin/main` = local `main`, clean tree | ✅ |
| `Pathfinding.ts` / `Pathfinding.test.ts` | absent | ⬜ |
| `TileMapManager.ts` | absent — contract is now frozen, so it is unblocked | ⬜ |
| Units, reachable highlighting, movement, FSM | absent — `BattleScene` only loads and draws | ⬜ |
| Fog, attack, enemy AI | absent | ⬜ |
| `npm test` | fails **before running any test** — `spawn EPERM` | ⚠️ environment |

The board is **64×48 on disk**. The renderer has **not** been updated: `BattleScene` still fits the old 800×600 canvas at zoom 1, so `npm run dev` shows the center of the new board until the 48 px/tile + panning display work lands.

### `npm test` cannot run in this sandbox

```
failed to load config from vite.config.ts
Error: spawn EPERM   (esbuild → child_process.spawn, piped stdio)
```

esbuild spawns a child process with piped stdio, which the confined sandbox blocks (named-pipe restriction). It is an environment limit, **not a project defect**: vitest dies while loading `vite.config.ts`, before test discovery. Consequences:

- `phase_1.md`'s DoD line "`npm test` passes all Pathfinding tests" is currently **unverifiable from inside DSH**. It needs `danger-full-access` or a run outside the sandbox.
- Do not read "npm test failed" as "the tests are broken" — no tests exist yet.

---

## What the composer does (session work)

`scripts/lib/compose-map.cjs` is now the single map source of truth. `@reldens/tile-map-generator` is **no longer used** — it could not express border bands, attached clusters, roads or coastlines, and produced uniform noise.

Pipeline, in order:

1. **Irregular border band** — mostly 1 tile thick, with ~18 % gaps and ~8 % bulges; 2–4 deliberate openings.
2. **Mountain accents** — 5 % of the band, gid 6.
3. **Water** — one full-height channel splitting the map into two landmasses, in one of two looks: a deliberately straight **strait** (5–7 tiles wide, sd 0.00) or a meandering **river** (width 4–18, meander 11–20 tiles, optional pool and funnel-mouthed inlets). A seed picks 2:1 in favour of river; `--water` forces it. Plus the main road skeleton (see below).
4. **Clumps** — 12–18 edge clumps, 8–12 interior clumps, 3–6 mountain clumps, grown by random walk from grass seeds.
5. **Cities** — 8–12 overlapping districts of 8–14 buildings each, gap-separated, neutral gid 9 only.
6. **Roads** — district roads, tip extension, side roads (detailed below).
7. **Coverage normalisation** — grow forest to the 35 % floor, then **trim** interior forest back if total non-grass exceeds the 42 % ceiling.
8. **Gid assignment** — terrain → layer gids, coast autotile, road autotile, bridge assembly, collisions.

### Road planning

These rules took several iterations to settle and are the least obvious part of the generator:

- **Main skeleton is laid before cities** (step 3), so the channel is already crossable when the connectivity guard runs. Without this every city was reverted as "stranding".
- **Only the main skeleton reaches the map edge**: one full-width horizontal road (bridging the channel) and one full-height vertical with a step. **District roads never run to the frame** — trailing into the top/bottom edge reads as junk (tried; 3/4 of seeds looked wrong).
- **Exactly one bridge.** `setRoad(..., allowBridge)` only lets the main horizontal road build over water, and `connectPoint` treats water as blocking. Previously a district could route straight across the channel and silently add a second bridge, splitting the water into three bodies.
- **Orphan prune (5b2).** After district routing, any road component that does not contain `mainRoadSeed` is cleared back to grass. `routeDistrict`'s return value is ignored by its caller, so a district that could not reach the network (common now that it may not bridge) would otherwise leave a detached fragment. It runs *before* tip extension and side roads so those can still reconnect the district over land.
- **District roads are not boxes.** The old rectangular ring made four-way corners that read as unnatural roundabouts. Instead each district gets a **main road through it** — the row/column with the most building frontage — joined to the network at both ends, plus **spurs** to off-road cities.
- **Neighbour skip:** a city is skipped if it is 8-adjacent to an already-served city.
- **Tip extension:** dead-ends extend up to 12 tiles, but only to serve a city or join a road — never to the frame.
- **Side roads:** any city still without road access gets a short spur, so the network reaches every city.
- **Roundabout guard:** `connectPoint` refuses any path completing a **2×2 all-road square**; tip extension blocks a cell with ≥3 road neighbours. T-junctions and bends are fine; 4-ways are what to avoid.
- **Dead-end caps** use the cul-de-sac tiles: 127 (open bottom), 163 (open top), 110 (open right), 112 (open left); isolated tiles use 109.

### Bridge

Deck **131** on the road row with strut **149** in the water cell directly south. Deck counts as ROAD (walkable); strut counts as WATER (impassable). This is the board's **only** bridge: `setRoad` requires `allowBridge`, and district roads are refused over water.

The deck is drawn so the water reads as **flowing freely underneath** — the strut in the water cell below is the only tell. That is deliberate: the water stays severed into two bodies for gameplay while looking continuous to the player. So a vision model reporting "one continuous river" is describing the intended result, not a bug — see the vision-model section in `tooling_notes.md`.

---

## Done and verified (cumulative)

| Item | Evidence |
|------|----------|
| Tile palette verified from pixel data | `node tools/compare-tileset-sources.cjs` — individual tiles match the sheet 197/198 (only gid 43, a UI arrow, differs) |
| `assets/generator/palette.json` | gid ↔ role table with evidence inline; now includes `deadEndTop`/`deadEndBottom` |
| `TerrainType` | Grass 1, Forest 2, Water 3, Mountain 4, Road 5, Building 6 + `TERRAIN_DEFS` |
| Seeded generator | `npm run map:generate` (`--seed`, `--width`, `--height`), deterministic per seed |
| Water styles | `--water` = strait / river / auto. strait keeps the deliberate sd 0.00 canal; river meanders (measured width 4–18, meander 11–20 tiles, optional pool + inlets). 80/80 seeds pass `verifyMap`, output byte-identical per seed in both styles |
| Composer rewrite | `scripts/lib/compose-map.cjs`, 4 layers + terrain sidecar |
| `verifyMap` hardened | board size, tileset header, ground non-zero, gid→terrain drift (flip-masked), forbidden gids, collision == water‖building, occupancy band 32–42 %, connectivity = 1, **road connectivity = 1**, all terrain types present |
| Map render tooling | `tools/render-map-preview.cjs` (full board), `tools/render-road-test.cjs`, `tools/render-tile-test.cjs` |
| Structural QA tool | `tools/map-stats.cjs` — road components, city frontage, walkable components, bridge counts, verdict |

---

## Not done

- `src/core/TileMapManager.ts` — absent (phase 4.2b). **Now unblocked**: the map contract (4 layers + sidecar) is frozen.
- `src/core/Pathfinding.ts` + `Pathfinding.test.ts` — absent.
- Units, reachable-tile highlighting, movement, FSM. `BattleScene` still only loads and draws.
- Renderer display rework — fixed 48 px/tile + panning + `Phaser.Scale.RESIZE`.
- Fog, attack, enemy AI.
- **Dockyard-on-shore rule** (documented, not implemented): ≥1 per shore, +1 if the shore is >6 tiles, max 2 per shore. Needs a "shore" concept the composer does not have yet.
- **Factory placement** — open question whether it belongs to map generation or to spawn logic (leaning spawn logic).
- **Buildings beyond neutral city gid 9** — airport (16), dockyard (13), factory (12), antenna (14) are identified in the palette but not generated.

---

## Key facts to not relearn

1. **Source tile size is 16 px and never changes; the board is 64×48** (1024×768 world px). The *display* plan is fixed **48 px per tile** (integer 3× camera zoom) on a window-filling, pannable canvas. Docs once said "32 px source tiles" — they never were.
2. **Gids are 1-based** (`firstgid: 1`). `groundTile: 0` means *no ground layer*, not "gid 0".
3. **`tilesets[0].name` in the generated JSON is the tileset block name** (`kenney_tinybattle`), not the map name and not the image filename.
4. **Every generator script must be `.cjs`** — `package.json` has `"type": "module"`.
5. **The tileset block must never be edited away.** `verifyMap` checks the tileset header, and `addTilesetImage` needs the block name plus a separate texture key.
6. **A road tile DOES exist** and the full grammar is implemented — horizontal 111, vertical 145, single 109, dead-ends 110/112/127/163, bends 164/166/128/130, tees 165/129/146/148, cross 147, bridge deck 131/167. (The old handoff said "there is no road tile" — that was true of the Kenney *individual tile pack* view, not the sheet.)
7. **Flip flags must be masked before any gid→role lookup**: horizontal `0x80000000`, vertical `0x40000000`; mask with `gid & 0x1FFFFFFF`.
8. **Coast corners are gid 19 + flips**, never the 22/23/24/25 tiles (those carry stray land specks). Out-of-bounds counts as water; a bridge deck counts as water for the coast; buildings count as land.
9. **Forest has two variants**: 95 (edge/single pine) and 113 (interior/two pines). Choose by whether all four cardinal neighbours are forest.
10. **Buildings are impassable** (`passable: false`, `moveCost: Infinity`), so every city placement must re-run the connectivity guard and revert if it strands a pocket.
11. **Only water, buildings and the border band can partition the board.** Forest and mountain are passable (cost 2/3), so dense forest never disconnects — which is why occupancy tuning and connectivity are coupled but not identical.
12. **`neverUseAsTerrain` gids**: 18, 26, 41, 42, 43, 44, 59, 60, 61, 62, 77, 78, 79, 119, 126, 143, 144 — UI arrows, flag animation frames, unconfirmed gid 26, and unit sprites. `verifyMap` fails if any appear in the terrain layer.
13. **`.vscode/todos.json` is gitignored** (`.gitignore` has `.vscode/*` with only `extensions.json` excepted). The task tracker is local-only.
14. **Board size is display-driven, not a tileset constraint.** Tiles verified at 16×16 (`kenney_tinybattle.tsx`: `tilewidth=16`, `spacing=1`, `columns=18`, 198 tiles; PNG 305×186). The old 37×37 cap came from `fitCameraToMap` clamping zoom inside a hardcoded 800×600 canvas. That approach is **retired**; do not resurrect fit-to-window zoom.

---

## `verifyMap`: road-connectivity assertion (added 2026-11-02)

**What it does.** A second flood fill in [`scripts/generate-map.cjs`](../scripts/generate-map.cjs), over terrain `=== 5` (Road), asserting the road graph is **one connected component**. Fails with e.g.:

```
road network is split into 2 components (1 orphan fragment(s), largest 269/327)
```

The success line now also reports `roads: N component(s), largest/total road cells`.

**Why it exists.** The original check only tested *walkable* connectivity (impassable = water + buildings). An orphan road cluster sits on walkable grass, so units could walk around it — the map was technically playable, but the roads visibly did not join up. Seed 577040 shipped a 58-cell orphan district in the SE corner and passed every guard. Frequency measured at **3 of 31 seeds** (42, 12, 577040), i.e. roughly one in ten.

**Do not confuse the two checks.** They answer different questions:

- *walkable* connectivity = "can a unit reach everywhere?" (gameplay correctness)
- *road* connectivity = "does the road network hold together?" (map legibility / aesthetics)

**If we ever want to change it back.** The assertion is self-contained in `verifyMap`; delete the block commented `// road connectivity: ...` (from `const isRoad = (t) => t === 5;` through the `problems.push` for orphan fragments) and drop the `roads:` fragment from the final `console.log`. Nothing else depends on it, and no generator behaviour changes — it is a **guard only**, not a repair pass.

**Known alternative.** Rather than reverting, the better fix is to stop the orphans at the source: a district's connecting path can latch onto its own spur instead of the main network (the same self-connection bug class hit during the road work). Fixing that would let seeds 42/12/577040 generate cleanly instead of being rejected.

---

## Sandbox gotchas (cost real time)

Recorded in [`tooling_notes.md`](./tooling_notes.md); repeated here because every new session hits them:

1. **`GIT_CONFIG_COUNT` is set without `GIT_CONFIG_KEY_*`**, so git aborts with `missing config key GIT_CONFIG_KEY_0`. Unset `GIT_CONFIG_*` at the start of every shell.
2. **schannel TLS fails** (`SEC_E_NO_CREDENTIALS`). `http.sslBackend=openssl` is stored in the repo config.
3. **`git push` needs `danger-full-access`** — the credential helper cannot spawn its shell wrapper under confinement.
4. **Headless Chrome needs `danger-full-access`** — crashpad `OpenProcess: Access is denied`.
5. **`npm test` cannot run** (`spawn EPERM`, esbuild piped stdio). See above.
6. **Model capability matters:** Flash can read images (`read_image`), Pro cannot. Render-judging must happen on Flash.

---

## How to reproduce the verified state

```powershell
# git needs the sandbox env sanitized first (see tooling_notes.md)
npm install
npm run map:generate      # expect: Verified: 64x48 @ 16px, 4 layers | connectivity: 1 component(s)
node tools/map-stats.cjs  # expect: verdict: OK  (1 orphan city is normal)
npx tsc --noEmit          # expect exit 0
node tools/render-map-preview.cjs   # -> tools/previews/map-preview.png
npm run dev               # currently shows board center at old 800x600 zoom - renderer rework pending
```

Two runs with the same seed must produce an identical file:

```powershell
npm run map:generate -- --seed 1234
(Get-FileHash public\assets\maps\level_01.json).Hash
npm run map:generate -- --seed 1234
(Get-FileHash public\assets\maps\level_01.json).Hash
```

---

## Suggested next step

The generator is in good shape and the map contract is **frozen** (4 layers + terrain sidecar). The critical path is now the game engine:

1. **`TileMapManager` (4.2b)** — read the 4 layers + sidecar, no gid reverse-mapping. Unblocked now.
2. **Renderer display rework** — 48 px/tile, panning, `Phaser.Scale.RESIZE`.
3. **`Pathfinding.ts` + tests** — can run in parallel; own fixtures, no map dependency.
4. **Units + reachable highlighting + movement.**

Generator work that can wait but is known: dockyard-on-shore, factory placement decision, generating non-neutral buildings (airport/dockyard/factory) once spawn logic exists.

---

## Decisions settled

- **`todo.md` retired.** The actionable list is `.vscode/todos.json` (Todo It). Do not recreate it.
- **`getTerrainCost` stays.** `getReachableTiles` keeps its cost-function parameter and a `number[][]` grid, per `phase_1.md`.
- **The map contract is frozen** at 4 layers + terrain sidecar. `TileMapManager` can be written against it.
- **Display strategy settled — fixed 48 px/tile + panning, board 64×48.** Source art stays 16 px; the 3× is integer camera zoom. Canvas fills the window (`Phaser.Scale.RESIZE`).
- **`@reldens/tile-map-generator` is dropped** in favour of the purpose-built composer. Do not reintroduce it.
- **Roads connect to the nearest road (network), not to the map edge.** Roads form one connected lattice; edge-running is limited to the main skeleton.
- **District roads are through-roads, not rings.** Rectangular boxes produced unnatural four-way "roundabouts"; a main road through the district plus spurs matches the AWBW reference maps.
- **Some cities may be left off the network** if they are close to another served city — the user confirmed this is acceptable.
- **Still open (tracked):** `UnitType` is declared as an object type in `src/types/game.types.ts` but specified as a string-literal union in `phase_1.md`.

---

## Scratch files to clean up eventually

Dev-only, safe to delete, not in any build path (gitignored):

- `tools/palette-inspector.html`, `tools/tile-picker.html` — palette viewers
- `tools/*.txt` — generated reports
- `tools/previews/*.png` — every generated render (`map-preview.png` is regenerated each run)
- `tools/vision_input/{unread,read}/` — screenshots handed to the vision model by path, since images cannot be pasted into chat. Drop new captures in `unread/`, they move to `read/` once analysed; the folder accumulates and is gitignored. See `tooling_notes.md` → "Feeding images in".
- `tools/awmaps/*.png` — AW reference map rips (not our renders)
- `.playwright-mcp/` — browser tool output
