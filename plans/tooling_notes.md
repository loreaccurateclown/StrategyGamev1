# Tooling Notes (StrategyGamev1)

Lessons learned while setting up this Phaser 4 + TypeScript project on Windows PowerShell. Recorded so future phases don't repeat the failures below.

## Map generation (`@reldens/tile-map-generator` — retired 2026-11-02)

> **Superseded.** The scatter placer was replaced by the purpose-built composer in `scripts/lib/compose-map.cjs`, and the dependency is removed from `package.json`. These notes are kept because several still apply to the current scripts (all `.cjs`, 1-based gids, seeded PRNG, collision-name matching, tileset-name-not-filename). Entries about `elementsQuantity`, `freeSpace`, silent board growth, composite mode and `placeRejectResolver` describe the **retired library only**.

- **Everything must be `.cjs`.** `package.json` sets `"type": "module"`, so a plain `.js` script using `require()` throws. The generator itself is CommonJS-only (`main: index.js`) and Node-only (it writes files via `@reldens/server-utils`), so it can never be imported from browser code.
- **Gids are 1-based.** `createTiledMapObject` hard-codes `firstgid: 1` and copies layer values verbatim. `gid = tile index + 1`. A `groundTile` of `0` is falsy to the generator and means *no ground layer at all* — the board renders as holes.
- **`elementsQuantity` cannot be empty and a ground-only map is impossible.** `OptionsValidator.requiredKeys` includes `layerElements`, and it separately rejects an empty `elementsQuantity`. A map always needs at least one element type.
- **The generator silently grows the board** when elements don't fit. A 32×32 request came back as **32×44**. There is no "skip this element" mode. Mitigate with `placeRejectResolver: 'moveElements'` (rearranges instead of growing) *and* modest quantities. Reserve `(w + 2·freeSpace) × (h + 2·freeSpace)` per placement when budgeting.
- **Every placement reserves free space around it**, so occupancy stays far below the naive area sum. 6 forest / 3 water / 3 mountain filled only 219 of 1024 cells (~21%) on a 32×32 board.
- **Collision layers are matched by name substring.** `collisionLayersForPaths: ['collisions']` means any layer whose name contains `collisions` blocks paths. Element layers must therefore be split into `<key>-visual` and `<key>-collisions` pairs.
- **No seed option exists.** The generator calls bare `Math.random()`. To make output reproducible, replace `globalThis.Math.random` with a PRNG *before* constructing `RandomMapGenerator` (`scripts/lib/prng.cjs`). Verified working: same seed → byte-identical JSON.
- **Composite mode needs tileset `key` properties** (`groundTile`, `pathTile`, `border-*`, `corner-*`) that `ElementsProvider` reads from `tileset.tiles`. The Kenney sheet has `tiles: []`, so object mode (`layerElements` inline) is the only viable path without inventing metadata.
- **`tilesets[0].name` in the output is the map name, not the image filename.** So Phaser needs `map.addTilesetImage(map.tilesets[0].name, '<textureKey>')` — pass the image filename and you get `null` plus a "Tilemap has no tileset" warning.
- **The generator copies the tileset image** into `generatedFolder` under `tileSheetName`. Set `generatedFolder` to `public/assets/maps` so the JSON's relative `image` field resolves under Vite.

## Reading the tileset

- **Kenney's `tilemap.png` is an indexed (colorType 3) PNG.** A hand-rolled decoder must handle `PLTE`/`tRNS`; truecolour-only readers fail with `Unsupported PNG (bitDepth=8 colorType=3)`.
- **Verify tile roles from pixel data, not screenshots.** `tools/tile-rgb.cjs` prints exact RGB histograms plus opacity per tile. Ground tiles must be 100% opaque; object tiles (trees, rocks) always carry transparent pixels. Reading 16 px art by eye at normal zoom produced wrong guesses.
- **`kenney_tinybattle_indiv.tsx` is broken** — its `image` paths point outside the project. Use `kenney_tinybattle.tsx` as the authority (16 px, spacing 1, margin 0, 18 columns, 198 tiles, 305×186 px).
- **Road tiles DO exist** — the earlier "no road tile" conclusion was wrong. Confirmed set: horizontal 111, vertical 145, single 109, dead-ends 110/112/127/163, bends 128/130/164/166, tees 129/146/148/165, cross 147, bridge deck 131/167, strut 149. Authoritative table: [`tile_roles.md`](./tile_roles.md).

## Vision models: a subjective instrument, not an authority

Recorded 2026-11-05. This project owns the generator and the engine, so **the data is always available** — `level_01.terrain.json`, `verifyMap`, `tools/map-stats.cjs` and pixel diffs answer every factual question exactly and cannot confabulate. A vision model adds exactly one thing the data cannot: **what a human eyeball sees.** So ask it *"does this fit together?"*, never *"is this correct?"*.

- **Ask what the intention was before grading CV output.** A map is not only its logic — it also has to hold up as a picture. The bridge is the worked example: the deck is drawn so the water reads as flowing freely underneath, and the strut in the water cell below is the only tell. A VLM reporting *"one continuous river"* is describing the **intended player perception** — the illusion working. Scoring that as a CV error is backwards; it was the single most successful answer it gave.
- **Use it for:** does it read as one coherent place; is the water natural; are settlements convincing; is vegetation groves or noise; where is it barren; what is most visually repetitive. Subjective questions with no ground truth to contradict.
- **Do not use it for:** counting, gids, coordinates, tile correctness, whether something "exists". Those go to the sidecar and the diff tools.
- **Trust its aggregate judgement, distrust its attributions.** Measured on seed 1234: it called the central river *"too perfectly straight and uniform in width"* — **confirmed**, the channel is exactly 7 tiles wide on all 47 wet rows, sd 0.00, centroid sd 0.50. It is a perfect constant-width vertical band, and it was right that adding bends/tributaries is the single best visual improvement. But the same answer blamed *"isolated structures with no road connection"* (only **1 of 89** buildings is roadless, and it is top-left, not top-right) and *"bottom-left feels most unfinished"* (bottom-left is the **second most developed** quadrant at 12.5 %, ahead of both right-hand quadrants at 7.9 % / 8.1 %). The instinct was right; the locations were invented.
- **Crop before asking structural questions** — ≤ 8 tiles across. At full-board scale a 1-tile feature is invisible: it could not see that the river is severed into two bodies by a single road crossing, which is exactly what the deck is designed to hide.
- **Best model tried:** `qwen3.5-9b-...-heretic-neo-imatrix-max-mtp` (Q4_K_S, ~5.5 GB) — transcribed a 5×7 bitmap-font caption **exactly** (`WATER SOUTH 210`), spotted the bridge deck and strut on a 3× crop, and correctly answered "no red cars" with grounded evidence. It reasons heavily (300–3,200 tokens), so it is slow but careful.

### Feeding images in: `tools/vision_input/`

Images cannot be pasted into chat — the chat model accepts text only — so screenshots are dropped in a folder and referenced by path. Two subfolders, added 2026-11-05:

- **`tools/vision_input/unread/`** — the drop zone. Save the capture here.
- **`tools/vision_input/read/`** — moved here once it has been analysed, so the pair doubles as a record of what has already been looked at. An empty `unread/` means nothing is pending.

Just point the agent at the folder; it discovers the loaded model at call time (never hardcodes an id) and picks the MIME type from the extension. No need to say which model is loaded.

- **Captures are gitignored, and that needed a fix.** `.gitignore` only covered `tools/**/*.png`, but browser screenshots land as **`.jpg`** — one `git add .` away from being committed. `tools/**/*.jpg`, `.jpeg` and `.webp` are now ignored too.
- **Check the capture dimensions, not the filename.** A Brave capture of the 2048×1536 preview came out **1311×570** — a wide, short band cropped on all sides. The filename carried the *source* size, not the capture's. A vision model correctly called it "tightly cropped on all sides", which was the one structural judgement it got right on that file.

## Phaser

- **`createLayer` returns `TilemapLayer | TilemapGPULayer`.** Pass `gpu = false` to get the plain `TilemapLayer` and a defensible `as` narrow; the GPU variant is less flexible.
- **`addTilesetImage(tilesetName, key, ...)` needs a texture key that was loaded separately.** The Tiled JSON's `image` field is *not* auto-loaded.
- **`pixelArt: true` is mandatory at 16 px**, otherwise the browser smooths the art. Pair it with integer camera zoom (`Math.max(1, Math.floor(fitRatio))`).
- **`createLayer` silently returns `null`** for an unknown layer name or a `null` tileset, so a magenta-less but empty board is a real failure mode. Count rendered layers and log them.

## Environment & Dependencies
- **Phaser ships its own types** — there is no `@types/phaser` package (npm returns 404). Verify any API surface by grepping the installed type definitions at `node_modules/phaser/types/phaser.d.ts`, not npm metadata. Metadata has no method lists; only `.d.ts` files do.
- **Verify via install, not queries.** To confirm an API exists: `npm install phaser@<exact> --save-exact` in a temp dir, then grep the `.d.ts`. Don't try to introspect method lists from `npm view ... all` — that pipeline is unreliable on PowerShell (`ConvertFrom-Json` collapses single objects).
- **Pin Phaser to an exact version** (no `^`/`~`) per phase_1.md step 1.0.

## Scaffolding / Vite
- **`npm create vite@latest <dir> -- --template X` refuses non-empty directories** and prompts interactively ("Target directory is not empty" / "Current directory is not empty"). Either start from an empty dir or `Remove-Item <dir> -Recurse -Force` first. The prompt can hang — clean the target beforehand instead of fighting it.
- **Vite's own CLI has no create subcommand.** `npx vite --help` shows only dev/build/preview flags (no `create`). Use the separate `create-vite` package (`npm i -D create-vite`) for scaffolding a new project.
- **Don't run one-shot scaffold commands as background tasks.** `run_in_terminal` auto-backgrounds slow npm/vite calls; the agent then has to poll and keeps re-triggering them. Use sync mode for installs/builds/tsc. Reserve async only for servers/watchers/daemons that must run indefinitely.

## TypeScript
- **Config file must be named `tsconfig.json`.** Naming it anything else (e.g. `typescript.json`) makes `tsc` ignore it and fall back to defaults — it prints the compiler-option help instead of compiling. Rename before running `tsc`.

## Windows PowerShell gotchas
- **Quoting is fragile.** Nested single quotes in `Set-Content -Value '...'` break easily. Use here-strings for multi-line file writes:
  ```powershell
  @'
  import Phaser from 'phaser';
  // ...
  '@ | Set-Content -Path src\main.ts -Encoding UTF8
  ```

## Git / GitHub
- **Repo:** `https://github.com/loreaccurateclown/StrategyGamev1` on branch `main`. Public. Auth works out of the box — `gh auth status` shows logged-in `loreaccurateclown` with `repo` scope, and gh's git credential helper is installed. Plain `git commit` + `git push origin main` succeeds.
- **This working copy lost its `.git` and was restored on 2026-11-01.** The remote had only ever had **2 commits** (`a23b283` setup, `96ff4bd` tooling notes) covering 218 files: `assets/` (209), `index.html`, `package.json`, `typescript.json`, `vite.config.ts`, `backup/game.types.ts`, and 3 `plans/` files. It had **no `src/`, `scripts/`, or `public/`** — everything since the initial setup had never been pushed. Restore method that preserves history: clone to a temp dir, copy the clone's `.git` into the working copy, then commit the local state as a normal child of the remote HEAD. Do **not** `git init` + force-push; that discards the real history.
- **DSH exports a malformed git config env that breaks every git command.** `GIT_CONFIG_COUNT=3` is set together with `GIT_CONFIG_VALUE_0..2` (`explicit`, `never`, `false`) but **no `GIT_CONFIG_KEY_*`**, so git aborts with:
  ```
  error: missing config key GIT_CONFIG_KEY_0
  fatal: unable to parse command-line config
  ```
  Every `git` invocation fails, read-only ones included. Clear the variables first:
  ```powershell
  Remove-Item Env:GIT_CONFIG_COUNT,Env:GIT_CONFIG_VALUE_0,Env:GIT_CONFIG_VALUE_1,Env:GIT_CONFIG_VALUE_2 -ErrorAction SilentlyContinue
  ```
  Each new shell starts with them set again, so repeat this per shell.
- **`schannel` cannot acquire TLS credentials under the sandbox.** `git ls-remote` / `clone` / `fetch` fail with:
  ```
  schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)
  ```
  Use the OpenSSL backend instead — `git -c http.sslBackend=openssl <cmd>`, or persist it once per repo with `git config http.sslBackend openssl` (already set in this repo). `gh api` is unaffected because it uses Go's TLS stack, which makes it a good way to probe the remote when git cannot.
- **`git push` needs wider sandbox access than `git status`/`commit`.** The credential helper is a shell wrapper, so git spawns `sh.exe`, which cannot create a signal pipe under confinement:
  ```
  0 [main] sh (26284) .../usr/bin/sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
  fatal: could not read Username for 'https://github.com': terminal prompts disabled
  ```
  Run the push with `danger-full-access` so the existing gh keyring helper can authenticate. Do **not** work around it by baking a token into `http.extraheader` — that puts a live credential on the command line and in shell history.
- **Do NOT** set `http.https://github.com/.extraheader="AUTHORIZATION: token ..."` — that sends the REST-API header scheme, which git smart HTTP rejects ("invalid credentials"). The helper handles Basic auth automatically. If you ever see "duplicate Authorization", clear it with `git config --global --unset-all http.https://github.com/.extraheader`.
- **First push required repo creation:** when pushing to a brand-new remote that doesn't exist yet, git returns "Repository not found" (404) even though auth is fine — you must run `gh repo create StrategyGamev1 --public` first. This already happened; the repo exists now.
- **Windows gotcha:** the system gitconfig (`C:\Program Files\Git\etc\gitconfig`) had `[credential] helper = manager`, which caused duplicate-header/auth failures. It was removed so gh's helper is used instead. Don't re-add `manager`.
- **Agent scratch must be gitignored.** `.playwright-mcp/` (browser tool output) and `tools/*.png` / `tools/*.txt` (generated render screenshots and palette reports) are dev-only and were added to `.gitignore` on 2026-11-01. Note `.vscode/*` is already ignored except `extensions.json`, so **`.vscode/todos.json` — the task tracker — is local-only and does not travel with the repo**.
