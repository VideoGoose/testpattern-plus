#!/usr/bin/env python3
"""Assemble dist/gus_testpattern/ -- the folder that goes in {project}/plugins/.

    python build.py                       # build only
    python build.py --install "<plugins dir>"   # build, copy into a Designer project's plugins
                                          # folder, and byte-check the copy
"""
import filecmp
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(HERE, 'dist', 'gus_testpattern')
VERSION = '0.9.19'   # 0.9.xx: bump the last number on every change you install
FILES = ['index.html', 'out.html', '__init__.py', 'd3plugin.json', 'VERSION.txt']
# The user edits this one in each project (Excel): installed only when missing, never overwritten.
USER_FILES = ['led_products.csv']


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def build():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, 'logos'))
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
        'logos/put-logo-images-here.txt': 'PNG, JPEG, WebP or SVG files in this folder show up in the Logos dropdowns.\n',
    }
    files['led_products.csv'] = read('led_products.csv')
    files['presets/put-preset-files-here.txt'] = (
        'Save preset in the plugin window writes <name>.json here.\n'
        'Copy a .json file into another project\'s plugins/gus_testpattern/presets/ folder to use it there.\n')
    os.makedirs(os.path.join(OUT, 'presets'))
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    with open(os.path.join(OUT, 'VERSION.txt'), 'w', newline='\n') as f:
        f.write(VERSION + '\n')
    print('built v%s ->' % VERSION, OUT)
    for name in sorted(files):
        print('  %-34s %7d bytes' % (name, os.path.getsize(os.path.join(OUT, name))))


def sha1(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


def install_user_file(src, dst):
    """Copy a file the user may also edit inside the project. A marker remembers what was
    last installed: if the project copy still matches it, repo changes go in; if it was
    edited in the project, it is kept."""
    marker = os.path.join(os.path.dirname(dst), '.' + os.path.basename(dst) + '.installed')
    name = os.path.basename(dst)
    if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
        status = 'unchanged'
    elif not os.path.exists(dst):
        status = 'added'
    else:
        last = open(marker).read().strip() if os.path.exists(marker) else ''
        if sha1(dst) != last:
            print('  KEPT the project\'s own %s: it was edited there (differs from the repo copy and the last install)' % name)
            return
        status = 'updated from the repo'
    if status != 'unchanged':
        shutil.copyfile(src, dst)
    with open(marker, 'w') as f:
        f.write(sha1(dst) + '\n')
    print('  %s %s' % (name, status))


def install(plugins_dir):
    dest = os.path.join(plugins_dir, 'gus_testpattern')
    os.makedirs(os.path.join(dest, 'logos'), exist_ok=True)
    for name in FILES:
        shutil.copyfile(os.path.join(OUT, name), os.path.join(dest, name))
    bad = [n for n in FILES if not filecmp.cmp(os.path.join(OUT, n), os.path.join(dest, n), shallow=False)]
    if bad:
        sys.exit('install check FAILED for: ' + ', '.join(bad))
    for name in USER_FILES:
        install_user_file(os.path.join(OUT, name), os.path.join(dest, name))
    os.makedirs(os.path.join(dest, 'presets'), exist_ok=True)
    print('installed v%s -> %s (all %d files byte-identical; logos/ and presets/ left alone)'
          % (VERSION, dest, len(FILES)))
    print('Close and reopen the plugin window in Designer to load it.')


if __name__ == '__main__':
    build()
    if len(sys.argv) == 3 and sys.argv[1] == '--install':
        install(sys.argv[2])
