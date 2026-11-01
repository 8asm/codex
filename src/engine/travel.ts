import { CITY_BY_ID } from '../data/cities';

const EARTH_R = 6371;

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface FlightInfo {
  km: number;
  hours: number;
  /** Jours ouvrés « perdus » en vol : on arrive à l'ouverture de J+days. */
  days: number;
  cost: number;
}

export function flightInfo(from: string, to: string): FlightInfo {
  const a = CITY_BY_ID[from]!;
  const b = CITY_BY_ID[to]!;
  const km = greatCircleKm(a.lat, a.lon, b.lat, b.lon);
  const hours = km / 850 + 1.5;
  return { km, hours, days: hours <= 9 ? 1 : 2, cost: Math.round(1200 + 0.6 * km) };
}
