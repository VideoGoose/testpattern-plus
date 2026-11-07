# Test Pattern+ for disguise Designer

Test patterns with grid, circles, labels, logos, line thickness, live on-stage updates,
PNG/TIF export and an LED wall mode. Runs from the project's `plugins` folder; no bridge.

```
python build.py                              # -> dist/gus_testpattern/
python build.py --install "<project>\plugins"  # build + copy + byte-check
python tests/run_tests.py                    # after: npm install; npx playwright install chromium
```

See CLAUDE.md for how it works and the Designer quirks it works around.
