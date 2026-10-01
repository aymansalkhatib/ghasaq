import * as THREE from 'three';
import { solidMeshes, props, enemies, ragdolls, allies, refs } from '../core/state.js';

/* Shared ray queries: sight lines, bullet targets and ray-vs-character tests. */

export const raycaster = new THREE.Raycaster();
const _d = new THREE.Vector3(), _n = new THREE.Vector3();

/** True when static geometry blocks the straight line from a to b. */
export function losBlocked(a, b) {
  const dist = _d.subVectors(b, a).length();
  if (dist < 0.01) return false;
  raycaster.set(a, _d.divideScalar(dist));
  raycaster.near = 0;
  raycaster.far = dist - 0.05;
  return raycaster.intersectObjects(solidMeshes, false).length > 0;
}
export const hitNormal = (h) => _n.copy(h.face.normal).transformDirection(h.object.matrixWorld);

/**
 * Ray against an upright character capsule (feet at t.pos, height t.eyeH, radius 0.36).
 * Returns the entry distance or -1.
 */
export function rayCharacter(o, d, t) {
  const px = t.pos.x, pz = t.pos.z, dd = d.x * d.x + d.z * d.z;
  if (dd < 1e-6) return -1;
  const s = ((px - o.x) * d.x + (pz - o.z) * d.z) / dd;
  if (s < 0) return -1;
  const hx = o.x + d.x * s - px, hz = o.z + d.z * s - pz, hd = Math.hypot(hx, hz), R = 0.36;
  if (hd > R) return -1;
  const te = s - Math.sqrt(R * R - hd * hd) / Math.sqrt(dd);
  const y = o.y + d.y * te;
  if (y < t.pos.y + 0.05 || y > t.pos.y + t.eyeH + 0.15) return -1;
  return te;
}

/*
 * Meshes a bullet can strike. The static-world list is cached and only rebuilt when
 * props are added or removed, so the many ray casts per frame allocate nothing.
 */
let worldCache = [], cacheKey = '';
export const bulletTargets = {
  world() {
    const key = solidMeshes.length + ':' + props.length + ':' + (props[0] ? props[0].mesh.id : 0) + ':' + (props.length ? props[props.length - 1].mesh.id : 0);
    if (key !== cacheKey) { cacheKey = key; worldCache = solidMeshes.concat(props.map((p) => p.mesh)); }
    return worldCache;
  },
  all() {
    const list = this.world().slice();
    for (const e of enemies) if (e.alive) for (const h of e.ch.hitboxes) list.push(h);
    for (const r of ragdolls) for (const h of r.ch.hitboxes) list.push(h);
    for (const a of allies) if (a.alive) for (const h of a.ch.hitboxes) list.push(h);
    const heli = refs.heli;
    if (heli && heli.hitbox && heli.state !== 'dead') list.push(heli.hitbox);
    return list;
  },
  /** World plus live raiders only (ally fire, auto-fire checks). */
  hostiles() {
    const list = this.world().slice();
    for (const e of enemies) if (e.alive) for (const h of e.ch.hitboxes) list.push(h);
    return list;
  },
};
