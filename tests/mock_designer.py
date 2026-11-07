"""
Stand-in for Designer, for tests only.

- Serves {project}/plugins/<folder>/ at /plugins/<folder>/ (any plugin folder name)
- GET  /api/session/status/session
- POST /api/session/python/registermodule  {moduleName, contents}
- POST /api/session/python/execute         {moduleName, script}
  executes the real module source against a fake track / Web layer model.

Usage: python mock_designer.py <project_dir> <port>
"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ---- fake d3 object model (shaped on the documented API) -----------------
class Key(object):
    def __init__(self, t, v):
        self.t, self.v = t, v


class KeySequence(object):
    """setString/setFloat at a beat replace a key at the same beat, else add one."""
    def __init__(self, default):
        self.keys = [Key(0.0, default)]

    def _set(self, t, v):
        for k in self.keys:
            if abs(k.t - t) < 1e-9:
                k.v = v
                return
        self.keys.append(Key(t, v))
        self.keys.sort(key=lambda k: k.t)

    setString = _set
    setFloat = _set
    setResource = _set

    def key(self, i):
        return self.keys[i]

    def nKeys(self):
        return len(self.keys)


class FieldSequence(object):
    def __init__(self, name, default):
        self.name, self.sequence, self.disableSequencing = name, KeySequence(default), False

    def eval(self, t, default):
        if self.name == 'size_mode' and not MOCK_INTERNAL[0]:
            # Designer r32.4.18: "Nested expression hit recursion limit in field size_mode"
            raise RuntimeError('Nested expression hit recursion limit in field size_mode')
        ks = self.sequence.keys
        if self.disableSequencing:
            return ks[0].v if len(ks) == 1 else [k for k in ks if k.t <= t][-1].v if any(k.t <= t for k in ks) else ks[0].v
        best = ks[0]
        for k in ks:
            if k.t <= t:
                best = k
        return best.v


MOCK_INTERNAL = [False]


class WebModule(object):
    pass


class WebBookmark(object):
    def __init__(self, path):
        self.path = path
        self.description = path.rsplit('/', 1)[-1][:-4]
        self.url = ''
        self.saves = 0

    def saveOnDelete(self):
        self.saves += 1


class VideoModule(object):
    pass


class Layer(object):
    def __init__(self, name, cls, start, length):
        self.name, self.moduleType, self.tStart, self.tLength = name, cls, start, length
        self.description = name + ' in track track 1'      # as Designer reports it
        real = ["blendMode","brightness","mapping","palette","xCol","yCol","tint.r","tint.g","tint.b","tint.a",
                "bookmark","Command","fade_up_time","framerateFraction","size_mode","width","height"]
        defaults = {'bookmark': None, 'size_mode': 1.0, 'width': 1024.0, 'height': 768.0}
        self.fields = [FieldSequence(n, defaults.get(n, 0.0)) for n in real]
        self.edits = 0

    def findSequence(self, name):
        for f in self.fields:
            if f.name == name:
                return f
        return None

    def notifyEdit(self, fs):
        self.edits += 1


class Int2(object):
    def __init__(self, x, y):
        self.x, self.y = x, y


class Screen2(object):
    def __init__(self, d, w, h):
        self.description, self.resolution = d, Int2(w, h)


class HardCrash(BaseException):
    """Not an Exception subclass: `except Exception` won't catch it."""


class RM(object):
    def __init__(self, items):
        self.items = items

    def allResources(self, cls):
        return [i for i in self.items if isinstance(i, cls)]

    def loadOrCreate(self, path, cls):
        if os.environ.get('MOCK_BOOKMARK_CRASH'):
            raise HardCrash('loadOrCreate blew up (simulated C++ PythonException)')
        assert path == path.lower(), 'resource paths are lowercase'
        for i in self.items:
            if isinstance(i, cls) and getattr(i, 'path', None) == path:
                return i
        r = cls(path)
        self.items.append(r)
        return r


class Player(object):
    tCurrent = 30.0          # beats


class Track(object):
    """No layerStack / newLayerOfClass: only what the docs describe."""
    def __init__(self):
        self.layers = []

    def addNewLayer(self, cls, start, length, name):
        l = Layer(name, cls, start, length)
        self.layers.append(l)
        return l

    def timeToBeat(self, s):
        return s * 2.0       # 120 bpm

    def beatToTime(self, b):
        return b / 2.0


class GS(object):
    def __init__(self):
        self.track = Track()
        self.player = Player()


WORLD = {'guisystem': GS(), 'Screen2': Screen2, 'WebModule': WebModule, 'WebBookmark': WebBookmark, 'VideoModule': VideoModule,
         'resourceManager': RM([Screen2('LED_A', 1152, 576), Screen2('Proj 1', 1920, 1200)])}
MODULES = {}
LOG = []


class RestrictedImportError(BaseException):
    pass


_real_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __builtins__['__import__']
BLOCKED = {'sys', 'traceback'}   # d3: not present in the mock -> plain ImportError


def _restricted_import(name, *a, **k):
    if name.split('.')[0] in BLOCKED:
        raise RestrictedImportError('Cannot import module ' + name)
    return _real_import(name, *a, **k)


def load_module(name, src):
    import builtins
    b = dict(builtins.__dict__)
    b['__import__'] = _restricted_import
    ns = {'__name__': name, '__builtins__': b}
    exec(compile(src, name, 'exec'), ns)
    world = dict(WORLD)
    if os.environ.get('MOCK_NO_BOOKMARK_CLASS'):
        world.pop('WebBookmark', None)
    ns.update(world)
    MODULES[name] = ns


def execute(mod, script):
    ns = MODULES[mod]
    body = 'def __tp_call():\n' + '\n'.join('    ' + l for l in script.splitlines())
    exec(body, ns)
    return ns['__tp_call']()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json'):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        if path == '/api/session/status/session':
            return self._send(200, {'isRunningSolo': True, 'director': {'hostname': 'localhost'}})
        if path == '/__world':
            ls = WORLD['guisystem'].track.layers
            out = []
            MOCK_INTERNAL[0] = True
            for l in ls:
                bm = l.findSequence('bookmark').eval(l.tStart, None)
                out.append({'name': l.name, 'keys': l.findSequence('bookmark').sequence.nKeys(),
                            'bookmark': bm.description if bm else None, 'bookmarkPath': bm.path if bm else None,
                            'url': bm.url if bm else None, 'saves': bm.saves if bm else 0,
                            'tStart': l.tStart, 'tLength': l.tLength,
                            'seconds': (l.tLength) / 2.0,
                            'disableSequencing': l.findSequence('bookmark').disableSequencing,
                            'web': l.moduleType is WebModule, 'edits': l.edits,
                            'sizeMode': l.findSequence('size_mode').eval(l.tStart, None),
                            'sizeModeSeqOff': l.findSequence('size_mode').disableSequencing})
            MOCK_INTERNAL[0] = False
            return self._send(200, out)
        prefix = '/plugins/'
        if path.startswith(prefix):
            from urllib.parse import unquote
            rel = unquote(path[len(prefix):])
            if rel.endswith('/'):
                rel += 'index.html'
            f = os.path.normpath(os.path.join(self.server.plugins, rel))
            if not f.startswith(self.server.plugins + os.sep) or not os.path.isfile(f):
                return self._send(404, b'nf', 'text/plain')
            ext = f.rsplit('.', 1)[-1].lower()
            ct = {'html': 'text/html; charset=utf-8', 'png': 'image/png', 'svg': 'image/svg+xml',
                  'jpg': 'image/jpeg'}.get(ext, 'application/octet-stream')
            with open(f, 'rb') as fh:
                return self._send(200, fh.read(), ct)
        return self._send(404, b'nf', 'text/plain')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode())
        LOG.append((self.path, b.get('moduleName'), (b.get('script') or '')[:80]))
        if self.path == '/api/session/python/registermodule':
            load_module(b['moduleName'], b['contents'])
            return self._send(200, {'status': {'code': 0, 'message': ''}})
        if self.path == '/api/session/python/execute':
            layers = WORLD['guisystem'].track.layers
            before = list(layers)
            try:
                rv = execute(b['moduleName'], b['script'])
                # Real Designer: "The returned values will be serialised as JSON using the Python json package."
                return self._send(200, {'status': {'code': 0, 'message': '', 'details': []},
                                        'returnValue': json.dumps(rv), 'pythonLog': '',
                                        'd3Log': 'Python script took 1.0ms'})
            except BaseException as e:
                layers[:] = before          # Designer appears to undo a failed call
                msg = 'Failed to run plugin: %s\nError code: 0, Error message: class PythonException in pythonobject.cpp (%s)' % (b['moduleName'], e)
                return self._send(500, {'status': {'code': 5000, 'message': msg, 'details': []},
                                        'returnValue': None, 'pythonLog': '', 'd3Log': ''})
        return self._send(404, b'nf', 'text/plain')


def serve(project, port):
    plugins = os.path.join(project, 'plugins')
    sys.path.insert(0, plugins)   # so __import__('<folder>') finds the plugin's __init__.py and its __file__
    srv = ThreadingHTTPServer(('0.0.0.0', port), H)
    srv.plugins = os.path.abspath(plugins)
    return srv


if __name__ == '__main__':
    s = serve(sys.argv[1], int(sys.argv[2]))
    print('mock designer on', s.server_address, flush=True)
    s.serve_forever()

