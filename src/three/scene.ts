import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  resetCamera(): void;
  resize(): void;
}

const CAM_POS = new THREE.Vector3(-12, 150, 180);
const CAM_TARGET = new THREE.Vector3(-5, 0, 28);

export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#12161f');
  scene.fog = new THREE.Fog('#12161f', 900, 1600);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(42, 1, 1, 3000);
  camera.position.copy(CAM_POS);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(CAM_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 40;
  controls.maxDistance = 700;
  controls.update();

  // ------------------------------------------------------------- lighting
  scene.add(new THREE.HemisphereLight('#cfe0ff', '#3a3228', 0.5));

  const key = new THREE.DirectionalLight('#fff4e0', 2.2);
  key.position.set(-140, 260, 120);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -220;
  key.shadow.camera.right = 220;
  key.shadow.camera.top = 220;
  key.shadow.camera.bottom = -220;
  key.shadow.camera.far = 800;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#9db8ff', 0.5);
  fill.position.set(180, 140, -160);
  scene.add(fill);

  // warm desk-lamp accent
  const lamp = new THREE.PointLight('#ffd9a0', 12000, 600, 2);
  lamp.position.set(150, 120, -60);
  scene.add(lamp);

  // ------------------------------------------------------------------ desk
  const texLoader = new THREE.TextureLoader();
  const deskMat = new THREE.MeshStandardMaterial({ color: '#8a6b4a', roughness: 0.8, metalness: 0 });
  texLoader.load(
    'textures/wood_table_001_diff_2k.jpg',
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1.4, 1);
      deskMat.map = t;
      deskMat.color.set('#ffffff');
      deskMat.needsUpdate = true;
    },
    undefined,
    () => console.warn('[assets] wood diffuse texture failed to load — using flat colour fallback'),
  );
  texLoader.load(
    'textures/wood_table_001_rough_2k.jpg',
    (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1.4, 1);
      deskMat.roughnessMap = t;
      deskMat.needsUpdate = true;
    },
    undefined,
    () => {},
  );
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1500, 10, 800), deskMat);
  desk.position.y = -5.01;
  desk.receiveShadow = true;
  scene.add(desk);

  // anti-static mat
  const mat = new THREE.Mesh(
    new RoundedBoxGeometry(360, 4, 250, 3, 2),
    new THREE.MeshStandardMaterial({ color: '#232d3a', roughness: 0.95, metalness: 0 }),
  );
  mat.position.set(0, 0, 25);
  mat.receiveShadow = true;
  mat.castShadow = true;
  scene.add(mat);
  // mat corner label
  const matLabel = makeMatLabel();
  matLabel.position.set(-118, 2.15, 130);
  scene.add(matLabel);

  const resetCamera = () => {
    camera.position.copy(CAM_POS);
    controls.target.copy(CAM_TARGET);
    controls.update();
  };

  const resize = () => {
    const parent = canvas.parentElement!;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  return { renderer, scene, camera, controls, resetCamera, resize };
}

function makeMatLabel(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 512, 128);
  g.font = '600 44px system-ui, sans-serif';
  g.fillStyle = '#41546e';
  g.textBaseline = 'middle';
  g.fillText('VIRTUAL BREADBOARD LAB', 16, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 27.5),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}
