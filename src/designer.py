# -*- coding: utf-8 -*-
"""
Test Pattern+ -- Designer-side helper (Python 2.7, runs inside Designer).

No bridge: the plugin window (served by Designer from this folder) calls
these through Designer's own /api/session/python/execute. Every call is one
quick pass on the render thread. Every function returns a JSON string.

    info()                         director/project/capabilities + web layers
    web_layers()                   Web layers on the current track, with URLs
    make_layer(name, url)          new Web layer at the playhead, URL set
    set_url(layer_name, url)       rewrite a Web layer's URL (live updates)
    screens()                      project screens with resolutions
    write_chunk(path, b64, first)  write an exported PNG/TIF in pieces
    list_logos()                   image files in <plugin>/logos/
    led_products()                 text of <plugin>/led_products.csv (parsed in the window)
    list_presets()                 every <plugin>/presets/*.json, as text
    save_preset(name, text)        write <plugin>/presets/<name>.json
    delete_preset(name)            remove it
    probe()                        dump member names to pin the soft spots

Soft spots (public docs list WebModule but not its fields): the URL field
name and how to write a value into a field sequence are hunted below and
reported by probe(). Pin them in URL_FIELDS once seen on the real machine.
"""
try:
    from d3 import *  # noqa: F401,F403
except:  # noqa: E722
    pass

VERSION = '@VERSION@'
URL_FIELDS = ('url', 'URL', 'webUrl', 'address', 'link', 'page')
SCREEN_RES_ATTRS = ('resolution', 'canvasResolution', 'pixelResolution', 'res')
WEB_CLASS = 'WebModule'
BOOKMARK_CLASS = 'WebBookmark'
BOOKMARK_DIR = 'objects/webbookmark/'          # <prefix>/<lowercase type>/<name>.apx
BOOKMARK_FIELDS = ('bookmark', 'webBookmark', 'webbookmark', 'page', 'site')
BOOKMARK_URL_ATTRS = ('url', 'URL', 'address', 'link', 'webUrl', 'homeUrl', 'homepage')
LAYER_SECONDS = 30
SIZE_MODE_FIELD = 'size_mode'
SIZE_MODE_MATCH_MAPPING = 0      # Designer's list: 0 Match Mapping, 1 Custom (seen r32.4.18)
PLUGIN_MODULE_NAMES = ('gus_testpattern', 'user_module_gus_testpattern')
EXPORT_EXTS = ('.png', '.tif', '.tiff')
IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.svg')
PRODUCTS_FILE = 'led_products.csv'
PRESET_DIR = 'presets'
PRESET_MAX = 256 * 1024

try:
    unicode
except NameError:          # lets the test-suite run this under Python 3
    unicode = str
    basestring = str
    long = int


# ------------------------------------------------------------------ JSON
def _esc(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif o < 0x20 or o > 0x7e:
            out.append('\\u%04x' % o if o < 0x10000 else '?')
        else:
            out.append(ch)
    return ''.join(out)


def _dumps(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, long, float)):
        return repr(v)
    if isinstance(v, basestring):
        if isinstance(v, str) and not isinstance(v, unicode):
            try:
                v = v.decode('utf-8')
            except:  # noqa: E722
                v = v.decode('latin-1')
        return '"' + _esc(v) + '"'
    if isinstance(v, dict):
        return '{' + ','.join(_dumps(unicode(k)) + ':' + _dumps(x) for k, x in v.items()) + '}'
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(_dumps(x) for x in v) + ']'
    return _dumps(unicode(repr(v)))


def _ok(**kw):
    kw['ok'] = True
    return _dumps(kw)


def _fail(e, **kw):
    kw['ok'] = False
    kw['error'] = unicode(e)
    return _dumps(kw)


# ----------------------------------------------------------------- utils
def _get(obj, names):
    for n in names:
        try:
            v = getattr(obj, n)
        except:  # noqa: E722
            continue
        if v is not None:
            return n, v
    return None, None


def _name(obj):
    for n in ('description', 'name'):
        try:
            v = getattr(obj, n)
            if v:
                return unicode(v)
        except:  # noqa: E722
            pass
    return unicode(repr(obj))


def _lname(layer):
    try:
        n = layer.name
        if n:
            return unicode(n)
    except:  # noqa: E722
        pass
    return _name(layer)


def _xy(v):
    for a, b in (('x', 'y'), ('width', 'height'), ('w', 'h')):
        try:
            return int(getattr(v, a)), int(getattr(v, b))
        except:  # noqa: E722
            pass
    try:
        return int(v[0]), int(v[1])
    except:  # noqa: E722
        return 0, 0


def _gs():
    try:
        return guisystem  # noqa: F821
    except NameError:
        return None


def _now():
    gs = _gs()
    for p in (('player', 'tCurrent'), ('track', 'player', 'tCurrent'), ('tCurrent',)):
        o = gs
        try:
            for a in p:
                o = getattr(o, a)
            return float(o)
        except:  # noqa: E722
            continue
    return 0.0


def _os():
    try:
        import os
        return os
    except:  # noqa: E722
        return None


def _b64decode(s):
    try:
        import base64
        return base64.b64decode(s)
    except:  # noqa: E722
        pass
    try:
        import binascii
        return binascii.a2b_base64(s)
    except:  # noqa: E722
        pass
    return s.decode('base64')    # Py2 built-in codec, no import needed


# ------------------------------------------------------------ track/layers
# Documented API (developer.disguise.one, Track & Sequencing guide):
#   guisystem.track                          current track
#   guisystem.player.tCurrent                playhead, in beats
#   track.addNewLayer(Module, startBeats, lengthBeats, name) -> layer
#   track.layers / layer.name / layer.tStart
#   layer.findSequence(name) / layer.fields[i]  -> field sequence
#   fseq.disableSequencing = True;  fseq.sequence.setString(beat, text)
#   fseq.eval(beat, default)
def _track():
    gs = _gs()
    return getattr(gs, 'track', None) if gs else None


def _layers():
    t = _track()
    try:
        return list(t.layers)
    except:  # noqa: E722
        return []


def _cls(name):
    """Class from the d3 names this module received. Never imports: Designer's
    restricted scope blocks `import d3` / `import sys` at run time."""
    c = globals().get(name)
    if c is None:
        try:
            c = __builtins__.get(name) if isinstance(__builtins__, dict) else getattr(__builtins__, name, None)
        except:  # noqa: E722
            c = None
    return c


def _names_like(*words):
    out = []
    for k in list(globals().keys()):
        lk = k.lower()
        if any(w in lk for w in words) and not k.startswith('_') and k != k.upper():
            out.append(k)
    return sorted(out)


def _is_web(layer):
    mt = getattr(layer, 'moduleType', None)
    if mt is None:
        return False
    if mt is _cls(WEB_CLASS):
        return True
    return WEB_CLASS in getattr(mt, '__name__', unicode(mt))


def _field_name(fs):
    _, n = _get(fs, ('name', 'fieldName', 'description', 'displayName', 'userName'))
    return unicode(n) if n is not None else u''


def _url_field(layer):
    for n in URL_FIELDS:
        try:
            fs = layer.findSequence(n)
        except:  # noqa: E722
            fs = None
        if fs is not None:
            return n, fs
    try:
        fields = list(layer.fields)
    except:  # noqa: E722
        return None, None
    low = [u.lower() for u in URL_FIELDS]
    for f in fields:
        fn = _field_name(f)
        if fn in URL_FIELDS or fn.lower() in low:
            return fn, f
    return None, None


def _seq(fs):
    return getattr(fs, 'sequence', fs)


def _t0(layer):
    try:
        return float(layer.tStart)
    except:  # noqa: E722
        return _now()


def _read(fs, t):
    try:
        v = fs.eval(t, u'')
        if v is not None:
            return unicode(v)
    except:  # noqa: E722
        pass
    seq = _seq(fs)
    for how in ('getString', 'getValue', 'get'):
        fn = getattr(seq, how, None)
        if fn is None:
            continue
        try:
            v = fn(t)
            if v is not None:
                return unicode(v)
        except:  # noqa: E722
            continue
    try:
        return unicode(seq.key(0).v)
    except:  # noqa: E722
        return None


def _write(fs, value, t):
    """Constant text value: sequencing off, one key at the layer's start beat."""
    try:
        fs.disableSequencing = True
    except:  # noqa: E722
        pass
    seq = _seq(fs)
    try:
        seq.setString(t, value)
        return 'setString'
    except:  # noqa: E722
        pass
    try:
        seq.key(0).v = value
        return 'key(0).v'
    except:  # noqa: E722
        pass
    for how in ('setValue', 'set'):
        fn = getattr(seq, how, None)
        if fn is None:
            continue
        try:
            fn(t, value)
            return how
        except:  # noqa: E722
            continue
    return None


def _find(name):
    for l in _layers():
        if _lname(l) == name:
            return l
    return None


def _notify(layer, fs):
    try:
        layer.notifyEdit(fs)
    except:  # noqa: E722
        pass


def _span(track, start, seconds):
    try:
        return track.timeToBeat(track.beatToTime(start) + seconds) - start
    except:  # noqa: E722
        return seconds


# ------------------------------------------------------------- bookmarks
# A Web layer shows a WebBookmark resource; the URL lives on the bookmark.
def _rm():
    try:
        return resourceManager  # noqa: F821
    except NameError:
        return None


def _safe_name(name):
    out = []
    for ch in name:
        out.append(ch if (ch.isalnum() or ch in u' _-.') else u'_')
    return (u''.join(out).strip() or u'test pattern')[:80]


def _bm_url_attr(bm):
    for a in BOOKMARK_URL_ATTRS:
        try:
            v = getattr(bm, a)
        except:  # noqa: E722
            continue
        if isinstance(v, basestring) or v is None:
            return a
    return None


def _bm_set_url(bm, url):
    a = _bm_url_attr(bm)
    if a is None:
        return None
    setattr(bm, a, url)
    for save in ('saveOnDelete', 'save'):
        try:
            getattr(bm, save)()
            break
        except:  # noqa: E722
            continue
    return a


def _bm_get_url(bm):
    a = _bm_url_attr(bm)
    try:
        return unicode(getattr(bm, a)) if a else None
    except:  # noqa: E722
        return None


class _NoClass(Exception):
    pass


def _make_bookmark(name, url):
    _at(u'find resourceManager')
    rm = _rm()
    _at(u'find %s class' % BOOKMARK_CLASS)
    cls = _cls(BOOKMARK_CLASS)
    if rm is None:
        raise _NoClass('resourceManager not available')
    if cls is None:
        raise _NoClass('%s class not available to plugins (similar names: %s)'
                       % (BOOKMARK_CLASS, ', '.join(_names_like('bookmark', 'web')) or 'none'))
    path = BOOKMARK_DIR + _safe_name(name).lower() + '.apx'
    _at(u'loadOrCreate ' + path)
    bm = rm.loadOrCreate(path, cls)
    if bm is None:
        raise Exception('loadOrCreate returned nothing for ' + path)
    _at(u'set bookmark URL')
    how = _bm_set_url(bm, url)
    return bm, path, how


def _bookmark_field(layer):
    for n in BOOKMARK_FIELDS:
        try:
            fs = layer.findSequence(n)
        except:  # noqa: E722
            fs = None
        if fs is not None:
            return n, fs
    try:
        fields = list(layer.fields)
    except:  # noqa: E722
        return None, None
    for f in fields:
        fn = _field_name(f)
        if 'bookmark' in fn.lower():
            return fn, f
    return None, None


def _assign_resource(fs, res, t):
    try:
        fs.disableSequencing = True
    except:  # noqa: E722
        pass
    seq = _seq(fs)
    try:
        seq.setResource(t, res)
        return 'setResource'
    except:  # noqa: E722
        pass
    try:
        seq.key(0).r = res
        return 'key(0).r'
    except:  # noqa: E722
        pass
    try:
        seq.key(0).v = res
        return 'key(0).v'
    except:  # noqa: E722
        return None


def _layer_bookmark(layer):
    fn, fs = _bookmark_field(layer)
    if fs is None:
        return None
    try:
        r = fs.eval(_t0(layer), None)
        if r is not None and not isinstance(r, (basestring, int, float)):
            return r
    except:  # noqa: E722
        pass
    try:
        k = _seq(fs).key(0)
        for a in ('r', 'v', 'resource'):
            r = getattr(k, a, None)
            if r is not None and not isinstance(r, (basestring, int, float)):
                return r
    except:  # noqa: E722
        pass
    return None


def _fields(layer):
    return [_field_name(f) for f in getattr(layer, 'fields', [])]


# ----------------------------------------------------------------- guard
_STEP = [u'']


def _at(step):
    """Record the sub-step in progress so an error can say where it happened."""
    _STEP[0] = step


def _guard(fn, *a):
    """Run fn; whatever is raised, answer with JSON. No sys/traceback imports:
    Designer blocks them, and an import inside the handler was itself the crash
    in v2.6.0."""
    _at(u'')
    try:
        return fn(*a)
    except BaseException as e:
        try:
            msg = u'%s: %s' % (type(e).__name__, e)
        except:  # noqa: E722
            msg = u'unprintable error'
        return _dumps({'ok': False, 'error': msg, 'step': _STEP[0]})
    except:  # noqa: E722  (old-style class raised)
        return _dumps({'ok': False, 'error': u'non-standard error', 'step': _STEP[0]})


# --------------------------------------------- stepwise layer + bookmark
def _add_layer(name, seconds):
    track = _track()
    if track is None:
        return _fail('guisystem.track not available')
    cls = _cls(WEB_CLASS)
    if cls is None:
        return _fail('%s class not found in d3' % WEB_CLASS)
    existing = set(_lname(l) for l in _layers())
    base, n = name, 2
    while name in existing:
        name = u'%s %d' % (base, n)
        n += 1
    start = _now()
    layer = track.addNewLayer(cls, start, _span(track, start, seconds), name)
    if layer is None:
        layer = _find(name)
    if layer is None:
        return _fail('addNewLayer returned nothing and no layer named %s' % name)
    bf, _ = _bookmark_field(layer)
    _at(u'set size mode')
    before, how, after = _set_enum(layer, SIZE_MODE_FIELD, SIZE_MODE_MATCH_MAPPING)
    return _ok(layer=_lname(layer), seconds=seconds, fields=_fields(layer), bookmarkField=bf,
               sizeModeBefore=before, sizeModeAfter=after, sizeModeHow=how)


def _set_enum(layer, field, value):
    """Constant value on an enum field (sequencing off). Returns (old value, how)."""
    try:
        fs = layer.findSequence(field)
    except:  # noqa: E722
        fs = None
    if fs is None:
        return None, None
    t = _t0(layer)
    # Never fs.eval() here: Designer resolves size_mode against the layer's mapping and
    # evaluating it from Python hits "Nested expression hit recursion limit" (r32.4.18).
    # Read the stored key instead.
    before = _key0(fs)
    try:
        fs.disableSequencing = True
    except:  # noqa: E722
        pass
    seq = _seq(fs)
    for how, fn in (('setFloat', lambda: seq.setFloat(t, float(value))),
                    ('key(0).v', lambda: setattr(seq.key(0), 'v', value)),
                    ('setValue', lambda: seq.setValue(t, value))):
        try:
            fn()
            _notify(layer, fs)
            return before, how, _key0(fs)
        except:  # noqa: E722
            continue
    return before, None, _key0(fs)


def _key0(fs):
    """Stored value of the field's first key, without evaluating it."""
    try:
        v = _seq(fs).key(0).v
        return int(v) if isinstance(v, (int, long, float)) else unicode(v)
    except:  # noqa: E722
        return None


def add_layer(name, seconds=LAYER_SECONDS):
    return _guard(_add_layer, name, seconds)


def _make_bookmark_step(name, url):
    bm, path, how = _make_bookmark(name, url)
    if not how:
        return _fail('bookmark created but it has no URL property I recognise',
                     bookmark=_name(bm), path=path, attrs=_public(bm))
    return _ok(bookmark=_name(bm), path=path, urlAttr=how)


def make_bookmark(name, url):
    return _guard(_make_bookmark_step, name, url)


def _attach_step(layer_name, path):
    _at(u'find layer')
    layer = _find(layer_name)
    if layer is None:
        return _fail('no layer named %s on this track' % layer_name)
    rm, cls = _rm(), _cls(BOOKMARK_CLASS)
    _at(u'load bookmark ' + path)
    bm = rm.loadOrCreate(path, cls)
    _at(u'find bookmark field')
    bf, bfs = _bookmark_field(layer)
    if bfs is None:
        return _fail('layer has no bookmark field I recognise', fields=_fields(layer))
    _at(u'assign bookmark to ' + bf)
    how = _assign_resource(bfs, bm, _t0(layer))
    if not how:
        return _fail('could not assign the bookmark', field=bf)
    _notify(layer, bfs)
    return _ok(layer=layer_name, field=bf, how=how)


def attach_bookmark(layer_name, path):
    return _guard(_attach_step, layer_name, path)


def _url_field_step(layer_name, url):
    layer = _find(layer_name)
    if layer is None:
        return _fail('no layer named %s on this track' % layer_name)
    fn, fs = _url_field(layer)
    if fs is None:
        return _fail('no URL field', fields=_fields(layer))
    how = _write(fs, url, _t0(layer))
    if not how:
        return _fail('could not write the URL field', field=fn)
    _notify(layer, fs)
    return _ok(field=fn, how=how)


def set_url_field(layer_name, url):
    return _guard(_url_field_step, layer_name, url)


# ----------------------------------------------------------------- API
def _web_layers_impl():
    try:
        out = []
        for l in _layers():
            if not _is_web(l):
                continue
            bm = _layer_bookmark(l)
            url, via = None, None
            if bm is not None:
                url, via = _bm_get_url(bm), 'bookmark ' + _name(bm)
            else:
                fn, fs = _url_field(l)
                if fs is not None:
                    url, via = _read(fs, _t0(l)), 'field ' + fn
            out.append({'name': _lname(l), 'url': url, 'via': via})
        return _ok(layers=out)
    except BaseException as e:
        return _fail(e, layers=[])


def _set_url_impl(layer_name, url):
    """Live update: rewrite the URL on the layer's bookmark (or URL field)."""
    try:
        layer = _find(layer_name)
        if layer is None:
            return _fail('no layer named %s on this track' % layer_name)
        bm = _layer_bookmark(layer)
        if bm is not None:
            how = _bm_set_url(bm, url)
            if not how:
                return _fail('bookmark has no URL property', bookmark=_name(bm), attrs=_public(bm))
            return _ok(layer=layer_name, bookmark=_name(bm), how='bookmark.' + how)
        fn, fs = _url_field(layer)
        if fs is None:
            return _fail('layer has no bookmark assigned and no URL field', fields=_fields(layer))
        how = _write(fs, url, _t0(layer))
        if not how:
            return _fail('could not write the URL field', field=fn)
        _notify(layer, fs)
        return _ok(layer=layer_name, field=fn, how=how)
    except BaseException as e:
        return _fail(e)


def _make_layer_impl(name, url, seconds=LAYER_SECONDS):
    """New Web layer at the playhead, a WebBookmark with the same name holding
    the URL, and the bookmark assigned to the layer."""
    report = {}
    try:
        track = _track()
        if track is None:
            return _fail('guisystem.track not available')
        cls = _cls(WEB_CLASS)
        if cls is None:
            return _fail('%s class not found in d3' % WEB_CLASS)
        existing = set(_lname(l) for l in _layers())
        base, n = name, 2
        while name in existing:
            name = u'%s %d' % (base, n)
            n += 1
        start = _now()
        layer = track.addNewLayer(cls, start, _span(track, start, seconds), name)
        if layer is None:
            layer = _find(name)
        if layer is None:
            return _fail('addNewLayer returned nothing and no layer named %s' % name)
        report.update(layer=_lname(layer), seconds=seconds, fields=_fields(layer))

        # 1. bookmark with the same name, URL on it
        try:
            bm, path, how = _make_bookmark(name, url)
            report.update(bookmark=_name(bm), bookmarkPath=path, bookmarkUrlAttr=how)
            if not how:
                report['bookmarkAttrs'] = _public(bm)
        except BaseException as e:
            bm = None
            report['bookmarkError'] = unicode(e)

        # 2. assign it to the layer
        if bm is not None:
            bf, bfs = _bookmark_field(layer)
            report['bookmarkField'] = bf
            if bfs is not None:
                report['assigned'] = _assign_resource(bfs, bm, _t0(layer))
                if report['assigned']:
                    _notify(layer, bfs)

        report['urlSet'] = bool(report.get('assigned') and report.get('bookmarkUrlAttr'))

        # 3. fallback: a plain URL field on the layer
        if not report['urlSet']:
            fn, fs = _url_field(layer)
            if fs is not None:
                how = _write(fs, url, _t0(layer))
                if how:
                    _notify(layer, fs)
                    report.update(urlSet=True, urlField=fn, how=how)
        return _ok(**report)
    except BaseException as e:
        return _fail(e, **report)


def _screen_candidates():
    tried = []
    try:
        rm = resourceManager  # noqa: F821
        for cls in ('Screen2', 'LedScreen'):
            try:
                tried.extend(rm.allResources(globals()[cls]))
            except:  # noqa: E722
                pass
    except NameError:
        pass
    seen, out = set(), []
    for s in tried:
        if id(s) in seen:
            continue
        seen.add(id(s))
        cname = type(s).__name__
        if 'Screen' not in cname and 'Projector' not in cname:
            continue
        _, res = _get(s, SCREEN_RES_ATTRS)
        w, h = _xy(res) if res is not None else (0, 0)
        out.append({'name': _name(s), 'w': w, 'h': h})
    return sorted(out, key=lambda x: x['name'].lower())


def _screens_impl():
    try:
        return _ok(screens=_screen_candidates())
    except BaseException as e:
        return _fail(e, screens=[])


def _plugin_dir():
    os = _os()
    if os is None:
        return None
    for mod in PLUGIN_MODULE_NAMES:
        try:
            m = __import__(mod)
            f = getattr(m, '__file__', None)
            if f:
                return os.path.dirname(os.path.abspath(f))
        except:  # noqa: E722
            continue
    f = globals().get('__file__')
    return os.path.dirname(os.path.abspath(f)) if f else None


def _project_dir():
    os = _os()
    pd = _plugin_dir()
    if os and pd and os.path.basename(os.path.dirname(pd)).lower() == 'plugins':
        return os.path.dirname(os.path.dirname(pd))
    return None


def _info():
    os = _os()
    caps = {'os': os is not None}
    for mod in ('base64', 'binascii'):
        try:
            __import__(mod)
            caps[mod] = True
        except:  # noqa: E722
            caps[mod] = False
    proj = _project_dir()
    return {'ok': True, 'version': VERSION, 'project': proj, 'pluginDir': _plugin_dir(),
            'exportDir': os.path.join(proj, 'objects', 'VideoFile', 'test patterns+') if (os and proj) else None,
            'caps': caps, 'now': _now()}


def _info_impl():
    try:
        return _dumps(_info())
    except BaseException as e:
        return _fail(e)


def _safe_path(path):
    os = _os()
    if os is None:
        raise Exception('os module not available in Designer Python; use the browser download instead')
    p = os.path.normpath(path)
    if '..' in p.replace('\\', '/').split('/'):
        raise Exception('path may not contain ..')
    if not p.lower().endswith(EXPORT_EXTS):
        raise Exception('only .png / .tif files can be written')
    return os, p


def _write_chunk_impl(path, b64, first):
    try:
        os, p = _safe_path(path)
        d = os.path.dirname(p)
        if d and not os.path.isdir(d):
            os.makedirs(d)
        data = _b64decode(b64)
        f = open(p, 'wb' if first else 'ab')
        try:
            f.write(data)
        finally:
            f.close()
        return _ok(path=p, size=os.path.getsize(p))
    except BaseException as e:
        return _fail(e)


def _list_logos_impl():
    try:
        os = _os()
        pd = _plugin_dir()
        if not (os and pd):
            return _ok(logos=[], note='folder listing unavailable; type the file name')
        d = os.path.join(pd, 'logos')
        if not os.path.isdir(d):
            return _ok(logos=[])
        return _ok(logos=sorted(f for f in os.listdir(d) if f.lower().endswith(IMAGE_EXTS)))
    except BaseException as e:
        return _fail(e, logos=[])


def _read_text(p):
    """File as unicode. Excel saves CSV as UTF-8 with a BOM, or as Windows-1252."""
    f = open(p, 'rb')
    try:
        data = f.read()
    finally:
        f.close()
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return data.decode(enc)
        except:  # noqa: E722
            continue
    return u''


def _write_text(p, text):
    if not isinstance(text, unicode):
        text = text.decode('utf-8')
    f = open(p, 'wb')
    try:
        f.write(text.encode('utf-8'))
    finally:
        f.close()


def _need_plugin_dir():
    os, pd = _os(), _plugin_dir()
    if not (os and pd):
        raise Exception('plugin folder not found from Designer Python')
    return os, pd


def _led_products_impl():
    _at(u'find plugin folder')
    os, pd = _need_plugin_dir()
    p = os.path.join(pd, PRODUCTS_FILE)
    if not os.path.isfile(p):
        return _ok(text=u'', path=p, missing=True)
    _at(u'read ' + PRODUCTS_FILE)
    return _ok(text=_read_text(p), path=p)


def _preset_file(name):
    os, pd = _need_plugin_dir()
    safe = _safe_name(name)
    if safe.startswith(u'.'):
        safe = u'_' + safe[1:]
    return os, os.path.join(pd, PRESET_DIR), safe + u'.json'


def _list_presets_impl():
    _at(u'find plugin folder')
    os, pd = _need_plugin_dir()
    d = os.path.join(pd, PRESET_DIR)
    out = []
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if not f.lower().endswith('.json') or not os.path.isfile(p) or os.path.getsize(p) > PRESET_MAX:
                continue
            _at(u'read preset ' + f)
            out.append({'file': f, 'text': _read_text(p)})
    return _ok(presets=out, dir=d)


def _save_preset_impl(name, text):
    if not text or len(text) > PRESET_MAX or not text.lstrip().startswith(u'{'):
        return _fail('preset text must be a JSON object under %d KB' % (PRESET_MAX // 1024))
    os, d, f = _preset_file(name)
    _at(u'make ' + d)
    if not os.path.isdir(d):
        os.makedirs(d)
    p = os.path.join(d, f)
    _at(u'write ' + p)
    _write_text(p, text)
    return _ok(file=f, path=p, dir=d)


def _delete_preset_impl(name):
    os, d, f = _preset_file(name)
    p = os.path.join(d, f)
    if not os.path.isfile(p):
        return _fail('no preset file %s' % f)
    os.remove(p)
    return _ok(file=f, path=p)


def _public(o):
    try:
        return sorted(a for a in dir(o) if not a.startswith('_'))
    except:  # noqa: E722
        return []


def _probe_impl():
    out = {'info': _info()}
    track = _track()
    out['track'] = _public(track)
    webs = []
    for l in _layers():
        if not _is_web(l):
            continue
        try:
            fs = list(l.fields)
            fn, uf = _url_field(l)
            seq = _seq(uf) if uf is not None else None
            bf, bfs = _bookmark_field(l)
            if bfs is not None:
                bseq = _seq(bfs)
                webs_extra = {'bookmarkFieldType': type(bfs).__name__, 'bookmarkSeqType': type(bseq).__name__,
                              'bookmarkSeq': _public(bseq), 'bookmarkFieldAttrs': _public(bfs)}
            else:
                webs_extra = {}
            webs.append({'layer': _lname(l), 'fields': [_field_name(f) for f in fs],
                         'bookmarkField': bf, 'bookmark': _name(_layer_bookmark(l)) if _layer_bookmark(l) is not None else None,
                         'urlField': fn, 'urlValue': _read(uf, _t0(l)) if uf is not None else None,
                         'fieldSequence': _public(uf) if uf is not None else _public(fs[0]) if fs else [],
                         'sequence': _public(seq)})
            webs[-1].update(webs_extra)
        except BaseException as e:
            webs.append({'layer': _lname(l), 'error': unicode(e)})
    out['namesLikeWebOrBookmark'] = _names_like('bookmark', 'web')
    out['moduleGlobalCount'] = len(globals())
    cls = _cls(BOOKMARK_CLASS)
    out['webBookmarkClass'] = _public(cls) if cls is not None else 'WebBookmark not found'
    try:
        bms = _rm().allResources(cls) if cls is not None else []
        out['webBookmarks'] = [{'name': _name(b), 'path': unicode(getattr(b, 'path', '')),
                                'urlAttr': _bm_url_attr(b), 'url': _bm_get_url(b), 'attrs': _public(b)} for b in bms[:5]]
    except BaseException as e:
        out['webBookmarks'] = unicode(e)
    out['webLayers'] = webs or 'none on this track: add a Web layer and probe again'
    out['screens'] = _screen_candidates()
    return _dumps(out)


# ------------------------------------------------- guarded public entry points
def web_layers():
    return _guard(_web_layers_impl)


def set_url(layer_name, url):
    return _guard(_set_url_impl, layer_name, url)


def screens():
    return _guard(_screens_impl)


def write_chunk(path, b64, first):
    return _guard(_write_chunk_impl, path, b64, first)


def list_logos():
    return _guard(_list_logos_impl)


def led_products():
    return _guard(_led_products_impl)


def list_presets():
    return _guard(_list_presets_impl)


def save_preset(name, text):
    return _guard(_save_preset_impl, name, text)


def delete_preset(name):
    return _guard(_delete_preset_impl, name)


def probe():
    return _guard(_probe_impl)


def info():
    return _guard(_info_impl)


def make_layer(name, url, seconds=LAYER_SECONDS):
    return _guard(_make_layer_impl, name, url, seconds)
