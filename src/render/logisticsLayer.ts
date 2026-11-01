/**
 * Couche logistique du globe : trafic maritime d'ambiance (instancié), cargaisons du joueur le long des
 * vraies routes (détroits, canaux), lignes des routes, rails et pipelines animés, actifs industriels.
 */
import * as THREE from 'three';
import { LAND_LINKS, SEA_EDGES, SEA_NODES, TRADE_LANES } from '../data/routes';
import { seaRoute } from '../engine/logistics';
import { latLonToVec3 } from './geo';

const NODE = Object.fromEntries(SEA_NODES.map((n) => [n.id, n]));
const R_SEA = 1.003;

const flat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, ...extra });

/** Échantillonne une polyligne lat/lon en points 3D le long des grands cercles. */
export function samplePath(latlons: [number, number][], r = R_SEA, step = 0.01): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < latlons.length - 1; i++) {
    const a = latLonToVec3(latlons[i]![0], latlons[i]![1], 1);
    const b = latLonToVec3(latlons[i + 1]![0], latlons[i + 1]![1], 1);
    const ang = a.angleTo(b);
    const n = Math.max(2, Math.ceil(ang / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const s = Math.sin(ang) || 1;
      const p = ang < 1e-6 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(b.clone().multiplyScalar(Math.sin(t * ang) / s));
      pts.push(p.normalize().multiplyScalar(r));
    }
  }
  const last = latlons[latlons.length - 1]!;
  pts.push(latLonToVec3(last[0], last[1], r));
  return pts;
}

function pathLatLon(nodes: string[]): [number, number][] {
  return nodes.map((id) => [NODE[id]!.lat, NODE[id]!.lon]);
}

/** Position et orientation le long d'une polyligne (t ∈ [0,1]). */
function along(pts: THREE.Vector3[], t: number, outPos: THREE.Vector3, outDir: THREE.Vector3) {
  const f = Math.max(0, Math.min(0.9999, t)) * (pts.length - 1);
  const i = Math.floor(f);
  const a = pts[i]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
  outPos.copy(a).lerp(b, f - i);
  outDir.copy(b).sub(a).normalize();
}

function buildShip(kind: 'tanker' | 'bulk', color: string): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0012, 0.011), flat(color));
  hull.position.y = 0.0006;
  g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.00175, 0.003, 4), flat(color));
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.0006, 0.0068);
  g.add(bow);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.0022, 0.0018), flat('#f8fafc'));
  bridge.position.set(0, 0.0022, -0.0042);
  g.add(bridge);
  if (kind === 'bulk') {
    for (let k = 0; k < 3; k++) {
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.0026, 0.0004, 0.0018), flat('#78350f'));
      hatch.position.set(0, 0.0014, -0.001 + k * 0.0024);
      g.add(hatch);
    }
  } else {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0006, 0.008), flat('#e5e7eb'));
    deck.position.set(0, 0.0014, 0.0005);
    g.add(deck);
  }
  return g;
}

export interface VoyageView {
  id: string;
  path: string[];
  fromLatLon?: [number, number][];
  departDay: number;
  arriveDay: number;
  kind: 'tanker' | 'bulk';
  color: string;
}

export interface AssetView {
  id: string;
  type: string;
  lat: number;
  lon: number;
  status: string;
}

interface Ambient {
  pts: THREE.Vector3[];
  phase: number;
  speed: number;
  kind: number;
}

export class LogisticsLayer {
  private group = new THREE.Group();
  private lanes: THREE.LineSegments;
  private ambient: Ambient[] = [];
  private instTanker: THREE.InstancedMesh;
  private instBulk: THREE.InstancedMesh;
  private instBridgeT: THREE.InstancedMesh;
  private instBridgeB: THREE.InstancedMesh;
  private voyages = new Map<string, { mesh: THREE.Group; pts: THREE.Vector3[]; v: VoyageView; line: THREE.Line }>();
  private assets = new Map<string, THREE.Group>();
  private pipes: { mat: THREE.MeshBasicMaterial }[] = [];
  private trains: { mesh: THREE.Mesh; pts: THREE.Vector3[]; phase: number }[] = [];
  private tmpP = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    // routes maritimes (calque)
    const seg: number[] = [];
    for (const [a, b] of SEA_EDGES) {
      const pts = samplePath([[NODE[a]!.lat, NODE[a]!.lon], [NODE[b]!.lat, NODE[b]!.lon]], 1.0025, 0.02);
      for (let i = 0; i < pts.length - 1; i++) seg.push(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.y, pts[i + 1]!.z);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.lanes = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#bae6fd', transparent: true, opacity: 0.35 }));
    this.lanes.visible = false;
    this.group.add(this.lanes);
    // trafic d'ambiance
    const lanes = TRADE_LANES.map(([a, b]) => seaRoute(a, b)).filter(Boolean) as { path: string[] }[];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 36; i++) {
      const l = lanes[i % lanes.length]!;
      const pts = samplePath(pathLatLon(rnd() < 0.5 ? l.path : [...l.path].reverse()), R_SEA, 0.012);
      this.ambient.push({ pts, phase: rnd(), speed: 0.004 + 0.004 * rnd(), kind: i % 2 });
    }
    const tanker = buildShip('tanker', '#991b1b');
    const bulk = buildShip('bulk', '#334155');
    this.instTanker = this.instanced(tanker, 18, 0);
    this.instBulk = this.instanced(bulk, 18, 0);
    this.instBridgeT = this.instanced(tanker, 18, 2);
    this.instBridgeB = this.instanced(bulk, 18, 2);
    // rails, barges et pipelines
    for (const link of LAND_LINKS) {
      const pts = samplePath(link.path, 1.0025, 0.006);
      if (link.kind === 'pipeline') {
        const curve = new THREE.CatmullRomCurve3(pts);
        const mat = new THREE.MeshBasicMaterial({ color: link.zone ? '#f97316' : '#fbbf24', transparent: true, opacity: 0.9 });
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), 0.0012, 6, false), mat);
        tube.userData.zone = link.zone;
        this.group.add(tube);
        this.pipes.push({ mat });
      } else {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: link.kind === 'rail' ? '#e5e7eb' : '#7dd3fc', dashSize: 0.004, gapSize: 0.003 }));
        line.computeLineDistances();
        this.group.add(line);
        for (let k = 0; k < 2; k++) {
          const train = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.0014, 0.0014), flat(link.kind === 'rail' ? '#facc15' : '#38bdf8'));
          this.group.add(train);
          this.trains.push({ mesh: train, pts, phase: k * 0.5 });
        }
      }
    }
  }

  private instanced(proto: THREE.Group, n: number, part: number) {
    // une InstancedMesh par pièce du modèle (coque, superstructure), mêmes matrices
    const mesh = proto.children[part] as THREE.Mesh;
    const geo = mesh.geometry.clone().translate(mesh.position.x, mesh.position.y, mesh.position.z).scale(1.4, 1.4, 1.4);
    const inst = new THREE.InstancedMesh(geo, mesh.material as THREE.Material, n);
    inst.frustumCulled = false;
    this.group.add(inst);
    return inst;
  }

  setRoutesVisible(v: boolean) {
    this.lanes.visible = v;
  }

  setSanctionedZones(zones: Set<string>) {
    for (const child of this.group.children) {
      const z = child.userData.zone as string | undefined;
      if (z && (child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(zones.has(z) ? '#ef4444' : '#f97316');
    }
  }

  setVoyages(list: VoyageView[]) {
    const ids = new Set(list.map((v) => v.id));
    for (const [id, x] of this.voyages) {
      if (!ids.has(id)) {
        this.group.remove(x.mesh, x.line);
        x.line.geometry.dispose();
        this.voyages.delete(id);
      }
    }
    for (const v of list) {
      if (this.voyages.has(v.id)) continue;
      const pts = samplePath([...(v.fromLatLon ?? []), ...pathLatLon(v.path)], 1.004, 0.01);
      const mesh = buildShip(v.kind, v.color);
      mesh.scale.setScalar(1.8);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#ffd166', dashSize: 0.01, gapSize: 0.006, transparent: true, opacity: 0.9 }));
      line.computeLineDistances();
      this.group.add(mesh, line);
      this.voyages.set(v.id, { mesh, pts, v, line });
    }
  }

  setAssets(list: AssetView[]) {
    const ids = new Set(list.map((a) => a.id));
    for (const [id, g] of this.assets) if (!ids.has(id)) { this.group.remove(g); this.assets.delete(id); }
    for (const a of list) {
      let g = this.assets.get(a.id);
      if (!g) {
        g = buildAsset(a.type);
        const pos = latLonToVec3(a.lat, a.lon, 1);
        g.position.copy(pos);
        g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
        g.scale.setScalar(1.6);
        this.group.add(g);
        this.assets.set(a.id, g);
      }
      const ring = g.getObjectByName('status') as THREE.Mesh | undefined;
      if (ring) (ring.material as THREE.MeshBasicMaterial).color.set(a.status === 'operating' ? '#22c55e' : a.status === 'building' ? '#94a3b8' : a.status === 'maintenance' ? '#facc15' : '#ef4444');
      g.userData.status = a.status;
    }
  }

  update(t: number, simDay: number) {
    let ti = 0, bi = 0;
    for (const s of this.ambient) {
      const u = (s.phase + t * s.speed) % 1;
      along(s.pts, u, this.tmpP, this.tmpD);
      this.orient(this.tmpP, this.tmpD);
      if (s.kind === 0 && ti < 18) {
        this.instTanker.setMatrixAt(ti, this.m4);
        this.instBridgeT.setMatrixAt(ti++, this.m4);
      } else if (bi < 18) {
        this.instBulk.setMatrixAt(bi, this.m4);
        this.instBridgeB.setMatrixAt(bi++, this.m4);
      }
    }
    for (const [im, n] of [[this.instTanker, ti], [this.instBridgeT, ti], [this.instBulk, bi], [this.instBridgeB, bi]] as const) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
    for (const x of this.voyages.values()) {
      const p = (simDay - x.v.departDay) / Math.max(1, x.v.arriveDay - x.v.departDay);
      along(x.pts, p, this.tmpP, this.tmpD);
      x.mesh.position.copy(this.tmpP);
      x.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.tmpP.clone().add(this.tmpD), this.tmpP, this.tmpP.clone().normalize()));
      x.line.geometry.setDrawRange(Math.floor(Math.max(0, Math.min(1, p)) * x.pts.length), x.pts.length);
    }
    for (const tr of this.trains) {
      along(tr.pts, (tr.phase + t * 0.03) % 1, this.tmpP, this.tmpD);
      tr.mesh.position.copy(this.tmpP);
      tr.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.tmpP.clone().add(this.tmpD), this.tmpP, this.tmpP.clone().normalize()));
    }
    const pulse = 0.65 + 0.35 * Math.sin(t * 2.5);
    for (const p of this.pipes) p.mat.opacity = pulse;
    // animations des actifs : balancier du derrick, torchère de la raffinerie
    for (const g of this.assets.values()) {
      const on = g.userData.status === 'operating';
      const beam = g.getObjectByName('beam');
      if (beam && on) beam.rotation.z = Math.sin(t * 2.2) * 0.35;
      const flare = g.getObjectByName('flare');
      if (flare) flare.scale.setScalar(on ? 0.8 + 0.4 * Math.abs(Math.sin(t * 9)) : 0.01);
    }
  }

  private orient(pos: THREE.Vector3, dir: THREE.Vector3) {
    const up = pos.clone().normalize();
    this.m4.lookAt(pos.clone().add(dir), pos, up);
    this.q.setFromRotationMatrix(this.m4);
    this.m4.compose(pos, this.q, new THREE.Vector3(1, 1, 1));
  }
}

/** Modèles low-poly des actifs industriels. */
function buildAsset(type: string): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.0095, 24), new THREE.MeshBasicMaterial({ color: '#22c55e', side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0004;
  ring.name = 'status';
  g.add(ring);
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
    const m = new THREE.Mesh(geo, flat(color, extra));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (type) {
    case 'oilfield': {
      add(new THREE.CylinderGeometry(0.0004, 0.0012, 0.008, 4), '#475569', 0, 0.004, -0.003);
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.0045, 0.001);
      pivot.name = 'beam';
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.0008, 0.0008), flat('#f59e0b'));
      pivot.add(beam);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.0022, 0.001), flat('#f59e0b'));
      head.position.x = 0.004;
      pivot.add(head);
      g.add(pivot);
      add(new THREE.BoxGeometry(0.0008, 0.0045, 0.0008), '#64748b', 0, 0.0022, 0.001);
      break;
    }
    case 'mine_cu':
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.0075 - i * 0.0015, 0.008 - i * 0.0015, 0.0008, 10), i % 2 ? '#c2410c' : '#ea580c', 0, 0.0004 + i * 0.0008, 0);
      break;
    case 'mine_coal':
      add(new THREE.ConeGeometry(0.0055, 0.004, 7), '#1f2937', -0.002, 0.002, 0);
      add(new THREE.BoxGeometry(0.0025, 0.006, 0.0025), '#9ca3af', 0.004, 0.003, 0);
      break;
    case 'refinery': {
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.0011, 0.0011, 0.007 + i * 0.001, 8), '#e5e7eb', -0.003 + i * 0.003, 0.0035, 0);
      add(new THREE.CylinderGeometry(0.0003, 0.0003, 0.011, 4), '#6b7280', 0.005, 0.0055, 0.003);
      const flare = add(new THREE.ConeGeometry(0.0009, 0.0025, 6), '#f97316', 0.005, 0.0122, 0.003, { emissive: '#f97316', emissiveIntensity: 1.5 });
      flare.name = 'flare';
      break;
    }
    case 'tank':
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.0022, 0.0022, 0.0025, 12), '#f1f5f9', (i % 2) * 0.005 - 0.0025, 0.00125, Math.floor(i / 2) * 0.005 - 0.0025);
      break;
    case 'warehouse':
      add(new THREE.BoxGeometry(0.009, 0.0035, 0.005), '#cbd5e1', 0, 0.00175, 0);
      add(new THREE.BoxGeometry(0.0092, 0.001, 0.0052), '#ea580c', 0, 0.004, 0);
      break;
    case 'silo':
      for (let i = 0; i < 3; i++) {
        add(new THREE.CylinderGeometry(0.0016, 0.0016, 0.008, 10), '#fef3c7', -0.0035 + i * 0.0035, 0.004, 0);
        add(new THREE.ConeGeometry(0.0017, 0.0015, 10), '#ca8a04', -0.0035 + i * 0.0035, 0.0087, 0);
      }
      break;
    case 'gas_storage':
      add(new THREE.SphereGeometry(0.0045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#bae6fd', 0, 0, 0);
      add(new THREE.CylinderGeometry(0.0004, 0.0004, 0.006, 4), '#0ea5e9', 0.005, 0.003, 0);
      break;
    case 'terminal':
      add(new THREE.BoxGeometry(0.01, 0.001, 0.003), '#475569', 0, 0.0005, 0);
      add(new THREE.BoxGeometry(0.0007, 0.007, 0.0007), '#facc15', -0.002, 0.0035, 0);
      add(new THREE.BoxGeometry(0.006, 0.0006, 0.0006), '#facc15', 0.0005, 0.007, 0);
      break;
  }
  return g;
}
