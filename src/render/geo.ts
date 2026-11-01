import * as THREE from 'three';

/** Convertit lat/lon (degrés) en position 3D, cohérent avec l'UV de THREE.SphereGeometry. */
export function latLonToVec3(lat: number, lon: number, r = 1): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Point sur l'arc de grand cercle entre a et b (unitaires), surélevé en cloche. */
export function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, height: number, out = new THREE.Vector3()): THREE.Vector3 {
  const angle = a.angleTo(b);
  if (angle < 1e-6) return out.copy(a);
  const s = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
  return out.multiplyScalar(1 + height * Math.sin(Math.PI * t));
}
