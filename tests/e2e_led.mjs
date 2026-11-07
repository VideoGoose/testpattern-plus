// LED wall mode: render out.html with a few wall configs + screenshot the plugin window.
// node tests/e2e_led.mjs <port> <outdir>   (mock_designer.py must be running on <port>)
import { chromium } from "playwright";
const [port, out] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/plugins/gus_testpattern/`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext();
const errs = [], res = {};
const cases = {
  a1_halfbottom: "ledWall=1&tileW=200&tileH=200&tilesX=8&tilesY=4&halfTile=2&gridMode=0&circles=0&label=0",
  seq_snake_ports: "ledWall=1&tileW=160&tileH=160&tilesX=10&tilesY=5&halfTile=1&tileLabels=3&serpentine=1&portTiles=10&dataPath=1&tileFill=5&gridMode=0&circles=0&label=0&tilePixelPos=1",
  rainbow_down_letters: "ledWall=1&tileW=256&tileH=128&tilesX=6&tilesY=6&tileFill=4&colLabels=0&rowLabels=1&refOrder=1&startCorner=2&tileCross=1&gridMode=0&circles=1&label=1&name=WALL",
  // ROE CB3: 160x320 px tiles, 2 x 8 modules; half tile 160x160, 2 x 4 modules
  cb3_modules: "ledWall=1&tileW=160&tileH=320&tilesX=6&tilesY=2&halfTile=2&modulesX=2&modulesY=8&modulesHalfY=4&moduleShow=3&tileFill=6&gridMode=0&circles=0&label=0&tileLabels=0&border=0&centreCross=0",
  modules_auto_half: "ledWall=1&tileW=160&tileH=320&tilesX=2&tilesY=1&halfTile=1&modulesY=8&moduleShow=1&tileFill=6&gridMode=0&circles=0&label=0&tileLabels=0&border=0&centreCross=0",
};
const px = (p, pts) => p.evaluate(pts => { const c = document.getElementById("c").getContext("2d");
  return pts.map(([x, y]) => c.getImageData(x, y, 1, 1).data[0]); }, pts);
for (const [n, h] of Object.entries(cases)) {
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(n + ": " + e.message));
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.goto(base + "out.html#" + h);
  await p.waitForTimeout(300);
  res[n] = await p.evaluate(() => { const c = document.getElementById("c"); return [c.width, c.height]; });
  // save the full-res canvas, not the scaled view
  const data = await p.evaluate(() => document.getElementById("c").toDataURL("image/png"));
  (await import("fs")).writeFileSync(out + "/" + n + ".png", Buffer.from(data.split(",")[1], "base64"));
  // red channel: 29 = plain tile colour A, ~70 = shaded module, 140 = module seam
  if (n === "cb3_modules") res.cb3_px = {
    tile0: await px(p, [[20, 20], [100, 20], [20, 60], [100, 60]]),          // checker within a tile
    acrossTiles: await px(p, [[180, 20], [260, 20]]),                       // continues into tile 2
    halfRow: await px(p, [[20, 660], [20, 700], [20, 740], [20, 780]]),     // 4 modules, 40 px each
    seams: await px(p, [[80, 100], [30, 40], [30, 680]]) };
  if (n === "modules_auto_half") res.autoHalf_px = await px(p, [[20, 20], [20, 60], [20, 100], [20, 140]]);
  await p.close();
}
async function pick(page, selSelector, value) {
  await page.evaluate(([q, v]) => {
    const sel = document.querySelector(q);
    const i = [...sel.options].findIndex(o => o.value === v);
    if (i < 0) throw new Error("no option " + v + " in " + q);
    sel.previousElementSibling.querySelector("button").click();
    document.querySelectorAll(".pick-list div")[i].click();
  }, [selSelector, value]);
}
const ui = await ctx.newPage();
ui.on("dialog", d => { errs.push("browser dialog used: " + d.message()); d.dismiss(); });
ui.on("pageerror", e => errs.push("ui: " + e.message));
await ui.setViewportSize({ width: 1400, height: 900 });
await ui.goto(base + "index.html");
await ui.waitForFunction(() => /connected|driving|LIVE/.test(document.getElementById("statusTxt").textContent), null, { timeout: 8000 });
await ui.waitForFunction(() => document.querySelector('.row[data-key="ledProduct"] select').options.length > 2, null, { timeout: 8000 });
await ui.click('.row[data-key="ledWall"] .seg button >> nth=1');
await ui.waitForTimeout(300);
res.note = await ui.textContent("#wallNote");
res.urlHas = /ledWall=1/.test(await ui.inputValue("#url"));
res.docWidth = await ui.evaluate(() => document.documentElement.scrollWidth);

// LED product from led_products.csv fills tile size + modules and turns modules on
const val = k => ui.evaluate(k => { const r = document.querySelector('.row[data-key="' + k + '"]');
  const n = r.querySelector("input[type=number]"); return n ? n.value : r.querySelector("select") ? r.querySelector("select").value : null; }, k);
await ui.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
await pick(ui, '.row[data-key="ledProduct"] select', "ROE Carbon CB3");
await ui.waitForTimeout(200);
res.product = { tileW: await val("tileW"), tileH: await val("tileH"), modulesX: await val("modulesX"),
  modulesY: await val("modulesY"), modulesHalfY: await val("modulesHalfY"), show: await val("moduleShow"),
  urlHasProduct: /ledProduct=ROE\+Carbon\+CB3/.test(await ui.inputValue("#url")) };
await ui.click('.row[data-key="halfTile"] .seg button >> nth=2');
await ui.waitForTimeout(200);
res.productNote = await ui.textContent("#wallNote");
await ui.screenshot({ path: out + "/ui_led.png" });

// presets are files in <plugin>/presets/
const presetFile = async n => { const r = await fetch(base + "presets/" + encodeURIComponent(n) + ".json"); return r.ok ? r.json() : r.status; };
await ui.click("#presetSave");
await ui.fill("#askInput", "CB3 wall");
await ui.click("#askOk");
await ui.waitForTimeout(500);
const saved = await presetFile("CB3 wall");
res.presetSaved = saved.settings ? { modulesY: saved.settings.modulesY, ledProduct: saved.settings.ledProduct, version: saved.version } : saved;
await ui.click("#reset"); await ui.click("#askOk"); await ui.waitForTimeout(200);
res.afterReset = await val("modulesY");
await pick(ui, "#presetSel", "CB3 wall");
await ui.waitForTimeout(200);
res.presetLoaded = { modulesY: await val("modulesY"), tileH: await val("tileH"), product: await val("ledProduct") };
// hand-editing the tile size makes the product custom
const th = ui.locator('.row[data-key="tileH"] input[type=number]');
await th.fill("300"); await th.dispatchEvent("change"); await ui.waitForTimeout(100);
res.customAfterEdit = await val("ledProduct");

// presets kept in the window by older versions move into files on connect
await ui.evaluate(() => localStorage.setItem("tp.presets", JSON.stringify({ "Old one": { tileW: 222, ledWall: 1 } })));
await ui.reload();
await ui.waitForFunction(() => localStorage.getItem("tp.presets") === "{}" &&
  [...document.getElementById("presetSel").options].some(o => o.value === "Old one"), null, { timeout: 8000 });
const old = await presetFile("Old one");
res.migrated = { tileW: old.settings && old.settings.tileW, leftInWindow: await ui.evaluate(() => localStorage.getItem("tp.presets")) };

// delete (the last loaded preset)
await pick(ui, "#presetSel", "Old one");
await ui.click("#presetDel"); await ui.click("#askOk"); await ui.waitForTimeout(400);
res.deleted = await presetFile("Old one");
res.errs = errs;
console.log(JSON.stringify(res, null, 1));
await browser.close();
