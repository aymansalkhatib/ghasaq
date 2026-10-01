import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { colliders, props } from '../core/state.js';

/*
 * Character-vs-world collision. Static boxes come from the map; loose props (crates, barrels)
 * are added every frame from their physics bounding boxes, so you bump into them, can jump
 * onto them and stand on top.
 */

export const dynColliders = [];
export function refreshPropColliders() {
  dynColliders.length = 0;
  for (const p of props) {
    const b = p.body;
    if (b.aabbNeedsUpdate) b.updateAABB();
    const a = b.aabb;
    const box = p.box || (p.box = { min: new THREE.Vector3(), max: new THREE.Vector3() });
    box.min.set(a.lowerBound.x, Math.max(0, a.lowerBound.y), a.lowerBound.z);
    box.max.set(a.upperBound.x, a.upperBound.y, a.upperBound.z);
    dynColliders.push(box);
  }
}
const LISTS = [colliders, dynColliders];

/** Height of the highest box top under (x, z) that is at or below `fromY`. */
export function supportHeight(x, z, fromY, radius = 0) {
  let top = 0;
  for (const list of LISTS) {
    for (const c of list) {
      if (x + radius < c.min.x || x - radius > c.max.x || z + radius < c.min.z || z - radius > c.max.z) continue;
      if (c.max.y <= fromY + 0.05 && c.max.y > top) top = c.max.y;
    }
  }
  return top;
}

/** Moves a circle of radius r (height h, feet at pos.y) and slides it along box walls. */
export function slideCircle(pos, dx, dz, r, h, stepUp = 0.45) {
  pos.x += dx;
  pos.z += dz;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const list of LISTS) {
      for (const c of list) {
        if (pos.x + r < c.min.x || pos.x - r > c.max.x || pos.z + r < c.min.z || pos.z - r > c.max.z) continue;
        if (pos.y + h <= c.min.y || pos.y >= c.max.y - 0.001) continue;
        if (c.max.y - pos.y <= stepUp) continue;
        const cx = clamp(pos.x, c.min.x, c.max.x), cz = clamp(pos.z, c.min.z, c.max.z);
        const ox = pos.x - cx, oz = pos.z - cz, d2 = ox * ox + oz * oz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          pos.x += (ox / d) * push;
          pos.z += (oz / d) * push;
        } else {
          const l = pos.x - c.min.x, rr = c.max.x - pos.x, b = pos.z - c.min.z, f = c.max.z - pos.z, m = Math.min(l, rr, b, f);
          if (m === l) pos.x = c.min.x - r; else if (m === rr) pos.x = c.max.x + r; else if (m === b) pos.z = c.min.z - r; else pos.z = c.max.z + r;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Lowest ceiling above a standing character, or Infinity. */
export function ceilingAbove(x, z, fromY, radius = 0.3) {
  let low = Infinity;
  for (const list of LISTS) {
    for (const c of list) {
      if (x + radius < c.min.x || x - radius > c.max.x || z + radius < c.min.z || z - radius > c.max.z) continue;
      if (c.min.y > fromY + 0.1 && c.min.y < low) low = c.min.y;
    }
  }
  return low;
}

/** True when nothing solid is overhead (a crate can fall here from the sky). */
export const openSky = (x, z) => ceilingAbove(x, z, 0.05, 0.9) === Infinity;

/** Surface under a point: 'sand' on open ground, 'stone' on top of a box. */
export function surfaceAt(x, z, y) {
  return supportHeight(x, z, y + 0.1, 0.2) > 0.05 ? 'stone' : 'sand';
}
