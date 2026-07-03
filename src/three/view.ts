import * as THREE from 'three';
import type { SnapPoint } from '../types';
import { ARD_PIN_Y, BB_TOP_Y, snaps } from '../core/boards';
import type { Circuit } from '../core/circuit';
import type { Simulation } from '../core/simulation';
import { buildArduino, buildBreadboard, type ArduinoRefs } from './boardsMesh';
import { buildComponent, type CompVisual } from './componentMeshes';
import { buildWire, wireCurve, type WireVisual } from './wiresMesh';
import { createScene, type SceneCtx } from './scene';

export type Selection = { kind: 'component' | 'wire'; id: string } | null;

export class View {
  ctx: SceneCtx;
  private compVisuals = new Map<string, CompVisual>();
  private wireVisuals = new Map<string, WireVisual>();
  private compRoot = new THREE.Group();
  private wireRoot = new THREE.Group();
  private overlayRoot = new THREE.Group();
  private arduino: ArduinoRefs;
  private raycaster = new THREE.Raycaster();
  private bbPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BB_TOP_Y);
  private ardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ARD_PIN_Y);

  private hoverRing: THREE.Mesh;
  private selRings = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private wirePreview: THREE.Mesh | null = null;
  private probeMarker: THREE.Group;
  private meterMarkerA: THREE.Group;
  private meterMarkerB: THREE.Group;
  private highlightMarkers = new THREE.Group();
  private clock = 0;

  constructor(canvas: HTMLCanvasElement, private circuit: Circuit) {
    this.ctx = createScene(canvas);
    this.ctx.scene.add(buildBreadboard());
    this.arduino = buildArduino();
    this.ctx.scene.add(this.arduino.group);
    this.ctx.scene.add(this.compRoot, this.wireRoot, this.overlayRoot);

    this.hoverRing = ring('#39d5ff', 1.35, 0.28);
    this.hoverRing.visible = false;
    this.overlayRoot.add(this.hoverRing, this.selRings, this.ghostGroup, this.highlightMarkers);

    this.probeMarker = flag('#ffd43b');
    this.meterMarkerA = flag('#ff6b6b');
    this.meterMarkerB = flag('#495057');
    this.probeMarker.visible = this.meterMarkerA.visible = this.meterMarkerB.visible = false;
    this.overlayRoot.add(this.probeMarker, this.meterMarkerA, this.meterMarkerB);

    circuit.on('topology', () => this.syncCircuit());
    this.syncCircuit();
  }

  // ------------------------------------------------------------- circuit sync

  syncCircuit() {
    // full rebuild — topology changes are rare and component counts small
    for (const v of this.compVisuals.values()) this.compRoot.remove(v.group);
    for (const v of this.wireVisuals.values()) this.wireRoot.remove(v.group);
    disposeGroup(this.compRoot);
    disposeGroup(this.wireRoot);
    this.compVisuals.clear();
    this.wireVisuals.clear();
    for (const comp of this.circuit.components.values()) {
      const vis = buildComponent(comp);
      vis.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
      });
      this.compVisuals.set(comp.id, vis);
      this.compRoot.add(vis.group);
    }
    for (const wire of this.circuit.wires.values()) {
      const vis = buildWire(wire);
      this.wireVisuals.set(wire.id, vis);
      this.wireRoot.add(vis.group);
    }
  }

  // ------------------------------------------------------------------ frame

  update(sim: Simulation, dt: number) {
    this.clock += dt;
    for (const [id, vis] of this.compVisuals) {
      const comp = this.circuit.components.get(id);
      if (comp) vis.update(sim, comp);
    }
    // Arduino on-board LEDs
    const d13 = sim.readingOfKey('ard.D13');
    this.arduino.ledL.emissiveIntensity = Number.isFinite(d13.volts) && d13.volts > 2.5 ? 2.2 : 0;
    // pulsing debug highlights
    this.highlightMarkers.clear();
    for (const key of sim.highlightedPins) {
      const m = /^ard\.D(\d+)$/.exec(key);
      if (!m) continue;
      const snapId = `ard.d${m[1]}`;
      if (!snaps.has(snapId)) continue;
      const p = snaps.get(snapId).pos;
      const r = ring('#ff8787', 2 + Math.sin(this.clock * 6) * 0.5, 0.3);
      r.position.set(p.x, p.y + 0.4, p.z);
      this.highlightMarkers.add(r);
    }
    this.ctx.controls.update();
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  // ----------------------------------------------------------------- picking

  private ndc(ev: PointerEvent | MouseEvent, canvas: HTMLCanvasElement): THREE.Vector2 {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  }

  pickSnap(ev: PointerEvent | MouseEvent, canvas: HTMLCanvasElement, maxDist = 1.7): SnapPoint | null {
    this.raycaster.setFromCamera(this.ndc(ev, canvas), this.ctx.camera);
    const hits: Array<{ point: THREE.Vector3; board: 'bb' | 'ard' }> = [];
    const p1 = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.bbPlane, p1)) hits.push({ point: p1.clone(), board: 'bb' });
    const p2 = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.ardPlane, p2)) hits.push({ point: p2.clone(), board: 'ard' });
    let best: SnapPoint | null = null;
    let bestD = Infinity;
    for (const h of hits) {
      const s = snaps.nearest({ x: h.point.x, y: h.point.y, z: h.point.z }, maxDist, (sp) => sp.boardId === h.board);
      if (s) {
        const d = Math.hypot(s.pos.x - h.point.x, s.pos.z - h.point.z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    return best;
  }

  pickObject(ev: PointerEvent | MouseEvent, canvas: HTMLCanvasElement): Selection {
    this.raycaster.setFromCamera(this.ndc(ev, canvas), this.ctx.camera);
    const hits = this.raycaster.intersectObjects([this.compRoot, this.wireRoot], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.componentId) return { kind: 'component', id: o.userData.componentId };
        if (o.userData.wireId) return { kind: 'wire', id: o.userData.wireId };
        o = o.parent;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- indicators

  setHoverSnap(snap: SnapPoint | null) {
    if (!snap) {
      this.hoverRing.visible = false;
      return;
    }
    this.hoverRing.visible = true;
    this.hoverRing.position.set(snap.pos.x, snap.pos.y + 0.25, snap.pos.z);
  }

  setSelection(sel: Selection) {
    this.selRings.clear();
    if (!sel) return;
    const points: Array<{ x: number; y: number; z: number }> = [];
    if (sel.kind === 'component') {
      const comp = this.circuit.components.get(sel.id);
      if (!comp) return;
      for (const s of Object.values(comp.pins)) points.push(snaps.get(s).pos);
    } else {
      const w = this.circuit.wires.get(sel.id);
      if (!w) return;
      points.push(snaps.get(w.a).pos, snaps.get(w.b).pos);
      const vis = this.wireVisuals.get(sel.id);
      if (vis) vis.mat.emissive.set('#664400');
    }
    for (const p of points) {
      const r = ring('#ffb724', 1.5, 0.3);
      r.position.set(p.x, p.y + 0.3, p.z);
      this.selRings.add(r);
    }
  }

  clearWireEmissive() {
    for (const v of this.wireVisuals.values()) v.mat.emissive.set('#000000');
  }

  /** ghost rings while placing: green ok / red blocked */
  showGhost(points: Array<{ snap: SnapPoint; ok: boolean }>, bodyHint?: { center: THREE.Vector3; size: THREE.Vector3 }) {
    this.ghostGroup.clear();
    for (const { snap, ok } of points) {
      const r = ring(ok ? '#51cf66' : '#ff6b6b', 1.4, 0.32);
      r.position.set(snap.pos.x, snap.pos.y + 0.3, snap.pos.z);
      this.ghostGroup.add(r);
    }
    if (bodyHint) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(bodyHint.size.x, bodyHint.size.y, bodyHint.size.z),
        new THREE.MeshBasicMaterial({ color: '#8ce99a', transparent: true, opacity: 0.25, depthWrite: false }),
      );
      box.position.copy(bodyHint.center);
      this.ghostGroup.add(box);
    }
  }

  clearGhost() {
    this.ghostGroup.clear();
  }

  showWirePreview(fromSnap: SnapPoint, toSnap: SnapPoint | null, color: string) {
    this.clearWirePreview();
    if (!toSnap || toSnap.id === fromSnap.id) return;
    const curve = wireCurve(fromSnap.id, toSnap.id, 'preview');
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
    this.wirePreview = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.62, 8), mat);
    this.overlayRoot.add(this.wirePreview);
  }

  clearWirePreview() {
    if (this.wirePreview) {
      this.overlayRoot.remove(this.wirePreview);
      this.wirePreview.geometry.dispose();
      (this.wirePreview.material as THREE.Material).dispose();
      this.wirePreview = null;
    }
  }

  setProbe(snap: SnapPoint | null) {
    this.probeMarker.visible = !!snap;
    if (snap) this.probeMarker.position.set(snap.pos.x, snap.pos.y, snap.pos.z);
  }

  setMeter(a: SnapPoint | null, b: SnapPoint | null) {
    this.meterMarkerA.visible = !!a;
    if (a) this.meterMarkerA.position.set(a.pos.x, a.pos.y, a.pos.z);
    this.meterMarkerB.visible = !!b;
    if (b) this.meterMarkerB.position.set(b.pos.x, b.pos.y, b.pos.z);
  }

  resize() {
    this.ctx.resize();
  }
}

function ring(color: string, radius: number, tube: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function flag(color: string): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 14, 8), new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.6, roughness: 0.4 }));
  pole.position.y = 7;
  g.add(pole);
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.4, 12), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  head.rotation.x = Math.PI;
  head.position.y = 13.2;
  g.add(head);
  const r = ring(color, 1.5, 0.3);
  r.position.y = 0.3;
  g.add(r);
  return g;
}

function disposeGroup(root: THREE.Group) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
    }
  });
  root.clear();
}
