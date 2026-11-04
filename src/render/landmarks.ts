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


// ---------------------------------------------------------------- formes génériques (phase 11)
function obelisk(h = 60, color = '#e7dcc6'): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(12, 4, 12).translate(0, 2, 0), mat('#cbbf9f')));
  g.add(frustum(4.2, 2.4, h, mat(color), 4));
  g.add(frustum(2.4, 0.01, 5, mat('#d8c27a', { metalness: 0.5 }), 4 + h));
  return g;
}

function pagoda(floors = 5, color = '#b91c1c'): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(color);
  const roof = mat('#2f3b2f');
  let y = 0;
  let w = 18;
  for (let k = 0; k < floors; k++) {
    g.add(mesh(new THREE.BoxGeometry(w * 0.7, 6, w * 0.7).translate(0, y + 3, 0), wood));
    g.add(mesh(new THREE.ConeGeometry(w * 0.75, 3.5, 4).rotateY(Math.PI / 4).translate(0, y + 7.6, 0), roof));
    y += 8;
    w *= 0.84;
  }
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.5, 8, 6).translate(0, y + 4, 0), mat('#d4a017', { metalness: 0.6 })));
  return g;
}

function pyramids(): THREE.Group {
  const g = new THREE.Group();
  const sand = mat('#d8b878');
  for (const [x, z, s] of [[0, 0, 1], [-34, 18, 0.75], [28, 26, 0.55]] as const) {
    const p = mesh(new THREE.ConeGeometry(30 * s, 40 * s, 4).rotateY(Math.PI / 4).translate(x, 20 * s, z), sand);
    g.add(p);
  }
  g.add(mesh(new THREE.BoxGeometry(70, 0.4, 70), mat('#e6cf98'), 0, 0.2, 10));
  return g;
}

function domesAndMinarets(): THREE.Group {
  const g = new THREE.Group();
  const stone = mat('#d9d1c3');
  const lead = mat('#7d8a93', { metalness: 0.4 });
  g.add(mesh(new THREE.BoxGeometry(34, 14, 34).translate(0, 7, 0), stone));
  g.add(mesh(new THREE.SphereGeometry(13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 14, 0), lead));
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
    g.add(mesh(new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(x!, 14, z!), lead));
  }
  for (const [x, z] of [[-22, -22], [22, -22], [-22, 22], [22, 22]]) {
    g.add(mesh(new THREE.CylinderGeometry(1.4, 1.8, 44, 10).translate(x!, 22, z!), stone));
    g.add(mesh(new THREE.ConeGeometry(1.8, 6, 10).translate(x!, 47, z!), lead));
  }
  return g;
}

/** Tour de télécommunication : fût élancé, nacelle (ou sphères), antenne. */
function needleTower(h = 120, pods: number[] = [0.7], color = '#d1d5db', podColor = '#94a3b8'): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(2.2, 5.5, h, 12).translate(0, h / 2, 0), mat(color)));
  for (const f of pods) g.add(mesh(new THREE.SphereGeometry(f === pods[0] ? 8 : 5, 16, 12).translate(0, h * f, 0), mat(podColor, { metalness: 0.4, roughness: 0.3 })));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 1, h * 0.25, 6).translate(0, h * 1.12, 0), mat('#e5e7eb', { metalness: 0.6 })));
  return g;
}

function temple(cols = 8, color = '#efe9dc'): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color);
  const W = 44, D = 22;
  g.add(mesh(new THREE.BoxGeometry(W + 6, 3, D + 6).translate(0, 1.5, 0), m));
  for (let i = 0; i < cols; i++) for (const z of [-D / 2, D / 2]) g.add(mesh(new THREE.CylinderGeometry(1.2, 1.4, 14, 10).translate(-W / 2 + (i * W) / (cols - 1), 10, z), m));
  g.add(mesh(new THREE.BoxGeometry(W + 3, 2.4, D + 3).translate(0, 18.2, 0), m));
  g.add(mesh(new THREE.CylinderGeometry(0.01, D / 2 + 2, W + 3, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 0.35, 1).translate(0, 21, 0), m));
  return g;
}

function cathedral(color = '#ece4d4'): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color);
  g.add(mesh(new THREE.BoxGeometry(24, 22, 46).translate(0, 11, 0), m));
  g.add(mesh(new THREE.CylinderGeometry(0.01, 13, 10, 4).rotateY(Math.PI / 4).scale(1, 1, 1.9).translate(0, 27, 0), mat('#c9bfae')));
  for (let k = 0; k < 9; k++) for (const x of [-12, 12]) g.add(mesh(new THREE.ConeGeometry(0.8, 9, 6).translate(x, 26, -20 + k * 5), m));
  g.add(mesh(new THREE.CylinderGeometry(0.4, 1.4, 26, 8).translate(0, 44, 4), m));
  g.add(mesh(new THREE.SphereGeometry(1.2, 8, 6).translate(0, 58, 4), mat('#e9c46a', { metalness: 0.8, emissive: '#a07a1a', emissiveIntensity: 0.2 })));
  return g;
}

function sailHotel(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(10, 10, 3, 20).translate(0, 1.5, 0), mat('#e5e7eb')));
  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.quadraticCurveTo(26, 40, 4, 110); shape.lineTo(0, 110); shape.lineTo(0, 0);
  const sail = new THREE.ExtrudeGeometry(shape, { depth: 18, bevelEnabled: false }).translate(-2, 0, -9);
  g.add(mesh(sail, mat('#f8fafc', { roughness: 0.3 }), 0, 3, 0));
  g.add(mesh(new THREE.BoxGeometry(2, 116, 2).translate(-3, 58, 0), mat('#cbd5e1', { metalness: 0.5 })));
  return g;
}

function operaShells(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(60, 5, 34).translate(0, 2.5, 0), mat('#c9a27a')));
  const shell = mat('#f8fafc', { roughness: 0.35 });
  for (const [x, s] of [[-20, 1], [-6, 1.2], [10, 1.05], [24, 0.8]] as const) {
    const sh = mesh(new THREE.SphereGeometry(14 * s, 16, 10, 0, Math.PI, 0, Math.PI / 2), shell);
    sh.rotation.set(0, Math.PI / 2, -0.35);
    sh.position.set(x, 5, 0);
    sh.scale.set(1, 1.5, 0.55);
    g.add(sh);
  }
  return g;
}

function twinTowers(h = 110): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#c7d0d8', { metalness: 0.7, roughness: 0.3 });
  for (const x of [-14, 14]) {
    let r = 8, y = 0;
    for (let k = 0; k < 6; k++) { const hh = h / 6; g.add(mesh(new THREE.CylinderGeometry(r * 0.92, r, hh, 8).translate(x, y + hh / 2, 0), steel)); y += hh; r *= 0.9; }
    g.add(mesh(new THREE.CylinderGeometry(0.3, 1.2, 24, 6).translate(x, y + 12, 0), steel));
  }
  g.add(mesh(new THREE.BoxGeometry(20, 3, 4).translate(0, h * 0.45, 0), steel)); // passerelle
  return g;
}

function triumphalArch(color = '#e7dfcf'): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color);
  for (const x of [-11, 11]) g.add(mesh(new THREE.BoxGeometry(12, 32, 14).translate(x, 16, 0), m));
  g.add(mesh(new THREE.BoxGeometry(34, 12, 14).translate(0, 38, 0), m));
  g.add(mesh(new THREE.TorusGeometry(5, 1.2, 6, 16, Math.PI).translate(0, 26, 7.1), m));
  return g;
}

function waterJet(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(6, 7, 1, 16).translate(0, 0.5, 0), mat('#9aa7b0')));
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 3.4, 80, 10, 1, true).translate(0, 40, 0), new THREE.MeshStandardMaterial({ color: '#e6f4ff', transparent: true, opacity: 0.6, roughness: 0.1 }));
  g.add(jet);
  g.add(mesh(new THREE.SphereGeometry(6, 10, 8).scale(1, 0.5, 1).translate(0, 80, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 })));
  return g;
}

function onionDomes(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(30, 14, 30).translate(0, 7, 0), mat('#b45309')));
  const cols = ['#16a34a', '#dc2626', '#2563eb', '#eab308', '#7c3aed'];
  [[0, 0, 1.4], [-10, -10, 1], [10, -10, 1], [-10, 10, 1], [10, 10, 1]].forEach(([x, z, s], k) => {
    g.add(mesh(new THREE.CylinderGeometry(3 * s!, 3.4 * s!, 16 * s!, 10).translate(x!, 14 + 8 * s!, z!), mat('#f3e9d2')));
    g.add(mesh(new THREE.SphereGeometry(4.6 * s!, 12, 10).scale(1, 1.25, 1).translate(x!, 14 + 16 * s! + 4 * s!, z!), mat(cols[k]!)));
    g.add(mesh(new THREE.ConeGeometry(1.2 * s!, 5 * s!, 8).translate(x!, 14 + 16 * s! + 10 * s!, z!), mat('#e9c46a', { metalness: 0.7 })));
  });
  return g;
}

function stupa(): THREE.Group {
  const g = new THREE.Group();
  const gold = mat('#e0b23b', { metalness: 0.7, roughness: 0.3, emissive: '#7a5a10', emissiveIntensity: 0.15 });
  g.add(mesh(new THREE.BoxGeometry(34, 6, 34).translate(0, 3, 0), mat('#efe6d2')));
  g.add(mesh(new THREE.SphereGeometry(13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 6, 0), gold));
  g.add(mesh(new THREE.ConeGeometry(4, 34, 12).translate(0, 36, 0), gold));
  return g;
}

function bean(): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(new THREE.SphereGeometry(10, 24, 16).scale(1.6, 0.75, 1), mat('#e5e7eb', { metalness: 1, roughness: 0.05 }));
  b.position.y = 7;
  g.add(b);
  return g;
}

function blockTower(h: number, color: string, top: 'spire' | 'crown' | 'flat' = 'spire', w = 24): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { metalness: 0.5, roughness: 0.3 });
  g.add(mesh(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), m));
  if (top === 'spire') g.add(mesh(new THREE.CylinderGeometry(0.3, 1.2, h * 0.2, 6).translate(0, h * 1.1, 0), mat('#e5e7eb', { metalness: 0.7 })));
  if (top === 'crown') g.add(mesh(new THREE.ConeGeometry(w * 0.75, h * 0.18, 4).rotateY(Math.PI / 4).translate(0, h * 1.09, 0), m));
  return g;
}

function bridgeArch(): THREE.Group {
  const g = new THREE.Group();
  const steel = mat('#9ca3af', { metalness: 0.6 });
  g.add(mesh(new THREE.BoxGeometry(110, 2, 12).translate(0, 14, 0), steel));
  const arch = mesh(new THREE.TorusGeometry(50, 1.8, 6, 32, Math.PI), steel);
  arch.position.y = 0;
  g.add(arch);
  for (const x of [-56, 56]) g.add(mesh(new THREE.BoxGeometry(6, 30, 12).translate(x, 15, 0), mat('#b8ad98')));
  return g;
}

export interface Landmark { name: string; build: () => THREE.Group }

/** Monuments par ville (deux au plus) : [principal, secondaire]. */
export const LANDMARKS: Record<string, Landmark[]> = {
  paris: [{ name: 'Tour Eiffel', build: eiffel }],
  london: [{ name: 'Big Ben', build: bigBen }, { name: 'London Eye', build: londonEye }],
  newyork: [{ name: 'Empire State Building', build: empireState }, { name: 'Statue de la Liberté', build: liberty }],
  lyon: [{ name: 'Tour Part-Dieu « le Crayon »', build: crayon }, { name: 'Basilique de Fourvière', build: fourviere }],
  dubai: [{ name: 'Burj Khalifa', build: burjKhalifa }, { name: 'Burj al-Arab', build: sailHotel }],
  tokyo: [{ name: 'Tour de Tokyo', build: tokyoTower }, { name: 'Pagode', build: () => pagoda(5, '#b91c1c') }],
  // phase 11 : bien plus de villes
  geneva: [{ name: 'Jet d’eau', build: waterJet }],
  rotterdam: [{ name: 'Pont Érasme', build: bridgeArch }],
  singapore: [{ name: 'Marina Bay Sands', build: () => { const g = new THREE.Group(); for (const x of [-22, 0, 22]) g.add(blockTower(70, '#c7d2dc', 'flat', 14).translateX(x)); const deck = new THREE.Mesh(new THREE.BoxGeometry(80, 3, 18), mat('#e5e7eb')); deck.position.y = 72; g.add(deck); return g; } }],
  houston: [{ name: 'Gratte-ciel du pétrole', build: () => blockTower(100, '#9fb4c7', 'crown') }],
  shanghai: [{ name: 'Perle de l’Orient', build: () => needleTower(120, [0.32, 0.78], '#d6a3c8', '#c0267d') }, { name: 'Tour de Shanghai', build: () => blockTower(130, '#b8cce0', 'flat', 22) }],
  chicago: [{ name: 'Willis Tower', build: () => blockTower(120, '#2b2f36', 'spire') }, { name: 'Cloud Gate', build: bean }],
  santiago: [{ name: 'Gran Torre Costanera', build: () => blockTower(110, '#9db6c9', 'flat', 20) }],
  johannesburg: [{ name: 'Tour Hillbrow', build: () => needleTower(110, [0.86], '#cbd5e1', '#94a3b8') }],
  hamburg: [{ name: 'Elbphilharmonie', build: () => { const g = new THREE.Group(); g.add(blockTower(26, '#8b5a3c', 'flat', 30)); const glass = new THREE.Mesh(new THREE.BoxGeometry(32, 22, 30), mat('#cfe6f5', { metalness: 0.4, roughness: 0.1 })); glass.position.y = 37; g.add(glass); return g; } }],
  frankfurt: [{ name: 'Messeturm', build: () => blockTower(115, '#c4a991', 'crown', 20) }],
  oslo: [{ name: 'Opéra d’Oslo', build: () => { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.BoxGeometry(60, 2, 40), mat('#f1f5f9')); r.rotation.z = -0.2; r.position.y = 8; g.add(r); g.add(blockTower(16, '#e2e8f0', 'flat', 26)); return g; } }],
  moscow: [{ name: 'Cathédrale aux bulbes', build: onionDomes }],
  istanbul: [{ name: 'Grande mosquée', build: domesAndMinarets }],
  athens: [{ name: 'Parthénon', build: () => temple(8, '#efe9dc') }],
  madrid: [{ name: 'Porte d’Alcalá', build: () => triumphalArch('#e3d9c6') }],
  milan: [{ name: 'Dôme de Milan', build: () => cathedral('#f1ebe0') }],
  vienna: [{ name: 'Grande roue du Prater', build: londonEye }],
  warsaw: [{ name: 'Palais de la culture', build: () => blockTower(95, '#d8cdb8', 'spire', 26) }],
  riyadh: [{ name: 'Tour du Royaume', build: () => { const g = new THREE.Group(); for (const x of [-9, 9]) g.add(blockTower(90, '#9fb3c4', 'flat', 8).translateX(x)); const bar = new THREE.Mesh(new THREE.BoxGeometry(26, 3, 8), mat('#cbd5e1')); bar.position.y = 92; g.add(bar); return g; } }],
  doha: [{ name: 'Tour de Doha', build: () => { const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(9, 10, 100, 20).translate(0, 50, 0), mat('#b9c7d4', { metalness: 0.5 }))); g.add(mesh(new THREE.SphereGeometry(9, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 100, 0), mat('#b9c7d4', { metalness: 0.5 }))); return g; } }],
  cairo: [{ name: 'Pyramides', build: pyramids }],
  mumbai: [{ name: 'Porte de l’Inde', build: () => triumphalArch('#d9b88f') }],
  hongkong: [{ name: 'Tour de la banque', build: () => blockTower(115, '#7fa3c0', 'spire', 22) }],
  seoul: [{ name: 'Tour de Namsan', build: () => needleTower(100, [0.78], '#f1f5f9', '#e2e8f0') }],
  beijing: [{ name: 'Temple du Ciel', build: () => { const g = new THREE.Group(); let r = 22, y = 0; for (let k = 0; k < 3; k++) { g.add(mesh(new THREE.CylinderGeometry(r, r + 3, 4, 20).translate(0, y + 2, 0), mat('#f1ece2'))); y += 4; r *= 0.82; } for (let k = 0; k < 3; k++) { g.add(mesh(new THREE.CylinderGeometry(8 - k * 2, 8 - k * 2, 6, 16).translate(0, y + 3, 0), mat('#b91c1c'))); g.add(mesh(new THREE.ConeGeometry(11 - k * 2.5, 4, 16).translate(0, y + 8, 0), mat('#1e3a8a'))); y += 8; } return g; } }],
  sydney: [{ name: 'Opéra de Sydney', build: operaShells }, { name: 'Harbour Bridge', build: bridgeArch }],
  toronto: [{ name: 'Tour CN', build: () => needleTower(140, [0.66], '#cbd5e1', '#64748b') }],
  kualalumpur: [{ name: 'Tours Petronas', build: () => twinTowers(115) }],
  bangkok: [{ name: 'Stupa doré', build: stupa }],
  buenosaires: [{ name: 'Obélisque', build: () => obelisk(64, '#f3eee4') }],
  mexicocity: [{ name: 'Colonne de l’Indépendance', build: () => { const g = obelisk(50, '#e7e1d5'); g.add(mesh(new THREE.SphereGeometry(3, 10, 8).translate(0, 60, 0), mat('#e9c46a', { metalness: 0.8 }))); return g; } }],
  saopaulo: [{ name: 'Édifice Itália', build: () => blockTower(95, '#a3b1bd', 'flat', 22) }],
  zug: [{ name: 'Tour Parktower', build: () => blockTower(70, '#a8b8c6', 'flat', 16) }],
  lugano: [{ name: 'Campanile', build: () => blockTower(45, '#e9dfc9', 'crown', 10) }],
  baku: [{ name: 'Tours de flammes', build: () => { const g = new THREE.Group(); for (const [x, z, h] of [[-14, 0, 80], [12, -8, 70], [8, 14, 64]] as const) { const t = mesh(new THREE.ConeGeometry(9, h, 12).translate(x, h / 2, z), mat('#93c5fd', { metalness: 0.6, roughness: 0.2, emissive: '#f97316', emissiveIntensity: 0.15 })); g.add(t); } return g; } }],
  lagos: [{ name: 'Tour de la Nation', build: () => blockTower(70, '#c2b8a3', 'flat', 22) }],
  nairobi: [{ name: 'Centre de conférences', build: () => { const g = blockTower(60, '#c9a26d', 'flat', 16); g.add(mesh(new THREE.CylinderGeometry(14, 14, 8, 20).translate(0, 4, 26), mat('#b6926a'))); return g; } }],
};

/**
 * Îlots réservés aux monuments, juste à droite du siège : la caméra plonge vers le siège depuis le sud-est, si bien
 * qu'un monument éloigné sortirait du cadre par le haut ; la gauche de l'écran est souvent couverte par les panneaux.
 */
export const LANDMARK_PLOTS: [number, number][] = [[1, 0], [0, -1]];
/** Hauteur maximale à l'écran par îlot (mise à l'échelle des monuments pour tenir dans le cadrage par défaut). */
export const LANDMARK_MAX_H = [72, 64];
