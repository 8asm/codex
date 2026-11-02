/**
 * Vue ville (phase 6) : Three.js pur, indépendante de React et du moteur.
 * Deux scènes :
 *  - l'extérieur : quartier low-poly généré depuis l'identifiant de la ville, siège du joueur dont la
 *    géométrie suit le palier (étage loué → étages → tour → campus), sièges des concurrents, passants,
 *    voitures, port ou fleuve ;
 *  - l'intérieur : la salle de marché en « maison de poupée » (murs avant ouverts), dont le style, la taille,
 *    l'effectif et les objets de prestige reflètent l'état du jeu ; un mur d'écrans affiche les vrais prix.
 * La caméra descend du ciel à l'entrée (continuité avec le plongeon du globe) et remonte à la sortie.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FloorStyle, OfficeTier, PrestigeItemId } from '../engine/types';

export interface CityTicker {
  label: string;
  price: string;
  change: number; // relatif
}

export interface CityRival {
  id: string;
  name: string;
  color: string;
  tier: OfficeTier;
}

export interface CityViewState {
  cityId: string;
  cityName: string;
  port: boolean;
  /** le siège affiché est-il celui du joueur (ou de son employeur) dans cette ville ? */
  hq: null | {
    name: string;
    color: string;
    tier: OfficeTier;
    style: FloorStyle;
    items: PrestigeItemId[];
    owned: boolean;
    staff: number;
    seats: number;
    employer: boolean;
    /** bureau à l'étranger : libellé affiché à la place du niveau de siège */
    label?: string;
  };
  rivals: CityRival[];
  tickers: CityTicker[];
  /** 0 matin … 1 soir */
  dayFrac: number;
}

export interface CityViewOptions {
  onExit: () => void;
  onHqClick: () => void;
}

const BLOCK = 60;
const ROAD = 12;
const HALF = 6; // blocs de part et d'autre du centre

const flat = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0.05, ...extra });

/** Pseudo-aléa déterministe par ville. */
function rng(seedStr: string) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ immeubles instanciés (fenêtres procédurales)
const BUILDING_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  vec4 w = m * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * normal);
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #else
  vCol = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BUILDING_FS = /* glsl */ `
uniform vec3 sunDir;
uniform float night;
uniform vec3 fogCol;
uniform float fogNear;
uniform float fogFar;
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 n = normalize(vN);
  float diff = max(dot(n, sunDir), 0.0);
  float amb = 0.5 - 0.25 * night;
  vec3 base = vCol * (amb + 0.6 * diff * (1.0 - 0.6 * night));
  if (abs(n.y) < 0.5) {
    float u = abs(n.x) > 0.5 ? vW.z : vW.x;
    float fy = fract(vW.y / 3.6);
    float fu = fract(u / 3.0);
    float win = step(0.28, fy) * step(fy, 0.78) * step(0.18, fu) * step(fu, 0.82) * step(3.6, vW.y);
    float lit = step(0.5, h21(floor(vec2(u / 3.0, vW.y / 3.6))));
    vec3 glass = vec3(0.32, 0.45, 0.58) * (0.55 + 0.6 * diff) * (1.0 - 0.7 * night);
    glass = mix(glass, vec3(1.0, 0.82, 0.5), lit * night);
    base = mix(base, glass, win * 0.85);
  }
  float d = length(vW - cameraPosition);
  base = mix(base, fogCol, smoothstep(fogNear, fogFar, d));
  gl_FragColor = vec4(base, 1.0);
  #include <colorspace_fragment>
}`;

interface Walker {
  x: number;
  z: number;
  axis: 0 | 1; // 0 : se déplace selon x, 1 : selon z
  dir: 1 | -1;
  speed: number;
  phase: number;
}

interface Car {
  axis: 0 | 1;
  lane: number; // coordonnée fixe
  pos: number;
  dir: 1 | -1;
  speed: number;
}

const STYLE_PAL: Record<FloorStyle, { floor: string; wall: string; desk: string; accent: string; ambient: number; screen: number }> = {
  classique: { floor: '#6b4a2f', wall: '#efe4cc', desk: '#7a4e2d', accent: '#2f6b3a', ambient: 1.0, screen: 0.8 },
  openspace: { floor: '#d6dbe0', wall: '#ffffff', desk: '#f5f5f5', accent: '#38bdf8', ambient: 1.25, screen: 0.8 },
  bunker: { floor: '#1d2430', wall: '#111827', desk: '#0b0f17', accent: '#3b82f6', ambient: 0.35, screen: 1.6 },
  verriere: { floor: '#ece6dc', wall: '#cfe3ef', desk: '#e8e0d0', accent: '#d4a017', ambient: 1.3, screen: 0.8 },
};

export class CityView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private inScene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight('#fff3dc', 2.4);
  private hemi = new THREE.HemisphereLight('#dbeeff', '#5a5040', 1.1);
  private bMat: THREE.ShaderMaterial;
  private cityKey = '';
  private hqKey = '';
  private inKey = '';
  private cityGroup = new THREE.Group();
  private hqGroup = new THREE.Group();
  private rivalGroup = new THREE.Group();
  private inGroup = new THREE.Group();
  private walkers: Walker[] = [];
  private walkerMesh: THREE.InstancedMesh | null = null;
  private cars: Car[] = [];
  private carMesh: THREE.InstancedMesh | null = null;
  private traders: { mesh: THREE.Object3D; base: THREE.Vector3; seat: boolean; phase: number; span: number }[] = [];
  private tickerTex: THREE.CanvasTexture | null = null;
  private tickerCanvas: HTMLCanvasElement | null = null;
  private screenTex: THREE.CanvasTexture[] = [];
  private labelLayer: HTMLDivElement;
  private labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
  private raf = 0;
  private clock = new THREE.Clock();
  private state: CityViewState | null = null;
  private interior = false;
  private anim: null | { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number; dur: number; fog0: number; fog1: number; done?: () => void } = null;
  private fogFar = 900;
  private resizeObs: ResizeObserver;
  private ray = new THREE.Raycaster();
  private downAt: { x: number; y: number } | null = null;
  private ship: THREE.Group | null = null;

  constructor(private container: HTMLElement, private opts: CityViewOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'city-labels';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 4000);
    this.camera.position.set(0, 1400, 300);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 700;
    this.controls.target.set(0, 18, 0);
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => {
      // l'utilisateur reprend la main pendant la descente : on termine la transition (brouillard compris)
      if (this.anim && !this.anim.done) {
        this.fogFar = this.anim.fog1;
        this.anim = null;
      }
    });

    this.scene.background = new THREE.Color('#bcd9ef');
    this.scene.fog = new THREE.Fog('#bcd9ef', 300, this.fogFar);
    this.scene.add(this.hemi);
    this.sun.position.set(180, 300, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 10; sc.far = 900;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.cityGroup, this.hqGroup, this.rivalGroup);

    this.bMat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VS,
      fragmentShader: BUILDING_FS,
      uniforms: {
        sunDir: { value: this.sun.position.clone().normalize() },
        night: { value: 0 },
        fogCol: { value: new THREE.Color('#bcd9ef') },
        fogNear: { value: 300 },
        fogFar: { value: this.fogFar },
      },
    });

    this.inScene.background = new THREE.Color('#0d1726');
    this.inScene.add(this.inGroup);

    const el = this.renderer.domElement;
    el.addEventListener('wheel', this.onWheel, { passive: true });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- API
  setState(s: CityViewState) {
    this.state = s;
    const ck = `${s.cityId}|${s.port}`;
    if (ck !== this.cityKey) {
      this.cityKey = ck;
      this.buildCity(s);
    }
    const hk = s.hq ? `${s.hq.tier}|${s.hq.items.join(',')}|${s.hq.owned}|${s.hq.color}|${s.hq.name}` : 'none';
    const rk = s.rivals.map((r) => `${r.id}:${r.tier}`).join(',');
    if (hk + rk !== this.hqKey) {
      this.hqKey = hk + rk;
      this.buildHq(s);
      this.buildRivals(s);
      this.buildLabels(s);
    }
    const ik = s.hq ? `${s.hq.tier}|${s.hq.style}|${s.hq.items.join(',')}|${Math.min(s.hq.staff, 999)}` : 'none';
    if (ik !== this.inKey) {
      this.inKey = ik;
      this.buildInterior(s);
    }
    this.drawTicker();
    const night = Math.max(0, Math.min(1, (s.dayFrac - 0.72) / 0.28)) * 0.75;
    this.bMat.uniforms.night!.value = night;
    const sky = new THREE.Color('#bcd9ef').lerp(new THREE.Color('#e9a46a'), night * 0.6).lerp(new THREE.Color('#1c2a4a'), night * 0.5);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    (this.bMat.uniforms.fogCol!.value as THREE.Color).copy(sky);
    this.sun.intensity = 2.4 * (1 - night * 0.6);
  }

  /** Descente depuis le ciel (suite du plongeon du globe). */
  enter() {
    this.interior = false;
    this.camera.position.set(-60, 1500, 420);
    this.controls.target.set(0, 18, 0);
    const [pos, target] = this.homeView();
    this.animateTo(pos, target, 2.0, 60, 1300);
  }

  /** Cadrage par défaut : recule avec la hauteur du siège pour le montrer en entier. */
  private homeView(): [THREE.Vector3, THREE.Vector3] {
    const k = Math.max(1, this.hqTop / 70);
    return [new THREE.Vector3(120 * k, 110 * k, 150 * k), new THREE.Vector3(0, Math.min(55, this.hqTop * 0.38), 0)];
  }

  /** Remontée vers le ciel puis retour au globe. */
  leave(done: () => void) {
    if (this.interior) this.setInterior(false);
    this.animateTo(new THREE.Vector3(-60, 1500, 420), new THREE.Vector3(0, 18, 0), 1.3, this.fogFar, 60, done);
  }

  setInterior(on: boolean) {
    if (on === this.interior) return;
    if (this.anim) {
      const a = this.anim;
      this.anim = null;
      this.fogFar = a.fog1;
      a.done?.();
    }
    this.interior = on;
    this.labelLayer.style.display = on ? 'none' : '';
    if (on) {
      const w = this.roomW;
      this.controls.minDistance = 8;
      this.controls.maxDistance = Math.max(60, w * 1.8);
      this.controls.maxPolarAngle = 1.25;
      this.camera.position.set(w * 0.55, w * 0.55, w * 0.85);
      this.controls.target.set(0, 1.5, -2);
      this.anim = null;
    } else {
      this.controls.minDistance = 40;
      this.controls.maxDistance = 700;
      this.controls.maxPolarAngle = 1.32;
      const [pos, target] = this.homeView();
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
    }
    this.controls.update();
  }

  get isInterior() {
    return this.interior;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    const free = (o: THREE.Object3D) =>
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((a) => a.dispose());
        else mat?.dispose();
      });
    free(this.scene);
    free(this.inScene);
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------- interactions
  private onWheel = (e: WheelEvent) => {
    if (this.interior || this.anim) return;
    // dézoomer au-delà de la distance maximale ramène au globe : zoom continu dans les deux sens
    if (e.deltaY > 0 && this.camera.position.distanceTo(this.controls.target) >= this.controls.maxDistance * 0.98) this.opts.onExit();
  };

  private onDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (!this.downAt || this.interior) return;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 5) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    if (this.ray.intersectObject(this.hqGroup, true).length) this.opts.onHqClick();
  };

  private animateTo(to: THREE.Vector3, target: THREE.Vector3, dur: number, fog0: number, fog1: number, done?: () => void) {
    this.anim = { from: this.camera.position.clone(), to, tFrom: this.controls.target.clone(), tTo: target, t: 0, dur, fog0, fog1, done };
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- construction de la ville
  private clear(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((x) => {
        const m = x as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((a) => a.dispose());
        else if (mat && mat !== this.bMat) mat.dispose();
      });
    }
  }

  /** Bloc (i, j) occupé par l'eau ? Port : front de mer au sud ; sinon un fleuve ou un lac sur une rangée. */
  private isWater(s: CityViewState, _i: number, j: number) {
    return s.port ? j >= 3 : j === 3;
  }

  private reserved(i: number, j: number) {
    return (i === 0 && j === 0) || RIVAL_PLOTS.some(([a, b]) => a === i && b === j);
  }

  private buildCity(s: CityViewState) {
    this.clear(this.cityGroup);
    this.walkers = [];
    this.cars = [];
    this.ship = null;
    const rnd = rng(s.cityId);
    const size = (HALF * 2 + 1) * BLOCK + 400;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), flat('#59616b', { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.cityGroup.add(ground);

    // eau
    const waterMat = flat('#2f7fb5', { roughness: 0.25, metalness: 0.2, flatShading: false });
    if (s.port) {
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size), waterMat);
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, 0.3, 3 * BLOCK - BLOCK / 2 + size / 2);
      this.cityGroup.add(sea);
    } else {
      const river = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, BLOCK), waterMat);
      river.rotation.x = -Math.PI / 2;
      river.position.set(0, 0.3, 3 * BLOCK);
      this.cityGroup.add(river);
      // ponts
      for (let i = -HALF; i <= HALF; i += 3) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(ROAD + 2, 1.2, BLOCK + 4), flat('#9aa0a6'));
        br.position.set(i * BLOCK + BLOCK / 2, 1.6, 3 * BLOCK);
        br.castShadow = true;
        this.cityGroup.add(br);
      }
    }

    // îlots : trottoirs, parcs, immeubles
    const pads: THREE.Matrix4[] = [];
    const parks: THREE.Matrix4[] = [];
    const bld: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const trees: THREE.Vector3[] = [];
    const palette = ['#efe6d8', '#d9d2c3', '#c9d6df', '#e8d5c4', '#d4dccd', '#f2e8cf', '#b8c4cc', '#e3c9b5'];
    const m4 = new THREE.Matrix4();
    const pad = BLOCK - ROAD;
    for (let i = -HALF; i <= HALF; i++)
      for (let j = -HALF; j <= HALF; j++) {
        if (this.isWater(s, i, j)) continue;
        const cx = i * BLOCK;
        const cz = j * BLOCK;
        const dist = Math.hypot(i, j);
        const park = !this.reserved(i, j) && rnd() < 0.1;
        (park ? parks : pads).push(new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.4, cz), new THREE.Quaternion(), new THREE.Vector3(pad, 0.8, pad)));
        if (park) {
          for (let k = 0; k < 9; k++) trees.push(new THREE.Vector3(cx + (rnd() - 0.5) * pad * 0.8, 0.8, cz + (rnd() - 0.5) * pad * 0.8));
          continue;
        }
        if (this.reserved(i, j)) continue;
        // immeubles : plus hauts au centre (quartier d'affaires), plus bas en périphérie
        const n = 1 + Math.floor(rnd() * 4);
        const sub = pad / 2;
        for (let k = 0; k < n; k++) {
          const qx = (k % 2) - 0.5;
          const qz = Math.floor(k / 2) - 0.5;
          const w = sub * (0.6 + rnd() * 0.3);
          const d = sub * (0.6 + rnd() * 0.3);
          // les îlots voisins du siège restent bas : le siège doit se voir depuis la caméra
          const tall = dist < 1.6 ? 8 + rnd() * 10 : Math.max(6, (70 / (1 + dist * 0.5)) * (0.35 + rnd() * 0.9));
          const h = n === 1 ? tall * 1.2 : tall;
          const ww = n === 1 ? pad * 0.7 : w;
          const dd = n === 1 ? pad * 0.7 : d;
          const px = n === 1 ? cx : cx + qx * sub;
          const pz = n === 1 ? cz : cz + qz * sub;
          m4.compose(new THREE.Vector3(px, 0.8, pz), new THREE.Quaternion(), new THREE.Vector3(ww, h, dd));
          bld.push({ m: m4.clone(), c: new THREE.Color(palette[Math.floor(rnd() * palette.length)]!) });
          if (n === 1) break;
        }
        if (rnd() < 0.5) trees.push(new THREE.Vector3(cx + pad / 2 - 2, 0.8, cz + pad / 2 - 2));
      }
    const padGeo = new THREE.BoxGeometry(1, 1, 1);
    const padMesh = new THREE.InstancedMesh(padGeo, flat('#c9c3b6'), pads.length);
    pads.forEach((m, k) => padMesh.setMatrixAt(k, m));
    padMesh.receiveShadow = true;
    this.cityGroup.add(padMesh);
    const parkMesh = new THREE.InstancedMesh(padGeo.clone(), flat('#8fbf6a'), Math.max(1, parks.length));
    parks.forEach((m, k) => parkMesh.setMatrixAt(k, m));
    parkMesh.count = parks.length;
    parkMesh.receiveShadow = true;
    this.cityGroup.add(parkMesh);

    const bGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const bMesh = new THREE.InstancedMesh(bGeo, this.bMat, bld.length);
    bld.forEach((b, k) => {
      bMesh.setMatrixAt(k, b.m);
      bMesh.setColorAt(k, b.c);
    });
    bMesh.castShadow = true;
    this.cityGroup.add(bMesh);

    // arbres
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 5).translate(0, 1.5, 0), flat('#7a5a3a'), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 6, 6).translate(0, 5.5, 0), flat('#4f9a4a'), trees.length);
    trees.forEach((p, k) => {
      const sc = 0.8 + rnd() * 0.6;
      m4.compose(p, new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
      trunk.setMatrixAt(k, m4);
      crown.setMatrixAt(k, m4);
    });
    crown.castShadow = true;
    this.cityGroup.add(trunk, crown);

    // marquage des routes
    const marks: THREE.Matrix4[] = [];
    for (let i = -HALF; i <= HALF; i++)
      for (let k = -HALF * 6; k <= HALF * 6; k++) {
        const x = i * BLOCK + BLOCK / 2;
        const z = k * 10;
        if (!this.isWater(s, 0, Math.round(z / BLOCK))) marks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.05, z), new THREE.Quaternion(), new THREE.Vector3(0.5, 0.05, 4)));
        if (!this.isWater(s, 0, i)) marks.push(new THREE.Matrix4().compose(new THREE.Vector3(z, 0.05, x), new THREE.Quaternion(), new THREE.Vector3(4, 0.05, 0.5)));
      }
    const markMesh = new THREE.InstancedMesh(padGeo.clone(), flat('#e8e2c8'), marks.length);
    marks.forEach((m, k) => markMesh.setMatrixAt(k, m));
    this.cityGroup.add(markMesh);

    // port : quais, grues, porte-conteneurs ; sinon quais de fleuve
    if (s.port) {
      const quay = new THREE.Mesh(new THREE.BoxGeometry((HALF * 2 + 1) * BLOCK, 2, 14), flat('#a59c8c'));
      quay.position.set(0, 1, 2.5 * BLOCK + 4);
      quay.receiveShadow = true;
      this.cityGroup.add(quay);
      for (let k = 0; k < 5; k++) {
        const crane = this.buildCrane();
        crane.position.set((k - 2) * 70 + 40, 2, 2.5 * BLOCK + 6);
        this.cityGroup.add(crane);
      }
      const boxes = new THREE.InstancedMesh(padGeo.clone(), flat('#ffffff'), 60);
      const cc = ['#c0392b', '#2471a3', '#d4ac0d', '#239b56', '#ca6f1e', '#7d3c98'];
      for (let k = 0; k < 60; k++) {
        m4.compose(new THREE.Vector3(-260 + (k % 20) * 7 + (k >= 40 ? 220 : 0), 3 + Math.floor((k % 40) / 20) * 2.6, 2.5 * BLOCK + 2 + ((k >> 2) % 2) * 3), new THREE.Quaternion(), new THREE.Vector3(6, 2.5, 2.4));
        boxes.setMatrixAt(k, m4);
        boxes.setColorAt(k, new THREE.Color(cc[k % cc.length]!));
      }
      this.cityGroup.add(boxes);
      this.ship = this.buildShip();
      this.ship.position.set(-300, 0.3, 3.4 * BLOCK);
      this.cityGroup.add(this.ship);
    }

    // passants (PNJ) sur les trottoirs
    const nW = 140;
    const body = new THREE.CapsuleGeometry(0.55, 1.1, 2, 6).translate(0, 1.1, 0);
    this.walkerMesh = new THREE.InstancedMesh(body, flat('#ffffff'), nW);
    const shirt = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#264653', '#8d99ae', '#e9c46a', '#6d597a', '#1d3557'];
    for (let k = 0; k < nW; k++) {
      const axis: 0 | 1 = rnd() < 0.5 ? 0 : 1;
      const line = (Math.floor(rnd() * (HALF * 2)) - HALF) * BLOCK + BLOCK / 2 + (rnd() < 0.5 ? -ROAD / 2 - 1.5 : ROAD / 2 + 1.5);
      const pos = (rnd() - 0.5) * HALF * 2 * BLOCK;
      const w: Walker = axis === 0 ? { x: pos, z: line, axis, dir: rnd() < 0.5 ? 1 : -1, speed: 2 + rnd() * 1.6, phase: rnd() * 10 } : { x: line, z: pos, axis, dir: rnd() < 0.5 ? 1 : -1, speed: 2 + rnd() * 1.6, phase: rnd() * 10 };
      this.walkers.push(w);
      this.walkerMesh.setColorAt(k, new THREE.Color(shirt[k % shirt.length]!));
    }
    this.walkerMesh.castShadow = true;
    this.cityGroup.add(this.walkerMesh);

    // voitures
    const nC = 50;
    this.carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 1.6, 4.6).translate(0, 1.1, 0), flat('#ffffff', { roughness: 0.4, metalness: 0.3 }), nC);
    const carCol = ['#e5e7eb', '#111827', '#b91c1c', '#1d4ed8', '#f59e0b', '#6b7280', '#065f46'];
    for (let k = 0; k < nC; k++) {
      const axis: 0 | 1 = rnd() < 0.5 ? 0 : 1;
      const dir: 1 | -1 = rnd() < 0.5 ? 1 : -1;
      let road = Math.floor(rnd() * (HALF * 2)) - HALF;
      if (axis === 0) while (this.isWater(s, 0, road) || this.isWater(s, 0, road + 1)) road--;
      const lane = road * BLOCK + BLOCK / 2 + dir * 2.6;
      this.cars.push({ axis, lane, pos: (rnd() - 0.5) * HALF * 2 * BLOCK, dir, speed: 9 + rnd() * 8 });
      this.carMesh.setColorAt(k, new THREE.Color(carCol[k % carCol.length]!));
    }
    this.carMesh.castShadow = true;
    this.cityGroup.add(this.carMesh);
  }

  private buildCrane(): THREE.Group {
    const g = new THREE.Group();
    const y = flat('#f2b134');
    for (const [x, z] of [[-4, -3], [4, -3], [-4, 3], [4, 3]] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 22, 1), y);
      leg.position.set(x, 11, z);
      g.add(leg);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 46), y);
    top.position.set(0, 23, 14);
    top.castShadow = true;
    g.add(top);
    return g;
  }

  private buildShip(): THREE.Group {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(110, 8, 18), flat('#7b2d26'));
    hull.position.y = 2;
    g.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 16), flat('#2471a3'));
    deck.position.set(-8, 9, 0);
    g.add(deck);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 14), flat('#f4f1ea'));
    bridge.position.set(44, 12, 0);
    g.add(bridge);
    g.traverse((x) => ((x as THREE.Mesh).castShadow = true));
    return g;
  }

  // ---------------------------------------------------------------- siège
  private signTexture(text: string, color: string, w = 512, h = 128) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff';
    x.font = `bold ${Math.floor(h * 0.5)}px system-ui, sans-serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2, w * 0.92);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private buildHq(s: CityViewState) {
    this.clear(this.hqGroup);
    const hq = s.hq;
    const g = this.hqGroup;
    const plaza = this.box(BLOCK - ROAD, 0.9, BLOCK - ROAD, flat('#e7e1d3'), 0, 0, 0);
    g.add(plaza);
    if (!hq) {
      // pas de siège ici : un immeuble ordinaire
      const b = this.box(26, 40, 26, this.bMat, 0, 0.9, 0);
      g.add(b);
      return;
    }
    const color = hq.color;
    // façade : verre bleuté teinté de la couleur de la société ; bandeaux et couronne en couleur pleine
    const glass = flat(new THREE.Color('#5d8fb8').lerp(new THREE.Color(color), 0.18), { emissive: '#1d3b5a', emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.55 });
    const accent = flat(color, { emissive: color, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.3 });
    const stone = flat('#f1ece2');
    const dark = flat('#3a4552', { roughness: 0.4, metalness: 0.3 });
    const sign = (text: string, w: number, h: number) =>
      new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.signTexture(text, color), toneMapped: false }));
    let top = 0;
    if (hq.tier === 0 || hq.tier === 1) {
      // immeuble partagé : un (ou trois) étage(s) aux couleurs de la société
      const floors = hq.tier === 0 ? 9 : 12;
      const fh = 3.6;
      const body = new THREE.Mesh(new THREE.BoxGeometry(28, floors * fh, 28).translate(0, (floors * fh) / 2, 0), this.bMat);
      body.position.y = 0.9;
      body.castShadow = true;
      g.add(body);
      const own = hq.tier === 0 ? [5] : [floors - 3, floors - 2, floors - 1];
      for (const f of own) g.add(this.box(28.6, fh * 0.92, 28.6, accent, 0, 0.9 + f * fh, 0));
      top = 0.9 + floors * fh;
      if (hq.tier === 1) {
        const sg = sign(hq.name.toUpperCase(), 26, 4.5);
        sg.position.set(0, top + 3, 14.4);
        g.add(sg);
        g.add(this.box(26, 0.6, 1, dark, 0, top, 14));
      } else {
        const plate = sign(hq.name, 6, 1.5);
        plate.position.set(9, 3.2, 14.35);
        g.add(plate);
      }
      // auvent d'entrée
      g.add(this.box(10, 0.5, 4, dark, 0, 4.5, 15.5));
    } else {
      // tour (palier 2) ; campus (palier 3) = tour plus haute + pavillons
      const H = hq.tier === 2 ? 95 : 130;
      const segs = 4;
      let w = 30;
      let y = 0.9;
      for (let k = 0; k < segs; k++) {
        const h = H / segs;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), glass);
        seg.position.y = y;
        seg.castShadow = true;
        g.add(seg);
        // nervures verticales
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(this.box(1, h, 1, stone, (sx * w) / 2, y, (sz * w) / 2));
        y += h;
        g.add(this.box(w + 0.8, 1.2, w + 0.8, accent, 0, y - 1.2, 0));
        w *= 0.86;
      }
      top = y;
      g.add(this.box(w * 1.05, 4, w * 1.05, accent, 0, top, 0));
      top += 4;
      const sg = sign(hq.name.toUpperCase(), w * 1.4, 5);
      sg.position.set(0, top - 8, w / 2 + 0.6);
      g.add(sg);
      // hall vitré
      g.add(this.box(18, 7, 6, flat('#cfe6f5', { transparent: true, opacity: 0.6 }), 0, 0.9, 17));
      if (hq.tier === 3) {
        // pavillons, passerelles, jardins
        const pav = flat('#f7f3ea');
        const roof = flat('#7fb069');
        for (const [x, z, ww, dd] of [[-BLOCK * 0.9, 0, 30, 36], [BLOCK * 0.9, -6, 26, 30], [0, -BLOCK * 0.9, 40, 22]] as const) {
          g.add(this.box(ww, 14, dd, pav, x, 0.9, z));
          g.add(this.box(ww * 0.96, 0.8, dd * 0.96, roof, x, 14.9, z));
          const br = this.box(Math.abs(x) > 0 ? Math.abs(x) - 18 : 5, 3, Math.abs(z) > 0 ? Math.abs(z) - 14 : 5, flat('#cfe6f5', { transparent: true, opacity: 0.7 }), x / 2, 9, z / 2);
          g.add(br);
        }
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          const t = new THREE.Mesh(new THREE.ConeGeometry(2.6, 7, 6), flat('#3f8f46'));
          t.position.set(Math.cos(a) * 42, 4.4, Math.sin(a) * 42 + 10);
          t.castShadow = true;
          g.add(t);
        }
        if (hq.items.includes('auditorium')) {
          const dome = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat('#e8e2d6'));
          dome.position.set(-BLOCK * 0.9, 15, BLOCK * 0.75);
          dome.castShadow = true;
          g.add(dome);
          g.add(this.box(34, 15, 34, pav, -BLOCK * 0.9, 0.9, BLOCK * 0.75));
        }
      }
      if (hq.items.includes('heliport')) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.5, 0.6, 24), flat('#30363d'));
        pad.position.y = top + 0.3;
        g.add(pad);
        const hMark = sign('H', 6, 6);
        hMark.rotation.x = -Math.PI / 2;
        hMark.position.y = top + 0.65;
        g.add(hMark);
        const heli = new THREE.Group();
        heli.add(this.box(3, 2.4, 6, flat('#f8fafc'), 0, 0, 0));
        const rotor = this.box(12, 0.2, 0.6, dark, 0, 2.6, 0);
        rotor.name = 'rotor';
        heli.add(rotor);
        heli.position.set(2, top + 0.6, 0);
        heli.name = 'heli';
        g.add(heli);
      }
    }
    // drapeau si propriétaire
    if (hq.owned || hq.tier >= 2) {
      g.add(this.box(0.4, 10, 0.4, dark, 18, 0.9, 18));
      const flag = this.box(5, 3, 0.2, flat(color), 20.5, 7.5, 18);
      flag.name = 'flag';
      g.add(flag);
    }
    // œuvre d'art sur le parvis
    if (hq.items.includes('art')) {
      const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(2.6, 0.8, 64, 8), flat('#d14d72', { metalness: 0.6, roughness: 0.3 }));
      knot.position.set(-14, 6, 20);
      knot.castShadow = true;
      knot.name = 'art';
      g.add(knot);
      g.add(this.box(3, 2, 3, stone, -14, 0.9, 20));
    }
    // fontaine
    if (hq.tier >= 2) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1, 20), stone);
      f.position.set(14, 1.4, 20);
      g.add(f);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 0.2, 20), flat('#5aa9e6', { roughness: 0.2 }));
      w.position.set(14, 1.95, 20);
      g.add(w);
    }
    // personnel devant l'entrée
    for (let k = 0; k < Math.min(10, 2 + hq.tier * 3); k++) {
      const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 2, 6), flat(k % 3 === 0 ? color : '#1f2937'));
      p.position.set(-8 + (k % 5) * 4, 2.0, 22 + Math.floor(k / 5) * 3);
      p.castShadow = true;
      p.name = 'staff';
      p.userData.phase = k;
      g.add(p);
    }
    this.hqTop = top;
  }

  private hqTop = 40;

  private buildRivals(s: CityViewState) {
    this.clear(this.rivalGroup);
    s.rivals.slice(0, RIVAL_PLOTS.length).forEach((r, k) => {
      const [i, j] = RIVAL_PLOTS[k]!;
      const g = new THREE.Group();
      const H = [30, 48, 80, 105][r.tier]!;
      const w = 22 + r.tier * 2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, H, w).translate(0, H / 2, 0), this.bMat);
      body.castShadow = true;
      g.add(body);
      const crown = this.box(w + 0.6, 4, w + 0.6, flat(r.color, { emissive: r.color, emissiveIntensity: 0.3 }), 0, H - 4, 0);
      g.add(crown);
      g.position.set(i * BLOCK, 0.8, j * BLOCK);
      g.userData = { top: H + 0.8, name: r.name };
      this.rivalGroup.add(g);
    });
  }

  private buildLabels(s: CityViewState) {
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    const add = (html: string, pos: THREE.Vector3, cls: string) => {
      const el = document.createElement('div');
      el.className = `city3d-label ${cls}`;
      el.innerHTML = html;
      this.labelLayer.appendChild(el);
      this.labels.push({ el, pos });
    };
    if (s.hq) add(`<b>${s.hq.name}</b><span>${['Étage loué', 'Plusieurs étages', 'Tour', 'Campus'][s.hq.tier]}${s.hq.employer ? ' · votre employeur' : ''}</span>`, new THREE.Vector3(0, this.hqTop + 8, 0), 'hq');
    this.rivalGroup.children.forEach((g) => add(`<b>${g.userData.name as string}</b>`, new THREE.Vector3(g.position.x, (g.userData.top as number) + 5, g.position.z), 'rival'));
  }

  // ---------------------------------------------------------------- salle de marché
  private roomW = 30;

  private screenTexture(kind: number) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const x = c.getContext('2d')!;
    x.fillStyle = '#06101c';
    x.fillRect(0, 0, 128, 80);
    if (kind === 2) {
      // blotter
      x.font = '9px monospace';
      for (let r = 0; r < 7; r++) {
        x.fillStyle = r % 2 ? '#7dd3fc' : '#e2e8f0';
        x.fillText(['BRENT  +12', 'TTF    -4', 'CU     +2', 'API2   -8', 'CAPE   +1', 'BRN C80 +5', 'TTF P30 -2'][r]!, 6, 12 + r * 10);
      }
    } else {
      x.strokeStyle = kind === 0 ? '#22c55e' : '#ef4444';
      x.lineWidth = 2;
      x.beginPath();
      let y = 40;
      for (let i = 0; i <= 32; i++) {
        y += (Math.sin(i * 1.7 + kind) + Math.cos(i * 0.6)) * 3 * (kind === 0 ? -0.6 : 0.6);
        x.lineTo(i * 4, Math.max(6, Math.min(74, y)));
      }
      x.stroke();
      x.fillStyle = 'rgba(56,189,248,0.25)';
      for (let i = 0; i < 16; i++) x.fillRect(i * 8 + 1, 80 - (i * 7) % 20 - 4, 5, (i * 7) % 20 + 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildInterior(s: CityViewState) {
    this.clear(this.inGroup);
    for (const l of [...this.inScene.children]) if (l !== this.inGroup) this.inScene.remove(l);
    this.traders = [];
    this.screenTex.forEach((t) => t.dispose());
    this.screenTex = [0, 1, 2].map((k) => this.screenTexture(k));
    const hq = s.hq;
    const tier = hq?.tier ?? 0;
    const style: FloorStyle = hq?.style ?? 'openspace';
    const pal = STYLE_PAL[style];
    const items = hq?.items ?? [];
    const rows = 2 + tier;
    const perRow = 4 + tier;
    const deskW = 3.4;
    const W = perRow * (deskW + 1.6) + 8;
    const D = rows * 5 + 10;
    const H = style === 'verriere' ? 8 : 5.2;
    this.roomW = W;
    const g = this.inGroup;
    const rnd = rng(`${s.cityId}-in`);

    this.inScene.add(new THREE.HemisphereLight('#ffffff', '#666055', 0.9 * pal.ambient));
    const key = new THREE.DirectionalLight('#fff6e6', 1.3 * pal.ambient);
    key.position.set(W * 0.3, 30, D);
    this.inScene.add(key);
    if (style === 'bunker') {
      const glow = new THREE.PointLight('#3b82f6', 30, W, 1.2);
      glow.position.set(0, 3, -D / 2 + 2);
      this.inScene.add(glow);
    }
    if (style === 'classique') {
      const warm = new THREE.PointLight('#ffcc88', 25, W, 1.2);
      warm.position.set(0, H - 1, 0);
      this.inScene.add(warm);
    }

    // sol, murs (arrière et gauche : vue maison de poupée)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.4, D), flat(pal.floor, { roughness: style === 'verriere' ? 0.25 : 0.85 }));
    floor.position.y = -0.2;
    g.add(floor);
    const wallMat = style === 'verriere' ? flat(pal.wall, { transparent: true, opacity: 0.35, roughness: 0.1 }) : flat(pal.wall);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.3), wallMat);
    back.position.set(0, H / 2, -D / 2);
    g.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, D), wallMat);
    left.position.set(-W / 2, H / 2, 0);
    g.add(left);
    if (style === 'verriere') {
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#dff1ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
      roof.rotation.x = -Math.PI / 2;
      roof.position.y = H;
      g.add(roof);
      // structure de la verrière
      const frame = flat('#c9a227', { metalness: 0.7, roughness: 0.3 });
      for (let k = 0; k <= 6; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, D), frame);
        bar.position.set(-W / 2 + (k * W) / 6, H, 0);
        g.add(bar);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, H, 0.2), frame);
        post.position.set(-W / 2 + (k * W) / 6, H / 2, -D / 2);
        g.add(post);
      }
    }
    if (style === 'classique') {
      // lambris
      g.add(this.boxAt(W, 1.2, 0.35, flat('#5b3a22'), 0, 0.6, -D / 2 + 0.05));
      g.add(this.boxAt(0.35, 1.2, D, flat('#5b3a22'), -W / 2 + 0.05, 0.6, 0));
    }

    // tableau des cours / mur d'écrans (vrais prix)
    this.tickerCanvas = document.createElement('canvas');
    this.tickerTex = new THREE.CanvasTexture(this.tickerCanvas);
    this.tickerTex.colorSpace = THREE.SRGBColorSpace;
    const wall = items.includes('mur');
    const tw = wall ? W * 0.8 : Math.min(12, W * 0.4);
    const th = wall ? Math.min(H * 0.55, tw / 4) : 2.4;
    // le canevas garde les proportions du panneau : texte net, non étiré
    this.tickerCanvas.height = 256;
    this.tickerCanvas.width = Math.min(4096, Math.round((256 * tw) / th));
    const ticker = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), new THREE.MeshBasicMaterial({ map: this.tickerTex, toneMapped: false }));
    ticker.position.set(0, H * 0.62, -D / 2 + 0.2);
    g.add(ticker);
    g.add(this.boxAt(tw + 0.5, th + 0.5, 0.1, flat('#0b0f17'), 0, H * 0.62 - (th + 0.5) / 2, -D / 2 + 0.05));
    this.drawTicker();

    // postes de travail
    const deskMat = flat(pal.desk);
    const chairMat = flat(style === 'classique' ? '#3b2416' : style === 'bunker' ? '#1f2937' : '#475569');
    const scrMats = this.screenTex.map((t) => new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(pal.screen, pal.screen, pal.screen) }));
    const bezel = flat('#111111');
    const staff = Math.max(1, hq?.staff ?? 3);
    const shirts = ['#f8fafc', '#bfdbfe', '#1e3a8a', '#e2e8f0', '#fde68a', '#94a3b8'];
    let seated = 0;
    const nScreens = style === 'bunker' ? 4 : tier >= 2 ? 3 : 2;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < perRow; k++) {
        const x = -W / 2 + 5 + k * (deskW + 1.6) + deskW / 2;
        const z = -D / 2 + 6 + r * 5;
        g.add(this.boxAt(deskW, 0.12, 1.6, deskMat, x, 0.95, z));
        g.add(this.boxAt(0.12, 0.9, 1.4, deskMat, x - deskW / 2 + 0.1, 0.45, z));
        g.add(this.boxAt(0.12, 0.9, 1.4, deskMat, x + deskW / 2 - 0.1, 0.45, z));
        for (let sI = 0; sI < nScreens; sI++) {
          const sx = x + (sI - (nScreens - 1) / 2) * 0.82;
          g.add(this.boxAt(0.78, 0.5, 0.06, bezel, sx, 1.55, z - 0.55));
          const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), scrMats[(r + k + sI) % 3]!);
          scr.position.set(sx, 1.55, z - 0.515);
          g.add(scr);
        }
        if (style === 'classique' && k % 2 === 0) {
          const lamp = this.boxAt(0.5, 0.2, 0.3, flat('#1f6b3a', { emissive: '#1f6b3a', emissiveIntensity: 0.4 }), x + deskW / 2 - 0.5, 1.3, z - 0.2);
          g.add(lamp);
        }
        // fauteuil + trader
        g.add(this.boxAt(0.8, 0.12, 0.8, chairMat, x, 0.55, z + 1.2));
        g.add(this.boxAt(0.8, 0.9, 0.12, chairMat, x, 0.6, z + 1.6));
        if (seated < staff) {
          seated++;
          const t = new THREE.Group();
          const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 2, 6), flat(shirts[Math.floor(rnd() * shirts.length)]!));
          bodyM.position.y = 1.0;
          t.add(bodyM);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), flat(['#f1c27d', '#c68642', '#8d5524', '#ffdbac'][Math.floor(rnd() * 4)]!));
          head.position.y = 1.62;
          head.name = 'head';
          t.add(head);
          t.position.set(x, 0, z + 1.15);
          g.add(t);
          this.traders.push({ mesh: t, base: t.position.clone(), seat: true, phase: rnd() * 10, span: 0 });
        }
      }
    // quelques personnes qui circulent dans les allées
    const walkers = Math.min(6, 1 + Math.floor(staff / 12) + tier);
    for (let k = 0; k < walkers; k++) {
      const t = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 2, 6), flat(shirts[k % shirts.length]!));
      bodyM.position.y = 0.95;
      t.add(bodyM);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), flat('#e0ac69'));
      head.position.y = 1.75;
      t.add(head);
      const z = -D / 2 + 3.4 + (k % rows) * 5;
      t.position.set(0, 0, z);
      g.add(t);
      this.traders.push({ mesh: t, base: t.position.clone(), seat: false, phase: rnd() * 10, span: W / 2 - 4 });
    }

    // décor selon le style
    if (style === 'openspace' || style === 'verriere') {
      for (let k = 0; k < 4 + tier * 2; k++) {
        const p = new THREE.Group();
        p.add(this.boxAt(0.7, 0.8, 0.7, flat('#e5e7eb'), 0, 0.4, 0));
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0), flat('#3f9b4f'));
        leaf.position.y = 1.5;
        p.add(leaf);
        p.position.set(k % 2 ? W / 2 - 1.5 : -W / 2 + 1.5, 0, -D / 2 + 2 + (k >> 1) * 4);
        g.add(p);
      }
    }
    // objets de prestige
    if (items.includes('trophees')) {
      g.add(this.boxAt(0.6, 0.1, 6, flat('#5b3a22'), -W / 2 + 0.5, 2.2, 0));
      for (let k = 0; k < 4; k++) {
        const ship = this.boxAt(0.3, 0.3, 1.2, flat(['#7b2d26', '#2471a3', '#d4ac0d', '#239b56'][k]!), -W / 2 + 0.5, 2.25, -2.2 + k * 1.5);
        g.add(ship);
      }
    }
    if (items.includes('art')) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 160;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f4efe6';
      x.fillRect(0, 0, 256, 160);
      for (let k = 0; k < 14; k++) {
        x.fillStyle = ['#d14d72', '#2a9d8f', '#e9c46a', '#264653', '#f4a261'][k % 5]!;
        x.globalAlpha = 0.8;
        x.beginPath();
        x.arc(20 + rnd() * 216, 20 + rnd() * 120, 8 + rnd() * 30, 0, Math.PI * 2);
        x.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const paint = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshBasicMaterial({ map: tex }));
      paint.rotation.y = Math.PI / 2;
      paint.position.set(-W / 2 + 0.2, H * 0.55, D / 4);
      g.add(paint);
      g.add(this.boxAt(0.1, 2.8, 4.3, flat('#c9a227', { metalness: 0.7 }), -W / 2 + 0.15, H * 0.55 - 1.4, D / 4));
    }
    if (items.includes('reception')) {
      const sofa = flat('#7c2d12');
      g.add(this.boxAt(4, 0.7, 1.2, sofa, W / 2 - 4, 0, D / 2 - 2));
      g.add(this.boxAt(1.2, 0.7, 3, sofa, W / 2 - 1.5, 0, D / 2 - 4));
      g.add(this.boxAt(1.6, 0.45, 1.6, flat('#d6d3d1'), W / 2 - 4, 0, D / 2 - 4.2));
    }
    if (items.includes('academie')) {
      g.add(this.boxAt(0.15, 2, 4, flat('#ffffff'), -W / 2 + 0.3, 1.2, -D / 4));
    }
    if (items.includes('bienetre')) {
      g.add(this.boxAt(5, 1.1, 1, flat('#a16207'), W / 2 - 4, 0, -D / 2 + 1.5));
      g.add(this.boxAt(0.6, 0.6, 0.6, flat('#1f2937'), W / 2 - 5, 1.1, -D / 2 + 1.5));
    }
    this.inScene.background = new THREE.Color(style === 'bunker' ? '#05080f' : style === 'verriere' ? '#bfe0f5' : '#18263a');
  }

  private boxAt(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    return m;
  }


  private drawTicker() {
    const c = this.tickerCanvas;
    if (!c || !this.tickerTex) return;
    const x = c.getContext('2d')!;
    const t = this.state?.tickers ?? [];
    x.fillStyle = '#050a12';
    x.fillRect(0, 0, c.width, c.height);
    const n = Math.max(1, t.length);
    const cols = Math.max(1, Math.min(n, Math.floor(c.width / 380)));
    const rows = Math.ceil(n / cols);
    const cw = c.width / cols;
    const ch = c.height / rows;
    t.forEach((k, i) => {
      const cx = (i % cols) * cw;
      const cy = Math.floor(i / cols) * ch;
      x.fillStyle = '#94a3b8';
      x.font = `bold ${Math.round(ch * 0.26)}px monospace`;
      x.fillText(k.label, cx + 14, cy + ch * 0.34, cw * 0.5);
      x.fillStyle = k.change >= 0 ? '#22c55e' : '#ef4444';
      x.textAlign = 'right';
      x.fillText(`${k.change >= 0 ? '▲' : '▼'}${(Math.abs(k.change) * 100).toFixed(2)}%`, cx + cw - 14, cy + ch * 0.34, cw * 0.4);
      x.textAlign = 'left';
      x.fillStyle = '#f8fafc';
      x.font = `bold ${Math.round(ch * 0.4)}px monospace`;
      x.fillText(k.price, cx + 14, cy + ch * 0.82);
    });
    this.tickerTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- boucle
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    const t = this.clock.elapsedTime;

    if (this.anim) {
      // durée réelle (pas de plafond par image) : la transition dure le même temps sur une machine lente
      const a = this.anim;
      a.t = Math.min(1, a.t + Math.min(raw, 0.5) / a.dur);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e);
      this.fogFar = a.fog0 + (a.fog1 - a.fog0) * e;
      if (a.t >= 1) {
        this.anim = null;
        a.done?.();
      }
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.far = this.fogFar;
    fog.near = Math.min(450, this.fogFar * 0.35);
    this.bMat.uniforms.fogFar!.value = fog.far;
    this.bMat.uniforms.fogNear!.value = fog.near;
    this.controls.update();

    if (!this.interior) {
      const lim = HALF * BLOCK + BLOCK / 2;
      if (this.walkerMesh) {
        this.walkers.forEach((w, k) => {
          const step = w.speed * dt * w.dir;
          if (w.axis === 0) w.x += step;
          else w.z += step;
          const p = w.axis === 0 ? w.x : w.z;
          if (Math.abs(p) > lim) w.dir = (w.dir * -1) as 1 | -1;
          const bob = Math.abs(Math.sin((t + w.phase) * 6)) * 0.25;
          this.q.setFromAxisAngle(this.v.set(0, 1, 0), w.axis === 0 ? (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : w.dir > 0 ? 0 : Math.PI);
          this.m4.compose(this.v.set(w.x, 0.8 + bob, w.z), this.q, this.one);
          this.walkerMesh!.setMatrixAt(k, this.m4);
        });
        this.walkerMesh.instanceMatrix.needsUpdate = true;
      }
      if (this.carMesh) {
        this.cars.forEach((c, k) => {
          c.pos += c.speed * dt * c.dir;
          if (c.pos > lim) c.pos = -lim;
          if (c.pos < -lim) c.pos = lim;
          this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.axis === 0 ? Math.PI / 2 : 0);
          this.m4.compose(c.axis === 0 ? this.v.set(c.pos, 0, c.lane) : this.v.set(c.lane, 0, c.pos), this.q, this.one);
          this.carMesh!.setMatrixAt(k, this.m4);
        });
        this.carMesh.instanceMatrix.needsUpdate = true;
      }
      if (this.ship) {
        this.ship.position.x += dt * 3;
        if (this.ship.position.x > 520) this.ship.position.x = -520;
        this.ship.position.y = 0.3 + Math.sin(t) * 0.2;
      }
      const flag = this.hqGroup.getObjectByName('flag');
      if (flag) flag.rotation.y = Math.sin(t * 2.5) * 0.25;
      const art = this.hqGroup.getObjectByName('art');
      if (art) art.rotation.y = t * 0.4;
      const rotor = this.hqGroup.getObjectByName('rotor');
      if (rotor) rotor.rotation.y = t * 0.6;
      this.hqGroup.children.forEach((c) => {
        if (c.name === 'staff') c.position.y = 2 + Math.abs(Math.sin(t * 2 + (c.userData.phase as number))) * 0.15;
      });
      this.sun.target.position.set(0, 0, 0);
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    } else {
      for (const tr of this.traders) {
        if (tr.seat) {
          const head = tr.mesh.getObjectByName('head');
          if (head) head.rotation.y = Math.sin(t * 0.7 + tr.phase) * 0.5;
          tr.mesh.position.y = Math.max(0, Math.sin(t * 1.3 + tr.phase) * 0.04);
        } else {
          tr.mesh.position.x = Math.sin(t * 0.25 + tr.phase) * tr.span;
          tr.mesh.position.y = Math.abs(Math.sin(t * 5 + tr.phase)) * 0.06;
          tr.mesh.rotation.y = Math.cos(t * 0.25 + tr.phase) > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      }
      this.renderer.render(this.inScene, this.camera);
    }
  };

  private updateLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const l of this.labels) {
      const p = this.v.copy(l.pos).project(this.camera);
      if (p.z > 1) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      l.el.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
    }
  }
}

/** Îlots réservés aux sièges des concurrents (autour du siège du joueur). */
const RIVAL_PLOTS: [number, number][] = [[2, 0], [-2, 0], [0, -2], [2, -2], [-2, -2], [1, -3], [-1, 2], [3, 1]];
