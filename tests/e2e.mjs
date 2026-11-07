// End-to-end against mock_designer.py with headless Chromium.
// node tests/e2e.mjs <port> <outdir>   (mock_designer.py must be running on <port>)
import { chromium } from "playwright";
const [port, out] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const world = async () => (await fetch(base + "/__world")).json();
const res = {};

// click an in-page picker (the native <select> is hidden behind it)
async function pick(page, selSelector, value) {
  await page.evaluate(([q, v]) => {
    const sel = document.querySelector(q);
    const i = [...sel.options].findIndex(o => o.value === v);
    if (i < 0) throw new Error("no option " + v + " in " + q);
    sel.previousElementSibling.querySelector("button").click();
    document.querySelectorAll(".pick-list div")[i].click();
  }, [selSelector, value]);
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ acceptDownloads: true });
const ui = await ctx.newPage();
const errs = [];
ui.on("pageerror", e => errs.push("ui: " + e.message));
ui.on("dialog", d => { errs.push("browser dialog used: " + d.message()); d.dismiss(); });
await ui.setViewportSize({ width: 1400, height: 860 });
await ui.goto(base + "/plugins/gus_testpattern/index.html");
await ui.waitForFunction(() => /connected|driving|LIVE/.test(document.getElementById("statusTxt").textContent), null, { timeout: 8000 });

// screens -> sets size + label
await ui.click("#getScreens");
await ui.waitForSelector("#screens .s");
await ui.click("#screens .s >> nth=0");
res.size = [await ui.inputValue("#pw"), await ui.inputValue("#ph")];

// new web layer
await ui.click("#newLayer");
await ui.waitForSelector("#ask.show");
await ui.fill("#askInput", "TP LED_A");
await ui.click("#askOk");
await ui.waitForFunction(() => document.getElementById("target").value === "TP LED_A", null, { timeout: 8000 });
res.newLayerLog = (await ui.textContent("#diagLog")).split("\n").filter(l => /add_layer|make_bookmark|attach_bookmark|set_url_field/.test(l)).map(l => l.slice(0, 110));
let w = await world();
res.created = w;

// output page = what the Web layer would load
const outp = await ctx.newPage();
outp.on("pageerror", e => errs.push("out: " + e.message));
await outp.setViewportSize({ width: 1152, height: 576 });
await outp.goto(w[0].url);
await outp.waitForTimeout(300);
await outp.evaluate(() => { window.__marker = 42; });
const lit = () => outp.evaluate(() => { const c = document.getElementById("c"), d = c.getContext("2d").getImageData(556, 70, 40, 1).data;
  let n = 0; for (let i = 0; i < 40; i++) if (d[i * 4] > 200) n++; return n; });
res.before = await lit();

// drag thickness in the plugin -> set_url -> Designer navigates the Web layer
const nb = ui.locator('.row[data-key="gridThickness"] input[type=number]');
const t0 = Date.now();
await nb.fill("10"); await nb.dispatchEvent("change");
let url0 = w[0].url;
for (;;) { w = await world(); if (w[0].url !== url0 || Date.now() - t0 > 4000) break; await ui.waitForTimeout(20); }
res.pushMs = Date.now() - t0;
res.keysAfterPush = w[0].keys;
await outp.goto(w[0].url);                      // what Designer does with the new URL
await outp.waitForTimeout(150);
res.after = await lit();
res.noReload = await outp.evaluate(() => window.__marker === 42);

// rapid changes: still one key, no pile-up
for (const v of [3, 4, 5, 6, 7, 8]) { await nb.fill(String(v)); await nb.dispatchEvent("change"); await ui.waitForTimeout(40); }
await ui.waitForTimeout(600);
w = await world();
res.keysAfterBurst = w[0].keys;
res.world = w;
res.finalUrlHasThickness8 = /gridThickness=8/.test(w[0].url);

// logos from the plugin folder
await ui.click("#refresh");
await ui.waitForTimeout(400);
await ui.evaluate(() => document.querySelectorAll("details").forEach(d => d.open = true));
await pick(ui, '.row[data-key="logoTLFile"] select', "red.png");
await ui.waitForTimeout(600);
w = await world();
await outp.goto(w[0].url);
await outp.waitForTimeout(500);
res.logoPx = await outp.evaluate(() => Array.from(document.getElementById("c").getContext("2d").getImageData(45, 45, 1, 1).data));

// reopen the window: the layer's URL restores its state
const ui2 = await ctx.newPage();
ui2.on("pageerror", e => errs.push("ui2: " + e.message));
await ui2.evaluate(() => { try { localStorage.clear(); } catch (e) {} }).catch(() => {});
await ui2.goto(base + "/plugins/gus_testpattern/index.html");
await ui2.waitForFunction(() => document.getElementById("target").options.length > 1, null, { timeout: 8000 });
await pick(ui2, "#target", "TP LED_A");
await ui2.waitForTimeout(200);
res.restored = await ui2.inputValue('.row[data-key="gridThickness"] input[type=number]');
await ui2.close();

// exports
await ui.click("#savePng");
await ui.waitForFunction(() => /saved/.test(document.getElementById("statusTxt").textContent), null, { timeout: 15000 });
await ui.click("#saveTif");
await ui.waitForFunction(() => /saved .*\.tif/.test(document.getElementById("statusTxt").textContent), null, { timeout: 30000 });

await ui.screenshot({ path: out + "/ui.png" });
await outp.screenshot({ path: out + "/out.png" });
res.errs = errs;
console.log(JSON.stringify(res));
await browser.close();

