#!/usr/bin/env python3
"""Build, then run the browser tests against a fake Designer.

    python tests/run_tests.py

Needs: Python 3, Node 18+, and `npm install` + `npx playwright install chromium` once.
Each test gets a fresh mock (tests create layers with fixed names).
Screenshots/renders land in tests/out/.
"""
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'out')
TESTS = ['e2e.mjs', 'e2e_led.mjs', 'e2e_grad.mjs']


def red_png(path, size=64):
    """Tiny solid-red PNG without needing Pillow (e2e.mjs checks a logo draws)."""
    raw = b''.join(b'\x00' + b'\xff\x00\x00' * size for _ in range(size))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def wait_up(port):
    for _ in range(50):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/api/session/status/session' % port, timeout=1)
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError('mock designer did not start on %d' % port)


def main():
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'build.py')])
    os.makedirs(OUT, exist_ok=True)
    failed = []
    for i, test in enumerate(TESTS):
        proj = tempfile.mkdtemp(prefix='tp_proj_')
        plug = os.path.join(proj, 'plugins', 'testpattern-plus')
        shutil.copytree(os.path.join(ROOT, 'dist', 'testpattern-plus'), plug)
        red_png(os.path.join(plug, 'logos', 'red.png'))
        # a user's own product list, the way Excel saves it (BOM, CRLF): one new product and
        # one override of a built-in (same name, different notes)
        with open(os.path.join(plug, 'my_led_products.csv'), 'w', encoding='utf-8-sig', newline='\r\n') as f:
            f.write('manufacturer,product,pitch_mm,tile_w_mm,tile_h_mm,tile_w_px,tile_h_px,modules_across,modules_down,half_modules_down,notes\n'
                    'Test Maker,Panel X,3.9,500,1000,128,256,4,4,,my own panel\n'
                    'ROE,Carbon CB3,3.75,600,1200,160,320,2,8,4,my override\n')
        port = 8790 + i
        mock = subprocess.Popen([sys.executable, os.path.join(HERE, 'mock_designer.py'), proj, str(port)])
        try:
            wait_up(port)
            print('\n=== %s ===' % test, flush=True)
            r = subprocess.run(['node', os.path.join(HERE, test), str(port), OUT], cwd=ROOT, timeout=180)
            if r.returncode:
                failed.append(test)
        finally:
            mock.terminate()
            mock.wait()
            shutil.rmtree(proj, ignore_errors=True)
    print('\nFAILED: ' + ', '.join(failed) if failed else '\nall tests ran (check the JSON above: "errs" should be [])')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
