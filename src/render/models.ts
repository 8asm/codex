/** Modèles low-poly construits par code (aucun asset externe). */
import * as THREE from 'three';
import type { CommodityId } from '../engine/types';

const flat = (color: string | number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.05, ...extra });

/** Petit quartier : quelques immeubles colorés. `seed` rend chaque ville unique. */
export function buildCityCluster(seed: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const palette = ['#f7f1e3', '#ffd6a5', '#cdeac0', '#bde0fe', '#ffc8dd', '#e2ece9'];
  const rnd = (i: number) => {
    const x = Math.sin(seed * 91.7 + i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.016 * scale, 0.018 * scale, 0.002, 7), flat('#d9cfb8'));
  base.position.y = 0.001;
  g.add(base);
  const n = 5 + Math.floor(rnd(0) * 4);
  for (let i = 0; i < n; i++) {
    const h = (0.004 + rnd(i + 1) * 0.012) * scale;
    const w = (0.0035 + rnd(i + 2) * 0.003) * scale;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), flat(palette[Math.floor(rnd(i + 3) * palette.length)]!));
    const a = rnd(i + 4) * Math.PI * 2;
    const r = rnd(i + 5) * 0.011 * scale;
    m.position.set(Math.cos(a) * r, h / 2 + 0.002, Math.sin(a) * r);
    m.rotation.y = rnd(i + 6) * Math.PI;
    g.add(m);
    if (rnd(i + 7) > 0.6) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.75, w * 0.8, 4), flat('#e76f51'));
      roof.position.set(m.position.x, h + 0.002 + w * 0.4, m.position.z);
      roof.rotation.y = Math.PI / 4 + m.rotation.y;
      g.add(roof);
    }
  }
  return g;
}

/** Tour du siège du joueur, avec drapeau. */
export function buildHq(color = '#ffb703'): THREE.Group {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.006), flat('#fefae0'));
  tower.position.y = 0.017;
  g.add(tower);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.0066, 0.004, 0.0066), flat(color, { emissive: color, emissiveIntensity: 0.4 }));
  band.position.y = 0.029;
  g.add(band);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 0.012, 4), flat('#444'));
  pole.position.y = 0.038;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.0045, 0.0005), flat(color, { emissive: color, emissiveIntensity: 0.3 }));
  flag.position.set(0.0037, 0.0415, 0);
  flag.name = 'flag';
  g.add(flag);
  return g;
}

/** Petit décor par type de hub physique : cuves, sphère GNL, silo, mine, terril. */
export function buildHubProp(c: CommodityId): THREE.Object3D {
  const g = new THREE.Group();
  switch (c) {
    case 'BRENT': {
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.003, 10), flat('#f1f1f1'));
        t.position.set(i * 0.0062 - 0.006, 0.0015, 0);
        g.add(t);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0029, 0.0029, 0.0006, 10), flat('#ff8a3d'));
        top.position.set(t.position.x, 0.0032, 0);
        g.add(top);
      }
      break;
    }
    case 'TTF': {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), flat('#e9f5ff'));
      s.position.y = 0.0042;
      g.add(s);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.003, 0.0016, 8), flat('#4cc3ff'));
      leg.position.y = 0.0008;
      g.add(leg);
      break;
    }
    case 'CU': {
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.008 - i * 0.0016, 0.0085 - i * 0.0016, 0.001, 9), flat(i % 2 ? '#c46a3a' : '#e8875b'));
        r.position.y = 0.0005 + i * 0.001;
        g.add(r);
      }
      break;
    }
    case 'WHEAT': {
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.009, 8), flat('#f2e2b0'));
        s.position.set(i * 0.005 - 0.0025, 0.0045, 0);
        g.add(s);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.0024, 0.002, 8), flat('#c9a227'));
        cap.position.set(s.position.x, 0.01, 0);
        g.add(cap);
      }
      break;
    }
    case 'API2': {
      const heap = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.004, 7), flat('#2b2d31'));
      heap.position.y = 0.002;
      g.add(heap);
      const heap2 = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.003, 7), flat('#3b3e44'));
      heap2.position.set(0.006, 0.0015, 0.002);
      g.add(heap2);
      break;
    }
  }
  return g;
}

/** Personnage du joueur (pion stylisé). */
export function buildAvatar(color = '#ffb703'): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.0032, 0.009, 8), flat(color));
  body.position.y = 0.0045;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), flat('#ffe8d6'));
  head.position.y = 0.0105;
  g.add(head);
  const brief = new THREE.Mesh(new THREE.BoxGeometry(0.0026, 0.0018, 0.0008), flat('#5a3e2b'));
  brief.position.set(0.0034, 0.003, 0);
  g.add(brief);
  return g;
}

/** Avion low-poly orienté le long de +Z, « haut » en +Y. */
export function buildPlane(): THREE.Group {
  const g = new THREE.Group();
  const s = 0.9;
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.0016 * s, 0.0012 * s, 0.014 * s, 8), flat('#ffffff'));
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.0016 * s, 0.003 * s, 8), flat('#ffffff'));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.0085 * s;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.016 * s, 0.0005 * s, 0.0035 * s), flat('#e63946'));
  wing.position.z = 0.0005 * s;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.006 * s, 0.0004 * s, 0.002 * s), flat('#e63946'));
  tail.position.z = -0.0062 * s;
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.0004 * s, 0.003 * s, 0.002 * s), flat('#e63946'));
  fin.position.set(0, 0.0015 * s, -0.0062 * s);
  g.add(fin);
  return g;
}
