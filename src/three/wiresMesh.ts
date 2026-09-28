import * as THREE from 'three';
import type { Wire } from '../types';
import { snaps } from '../core/boards';

export interface WireVisual {
  group: THREE.Group;
  mat: THREE.MeshStandardMaterial;
}

const TIP_MAT = new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.85, roughness: 0.3 });
TIP_MAT.userData.shared = true;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0) / 0xffffffff;
}

export function wireCurve(aId: string, bId: string, seed: string): THREE.CatmullRomCurve3 {
  const a = snaps.get(aId).pos;
  const b = snaps.get(bId).pos;
  const va = new THREE.Vector3(a.x, a.y, a.z);
  const vb = new THREE.Vector3(b.x, b.y, b.z);
  const dist = va.distanceTo(vb);
  const arc = Math.min(30, Math.max(7, dist * 0.32)) + hash(seed) * 3;
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  mid.y = Math.max(va.y, vb.y) + arc;
  // slight sideways bow so parallel wires don't z-fight
  const dir = vb.clone().sub(va).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((hash(seed + 'x') - 0.5) * Math.min(8, dist * 0.18));
  mid.add(side);
  const lift = 2.2;
  return new THREE.CatmullRomCurve3([va, va.clone().setY(va.y + lift), mid, vb.clone().setY(vb.y + lift), vb], false, 'catmullrom', 0.6);
}

export function buildWire(wire: Wire): WireVisual {
  const group = new THREE.Group();
  const curve = wireCurve(wire.a, wire.b, wire.id);
  const mat = new THREE.MeshStandardMaterial({ color: wire.color, roughness: 0.42, metalness: 0 });
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.62, 8), mat);
  tube.castShadow = true;
  group.add(tube);
  for (const id of [wire.a, wire.b]) {
    const p = snaps.get(id).pos;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.2, 8), TIP_MAT);
    tip.position.set(p.x, p.y + 0.6, p.z);
    group.add(tip);
  }
  group.userData.wireId = wire.id;
  group.traverse((o) => {
    o.userData.wireId = wire.id;
  });
  return { group, mat };
}
