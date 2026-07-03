import type { ComponentInstance, NetReading, ValidationIssue } from '../types';
import { snaps } from './boards';
import type { Circuit } from './circuit';

// ---------------------------------------------------------------------------
// Digital-first educational solver.
//
// Model, in one paragraph: snap points that are permanently joined (breadboard
// strips, rails, Arduino pins) share a "net key". Wires, pressed buttons and
// switch positions merge net keys into nets (union-find). Rails and output
// pins pin their net to a fixed voltage ("strong"). Resistors, LEDs (a 2 V
// drop + 30 Ω when forward biased), capacitors (voltage state + small series
// resistance) and potentiometers (two resistors) connect nets; undriven nets
// take the conductance-weighted average of their neighbours (relaxation).
// Nets with no path to any source are "floating". This is NOT SPICE — see the
// Simulation Model panel / README for what is and isn't captured.
// ---------------------------------------------------------------------------

export const LED_VF = 2.0;
export const LED_RON = 30;
export const CAP_R = 2;
const RELAX_ITERS = 40;
const HIGH_THRESHOLD = 2.5;

interface NetState {
  volts: number; // NaN = floating
  drive: 'strong' | 'weak' | 'float' | 'conflict';
  strongMin: number;
  strongMax: number;
  hasStrong: boolean;
  strongTags: string[];
}

type Element =
  | { kind: 'res'; a: number; b: number; ohms: number; compId: string }
  | { kind: 'led'; a: number; b: number; vf: number; compId: string; seg: number }
  | { kind: 'cap'; a: number; b: number; farads: number; compId: string };

interface PinState {
  mode: 'input' | 'output';
  value: number; // 0/1 for digital, 0-255 duty when pwm
  pwm: boolean;
}

interface Ic595State {
  bits: number[]; // [QA..QH]
  latch: number[];
  prevSh: boolean;
  prevSt: boolean;
}

interface Ic555State {
  q: boolean;
}

export interface SegmentGlow {
  /** brightness 0..1 for segments a,b,c,d,e,f,g,dp */
  levels: number[];
}

export class Simulation {
  time = 0; // sim milliseconds
  /** program (Arduino sketch) running */
  programRunning = false;

  private netIndex = new Map<string, number>();
  private nets: NetState[] = [];
  private elements: Element[] = [];
  private incident: number[][] = [];
  private keyRoot = new Map<string, string>(); // netKey -> representative key

  private pinStates = new Map<number, PinState>();
  private ic595 = new Map<string, Ic595State>();
  private ic555 = new Map<string, Ic555State>();
  private capV = new Map<string, number>();

  ledLevels = new Map<string, number>();
  segLevels = new Map<string, number[]>();
  runtimeIssues: ValidationIssue[] = [];
  /** pins used as digital/analog inputs last tick (for floating-input hints) */
  readPins = new Set<string>();
  highlightedPins = new Set<string>();
  probeLabel = '';

  private tickCount = 0;

  constructor(private circuit: Circuit) {
    circuit.on('topology', () => this.rebuild());
    this.rebuild();
  }

  // ------------------------------------------------------------------ build

  rebuild() {
    // union-find over all net keys
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = k;
      while (parent.get(c) !== c) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const seen = new Set<string>();
    for (const s of snaps.all) {
      if (!seen.has(s.netKey)) {
        seen.add(s.netKey);
        parent.set(s.netKey, s.netKey);
      }
    }
    const keyOf = (snapId: string) => snaps.netKeyOf(snapId);

    for (const w of this.circuit.wires.values()) union(keyOf(w.a), keyOf(w.b));

    for (const c of this.circuit.components.values()) {
      if (c.type === 'button') {
        // same-side pins always joined
        union(keyOf(c.pins.a1), keyOf(c.pins.a2));
        union(keyOf(c.pins.b1), keyOf(c.pins.b2));
        if (c.props.pressed) union(keyOf(c.pins.a1), keyOf(c.pins.b1));
      } else if (c.type === 'switch') {
        const to = c.props.position === 1 ? c.pins.t2 : c.pins.t1;
        union(keyOf(c.pins.com), keyOf(to));
      } else if (c.type === 'sevenseg') {
        union(keyOf(c.pins.com1), keyOf(c.pins.com2));
      }
    }

    // build net list
    this.netIndex.clear();
    this.nets = [];
    this.keyRoot.clear();
    for (const k of seen) {
      const root = find(k);
      this.keyRoot.set(k, root);
      if (!this.netIndex.has(root)) {
        this.netIndex.set(root, this.nets.length);
        this.nets.push({ volts: NaN, drive: 'float', strongMin: 0, strongMax: 0, hasStrong: false, strongTags: [] });
      }
    }

    // elements
    this.elements = [];
    const netOf = (snapId: string) => this.netIndex.get(this.keyRoot.get(keyOf(snapId))!)!;
    for (const c of this.circuit.components.values()) {
      switch (c.type) {
        case 'resistor':
          this.elements.push({ kind: 'res', a: netOf(c.pins.p1), b: netOf(c.pins.p2), ohms: Math.max(1, Number(c.props.ohms) || 330), compId: c.id });
          break;
        case 'led':
          this.elements.push({ kind: 'led', a: netOf(c.pins.anode), b: netOf(c.pins.cathode), vf: Number(c.props.vf) || LED_VF, compId: c.id, seg: -1 });
          break;
        case 'capacitor':
          this.elements.push({ kind: 'cap', a: netOf(c.pins.plus), b: netOf(c.pins.minus), farads: Math.max(1e-9, Number(c.props.farads) || 1e-5), compId: c.id });
          if (!this.capV.has(c.id)) this.capV.set(c.id, 0);
          break;
        case 'pot': {
          // two resistors, values updated live each tick from props
          this.elements.push({ kind: 'res', a: netOf(c.pins.end1), b: netOf(c.pins.wiper), ohms: 1, compId: c.id + ':1' });
          this.elements.push({ kind: 'res', a: netOf(c.pins.wiper), b: netOf(c.pins.end2), ohms: 1, compId: c.id + ':2' });
          break;
        }
        case 'sevenseg': {
          const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
          segs.forEach((sName, i) => {
            this.elements.push({ kind: 'led', a: netOf(c.pins[sName]), b: netOf(c.pins.com1), vf: LED_VF, compId: c.id, seg: i });
          });
          break;
        }
        default:
          break; // ICs handled as drivers, buttons/switches as unions
      }
      if (c.type === 'ic74hc595' && !this.ic595.has(c.id)) {
        this.ic595.set(c.id, { bits: [0, 0, 0, 0, 0, 0, 0, 0], latch: [0, 0, 0, 0, 0, 0, 0, 0], prevSh: false, prevSt: false });
      }
      if (c.type === 'ic555' && !this.ic555.has(c.id)) {
        this.ic555.set(c.id, { q: false });
      }
    }
    // prune stale IC / cap state
    for (const id of [...this.ic595.keys()]) if (!this.circuit.components.has(id)) this.ic595.delete(id);
    for (const id of [...this.ic555.keys()]) if (!this.circuit.components.has(id)) this.ic555.delete(id);
    for (const id of [...this.capV.keys()]) if (!this.circuit.components.has(id)) this.capV.delete(id);

    this.incident = this.nets.map(() => []);
    this.elements.forEach((e, i) => {
      this.incident[e.a].push(i);
      this.incident[e.b].push(i);
    });
    // relaxation only needs to visit nets that elements touch; everything
    // else is either strongly driven or floating
    this.activeNets = [];
    this.incident.forEach((list, i) => {
      if (list.length > 0) this.activeNets.push(i);
    });
  }

  private activeNets: number[] = [];

  netIdxOfKey(netKey: string): number {
    const root = this.keyRoot.get(netKey);
    if (root === undefined) return -1;
    return this.netIndex.get(root) ?? -1;
  }

  netIdxOfSnap(snapId: string): number {
    return this.netIdxOfKey(snaps.netKeyOf(snapId));
  }

  reading(netIdx: number): NetReading {
    if (netIdx < 0) return { volts: NaN, drive: 'float' };
    const n = this.nets[netIdx];
    return { volts: n.volts, drive: n.drive };
  }

  readingOfSnap(snapId: string): NetReading {
    return this.reading(this.netIdxOfSnap(snapId));
  }

  readingOfKey(netKey: string): NetReading {
    return this.reading(this.netIdxOfKey(netKey));
  }

  /** All snap points electrically joined with the given snap right now. */
  netMembers(snapId: string): string[] {
    const root = this.keyRoot.get(snaps.netKeyOf(snapId));
    const out: string[] = [];
    for (const s of snaps.all) {
      if (this.keyRoot.get(s.netKey) === root) out.push(s.id);
    }
    return out;
  }

  // ------------------------------------------------------- program pin API

  resetProgramState() {
    this.pinStates.clear();
    this.readPins.clear();
    this.highlightedPins.clear();
    this.probeLabel = '';
  }

  fullReset() {
    this.resetProgramState();
    this.time = 0;
    for (const s of this.ic595.values()) {
      s.bits = [0, 0, 0, 0, 0, 0, 0, 0];
      s.latch = [0, 0, 0, 0, 0, 0, 0, 0];
      s.prevSh = false;
      s.prevSt = false;
    }
    for (const s of this.ic555.values()) s.q = false;
    for (const id of this.capV.keys()) this.capV.set(id, 0);
  }

  pinWrite(pin: number, value: 0 | 1) {
    this.pinStates.set(pin, { mode: 'output', value, pwm: false });
  }

  pinPwm(pin: number, duty: number) {
    this.pinStates.set(pin, { mode: 'output', value: Math.max(0, Math.min(255, duty)), pwm: true });
  }

  pinToggle(pin: number) {
    const st = this.pinStates.get(pin);
    const cur = st && st.mode === 'output' && !st.pwm ? st.value : 0;
    this.pinWrite(pin, cur ? 0 : 1);
  }

  pinRead(pin: number): 0 | 1 {
    const st = this.pinStates.get(pin);
    if (st && st.mode === 'output') return st.pwm ? (st.value > 127 ? 1 : 0) : (st.value as 0 | 1);
    this.pinStates.set(pin, { mode: 'input', value: 0, pwm: false });
    this.readPins.add(`ard.D${pin}`);
    const r = this.readingOfKey(`ard.D${pin}`);
    if (r.drive === 'float' || Number.isNaN(r.volts)) return this.noiseBit();
    return r.volts > HIGH_THRESHOLD ? 1 : 0;
  }

  analogRead(index: number): number {
    this.readPins.add(`ard.A${index}`);
    const r = this.readingOfKey(`ard.A${index}`);
    if (r.drive === 'float' || Number.isNaN(r.volts)) return this.noise10();
    return Math.round(Math.max(0, Math.min(5, r.volts)) * (1023 / 5));
  }

  pinIsOutput(pin: number): boolean {
    const st = this.pinStates.get(pin);
    return !!st && st.mode === 'output';
  }

  private noiseBit(): 0 | 1 {
    return ((Math.imul(this.tickCount, 2654435761) >>> 13) & 1) as 0 | 1;
  }

  private noise10(): number {
    return (Math.imul(this.tickCount, 2654435761) >>> 8) % 1024;
  }

  // ------------------------------------------------------------------ tick

  tick(dtMs: number) {
    this.tickCount++;
    this.time += dtMs;
    this.runtimeIssues = [];

    // strong drivers that never change
    const strong: Array<{ net: number; v: number; tag: string }> = [];
    const push = (key: string, v: number, tag: string) => {
      const idx = this.netIdxOfKey(key);
      if (idx >= 0) strong.push({ net: idx, v, tag });
    };
    push('ard.5V', 5, 'Arduino 5V');
    push('ard.3V3', 3.3, 'Arduino 3V3');
    push('ard.GND', 0, 'Arduino GND');
    for (const [pin, st] of this.pinStates) {
      if (st.mode === 'output') {
        const v = st.pwm ? (st.value / 255) * 5 : st.value * 5;
        push(`ard.D${pin}`, v, `pin D${pin}`);
      }
    }

    // update pot resistances live
    for (const c of this.circuit.components.values()) {
      if (c.type === 'pot') {
        const t = Math.max(0.001, Math.min(0.999, Number(c.props.t)));
        const ohms = Math.max(10, Number(c.props.ohms) || 10000);
        for (const e of this.elements) {
          if (e.kind === 'res' && e.compId === c.id + ':1') e.ohms = t * ohms;
          if (e.kind === 'res' && e.compId === c.id + ':2') e.ohms = (1 - t) * ohms;
        }
      }
    }

    // iterate: solve nets, evaluate ICs (their outputs are strong drivers),
    // re-solve while outputs change (bounded).
    const icDrivers: Array<{ net: number; v: number; tag: string }> = [];
    let sequentialDone = false;
    for (let pass = 0; pass < 4; pass++) {
      this.solveNets([...strong, ...icDrivers]);
      const next = this.evalIcs(!sequentialDone, dtMs);
      sequentialDone = true;
      if (driversEqual(icDrivers, next)) break;
      icDrivers.length = 0;
      icDrivers.push(...next);
    }
    const allDrivers = [...strong, ...icDrivers];
    this.solveNets(allDrivers);

    this.integrateCaps(dtMs, allDrivers);
    this.computeLedLevels();
    this.checkRuntimeIssues(strong);
  }

  // --------------------------------------------------------------- solving

  private solveNets(drivers: Array<{ net: number; v: number; tag: string }>) {
    for (const n of this.nets) {
      n.hasStrong = false;
      n.strongMin = Infinity;
      n.strongMax = -Infinity;
      n.strongTags = [];
    }
    for (const d of drivers) {
      const n = this.nets[d.net];
      n.hasStrong = true;
      n.strongMin = Math.min(n.strongMin, d.v);
      n.strongMax = Math.max(n.strongMax, d.v);
      n.strongTags.push(d.tag);
    }
    for (let i = 0; i < this.nets.length; i++) {
      const n = this.nets[i];
      if (n.hasStrong) {
        if (n.strongMax - n.strongMin > 0.5) {
          n.drive = 'conflict';
          n.volts = (n.strongMax + n.strongMin) / 2;
        } else {
          n.drive = 'strong';
          n.volts = (n.strongMax + n.strongMin) / 2;
        }
      } else if (this.incident[i].length === 0) {
        // nothing attached — floating, no relaxation needed
        n.volts = NaN;
        n.drive = 'float';
      } else if (!Number.isFinite(n.volts)) {
        n.volts = NaN;
      }
    }

    for (let iter = 0; iter < RELAX_ITERS; iter++) {
      for (const i of this.activeNets) {
        const n = this.nets[i];
        if (n.hasStrong) continue;
        let sumG = 0;
        let sumGV = 0;
        for (const ei of this.incident[i]) {
          const e = this.elements[ei];
          const other = e.a === i ? e.b : e.a;
          const vo = this.nets[other].volts;
          if (!Number.isFinite(vo)) continue;
          if (e.kind === 'res') {
            const g = 1 / e.ohms;
            sumG += g;
            sumGV += g * vo;
          } else if (e.kind === 'led') {
            const va = this.nets[e.a].volts;
            const vk = this.nets[e.b].volts;
            const conducting = Number.isFinite(va) && Number.isFinite(vk) ? va - vk > e.vf : Number.isFinite(vo);
            if (!conducting) continue;
            const g = 1 / LED_RON;
            const veff = e.a === i ? vo + e.vf : vo - e.vf; // seen from anode : from cathode
            sumG += g;
            sumGV += g * veff;
          } else {
            // capacitor: series (CAP_R) resistance + stored voltage
            const vc = this.capV.get(e.compId) ?? 0;
            const g = 1 / CAP_R;
            const veff = e.a === i ? vo + vc : vo - vc;
            sumG += g;
            sumGV += g * veff;
          }
        }
        if (sumG < 1e-12) {
          n.volts = NaN;
          n.drive = 'float';
        } else {
          const target = sumGV / sumG;
          n.volts = Number.isFinite(n.volts) ? n.volts + (target - n.volts) * 0.9 : target;
          n.drive = 'weak';
        }
      }
    }
  }

  private evalIcs(doSequential: boolean, dtMs: number): Array<{ net: number; v: number; tag: string }> {
    const out: Array<{ net: number; v: number; tag: string }> = [];
    const vOf = (c: ComponentInstance, pin: string) => this.reading(this.netIdxOfSnap(c.pins[pin])).volts;
    const hi = (c: ComponentInstance, pin: string, floatDefault = false) => {
      const v = vOf(c, pin);
      if (!Number.isFinite(v)) return floatDefault;
      return v > HIGH_THRESHOLD;
    };
    const powered = (c: ComponentInstance) => {
      const vcc = vOf(c, 'VCC');
      const gnd = vOf(c, 'GND');
      return Number.isFinite(vcc) && Number.isFinite(gnd) && vcc > 3.0 && gnd < 1.0;
    };
    const drive = (c: ComponentInstance, pin: string, v: number, tag: string) => {
      const idx = this.netIdxOfSnap(c.pins[pin]);
      if (idx >= 0) out.push({ net: idx, v, tag });
    };

    for (const c of this.circuit.components.values()) {
      if (c.type === 'ic74hc00') {
        if (!powered(c)) continue;
        const vcc = vOf(c, 'VCC');
        for (const g of ['1', '2', '3', '4']) {
          const y = !(hi(c, `${g}A`) && hi(c, `${g}B`));
          drive(c, `${g}Y`, y ? vcc : 0, `${c.id} ${g}Y`);
        }
      } else if (c.type === 'ic74hc04') {
        if (!powered(c)) continue;
        const vcc = vOf(c, 'VCC');
        for (const g of ['1', '2', '3', '4', '5', '6']) {
          const y = !hi(c, `${g}A`);
          drive(c, `${g}Y`, y ? vcc : 0, `${c.id} ${g}Y`);
        }
      } else if (c.type === 'ic74hc595') {
        const st = this.ic595.get(c.id)!;
        if (!powered(c)) continue;
        const vcc = vOf(c, 'VCC');
        if (doSequential) {
          const mrV = vOf(c, 'MR');
          const mrLow = Number.isFinite(mrV) && mrV < 1.0;
          const sh = hi(c, 'SHCP');
          const stc = hi(c, 'STCP');
          if (mrLow) {
            st.bits = [0, 0, 0, 0, 0, 0, 0, 0];
          } else if (sh && !st.prevSh) {
            const d = hi(c, 'DS') ? 1 : 0;
            st.bits = [d, ...st.bits.slice(0, 7)];
          }
          if (stc && !st.prevSt) st.latch = [...st.bits];
          st.prevSh = sh;
          st.prevSt = stc;
        }
        const oeV = vOf(c, 'OE');
        const oeLow = Number.isFinite(oeV) ? oeV < 1.0 : false; // floating OE -> disabled
        if (oeLow) {
          const names = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'];
          names.forEach((nm, i) => drive(c, nm, st.latch[i] ? vcc : 0, `${c.id} ${nm}`));
          drive(c, 'QH2', st.bits[7] ? vcc : 0, `${c.id} QH'`);
        }
      } else if (c.type === 'ic555') {
        const st = this.ic555.get(c.id)!;
        if (!powered(c)) continue;
        const vcc = vOf(c, 'VCC');
        if (doSequential) {
          const resetV = vOf(c, 'RESET');
          const resetLow = Number.isFinite(resetV) && resetV < 0.7;
          const thres = vOf(c, 'THRES');
          const trig = vOf(c, 'TRIG');
          if (Number.isFinite(thres) && thres > (2 / 3) * vcc) st.q = false;
          if (Number.isFinite(trig) && trig < (1 / 3) * vcc) st.q = true; // trigger wins
          if (resetLow) st.q = false;
        }
        drive(c, 'OUT', st.q ? vcc : 0, `${c.id} OUT`);
        if (!st.q) drive(c, 'DISCH', 0, `${c.id} DISCH`);
      }
    }
    return out;
  }

  /**
   * Exact exponential capacitor update. The relaxed network is linear from a
   * capacitor's point of view: i(vc) = k·(Voc − vc). One extra solve with the
   * stored voltage perturbed by 1 V measures k and Voc, then
   * vc ← Voc + (vc − Voc)·e^(−dt·k/C) — unconditionally stable for any R·C,
   * including a capacitor jammed straight across the rails.
   */
  private integrateCaps(dtMs: number, drivers: Array<{ net: number; v: number; tag: string }>) {
    const dt = dtMs / 1000;
    const caps = this.elements.filter((e) => e.kind === 'cap');
    if (caps.length === 0) return;
    let dirty = false;
    for (const e of caps) {
      if (e.kind !== 'cap') continue;
      const va = this.nets[e.a].volts;
      const vb = this.nets[e.b].volts;
      let vc = this.capV.get(e.compId) ?? 0;
      if (!Number.isFinite(va) || !Number.isFinite(vb)) {
        vc *= 1 - Math.min(1, dt / 30); // slow self-discharge while floating
        this.capV.set(e.compId, vc);
        continue;
      }
      const i1 = (va - vb - vc) / CAP_R;
      // probe the Thevenin equivalent seen by this capacitor
      this.capV.set(e.compId, vc + 1);
      this.solveNets(drivers);
      dirty = true;
      const va2 = this.nets[e.a].volts;
      const vb2 = this.nets[e.b].volts;
      const i2 = Number.isFinite(va2) && Number.isFinite(vb2) ? (va2 - vb2 - (vc + 1)) / CAP_R : i1;
      const k = i1 - i2;
      let next: number;
      if (k > 1e-12) {
        const voc = vc + i1 / k;
        next = voc + (vc - voc) * Math.exp((-dt * k) / e.farads);
      } else {
        next = vc + (i1 * dt) / e.farads;
      }
      this.capV.set(e.compId, Math.max(-12, Math.min(12, next)));
    }
    // restore consistent node voltages after the probing solves
    if (dirty) this.solveNets(drivers);
  }

  capVoltage(compId: string): number {
    return this.capV.get(compId) ?? 0;
  }

  // ------------------------------------------------- read access for tools

  get netCount(): number {
    return this.nets.length;
  }

  getElements(): ReadonlyArray<Element> {
    return this.elements;
  }

  netState(i: number): { volts: number; drive: string; hasStrong: boolean } {
    const n = this.nets[i];
    return { volts: n.volts, drive: n.drive, hasStrong: n.hasStrong };
  }

  strongHighNets(): Set<number> {
    const s = new Set<number>();
    this.nets.forEach((n, i) => {
      if (n.hasStrong && n.volts > 3.0) s.add(i);
    });
    return s;
  }

  strongLowNets(): Set<number> {
    const s = new Set<number>();
    this.nets.forEach((n, i) => {
      if (n.hasStrong && n.volts < 1.0) s.add(i);
    });
    return s;
  }

  /** Roots (net keys) — two snap ids share a net iff their keys share a root. */
  rootOfKey(netKey: string): string | undefined {
    return this.keyRoot.get(netKey);
  }

  ic595Latch(compId: string): number[] | null {
    const st = this.ic595.get(compId);
    return st ? [...st.latch] : null;
  }

  ic555Out(compId: string): boolean | null {
    const st = this.ic555.get(compId);
    return st ? st.q : null;
  }

  ledCurrent(e: { a: number; b: number; vf: number }): number {
    const va = this.nets[e.a].volts;
    const vk = this.nets[e.b].volts;
    if (!Number.isFinite(va) || !Number.isFinite(vk)) return 0;
    const dv = va - vk;
    if (dv <= e.vf) return 0;
    return (dv - e.vf) / LED_RON;
  }

  private computeLedLevels() {
    this.ledLevels.clear();
    const segTmp = new Map<string, number[]>();
    for (const e of this.elements) {
      if (e.kind !== 'led') continue;
      const i = this.ledCurrent(e);
      const level = Math.min(1, i / 0.012);
      if (e.seg < 0) {
        this.ledLevels.set(e.compId, level);
      } else {
        if (!segTmp.has(e.compId)) segTmp.set(e.compId, [0, 0, 0, 0, 0, 0, 0, 0]);
        segTmp.get(e.compId)![e.seg] = level;
      }
      if (i > 0.03) {
        this.runtimeIssues.push({
          code: 'led-overcurrent',
          severity: 'error',
          title: e.seg < 0 ? 'LED overcurrent' : '7-segment overcurrent',
          detail: `About ${(i * 1000).toFixed(0)} mA is flowing — a real LED would burn out. Add a series resistor (220–330 Ω).`,
          subjects: [e.compId],
        });
      }
    }
    this.segLevels = segTmp;
  }

  private checkRuntimeIssues(strong: Array<{ net: number; v: number; tag: string }>) {
    for (let i = 0; i < this.nets.length; i++) {
      const n = this.nets[i];
      if (n.drive === 'conflict') {
        const isShort = n.strongMax > 4 && n.strongMin < 1;
        this.runtimeIssues.push({
          code: isShort ? 'short-circuit' : 'driver-conflict',
          severity: 'error',
          title: isShort ? 'Short circuit!' : 'Two outputs fighting',
          detail: `These drivers are connected together: ${n.strongTags.join(', ')}. ${
            isShort ? 'A direct 5 V→GND connection would overheat wires and can damage the supply.' : 'Two outputs at different levels are shorted together.'
          }`,
          subjects: [],
        });
      }
    }
    // Arduino output pin overcurrent (rough): sum of element currents out of the pin net
    for (const [pin, st] of this.pinStates) {
      if (st.mode !== 'output') continue;
      const idx = this.netIdxOfKey(`ard.D${pin}`);
      if (idx < 0) continue;
      const vNet = this.nets[idx].volts;
      if (!Number.isFinite(vNet)) continue;
      let out = 0;
      for (const ei of this.incident[idx]) {
        const e = this.elements[ei];
        const other = e.a === idx ? e.b : e.a;
        const vo = this.nets[other].volts;
        if (!Number.isFinite(vo)) continue;
        if (e.kind === 'res') out += (vNet - vo) / e.ohms;
        else if (e.kind === 'led') {
          const i = this.ledCurrent(e);
          out += e.a === idx ? i : -i;
        }
      }
      if (Math.abs(out) > 0.04) {
        this.runtimeIssues.push({
          code: 'pin-overcurrent',
          severity: 'error',
          title: `Pin D${pin} overloaded`,
          detail: `Roughly ${(Math.abs(out) * 1000).toFixed(0)} mA through pin D${pin}. A real ATmega pin is rated for 20 mA (40 mA absolute max). Add a series resistor.`,
          subjects: [],
        });
      }
    }
  }
}

function driversEqual(a: Array<{ net: number; v: number }>, b: Array<{ net: number; v: number }>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].net !== b[i].net || Math.abs(a[i].v - b[i].v) > 0.01) return false;
  }
  return true;
}
