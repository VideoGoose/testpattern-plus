# Test Pattern+ for disguise Designer

Test patterns with grid, circles, labels, logos, line thickness, live on-stage updates and
PNG/TIF export. LED wall mode adds tiles, half-tile rows, labels, data paths and alternating
LED modules, with tile sizes taken from an editable product list. Presets are saved as files so
they can move between projects. Runs from the project's `plugins` folder, with no bridge.

```
python build.py                                # -> dist/testpattern-plus/
python build.py --install "<project>\plugins"  # build + copy + byte-check
python tests/run_tests.py                      # after: npm install; npx playwright install chromium
```

In the installed plugin folder (`<project>\plugins\testpattern-plus\`):

- `led_products.csv` lists LED products (tile px/mm, modules per tile). Edit it in Excel, save it as
  CSV, then press ↻ in the plugin window.
- `presets\*.json` holds the saved presets. Copy a file to another project's `presets` folder to use it there.
- `logos\` holds the images for the logo dropdowns.

See CLAUDE.md for how it works and the Designer quirks it works around.
