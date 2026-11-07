# Test Pattern+ — disguise Designer plugin

Test pattern generator for disguise Designer at parity with Designer's TestPattern layer, plus
per-element line thickness, live adjustment on stage, PNG/TIF export and an LED wall mode.
No bridge: everything runs from the plugin folder.

Machine-specific notes (install path, Designer port and build) live in `CLAUDE.local.md`, which
is git-ignored. Keep names, user paths and e-mail addresses out of tracked files.

## Working rules

- **Backwards compatibility from 0.9.21 on.** 0.9.21 (first public release, folder renamed to
  `testpattern-plus`) deliberately dropped compatibility with earlier builds, once. Every release
  after it must keep working with what earlier releases saved: Web layer URLs (`#key=value` hash),
  preset files, `my_led_products.csv`, the plugin folder name. So: never rename or remove a SCHEMA
  key, never reorder or reuse enum indexes (append new options), keep defaults stable (changing one
  silently changes old layers, since URLs only store non-default values), keep CSV columns and the
  preset JSON shape readable. When something must change, read the old form and migrate it.
- **Bump `VERSION` in `build.py` on every change you install, and tell the user the version number.**
  Scheme is `0.9.xx`: raise the last number by one each time (0.9.13 → 0.9.14).
  It shows as a badge in the plugin window, in the Plugin Launcher name, in `VERSION.txt` and in
  `out.html`'s `<title>`.
- Edit `src/` only. `dist/` is generated: `python build.py`.
- Install: `python build.py --install "<Designer project>\plugins"` (the test project's path is in
  `CLAUDE.local.md`). Copies the plugin files in `FILES` (incl. `led_products.csv`, `README.txt`),
  byte-checks them, leaves `logos/`, `presets/` and `my_led_products.csv` alone. The user must
  **close and reopen the plugin window** from Plugins → Plugin Launcher to load a new version.
- Release: `python build.py --zip` → `dist/testpattern-plus-<v>.zip` (the `testpattern-plus` folder at the top) +
  `dist/RELEASE_NOTES.md`. Pushing a tag `v<VERSION>` runs `.github/workflows/release.yml`, which
  checks the tag against `build.py`, builds the zip and publishes a GitHub Release (pre-release
  while the version is 0.x).
- Test: `npm install`, `npx playwright install chromium` once, then `python tests/run_tests.py`.
  Every result's `"errs"` should be `[]`. Look at the PNGs in `tests/out/` after visual changes.
- Designer's API port varies by machine (80 by default; 81 or 8080 when something else holds 80).
  The window tries `?director`, the last good address, same origin, then 80/81/8080.
  Developed against Designer r32.4.18 and r34.2.2.

## Layout

```
src/pattern.js       renderer (UMD, global GusTP): SCHEMA, defaults, sanitise, render, outputSize,
                     wallSize/wallTiles. Shared by plugin preview, out.html and exports, so the
                     preview is pixel-identical to what reaches the screens.
src/index.src.html   plugin window. build inlines pattern.js (/*@PATTERN@*/) and designer.py as a
                     JSON string (/*@PYSRC@*/''); @VERSION@ is replaced everywhere.
src/out.src.html     page a Web layer loads; state lives in the URL hash, redraws on hashchange
src/designer.py      Python 2.7 helper that runs inside Designer (also shipped as __init__.py)
src/led_products.csv built-in LED product list, shipped (users add theirs in my_led_products.csv)
.github/workflows/release.yml   tag v<VERSION> -> build zip -> GitHub Release
tests/mock_designer.py   fake Designer: documented API only, real Web layer field list, restricted
                     import hook, HTTP 500 + rollback on errors, size_mode eval → recursion error
tests/e2e.mjs, e2e_led.mjs, e2e_grad.mjs   Playwright end-to-end; tests/run_tests.py runs them on fresh mocks
```

Controls are generated from `SCHEMA` (`name: [type, default, min, max, label, group, options]`);
enums with >3 options or long names become in-page dropdowns. A new option is usually one SCHEMA
line plus drawing code in `render()`.

## How it talks to Designer

- Window served by Designer at `/projects/<project>/plugins/testpattern-plus/?director=host:port`.
  Nothing may hard-code the folder name: the window reads it from `location.pathname` and passes
  it to `info(folder)`; `_plugin_dir()` imports the auto-loaded copy under any likely module name
  (folder, underscore spelling, `user_module_` prefix) and prefers the sibling folder the window
  came from. No compatibility with the pre-0.9.21 `gus_testpattern` folder: a one-off for the first
  release (see Working rules for compatibility from 0.9.21 on).
  Unverified in Designer: whether its auto-loader accepts a hyphen in the folder name.
  API discovery: `?director` → last good address → same origin → ports 80/81/8080.
- `POST /api/session/python/registermodule {moduleName, contents}` registers `designer.py` as
  `gus_tp`; `POST /api/session/python/execute {moduleName, script}` calls it. `returnValue` comes
  back **double-encoded** (Designer JSON-serialises the JSON string): unwrap in a loop.
- **New Web layer** = 3 separate execute calls, because Designer seems to undo *all* changes from
  a failed call: `add_layer(name, 30)` (30 s at the playhead, Size mode → Match Mapping) →
  `make_bookmark(name, url)` (WebBookmark, same name) → `attach_bookmark` (`set_url_field`
  fallback).
- Live changes rewrite the bookmark's URL (hash only), throttled to ~6/s.
- Web layers use `127.0.0.1` while the window uses the hostname. **Keep it that way:** Designer
  zooms Web layer browsers and its embedded browser keeps zoom per host, so a shared host shrinks
  the plugin window and the Plugin Launcher. Old layers are migrated on connect.

## Designer Python sandbox (hard-won; don't relearn these)

- `restrictedscope/import_hook.py` blocks `import sys`; treat `traceback` and runtime `import d3`
  as blocked too. `import os` works; `from d3 import *` at module top works.
- Its errors are **not** `Exception` subclasses: wrap with `except BaseException` plus a bare
  `except:`. Never import inside an except handler. Every entry point goes through `_guard`.
- An uncaught error → HTTP 500, status 5000, "class PythonException in pythonobject.cpp".
- `layer.description` is "<name> in track track 1": use `layer.name`.
- **Never `fs.eval()` the `size_mode` field** → "Nested expression hit recursion limit in field
  size_mode". Read `fs.sequence.key(0).v`. `eval` on `bookmark` is fine.
- API in use: `guisystem.track`, `guisystem.player.tCurrent` (beats),
  `track.addNewLayer(WebModule, startBeats, lengthBeats, name)`, `track.layers`, `layer.tStart`,
  `layer.findSequence(name)`, `fs.disableSequencing = True`,
  `fs.sequence.setString/setFloat/setResource(beat, v)`, `key(i).v`,
  `resourceManager.loadOrCreate('objects/webbookmark/<lowercase>.apx', WebBookmark)`,
  `res.saveOnDelete()`.
- Web layer fields: blendMode, brightness, mapping, palette, xCol, yCol, tint.r/g/b/a, bookmark,
  Command, fade_up_time, framerateFraction, size_mode (0 Match Mapping, 1 Custom), width, height,
  Name/Value 1–8, String Name/String 1–8, Universes.

## Plugin window rules (Designer's embedded browser)

- No native `<select>`: use `picker()`. `data-search="1"` on the select adds a type-to-filter box
  (every word must match option text or the option's `data-search`; arrows + Enter). Used for LED products. No `prompt/confirm/alert`: use `ask()` and `toast()`.
- Body is a flex column (header / main / footer). The plugin window can't be resized and the
  header wraps to two rows at ~900 px, so never size `main` with calc(100% - Npx) (0.9.15 fix).
- Don't counter-zoom in page CSS (v2.9.0 tried; dpr went *up* to 2.25 while the page shrank).
- The connection panel (click the status pill) logs every step with JSON, plus Retry, Copy log,
  Probe. Ask the user for that log when something fails in Designer.

## LED wall mode (v2.12.0)

Tile W/H px, wall W×H tiles, half-tile row top/bottom (floor(tileH/2), marked ½). Wall size
overrides Resolution. Colours: checker/columns/rows/rainbow across/down/by port/solid.
Labels: grid ref (columns and rows each numbers or letters, A1 or 1A), sequence across/down
(numbers or letters, snake, start corner, start 0/1), or both. Tiles per data port + data-path
arrows; tile pixel position; tile outline/diagonals. Turning LED mode on in the window switches
off grid lines, circles, centre cross and diagonals.

Header toggle **Projector grid | LED wall** (0.9.14) drives `ledWall`; the ledWall row is hidden.
LED mode hides the Resolution section and dims the preview size; projector mode hides the LED
wall section. Going to LED stores grid/circles/centre cross/diagonals (`tp.projFurniture`) and
going back restores them (defaults if none).

## Modules, products, presets (v2.13.0)

- Modules: `modulesX/modulesY` per tile, `modulesHalfY` (0 = auto = round(modulesY/2), CB3 8 → 4).
  `moduleShow` Off / alternate shading / outlines / both. Shading checkers across the whole wall
  (wall module col/row, via `mr0` from `wallTiles`); seams drawn inside tiles only.
- `ledProduct` (str, in URL + presets) names a row of `led_products.csv`
  (manufacturer + product). Columns: manufacturer, product, pitch_mm, tile_w_mm, tile_h_mm,
  tile_w_px, tile_h_px, modules_across, modules_down, half_modules_down, notes. Comma/semicolon/tab,
  BOM and cp1252 tolerated; `#` rows skipped. Read by `led_products()` in Python, fetch fallback when
  not connected. Picking one sets tile px + modules and turns module shading on; hand-editing those
  keys clears `ledProduct`. mm columns give the wall's metres in the wall note.
  Only the ROE CB3 specs were confirmed by the user; the other rows are marked "check against datasheet".
  Users add or override rows in `my_led_products.csv` (never shipped; same name wins, ★ in the list).
- Presets: one file per preset, `<plugin>/presets/<name>.json` = {plugin, version, name, saved,
  settings: non-default keys minus labelText/resW/resH}. The file name is the preset name.
  `list_presets / save_preset / delete_preset` in Python. Not connected → window localStorage;
  localStorage presets (pre-2.13) are written out as files on connect, then removed.

## Gradient mode (0.9.15)

Third header mode (`gradMode`, wins over `ledWall`). `gradType` greyscale ramp / steps, rainbow
ramp / steps; `gradBits` 8 or 10; `gradDirection` L→R, R→L, T→B, B→T; `gradSteps`; step labels
(code value + %, or hue° + RGB codes). Pixels are written with putImageData from exact code values
(no canvas gradients, no dithering); rainbow = full-saturation HSV, ramps 0..360° exclusive.
Canvas and Web layers are 8-bit: 10-bit shows `v >> 2`. Save PNG/TIF write 16-bit files
(`deepPixels`: 10→16 bit by replication `(v<<6)|(v>>4)`, overlay pixels as canvas×257; null when
no CompressionStream → 8-bit export). The input transform, grid lines, circles, centre cross, diagonals and border are
ignored in Gradient mode and their sections hidden (0.9.16, 0.9.17). Entering Gradient mode turns off grid, circles, centre
cross, diagonals, label and border; back to Projector grid restores them.

## LED tile colours (0.9.18)

`tileFill` 0-6 keep their 2.12 meaning (layer URLs, presets); added 7 rainbow diagonal, 8 rainbow
in data order (follows seq / snake), 9 distinct colours (golden-angle hue per seq), 10 rainbow
inside each tile (shows rotated/mirrored tiles), 11 grey ramp across. `tileBrightness` (default
0.45 → 0.8; 1 = full hue), `tileSaturation`, `hueStart`, `hueRange`, `tileShade` (black checker
over any mode). Rows that don't apply to the chosen mode are dimmed. LED walls, like gradients,
never draw grid lines, circles, centre cross, diagonals or border; their sections are hidden.

Ideas offered, not built: half-tile column left/right; port limits by pixel count; power
circuit groups; 1-px/seam/gradient checks; missing tiles for irregular walls; tile-map CSV export.

## Version history

2.0 bridge-free · 2.1 API discovery + connection panel · 2.2 version badge · 2.3 double-encoded
returnValue fix · 2.4 documented layer API + in-window dialogs · 2.5 30 s layers + bookmark ·
2.6 one call per step · 2.7 sandbox-safe imports/excepts (first fully working) · 2.8 in-page
dropdowns · 2.9 separate host for Web layers · 2.10 migrate old layers (window-shrink fixed) ·
2.11.0 Size mode Match Mapping · 2.11.1 no eval on size_mode · 2.12.0 LED wall mode ·
2.13.0 LED modules, led_products.csv, preset files.

Renumbered on 2026-11-07: 2.13.0 became **0.9.13** (same code); the patch number carries on
(0.9.14, 0.9.15 …). 0.9.14 Projector grid / LED wall mode toggle. 0.9.15 Gradient mode + 16-bit export, window layout fix. 0.9.16 no input transform in Gradient mode. 0.9.17 no grid/circles in Gradient mode. 0.9.18 LED tile colour modes, no grid/circles in LED mode. 0.9.19 searchable LED product picker. 0.9.20 release zip + workflow, my_led_products.csv. 0.9.21 plugin folder renamed gus_testpattern → testpattern-plus (no carry-over). Older notes and code comments that mention 2.x refer to the old numbering.

## Known limits

8-bit sRGB canvas (not HDR/PQ). The input transform is simple sRGB maths, not Designer's
OCIO/ACES pipeline. Multi-machine sessions still put the director hostname in layer URLs
(other machines must reach it); watch for the zoom leak there.
