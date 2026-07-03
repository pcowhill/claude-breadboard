// Regression checks for the review fixes: parallel caps, self-loop cap,
// IC-to-IC chains. Run from the project directory.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4175;
const BASE = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: '/home/user/claude-breadboard',
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
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await wait(400);
  }
  let executablePath;
  try {
    if (statSync('/opt/pw-browsers/chromium').isFile()) executablePath = '/opt/pw-browsers/chromium';
  } catch {}
  browser = await chromium.launch({ executablePath, args: ['--enable-unsafe-swiftshader', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__lab !== undefined, { timeout: 20000 });
  await wait(1500);
  const lab = (fn, ...args) => page.evaluate(([f, a]) => window.__lab[f](...a), [fn, args]);

  // --- 1. two parallel caps charge through 10k: must stay <= 5.05 V and rise with tau ~0.2 s
  await lab('loadProject', {
    version: 1, labId: 'free',
    components: [
      { id: 'c1', type: 'resistor', pins: { p1: 'bb.pt3', p2: 'bb.a12' }, props: { ohms: 10000 } },
      { id: 'c2', type: 'capacitor', pins: { plus: 'bb.b12', minus: 'bb.nt3' }, props: { farads: 0.00001 } },
      { id: 'c3', type: 'capacitor', pins: { plus: 'bb.c12', minus: 'bb.nt5' }, props: { farads: 0.00001 } },
    ],
    wires: [
      { id: 'w1', a: 'ard.5v', b: 'bb.pt1', color: '#e03131' },
      { id: 'w2', a: 'ard.gnd1', b: 'bb.nt1', color: '#212529' },
    ],
    program: null, settings: { speed: 1 },
  });
  await wait(300);
  const v0 = (await lab('reading', 'bb.d12')).volts;
  await wait(1000);
  const v1 = (await lab('reading', 'bb.d12')).volts;
  await wait(2500);
  const v2 = (await lab('reading', 'bb.d12')).volts;
  check('parallel caps: node rises monotonically', v0 < v1 + 0.02 && v1 < v2 + 0.05, `${v0?.toFixed(2)} → ${v1?.toFixed(2)} → ${v2?.toFixed(2)}`);
  check('parallel caps: never exceeds the 5 V supply', v0 <= 5.05 && v1 <= 5.05 && v2 <= 5.05, `max=${Math.max(v0, v1, v2).toFixed(2)} V`);
  // tau = 10k * 20uF = 0.2 s: visibly ramping at the first sample, essentially full by ~4 s
  check('parallel caps: follows the physical RC curve (tau≈0.2s)', v0 > 1.5 && v0 < 4.85 && v2 > 4.85, `v(0.3s)=${v0?.toFixed(2)} V, v(3.8s)=${v2?.toFixed(2)} V`);

  // --- 2. self-loop cap (legs joined by a wire path) stays finite
  await lab('loadProject', {
    version: 1, labId: 'free',
    components: [
      { id: 'c1', type: 'resistor', pins: { p1: 'bb.pt3', p2: 'bb.a12' }, props: { ohms: 10000 } },
      { id: 'c2', type: 'resistor', pins: { p1: 'bb.b12', p2: 'bb.nt3' }, props: { ohms: 10000 } },
      { id: 'c3', type: 'capacitor', pins: { plus: 'bb.c12', minus: 'bb.a20' }, props: { farads: 0.00001 } },
    ],
    wires: [
      { id: 'w1', a: 'ard.5v', b: 'bb.pt1', color: '#e03131' },
      { id: 'w2', a: 'ard.gnd1', b: 'bb.nt1', color: '#212529' },
      { id: 'w3', a: 'bb.d12', b: 'bb.b20', color: '#f5c518' }, // bridges the cap's two strips
    ],
    program: null, settings: { speed: 1 },
  });
  await wait(1500);
  const vm = (await lab('reading', 'bb.e12')).volts;
  check('self-looped cap: divider node stays at ~2.5 V', Number.isFinite(vm) && vm > 2.2 && vm < 2.8, `${vm?.toFixed(2)} V`);

  // --- 3. IC-to-IC chain: all six 74HC04 inverters chained, input HIGH -> output HIGH
  await lab('loadProject', {
    version: 1, labId: 'free',
    components: [
      { id: 'c1', type: 'ic74hc04', pins: {
        '1A': 'bb.f3', '1Y': 'bb.f4', '2A': 'bb.f5', '2Y': 'bb.f6', '3A': 'bb.f7', '3Y': 'bb.f8', GND: 'bb.f9',
        '4Y': 'bb.e9', '4A': 'bb.e8', '5Y': 'bb.e7', '5A': 'bb.e6', '6Y': 'bb.e5', '6A': 'bb.e4', VCC: 'bb.e3',
      }, props: {} },
    ],
    wires: [
      { id: 'w1', a: 'ard.5v', b: 'bb.pt1', color: '#e03131' },
      { id: 'w2', a: 'ard.gnd1', b: 'bb.nt1', color: '#212529' },
      { id: 'w3', a: 'bb.a3', b: 'bb.pt2', color: '#e03131' }, // VCC
      { id: 'w4', a: 'bb.g9', b: 'bb.nt2', color: '#212529' }, // GND
      { id: 'w5', a: 'bb.g3', b: 'bb.pt4', color: '#f5c518' }, // 1A = HIGH
      { id: 'w6', a: 'bb.g4', b: 'bb.h5', color: '#2f9e44' }, // 1Y -> 2A
      { id: 'w7', a: 'bb.g6', b: 'bb.h7', color: '#2f9e44' }, // 2Y -> 3A
      { id: 'w8', a: 'bb.g8', b: 'bb.a8', color: '#2f9e44' }, // 3Y -> 4A
      { id: 'w9', a: 'bb.a9', b: 'bb.b6', color: '#3b6fe0' }, // 4Y -> 5A
      { id: 'w10', a: 'bb.a7', b: 'bb.b4', color: '#3b6fe0' }, // 5Y -> 6A
    ],
    program: null, settings: { speed: 1 },
  });
  await wait(1200);
  const y3 = (await lab('reading', 'bb.g8')).volts; // 3Y after 3 inversions of HIGH -> LOW... (H->L->H->L)
  const y6 = (await lab('reading', 'bb.b5')).volts; // 6Y net (t5)
  check('six-inverter chain settles: 3Y LOW, 6Y HIGH', y3 < 0.5 && y6 > 4.5, `3Y=${y3?.toFixed(2)} 6Y=${y6?.toFixed(2)}`);
} catch (e) {
  check('regression script completed', false, String(e));
} finally {
  await browser?.close();
  server.kill();
}
process.exit(results.every(Boolean) ? 0 : 1);
