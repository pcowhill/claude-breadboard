import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  ARD_BODY,
  ARD_CENTER,
  ARD_PCB_TOP,
  ARD_PIN_Y,
  ARD_PINS,
  ARD_ROT_Y,
  BB_BODY,
  BB_CENTER,
  BB_COLS,
  BB_ROWS,
  BB_TOP_Y,
  MAT_TOP,
  RAIL_HOLES,
  RAIL_ROWS,
  bbColX,
  bbRowZ,
  railHoleX,
} from '../core/boards';

// Both boards draw their top faces onto canvas textures: holes, row/column
// labels and rail stripes come from the texture, while snap positions are
// computed from the same layout constants — so picture and electrical model
// always line up.

export function buildBreadboard(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'breadboard';

  const scale = 12; // px per mm
  const c = document.createElement('canvas');
  c.width = BB_BODY.w * scale;
  c.height = BB_BODY.d * scale;
  const g = c.getContext('2d')!;
  const px = (lx: number) => (lx + BB_BODY.w / 2) * scale;
  const py = (lz: number) => (lz + BB_BODY.d / 2) * scale;

  // body
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, c.width, c.height);
  // subtle vignette edge
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, c.width - 6, c.height - 6);

  // centre ravine
  g.fillStyle = '#ddd9d0';
  g.fillRect(0, py(-1.27 + 1.1), c.width, (2.54 - 2.2) * scale + 14);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, py(0) - 2, c.width, 4);

  // rail stripes
  for (const rail of RAIL_ROWS) {
    const isPlus = rail.polarity === '+';
    g.strokeStyle = isPlus ? '#d33a3a' : '#3a62d3';
    g.lineWidth = 3.5;
    const y = py(rail.z + (isPlus ? -1.9 : 1.9));
    g.beginPath();
    g.moveTo(px(railHoleX(1) - 4), y);
    g.lineTo(px(railHoleX(RAIL_HOLES) + 4), y);
    g.stroke();
    g.font = `bold ${3.4 * scale}px system-ui, sans-serif`;
    g.fillStyle = g.strokeStyle;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(rail.polarity, px(railHoleX(1) - 7.5), py(rail.z));
    g.fillText(rail.polarity, px(railHoleX(RAIL_HOLES) + 7.5), py(rail.z));
  }

  // holes
  const hole = (lx: number, lz: number) => {
    const s = 1.9 * scale;
    const x = px(lx) - s / 2;
    const y = py(lz) - s / 2;
    g.fillStyle = '#c9c4b8';
    g.fillRect(x - 2, y - 2, s + 4, s + 4);
    g.fillStyle = '#26262b';
    g.fillRect(x, y, s, s);
  };
  for (let col = 1; col <= BB_COLS; col++) for (const row of BB_ROWS) hole(bbColX(col), bbRowZ(row));
  for (const rail of RAIL_ROWS) for (let i = 1; i <= RAIL_HOLES; i++) hole(railHoleX(i), rail.z);

  // labels
  g.fillStyle = '#8d897f';
  g.font = `${2.1 * scale}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let col = 1; col <= BB_COLS; col++) {
    if (col === 1 || col % 5 === 0) {
      g.fillText(String(col), px(bbColX(col)), py(bbRowZ('a') - 3.2));
      g.fillText(String(col), px(bbColX(col)), py(bbRowZ('j') + 3.2));
    }
  }
  g.textAlign = 'left';
  for (const row of BB_ROWS) {
    g.fillText(row, px(bbColX(1) - 4.6), py(bbRowZ(row)));
    g.fillText(row, px(bbColX(BB_COLS) + 3.4), py(bbRowZ(row)));
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#e8e5de', roughness: 0.9 });
  // body (sides) + separate textured top plane
  const body = new THREE.Mesh(new RoundedBoxGeometry(BB_BODY.w, BB_BODY.h, BB_BODY.d, 2, 1.2), sideMat);
  body.position.set(BB_CENTER.x, MAT_TOP + BB_BODY.h / 2, BB_CENTER.z);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const top = new THREE.Mesh(new THREE.PlaneGeometry(BB_BODY.w, BB_BODY.d), topMat);
  top.rotation.x = -Math.PI / 2;
  top.position.set(BB_CENTER.x, BB_TOP_Y + 0.02, BB_CENTER.z);
  top.receiveShadow = true;
  group.add(top);

  return group;
}

export interface ArduinoRefs {
  group: THREE.Group;
  ledL: THREE.MeshStandardMaterial;
  ledPwr: THREE.MeshStandardMaterial;
}

export function buildArduino(): ArduinoRefs {
  const group = new THREE.Group();
  group.name = 'arduino';
  group.position.set(ARD_CENTER.x, 0, ARD_CENTER.z);
  group.rotation.y = ARD_ROT_Y;

  const scale = 14;
  const c = document.createElement('canvas');
  c.width = ARD_BODY.w * scale;
  c.height = ARD_BODY.d * scale;
  const g = c.getContext('2d')!;
  const px = (lx: number) => (lx + ARD_BODY.w / 2) * scale;
  const py = (lz: number) => (lz + ARD_BODY.d / 2) * scale;

  g.fillStyle = '#0e7a86';
  g.fillRect(0, 0, c.width, c.height);
  // faint traces
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 4;
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(px(-30 + i * 5), py(-18));
    g.lineTo(px(-26 + i * 5), py(-6));
    g.lineTo(px(-26 + i * 5), py(8));
    g.stroke();
  }
  // silkscreen
  g.fillStyle = '#e9f4f2';
  g.font = `bold ${4.4 * scale}px system-ui, sans-serif`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('VBL UNO', px(-12), py(6.5));
  g.font = `${2 * scale}px system-ui, sans-serif`;
  g.fillText('educational simulator', px(-12), py(10.5));
  g.beginPath();
  g.arc(px(-20), py(8.5), 3.4 * scale, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.strokeStyle = '#e9f4f2';
  g.stroke();
  g.font = `bold ${3.2 * scale}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('∞', px(-20), py(8.6));

  // pin labels
  g.font = `${1.65 * scale}px system-ui, sans-serif`;
  for (const p of ARD_PINS) {
    const above = p.lz > 0;
    g.save();
    g.translate(px(p.lx), py(p.lz + (above ? -3.4 : 3.4)));
    g.rotate(-Math.PI / 2);
    g.textAlign = above ? 'left' : 'right';
    g.fillStyle = '#eef7f5';
    g.fillText(p.label, above ? 0.4 * scale : -0.4 * scale, 0);
    g.restore();
  }
  g.font = `${1.8 * scale}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('DIGITAL (PWM ~)', px(-9), py(-16));
  g.fillText('POWER', px(-19), py(16));
  g.fillText('ANALOG IN', px(10.5), py(16));
  g.fillText('L', px(-2.5), py(-10.2));
  g.fillText('ON', px(14), py(4));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(ARD_BODY.w, ARD_BODY.h, ARD_BODY.d),
    [
      new THREE.MeshStandardMaterial({ color: '#0b626c', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#0b626c', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 }),
      new THREE.MeshStandardMaterial({ color: '#0a5760', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#0b626c', roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: '#0b626c', roughness: 0.7 }),
    ],
  );
  pcb.position.y = ARD_PCB_TOP - ARD_BODY.h / 2;
  pcb.castShadow = true;
  pcb.receiveShadow = true;
  group.add(pcb);

  // standoffs
  for (const [sx, sz] of [
    [-30, -22],
    [30, -22],
    [-30, 22],
    [30, 22],
  ] as const) {
    const st = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, ARD_PCB_TOP - ARD_BODY.h - MAT_TOP, 12),
      new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.5 }),
    );
    st.position.set(sx, MAT_TOP + (ARD_PCB_TOP - ARD_BODY.h - MAT_TOP) / 2, sz);
    group.add(st);
  }

  // header strips (black) under the pins
  const headerMat = new THREE.MeshStandardMaterial({ color: '#181818', roughness: 0.85 });
  const socketMat = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.6 });
  const strips: Array<{ x0: number; x1: number; z: number }> = [
    { x0: -31, x1: -31 + 9 * 2.54, z: -23 },
    { x0: -31 + 10 * 2.54 + 1.5, x1: -31 + 10 * 2.54 + 1.5 + 7 * 2.54, z: -23 },
    { x0: -26, x1: -26 + 5 * 2.54, z: 23 },
    { x0: 4, x1: 4 + 5 * 2.54, z: 23 },
  ];
  const headerH = ARD_PIN_Y - ARD_PCB_TOP;
  for (const s of strips) {
    const w = s.x1 - s.x0 + 2.7;
    const h = new THREE.Mesh(new THREE.BoxGeometry(w, headerH, 2.9), headerMat);
    h.position.set((s.x0 + s.x1) / 2, ARD_PCB_TOP + headerH / 2, s.z);
    h.castShadow = true;
    group.add(h);
  }
  // socket holes on top of headers
  const socketGeo = new THREE.BoxGeometry(1.3, 0.4, 1.3);
  for (const p of ARD_PINS) {
    const sm = new THREE.Mesh(socketGeo, socketMat);
    sm.position.set(p.lx, ARD_PIN_Y + 0.05, p.lz);
    group.add(sm);
  }

  // USB + power jack + MCU + crystal + reset button
  const usb = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 11), new THREE.MeshStandardMaterial({ color: '#b9c2c9', metalness: 0.85, roughness: 0.35 }));
  usb.position.set(-31, ARD_PCB_TOP + 5, -12);
  usb.castShadow = true;
  group.add(usb);
  const jack = new THREE.Mesh(new THREE.BoxGeometry(13.5, 10, 9), new THREE.MeshStandardMaterial({ color: '#101010', roughness: 0.8 }));
  jack.position.set(-30, ARD_PCB_TOP + 5, 14);
  jack.castShadow = true;
  group.add(jack);
  const mcu = new THREE.Mesh(new THREE.BoxGeometry(34, 3.4, 9), new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.75 }));
  mcu.position.set(9, ARD_PCB_TOP + 1.7, 6.5);
  mcu.castShadow = true;
  group.add(mcu);
  const crystal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 10, 12), new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.9, roughness: 0.3 }));
  crystal.rotation.z = Math.PI / 2;
  crystal.position.set(-14, ARD_PCB_TOP + 1.6, -8);
  group.add(crystal);
  const rst = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.4, 14), new THREE.MeshStandardMaterial({ color: '#c22', roughness: 0.5 }));
  rst.position.set(-24, ARD_PCB_TOP + 1.4, -18);
  group.add(rst);

  // status LEDs
  const ledPwr = new THREE.MeshStandardMaterial({ color: '#0c4', emissive: '#0f5', emissiveIntensity: 1.4, roughness: 0.4 });
  const ledL = new THREE.MeshStandardMaterial({ color: '#552', emissive: '#fb0', emissiveIntensity: 0, roughness: 0.4 });
  const pwrMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 1.2), ledPwr);
  pwrMesh.position.set(14, ARD_PCB_TOP + 0.5, 1.5);
  group.add(pwrMesh);
  const lMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 1.2), ledL);
  lMesh.position.set(-2.5, ARD_PCB_TOP + 0.5, -12.6);
  group.add(lMesh);

  return { group, ledL, ledPwr };
}
