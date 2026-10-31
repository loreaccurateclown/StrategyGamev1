# Tooling Notes (StrategyGamev1)

Lessons learned while setting up this Phaser 4 + TypeScript project on Windows PowerShell. Recorded so future phases don't repeat the failures below.

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
