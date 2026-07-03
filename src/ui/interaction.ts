import * as THREE from 'three';
import type { ComponentTypeId, SnapPoint } from '../types';
import { BB_ROWS, snaps, type BbRow } from '../core/boards';
import type { Circuit } from '../core/circuit';
import { defOf } from '../data/componentDefs';
import type { Selection, View } from '../three/view';

export type Mode =
  | { kind: 'select' }
  | { kind: 'wire'; from: SnapPoint | null; color: string }
  | { kind: 'place-two'; type: ComponentTypeId; first: SnapPoint | null }
  | { kind: 'place-footprint'; type: ComponentTypeId }
  | { kind: 'probe' }
  | { kind: 'meter' };

export interface InteractionDelegate {
  hover(snap: SnapPoint | null): void;
  modeChanged(mode: Mode): void;
  selectionChanged(sel: Selection): void;
  probeSet(snapId: string): void;
  meterSet(a: string | null, b: string | null): void;
  flash(msg: string): void;
}

const CLICK_DIST = 6; // px

export class Interaction {
  mode: Mode = { kind: 'select' };
  selection: Selection = null;
  wireColor = '#e03131';
  private meterA: string | null = null;
  private meterB: string | null = null;

  private downPos: { x: number; y: number } | null = null;
  private downObject: Selection = null;
  private pressingButton: string | null = null;
  private dragging: {
    compId: string;
    kind: 'footprint' | 'two-pin';
    grabCol: number;
    grabRow: BbRow;
    valid: Record<string, string> | null;
  } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private view: View,
    private circuit: Circuit,
    private delegate: InteractionDelegate,
  ) {
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => this.delegate.hover(null));
  }

  setMode(mode: Mode) {
    this.mode = mode;
    if (mode.kind !== 'wire') this.view.clearWirePreview();
    if (mode.kind !== 'place-footprint' && mode.kind !== 'place-two') this.view.clearGhost();
    this.delegate.modeChanged(mode);
  }

  cancel() {
    if (this.mode.kind === 'wire' && this.mode.from) {
      this.setMode({ kind: 'wire', from: null, color: this.wireColor });
      return;
    }
    if (this.mode.kind !== 'select') {
      this.setMode({ kind: 'select' });
      return;
    }
    this.setSelection(null);
  }

  setSelection(sel: Selection) {
    this.selection = sel;
    this.view.clearWireEmissive();
    this.view.setSelection(sel);
    this.delegate.selectionChanged(sel);
  }

  deleteSelection() {
    if (!this.selection) return;
    if (this.selection.kind === 'component') this.circuit.removeComponent(this.selection.id);
    else this.circuit.removeWire(this.selection.id);
    this.setSelection(null);
  }

  resetMeter() {
    this.meterA = this.meterB = null;
    this.view.setMeter(null, null);
    this.delegate.meterSet(null, null);
  }

  // ---------------------------------------------------------------- events

  private onMove(e: PointerEvent) {
    const snap = this.view.pickSnap(e, this.canvas);
    this.delegate.hover(snap);
    this.view.setHoverSnap(snap);

    this.maybeStartDrag(e);

    if (this.dragging) {
      this.updateDragGhost(snap);
      return;
    }

    switch (this.mode.kind) {
      case 'wire':
        if (this.mode.from) this.view.showWirePreview(this.mode.from, snap, this.mode.color);
        break;
      case 'place-two':
        if (this.mode.first && snap) {
          this.view.showWirePreview(this.mode.first, snap, '#8ce99a');
          const err = this.circuit.validTwoPin(this.mode.type, this.mode.first.id, snap.id);
          this.view.showGhost([
            { snap: this.mode.first, ok: true },
            { snap, ok: !err },
          ]);
        } else if (snap) {
          this.view.showGhost([{ snap, ok: this.circuit.isFree(snap.id) }]);
        } else {
          this.view.clearGhost();
        }
        break;
      case 'place-footprint':
        if (snap) this.showFootprintGhost(this.mode.type, snap);
        else this.view.clearGhost();
        break;
      default:
        break;
    }
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.downPos = { x: e.clientX, y: e.clientY };
    this.downObject = this.view.pickObject(e, this.canvas);

    if (this.mode.kind === 'select' && this.downObject?.kind === 'component') {
      const comp = this.circuit.components.get(this.downObject.id);
      if (comp?.type === 'button') {
        // hold-to-press
        this.pressingButton = comp.id;
        this.circuit.setProp(comp.id, 'pressed', true);
        this.canvas.setPointerCapture(e.pointerId);
        this.view.ctx.controls.enabled = false;
        this.setSelection({ kind: 'component', id: comp.id });
        return;
      }
    }
  }

  private onUp(e: PointerEvent) {
    const wasDown = this.downPos;
    this.downPos = null;
    const moved = wasDown ? Math.hypot(e.clientX - wasDown.x, e.clientY - wasDown.y) : 0;

    if (this.pressingButton) {
      this.circuit.setProp(this.pressingButton, 'pressed', false);
      this.pressingButton = null;
      this.view.ctx.controls.enabled = true;
      return;
    }

    if (this.dragging) {
      this.finishDrag();
      return;
    }

    // begin drag instead of click? — drags start in onMove; if we reach here
    // with large movement in select mode, it was a camera move.
    if (moved > CLICK_DIST) {
      this.downObject = null;
      return;
    }

    const snap = this.view.pickSnap(e, this.canvas);

    switch (this.mode.kind) {
      case 'select': {
        const obj = this.view.pickObject(e, this.canvas);
        if (obj) {
          if (obj.kind === 'component') {
            const comp = this.circuit.components.get(obj.id);
            if (comp?.type === 'switch') {
              this.circuit.setProp(comp.id, 'position', comp.props.position === 1 ? 0 : 1);
            }
          }
          this.setSelection(obj);
        } else if (!snap) {
          this.setSelection(null);
        }
        break;
      }
      case 'wire': {
        if (!snap) break;
        if (!this.circuit.isFree(snap.id)) {
          this.delegate.flash(`${snap.label} is already occupied — every hole holds one leg or wire end.`);
          break;
        }
        if (!this.mode.from) {
          this.setMode({ kind: 'wire', from: snap, color: this.wireColor });
        } else {
          const res = this.circuit.addWire(this.mode.from.id, snap.id, this.wireColor);
          if (typeof res === 'string') this.delegate.flash(res);
          this.view.clearWirePreview();
          this.setMode({ kind: 'wire', from: null, color: this.wireColor });
        }
        break;
      }
      case 'place-two': {
        if (!snap) break;
        if (!this.mode.first) {
          if (!this.circuit.isFree(snap.id)) {
            this.delegate.flash(`${snap.label} is occupied.`);
            break;
          }
          this.setMode({ kind: 'place-two', type: this.mode.type, first: snap });
        } else {
          const def = defOf(this.mode.type);
          const err = this.circuit.validTwoPin(this.mode.type, this.mode.first.id, snap.id);
          if (err) {
            this.delegate.flash(err);
            break;
          }
          const pins: Record<string, string> = {};
          pins[def.twoPin!.firstPin] = this.mode.first.id;
          pins[def.twoPin!.secondPin] = snap.id;
          const res = this.circuit.addComponent(this.mode.type, pins);
          this.view.clearWirePreview();
          this.view.clearGhost();
          if (typeof res === 'string') {
            this.delegate.flash(res);
          } else {
            this.setMode({ kind: 'select' });
            this.setSelection({ kind: 'component', id: res.id });
          }
        }
        break;
      }
      case 'place-footprint': {
        if (!snap) break;
        const pins = this.circuit.resolveFootprint(this.mode.type, snap.id);
        if (typeof pins === 'string') {
          this.delegate.flash(pins);
          break;
        }
        const res = this.circuit.addComponent(this.mode.type, pins);
        this.view.clearGhost();
        if (typeof res === 'string') {
          this.delegate.flash(res);
        } else {
          this.setMode({ kind: 'select' });
          this.setSelection({ kind: 'component', id: res.id });
        }
        break;
      }
      case 'probe': {
        if (snap) {
          this.view.setProbe(snap);
          this.delegate.probeSet(snap.id);
        }
        break;
      }
      case 'meter': {
        if (!snap) break;
        if (!this.meterA || (this.meterA && this.meterB)) {
          this.meterA = snap.id;
          this.meterB = null;
        } else {
          this.meterB = snap.id;
        }
        this.view.setMeter(this.meterA ? snaps.get(this.meterA) : null, this.meterB ? snaps.get(this.meterB) : null);
        this.delegate.meterSet(this.meterA, this.meterB);
        break;
      }
    }
    this.downObject = null;
  }

  // ------------------------------------------------------------- dragging

  /** called from onMove when select-mode pointer travels far enough */
  maybeStartDrag(e: PointerEvent) {
    if (this.mode.kind !== 'select' || !this.downPos || this.dragging || this.pressingButton) return;
    if (!this.downObject || this.downObject.kind !== 'component') return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    if (moved < CLICK_DIST) return;
    const comp = this.circuit.components.get(this.downObject.id);
    if (!comp) return;
    const def = defOf(comp.type);
    const snap = this.view.pickSnap(e, this.canvas, 8);
    const hole = snap ? snaps.parseHole(snap.id) : null;
    if (!hole) return;
    if (def.placement === 'two-pin') {
      const holes = Object.values(comp.pins).map((id) => snaps.parseHole(id));
      if (holes.some((h) => !h)) {
        this.delegate.flash('This part connects to a rail or the Arduino — delete and re-place it to move it.');
        this.downObject = null;
        return;
      }
    }
    this.view.ctx.controls.enabled = false;
    this.dragging = { compId: comp.id, kind: def.placement, grabCol: hole.col, grabRow: hole.row, valid: null };
  }

  private updateDragGhost(snap: SnapPoint | null) {
    if (!this.dragging) return;
    const comp = this.circuit.components.get(this.dragging.compId);
    if (!comp || !snap) {
      this.view.clearGhost();
      this.dragging.valid = null;
      return;
    }
    const hole = snaps.parseHole(snap.id);
    if (!hole) {
      this.view.clearGhost();
      this.dragging.valid = null;
      return;
    }
    const def = defOf(comp.type);
    const dCol = hole.col - this.dragging.grabCol;
    const dRow = BB_ROWS.indexOf(hole.row) - BB_ROWS.indexOf(this.dragging.grabRow);
    const target: Record<string, string> = {};
    let ok = true;
    for (const [pin, snapId] of Object.entries(comp.pins)) {
      const h = snaps.parseHole(snapId)!;
      let newRow: BbRow;
      if (def.placement === 'footprint' && def.footprint!.some((f) => f.row !== 'anchor')) {
        newRow = h.row; // DIPs stay on rows e/f
      } else {
        const idx = BB_ROWS.indexOf(h.row) + dRow;
        if (idx < 0 || idx >= BB_ROWS.length) {
          ok = false;
          break;
        }
        newRow = BB_ROWS[idx];
        // keep both halves: don't allow crossing the ravine implicitly for two-pin? allowed.
      }
      const id = snaps.holeId(newRow, h.col + dCol);
      if (!id) {
        ok = false;
        break;
      }
      const occ = this.circuit.occupantOf(id);
      if (occ && occ.owner !== comp.id) {
        ok = false;
      }
      target[pin] = id;
    }
    const ghostPts = Object.values(target)
      .filter((id) => snaps.has(id))
      .map((id) => ({ snap: snaps.get(id), ok }));
    if (ghostPts.length) this.view.showGhost(ghostPts);
    this.dragging.valid = ok && Object.keys(target).length === Object.keys(comp.pins).length ? target : null;
  }

  private finishDrag() {
    const d = this.dragging!;
    this.dragging = null;
    this.view.clearGhost();
    this.view.ctx.controls.enabled = true;
    if (d.valid) {
      const moved = this.circuit.moveComponent(d.compId, d.valid);
      if (moved) this.setSelection({ kind: 'component', id: d.compId });
    }
    this.downObject = null;
  }

  private showFootprintGhost(type: ComponentTypeId, snap: SnapPoint) {
    const pins = this.circuit.resolveFootprint(type, snap.id);
    if (typeof pins === 'string') {
      const hole = snaps.parseHole(snap.id);
      this.view.showGhost([{ snap, ok: false }]);
      void hole;
      return;
    }
    const pts = Object.values(pins).map((id) => ({ snap: snaps.get(id), ok: true }));
    const xs = pts.map((p) => p.snap.pos.x);
    const zs = pts.map((p) => p.snap.pos.z);
    const center = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, pts[0].snap.pos.y + 2.5, (Math.min(...zs) + Math.max(...zs)) / 2);
    const size = new THREE.Vector3(Math.max(...xs) - Math.min(...xs) + 4, 4, Math.max(...zs) - Math.min(...zs) + 5);
    this.view.showGhost(pts, { center, size });
  }
}
