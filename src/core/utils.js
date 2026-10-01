import * as THREE from 'three';

/* Small math and storage helpers shared by every module. */

export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);
export const DOWN = new THREE.Vector3(0, -1, 0);

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent smoothing factor for `x += (target - x) * damp(k, dt)`. */
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (n) => Math.floor(Math.random() * n);
export const pick = (arr) => arr[randi(arr.length)];
export const smooth = (t) => t * t * (3 - 2 * t);
export const wrapAngle = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
export const arNum = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
export const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

/** 16.75 → "16:45"; hours past 24 wrap around the clock. */
export function fmtClock(h) {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const mm = Math.floor((((h % 1) + 1) % 1) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/** Seeded PRNG so procedural content is repeatable. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};
