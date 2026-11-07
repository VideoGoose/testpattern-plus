#!/usr/bin/env python3
"""Assemble dist/gus_testpattern/ -- the folder that goes in {project}/plugins/.

    python build.py                       # build only
    python build.py --install "<plugins dir>"   # build, copy into a Designer project's plugins
                                          # folder, and byte-check the copy
"""
import filecmp
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(HERE, 'dist', 'gus_testpattern')
VERSION = '2.12.0'   # bump on every change you install
FILES = ['index.html', 'out.html', '__init__.py', 'd3plugin.json', 'VERSION.txt']


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
    for name, text in files.items():
        with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    with open(os.path.join(OUT, 'VERSION.txt'), 'w', newline='\n') as f:
        f.write(VERSION + '\n')
    print('built v%s ->' % VERSION, OUT)
    for name in sorted(files):
        print('  %-34s %7d bytes' % (name, os.path.getsize(os.path.join(OUT, name))))


def install(plugins_dir):
    dest = os.path.join(plugins_dir, 'gus_testpattern')
    os.makedirs(os.path.join(dest, 'logos'), exist_ok=True)
    for name in FILES:
        shutil.copyfile(os.path.join(OUT, name), os.path.join(dest, name))
    bad = [n for n in FILES if not filecmp.cmp(os.path.join(OUT, n), os.path.join(dest, n), shallow=False)]
    if bad:
        sys.exit('install check FAILED for: ' + ', '.join(bad))
    print('installed v%s -> %s (all %d files byte-identical; logos/ left alone)' % (VERSION, dest, len(FILES)))
    print('Close and reopen the plugin window in Designer to load it.')


if __name__ == '__main__':
    build()
    if len(sys.argv) == 3 and sys.argv[1] == '--install':
        install(sys.argv[2])
