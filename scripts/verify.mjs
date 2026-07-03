// Verification harness: launches the built app, exercises the main flows,
// asserts simulated behaviour via the window.__lab test hook, and captures
// screenshots into verification/.
//
// Usage:  npm run build && npm run verify
// (starts `vite preview` itself on port 4173)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('../verification/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(500);
  }
  throw new Error('preview server did not start');
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});

let browser;
try {
  await waitForServer(BASE);

  const exeCandidates = ['/opt/pw-browsers/chromium'];
  let executablePath;
  for (const c of exeCandidates) {
    if (existsSync(c)) {
      // could be a dir wrapper; playwright default resolution usually works, keep undefined then
      const st = statSync(c);
      if (st.isFile()) executablePath = c;
    }
  }
  browser = await chromium.launch({
    executablePath,
    args: ['--enable-unsafe-swiftshader', '--disable-gpu'],
  });

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  await page.goto(BASE);
  await page.waitForFunction(() => window.__lab !== undefined, { timeout: 20000 });
  await wait(2500); // let textures + first frames render

  const lab = (fn, ...args) => page.evaluate(([f, a]) => window.__lab[f](...a), [fn, args]);

  // ---------------------------------------------------------- 1. workbench
  // first visit auto-loads Lab 1 (LED + resistor) — LED should light with no program
  const levels1 = await lab('ledLevels');
  const l1 = Object.values(levels1)[0] ?? 0;
  check('Lab 1 auto-loaded, LED lit from rails (no program)', l1 > 0.3 && l1 <= 1, `brightness=${l1.toFixed(2)}`);
  await page.screenshot({ path: OUT + '01-workbench.png' });
  const canvasShot = await page.locator('#three-canvas').screenshot();
  check('WebGL canvas is not blank', canvasShot.byteLength > 40000, `${(canvasShot.byteLength / 1024).toFixed(0)} kB canvas PNG`);

  // ----------------------------------------------- 2. blink program (D13)
  await lab('loadLab', 'lab2'); // has LED on D13
  await lab('loadSample', 'blink');
  await lab('run');
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await wait(280);
    const d13 = await lab('readingOfKey', 'ard.D13');
    samples.push(d13.volts > 2.5 ? 1 : 0);
  }
  const toggles = samples.slice(1).filter((v, i) => v !== samples[i]).length;
  check('Blink sample toggles D13 over time', toggles >= 2, `states=${samples.join('')}`);

  // ------------------------------------------- 3. button controls LED lab
  await lab('loadLab', 'lab2');
  await lab('run');
  await wait(400);
  const comps = await lab('components');
  const btn = comps.find((c) => c.type === 'button');
  const led = comps.find((c) => c.type === 'led');
  const before = (await lab('ledLevels'))[led.id] ?? 0;
  await lab('pressButton', btn.id, true);
  await wait(400);
  const during = (await lab('ledLevels'))[led.id] ?? 0;
  await lab('pressButton', btn.id, false);
  await wait(400);
  const after = (await lab('ledLevels'))[led.id] ?? 0;
  check('Lab 2: button press lights LED via program', before < 0.05 && during > 0.3 && after < 0.05, `off=${before.toFixed(2)} on=${during.toFixed(2)} off=${after.toFixed(2)}`);

  // --------------------------------------------------- 4. 555 astable lab
  await lab('loadLab', 'lab3');
  await wait(300);
  const seen = new Set();
  for (let i = 0; i < 22; i++) {
    await wait(180);
    const lv = Object.values(await lab('ledLevels'))[0] ?? 0;
    seen.add(lv > 0.2 ? 'on' : 'off');
  }
  check('Lab 3: 555 blinks LED with no program', seen.has('on') && seen.has('off'), `states seen: ${[...seen].join(',')}`);

  // ------------------------------------- 5. shift register + 7-seg counter
  await lab('loadLab', 'lab4');
  await lab('run');
  await wait(4200);
  const segs = await lab('segLevels');
  const segArr = Object.values(segs)[0] ?? [];
  const lit = segArr.filter((s) => s > 0.3).length;
  const serial = await lab('serial');
  check('Lab 4: 7-segment shows segments via 74HC595', lit >= 2, `${lit} segments lit`);
  check('Lab 4: serial monitor received prints', serial.length >= 2, `${serial.length} lines: ${serial.slice(0, 4).join(',')}`);
  await page.evaluate(() => window.__lab.probe('bb.d5')); // DS (serial data) line of the 74HC595
  await wait(300);
  await page.screenshot({ path: OUT + '02-lab4-running.png' });

  // --------------------------------------------------- 6. block editor shot
  await lab('toggleDrawer', true);
  await wait(700);
  await page.screenshot({ path: OUT + '03-block-editor.png' });
  const blocklyVisible = await page.locator('.blocklySvg').isVisible();
  check('Block editor (Blockly) renders', blocklyVisible);
  await lab('toggleDrawer', false);

  // ------------------------------------------------- 7. validation warnings
  await page.evaluate(() => {
    window.__lab.loadProject({
      version: 1,
      labId: 'free',
      components: [{ id: 'c1', type: 'led', pins: { anode: 'bb.pt5', cathode: 'bb.nt5' }, props: { color: 'red' } }],
      wires: [
        { id: 'w1', a: 'ard.5v', b: 'bb.pt1', color: '#e03131' },
        { id: 'w2', a: 'ard.gnd1', b: 'bb.nt1', color: '#212529' },
      ],
      program: null,
      settings: { speed: 1 },
    });
    window.__lab.setTab('issues');
  });
  await wait(1200);
  const issues = await lab('issues');
  const codes = issues.map((i) => i.code);
  check('Validation: LED without resistor flagged', codes.includes('led-no-resistor') || codes.includes('led-overcurrent'), codes.join(','));
  await page.screenshot({ path: OUT + '04-validation-issues.png' });

  // -------------------------------------------------- 8. narrow viewport
  await page.setViewportSize({ width: 860, height: 900 });
  await wait(800);
  await page.screenshot({ path: OUT + '05-narrow-viewport.png' });

  // -------------------------------------------------------- 9. page errors
  const fatal = pageErrors.filter((e) => !/favicon|404/i.test(e));
  check('No page/console errors', fatal.length === 0, fatal.slice(0, 3).join(' | '));
} catch (err) {
  check('verification script completed', false, String(err));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
