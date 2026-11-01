/**
 * Textures procédurales du globe, générées une fois sur canvas :
 *  - couleur (océan saturé + terres teintées par latitude, style « plateau de jeu »),
 *  - masque terre/mer (pour le reflet du soleil sur l'eau),
 *  - lumières nocturnes des villes,
 *  - nuages.
 */
import * as THREE from 'three';
import { feature } from 'topojson-client';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import landTopo from 'world-atlas/land-50m.json';
import type { City } from '../engine/types';

const W = 4096;
const H = 2048;

const px = (lon: number) => ((lon + 180) / 360) * W;
const py = (lat: number) => ((90 - lat) / 180) * H;

/** Trace un anneau en dépliant les sauts d'antiméridien ; ferme par le pôle si l'anneau fait le tour du globe. */
function traceRing(ctx: CanvasRenderingContext2D, ring: Position[], offset: number) {
  let prevLon = ring[0]![0]!;
  let unwrap = 0;
  const pts: [number, number][] = [];
  for (const p of ring) {
    let lon = p[0]!;
    const d = lon - prevLon;
    if (d > 180) unwrap -= 360;
    else if (d < -180) unwrap += 360;
    prevLon = lon;
    lon += unwrap;
    pts.push([px(lon) + offset, py(p[1]!)]);
  }
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  if (Math.abs(unwrap) >= 360) {
    const last = pts[pts.length - 1]!;
    const pole = (ring[0]![1]! < 0 ? H : 0) + (ring[0]![1]! < 0 ? 4 : -4);
    ctx.lineTo(last[0], pole);
    ctx.lineTo(pts[0]![0], pole);
  }
  ctx.closePath();
}

function landPath(ctx: CanvasRenderingContext2D) {
  const topo = landTopo as unknown as Parameters<typeof feature>[0];
  const geo = feature(topo, (topo as unknown as { objects: { land: never } }).objects.land) as unknown as {
    features?: { geometry: Polygon | MultiPolygon }[];
    geometry?: Polygon | MultiPolygon;
  };
  const geoms = geo.features ? geo.features.map((f) => f.geometry) : [geo.geometry!];
  ctx.beginPath();
  for (const g of geoms) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) for (const off of [-W, 0, W]) traceRing(ctx, ring, off);
  }
}

// petit bruit de valeur déterministe
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface GlobeTextures {
  color: THREE.CanvasTexture;
  mask: THREE.CanvasTexture;
  lights: THREE.CanvasTexture;
  clouds: THREE.CanvasTexture;
}

export function buildTextures(cities: City[]): GlobeTextures {
  // ---- masque
  const maskC = document.createElement('canvas');
  maskC.width = W;
  maskC.height = H;
  const m = maskC.getContext('2d')!;
  m.fillStyle = '#000';
  m.fillRect(0, 0, W, H);
  m.fillStyle = '#fff';
  landPath(m);
  m.fill('evenodd');

  // ---- couleur
  const colC = document.createElement('canvas');
  colC.width = W;
  colC.height = H;
  const c = colC.getContext('2d')!;
  const ocean = c.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0, '#2a6fb8');
  ocean.addColorStop(0.25, '#1d7fd1');
  ocean.addColorStop(0.5, '#1590de');
  ocean.addColorStop(0.75, '#1d7fd1');
  ocean.addColorStop(1, '#2a6fb8');
  c.fillStyle = ocean;
  c.fillRect(0, 0, W, H);
  // hauts-fonds turquoise autour des côtes : flou du masque converti en alpha, hors terres
  const blurC = document.createElement('canvas');
  blurC.width = W;
  blurC.height = H;
  const b = blurC.getContext('2d')!;
  b.filter = 'blur(16px)';
  b.drawImage(maskC, 0, 0);
  const halo = b.getImageData(0, 0, W, H);
  const md = m.getImageData(0, 0, W, H).data;
  for (let i = 0; i < halo.data.length; i += 4) {
    const a = Math.min(255, halo.data[i]! * 1.6) * (md[i]! > 128 ? 0 : 0.8);
    halo.data[i] = 70;
    halo.data[i + 1] = 214;
    halo.data[i + 2] = 230;
    halo.data[i + 3] = a;
  }
  b.filter = 'none';
  b.putImageData(halo, 0, 0);
  c.drawImage(blurC, 0, 0);

  // terres : biomes par latitude
  const land = c.createLinearGradient(0, 0, 0, H);
  const stops: [number, string][] = [
    [90, '#f4f7fb'], [72, '#e6ecef'], [64, '#8fae78'], [55, '#5fa84f'], [42, '#72b84f'],
    [33, '#c8b26a'], [22, '#e2c27a'], [14, '#a8b85a'], [5, '#3f9d45'], [-5, '#3a9a43'],
    [-15, '#7fb24e'], [-24, '#d2b46e'], [-33, '#9fb35a'], [-45, '#6ea657'], [-58, '#9db7a0'], [-66, '#eef3f7'], [-90, '#ffffff'],
  ];
  for (const [lat, col] of stops) land.addColorStop((90 - lat) / 180, col);
  c.save();
  landPath(c);
  c.clip('evenodd');
  c.fillStyle = land;
  c.fillRect(0, 0, W, H);
  // relief tacheté (bruit) pour casser l'aplat
  for (let i = 0; i < 26000; i++) {
    const x = hash(i, 1) * W;
    const y = hash(i, 2) * H;
    const r = 3 + hash(i, 3) * 14;
    c.fillStyle = hash(i, 4) > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(30,60,20,0.08)';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  // liseré côtier
  c.strokeStyle = 'rgba(255,255,240,0.55)';
  c.lineWidth = 2.2;
  landPath(c);
  c.stroke();

  // ---- lumières nocturnes
  const lightsC = document.createElement('canvas');
  lightsC.width = 2048;
  lightsC.height = 1024;
  const l = lightsC.getContext('2d')!;
  l.fillStyle = '#000';
  l.fillRect(0, 0, 2048, 1024);
  const maskData = m.getImageData(0, 0, W, H).data;
  const isLand = (x: number, y: number) => maskData[(Math.floor(y) * W + Math.floor(x)) * 4]! > 128;
  for (let i = 0; i < 9000; i++) {
    const lat = (hash(i, 7) - 0.5) * 2 * 65;
    const lon = (hash(i, 8) - 0.5) * 360;
    const x = px(lon), y = py(lat);
    if (!isLand(x, y)) continue;
    const temperate = Math.exp(-(((Math.abs(lat) - 38) / 18) ** 2));
    if (hash(i, 9) > 0.25 + 0.6 * temperate) continue;
    l.fillStyle = `rgba(255,255,255,${0.15 + 0.35 * hash(i, 10)})`;
    l.fillRect(x / 2, y / 2, 1.5, 1.5);
  }
  for (const city of cities) {
    const x = px(city.lon) / 2, y = py(city.lat) / 2;
    const g = l.createRadialGradient(x, y, 0, x, y, 14);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    l.fillStyle = g;
    l.fillRect(x - 14, y - 14, 28, 28);
  }

  // ---- nuages
  const cloudC = document.createElement('canvas');
  cloudC.width = 2048;
  cloudC.height = 1024;
  const k = cloudC.getContext('2d')!;
  k.clearRect(0, 0, 2048, 1024);
  for (let cl = 0; cl < 170; cl++) {
    const cx = hash(cl, 20) * 2048;
    // bandes nuageuses : zone intertropicale et latitudes moyennes
    const band = hash(cl, 21);
    const lat = band < 0.3 ? (hash(cl, 22) - 0.5) * 20 : (band < 0.65 ? 1 : -1) * (40 + hash(cl, 23) * 22);
    const cy = py(lat) / 2;
    const n = 6 + Math.floor(hash(cl, 24) * 14);
    for (let j = 0; j < n; j++) {
      const ox = (hash(cl * 31 + j, 25) - 0.5) * 120;
      const oy = (hash(cl * 31 + j, 26) - 0.5) * 34;
      const r = 10 + hash(cl * 31 + j, 27) * 30;
      for (const off of [-2048, 0, 2048]) {
        const g = k.createRadialGradient(cx + ox + off, cy + oy, 0, cx + ox + off, cy + oy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        k.fillStyle = g;
        k.beginPath();
        k.arc(cx + ox + off, cy + oy, r, 0, Math.PI * 2);
        k.fill();
      }
    }
  }

  const mk = (cv: HTMLCanvasElement, srgb = false) => {
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tx.anisotropy = 8;
    tx.needsUpdate = true;
    return tx;
  };
  return { color: mk(colC), mask: mk(maskC), lights: mk(lightsC), clouds: mk(cloudC, true) };
}
