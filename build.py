#!/usr/bin/env python3
"""Assemble dist/gus_testpattern/ -- the folder that goes in {project}/plugins/.

    python build.py                             # build only
    python build.py --install "<plugins dir>"   # build, copy into a Designer project's plugins
                                                # folder, and byte-check the copy
    python build.py --zip                       # build + dist/gus_testpattern-<version>.zip and
                                                # dist/RELEASE_NOTES.md (used by the GitHub release)
"""
import filecmp
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
PLUGIN = 'gus_testpattern'      # folder name Designer loads; designer.py finds itself by it
OUT = os.path.join(HERE, 'dist', PLUGIN)
VERSION = '0.9.20'   # 0.9.xx: bump the last number on every change you install
# replaced on every install / update. The user's own files (logos/, presets/,
# my_led_products.csv) are never part of a build, so an update can't overwrite them.
FILES = ['index.html', 'out.html', '__init__.py', 'd3plugin.json', 'VERSION.txt', 'led_products.csv', 'README.txt']
OLD_FILES = ['.led_products.csv.installed']     # left by 0.9.13-0.9.19 installs

PLUGIN_README = """Test Pattern+ v{v} for disguise Designer
=======================================

Install / update
  1. Unzip so this folder sits at  <your Designer project>\\plugins\\gus_testpattern\\
     (the folder must keep the name gus_testpattern).
  2. In Designer: Plugins > Plugin Launcher > Test Pattern+.
     After an update, close the plugin window and open it again.
  Updating replaces only the plugin's own files. Your logos, presets and
  my_led_products.csv are never part of an update.

Your files in this folder
  logos\\                 PNG / JPEG / WebP / SVG images for the logo dropdowns
  presets\\               saved presets, one .json each. Copy a file into another
                         project's gus_testpattern\\presets\\ folder to use it there.
  led_products.csv       built-in LED product list (replaced by updates)
  my_led_products.csv    optional: your own products, same columns as
                         led_products.csv. Rows with the same manufacturer + product
                         replace the built-in ones. Edit in Excel, save as CSV, then
                         press the refresh button in the plugin window.

Exports (Save PNG / Save TIF) go to <project>\\objects\\VideoFile\\test patterns+\\
"""


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def build():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'logos'))
    os.makedirs(os.path.join(OUT, 'presets'))
    pattern = read('pattern.js')
    py = read('designer.py').replace('@VERSION@', VERSION)
    assert '</script' not in pattern.lower() and '</script' not in py.lower()
    index = read('index.src.html').replace('@VERSION@', VERSION).replace('/*@PATTERN@*/', pattern) \
                                  .replace("/*@PYSRC@*/''", json.dumps(py))
    out = read('out.src.html').replace('/*@PATTERN@*/', pattern).replace('@VERSION@', VERSION)
    assert '@PATTERN@' not in index + out and '@PYSRC@' not in index
    assert '@VERSION@' not in index + out + py
    files = {
        'index.html': index,
        'out.html': out,
        '__init__.py': py,     # Designer auto-loads this; the window also registers it fresh
        'd3plugin.json': json.dumps({'name': 'Test Pattern+ v' + VERSION, 'requiresSession': True}, indent=2) + '\n',
        'VERSION.txt': VERSION + '\n',
        'led_products.csv': read('led_products.csv'),
        'README.txt': PLUGIN_README.format(v=VERSION),
        'logos/put-logo-images-here.txt': 'PNG, JPEG, WebP or SVG files in this folder show up in the Logos dropdowns.\n',
        'presets/put-preset-files-here.txt': (
            'Save preset in the plugin window writes <name>.json here.\n'
            'Copy a .json file into another project\'s plugins/gus_testpattern/presets/ folder to use it there.\n'),
    }
    for name, text in files.items():
        # README is for Windows users opening it in Notepad: CRLF; everything else LF
        nl = '\r\n' if name.endswith('.txt') and name != 'VERSION.txt' else '\n'
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline=nl) as f:
            f.write(text)
    print('built v%s ->' % VERSION, OUT)
    for name in sorted(files):
        print('  %-34s %7d bytes' % (name, os.path.getsize(os.path.join(OUT, name))))


def install(plugins_dir):
    dest = os.path.join(plugins_dir, PLUGIN)
    for d in ('logos', 'presets'):
        os.makedirs(os.path.join(dest, d), exist_ok=True)
    for name in FILES:
        shutil.copyfile(os.path.join(OUT, name), os.path.join(dest, name))
    bad = [n for n in FILES if not filecmp.cmp(os.path.join(OUT, n), os.path.join(dest, n), shallow=False)]
    if bad:
        sys.exit('install check FAILED for: ' + ', '.join(bad))
    for name in OLD_FILES:
        if os.path.exists(os.path.join(dest, name)):
            os.remove(os.path.join(dest, name))
    print('installed v%s -> %s (all %d files byte-identical; logos/, presets/ and my_led_products.csv left alone)'
          % (VERSION, dest, len(FILES)))
    print('Close and reopen the plugin window in Designer to load it.')


def make_zip():
    """dist/gus_testpattern-<v>.zip: the plugin folder itself at the top, ready to unzip into plugins/."""
    path = os.path.join(HERE, 'dist', '%s-%s.zip' % (PLUGIN, VERSION))
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, names in os.walk(OUT):
            dirs.sort()
            rel_root = os.path.relpath(root, os.path.dirname(OUT))
            z.writestr(rel_root.replace(os.sep, '/') + '/', '')        # keep empty-looking folders
            for n in sorted(names):
                z.write(os.path.join(root, n), os.path.join(rel_root, n).replace(os.sep, '/'))
    notes = os.path.join(HERE, 'dist', 'RELEASE_NOTES.md')
    with open(notes, 'w', encoding='utf-8', newline='\n') as f:
        f.write('## Install or update\n\n'
                '1. Download **%s-%s.zip** from the assets below (not GitHub\'s "Source code" zips: those '
                'are the project source, not the plugin).\n'
                '2. Unzip it into your Designer project\'s `plugins` folder, so you get '
                '`<project>\\plugins\\gus_testpattern\\`.\n'
                '3. In Designer open **Plugins → Plugin Launcher → Test Pattern+**. After an update, close the '
                'plugin window and open it again.\n\n'
                'Updating replaces only the plugin\'s own files: your `logos`, `presets` and '
                '`my_led_products.csv` are never in the zip.\n' % (PLUGIN, VERSION))
    print('zipped ->', path, '(%d KB)' % (os.path.getsize(path) // 1024))


if __name__ == '__main__':
    build()
    if len(sys.argv) == 3 and sys.argv[1] == '--install':
        install(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == '--zip':
        make_zip()
    elif len(sys.argv) > 1:
        sys.exit(__doc__)
