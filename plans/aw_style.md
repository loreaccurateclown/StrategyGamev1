# Advance Wars map style — reference grammar (initial fit: AW1/GBA)

**Status:** style target for the generator. First pass = Advance Wars 1 (GBA) only; later games (AW2, Dual Strike, Days of Ruin) get elaborated separately.

**Reference material:** the AW1 GBA rips at [vgmaps.com](https://www.vgmaps.com/Atlas/GBA/index.htm) (classic site, plain PNGs — the `vgmaps.de` mirror 403s scripted clients but renders fine in a headless browser). Files used: `AdvanceWars-FieldTraining-{TroopOrders,TerrainIntel,BaseCapture,UnitRepair,TankOps,NavalForces,Dogfights}.png` and `AdvanceWars-CampaignMap.png`, downloaded to `%TEMP%\awmaps\` and upscaled 5× with `tools/upscale-png.cjs` for inspection.

> These are copyrighted game rips. They are **not** committed to the repo; keep them in a scratch directory.

---

## What AW1 battle maps actually look like

Observed from the Field Training rips plus the campaign map (which is a world map, not a battle map — ignore its palette):

1. **Terrain frames the map.** Land maps are enclosed by a band of forest (sometimes with mountain) running along the edges; naval maps are enclosed by sea with the land as an island. Terrain is *attached to the border*, never floating inside an empty margin.
2. **The border band is irregular, not a clean rectangle.** Its thickness varies from 1 to ~4 tiles, it bulges inward in places, and it leaves deliberate openings — the map reads as a clearing cut out of wilderness.
3. **Rivers are 1 tile wide and run edge to edge,** stepping at right angles (chunky, axis-aligned, never diagonal), and are crossed by **bridges** at 1–2 points.
4. **Roads are 1 tile wide,** run straight or step at 90°, and link bases/cities. They are the map's spine, not decoration.
5. **Clumps attach to things.** Forest blobs touch each other, the border band, rivers, or roads. Isolated single blobs in open field are rare; vegetation grows off existing structure.
6. **Mountains form ridges or small dense clusters,** usually on the border band or as a spine separating two halves — not scattered rectangles.
7. **Open plains are corridors between structures.** The contested middle is largely open; obstacles define lanes and choke points around it rather than speckling it evenly.
8. **Coastlines are shoal lines.** Every land/sea boundary has a 1–2 tile cream/shoal transition band; water never meets green directly.
9. **Water is either a river or a large connected sea at the edge** — rectangular interior ponds do not occur.
10. **Density is structure-dependent:** open field maps run ~15–25 % non-plains terrain, but almost all of it is in bands/edges, with very little in the middle.

## How the current generated 64×48 map diverges

Reference render: `tools/previews/map-preview.png`.

| AW1 | Our output |
|-----|------------|
| Terrain attached to a framing border | Nothing touches the edge; a clean empty margin rings the map |
| Irregular border bands with openings | No bands at all |
| Forest grows off structure | ~20 identical rounded-rectangle clumps scattered uniformly |
| Mountains as ridges/spines | ~14 identical rounded slabs, isolated |
| Rivers: 1-tile stepped lines, edge to edge | 8 rectangular cyan ponds floating in open field |
| Water borders land with shoals | Water meets grass with a hard edge |
| Open central corridors | Uniform noise; no lanes, no choke points |
| Clumps vary in size and touch each other | Every clump is the same size and space-separated (`freeSpace`) |

**Root cause:** `@reldens/tile-map-generator` is a *scatter* placer — it reserves a box per element instance and drops non-overlapping copies. It has no concept of borders, bands, rivers, or attachment, so no parameter tuning reaches AW's composed look. The library's cost model (reserve `(w+2f)×(h+2f)` per placement) actively forces the evenly-spaced look. **Resolved:** the library was replaced by `scripts/lib/compose-map.cjs` (see [`progress.md`](./progress.md)).

## Plan for the initial fit

Replace the scatter step with a **composition step** in `scripts/generate-map.cjs`, keeping the seeded PRNG, the verified palette, the Tiled JSON envelope, the tileset copy, and every `verifyMap` assertion (occupancy band, connectivity, footprint agreement, determinism).

Order of work:

1. **Composer core** — emit layers directly: `ground`, `ground-variations`, one visual layer per terrain, one merged `collisions` mask. (This also collapsed 87 layers to **4** — G4 delivered.)
2. **Border band** — walk the perimeter, stamp forest (with occasional mountain) at a per-side/thickness noise, leaving 2–4 openings.
3. **Blobs that attach** — grow forest/mountain from seeds *on the band* and occasionally on other structure, via random-walk growth with a size distribution, instead of fixed rectangles.
4. **Roads + bridges** — 1–2 road runs edge to edge using the confirmed road set
   (111 horizontal, 145 vertical, bends 128/130/164/166, T-junctions 129/146/148/165,
   four-way 147, dead ends 127/163), with bridges where a road crosses water
   (131 plain, 167 vertical, 149 horizontal deck + 74 pillar reflections).
   **No rivers:** the sheet has no 1-tile river channel (59–62/77–78 are the
   movement-arrow UI), so AW's edge-to-edge rivers are not reproducible. Water is
   lakes/coast only; a "river" would have to be a thin lake built from coast tiles.
5. **Mountains as accents** — gid 6 is the only mountain tile and has no variants,
   so a long ridge would read as a repeated stamp. Carry the framing look with
   forest (95 edge / 113 interior) and use mountains as punctuation.
6. **Open lanes** — carve/keep 2–3 wide plains corridors so the middle stays fightable; connectivity check must still see one component.
7. **Shoal coastline** — ✅ **done 2026-11-05.** The shore/edge set is wired as a 16-case mask
   table in `scripts/lib/shore-mask.cjs` (`20`/`56→20|V`/`37`/`39` + corner `19` + flips +
   inner corners `91–94` + vertical channel `58`), with a diagonal pass for concave corners and
   a truth-table renderer (`tools/render-shore-mask.cjs`). One caveat that is in the art, not
   the code: `37`/`39` carry only ~2 beach pixels against `20`'s three-row sand band, so
   vertical banks still read flatter than horizontal ones.

Out of scope for the first pass: **buildings** (cities 27–29, factory 30, dockyard 31). They are properties that do not exist in the game yet, so adding them would commit us to "buildings are impassable scenery" before capture/gameplay is designed. The user's decision (2026-11-01) is to add them later, after the ground shape is right.

Roads and bridges **are** in scope now — the sheet does have them, contrary to the earlier note in this file, which was based on `palette.json` mislabelling the road tiles as mountains.

## Coastline technique (settled by render tests)

Build all four water corners from **gid 19 plus flip flags** (horizontal, vertical,
both), with straights 20 (land north), 37 (land west), 39 (land east) and fill 38.
South is **not** 56: 56 has no beach band, so the generator mirrors the north bank
as `20|V` instead (see progress.md fact 10). The sheet's own bottom corners (22/23) carry stray
land specks and visibly break the waterline — see `tools/previews/coast-montage.png`
(green frames = correct stride and the flip approach; red frames = the classic
spacing/stride bug for comparison).

The generator must therefore emit **flipped gids** (Tiled flip bits
`0x80000000` / `0x40000000`), and `verifyMap` must mask those bits before
resolving gid → role.

## Open questions

- **Shoals now or later?** Requires un-deferring G6; it is the one visual feature of AW water we currently cannot express at all.
- **Fords instead of bridges acceptable?** No bridge tile exists, so a river needs 1-tile gaps to stay passable.
- **Board size vs AW scale:** AW1 battle maps are 15×10–30×20 (240×160–480×320 px). At 64×48 ours is 4–10× the area of a typical AW1 map, so a single "frame + lanes" composition will look sparse at this size unless the band is thick or the interior has several structures.
