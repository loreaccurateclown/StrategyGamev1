# Progress — handoff summary

**Date:** 2026-11-01
**Goal of this session:** establish where the project actually stands (planning mode), restore version control, and fix the map-generator plan so client-side map reading is written once. This supersedes the 2026-10-31 handoff; its durable content is folded in below.

---

## Verified state (2026-11-01)

Everything below was re-run this session, not copied from the previous handoff.

| Item | Evidence | Status |
|------|----------|--------|
| Board + map | `32x32 @ 16px = 512x512px`, 27 layers, ground layer `1024/1024` non-zero | ✅ |
| Determinism | `npm run map:generate` (seed 1234) → SHA256 `F3218928…D717DE`, **byte-identical before/after** | ✅ |
| Typecheck | `npx tsc --noEmit` → exit 0 | ✅ |
| Terrain mix | forest 96, water 75, mountain 48 = **219/1024 cells = 21.4 %** | ✅ (sparse) |
| Palette | `assets/generator/palette.json`, gid ↔ terrain verified against pixel data | ✅ |
| Version control | restored this session — see below | ✅ |
| `Pathfinding.ts` / `Pathfinding.test.ts` | absent | ⬜ |
| `TileMapManager.ts` | absent | ⬜ |
| Units, reachable highlighting, movement, FSM | absent — `BattleScene` only loads and draws (100 lines) | ⬜ |
| Fog, attack, enemy AI | absent | ⬜ |
| `npm test` | fails **before running any test** — `spawn EPERM` | ⚠️ environment |

### `npm test` cannot run in this sandbox

```
failed to load config from vite.config.ts
Error: spawn EPERM   (esbuild → child_process.spawn, piped stdio)
```

esbuild spawns a child process with piped stdio, which the confined sandbox blocks (named-pipe restriction). It is an environment limit, **not a project defect**: vitest dies while loading `vite.config.ts`, before test discovery. Consequences:

- `phase_1.md`'s DoD line "`npm test` passes all Pathfinding tests" is currently **unverifiable from inside DSH**. It needs `danger-full-access` or a run outside the sandbox.
- Do not read "npm test failed" as "the tests are broken" — no tests exist yet.

---

## Version control (fixed 2026-11-01)

**What was wrong:** this working copy had no `.git` at all, while `tooling_notes.md` described a pushed repo. Nothing could be committed, diffed, or rolled back.

**What the remote actually contained** (`github.com/loreaccurateclown/StrategyGamev1`, 2 commits, 218 files, last pushed 2026-10-31T18:26Z):

```
.gitignore  index.html  package.json  typescript.json  vite.config.ts
assets/             209 files (Kenney import + tilesheets)
backup/game.types.ts
plans/              phase_1.md, plan.md, tooling_notes.md
```

That is an **early snapshot taken right after project setup** — it has no `src/`, no `scripts/`, no `public/`, and still carries `typescript.json` (pre-rename) and `backup/game.types.ts`. Everything written since — the whole game source, the map generator, the generated map, `phase_4.md`, `progress.md`, `tsconfig.json` — had never been pushed.

**Fix applied:** cloned the remote to a temp folder, copied its `.git` into the working copy (so history and `origin` match the real repo), set `http.sslBackend=openssl` locally, then committed the current state on `main` and pushed it. Remote `main` is now `5c6df8f` with **239 tracked files** (up from 218), and the local tree is in sync with `origin/main`.

**Two sandbox git gotchas** — both recorded in [`tooling_notes.md`](./tooling_notes.md), because every `git` invocation fails without them:

1. `GIT_CONFIG_COUNT=3` is set with `GIT_CONFIG_VALUE_0..2` but **no `GIT_CONFIG_KEY_*`**, so git aborts with `missing config key GIT_CONFIG_KEY_0`. Unset the `GIT_CONFIG_*` variables.
2. `git ls-remote` / `fetch` fail with `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`. Use `http.sslBackend=openssl` (now stored in the repo config).

---

## Done and verified (cumulative)

| Item | Evidence |
|------|----------|
| `@reldens/tile-map-generator@0.64.0` installed (exact) | `npm ls` resolves 0.64.0; exports load from Node |
| Tile palette verified from pixel data | `node tools/tile-rgb.cjs 0 197` — exact RGB + opacity per tile |
| `assets/generator/palette.json` | gid ↔ terrain table with evidence inline |
| `TerrainType` | Grass 1, Forest 2, Water 3, Mountain 4, Road 5 + `TERRAIN_DEFS` |
| Seeded generator | `npm run map:generate`, deterministic per seed |
| Map output | `public/assets/maps/level_01.json` — 32×32 @ 16 px, 27 layers |
| Tileset image copied next to the map | `public/assets/maps/kenney_tinybattle.png` |
| Render gate | `_gate_check.ts` covers `make.tilemap` / `addTilesetImage` / `createLayer` |
| Map renders | browser logs `rendered 14 layers, skipped 13 collision layers (32x32 @ 16px = 512x512px)` |
| All 4 terrains present | forest 96 cells, water 75, mountain 48, grass = remainder |

---

## Not done

- `src/core/TileMapManager.ts` — absent (phase 4.2b).
- `src/core/Pathfinding.ts` + `Pathfinding.test.ts` — absent.
- Units, reachable-tile highlighting, movement, FSM. `BattleScene` still only loads and draws.
- Fog, attack, enemy AI.
- **Map-generator hardening (G1–G6)** — see [`phase_4.md`](./phase_4.md). This is the next body of work and it is generator-owned.

---

## Key facts to not relearn

1. **Tile size is 16 px, board is 32×32 tiles → 512×512 px world.** Docs once said 32 px / 1024 px. Board size never changed; tile size did.
2. **Gids are 1-based** (`firstgid: 1`). `groundTile: 0` means *no ground layer*, not "gid 0".
3. **`tilesets[0].name` in the generated JSON is the map name** (`level_01`), not the image filename. `addTilesetImage` needs that name plus a separate texture key.
4. **Every generator script must be `.cjs`** — `package.json` has `"type": "module"`.
5. **The generator silently grows the map** if elements don't fit. Set `placeRejectResolver: 'moveElements'` and keep `elementsQuantity` modest. A failed fit showed up as a 32×44 board.
6. **Collision layers are matched by name substring**, so element layers must be named `*-collisions`.
7. **There is no road tile** in the Kenney sheet. `TerrainType.Road` is defined but never generated.
8. **Composite mode is not viable without inventing tileset metadata** — the Kenney sheet has `tiles: []`.
9. **Placement cost is `(w + 2·freeSpace) × (h + 2·freeSpace)` per element**, and `requiredForBothSidesDuplicator = 2` is hard-coded in the generator. This — not `elementsQuantity` — is what caps terrain density at ~21 %. Details in [`phase_4.md`](./phase_4.md).
10. **Only water can partition the board.** Forest and mountain are `passable: true` (cost 2/3), so dense contiguous forest/mountain adds tactical cost without ever disconnecting the map. Water is the only terrain that can strand a region, which is why density tuning and the connectivity check are coupled.
11. **`.vscode/todos.json` is gitignored** (`.gitignore` has `.vscode/*` with only `extensions.json` excepted). The task tracker is therefore local-only and does not travel with the repo.

---

## How to reproduce the verified state

```powershell
# git needs the sandbox env sanitized first (see tooling_notes.md)
npm install
npm run map:generate                # expect "Verified: 32x32 @ 16px, 27 layers"
npx tsc --noEmit                    # expect exit 0
npm run dev                         # expect 14 layers rendered, 512x512
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

**Generator hardening first** ([`phase_4.md`](./phase_4.md), steps G1–G6), then the client work it unblocks:

1. **G1** retune density (≈37 % target) using larger dense clumps and `freeSpace 0` for forest/mountain, keeping water modest.
2. **G2** extend `verifyMap` with a connectivity flood-fill, an occupancy band assertion, and a visual/collision footprint agreement check.
3. **G3** emit a `level_01.terrain.json` sidecar so the client never reverse-maps gids.
4. **G4** collapse 27 layers to ~4 via `autoMergeLayersByKeys`.
5. **Freeze the map contract**, then write `TileMapManager` (4.2b) against it — once, not twice.
6. **`Pathfinding.ts` + tests** can run in parallel the whole time (own fixtures, no map dependency).

---

## Decisions settled

- **`todo.md` retired.** The actionable list is `.vscode/todos.json` (Todo It). A second hand-maintained markdown list was pure duplication. Do not recreate it — put tasks in the tracker and let `plans/` hold specs.
- **`getTerrainCost` stays.** `getReachableTiles` keeps its cost-function parameter and a `number[][]` grid, per `phase_1.md`. Tests still derive expected costs from `TERRAIN_DEFS`, so the two formulations agree behaviourally; only the signature differs.
- **The map contract must be frozen before 4.2b is written.** `TileMapManager` written against today's 27-layer, reverse-mapped-gid output would be thrown away after G3/G4.
- **Still open (tracked):** `UnitType` is declared as an object type in `src/types/game.types.ts` but specified as a string-literal union in `phase_1.md`.

---

## Scratch files to clean up eventually

Dev-only, safe to delete, not in any build path (now gitignored):

- `tools/palette-inspector.html`, `tools/tile-picker.html` — palette viewers (worth keeping while palette work continues)
- `tools/inspect-tiles.cjs`, `tools/tile-rgb.cjs` — palette verification (worth keeping)
- `tools/tile-detail.txt`, `tools/tile-rgb.txt` — generated reports
- `tools/render-check.png`, `tools/render-canvas.png`, `tools/render-zoom.png` — render screenshots
- `.playwright-mcp/` — browser tool output
