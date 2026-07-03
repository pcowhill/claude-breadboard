import * as THREE from 'three';
import type { ComponentInstance, Vec3 } from '../types';
import { snaps } from '../core/boards';
import type { Simulation } from '../core/simulation';

// Procedural component meshes (documented as fallback assets in ASSETS.md).
// Each builder returns a group plus an update() that animates the part from
// live simulation state (LED brightness, button travel, knob angle, …).

export interface CompVisual {
  group: THREE.Group;
  update(sim: Simulation, comp: ComponentInstance): void;
}

const LEAD_MAT = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.9, roughness: 0.35 });
const DARK_PLASTIC = new THREE.MeshStandardMaterial({ color: '#1a1b20', roughness: 0.8 });
const IC_PLASTIC = new THREE.MeshStandardMaterial({ color: '#17181c', roughness: 0.65 });

const LED_COLORS: Record<string, { body: string; emissive: string }> = {
  red: { body: '#ff5548', emissive: '#ff2a1a' },
  green: { body: '#4dff70', emissive: '#19ff4d' },
  yellow: { body: '#ffe14d', emissive: '#ffd11a' },
  blue: { body: '#5f8dff', emissive: '#2a6bff' },
  white: { body: '#f2f6ff', emissive: '#eef4ff' },
};

let glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function v3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function pinPos(comp: ComponentInstance, pin: string): THREE.Vector3 {
  return v3(snaps.get(comp.pins[pin]).pos);
}

/** curved lead from a hole up into a body attachment point */
function lead(from: THREE.Vector3, to: THREE.Vector3, radius = 0.34): THREE.Mesh {
  const mid = from.clone().lerp(to, 0.5);
  mid.y = Math.max(from.y, to.y) + 1.2;
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const geo = new THREE.TubeGeometry(curve, 10, radius, 6);
  const m = new THREE.Mesh(geo, LEAD_MAT);
  m.castShadow = true;
  return m;
}

function straightLead(from: THREE.Vector3, to: THREE.Vector3, radius = 0.34): THREE.Mesh {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  const m = new THREE.Mesh(geo, LEAD_MAT);
  m.position.copy(from.clone().add(to).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------- LED

function buildLed(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const pA = pinPos(comp, 'anode');
  const pK = pinPos(comp, 'cathode');
  const mid = pA.clone().add(pK).multiplyScalar(0.5);
  const colors = LED_COLORS[String(comp.props.color)] ?? LED_COLORS.red;
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: colors.body,
    roughness: 0.25,
    transmission: 0.35,
    transparent: true,
    opacity: 0.92,
    emissive: colors.emissive,
    emissiveIntensity: 0,
  });
  const bodyY = mid.y + 5.4;
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 2.6, 20), bodyMat);
  cyl.position.set(mid.x, bodyY, mid.z);
  cyl.castShadow = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
  dome.position.set(mid.x, bodyY + 1.3, mid.z);
  group.add(cyl, dome);

  const axis = pK.clone().sub(pA).normalize();
  const aAttach = mid.clone().addScaledVector(axis, -0.63);
  aAttach.y = bodyY - 1.3;
  const kAttach = mid.clone().addScaledVector(axis, 0.63);
  kAttach.y = bodyY - 1.3;
  group.add(lead(pA, aAttach), lead(pK, kAttach));

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: getGlowTexture(), color: colors.emissive, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sprite.position.set(mid.x, bodyY + 1.2, mid.z);
  sprite.scale.setScalar(0.001);
  group.add(sprite);

  return {
    group,
    update(sim) {
      const level = sim.ledLevels.get(comp.id) ?? 0;
      bodyMat.emissiveIntensity = level * 2.6;
      sprite.material.opacity = level * 0.85;
      const s = 4 + level * 14;
      sprite.scale.setScalar(level > 0.01 ? s : 0.001);
    },
  };
}

// --------------------------------------------------------------- resistor

const BAND_COLORS = ['#161616', '#7b4a21', '#d13a2c', '#e2772b', '#e5c02e', '#3f9e42', '#3358c4', '#8e44ad', '#8a8a8a', '#f4f4f4'];

function bandColorsFor(ohms: number): string[] {
  let o = Math.max(1, Math.round(ohms));
  let mult = 0;
  while (o >= 100) {
    o = Math.round(o / 10);
    mult++;
  }
  const d1 = Math.floor(o / 10);
  const d2 = o % 10;
  return [BAND_COLORS[d1], BAND_COLORS[d2], BAND_COLORS[Math.min(9, mult)], '#c9a227'];
}

function buildResistor(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const p1 = pinPos(comp, 'p1');
  const p2 = pinPos(comp, 'p2');
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  const dist = p1.distanceTo(p2);
  const bodyLen = Math.min(8.5, Math.max(5.5, dist * 0.5));
  const h = 3.4;
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#dbc394', roughness: 0.6 });
  const axis = p2.clone().sub(p1);
  axis.y = 0;
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
  axis.normalize();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, bodyLen - 2.5, 6, 12), bodyMat);
  body.position.set(mid.x, mid.y + h, mid.z);
  body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  body.castShadow = true;
  group.add(body);

  const bands = bandColorsFor(Number(comp.props.ohms) || 330);
  const fr = [-0.3, -0.12, 0.06, 0.3];
  bands.forEach((col, i) => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.32, 0.55, 14), new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }));
    band.position.copy(body.position).addScaledVector(axis, fr[i] * bodyLen);
    band.quaternion.copy(body.quaternion);
    group.add(band);
  });

  const end1 = body.position.clone().addScaledVector(axis, -bodyLen / 2);
  const end2 = body.position.clone().addScaledVector(axis, bodyLen / 2);
  group.add(lead(p1, end1), lead(p2, end2));

  return { group, update() {} };
}

// -------------------------------------------------------------- capacitor

function buildCapacitor(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const pP = pinPos(comp, 'plus');
  const pM = pinPos(comp, 'minus');
  const mid = pP.clone().add(pM).multiplyScalar(0.5);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 7, 18),
    new THREE.MeshStandardMaterial({ color: '#1f2f66', roughness: 0.5 }),
  );
  body.position.set(mid.x, mid.y + 5.5, mid.z);
  body.castShadow = true;
  group.add(body);
  // minus stripe on the minus-pin side
  const toMinus = pM.clone().sub(mid).normalize();
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 1.2), new THREE.MeshStandardMaterial({ color: '#dfe6f2', roughness: 0.6 }));
  stripe.position.copy(body.position).addScaledVector(toMinus, 2.15);
  stripe.lookAt(body.position.clone().setY(stripe.position.y));
  group.add(stripe);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.42, 2.42, 0.3, 18), new THREE.MeshStandardMaterial({ color: '#c9ccd4', metalness: 0.8, roughness: 0.4 }));
  top.position.copy(body.position).setY(body.position.y + 3.6);
  group.add(top);

  const a1 = body.position.clone().addScaledVector(toMinus, -1.2).setY(mid.y + 2.2);
  const a2 = body.position.clone().addScaledVector(toMinus, 1.2).setY(mid.y + 2.2);
  group.add(lead(pP, a1), lead(pM, a2));
  return { group, update() {} };
}

// ----------------------------------------------------------------- button

function buildButton(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const corners = ['a1', 'a2', 'b1', 'b2'].map((p) => pinPos(comp, p));
  const mid = corners.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(0.25);
  const base = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 6.4), DARK_PLASTIC);
  base.position.set(mid.x, mid.y + 1.6, mid.z);
  base.castShadow = true;
  group.add(base);
  const capMat = new THREE.MeshStandardMaterial({ color: '#c23a2f', roughness: 0.5 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 1.8, 18), capMat);
  const capUpY = mid.y + 3.2 + 0.9;
  cap.position.set(mid.x, capUpY, mid.z);
  cap.castShadow = true;
  group.add(cap);
  for (const c of corners) {
    const attach = new THREE.Vector3(
      base.position.x + Math.sign(c.x - mid.x) * 3.1,
      mid.y + 1.2,
      base.position.z + Math.sign(c.z - mid.z) * 3.1,
    );
    group.add(lead(c, attach, 0.3));
  }
  return {
    group,
    update(_sim, c) {
      cap.position.y = c.props.pressed ? capUpY - 0.9 : capUpY;
    },
  };
}

// ----------------------------------------------------------------- switch

function buildSwitch(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const p1 = pinPos(comp, 't1');
  const pc = pinPos(comp, 'com');
  const p2 = pinPos(comp, 't2');
  const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, 3.6, 3.8), new THREE.MeshStandardMaterial({ color: '#3d4654', roughness: 0.6 }));
  body.position.set(pc.x, pc.y + 1.8, pc.z);
  body.castShadow = true;
  group.add(body);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 2.2), new THREE.MeshStandardMaterial({ color: '#dde3ea', roughness: 0.4 }));
  lever.position.set(pc.x, pc.y + 4.4, pc.z);
  lever.castShadow = true;
  group.add(lever);
  const axis = p2.clone().sub(p1).normalize();
  for (const p of [p1, pc, p2]) {
    group.add(straightLead(p, p.clone().setY(pc.y + 0.4), 0.3));
  }
  return {
    group,
    update(_sim, c) {
      const off = c.props.position === 1 ? 2.4 : -2.4;
      lever.position.set(pc.x + axis.x * off, pc.y + 4.4, pc.z + axis.z * off);
    },
  };
}

// ------------------------------------------------------------------- pot

function buildPot(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const pc = pinPos(comp, 'wiper');
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.6, 5, 9.6), new THREE.MeshStandardMaterial({ color: '#2b6cb0', roughness: 0.55 }));
  body.position.set(pc.x, pc.y + 2.5, pc.z - 2.2);
  body.castShadow = true;
  group.add(body);
  const knob = new THREE.Group();
  const knobBody = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 1.6, 22), new THREE.MeshStandardMaterial({ color: '#e8e2d5', roughness: 0.5 }));
  knob.add(knobBody);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 2.7), new THREE.MeshStandardMaterial({ color: '#333' }));
  marker.position.set(0, 0.9, -1.4);
  knob.add(marker);
  knob.position.set(pc.x, pc.y + 5.8, pc.z - 2.2);
  group.add(knob);
  for (const p of ['end1', 'wiper', 'end2']) {
    const hole = pinPos(comp, p);
    group.add(lead(hole, hole.clone().setY(pc.y + 1.4).add(new THREE.Vector3(0, 0, -1.2)), 0.3));
  }
  return {
    group,
    update(_sim, c) {
      const t = Number(c.props.t);
      knob.rotation.y = (0.5 - t) * 4.7;
    },
  };
}

// -------------------------------------------------------------------- ICs

const IC_LABELS: Record<string, string> = {
  ic555: 'NE555P',
  ic74hc00: '74HC00',
  ic74hc04: '74HC04',
  ic74hc595: '74HC595',
};

function buildIc(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const positions = Object.values(comp.pins).map((s) => v3(snaps.get(s).pos));
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x));
  const midZ = positions.reduce((a, p) => a + p.z, 0) / positions.length;
  const topY = positions[0].y;
  const len = maxX - minX + 3.2;
  const cx = (minX + maxX) / 2;

  const body = new THREE.Mesh(new THREE.BoxGeometry(len, 3.2, 6.6), IC_PLASTIC);
  body.position.set(cx, topY + 2.6, midZ);
  body.castShadow = true;
  group.add(body);

  // label texture
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#17181c';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#cfd3da';
  g.font = 'bold 30px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(IC_LABELS[comp.type] ?? comp.type, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(len - 1.2, 4.6), new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
  label.rotation.x = -Math.PI / 2;
  label.rotation.z = 0;
  label.position.set(cx, topY + 4.22, midZ);
  group.add(label);

  // notch at pin-1 end (left) + pin 1 dot
  const notch = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, 0.7, 16, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: 0.8 }),
  );
  notch.rotation.z = Math.PI / 2;
  notch.rotation.y = Math.PI / 2;
  notch.position.set(cx - len / 2 + 0.05, topY + 4.0, midZ);
  group.add(notch);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshStandardMaterial({ color: '#d5d8dd', roughness: 0.6 }));
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(minX + 0.4, topY + 4.22, midZ + 2.2);
  group.add(dot);

  // legs
  for (const p of positions) {
    const legTop = new THREE.Vector3(p.x, topY + 2.2, midZ + Math.sign(p.z - midZ) * 3.2);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.6), LEAD_MAT);
    shoulder.position.set(p.x, topY + 1.6, (p.z + legTop.z) / 2);
    group.add(shoulder);
    group.add(straightLead(p, new THREE.Vector3(p.x, topY + 1.4, p.z), 0.32));
  }

  return { group, update() {} };
}

// ---------------------------------------------------------------- 7-seg

const SEG_LAYOUT: Array<{ x: number; z: number; horiz: boolean }> = [
  { x: 0, z: -5.4, horiz: true }, // a
  { x: 2.7, z: -2.7, horiz: false }, // b
  { x: 2.7, z: 2.7, horiz: false }, // c
  { x: 0, z: 5.4, horiz: true }, // d
  { x: -2.7, z: 2.7, horiz: false }, // e
  { x: -2.7, z: -2.7, horiz: false }, // f
  { x: 0, z: 0, horiz: true }, // g
];

function buildSevenSeg(comp: ComponentInstance): CompVisual {
  const group = new THREE.Group();
  const positions = Object.values(comp.pins).map((s) => v3(snaps.get(s).pos));
  const minX = Math.min(...positions.map((p) => p.x));
  const maxX = Math.max(...positions.map((p) => p.x));
  const midZ = positions.reduce((a, p) => a + p.z, 0) / positions.length;
  const topY = positions[0].y;
  const cx = (minX + maxX) / 2;
  const W = maxX - minX + 3.6;
  const D = 19;
  const H = 7.5;

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: '#23252b', roughness: 0.7 }));
  body.position.set(cx, topY + H / 2 + 1.2, midZ);
  body.castShadow = true;
  group.add(body);

  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, D - 1), new THREE.MeshStandardMaterial({ color: '#150b0b', roughness: 0.4 }));
  face.rotation.x = -Math.PI / 2;
  const faceY = topY + H + 1.2 + 0.02;
  face.position.set(cx, faceY, midZ);
  group.add(face);

  const segMats: THREE.MeshStandardMaterial[] = [];
  SEG_LAYOUT.forEach((s) => {
    const m = new THREE.MeshStandardMaterial({ color: '#3a1210', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.5 });
    segMats.push(m);
    const geo = s.horiz ? new THREE.BoxGeometry(4.2, 0.25, 1.25) : new THREE.BoxGeometry(1.25, 0.25, 4.2);
    const seg = new THREE.Mesh(geo, m);
    seg.position.set(cx + s.x, faceY + 0.15, midZ + s.z);
    group.add(seg);
  });
  const dpMat = new THREE.MeshStandardMaterial({ color: '#3a1210', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.5 });
  segMats.push(dpMat);
  const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 12), dpMat);
  dp.position.set(cx + 4.7, faceY + 0.15, midZ + 6.3);
  group.add(dp);

  for (const p of positions) {
    group.add(straightLead(p, new THREE.Vector3(p.x, topY + 1.4, p.z), 0.3));
  }

  return {
    group,
    update(sim) {
      const levels = sim.segLevels.get(comp.id) ?? [0, 0, 0, 0, 0, 0, 0, 0];
      segMats.forEach((m, i) => {
        m.emissiveIntensity = (levels[i] ?? 0) * 2.4;
        m.color.set(levels[i] > 0.03 ? '#7a1f16' : '#3a1210');
      });
    },
  };
}

// ----------------------------------------------------------------- entry

export function buildComponent(comp: ComponentInstance): CompVisual {
  let vis: CompVisual;
  switch (comp.type) {
    case 'led':
      vis = buildLed(comp);
      break;
    case 'resistor':
      vis = buildResistor(comp);
      break;
    case 'capacitor':
      vis = buildCapacitor(comp);
      break;
    case 'button':
      vis = buildButton(comp);
      break;
    case 'switch':
      vis = buildSwitch(comp);
      break;
    case 'pot':
      vis = buildPot(comp);
      break;
    case 'ic555':
    case 'ic74hc00':
    case 'ic74hc04':
    case 'ic74hc595':
      vis = buildIc(comp);
      break;
    case 'sevenseg':
      vis = buildSevenSeg(comp);
      break;
    default:
      vis = { group: new THREE.Group(), update() {} };
  }
  vis.group.userData.componentId = comp.id;
  vis.group.traverse((o) => {
    o.userData.componentId = comp.id;
  });
  return vis;
}
