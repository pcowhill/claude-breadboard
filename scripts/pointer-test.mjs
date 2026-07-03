// Real pointer-interaction smoke test: palette clicks + canvas clicks.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

let browser;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ' — ' + detail : ''}`);
};

try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) break;
    } catch {}
    await wait(400);
  }
  // use the pre-provisioned browser when present, else Playwright's own
  let executablePath;
  try {
    const st = statSync('/opt/pw-browsers/chromium');
    if (st.isFile()) executablePath = '/opt/pw-browsers/chromium';
  } catch {}
  browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__lab !== undefined, { timeout: 20000 });
  await wait(2000);
  // start from a clean bench
  await page.evaluate(() => window.__lab.loadProject({ version: 1, labId: 'free', components: [], wires: [], program: null, settings: { speed: 1 } }));
  await wait(400);

  // --- wire tool via real clicks: 5V pin -> + rail hole
  await page.click('button[data-tool="wire"]');
  const p1 = await page.evaluate(() => window.__lab.screenPosOfSnap('ard.5v'));
  await page.mouse.click(p1.x, p1.y);
  await wait(200);
  const p2 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.pt3'));
  await page.mouse.click(p2.x, p2.y);
  await wait(300);
  let wires = await page.evaluate(() => window.__lab.wires());
  check('click-click wiring creates a wire', wires.length === 1 && wires[0].a === 'ard.5v' && wires[0].b === 'bb.pt3', JSON.stringify(wires));

  // --- LED placement via palette + two clicks
  await page.click('button[data-component="led"]');
  const h1 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.c10'));
  await page.mouse.click(h1.x, h1.y);
  await wait(200);
  const h2 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.c12'));
  await page.mouse.click(h2.x, h2.y);
  await wait(300);
  let comps = await page.evaluate(() => window.__lab.components());
  check('palette + two clicks places an LED', comps.length === 1 && comps[0].type === 'led' && comps[0].pins.anode === 'bb.c10', JSON.stringify(comps.map((c) => c.pins)));

  // --- footprint placement (button) via palette + one click
  await page.click('button[data-component="button"]');
  const h3 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.e20'));
  await page.mouse.click(h3.x, h3.y);
  await wait(300);
  comps = await page.evaluate(() => window.__lab.components());
  const btn = comps.find((c) => c.type === 'button');
  check('footprint click places a push button straddling the gap', !!btn && btn.pins.a1 === 'bb.e20' && btn.pins.b2 === 'bb.f22', JSON.stringify(btn?.pins));

  // --- selection + Delete key removes the LED
  await page.click('button[data-tool="select"]');
  const ledPos = await page.evaluate(() => {
    const a = window.__lab.screenPosOfSnap('bb.c10');
    const b = window.__lab.screenPosOfSnap('bb.c12');
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 18 }; // LED body sits above the holes
  });
  await page.mouse.click(ledPos.x, ledPos.y);
  await wait(200);
  await page.keyboard.press('Delete');
  await wait(300);
  comps = await page.evaluate(() => window.__lab.components());
  check('click-select + Delete removes the LED', !comps.some((c) => c.type === 'led'), `${comps.length} comps left`);

  // --- Escape cancels wire-in-progress
  await page.click('button[data-tool="wire"]');
  const p3 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.a1'));
  await page.mouse.click(p3.x, p3.y);
  await page.keyboard.press('Escape');
  const p4 = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.a3'));
  await page.mouse.click(p4.x, p4.y);
  await wait(300);
  wires = await page.evaluate(() => window.__lab.wires());
  check('Escape cancels in-progress wire', wires.length === 1, `${wires.length} wires`);

  // --- hover status shows identity
  const hov = await page.evaluate(() => window.__lab.screenPosOfSnap('bb.f15'));
  await page.mouse.move(hov.x, hov.y);
  await wait(300);
  const status = await page.textContent('#status-hover');
  check('hover shows hole identity', /f15/.test(status), status.slice(0, 80));
} catch (e) {
  check('pointer test completed', false, String(e));
} finally {
  await browser?.close();
  server.kill();
}
process.exit(results.every(Boolean) ? 0 : 1);
