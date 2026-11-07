/*
 * gus test pattern renderer.
 *
 * One renderer shared by the plugin preview, the output page that a Designer
 * Web layer loads, and the node test harness, so what you tune in the plugin
 * window is byte-for-byte what reaches the LED / projector.
 *
 * Parity with disguise TestPatternModule:
 *   gridMode (Off/Lines), gridSpacing, subGridSpacing, circles, circleRadius,
 *   label (name + resolution), logoTopLeft, logoBottomRight,
 *   input exposure (stops), input gamma, input contrast.
 * Additions: per-element line thickness, colours, grid origin, border,
 *   corner circles, centre cross, diagonals, label size, logo size.
 *
 * All geometry is snapped to whole pixels so a 1 px line is one pixel wide.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GusTP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // name: [type, default, min, max, label, group]
  var SCHEMA = {
    ledWall:          ['bool', 0, 0, 1, 'LED wall mode', 'LED wall'],
    ledProduct:       ['str', '', 0, 96, 'LED product (led_products.csv)', 'LED wall'],
    tileW:            ['int', 192, 8, 4096, 'Tile width (px)', 'LED wall'],
    tileH:            ['int', 192, 8, 4096, 'Tile height (px)', 'LED wall'],
    tilesX:           ['int', 10, 1, 256, 'Wall width (tiles)', 'LED wall'],
    tilesY:           ['int', 6, 1, 256, 'Wall height (full tiles)', 'LED wall'],
    halfTile:         ['enum', 0, 0, 2, 'Half-tile row', 'LED wall', ['None', 'Top', 'Bottom']],
    modulesX:         ['int', 2, 1, 64, 'Modules across (per tile)', 'LED wall'],
    modulesY:         ['int', 2, 1, 64, 'Modules down (per tile)', 'LED wall'],
    modulesHalfY:     ['int', 0, 0, 64, 'Modules down, half tile (0 = auto)', 'LED wall'],
    moduleShow:       ['enum', 0, 0, 3, 'Show modules', 'LED wall', ['Off', 'Alternate shading', 'Outlines', 'Shading + outlines']],
    moduleColour:     ['colour', '#ffffff', 0, 0, 'Module shading colour', 'LED wall'],
    moduleOpacity:    ['float', 0.18, 0.02, 1, 'Module shading strength', 'LED wall'],
    moduleOutline:    ['int', 1, 1, 32, 'Module outline (px)', 'LED wall'],
    moduleOutlineColour:['colour', '#8c8c8c', 0, 0, 'Module outline colour', 'LED wall'],
    tileFill:         ['enum', 0, 0, 6, 'Tile colours', 'LED wall',
                       ['Checker', 'Columns', 'Rows', 'Rainbow across', 'Rainbow down', 'By port', 'Solid']],
    tileColourA:      ['colour', '#1d1d1d', 0, 0, 'Tile colour A', 'LED wall'],
    tileColourB:      ['colour', '#3a3a3a', 0, 0, 'Tile colour B', 'LED wall'],
    tileBrightness:   ['float', 0.45, 0.05, 1, 'Rainbow / port brightness', 'LED wall'],
    tileOutline:      ['int', 2, 0, 64, 'Tile outline (px, 0 = off)', 'LED wall'],
    tileOutlineColour:['colour', '#ffffff', 0, 0, 'Tile outline colour', 'LED wall'],
    tileCross:        ['bool', 0, 0, 1, 'Tile diagonals', 'LED wall'],
    tileLabels:       ['enum', 1, 0, 3, 'Tile labels', 'LED wall', ['Off', 'Grid ref', 'Sequence', 'Both']],
    colLabels:        ['enum', 1, 0, 1, 'Columns (across) as', 'LED wall', ['Numbers', 'Letters']],
    rowLabels:        ['enum', 0, 0, 1, 'Rows (down) as', 'LED wall', ['Numbers', 'Letters']],
    refOrder:         ['enum', 0, 0, 1, 'Grid ref order', 'LED wall', ['Column first (A1)', 'Row first (1A)']],
    seqDirection:     ['enum', 0, 0, 1, 'Sequence runs', 'LED wall', ['Across', 'Down']],
    seqLabels:        ['enum', 0, 0, 1, 'Sequence as', 'LED wall', ['Numbers', 'Letters']],
    serpentine:       ['bool', 0, 0, 1, 'Snake (serpentine) order', 'LED wall'],
    startCorner:      ['enum', 0, 0, 3, 'Start corner', 'LED wall', ['Top left', 'Top right', 'Bottom left', 'Bottom right']],
    startAt:          ['enum', 1, 0, 1, 'Numbers start at', 'LED wall', ['0', '1']],
    tileLabelSize:    ['float', 0.28, 0.05, 0.9, 'Tile label size (x tile)', 'LED wall'],
    tileLabelColour:  ['colour', '#ffffff', 0, 0, 'Tile label colour', 'LED wall'],
    portTiles:        ['int', 0, 0, 1024, 'Tiles per data port (0 = off)', 'LED wall'],
    dataPath:         ['bool', 0, 0, 1, 'Data path arrows', 'LED wall'],
    dataPathColour:   ['colour', '#ffcc00', 0, 0, 'Data path colour', 'LED wall'],
    tilePixelPos:     ['bool', 0, 0, 1, 'Show tile pixel position', 'LED wall'],

    gradMode:         ['bool', 0, 0, 1, 'Gradient mode', 'Gradient'],
    gradType:         ['enum', 0, 0, 3, 'Pattern', 'Gradient', ['Greyscale ramp', 'Greyscale steps', 'Rainbow ramp', 'Rainbow steps']],
    gradBits:         ['enum', 0, 0, 1, 'Bit depth', 'Gradient', ['8-bit', '10-bit']],
    gradDirection:    ['enum', 0, 0, 3, 'Direction', 'Gradient', ['Left → right', 'Right → left', 'Top → bottom', 'Bottom → top']],
    gradSteps:        ['int', 11, 2, 1024, 'Steps', 'Gradient'],
    gradLabels:       ['bool', 1, 0, 1, 'Show step values', 'Gradient'],

    gridMode:         ['enum', 1, 0, 1, 'Grid mode', 'Grid', ['Off', 'Lines']],
    gridSpacing:      ['int', 100, 2, 4096, 'Grid spacing (px)', 'Grid'],
    gridThickness:    ['int', 2, 1, 64, 'Grid line thickness (px)', 'Grid'],
    subGridSpacing:   ['int', 20, 0, 4096, 'Sub grid spacing (px, 0 = off)', 'Grid'],
    subGridThickness: ['int', 1, 1, 64, 'Sub grid line thickness (px)', 'Grid'],
    gridOrigin:       ['enum', 0, 0, 1, 'Grid origin', 'Grid', ['Centre', 'Top left']],
    border:           ['bool', 1, 0, 1, 'Border', 'Grid'],
    borderThickness:  ['int', 2, 1, 64, 'Border thickness (px)', 'Grid'],
    centreCross:      ['bool', 1, 0, 1, 'Centre cross', 'Grid'],
    diagonals:        ['bool', 0, 0, 1, 'Diagonals', 'Grid'],

    circles:          ['bool', 1, 0, 1, 'Circles', 'Circles'],
    circleRadius:     ['float', 0.9, 0.01, 2, 'Circle radius (x half short side)', 'Circles'],
    circleThickness:  ['int', 2, 1, 64, 'Circle line thickness (px)', 'Circles'],
    cornerCircles:    ['bool', 1, 0, 1, 'Corner circles', 'Circles'],

    label:            ['bool', 1, 0, 1, 'Label', 'Label'],
    labelText:        ['str', '', 0, 64, 'Label text (blank = channel name)', 'Label'],
    showResolution:   ['bool', 1, 0, 1, 'Show resolution', 'Label'],
    labelSize:        ['float', 0.05, 0.01, 0.5, 'Label size (x short side)', 'Label'],

    logoTopLeft:      ['bool', 1, 0, 1, 'Logo top left', 'Logos'],
    logoBottomRight:  ['bool', 1, 0, 1, 'Logo bottom right', 'Logos'],
    logoSize:         ['float', 0.12, 0.01, 0.5, 'Logo size (x short side)', 'Logos'],
    logoTLFile:       ['str', '', 0, 96, 'Top left image (in logos/)', 'Logos'],
    logoBRFile:       ['str', '', 0, 96, 'Bottom right image (in logos/)', 'Logos'],

    bgColour:         ['colour', '#000000', 0, 0, 'Background', 'Colour'],
    gridColour:       ['colour', '#ffffff', 0, 0, 'Grid', 'Colour'],
    subGridColour:    ['colour', '#5a5a5a', 0, 0, 'Sub grid', 'Colour'],
    circleColour:     ['colour', '#ffffff', 0, 0, 'Circles', 'Colour'],
    labelColour:      ['colour', '#ffffff', 0, 0, 'Label text', 'Colour'],
    labelBgColour:    ['colour', '#000000', 0, 0, 'Label box', 'Colour'],

    exposure:         ['float', 0, -8, 8, 'Input exposure (stops)', 'Input transform'],
    gamma:            ['float', 1, 0.1, 5, 'Input gamma', 'Input transform'],
    contrast:         ['float', 1, 0.1, 5, 'Input contrast', 'Input transform'],

    resW:             ['int', 0, 0, 16384, 'Width (0 = layer size)', 'Resolution'],
    resH:             ['int', 0, 0, 16384, 'Height (0 = layer size)', 'Resolution']
  };

  function defaults() {
    var s = {};
    for (var k in SCHEMA) s[k] = SCHEMA[k][1];
    return s;
  }

  function clampNum(v, lo, hi, d) {
    v = Number(v);
    if (!isFinite(v)) return d;
    return Math.min(hi, Math.max(lo, v));
  }

  // Coerce any patch into a valid state. Unknown keys dropped.
  function sanitise(input, base) {
    var out = base ? Object.assign({}, base) : defaults();
    if (!input || typeof input !== 'object') return out;
    for (var k in input) {
      var spec = SCHEMA[k];
      if (!spec) continue;
      var t = spec[0], v = input[k];
      if (t === 'int' || t === 'enum') out[k] = Math.round(clampNum(v, spec[2], spec[3], spec[1]));
      else if (t === 'bool') out[k] = (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;
      else if (t === 'float') out[k] = clampNum(v, spec[2], spec[3], spec[1]);
      else if (t === 'colour') out[k] = /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : spec[1];
      else if (t === 'str') out[k] = String(v).replace(/[\u0000-\u001f]/g, '').slice(0, spec[3]);
    }
    return out;
  }

  // Positions of lines with given spacing across [0, len), anchored at origin.
  function linePositions(len, spacing, origin) {
    var out = [];
    if (spacing < 1) return out;
    var start = origin - Math.floor(origin / spacing) * spacing;
    for (var p = start; p < len + 0.5; p += spacing) out.push(p);
    return out;
  }

  // Integer rect for a line of thickness t centred on position p, clipped.
  function band(p, t, len) {
    var a = Math.round(p - t / 2);
    var b = a + t;
    if (a < 0) a = 0;
    if (b > len) b = len;
    return b > a ? [a, b - a] : null;
  }

  function drawGrid(ctx, w, h, spacing, t, colour, ox, oy) {
    ctx.fillStyle = colour;
    var xs = linePositions(w, spacing, ox), ys = linePositions(h, spacing, oy), i, r;
    for (i = 0; i < xs.length; i++) { r = band(xs[i], t, w); if (r) ctx.fillRect(r[0], 0, r[1], h); }
    for (i = 0; i < ys.length; i++) { r = band(ys[i], t, h); if (r) ctx.fillRect(0, r[0], w, r[1]); }
  }

  function ring(ctx, cx, cy, r, t) {
    if (r <= 0) return;
    ctx.lineWidth = t;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawLogo(ctx, img, x, y, box, alignRight, alignBottom) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var k = Math.min(box / iw, box / ih), dw = Math.round(iw * k), dh = Math.round(ih * k);
    ctx.drawImage(img, alignRight ? x - dw : x, alignBottom ? y - dh : y, dw, dh);
  }

  // Per-channel LUT implementing the input transform on sRGB-encoded pixels:
  // decode -> exposure (2^stops) -> contrast about 18% grey -> gamma -> encode.
  function buildLut(s) {
    var lut = new Uint8ClampedArray(256), mid = 0.18, ev = Math.pow(2, s.exposure);
    for (var i = 0; i < 256; i++) {
      var c = i / 255;
      var lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      lin *= ev;
      if (lin > 0) lin = mid * Math.pow(lin / mid, s.contrast);
      if (lin > 0) lin = Math.pow(lin, 1 / s.gamma);
      lin = Math.min(1, Math.max(0, lin));
      var e = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      lut[i] = Math.round(e * 255);
    }
    return lut;
  }

  function isIdentity(s) { return s.exposure === 0 && s.gamma === 1 && s.contrast === 1; }

  function applyTransform(ctx, w, h, s) {
    if (isIdentity(s)) return;
    var lut = buildLut(s), img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (var i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(img, 0, 0);
  }

  // ---- LED wall -------------------------------------------------------
  // Wall pixel size: tilesX x tileW wide; tilesY full rows plus an optional half row.
  function wallSize(s) {
    var half = s.halfTile ? Math.floor(s.tileH / 2) : 0;
    return [s.tilesX * s.tileW, s.tilesY * s.tileH + half];
  }

  // 0 -> A, 25 -> Z, 26 -> AA ...
  function letters(n) {
    var out = '';
    n = Math.max(0, Math.floor(n));
    do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return out;
  }
  function tag(i, asLetters, start) { return asLetters ? letters(i) : String(i + start); }

  // Module rows in a half tile: explicit, else half the full tile's rows (CB3: 8 -> 4).
  function halfModulesY(s) {
    return s.modulesHalfY > 0 ? s.modulesHalfY
      : Math.max(1, Math.round(s.modulesY * Math.floor(s.tileH / 2) / s.tileH));
  }

  // Tiles with geometry, grid ref and sequence index, in wall order.
  // mnx/mny: modules in the tile; mr0: wall module row of its first module row.
  function wallTiles(s) {
    var nx = s.tilesX, rows = [], y = 0, i, half = Math.floor(s.tileH / 2), hm = halfModulesY(s);
    if (s.halfTile === 1) { rows.push({ y: 0, h: half, half: true, mny: hm }); y = half; }
    for (i = 0; i < s.tilesY; i++) { rows.push({ y: y, h: s.tileH, half: false, mny: s.modulesY }); y += s.tileH; }
    if (s.halfTile === 2) rows.push({ y: y, h: half, half: true, mny: hm });
    for (i = 0, y = 0; i < rows.length; i++) { rows[i].mr0 = y; y += rows[i].mny; }
    var ny = rows.length, fromRight = s.startCorner === 1 || s.startCorner === 3,
        fromBottom = s.startCorner >= 2, tiles = [];
    for (var r = 0; r < ny; r++) {
      for (var c = 0; c < nx; c++) {
        var lc = fromRight ? nx - 1 - c : c, lr = fromBottom ? ny - 1 - r : r, seq;
        if (s.seqDirection === 0) seq = lr * nx + (s.serpentine && lr % 2 ? nx - 1 - lc : lc);
        else seq = lc * ny + (s.serpentine && lc % 2 ? ny - 1 - lr : lr);
        tiles.push({ x: c * s.tileW, y: rows[r].y, w: s.tileW, h: rows[r].h, half: rows[r].half,
                     col: c, row: r, lc: lc, lr: lr, seq: seq,
                     mnx: s.modulesX, mny: rows[r].mny, mr0: rows[r].mr0,
                     port: s.portTiles > 0 ? Math.floor(seq / s.portTiles) : -1 });
      }
    }
    return { tiles: tiles, nx: nx, ny: ny };
  }

  function hsl(hue, s) { return 'hsl(' + Math.round(hue) + ',100%,' + Math.round(s.tileBrightness * 50) + '%)'; }

  function tileColour(s, t, W) {
    var A = s.tileColourA, B = s.tileColourB;
    switch (s.tileFill) {
      case 0: return (t.col + t.row) % 2 ? B : A;
      case 1: return t.col % 2 ? B : A;
      case 2: return t.row % 2 ? B : A;
      case 3: return hsl(360 * t.col / W.nx, s);
      case 4: return hsl(360 * t.row / W.ny, s);
      case 5:
        if (t.port < 0) return (t.col + t.row) % 2 ? B : A;
        var nP = Math.ceil(W.tiles.length / s.portTiles);
        return hsl((360 * t.port / Math.max(nP, 1) + (t.port % 2) * 180 / Math.max(nP, 1)) % 360, s);
      default: return A;
    }
  }

  function gridRef(s, t) {
    var c = tag(t.lc, s.colLabels === 1, s.startAt), r = tag(t.lr, s.rowLabels === 1, s.startAt);
    var sep = s.colLabels === s.rowLabels ? (s.colLabels ? '·' : '-') : '';
    return s.refOrder === 0 ? c + sep + r : r + sep + c;
  }

  function outlinedText(ctx, txt, x, y, fs, colour) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, Math.round(fs / 7));
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(txt, x, y);
  }

  function arrowHead(ctx, x0, y0, x1, y1, size) {
    var a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - size * Math.cos(a - 0.45), y1 - size * Math.sin(a - 0.45));
    ctx.lineTo(x1 - size * Math.cos(a + 0.45), y1 - size * Math.sin(a + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  function drawWall(ctx, s, opts, phase) {
    var W = wallTiles(s), T = W.tiles, i, t, font = opts.font || 'Helvetica, Arial, sans-serif';
    if (phase === 'fill') {
      for (i = 0; i < T.length; i++) { t = T[i]; ctx.fillStyle = tileColour(s, t, W); ctx.fillRect(t.x, t.y, t.w, t.h); }
      // every other module, checkered across the whole wall, tinted over the tile colour
      if (s.moduleShow === 1 || s.moduleShow === 3) {
        ctx.globalAlpha = s.moduleOpacity;
        ctx.fillStyle = s.moduleColour;
        for (i = 0; i < T.length; i++) {
          t = T[i];
          for (var mj = 0; mj < t.mny; mj++) {
            var y0 = t.y + Math.round(mj * t.h / t.mny), y1 = t.y + Math.round((mj + 1) * t.h / t.mny);
            for (var mi = 0; mi < t.mnx; mi++) {
              if ((t.col * t.mnx + mi + t.mr0 + mj) % 2 === 0) continue;
              var x0 = t.x + Math.round(mi * t.w / t.mnx), x1 = t.x + Math.round((mi + 1) * t.w / t.mnx);
              ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      return;
    }
    // module seams (inside each tile; the tile outline covers the tile edges)
    if (s.moduleShow >= 2) {
      ctx.fillStyle = s.moduleOutlineColour;
      var mo = s.moduleOutline, mh = Math.floor(mo / 2), k;
      for (i = 0; i < T.length; i++) {
        t = T[i];
        for (k = 1; k < t.mnx; k++) ctx.fillRect(t.x + Math.round(k * t.w / t.mnx) - mh, t.y, mo, t.h);
        for (k = 1; k < t.mny; k++) ctx.fillRect(t.x, t.y + Math.round(k * t.h / t.mny) - mh, t.w, mo);
      }
    }
    // outlines: drawn inside each tile edge so every tile shows its own full border
    if (s.tileOutline > 0) {
      ctx.fillStyle = s.tileOutlineColour;
      for (i = 0; i < T.length; i++) {
        t = T[i];
        var o = Math.min(s.tileOutline, Math.floor(Math.min(t.w, t.h) / 2));
        ctx.fillRect(t.x, t.y, t.w, o); ctx.fillRect(t.x, t.y + t.h - o, t.w, o);
        ctx.fillRect(t.x, t.y, o, t.h); ctx.fillRect(t.x + t.w - o, t.y, o, t.h);
      }
    }
    if (s.tileCross) {
      ctx.strokeStyle = s.tileOutlineColour;
      ctx.lineWidth = Math.max(1, s.tileOutline || 1);
      ctx.beginPath();
      for (i = 0; i < T.length; i++) {
        t = T[i];
        ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + t.w, t.y + t.h);
        ctx.moveTo(t.x + t.w, t.y); ctx.lineTo(t.x, t.y + t.h);
      }
      ctx.stroke();
    }
    if (s.dataPath) {
      var order = T.slice().sort(function (a, b) { return a.seq - b.seq; }), lw = Math.max(2, Math.round(s.tileW * 0.03));
      ctx.strokeStyle = ctx.fillStyle = s.dataPathColour;
      ctx.lineWidth = lw;
      for (i = 1; i < order.length; i++) {
        var a = order[i - 1], b = order[i];
        if (a.port !== b.port) continue;               // a new port starts a new run
        var x0 = a.x + a.w / 2, y0 = a.y + a.h / 2, x1 = b.x + b.w / 2, y1 = b.y + b.h / 2;
        var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy) || 1, cut = Math.min(a.w, a.h) * 0.22;
        var ex = x1 - dx / len * cut, ey = y1 - dy / len * cut;
        ctx.beginPath(); ctx.moveTo(x0 + dx / len * cut, y0 + dy / len * cut); ctx.lineTo(ex, ey); ctx.stroke();
        arrowHead(ctx, x0, y0, ex + dx / len * lw, ey + dy / len * lw, lw * 4);
      }
      // ring round the first tile of every run = "data enters here"
      for (i = 0; i < order.length; i++) {
        if (i && order[i].port === order[i - 1].port) continue;
        t = order[i];
        ctx.beginPath(); ctx.arc(t.x + t.w / 2, t.y + t.h / 2, Math.min(t.w, t.h) * 0.42, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < T.length; i++) {
      t = T[i];
      var cx = t.x + t.w / 2, cy = t.y + t.h / 2, m = Math.min(t.w, t.h);
      var fs = Math.max(6, Math.round(s.tileLabelSize * m)), small = Math.max(6, Math.round(fs * 0.45));
      var main = '', sub = '';
      if (s.tileLabels === 1) main = gridRef(s, t);
      else if (s.tileLabels === 2) main = tag(t.seq, s.seqLabels === 1, s.startAt);
      else if (s.tileLabels === 3) { main = gridRef(s, t); sub = '#' + tag(t.seq, s.seqLabels === 1, s.startAt); }
      if (main) {
        // shrink to fit the tile width
        ctx.font = '700 ' + fs + 'px ' + font;
        var mw = ctx.measureText(main).width, f2 = mw > t.w * 0.86 ? Math.max(6, Math.floor(fs * t.w * 0.86 / mw)) : fs;
        ctx.font = '700 ' + f2 + 'px ' + font;
        outlinedText(ctx, main, cx, sub ? cy - f2 * 0.2 : cy, f2, s.tileLabelColour);
        if (sub) { ctx.font = '600 ' + small + 'px ' + font; outlinedText(ctx, sub, cx, cy + f2 * 0.55, small, s.tileLabelColour); }
      }
      var pad = Math.max(3, (s.tileOutline || 0) + Math.round(m * 0.04)), fsm = Math.max(6, Math.round(m * 0.1));
      ctx.font = '600 ' + fsm + 'px ' + font;
      if (t.port >= 0 && (s.tileFill === 5 || s.dataPath)) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        outlinedText(ctx, 'P' + (t.port + s.startAt), t.x + pad, t.y + pad, fsm, s.tileLabelColour);
      }
      if (s.tilePixelPos) {
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        outlinedText(ctx, t.x + ',' + t.y, t.x + pad, t.y + t.h - pad, fsm, s.tileLabelColour);
      }
      if (t.half) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        outlinedText(ctx, '½', t.x + t.w - pad, t.y + pad, fsm, s.tileLabelColour);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    }
  }

  // ---- gradients -------------------------------------------------------
  // Fully saturated hue (0..1 round the wheel) -> [r, g, b] in 0..1.
  function hueRgb(t) {
    var h = (t - Math.floor(t)) * 6, i = Math.floor(h), f = h - i;
    return [[1, 1 - f, 0, 0, f, 1][i], [f, 1, 1, 1 - f, 0, 0][i], [0, 0, f, 1, 1, 1 - f][i]];
  }

  function gradMax(s) { return s.gradBits ? 1023 : 255; }

  // Which way the gradient runs over a w x h canvas.
  function gradAxis(s, w, h) {
    var horiz = s.gradDirection < 2;
    return { horiz: horiz, rev: s.gradDirection === 1 || s.gradDirection === 3, L: horiz ? w : h, cross: horiz ? h : w };
  }

  // Step i of n -> position along the colour range (0..1).
  function stepT(s, i, n) { return s.gradType === 3 ? i / n : (n > 1 ? i / (n - 1) : 0); }

  // Code values (0..255 or 0..1023) for every position along the axis: [r, g, b] x L.
  // Ramps put an exact code value on every pixel (no canvas gradient, no dithering).
  function gradientLine(s, L) {
    var max = gradMax(s), out = new Uint16Array(L * 3), n = s.gradSteps;
    var rainbow = s.gradType >= 2, steps = s.gradType === 1 || s.gradType === 3;
    for (var p = 0; p < L; p++) {
      var t = steps ? stepT(s, Math.min(n - 1, Math.floor(p * n / L)), n)
                    : rainbow ? p / L : (L > 1 ? p / (L - 1) : 0);
      var c = rainbow ? hueRgb(t) : [t, t, t];
      out[p * 3] = Math.round(c[0] * max); out[p * 3 + 1] = Math.round(c[1] * max); out[p * 3 + 2] = Math.round(c[2] * max);
    }
    return out;
  }

  function drawGradient(ctx, w, h, s) {
    var A = gradAxis(s, w, h), line = gradientLine(s, A.L), sh = s.gradBits ? 2 : 0;
    var img = ctx.createImageData(w, h), d = img.data, x, y, p, o;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        p = A.horiz ? x : y;
        if (A.rev) p = A.L - 1 - p;
        o = (y * w + x) * 4;
        d[o] = line[p * 3] >> sh; d[o + 1] = line[p * 3 + 1] >> sh; d[o + 2] = line[p * 3 + 2] >> sh; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Code value of each step, written in the middle of the step.
  function drawStepLabels(ctx, w, h, s, opts) {
    if (!s.gradLabels || !(s.gradType === 1 || s.gradType === 3)) return;
    var A = gradAxis(s, w, h), n = s.gradSteps, max = gradMax(s), font = opts.font || 'Helvetica, Arial, sans-serif';
    var band = A.L / n;
    if (band < 14) return;                                   // too narrow to read
    var fs = Math.max(8, Math.round(Math.min(A.cross * 0.05, A.horiz ? band * 0.32 : band * 0.45)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < n; i++) {
      var t = stepT(s, i, n), c = s.gradType === 3 ? hueRgb(t) : [t, t, t];
      var lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      var lines = s.gradType === 1 ? [String(Math.round(t * max)), Math.round(t * 100) + '%']
                                   : [Math.round(t * 360) + '°', c.map(function (v) { return Math.round(v * max); }).join(' ')];
      var mid = (i + 0.5) * band, pos = A.rev ? A.L - mid : mid;
      var cx = A.horiz ? pos : w / 2, cy = A.horiz ? h / 2 : pos;
      ctx.fillStyle = lum > 0.45 ? '#000000' : '#ffffff';
      ctx.font = '700 ' + fs + 'px ' + font;
      ctx.fillText(lines[0], Math.round(cx), Math.round(cy - fs * 0.55));
      ctx.font = '500 ' + Math.max(7, Math.round(fs * 0.62)) + 'px ' + font;
      ctx.fillText(lines[1], Math.round(cx), Math.round(cy + fs * 0.55));
    }
  }

  // 16-bit samples (RGB, row-major) holding the exact 10-bit gradient for export, with the
  // canvas's own pixels wherever something was drawn over the gradient (labels, grid ...).
  // Returns null when the canvas isn't a 10-bit gradient.
  function deepPixels(state, px, w, h) {
    var s = sanitise(state);
    if (!s.gradMode || !s.gradBits) return null;
    var A = gradAxis(s, w, h), line = gradientLine(s, A.L), out = new Uint16Array(w * h * 3);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = A.horiz ? x : y; if (A.rev) p = A.L - 1 - p;
        var i = y * w + x, o = i * 4, j = i * 3, v;
        var r = line[p * 3], g = line[p * 3 + 1], b = line[p * 3 + 2];
        if (px[o] === r >> 2 && px[o + 1] === g >> 2 && px[o + 2] === b >> 2) {
          // 10 -> 16 bit by bit replication: full range, and >> 6 gives the 10-bit code back
          v = r; out[j] = (v << 6) | (v >> 4); v = g; out[j + 1] = (v << 6) | (v >> 4); v = b; out[j + 2] = (v << 6) | (v >> 4);
        } else { out[j] = px[o] * 257; out[j + 1] = px[o + 1] * 257; out[j + 2] = px[o + 2] * 257; }
      }
    }
    return out;
  }

  /*
   * render(ctx, w, h, state, opts)
   *   opts.channel  label fallback text
   *   opts.logoTL / opts.logoBR  drawable images (or null)
   *   opts.font     font family (node harness passes a registered one)
   */
  function render(ctx, w, h, state, opts) {
    var s = sanitise(state);
    opts = opts || {};
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var short = Math.min(w, h);
    var cx = w / 2, cy = h / 2;
    var ox = s.gridOrigin === 0 ? cx : 0, oy = s.gridOrigin === 0 ? cy : 0;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.bgColour;
    ctx.fillRect(0, 0, w, h);
    var led = s.ledWall && !s.gradMode;                 // gradient mode wins over LED wall
    // gradients carry no grid furniture, whatever the URL says (s is our own sanitised copy)
    if (s.gradMode) { s.gridMode = 0; s.diagonals = 0; s.centreCross = 0; s.circles = 0; s.border = 0; }
    if (s.gradMode) drawGradient(ctx, w, h, s);
    if (led) drawWall(ctx, s, opts, 'fill');

    if (s.gridMode === 1) {
      if (s.subGridSpacing > 0) drawGrid(ctx, w, h, s.subGridSpacing, s.subGridThickness, s.subGridColour, ox, oy);
      drawGrid(ctx, w, h, s.gridSpacing, s.gridThickness, s.gridColour, ox, oy);
    }

    if (led) drawWall(ctx, s, opts, 'overlay');
    if (s.gradMode) drawStepLabels(ctx, w, h, s, opts);

    if (s.diagonals) {
      ctx.strokeStyle = s.gridColour;
      ctx.lineWidth = s.gridThickness;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, h);
      ctx.moveTo(w, 0); ctx.lineTo(0, h);
      ctx.stroke();
    }

    if (s.centreCross) {
      ctx.fillStyle = s.gridColour;
      var t2 = s.gridThickness * 2, r;
      r = band(cx, t2, w); if (r) ctx.fillRect(r[0], Math.round(cy - short * 0.05), r[1], Math.round(short * 0.1));
      r = band(cy, t2, h); if (r) ctx.fillRect(Math.round(cx - short * 0.05), r[0], Math.round(short * 0.1), r[1]);
    }

    if (s.circles) {
      ctx.strokeStyle = s.circleColour;
      var R = s.circleRadius * short / 2;
      ring(ctx, cx, cy, R - s.circleThickness / 2, s.circleThickness);
      if (s.cornerCircles) {
        var cr = short / 6, inset = short / 6;
        ring(ctx, inset, inset, cr - s.circleThickness / 2, s.circleThickness);
        ring(ctx, w - inset, inset, cr - s.circleThickness / 2, s.circleThickness);
        ring(ctx, inset, h - inset, cr - s.circleThickness / 2, s.circleThickness);
        ring(ctx, w - inset, h - inset, cr - s.circleThickness / 2, s.circleThickness);
      }
    }

    if (s.border) {
      ctx.fillStyle = s.gridColour;
      var bt = Math.min(s.borderThickness, Math.floor(short / 2));
      ctx.fillRect(0, 0, w, bt); ctx.fillRect(0, h - bt, w, bt);
      ctx.fillRect(0, 0, bt, h); ctx.fillRect(w - bt, 0, bt, h);
    }

    var logoBox = Math.round(s.logoSize * short), pad = Math.round(short * 0.03);
    if (s.logoTopLeft && opts.logoTL) drawLogo(ctx, opts.logoTL, pad, pad, logoBox, false, false);
    if (s.logoBottomRight && opts.logoBR) drawLogo(ctx, opts.logoBR, w - pad, h - pad, logoBox, true, true);

    if (s.label) {
      var name = s.labelText || opts.channel || '';
      var lines = [];
      if (name) lines.push(name);
      if (s.showResolution) lines.push(w + ' × ' + h);
      if (lines.length) {
        var fs = Math.max(8, Math.round(s.labelSize * short));
        ctx.font = '600 ' + fs + 'px ' + (opts.font || 'Helvetica, Arial, sans-serif');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var lh = Math.round(fs * 1.25), maxW = 0, i;
        for (i = 0; i < lines.length; i++) maxW = Math.max(maxW, ctx.measureText(lines[i]).width);
        var bw = Math.round(maxW + fs), bh = Math.round(lh * lines.length + fs * 0.5);
        ctx.fillStyle = s.labelBgColour;
        ctx.fillRect(Math.round(cx - bw / 2), Math.round(cy - bh / 2), bw, bh);
        ctx.fillStyle = s.labelColour;
        var y0 = cy - (lh * (lines.length - 1)) / 2;
        for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, Math.round(y0 + i * lh));
      }
    }

    if (!s.gradMode) applyTransform(ctx, w, h, s);     // gradients are exact code values: no input transform
    ctx.restore();
    return { w: w, h: h, state: s };
  }

  // Size to draw at: LED wall size, else forced resolution, else the given fallback.
  function outputSize(state, fw, fh) {
    var s = sanitise(state);
    if (s.ledWall && !s.gradMode) return wallSize(s);
    return [s.resW > 0 ? s.resW : fw, s.resH > 0 ? s.resH : fh];
  }

  return { SCHEMA: SCHEMA, defaults: defaults, sanitise: sanitise, render: render,
           wallSize: wallSize, wallTiles: wallTiles, halfModulesY: halfModulesY, letters: letters, outputSize: outputSize,
           buildLut: buildLut, linePositions: linePositions, band: band,
           gradientLine: gradientLine, deepPixels: deepPixels };
});
