import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';
import { colliders } from '../core/state.js';

/* 1 m navigation grid over the whole map and an A* path finder with string-pulling. */

const N = 94, O = -47;
const blocked = new Uint8Array(N * N);

export function buildNav() {
  const pad = 0.5;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = O + i + 0.5, z = O + j + 0.5;
      let b = Math.abs(x) > 45.5 || Math.abs(z) > 45.5;
      if (!b) {
        for (const c of colliders) {
          if (c.min.y > 1.7) continue;
          if (x > c.min.x - pad && x < c.max.x + pad && z > c.min.z - pad && z < c.max.z + pad) { b = true; break; }
        }
      }
      blocked[j * N + i] = b ? 1 : 0;
    }
  }
}
const idx = (x, z) => clamp(Math.floor(z - O), 0, N - 1) * N + clamp(Math.floor(x - O), 0, N - 1);
export const isBlocked = (x, z) => blocked[idx(x, z)] === 1;

function nearestFree(k) {
  if (!blocked[k]) return k;
  const i0 = k % N, j0 = Math.floor(k / N);
  for (let r = 1; r < 10; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      if (!blocked[j * N + i]) return j * N + i;
    }
  }
  return k;
}
/** Nearest walkable point to (x, z). */
export function freePoint(x, z, out = new THREE.Vector3()) {
  const k = nearestFree(idx(x, z));
  return out.set(O + (k % N) + 0.5, 0, O + Math.floor(k / N) + 0.5);
}

const gScore = new Float32Array(N * N), fScore = new Float32Array(N * N), parent = new Int32Array(N * N), status = new Uint8Array(N * N);
export function findPath(sx, sz, tx, tz) {
  const start = nearestFree(idx(sx, sz)), goal = nearestFree(idx(tx, tz));
  gScore.fill(Infinity); status.fill(0); parent.fill(-1);
  const gi = goal % N, gj = Math.floor(goal / N);
  const h = (k) => { const dx = Math.abs((k % N) - gi), dz = Math.abs(Math.floor(k / N) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const heap = [];
  const push = (k) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (fScore[heap[p]] <= fScore[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
        if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  gScore[start] = 0; fScore[start] = h(start); push(start); status[start] = 1;
  let found = false, iter = 0;
  while (heap.length && iter++ < 9000) {
    const cur = pop();
    if (status[cur] === 2) continue;
    if (cur === goal) { found = true; break; }
    status[cur] = 2;
    const ci = cur % N, cj = Math.floor(cur / N);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const k = j * N + i;
      if (blocked[k] || status[k] === 2) continue;
      if (di && dj && (blocked[cj * N + i] || blocked[j * N + ci])) continue;
      const g = gScore[cur] + (di && dj ? 1.414 : 1);
      if (g < gScore[k]) { gScore[k] = g; fScore[k] = g + h(k); parent[k] = cur; status[k] = 1; push(k); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = parent[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => new THREE.Vector3(O + (k % N) + 0.5, 0, O + Math.floor(k / N) + 0.5));
  const out = [pts[0]];
  let anchor = 0;
  for (let k = 2; k < pts.length; k++) if (!clearLine(pts[anchor], pts[k])) { out.push(pts[k - 1]); anchor = k - 1; }
  out.push(pts[pts.length - 1]);
  return out;
}
export function clearLine(a, b) {
  const steps = Math.ceil(a.distanceTo(b) / 0.35);
  for (let s = 1; s < steps; s++) { const t = s / steps; if (blocked[idx(lerp(a.x, b.x, t), lerp(a.z, b.z, t))]) return false; }
  return true;
}
