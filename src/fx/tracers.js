import * as THREE from 'three';
import { rand } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { MAT } from '../assets/materials.js';
import { supportHeight } from '../world/collision.js';
import { sfx } from '../audio/sfx.js';

/* Glowing tracer rounds, short-lived muzzle/explosion lights and bouncing brass casings. */

const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.5);
const tracerMats = {};
const tracers = [];
let tracerHead = 0;
const flashLights = [];
let flashHead = 0;
const casings = [];
let casingHead = 0;
const casingGeo = new THREE.CylinderGeometry(0.0055, 0.0055, 0.026, 6).rotateZ(Math.PI / 2);
const shellGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.06, 8).rotateZ(Math.PI / 2);
const _v = new THREE.Vector3();

export function initTracers() {
  const mk = (r, g, b, o) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  tracerMats.player = mk(3.2, 2.4, 1.4, 0.55);
  tracerMats.enemy = mk(4.5, 1.6, 0.6, 0.9);
  tracerMats.ally = mk(1.6, 4.2, 1.2, 0.8);
  for (let i = 0; i < 32; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMats.player);
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    tracers.push({ m, a: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, on: false, w: 0.02 });
  }
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xffb070, 0, 10, 2);
    scene.add(l);
    flashLights.push({ l, t: 0, dur: 1, i0: 0 });
  }
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xa8201a, roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(casingGeo, MAT.brass);
    m.visible = false;
    scene.add(m);
    casings.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, bounces: 0, on: false, shellMat });
  }
}

export function tracer(from, to, kind = 'player') {
  const tr = tracers[tracerHead];
  tracerHead = (tracerHead + 1) % tracers.length;
  tr.a.copy(from);
  tr.dir.subVectors(to, from);
  tr.dist = tr.dir.length();
  tr.dir.normalize();
  tr.t = 0; tr.on = true; tr.m.visible = true;
  tr.m.material = tracerMats[kind] || tracerMats.player;
  tr.w = kind === 'player' ? 0.014 : 0.028;
}

export function flashLight(pos, intensity, dist, dur, color = 0xffb070) {
  const f = flashLights[flashHead];
  flashHead = (flashHead + 1) % flashLights.length;
  f.l.position.copy(pos); f.l.color.setHex(color); f.l.distance = dist;
  f.i0 = intensity; f.t = 0; f.dur = dur; f.l.intensity = intensity;
}

export function ejectCasing(pos, vel, shotgun = false) {
  const c = casings[casingHead];
  casingHead = (casingHead + 1) % casings.length;
  c.m.geometry = shotgun ? shellGeo : casingGeo;
  c.m.material = shotgun ? c.shellMat : MAT.brass;
  c.m.position.copy(pos); c.v.copy(vel);
  c.spin.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
  c.t = 0; c.bounces = 0; c.on = true; c.m.visible = true;
  c.shotgun = shotgun;
}

export function updateTransientFx(dt) {
  for (const tr of tracers) {
    if (!tr.on) continue;
    tr.t += dt;
    const travelled = tr.t * 340, head = Math.min(tr.dist, travelled), len = Math.min(4.5, head);
    if (travelled - 4.5 > tr.dist) { tr.on = false; tr.m.visible = false; continue; }
    tr.m.position.copy(tr.a).addScaledVector(tr.dir, head);
    tr.m.lookAt(_v.copy(tr.m.position).add(tr.dir));
    tr.m.scale.set(tr.w, tr.w, Math.max(0.01, len));
  }
  for (const f of flashLights) {
    if (f.l.intensity <= 0) continue;
    f.t += dt;
    f.l.intensity = f.t >= f.dur ? 0 : f.i0 * (1 - f.t / f.dur) ** 2;
  }
  for (const c of casings) {
    if (!c.on) continue;
    c.t += dt;
    if (c.t > 14) { c.on = false; c.m.visible = false; continue; }
    if (c.bounces >= 3) continue;
    c.v.y -= 9.8 * dt;
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
    const g = supportHeight(c.m.position.x, c.m.position.z, c.m.position.y + 0.1) + 0.006;
    if (c.m.position.y < g) {
      c.m.position.y = g;
      c.v.y = -c.v.y * 0.35; c.v.x *= 0.55; c.v.z *= 0.55;
      c.spin.multiplyScalar(0.5);
      c.bounces++;
      if (c.bounces === 1) sfx.casing(c.m.position, c.shotgun);
      if (c.bounces >= 3) { c.m.rotation.x = 0; c.m.rotation.z = 0; }
    }
  }
}
export function clearTransientFx() {
  for (const c of casings) { c.on = false; c.m.visible = false; }
  for (const t of tracers) { t.on = false; t.m.visible = false; }
}
