import type { ComponentInstance, ComponentTypeId, ProjectData, Wire } from '../types';
import { componentDefs, defOf } from '../data/componentDefs';
import { snaps, type BbRow, BB_ROWS } from './boards';

export interface Occupant {
  kind: 'pin' | 'wire';
  owner: string; // component or wire id
  pin?: string;
}

export type CircuitEvent = 'topology' | 'props';

/**
 * Holds the placed components and wires and enforces breadboard rules:
 * every snap point (hole / socket) can hold at most one leg or wire end.
 */
export class Circuit {
  components = new Map<string, ComponentInstance>();
  wires = new Map<string, Wire>();
  occupancy = new Map<string, Occupant>();
  private nextId = 1;
  private listeners = new Map<CircuitEvent, Set<() => void>>();

  on(ev: CircuitEvent, fn: () => void) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
  }

  emit(ev: CircuitEvent) {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  genId(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  isFree(snapId: string): boolean {
    return snaps.has(snapId) && !this.occupancy.has(snapId);
  }

  occupantOf(snapId: string): Occupant | undefined {
    return this.occupancy.get(snapId);
  }

  /**
   * Resolve a footprint placement from an anchor hole. Returns pin->snapId or
   * an error string. Footprint parts must sit on breadboard terminal holes.
   */
  resolveFootprint(type: ComponentTypeId, anchorSnapId: string, ignoreComponent?: string): Record<string, string> | string {
    const def = defOf(type);
    if (!def.footprint) return 'not a footprint part';
    const hole = snaps.parseHole(anchorSnapId);
    if (!hole) return 'Place this part on the breadboard grid (rows a–j), not on a rail or the Arduino.';
    const pins: Record<string, string> = {};
    for (const fp of def.footprint) {
      let row: BbRow;
      if (fp.row === 'anchor') row = hole.row;
      else row = fp.row;
      const col = hole.col + fp.dCol;
      const id = snaps.holeId(row, col);
      if (!id) return 'Part would hang off the edge of the breadboard.';
      const occ = this.occupancy.get(id);
      if (occ && occ.owner !== ignoreComponent) return `Hole ${row}${col} is already used.`;
      pins[fp.name] = id;
    }
    return pins;
  }

  validTwoPin(type: ComponentTypeId, aSnap: string, bSnap: string): string | null {
    const def = defOf(type);
    if (!def.twoPin) return 'not a two-pin part';
    if (aSnap === bSnap) return 'Both legs cannot share one hole.';
    if (!this.isFree(aSnap) || !this.isFree(bSnap)) return 'One of those holes is already used.';
    const a = snaps.get(aSnap).pos;
    const b = snaps.get(bSnap).pos;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > def.twoPin.maxSpan) return `Legs too far apart for this part (max ${def.twoPin.maxSpan} mm).`;
    const sameNet = snaps.netKeyOf(aSnap) === snaps.netKeyOf(bSnap);
    if (sameNet) return 'Both legs are in the same connected strip — the part would be shorted out.';
    return null;
  }

  addComponent(type: ComponentTypeId, pins: Record<string, string>, props?: Record<string, number | string | boolean>): ComponentInstance | string {
    for (const snapId of Object.values(pins)) {
      if (!snaps.has(snapId)) return `unknown snap ${snapId}`;
      if (this.occupancy.has(snapId)) return `snap ${snapId} occupied`;
    }
    const def = defOf(type);
    const comp: ComponentInstance = {
      id: this.genId('c'),
      type,
      pins: { ...pins },
      props: { ...def.defaultProps, ...(props ?? {}) },
    };
    this.components.set(comp.id, comp);
    for (const [pin, snapId] of Object.entries(comp.pins)) {
      this.occupancy.set(snapId, { kind: 'pin', owner: comp.id, pin });
    }
    this.emit('topology');
    return comp;
  }

  removeComponent(id: string) {
    const comp = this.components.get(id);
    if (!comp) return;
    for (const snapId of Object.values(comp.pins)) this.occupancy.delete(snapId);
    this.components.delete(id);
    this.emit('topology');
  }

  /** Re-anchor a component to new pin assignments (used by drag-move). */
  moveComponent(id: string, pins: Record<string, string>): boolean {
    const comp = this.components.get(id);
    if (!comp) return false;
    for (const snapId of Object.values(pins)) {
      const occ = this.occupancy.get(snapId);
      if (occ && occ.owner !== id) return false;
    }
    for (const snapId of Object.values(comp.pins)) this.occupancy.delete(snapId);
    comp.pins = { ...pins };
    for (const [pin, snapId] of Object.entries(comp.pins)) {
      this.occupancy.set(snapId, { kind: 'pin', owner: comp.id, pin });
    }
    this.emit('topology');
    return true;
  }

  addWire(aSnap: string, bSnap: string, color: string): Wire | string {
    if (!snaps.has(aSnap) || !snaps.has(bSnap)) return 'unknown snap point';
    if (aSnap === bSnap) return 'Wire must connect two different points.';
    if (this.occupancy.has(aSnap)) return `${snaps.get(aSnap).label} is already used.`;
    if (this.occupancy.has(bSnap)) return `${snaps.get(bSnap).label} is already used.`;
    const wire: Wire = { id: this.genId('w'), a: aSnap, b: bSnap, color };
    this.wires.set(wire.id, wire);
    this.occupancy.set(aSnap, { kind: 'wire', owner: wire.id });
    this.occupancy.set(bSnap, { kind: 'wire', owner: wire.id });
    this.emit('topology');
    return wire;
  }

  removeWire(id: string) {
    const w = this.wires.get(id);
    if (!w) return;
    this.occupancy.delete(w.a);
    this.occupancy.delete(w.b);
    this.wires.delete(id);
    this.emit('topology');
  }

  setProp(id: string, key: string, value: number | string | boolean) {
    const comp = this.components.get(id);
    if (!comp) return;
    comp.props[key] = value;
    // Switch / button state changes connectivity, not just looks.
    if (key === 'pressed' || key === 'position') this.emit('topology');
    else this.emit('props');
  }

  clear() {
    this.components.clear();
    this.wires.clear();
    this.occupancy.clear();
    this.emit('topology');
  }

  serialize(): Pick<ProjectData, 'components' | 'wires'> {
    return {
      components: [...this.components.values()].map((c) => ({ ...c, pins: { ...c.pins }, props: { ...c.props } })),
      wires: [...this.wires.values()].map((w) => ({ ...w })),
    };
  }

  /** Load from serialized data. Invalid entries are skipped and reported. */
  load(data: Pick<ProjectData, 'components' | 'wires'>): string[] {
    const problems: string[] = [];
    this.components.clear();
    this.wires.clear();
    this.occupancy.clear();
    let maxNum = 0;
    for (const c of data.components ?? []) {
      if (!c || typeof c.id !== 'string' || !componentDefs.has(c.type)) {
        problems.push(`Skipped component ${c?.id ?? '?'}: unknown type "${c?.type}".`);
        continue;
      }
      if (this.components.has(c.id)) {
        problems.push(`Skipped component ${c.id}: duplicate id.`);
        continue;
      }
      let ok = c.pins !== null && typeof c.pins === 'object';
      for (const snapId of Object.values(c.pins ?? {})) {
        if (typeof snapId !== 'string' || !snaps.has(snapId) || this.occupancy.has(snapId)) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        problems.push(`Skipped component ${c.id} (${c.type}): invalid or occupied holes.`);
        continue;
      }
      const def = defOf(c.type);
      const comp: ComponentInstance = { id: c.id, type: c.type, pins: { ...c.pins }, props: { ...def.defaultProps, ...c.props } };
      this.components.set(comp.id, comp);
      for (const [pin, snapId] of Object.entries(comp.pins)) {
        this.occupancy.set(snapId, { kind: 'pin', owner: comp.id, pin });
      }
      maxNum = Math.max(maxNum, num(c.id));
    }
    for (const w of data.wires ?? []) {
      if (!w || typeof w.id !== 'string' || typeof w.a !== 'string' || typeof w.b !== 'string' || this.wires.has(w.id)) {
        problems.push(`Skipped wire ${w?.id ?? '?'}: malformed or duplicate.`);
        continue;
      }
      if (!snaps.has(w.a) || !snaps.has(w.b) || this.occupancy.has(w.a) || this.occupancy.has(w.b)) {
        problems.push(`Skipped wire ${w.id}: invalid or occupied endpoints.`);
        continue;
      }
      const wire: Wire = { id: w.id, a: w.a, b: w.b, color: w.color || '#d33' };
      this.wires.set(wire.id, wire);
      this.occupancy.set(wire.a, { kind: 'wire', owner: wire.id });
      this.occupancy.set(wire.b, { kind: 'wire', owner: wire.id });
      maxNum = Math.max(maxNum, num(w.id));
    }
    this.nextId = maxNum + 1;
    this.emit('topology');
    return problems;
  }

  /** All snap ids in a breadboard column half, e.g. free holes of net bb.t12. */
  freeHolesOfNet(netKey: string): string[] {
    const out: string[] = [];
    const m = /^bb\.([tb])(\d+)$/.exec(netKey);
    if (m) {
      const rows = m[1] === 't' ? BB_ROWS.slice(0, 5) : BB_ROWS.slice(5);
      for (const r of rows) {
        const id = `bb.${r}${m[2]}`;
        if (this.isFree(id)) out.push(id);
      }
    }
    return out;
  }
}

function num(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}
