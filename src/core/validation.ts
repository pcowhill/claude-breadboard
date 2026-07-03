import type { ValidationIssue } from '../types';
import { snaps } from './boards';
import type { Circuit } from './circuit';
import type { Simulation } from './simulation';

// Static circuit lint. Runs on every topology change (plus periodically so
// power-dependent checks track the live solution) and is merged with the
// engine's runtime issues (shorts, overcurrent) in the Issues panel.

const IC_TYPES = ['ic555', 'ic74hc00', 'ic74hc04', 'ic74hc595'] as const;

const HC_INPUTS: Record<string, string[]> = {
  ic74hc00: ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'],
  ic74hc04: ['1A', '2A', '3A', '4A', '5A', '6A'],
  ic74hc595: ['DS', 'SHCP', 'STCP'],
};

export function validate(circuit: Circuit, sim: Simulation, programPins: { digital: Set<number>; analog: Set<number> }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const netOfSnap = (id: string) => sim.netIdxOfSnap(id);

  // --- min-series-resistance between nets (Dijkstra over resistor edges) ---
  const elements = sim.getElements();
  const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: sim.netCount }, () => []);
  for (const e of elements) {
    if (e.kind === 'res') {
      adj[e.a].push({ to: e.b, w: e.ohms });
      adj[e.b].push({ to: e.a, w: e.ohms });
    }
  }
  const minR = (from: number, targets: Set<number>): number => {
    if (from < 0) return Infinity;
    if (targets.has(from)) return 0;
    const dist = new Map<number, number>([[from, 0]]);
    const queue: Array<[number, number]> = [[0, from]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, u] = queue.shift()!;
      if (targets.has(u)) return d;
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const { to, w } of adj[u]) {
        const nd = d + w;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          queue.push([nd, to]);
        }
      }
    }
    return Infinity;
  };

  const highNets = sim.strongHighNets();
  const lowNets = sim.strongLowNets();

  // --- short circuit: 5V and GND joined with (almost) no resistance ---
  const fiveIdx = sim.netIdxOfKey('ard.5V');
  const gndIdx = sim.netIdxOfKey('ard.GND');
  if (fiveIdx >= 0 && gndIdx >= 0) {
    const r = fiveIdx === gndIdx ? 0 : minR(fiveIdx, new Set([gndIdx]));
    if (r < 5) {
      issues.push({
        code: 'short-5v-gnd',
        severity: 'error',
        title: 'Short circuit between 5 V and GND',
        detail: 'The 5 V supply is connected to ground with essentially no resistance. Trace the highlighted wires — something connects the + rail to the − rail directly.',
        subjects: [],
      });
    }
    const idx33 = sim.netIdxOfKey('ard.3V3');
    if (idx33 >= 0 && (idx33 === gndIdx || idx33 === fiveIdx)) {
      issues.push({
        code: 'short-3v3',
        severity: 'error',
        title: '3.3 V rail shorted',
        detail: 'The 3.3 V pin is wired straight to another supply rail.',
        subjects: [],
      });
    }
  }

  // --- LED checks (single LEDs and 7-seg segments) ---
  for (const e of elements) {
    if (e.kind !== 'led') continue;
    const comp = circuit.components.get(e.compId);
    if (!comp) continue;
    const isSeg = e.seg >= 0;
    const rHigh = minR(e.a, highNets);
    const rLow = minR(e.b, lowNets);
    if (rHigh + rLow < 60 && rHigh < Infinity && rLow < Infinity) {
      issues.push({
        code: 'led-no-resistor',
        severity: 'warning',
        title: isSeg ? '7-segment segment without resistor' : 'LED without a series resistor',
        detail: `${isSeg ? `Segment ${'abcdefg.'[e.seg]}` : 'This LED'} is connected across the supply with less than 60 Ω in series. Real LEDs need a current-limiting resistor (220–330 Ω) or they burn out.`,
        subjects: [e.compId],
      });
    }
    if (!isSeg) {
      const rHighRev = minR(e.b, highNets); // cathode toward 5 V
      const rLowRev = minR(e.a, lowNets); // anode toward GND
      if (rHighRev < 10000 && rLowRev < 10000 && !(rHigh < 10000 && rLow < 10000)) {
        issues.push({
          code: 'led-reversed',
          severity: 'warning',
          title: 'LED appears to be reversed',
          detail: 'The cathode (−) leads toward 5 V and the anode (+) toward GND. LEDs only light one way round — select the LED and use "Flip polarity".',
          subjects: [e.compId],
        });
      }
    }
  }

  // --- per-component checks ---
  const gndRoot = sim.rootOfKey('ard.GND');
  let usesArduinoSignals = false;
  for (const w of circuit.wires.values()) {
    for (const end of [w.a, w.b]) {
      const k = snaps.netKeyOf(end);
      if (/^ard\.(D\d+|A\d)$/.test(k)) usesArduinoSignals = true;
      if (k.startsWith('inert.')) {
        issues.push({
          code: 'inert-pin',
          severity: 'info',
          title: `Wire on unsimulated pin (${snaps.get(end).label})`,
          detail: 'This Arduino pin is not part of the simulation model (see the Simulation Model panel). The wire does nothing.',
          subjects: [w.id],
        });
      }
    }
  }

  let bbTouchesGnd = false;
  for (const s of snaps.all) {
    if (s.boardId === 'bb' && sim.rootOfKey(s.netKey) === gndRoot) {
      bbTouchesGnd = true;
      break;
    }
  }
  if (usesArduinoSignals && circuit.components.size > 0 && !bbTouchesGnd) {
    issues.push({
      code: 'no-common-ground',
      severity: 'warning',
      title: 'No common ground',
      detail: 'Arduino signal pins are wired to the breadboard, but the breadboard never connects back to an Arduino GND pin. Every circuit needs a shared ground reference.',
      subjects: [],
    });
  }

  for (const comp of circuit.components.values()) {
    if ((IC_TYPES as readonly string[]).includes(comp.type)) {
      const vcc = sim.readingOfSnap(comp.pins.VCC);
      const gnd = sim.readingOfSnap(comp.pins.GND);
      const ok = Number.isFinite(vcc.volts) && vcc.volts > 3.0 && Number.isFinite(gnd.volts) && gnd.volts < 1.0;
      if (!ok) {
        issues.push({
          code: 'ic-unpowered',
          severity: 'warning',
          title: `${comp.type.replace('ic', '').toUpperCase()} has no power`,
          detail: 'Connect the VCC pin to 5 V and the GND pin to ground. An unpowered chip does nothing (its outputs float).',
          subjects: [comp.id],
        });
      } else {
        const inputs = HC_INPUTS[comp.type] ?? [];
        const floating = inputs.filter((p) => sim.readingOfSnap(comp.pins[p]).drive === 'float');
        if (floating.length) {
          issues.push({
            code: 'floating-input',
            severity: 'warning',
            title: `Floating input${floating.length > 1 ? 's' : ''} on ${comp.type.replace('ic', '').toUpperCase()}`,
            detail: `Pin${floating.length > 1 ? 's' : ''} ${floating.join(', ')} ${floating.length > 1 ? 'are' : 'is'} not connected to anything. CMOS inputs must always be tied HIGH or LOW — floating inputs read random values.`,
            subjects: [comp.id],
          });
        }
        if (comp.type === 'ic555') {
          if (sim.readingOfSnap(comp.pins.RESET).drive === 'float') {
            issues.push({
              code: '555-reset-floating',
              severity: 'info',
              title: '555 RESET pin is floating',
              detail: 'The simulator treats a floating RESET as HIGH (running), but on a real 555 you should tie pin 4 to 5 V.',
              subjects: [comp.id],
            });
          }
          if (sim.readingOfSnap(comp.pins.TRIG).drive === 'float' && sim.readingOfSnap(comp.pins.THRES).drive === 'float') {
            issues.push({
              code: '555-unwired',
              severity: 'warning',
              title: '555 timing pins not connected',
              detail: 'TRIG (pin 2) and THRES (pin 6) are floating, so the timer never switches. For a blinker, wire the classic astable: R1 from 5 V to pin 7, R2 from pin 7 to pin 6, capacitor from pin 6 to GND, and join pins 2 and 6.',
              subjects: [comp.id],
            });
          }
        }
        if (comp.type === 'ic74hc595') {
          const mr = sim.readingOfSnap(comp.pins.MR);
          if (mr.drive === 'float' || (Number.isFinite(mr.volts) && mr.volts < 1)) {
            issues.push({
              code: '595-mr',
              severity: mr.drive === 'float' ? 'warning' : 'error',
              title: mr.drive === 'float' ? '74HC595 MR pin floating' : '74HC595 held in reset',
              detail: 'MR (pin 10) is the active-low master reset. Tie it to 5 V or the register stays cleared.',
              subjects: [comp.id],
            });
          }
          const oe = sim.readingOfSnap(comp.pins.OE);
          if (oe.drive === 'float' || (Number.isFinite(oe.volts) && oe.volts > 2.5)) {
            issues.push({
              code: '595-oe',
              severity: 'warning',
              title: '74HC595 outputs disabled',
              detail: 'OE (pin 13) is active-low. Tie it to GND or the outputs stay disconnected (the simulator disables them too).',
              subjects: [comp.id],
            });
          }
        }
      }
    }

    // isolated two-pin part
    if (comp.type === 'led' || comp.type === 'resistor' || comp.type === 'capacitor') {
      const pinIds = Object.values(comp.pins);
      const lonely = pinIds.every((pid) => {
        const members = sim.netMembers(pid);
        return !members.some((m) => m !== pid && circuit.occupancy.has(m));
      });
      const anyStrong = pinIds.some((pid) => sim.readingOfSnap(pid).drive !== 'float');
      if (lonely && !anyStrong) {
        issues.push({
          code: 'not-connected',
          severity: 'info',
          title: `${comp.type === 'led' ? 'LED' : comp.type === 'resistor' ? 'Resistor' : 'Capacitor'} not in a circuit`,
          detail: 'Nothing else connects to either leg, so no current can flow through this part yet.',
          subjects: [comp.id],
        });
      }
    }
  }

  // --- wires that lead nowhere ---
  for (const w of circuit.wires.values()) {
    for (const end of [w.a, w.b]) {
      const members = sim.netMembers(end);
      const other = members.some((m) => m !== end && m !== w.a && m !== w.b && circuit.occupancy.has(m));
      const sp = snaps.get(end);
      const isArd = sp.boardId === 'ard';
      const strong = sim.readingOfSnap(end).drive === 'strong';
      if (!other && !isArd && !strong) {
        issues.push({
          code: 'wire-to-empty',
          severity: 'info',
          title: 'Wire ends on an empty strip',
          detail: `One end of this wire lands on ${sp.label}, but nothing else connects to that strip. Remember: only holes in the same column half (a–e or f–j) or the same rail are joined.`,
          subjects: [w.id],
        });
        break;
      }
    }
  }

  // --- unpowered rails that are in use ---
  for (const railKey of ['bb.railpt', 'bb.railnt', 'bb.railpb', 'bb.railnb']) {
    const reading = sim.readingOfKey(railKey);
    if (reading.drive !== 'float') continue;
    const root = sim.rootOfKey(railKey);
    let used = false;
    for (const [snapId] of circuit.occupancy) {
      if (sim.rootOfKey(snaps.netKeyOf(snapId)) === root) {
        used = true;
        break;
      }
    }
    if (used) {
      issues.push({
        code: 'rail-unpowered',
        severity: 'warning',
        title: 'Power rail is not powered',
        detail: 'Something connects to a power rail, but that rail is not wired to 5 V, 3.3 V or GND. Jumper the rail to the Arduino power pins.',
        subjects: [],
      });
    }
  }

  // --- program uses pins that go nowhere ---
  for (const pin of programPins.digital) {
    const key = `ard.D${pin}`;
    const root = sim.rootOfKey(key);
    let connected = false;
    for (const s of snaps.all) {
      if (s.netKey !== key && sim.rootOfKey(s.netKey) === root) {
        connected = true;
        break;
      }
    }
    if (!connected) {
      issues.push({
        code: 'program-pin-unwired',
        severity: 'warning',
        title: `Program uses D${pin}, but nothing is wired to it`,
        detail: `Your blocks read or write digital pin ${pin}, but no wire is plugged into that header socket.`,
        subjects: [],
      });
    }
  }
  for (const pin of programPins.analog) {
    const key = `ard.A${pin}`;
    const root = sim.rootOfKey(key);
    let connected = false;
    for (const s of snaps.all) {
      if (s.netKey !== key && sim.rootOfKey(s.netKey) === root) {
        connected = true;
        break;
      }
    }
    if (!connected) {
      issues.push({
        code: 'program-pin-unwired',
        severity: 'warning',
        title: `Program reads A${pin}, but nothing is wired to it`,
        detail: `analog pin A${pin} is floating, so reads return noise. Wire a sensor (e.g. the potentiometer wiper) to it.`,
        subjects: [],
      });
    }
  }

  // de-duplicate identical issues
  const seenKeys = new Set<string>();
  return issues.filter((i) => {
    const k = i.code + '|' + i.subjects.join(',') + '|' + i.title;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
}
