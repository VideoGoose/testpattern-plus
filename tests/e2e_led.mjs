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
};
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
  await p.close();
}
const ui = await ctx.newPage();
ui.on("pageerror", e => errs.push("ui: " + e.message));
await ui.setViewportSize({ width: 1400, height: 900 });
await ui.goto(base + "index.html");
await ui.waitForTimeout(1500);
await ui.click('.row[data-key="ledWall"] .seg button >> nth=1');
await ui.waitForTimeout(300);
res.note = await ui.textContent("#wallNote");
res.urlHas = /ledWall=1/.test(await ui.inputValue("#url"));
res.docWidth = await ui.evaluate(() => document.documentElement.scrollWidth);
await ui.screenshot({ path: out + "/ui_led.png" });
res.errs = errs;
console.log(JSON.stringify(res, null, 1));
await browser.close();
