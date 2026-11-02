/**
 * Monuments des villes mythiques, en volumes simples (même style « maquette » que le reste de la vue ville).
 * Un ou deux monuments par ville au plus, posés sur des îlots réservés derrière le siège (visibles dans le cadrage
 * par défaut). Unités : mètres de la scène (un îlot fait 60 m de côté, les immeubles 10 à 80 m).
 */
import * as THREE from 'three';

const mat = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...extra });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Pyramide tronquée à base carrée (pieds, flèches), orientée « carré » face à la rue. */
function frustum(rBottom: number, rTop: number, h: number, m: THREE.Material, y0 = 0): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 4, 1).rotateY(Math.PI / 4).translate(0, y0 + h / 2, 0);
  return mesh(g, m);
}

/** Tour en treillis à quatre pieds (tour Eiffel, tour de Tokyo). */
function latticeTower(h: number, colors: [string, string?]): THREE.Group {
  const g = new THREE.Group();
  const m1 = mat(colors[0], { metalness: 0.3 });
  const m2 = mat(colors[1] ?? colors[0], { metalness: 0.3 });
  const base = h * 0.34;
  // quatre pieds inclinés jusqu'au premier étage
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = mesh(new THREE.BoxGeometry(base * 0.16, h * 0.3, base * 0.16), m1);
    leg.position.set((sx! * base) / 3.2, h * 0.14, (sz! * base) / 3.2);
    leg.rotation.set(-sz! * 0.42, 0, sx! * 0.42);
    g.add(leg);
  }
  g.add(mesh(new THREE.BoxGeometry(base * 0.62, h * 0.025, base * 0.62), m2, 0, h * 0.27, 0)); // 1er étage
  g.add(frustum(base * 0.3, base * 0.17, h * 0.33, m1, h * 0.28));
  g.add(mesh(new THREE.BoxGeometry(base * 0.3, h * 0.02, base * 0.3), m2, 0, h * 0.61, 0)); // 2e étage
  g.add(frustum(base * 0.14, base * 0.04, h * 0.33, m1, h * 0.62));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.6, h * 0.06, 6), m2, 0, h * 0.98, 0)); // antenne
  return g;
}

function eiffel(): THREE.Group {
  const g = latticeTower(130, ['#8a6a45', '#a8835a']);
  // arches du premier étage (signature)
  const arch = new THREE.TorusGeometry(10, 1.1, 6, 16, Math.PI);
  for (const r of [0, Math.PI / 2]) {
    const a = mesh(arch.clone(), mat('#8a6a45'), 0, 22, 0);
    a.rotation.y = r;
    g.add(a);
  }
  return g;
}

function tokyoTower(): THREE.Group {
  const g = latticeTower(140, ['#e8452c', '#f3f4f6']);
  g.add(mesh(new THREE.BoxGeometry(16, 6, 16), mat('#f3f4f6'), 0, 62, 0)); // observatoire principal
  return g;
}

function bigBen(): THREE.Group {
  const g = new THREE.Group();
  const stone = mat('#cdb27a');
  g.add(mesh(new THREE.BoxGeometry(12, 62, 12).translate(0, 31, 0), stone));
  g.add(mesh(new THREE.BoxGeometry(14, 12, 14).translate(0, 68, 0), stone));
  // cadrans sur les quatre faces
  const face = mat('#f8f1dc', { emissive: '#fff4c2', emissiveIntensity: 0.25 });
  for (let k = 0; k < 4; k++) {
    const c = mesh(new THREE.CircleGeometry(4.6, 16), face);
    const a = (k * Math.PI) / 2;
    c.position.set(Math.sin(a) * 7.05, 68, Math.cos(a) * 7.05);
    c.rotation.y = a;
    g.add(c);
  }
  g.add(frustum(10, 0.8, 22, mat('#3f4a3a', { metalness: 0.3 }), 74));
  return g;
}

function londonEye(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#e5e7eb', { metalness: 0.5 });
  const R = 34;
  const wheel = mesh(new THREE.TorusGeometry(R, 0.9, 6, 48), steel, 0, R + 4, 0);
  g.add(wheel);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const spoke = mesh(new THREE.BoxGeometry(0.4, R, 0.4), steel);
    spoke.position.set((Math.cos(a) * R) / 2, R + 4 + (Math.sin(a) * R) / 2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    g.add(spoke);
    const cab = mesh(new THREE.CapsuleGeometry(1.4, 2.6, 2, 6), mat('#bfe3ff', { metalness: 0.2, roughness: 0.2 }));
    cab.rotation.z = Math.PI / 2;
    cab.position.set(Math.cos(a) * R, R + 4 + Math.sin(a) * R, 2.2);
    g.add(cab);
  }
  // pied en A
  for (const s of [-1, 1]) {
    const leg = mesh(new THREE.BoxGeometry(1.4, R + 8, 1.4), steel);
    leg.position.set(s * 9, (R + 4) / 2, -4);
    leg.rotation.z = -s * 0.25;
    g.add(leg);
  }
  return g;
}

function empireState(): THREE.Group {
  const g = new THREE.Group();
  const stone = mat('#d6d0c4');
  let y = 0;
  for (const [w, h] of [[30, 60], [24, 40], [18, 30], [12, 14], [8, 8]] as const) {
    g.add(mesh(new THREE.BoxGeometry(w, h, w).translate(0, y + h / 2, 0), stone));
    y += h;
  }
  g.add(mesh(new THREE.CylinderGeometry(1.6, 3, 14, 8).translate(0, y + 7, 0), mat('#c7c2b8', { metalness: 0.4 })));
  g.add(mesh(new THREE.CylinderGeometry(0.25, 0.6, 16, 6).translate(0, y + 22, 0), mat('#9ca3af', { metalness: 0.6 })));
  return g;
}

function liberty(): THREE.Group {
  const g = new THREE.Group();
  const copper = mat('#5fae94', { roughness: 0.6 });
  g.add(mesh(new THREE.CylinderGeometry(12, 14, 6, 8).translate(0, 3, 0), mat('#b9b3a3'))); // fort étoilé (simplifié)
  g.add(mesh(new THREE.BoxGeometry(10, 22, 10).translate(0, 17, 0), mat('#c9c2b0'))); // piédestal
  g.add(mesh(new THREE.CylinderGeometry(2.6, 4.2, 20, 8).translate(0, 38, 0), copper)); // drapé
  g.add(mesh(new THREE.SphereGeometry(2.2, 8, 6).translate(0, 50, 0), copper)); // tête
  for (let k = 0; k < 7; k++) {
    const ray = mesh(new THREE.ConeGeometry(0.5, 3, 4), copper);
    const a = -Math.PI / 2 + ((k - 3) / 6) * Math.PI * 0.9;
    ray.position.set(Math.cos(a) * 2.6, 51.5 + Math.sin(a + Math.PI) * -1.2, Math.sin(a) * 0.6);
    ray.rotation.z = a + Math.PI / 2;
    g.add(ray);
  }
  const arm = mesh(new THREE.CylinderGeometry(0.9, 1.1, 12, 6), copper);
  arm.position.set(3.4, 52, 0);
  arm.rotation.z = -0.15;
  g.add(arm);
  g.add(mesh(new THREE.ConeGeometry(1.4, 3.2, 6).translate(4.3, 59.6, 0), mat('#f5c542', { emissive: '#f5a623', emissiveIntensity: 0.6, metalness: 0.5 }))); // flamme
  return g;
}

/** Tour Part-Dieu, « le Crayon » : fût cylindrique ocre rosé et pointe pyramidale rouge brique. */
function crayon(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(11, 11, 82, 20).translate(0, 41, 0), mat('#c99a7a')));
  // bandes de fenêtres
  for (let y = 8; y < 80; y += 6) g.add(mesh(new THREE.CylinderGeometry(11.15, 11.15, 1.4, 20).translate(0, y, 0), mat('#5b6b7c', { metalness: 0.3, roughness: 0.4 })));
  g.add(mesh(new THREE.ConeGeometry(11, 26, 20).translate(0, 95, 0), mat('#b5523b')));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 6).translate(0, 111, 0), mat('#e5e7eb')));
  return g;
}

/** Basilique de Fourvière, sur sa colline : nef blanche et quatre tours d'angle. */
function fourviere(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(26, 34, 18, 10).translate(0, 9, 0), mat('#6f9a55'))); // colline
  const white = mat('#efeadf');
  g.add(mesh(new THREE.BoxGeometry(34, 16, 16).translate(0, 26, 0), white));
  g.add(mesh(new THREE.CylinderGeometry(0, 12, 6, 4).rotateY(Math.PI / 4).scale(1.4, 1, 0.66).translate(0, 37, 0), mat('#d7d0c0')));
  for (const [x, z] of [[-17, -8], [17, -8], [-17, 8], [17, 8]]) {
    g.add(mesh(new THREE.BoxGeometry(5, 26, 5).translate(x!, 31, z!), white));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 3.4, 4, 4).rotateY(Math.PI / 4).translate(x!, 46, z!), mat('#cfc6b2')));
  }
  // statue dorée de la Vierge (sur la chapelle voisine, simplifiée)
  g.add(mesh(new THREE.ConeGeometry(1.2, 5, 6).translate(-24, 22, 0), mat('#e9c46a', { metalness: 0.7, roughness: 0.3, emissive: '#a07a1a', emissiveIntensity: 0.25 })));
  g.add(mesh(new THREE.BoxGeometry(4, 14, 4).translate(-24, 13, 0), white));
  return g;
}

function burjKhalifa(): THREE.Group {
  const g = new THREE.Group();
  const glass = mat('#b8c9d6', { metalness: 0.6, roughness: 0.25 });
  let y = 0;
  let r = 16;
  for (let k = 0; k < 9; k++) {
    const h = 30 - k * 1.5;
    g.add(mesh(new THREE.CylinderGeometry(r * 0.88, r, h, 6).translate(0, y + h / 2, 0), glass));
    y += h;
    r *= 0.8;
  }
  g.add(mesh(new THREE.CylinderGeometry(0.4, 1.8, 50, 6).translate(0, y + 25, 0), mat('#d1d5db', { metalness: 0.7 })));
  return g;
}

export interface Landmark { name: string; build: () => THREE.Group }

/** Monuments par ville (deux au plus) : [principal, secondaire]. */
export const LANDMARKS: Record<string, Landmark[]> = {
  paris: [{ name: 'Tour Eiffel', build: eiffel }],
  london: [{ name: 'Big Ben', build: bigBen }, { name: 'London Eye', build: londonEye }],
  newyork: [{ name: 'Empire State Building', build: empireState }, { name: 'Statue de la Liberté', build: liberty }],
  lyon: [{ name: 'Tour Part-Dieu « le Crayon »', build: crayon }, { name: 'Basilique de Fourvière', build: fourviere }],
  dubai: [{ name: 'Burj Khalifa', build: burjKhalifa }],
  tokyo: [{ name: 'Tour de Tokyo', build: tokyoTower }],
};

/**
 * Îlots réservés aux monuments, juste à droite du siège : la caméra plonge vers le siège depuis le sud-est, si bien
 * qu'un monument éloigné sortirait du cadre par le haut ; la gauche de l'écran est souvent couverte par les panneaux.
 */
export const LANDMARK_PLOTS: [number, number][] = [[1, 0], [0, -1]];
/** Hauteur maximale à l'écran par îlot (mise à l'échelle des monuments pour tenir dans le cadrage par défaut). */
export const LANDMARK_MAX_H = [72, 64];
