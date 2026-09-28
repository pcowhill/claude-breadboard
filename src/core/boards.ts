import type { SnapPoint, Vec3 } from '../types';

// Physical layout of the two boards, in millimetres, world space.
// The desk surface is y = 0; the anti-static mat top is y = MAT_TOP.

export const PITCH = 2.54;
export const MAT_TOP = 2;

// ---------------------------------------------------------------- breadboard

export const BB_COLS = 30;
export const BB_BODY = { w: 86, h: 9, d: 56 };
export const BB_CENTER = { x: 42, z: 40 };
export const BB_TOP_Y = MAT_TOP + BB_BODY.h; // 11

export const BB_ROWS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;
export type BbRow = (typeof BB_ROWS)[number];

/** Local z offset of each terminal row (relative to board centre). */
export function bbRowZ(row: BbRow): number {
  const i = BB_ROWS.indexOf(row);
  // rows a..e at -11.43..-1.27, f..j at 1.27..11.43
  return i < 5 ? -11.43 + i * PITCH : 1.27 + (i - 5) * PITCH;
}

/** Local x of a terminal column (1-based). */
export function bbColX(col: number): number {
  return (col - (BB_COLS + 1) / 2) * PITCH;
}

export const RAIL_ROWS = [
  { code: 'pt', z: -19.05, polarity: '+', side: 'top' },
  { code: 'nt', z: -21.59, polarity: '-', side: 'top' },
  { code: 'pb', z: 19.05, polarity: '+', side: 'bottom' },
  { code: 'nb', z: 21.59, polarity: '-', side: 'bottom' },
] as const;

export const RAIL_HOLES = 25;

/** Local x of a rail hole (1-based, 5 groups of 5). */
export function railHoleX(i: number): number {
  const idx = i - 1;
  const group = Math.floor(idx / 5);
  const inGroup = idx % 5;
  return (group * 6 + inGroup - 14) * PITCH;
}

export function bbLocalToWorld(lx: number, lz: number, y = BB_TOP_Y): Vec3 {
  return { x: BB_CENTER.x + lx, y, z: BB_CENTER.z + lz };
}

// ------------------------------------------------------------------ arduino

export const ARD_BODY = { w: 69, h: 1.6, d: 53.4 };
export const ARD_CENTER = { x: -62, z: 16 };
export const ARD_ROT_Y = -0.1; // slight aesthetic rotation
export const ARD_PCB_TOP = MAT_TOP + 3 + ARD_BODY.h; // sits on standoffs
export const ARD_PIN_Y = ARD_PCB_TOP + 9; // top of the header sockets

export function ardLocalToWorld(lx: number, lz: number, y = ARD_PIN_Y): Vec3 {
  const c = Math.cos(ARD_ROT_Y);
  const s = Math.sin(ARD_ROT_Y);
  return { x: ARD_CENTER.x + lx * c + lz * s, y, z: ARD_CENTER.z - lx * s + lz * c };
}

export interface ArdPinSpec {
  id: string;
  label: string;
  netKey: string; // '' => inert (not simulated)
  lx: number;
  lz: number;
  desc: string;
}

const DIGITAL_Z = -23;
const POWER_Z = 23;

function digitalStrip(): ArdPinSpec[] {
  // Left strip: SCL SDA AREF GND D13..D8, right strip: D7..D0 (Uno-style).
  const left = ['SCL', 'SDA', 'AREF', 'GND', '13', '12', '11', '10', '9', '8'];
  const right = ['7', '6', '5', '4', '3', '2', '1', '0'];
  const pins: ArdPinSpec[] = [];
  left.forEach((p, i) => {
    const lx = -31 + i * PITCH;
    pins.push(pinSpec(p, lx, DIGITAL_Z));
  });
  right.forEach((p, i) => {
    const lx = -31 + 10 * PITCH + 1.5 + i * PITCH;
    pins.push(pinSpec(p, lx, DIGITAL_Z));
  });
  return pins;
}

function pinSpec(p: string, lx: number, lz: number): ArdPinSpec {
  if (/^\d+$/.test(p)) {
    const n = Number(p);
    const pwm = [3, 5, 6, 9, 10, 11].includes(n);
    return {
      id: `ard.d${n}`,
      label: `D${n}`,
      netKey: `ard.D${n}`,
      lx,
      lz,
      desc: `Arduino digital pin ${n}${pwm ? ' (PWM capable)' : ''}. Use with the digital / PWM blocks.`,
    };
  }
  switch (p) {
    case 'GND':
      return { id: `ard.gnd${gndCounter++}`, label: 'GND', netKey: 'ard.GND', lx, lz, desc: 'Arduino ground (0 V).' };
    case 'AREF':
      return { id: 'ard.aref', label: 'AREF', netKey: '', lx, lz, desc: 'Analog reference — not simulated.' };
    case 'SCL':
      return { id: 'ard.scl', label: 'SCL', netKey: '', lx, lz, desc: 'I²C clock — not simulated.' };
    case 'SDA':
      return { id: 'ard.sda', label: 'SDA', netKey: '', lx, lz, desc: 'I²C data — not simulated.' };
    default:
      throw new Error(`bad pin ${p}`);
  }
}

let gndCounter = 0;

function powerStrip(): ArdPinSpec[] {
  gndCounter = Math.max(gndCounter, 1);
  const pins: ArdPinSpec[] = [];
  const seq: Array<[string, string, string, string]> = [
    ['ard.reset', 'RST', '', 'Reset pin — not simulated.'],
    ['ard.3v3', '3V3', 'ard.3V3', '3.3 V regulated supply. Always on in the simulation.'],
    ['ard.5v', '5V', 'ard.5V', '5 V regulated supply. Always on in the simulation.'],
    ['ard.gnd1', 'GND', 'ard.GND', 'Arduino ground (0 V).'],
    ['ard.gnd2', 'GND', 'ard.GND', 'Arduino ground (0 V).'],
    ['ard.vin', 'VIN', '', 'External supply input — not simulated.'],
  ];
  seq.forEach(([id, label, netKey, desc], i) => {
    pins.push({ id, label, netKey, lx: -26 + i * PITCH, lz: POWER_Z, desc });
  });
  const analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
  analog.forEach((a, i) => {
    pins.push({
      id: `ard.${a.toLowerCase()}`,
      label: a,
      netKey: `ard.${a}`,
      lx: 4 + i * PITCH,
      lz: POWER_Z,
      desc: `Analog input ${a}. Reads 0–1023 for 0–5 V with the analog block.`,
    });
  });
  return pins;
}

export const ARD_PINS: ArdPinSpec[] = [...digitalStrip(), ...powerStrip()];

// -------------------------------------------------------------- snap registry

export class SnapRegistry {
  readonly byId = new Map<string, SnapPoint>();
  readonly all: SnapPoint[] = [];

  constructor() {
    this.buildBreadboard();
    this.buildArduino();
  }

  private add(sp: SnapPoint) {
    this.byId.set(sp.id, sp);
    this.all.push(sp);
  }

  private buildBreadboard() {
    for (let col = 1; col <= BB_COLS; col++) {
      for (const row of BB_ROWS) {
        const topHalf = BB_ROWS.indexOf(row) < 5;
        this.add({
          id: `bb.${row}${col}`,
          boardId: 'bb',
          netKey: topHalf ? `bb.t${col}` : `bb.b${col}`,
          pos: bbLocalToWorld(bbColX(col), bbRowZ(row)),
          label: `${row}${col}`,
          kind: 'bb-hole',
          desc: `Breadboard hole ${row}${col}. Rows ${topHalf ? 'a–e' : 'f–j'} of column ${col} are joined inside the board.`,
        });
      }
    }
    for (const rail of RAIL_ROWS) {
      for (let i = 1; i <= RAIL_HOLES; i++) {
        this.add({
          id: `bb.${rail.code}${i}`,
          boardId: 'bb',
          netKey: `bb.rail${rail.code}`,
          pos: bbLocalToWorld(railHoleX(i), rail.z),
          label: `${rail.side} ${rail.polarity} rail`,
          kind: 'bb-rail',
          desc: `Power rail (${rail.side}, ${rail.polarity}). Every hole in this stripe is joined along the full board.`,
        });
      }
    }
  }

  private buildArduino() {
    for (const p of ARD_PINS) {
      this.add({
        id: p.id,
        boardId: 'ard',
        netKey: p.netKey ? p.netKey : `inert.${p.id}`,
        pos: ardLocalToWorld(p.lx, p.lz),
        label: p.label,
        kind: 'ard-pin',
        desc: p.desc,
      });
    }
  }

  get(id: string): SnapPoint {
    const s = this.byId.get(id);
    if (!s) throw new Error(`unknown snap ${id}`);
    return s;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  netKeyOf(id: string): string {
    return this.get(id).netKey;
  }

  /** Nearest snap point within maxDist of a world position (same y plane ignored). */
  nearest(pos: Vec3, maxDist: number, filter?: (s: SnapPoint) => boolean): SnapPoint | null {
    let best: SnapPoint | null = null;
    let bestD = maxDist * maxDist;
    for (const s of this.all) {
      if (filter && !filter(s)) continue;
      const dx = s.pos.x - pos.x;
      const dz = s.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Parse a breadboard terminal hole id like bb.c12 -> {row, col}; null for rails / arduino. */
  parseHole(id: string): { row: BbRow; col: number } | null {
    const m = /^bb\.([a-j])(\d+)$/.exec(id);
    if (!m) return null;
    return { row: m[1] as BbRow, col: Number(m[2]) };
  }

  holeId(row: BbRow, col: number): string | null {
    if (col < 1 || col > BB_COLS) return null;
    return `bb.${row}${col}`;
  }
}

export const snaps = new SnapRegistry();
