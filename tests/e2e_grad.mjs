// Gradient mode: exact code values in out.html, 16-bit PNG/TIF exports for 10-bit, mode
// toggle, and the window layout at the size Designer gives the plugin (footer must fit).
// node tests/e2e_grad.mjs <port> <outdir>   (mock_designer.py must be running on <port>)
import { chromium } from "playwright";
import fs from "fs";
import zlib from "zlib";
const [port, out] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/plugins/testpattern-plus/`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext();
const errs = [], res = {};
const off = "&gridMode=0&circles=0&label=0&centreCross=0&border=0&diagonals=0";

async function render(name, hash, w, h) {
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(name + ": " + e.message));
  await p.goto(base + "out.html#gradMode=1&resW=" + w + "&resH=" + h + off + "&" + hash);
  await p.waitForTimeout(250);
  const data = await p.evaluate(() => document.getElementById("c").toDataURL("image/png"));
  fs.writeFileSync(out + "/" + name + ".png", Buffer.from(data.split(",")[1], "base64"));
  return p;
}
const pxAt = (p, pts) => p.evaluate(pts => { const c = document.getElementById("c").getContext("2d");
  return pts.map(([x, y]) => Array.from(c.getImageData(x, y, 1, 1).data.slice(0, 3))); }, pts);
const rowStats = p => p.evaluate(() => { const c = document.getElementById("c"), d = c.getContext("2d").getImageData(0, 1, c.width, 1).data;
  const v = []; for (let i = 0; i < d.length; i += 4) v.push(d[i]);
  let mono = true; for (let i = 1; i < v.length; i++) if (v[i] < v[i - 1]) mono = false;
  return { first: v[0], last: v[v.length - 1], distinct: new Set(v).size, monotonic: mono }; });

// 8-bit greyscale ramp, 1024 px: all 256 code values, left to right
// exposure/gamma/contrast in the URL must not touch a gradient
let p = await render("grad_grey8", "gradType=0&gradBits=0&gradDirection=0&exposure=-2&gamma=1.5&contrast=2&gridMode=1&circles=1&border=1&centreCross=1&diagonals=1", 1024, 64);
res.grey8 = await rowStats(p); await p.close();
// 10-bit ramp: preview shows the top 8 bits of 0..1023
p = await render("grad_grey10", "gradType=0&gradBits=1&gradDirection=0", 1024, 64);
res.grey10 = await rowStats(p); res.grey10_px = await pxAt(p, [[0, 1], [512, 1], [1023, 1]]); await p.close();
// 11 steps top to bottom: step 5 is 50% = 128; labels drawn
p = await render("grad_steps_down", "gradType=1&gradDirection=2&gradSteps=11", 640, 1100);
res.stepsDown = await pxAt(p, [[10, 50], [10, 550], [10, 1050]]); await p.close();
// steps bottom to top
p = await render("grad_steps_up", "gradType=1&gradDirection=3&gradSteps=11", 640, 1100);
res.stepsUp = await pxAt(p, [[10, 50], [10, 1050]]); await p.close();
// rainbow ramp right to left: red at the right edge, green a third of the way in from it
p = await render("grad_rainbow_rtl", "gradType=2&gradDirection=1", 1200, 200);
res.rainbowRtl = await pxAt(p, [[1199, 10], [799, 10]]); await p.close();
// rainbow steps (12, labelled with hue + code values)
p = await render("grad_rainbow_steps", "gradType=3&gradSteps=12&gradDirection=0", 1920, 1080);
res.rainbowSteps = await pxAt(p, [[40, 40], [360 + 40, 40]]); await p.close();

// ---- the plugin window, at roughly the size Designer opens it (header wraps to two rows)
const ui = await ctx.newPage();
ui.on("pageerror", e => errs.push("ui: " + e.message));
ui.on("dialog", d => { errs.push("browser dialog used: " + d.message()); d.dismiss(); });
await ui.setViewportSize({ width: 900, height: 900 });
await ui.goto(base + "index.html");
await ui.waitForFunction(() => /connected|driving|LIVE/.test(document.getElementById("statusTxt").textContent), null, { timeout: 8000 });
res.layout = await ui.evaluate(() => {
  const f = document.getElementById("footer").getBoundingClientRect(), hd = document.querySelector("header").getBoundingClientRect();
  return { headerH: Math.round(hd.height), footerBottom: Math.round(f.bottom), viewH: innerHeight, footerVisible: f.bottom <= innerHeight + 0.5 && f.height > 20 };
});
await ui.screenshot({ path: out + "/ui_narrow.png" });

await ui.setViewportSize({ width: 1400, height: 900 });
await ui.click('#mode button[data-v="2"]');
await ui.waitForTimeout(200);
res.mode = await ui.evaluate(() => ({
  sel: document.querySelector("#mode .sel").textContent,
  grad: !document.querySelector('details[data-group="Gradient"]').classList.contains("hide"),
  led: !document.querySelector('details[data-group="LED wall"]').classList.contains("hide"),
  transform: !document.querySelector('details[data-group="Input transform"]').classList.contains("hide"),
  grid: !document.querySelector('details[data-group="Grid"]').classList.contains("hide"),
  circles: !document.querySelector('details[data-group="Circles"]').classList.contains("hide"),
  url: document.getElementById("url").value.split("#")[1] }));
// 10-bit ramp at 1024 x 64, saved as PNG and TIF
await ui.click('.row[data-key="gradBits"] .seg button >> nth=1');
await ui.fill("#pw", "1024"); await ui.dispatchEvent("#pw", "change");
await ui.fill("#ph", "64"); await ui.dispatchEvent("#ph", "change");
await ui.waitForTimeout(200);
res.note = await ui.textContent("#gradNote");
await ui.screenshot({ path: out + "/ui_gradient.png" });

async function saved(btn, re) {
  await ui.click(btn);
  await ui.waitForFunction(re => new RegExp(re).test(document.getElementById("statusTxt").textContent), re, { timeout: 15000 });
  return (await ui.textContent("#toast")).split("\n")[1];
}
const pngPath = await saved("#savePng", "saved .*10bit\\.png");
const tifPath = await saved("#saveTif", "saved .*10bit\\.tif");

// decode the 16-bit PNG
const png = fs.readFileSync(pngPath);
let at = 8, ihdr, idat = [];
while (at < png.length) {
  const len = png.readUInt32BE(at), type = png.toString("ascii", at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
  if (type === "IHDR") ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9] };
  if (type === "IDAT") idat.push(data);
  at += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat)), row = 1 + ihdr.w * 6;
const s16 = (x, y, c) => raw.readUInt16BE(y * row + 1 + x * 6 + c * 2);
res.png16 = { ...ihdr, x0: s16(0, 5, 0), x512: s16(512, 5, 0), x1023: s16(1023, 5, 0), as10bit: [0, 1, 2, 3, 512, 1023].map(x => s16(x, 5, 0) >> 6), x1022_16: s16(1022, 5, 0) };

// decode the 16-bit TIFF (our own layout: one strip, deflate)
const tif = fs.readFileSync(tifPath), n = tif.readUInt16LE(8), tags = {};
for (let i = 0; i < n; i++) { const o = 10 + i * 12; tags[tif.readUInt16LE(o)] = tif.readUInt32LE(o + 8); }
const bps = tif.readUInt16LE(tags[258]), strip = zlib.inflateSync(tif.subarray(tags[273], tags[273] + tags[279]));
const t16 = (x, y) => strip.readUInt16LE((y * 1024 + x) * 6);
res.tif16 = { bps, bytes: strip.length, x512: t16(512, 5), as10bit: [0, 1, 2, 3, 1023].map(x => t16(x, 5) >> 6) };

// back to projector grid restores the grid
await ui.click('#mode button[data-v="0"]');
await ui.waitForTimeout(150);
res.back = await ui.evaluate(() => document.querySelector('.row[data-key="gridMode"] .seg .sel').textContent);
res.errs = errs;
console.log(JSON.stringify(res, null, 1));
await browser.close();
