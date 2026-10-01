import * as THREE from 'three';
import { TAU, UP, rand, smooth } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { settings } from '../config/settings.js';
import { TEX } from '../assets/textures.js';
import { std } from '../assets/materials.js';

/* Bullet holes, blood splatter, pooling blood and scorch marks, drawn as pooled quads. */

export const DMAT = {};
const decalGeo = new THREE.PlaneGeometry(1, 1);
const decals = [];
const growing = [];
let head = 0;
const MAX = 200;
const _v = new THREE.Vector3();

export function initDecals() {
  const mk = (map, rough, extra = {}) => std(Object.assign({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: rough }, extra));
  DMAT.hole = mk(TEX.hole, 0.95);
  DMAT.blood = TEX.blood.map((t) => mk(t, 0.32));
  DMAT.pool = mk(TEX.pool, 0.12, { metalness: 0.1 });
  DMAT.scorch = mk(TEX.scorch, 1);
}

export function decal(point, normal, mat, size, parent) {
  let m = decals[head];
  if (!m) { m = new THREE.Mesh(decalGeo, mat); m.receiveShadow = true; decals[head] = m; }
  head = (head + 1) % MAX;
  if (m.parent) m.parent.remove(m);
  m.material = mat;
  m.scale.set(size, size, 1);
  scene.add(m);
  m.position.copy(point).addScaledVector(normal, 0.012 + Math.random() * 0.006);
  m.lookAt(_v.copy(m.position).add(normal));
  m.rotateZ(Math.random() * TAU);
  m.updateMatrixWorld();
  if (parent) parent.attach(m);
  return m;
}
export const bloodDecal = (point, normal, size) => settings.blood && decal(point, normal, DMAT.blood[Math.floor(Math.random() * 3)], size);
export function bloodPool(x, z, y) {
  if (!settings.blood) return;
  const m = decal(_v.set(x, y, z), UP, DMAT.pool, 0.1);
  growing.push({ m, t: 0, max: rand(1.4, 2.1) });
}
export function updateDecals(dt) {
  for (let i = growing.length - 1; i >= 0; i--) {
    const g = growing[i];
    g.t += dt;
    const s = g.max * smooth(Math.min(1, g.t / 5));
    g.m.scale.set(s, s, 1);
    if (g.t > 5) growing.splice(i, 1);
  }
}
export function clearDecals() {
  for (const d of decals) if (d && d.parent) d.parent.remove(d);
  growing.length = 0;
}
