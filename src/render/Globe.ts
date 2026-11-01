/**
 * Vue globe (Three.js pur, indépendante de React).
 * Le rendu ne lit l'état du jeu que via `setView` et le callback `frameInfo` : aucun couplage au moteur.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import type { City, CommodityId } from '../engine/types';
import { arcPoint, latLonToVec3 } from './geo';
import { buildAvatar, buildCityCluster, buildHq, buildHubProp, buildPlane } from './models';
import { buildTextures, drawOverlay } from './textures';
import { LogisticsLayer, type AssetView, type VoyageView } from './logisticsLayer';

export interface GlobeMarker {
  id: string;
  lat: number;
  lon: number;
  icon: string;
  label: string;
  tone?: 'alert' | 'info' | 'weather';
}

export interface GlobeOverlay {
  key: string; // change => texture régénérée
  countries: Record<number, string>; // code ISO numérique -> couleur CSS
  blobs: { lat: number; lon: number; r: number; color: string }[];
}

export interface GlobeView {
  hqCity: string;
  playerCity: string | null;
  travel: { from: string; to: string } | null;
  selectedCity: string | null;
  /** villes où le joueur a des positions physiques (anneau coloré) */
  activeCities: Record<string, string>;
  markers?: GlobeMarker[];
  cityBadges?: Record<string, { initials: string; color: string; title: string; rival?: boolean }[]>;
  cityChips?: Record<string, { text: string; tone: 'pos' | 'neg' | 'flat' }[]>;
  overlay?: GlobeOverlay | null;
  voyages?: VoyageView[];
  assets?: AssetView[];
  showRoutes?: boolean;
  sanctionedZones?: string[];
}

export interface GlobeOptions {
  cities: City[];
  onCityClick: (id: string) => void;
  /** appelé à chaque frame : progression du vol en cours (0..1) */
  travelProgress: () => number | null;
  /** jour de simulation fractionnaire (pour animer les navires entre deux clôtures) */
  simDay: () => number;
}

const EARTH_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const EARTH_FS = /* glsl */ `
uniform sampler2D map;
uniform sampler2D mask;
uniform sampler2D lights;
uniform vec3 sunDir;
uniform float time;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 col = texture2D(map, vUv).rgb;
  float land = texture2D(mask, vUv).r;
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vPosW);
  float ndl = dot(n, sunDir);
  float day = smoothstep(-0.18, 0.22, ndl);
  // houle animée sur l'océan
  float w = sin(vUv.x * 900.0 + time * 1.3) * sin(vUv.y * 450.0 - time * 0.9)
          + 0.5 * sin(vUv.x * 2100.0 - vUv.y * 900.0 + time * 2.1);
  vec3 sea = col * (1.0 + 0.05 * w * (1.0 - land));
  vec3 h = normalize(sunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * (1.0 - land) * 0.7;
  vec3 lit = sea * (0.42 + 0.78 * max(ndl, 0.0)) + vec3(1.0, 0.95, 0.85) * spec;
  vec3 night = col * vec3(0.10, 0.13, 0.24) + vec3(0.01, 0.02, 0.06);
  float lv = texture2D(lights, vUv).r;
  night += vec3(1.0, 0.78, 0.42) * lv * 1.1 * land;
  vec3 c = mix(night, lit, day);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  c += vec3(0.35, 0.65, 1.0) * fres * (0.15 + 0.25 * day);
  gl_FragColor = vec4(c, 1.0);
}`;

const ATMO_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FS = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 v = normalize(cameraPosition - vP);
  float i = pow(clamp(0.62 - dot(vN, v), 0.0, 1.0), 2.2);
  gl_FragColor = vec4(0.4, 0.72, 1.0, 1.0) * i * 0.9;
}`;

interface CityNode {
  city: City;
  pos: THREE.Vector3;
  group: THREE.Group;
  label: HTMLDivElement;
  ring: THREE.Mesh;
}

export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private earthMat: THREE.ShaderMaterial;
  private clouds: THREE.Mesh;
  private sun = new THREE.DirectionalLight('#fff6e0', 2.2);
  private nodes: CityNode[] = [];
  private nodeById: Record<string, CityNode> = {};
  private hq: THREE.Group;
  private avatar: THREE.Group;
  private plane: THREE.Group;
  private trail: THREE.Line;
  private trailKey = '';
  private view: GlobeView | null = null;
  private labelLayer: HTMLDivElement;
  private raf = 0;
  private clock = new THREE.Clock();
  private focusAnim: null | { from: THREE.Vector3; to: THREE.Vector3; t: number; dist0: number; dist1: number } = null;
  private resizeObs: ResizeObserver;
  private overlayMesh: THREE.Mesh;
  private overlayKey = '';
  private markerEls = new Map<string, { el: HTMLDivElement; pos: THREE.Vector3 }>();
  private logistics: LogisticsLayer;

  constructor(private container: HTMLElement, private opts: GlobeOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#071426');
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'globe-labels';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    this.camera.position.set(0, 0.6, 3.1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.18;
    this.controls.maxDistance = 5;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.addEventListener('start', () => (this.focusAnim = null));

    this.buildStarfield();
    const tex = buildTextures(opts.cities);
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: EARTH_VS,
      fragmentShader: EARTH_FS,
      uniforms: {
        map: { value: tex.color },
        mask: { value: tex.mask },
        lights: { value: tex.lights },
        sunDir: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
        time: { value: 0 },
      },
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.earthMat);
    this.scene.add(earth);

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.012, 96, 64),
      new THREE.MeshLambertMaterial({ map: tex.clouds, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.scene.add(this.clouds);

    this.overlayMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.004, 96, 64),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.overlayMesh.visible = false;
    this.scene.add(this.overlayMesh);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 64, 48),
      new THREE.ShaderMaterial({ vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.scene.add(atmo);

    this.scene.add(new THREE.HemisphereLight('#cfe8ff', '#2a3b55', 0.9));
    this.scene.add(this.sun);

    // villes
    const hubsByCity: Record<string, CommodityId[]> = {};
    for (const c of COMMODITY_IDS)
      for (const l of COMMODITIES[c].physical.locations) (hubsByCity[l.cityId] ??= []).includes(c) || hubsByCity[l.cityId]!.push(c);
    opts.cities.forEach((city, i) => {
      const pos = latLonToVec3(city.lat, city.lon, 1);
      const group = new THREE.Group();
      group.position.copy(pos);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
      group.add(buildCityCluster(i + 1));
      (hubsByCity[city.id] ?? []).forEach((c, j) => {
        const prop = buildHubProp(c);
        const a = (j / 3) * Math.PI * 2 + 0.6;
        prop.position.set(Math.cos(a) * 0.024, 0, Math.sin(a) * 0.024);
        group.add(prop);
      });
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.026, 0.03, 40),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.0015;
      group.add(ring);
      this.scene.add(group);
      const label = document.createElement('div');
      label.className = 'city-label';
      label.innerHTML = `<span class="dot"></span><span class="name">${city.name}</span>`;
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onCityClick(city.id);
      });
      this.labelLayer.appendChild(label);
      const node = { city, pos, group, label, ring };
      this.nodes.push(node);
      this.nodeById[city.id] = node;
    });

    this.logistics = new LogisticsLayer(this.scene);
    this.hq = buildHq();
    this.hq.position.set(-0.004, 0, -0.004);
    this.avatar = buildAvatar();
    this.plane = buildPlane();
    this.plane.visible = false;
    this.scene.add(this.plane);
    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.85 }),
    );
    this.trail.visible = false;
    this.scene.add(this.trail);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  private buildStarfield() {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 20);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfe3ff', size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.8 })));
  }

  setView(v: GlobeView) {
    const prevHq = this.view?.hqCity;
    this.view = v;
    if (prevHq !== v.hqCity) {
      this.hq.removeFromParent();
      this.nodeById[v.hqCity]?.group.add(this.hq);
    }
    this.avatar.removeFromParent();
    if (v.playerCity) {
      const n = this.nodeById[v.playerCity];
      if (n) {
        this.avatar.position.set(0.012, 0, 0.01);
        n.group.add(this.avatar);
      }
    }
    for (const n of this.nodes) {
      const mat = n.ring.material as THREE.MeshBasicMaterial;
      const act = v.activeCities[n.city.id];
      const sel = v.selectedCity === n.city.id;
      mat.opacity = sel ? 0.95 : act ? 0.7 : 0;
      mat.color.set(sel ? '#ffffff' : act ?? '#ffffff');
      n.label.classList.toggle('selected', sel);
      n.label.classList.toggle('hq', v.hqCity === n.city.id);
      n.label.classList.toggle('here', v.playerCity === n.city.id);
    }
    for (const n of this.nodes) {
      const badges = v.cityBadges?.[n.city.id] ?? [];
      const chips = v.cityChips?.[n.city.id] ?? [];
      const html = `<span class="dot"></span><span class="name">${n.city.name}</span>` +
        (badges.length ? `<span class="badges">${badges.slice(0, 4).map((b) => `<i class="${b.rival ? 'rival' : ''}" style="background:${b.color}" title="${b.title}">${b.initials}</i>`).join('')}${badges.length > 4 ? `<i class="more">+${badges.length - 4}</i>` : ''}</span>` : '') +
        (chips.length ? `<span class="chips">${chips.map((c) => `<b class="${c.tone}">${c.text}</b>`).join('')}</span>` : '');
      if (n.label.dataset.html !== html) {
        n.label.innerHTML = html;
        n.label.dataset.html = html;
      }
    }
    // marqueurs d'événements
    const ids = new Set((v.markers ?? []).map((m) => m.id));
    for (const [id, m] of this.markerEls) if (!ids.has(id)) { m.el.remove(); this.markerEls.delete(id); }
    for (const mk of v.markers ?? []) {
      let m = this.markerEls.get(mk.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = `globe-marker ${mk.tone ?? 'info'}`;
        this.labelLayer.appendChild(el);
        m = { el, pos: latLonToVec3(mk.lat, mk.lon, 1) };
        this.markerEls.set(mk.id, m);
      }
      m.el.innerHTML = `<span class="icon">${mk.icon}</span><span class="txt">${mk.label}</span>`;
      m.pos = latLonToVec3(mk.lat, mk.lon, 1);
    }
    this.logistics.setVoyages(v.voyages ?? []);
    this.logistics.setAssets(v.assets ?? []);
    this.logistics.setRoutesVisible(!!v.showRoutes);
    this.logistics.setSanctionedZones(new Set(v.sanctionedZones ?? []));
    // calque géopolitique
    if (v.overlay) {
      if (v.overlay.key !== this.overlayKey) {
        this.overlayKey = v.overlay.key;
        const mat = this.overlayMesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = drawOverlay(v.overlay);
        mat.needsUpdate = true;
      }
      this.overlayMesh.visible = true;
    } else this.overlayMesh.visible = false;

    const key = v.travel ? `${v.travel.from}>${v.travel.to}` : '';
    if (key !== this.trailKey) {
      this.trailKey = key;
      if (v.travel) {
        const a = this.nodeById[v.travel.from]!.pos.clone().normalize();
        const b = this.nodeById[v.travel.to]!.pos.clone().normalize();
        const pts: THREE.Vector3[] = [];
        const hgt = this.arcHeight(a, b);
        for (let i = 0; i <= 96; i++) pts.push(arcPoint(a, b, i / 96, hgt));
        this.trail.geometry.dispose();
        this.trail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
        this.trail.computeLineDistances();
        this.trail.visible = true;
        this.plane.visible = true;
      } else {
        this.trail.visible = false;
        this.plane.visible = false;
      }
    }
  }

  private arcHeight(a: THREE.Vector3, b: THREE.Vector3) {
    return 0.02 + 0.13 * (a.angleTo(b) / Math.PI);
  }

  /** Centre la caméra sur une ville avec une transition douce. */
  focusCity(id: string, zoom = true) {
    const n = this.nodeById[id];
    if (!n) return;
    const dist0 = this.camera.position.length();
    this.focusAnim = {
      from: this.camera.position.clone().normalize(),
      to: n.pos.clone().normalize().add(new THREE.Vector3(0, 0.25, 0)).normalize(),
      t: 0,
      dist0,
      dist1: zoom ? Math.min(dist0, 2.0) : dist0,
    };
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

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.earthMat.uniforms.time!.value = t;
    // Soleil lié à la caméra avec un balancement lent : la face regardée reste lumineuse (lisibilité),
    // et le terminateur jour/nuit balaie le globe pour l'ambiance.
    const swing = 0.55 + 0.75 * Math.sin(t * ((Math.PI * 2) / 150));
    const sunDir = this.camera.position.clone().normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), swing);
    sunDir.y += 0.35;
    sunDir.normalize();
    (this.earthMat.uniforms.sunDir!.value as THREE.Vector3).copy(sunDir);
    this.sun.position.copy(sunDir).multiplyScalar(10);
    this.clouds.rotation.y += dt * 0.006;
    this.logistics.update(t, this.opts.simDay());

    if (this.focusAnim) {
      const f = this.focusAnim;
      f.t = Math.min(1, f.t + dt / 1.1);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - (-2 * f.t + 2) ** 2 / 2;
      const dir = this.tmp.copy(f.from).lerp(f.to, e).normalize();
      this.camera.position.copy(dir.multiplyScalar(f.dist0 + (f.dist1 - f.dist0) * e));
      if (f.t >= 1) this.focusAnim = null;
    }
    this.controls.update();

    // drapeau qui ondule, avatar qui sautille
    const flag = this.hq.getObjectByName('flag');
    if (flag) flag.rotation.y = Math.sin(t * 3) * 0.25;
    this.avatar.position.y = Math.abs(Math.sin(t * 3)) * 0.0015;

    // avion
    if (this.view?.travel && this.plane.visible) {
      const p = Math.max(0, Math.min(1, this.opts.travelProgress() ?? 0));
      const A = this.nodeById[this.view.travel.from]!.pos.clone().normalize();
      const B = this.nodeById[this.view.travel.to]!.pos.clone().normalize();
      const hgt = this.arcHeight(A, B);
      const cur = arcPoint(A, B, p, hgt, this.tmp);
      const nxt = arcPoint(A, B, Math.min(1, p + 0.01), hgt, this.tmp2);
      this.plane.position.copy(cur);
      const up = cur.clone().normalize();
      const m = new THREE.Matrix4().lookAt(nxt, cur, up);
      this.plane.quaternion.setFromRotationMatrix(m);
      const s = 1.3 + 0.6 * Math.sin(Math.PI * p);
      this.plane.scale.setScalar(s);
      this.trail.geometry.setDrawRange(Math.floor(p * 97), 97);
    }

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  };

  private updateLabels() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camDir = this.camera.position.clone().normalize();
    const dist = this.camera.position.length();
    for (const n of this.nodes) {
      const facing = n.pos.clone().normalize().dot(camDir);
      const visible = facing > 0.25;
      if (!visible) {
        n.label.style.display = 'none';
        continue;
      }
      const p = n.pos.clone().multiplyScalar(1.02).project(this.camera);
      n.label.style.display = '';
      n.label.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h - 6}px)`;
      n.label.style.opacity = String(Math.min(1, (facing - 0.25) * 4));
      n.label.classList.toggle('compact', dist > 3.6);
    }
    for (const m of this.markerEls.values()) {
      const facing = m.pos.clone().normalize().dot(camDir);
      if (facing < 0.2) { m.el.style.display = 'none'; continue; }
      const p = m.pos.clone().multiplyScalar(1.03).project(this.camera);
      m.el.style.display = '';
      m.el.style.transform = `translate(-50%, -50%) translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}
