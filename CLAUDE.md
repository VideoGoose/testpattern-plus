# Test Pattern+ — disguise Designer plugin

Test pattern generator for disguise Designer at parity with Designer's TestPattern layer, plus
per-element line thickness, live adjustment on stage, PNG/TIF export and an LED wall mode.
No bridge: everything runs from the plugin folder.

## Working rules

- **Bump `VERSION` in `build.py` on every change you install, and tell the user the version number.**
  It shows as a badge in the plugin window, in the Plugin Launcher name, in `VERSION.txt` and in
  `out.html`'s `<title>`.
- Edit `src/` only. `dist/` is generated: `python build.py`.
- Install: `python build.py --install "<Designer project>\plugins"`
  (copies the 5 plugin files, byte-checks them, leaves `logos/` alone). The user must **close and
  reopen the plugin window** from Plugins → Plugin Launcher to load a new version.
- Test: `npm install`, `npx playwright install chromium` once, then `python tests/run_tests.py`.
  Every result's `"errs"` should be `[]`. Look at the PNGs in `tests/out/` after visual changes.
- Designer on the dev machine is on **port 81** (IIS/W3SVC holds port 80 → 503 Microsoft-HTTPAPI).
  Designer build r32.4.18, rev 263185.

## Layout

```
src/pattern.js       renderer (UMD, global GusTP): SCHEMA, defaults, sanitise, render, outputSize,
                     wallSize/wallTiles. Shared by plugin preview, out.html and exports, so the
                     preview is pixel-identical to what reaches the screens.
src/index.src.html   plugin window. build inlines pattern.js (/*@PATTERN@*/) and designer.py as a
                     JSON string (/*@PYSRC@*/''); @VERSION@ is replaced everywhere.
src/out.src.html     page a Web layer loads; state lives in the URL hash, redraws on hashchange
src/designer.py      Python 2.7 helper that runs inside Designer (also shipped as __init__.py)
tests/mock_designer.py   fake Designer: documented API only, real Web layer field list, restricted
                     import hook, HTTP 500 + rollback on errors, size_mode eval → recursion error
tests/e2e.mjs, e2e_led.mjs   Playwright end-to-end; tests/run_tests.py runs them on fresh mocks
```

Controls are generated from `SCHEMA` (`name: [type, default, min, max, label, group, options]`);
enums with >3 options or long names become in-page dropdowns. A new option is usually one SCHEMA
line plus drawing code in `render()`.

## How it talks to Designer

- Window served by Designer at `/projects/<project>/plugins/gus_testpattern/?director=host:port`.
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

- No native `<select>`: use `picker()`. No `prompt/confirm/alert`: use `ask()` and `toast()`.
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

Ideas offered, not built: half-tile column left/right; port limits by pixel count; power
circuit groups; 1-px/seam/gradient checks; missing tiles for irregular walls; tile-map CSV export.

## Version history

2.0 bridge-free · 2.1 API discovery + connection panel · 2.2 version badge · 2.3 double-encoded
returnValue fix · 2.4 documented layer API + in-window dialogs · 2.5 30 s layers + bookmark ·
2.6 one call per step · 2.7 sandbox-safe imports/excepts (first fully working) · 2.8 in-page
dropdowns · 2.9 separate host for Web layers · 2.10 migrate old layers (window-shrink fixed) ·
2.11.0 Size mode Match Mapping · 2.11.1 no eval on size_mode · 2.12.0 LED wall mode.

## Known limits

8-bit sRGB canvas (not HDR/PQ). The input transform is simple sRGB maths, not Designer's
OCIO/ACES pipeline. Multi-machine sessions still put the director hostname in layer URLs
(other machines must reach it); watch for the zoom leak there.
