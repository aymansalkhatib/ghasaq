import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { UP } from '../core/utils.js';
import { vmScene } from '../core/renderer.js';
import { todHooks } from '../core/sky.js';
import { TEX } from '../assets/textures.js';
import { std } from '../assets/materials.js';

/*
 * First-person weapons and hands. Every weapon is modelled from real-world side profiles
 * (receiver, handguard, grip, magazine, stock) extruded with bevelled edges, plus turned parts
 * (barrels, tubes, scope). Gloved hands have fingers wrapped round the grip, and the right sleeve
 * carries the Syrian flag. Parts of one weapon are merged per material to keep draw calls low;
 * moving parts (magazine, pump, slide) are their own groups.
 *
 * Space: the weapon points down -Z, +Y is up, +X is to the right.
 */

export const vmRoot = new THREE.Group();
vmScene.add(vmRoot);
export const VM = {};
export const models = {};
export let nadeHand = null;
export let knifeHand = null;

/* ---------- a kit collects geometry per material and merges it into one mesh each ---------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
class Kit {
  constructor(parent) { this.parent = parent; this.parts = new Map(); this.frame = null; }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s));
    return this.put(geo, mat);
  }
  put(geo, mat) {
    if (this.frame) geo.applyMatrix4(this.frame);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
    return geo;
  }
  build() {
    for (const [mat, list] of this.parts) {
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
        return n;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      this.parent.add(mesh);
    }
    this.parts.clear();
  }
}

/* ---------- primitive helpers ---------- */
function box(k, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) { return k.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz); }
function rbox(k, w, h, d, r, mat, x, y, z, rx = 0, ry = 0, rz = 0) { return k.add(new RoundedBoxGeometry(w, h, d, 2, r), mat, x, y, z, rx, ry, rz); }
/** Cylinder lying along Z. */
function tube(k, r1, r2, len, mat, x, y, z, seg = 16) { return k.add(new THREE.CylinderGeometry(r1, r2, len, seg), mat, x, y, z, Math.PI / 2, 0, 0); }
function ball(k, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) { const g = new THREE.SphereGeometry(r, 14, 10); g.scale(sx, sy, sz); return k.add(g, mat, x, y, z); }
/** Capsule from a to b. */
function limb(k, a, b, r, mat, r2) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = r2 ? new THREE.CylinderGeometry(r2, r, len, 14) : new THREE.CapsuleGeometry(r, len, 4, 12);
  _q.setFromUnitVectors(UP, d.normalize());
  g.applyMatrix4(_m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s));
  return k.put(g, mat);
}
/**
 * Side profile given as (z, y) points, extruded across X to thickness t with a bevel.
 * A point with four numbers [z, y, cz, cy] is a quadratic curve through control (cz, cy).
 */
function shapeOf(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[2], p[3], p[0], p[1]); else s.lineTo(p[0], p[1]);
  }
  s.closePath();
  return s;
}
function prof(k, pts, t, mat, x = 0, bevel = 0.002, holes) {
  const s = shapeOf(pts);
  if (holes) for (const h of holes) s.holes.push(shapeOf(h));
  const depth = Math.max(0.0005, t - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(x, 0, 0);
  return k.put(g, mat);
}
/** Solid of revolution along Z from (z, r) pairs. */
function lathe(k, pts, mat, x, y, z, sx = 1, seg = 18) {
  // LatheGeometry faces outward when the profile runs toward +axis
  if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.slice().reverse();
  const g = new THREE.LatheGeometry(pts.map(([zz, r]) => new THREE.Vector2(r, zz)), seg);
  g.rotateX(Math.PI / 2);
  g.scale(sx, 1, 1);
  return k.add(g, mat, x, y, z);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- hands ---------- */
function fingerChain(k, pts, r, mat) {
  for (let i = 0; i < pts.length - 1; i++) limb(k, pts[i], pts[i + 1], r * (1 - i * 0.07), mat);
}
/** Sleeve from the wrist toward the camera; the right one carries the Syrian flag patch. */
function sleeve(k, wrist, end, r, flag) {
  const cuffEnd = wrist.clone().lerp(end, 0.2);
  limb(k, wrist, cuffEnd, r * 0.7, VM.glove, r * 0.8);   // glove cuff
  limb(k, cuffEnd, end, r * 0.9, VM.sleeve, r * 1.08);
  if (!flag) return;
  // flag patch hugging the sleeve, on its outer (right, upper) face
  const axis = new THREE.Vector3().subVectors(end, cuffEnd).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
  const local = V(0.85, 0.55, 0).applyQuaternion(q.clone().invert());
  const theta = Math.atan2(local.x, local.z), w = 0.05 / (r + 0.002);
  const g = new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.034, 10, 1, true, theta - w / 2, w);
  // the texture reads left→right on the outside of the sleeve
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const c = cuffEnd.clone().lerp(end, 0.5);
  g.applyMatrix4(_m.compose(c, q, _s));
  k.put(g, VM.patch);
}
/**
 * Right hand round a pistol grip running from `top` to `bot` (z, y). halfW = half the grip width,
 * hd = half its depth front-to-back. The index finger rests on the trigger.
 */
function gripHand(k, top, bot, halfW, hd, sleeveEnd, opts = {}) {
  const [tz, ty] = top, [bz, by] = bot;
  const frame = new THREE.Matrix4().compose(V(0, ty, tz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.atan2(bz - tz, -(by - ty)), 0, 0)), _s);
  const prev = k.frame;
  k.frame = prev ? prev.clone().multiply(frame) : frame;
  const G = VM.glove, xs = halfW;
  // back of the hand along the right side and the web over the back strap
  rbox(k, 0.024, 0.078, 0.06, 0.009, G, xs + 0.011, -0.046, 0.004);
  rbox(k, xs * 2 + 0.018, 0.03, 0.02, 0.008, G, 0.006, -0.016, hd + 0.006);
  rbox(k, 0.02, 0.06, 0.035, 0.008, G, -xs - 0.004, -0.05, hd - 0.004);
  // middle, ring and little fingers wrapped round the front strap
  [[-0.03, 0.0098], [-0.051, 0.0094], [-0.071, 0.0086]].forEach(([y, r]) => {
    fingerChain(k, [V(xs + 0.012, y, -hd + 0.012), V(xs + 0.002, y - 0.002, -hd - 0.009), V(-xs + 0.004, y - 0.004, -hd - 0.011), V(-xs - 0.007, y - 0.005, -hd + 0.008)], r, G);
  });
  // index finger curled onto the trigger (tip given in weapon space)
  const tip = V(0.004, opts.trigger[1], opts.trigger[0]).applyMatrix4(frame.clone().invert());
  const knuckle = V(xs + 0.012, -0.009, -hd + 0.01);
  const mid = knuckle.clone().lerp(tip, 0.5).add(V(0.008, 0.004, 0));
  fingerChain(k, [knuckle, mid, tip], 0.0092, G);
  // thumb over the top of the grip, along the left side
  fingerChain(k, [V(xs + 0.004, -0.02, hd), V(-xs - 0.006, -0.011, hd - 0.012), V(-xs - 0.01, -0.011, -0.01), V(-xs - 0.008, -0.013, -hd + 0.004)], 0.0102, G);
  const wrist = V(xs + 0.01, -0.085, 0.018).applyMatrix4(k.frame);
  k.frame = prev;
  sleeve(k, wrist, sleeveEnd, 0.046, true);
}
/** Left hand under a handguard (axis along Z at y = yc, z = zc): palm below, fingers up the right side. */
function supportHand(k, zc, yc, hw, hh, sleeveEnd) {
  const G = VM.glove;
  rbox(k, hw * 2 + 0.012, 0.024, 0.078, 0.009, G, -0.004, yc - hh - 0.012, zc + 0.004);
  [-0.028, -0.009, 0.01, 0.028].forEach((dz, i) => {
    const r = [0.0092, 0.0098, 0.0095, 0.0086][i];
    fingerChain(k, [V(hw - 0.004, yc - hh - 0.012, zc + dz), V(hw + 0.01, yc - hh + 0.006, zc + dz - 0.002), V(hw + 0.011, yc + 0.002, zc + dz - 0.005), V(hw + 0.004, yc + hh * 0.55, zc + dz - 0.007)], r, G);
  });
  fingerChain(k, [V(-hw - 0.004, yc - hh - 0.006, zc + 0.036), V(-hw - 0.011, yc - 0.006, zc + 0.012), V(-hw - 0.008, yc + hh * 0.35, zc - 0.022)], 0.0104, G);
  sleeve(k, V(-0.016, yc - hh - 0.022, zc + 0.045), sleeveEnd, 0.044, false);
}

/* ---------- sights, muzzle flash ---------- */
function flashRig(parent, z, size) {
  const g = new THREE.Group(); g.position.z = z; parent.add(g);
  const pg = new THREE.PlaneGeometry(size, size), side = new THREE.PlaneGeometry(size * 1.8, size * 0.7);
  const a = new THREE.Mesh(pg, VM.flash), c = new THREE.Mesh(side, VM.flash), c2 = new THREE.Mesh(side, VM.flash);
  c.rotation.y = Math.PI / 2; c.position.z = -size * 0.5;
  c2.rotation.set(Math.PI / 2, Math.PI / 2, 0); c2.position.z = -size * 0.5;
  g.add(a, c, c2); g.visible = false;
  return g;
}
/*
 * Optics. When aiming, the eye sits `eye` metres behind the rear face of a sight window. Window
 * frames flare toward the muzzle in proportion to their distance from that eye point, so their
 * inner walls stay edge-on: through the sight you only ever see a thin rim, never a tunnel.
 * Everything else of the weapon stays below the window.
 */
function rrect(p, cx, cy, w, h, r) {
  const x0 = cx - w / 2, y0 = cy - h / 2;
  p.moveTo(x0 + r, y0);
  p.lineTo(x0 + w - r, y0); p.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  p.lineTo(x0 + w, y0 + h - r); p.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  p.lineTo(x0 + r, y0 + h); p.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}
/** A flat outline (with an aperture hole) centred on the sight axis, extruded `depth` toward -Z from zRear, flared for an eye at eyeZ. */
function sightFrame(k, outer, hole, y, zRear, depth, eyeZ, mat) {
  const s = outer(new THREE.Shape());
  if (hole) s.holes.push(hole(new THREE.Path()));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 14 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = zRear - depth + p.getZ(i), f = (eyeZ - z) / (eyeZ - zRear);
    p.setXYZ(i, p.getX(i) * f, y + p.getY(i) * f, z);
  }
  g.computeVertexNormals();
  return k.put(g, mat);
}
/**
 * A reticle projected to infinity: a sprite two metres beyond the window, so moving the gun a
 * little never walks the dot off the aim point. `ang` = angular radius of the feature at `frac`
 * of the texture's half-size. Faded in by the aim animation.
 */
function reticle(g, y, z, eyeZ, tex, ang, frac) {
  const D = 2;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(3.2, 1.1, 0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
  s.position.set(0, y, z - D);
  s.scale.setScalar((2 * ang * (eyeZ - z + D)) / frac);
  s.renderOrder = 5;
  g.add(s);
  return s;
}
/** Picatinny rail from z0 to z1 at height y. */
function rail(k, y, z0, z1, w = 0.024) {
  box(k, w, 0.006, z0 - z1, VM.dark, 0, y, (z0 + z1) / 2);
  for (let z = z0 - 0.004; z > z1 + 0.002; z -= 0.01) box(k, w + 0.004, 0.0045, 0.0052, VM.dark, 0, y + 0.005, z);
}
/**
 * Holographic sight on a riser mount (rifle): a large rectangular window under a thin hood,
 * electronics and a side battery cap below and behind it, buttons on the rear face.
 * o: { y: axis height, z: rear face of the window frame, eye, w, h, railY }
 */
function holoSight(k, g, o) {
  const D = VM.dark, O = VM.optic, { y, z, w, h, railY } = o, eyeZ = z + o.eye;
  const t = 0.0026, top = 0.0042, base = y - h / 2 - 0.0028;
  sightFrame(k, (s) => rrect(s, 0, (top - t) / 2, w + t * 2, h + t + top, 0.006), (p) => rrect(p, 0, 0, w, h, 0.0035), y, z, 0.02, eyeZ, O);
  // electronics body under the window (kept short at the back so it stays low in the view)
  rbox(k, w + 0.004, base - railY - 0.008, 0.062, 0.004, O, 0, (base + railY + 0.008) / 2, z - 0.026);
  rbox(k, w - 0.004, 0.004, 0.03, 0.0015, D, 0, base - 0.001, z - 0.012);
  // riser mount with its cross-bolts and quick-detach lever
  box(k, 0.03, 0.009, 0.06, D, 0, railY + 0.0045, z - 0.01);
  for (const dz of [-0.03, 0.01]) tube(k, 0.0028, 0.0028, 0.036, VM.metal, 0, railY + 0.004, z + dz, 8).rotateY(Math.PI / 2);
  prof(k, [[z + 0.012, railY + 0.004], [z - 0.03, railY + 0.004], [z - 0.034, railY + 0.009], [z + 0.008, railY + 0.011]], 0.004, D, -0.019, 0.001);
  // transverse battery cap on the right, push-buttons on the rear face
  k.add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 16), D, w / 2 + 0.005, base - 0.008, z - 0.03, 0, 0, Math.PI / 2);
  for (const dz of [-0.012, -0.024]) rbox(k, 0.004, 0.006, 0.009, 0.0015, VM.poly, -w / 2 - 0.003, base - 0.007, z + dz);
  // window and reticle
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.1, h * 1.1), VM.holoGlass);
  glass.position.set(0, y, z - 0.01); g.add(glass);
  return reticle(g, y, z, eyeZ, TEX.holo, 0.024, 40 / 64);
}
/** Open reflex sight (SMG): round window in a slim frame on a low body. o: { y, z, eye, r, railY } */
function reflexSight(k, g, o) {
  const O = VM.optic, { y, z, r, railY } = o, eyeZ = z + o.eye, R = r + 0.0024, foot = -(r + 0.005);
  sightFrame(k, (s) => { s.moveTo(-R, 0); s.absarc(0, 0, R, Math.PI, 0, true); s.lineTo(R, foot); s.lineTo(-R, foot); s.closePath(); return s; },
    (p) => { p.absarc(0, 0, r, 0, Math.PI * 2, false); return p; }, y, z, 0.007, eyeZ, O);
  const bodyTop = y + foot;
  rbox(k, 2 * R + 0.002, bodyTop - railY + 0.002, 0.042, 0.004, O, 0, (bodyTop + railY) / 2, z - 0.019);
  rbox(k, 0.01, 0.006, 0.01, 0.002, O, 0, bodyTop + 0.002, z - 0.001);       // emitter
  box(k, 0.008, 0.006, 0.01, VM.poly, R + 0.003, bodyTop - 0.004, z - 0.02); // brightness button
  for (const dz of [-0.03, 0.002]) box(k, 0.034, 0.004, 0.006, VM.metal, 0, railY + 0.002, z + dz);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.05, 28), VM.reflexGlass);
  glass.position.set(0, y, z - 0.004); g.add(glass);
  return reticle(g, y, z, eyeZ, TEX.reflex, 0.0045, 5 / 32);
}
/**
 * Ghost-ring rear sight (shotgun): a thin aperture between protective ears; the front post
 * carries a green fibre-optic dot. o: { y, z (rear face of the ring), eye, baseY, frontZ, frontBase }
 */
function ghostRing(k, o) {
  const D = VM.dark, { y, z, baseY } = o, eyeZ = z + o.eye, ri = 0.0068, ro = 0.0094;
  const dl = Math.asin(0.004 / ro);
  sightFrame(k, (s) => { s.moveTo(-0.004, -ro - 0.004); s.lineTo(-0.004, -ro * Math.cos(dl)); s.absarc(0, 0, ro, -Math.PI / 2 - dl, -Math.PI / 2 + dl, true); s.lineTo(0.004, -ro - 0.004); s.closePath(); return s; },
    (p) => { p.absarc(0, 0, ri, 0, Math.PI * 2, false); return p; }, y, z, 0.0035, eyeZ, D);
  rbox(k, 0.022, y - ro - 0.002 - baseY, 0.03, 0.003, D, 0, (y - ro - 0.002 + baseY) / 2, z - 0.01);
  // low protective shoulders either side of the stem, well below the aperture
  for (const s of [-1, 1]) prof(k, [[z + 0.002, baseY], [z - 0.026, baseY], [z - 0.026, y - ro - 0.001], [z + 0.002, y - ro - 0.004]], 0.004, D, s * 0.0088, 0.0008);
  // front post on a ramp, with wings either side
  const fz = o.frontZ, fb = o.frontBase;
  prof(k, [[fz + 0.03, fb], [fz - 0.012, fb], [fz - 0.012, fb + 0.01], [fz + 0.03, fb + 0.004]], 0.012, D, 0, 0.001);
  box(k, 0.0032, y - 0.0015 - fb, 0.006, D, 0, (y - 0.0015 + fb) / 2, fz);
  for (const s of [-1, 1]) prof(k, [[fz + 0.012, fb], [fz - 0.01, fb], [fz - 0.01, y - 0.004], [fz + 0.004, y - 0.004]], 0.002, D, s * 0.0065, 0.0005);
  ball(k, 0.0026, VM.fiber, 0, y - 0.0022, fz + 0.0031);
}

/* ---------- weapons ---------- */
function buildRifle() {
  const g = new THREE.Group(), k = new Kit(g);
  const Mt = VM.metal, D = VM.dark, P = VM.poly, T = VM.tan;
  // flat-top upper receiver: ejection port and dust cover, brass deflector, forward assist, charging handle
  prof(k, [[0.165, 0.018], [0.165, 0.062], [0.152, 0.068], [-0.115, 0.068], [-0.121, 0.062], [-0.121, 0.018]], 0.05, Mt, 0, 0.003);
  box(k, 0.002, 0.018, 0.07, D, 0.0262, 0.045, 0.02);
  box(k, 0.003, 0.003, 0.074, Mt, 0.0272, 0.034, 0.02);
  prof(k, [[0.078, 0.036], [0.058, 0.036], [0.062, 0.058], [0.078, 0.058]], 0.008, Mt, 0.027, 0.0015);
  tube(k, 0.0085, 0.0085, 0.032, Mt, 0.022, 0.056, 0.128, 12);
  tube(k, 0.0065, 0.0065, 0.006, D, 0.022, 0.056, 0.146, 12);
  rbox(k, 0.052, 0.008, 0.026, 0.003, D, 0, 0.066, 0.18);
  rail(k, 0.0715, 0.155, -0.118, 0.024);
  // free-float handguard with M-LOK slots and a short rail at the front for the folded back-up sight
  prof(k, [[-0.121, 0.009], [-0.121, 0.066], [-0.47, 0.066], [-0.474, 0.058], [-0.474, 0.013], [-0.47, 0.009]], 0.056, T, 0, 0.006);
  for (const s of [-1, 1]) for (let z = -0.16; z > -0.44; z -= 0.052) {
    rbox(k, 0.003, 0.011, 0.032, 0.0014, D, s * 0.0285, 0.041, z);
    rbox(k, 0.003, 0.008, 0.02, 0.0014, D, s * 0.0285, 0.02, z - 0.012);
  }
  for (let z = -0.16; z > -0.44; z -= 0.052) rbox(k, 0.012, 0.003, 0.03, 0.0012, D, 0, 0.0035, z);
  rbox(k, 0.06, 0.012, 0.014, 0.004, D, 0, 0.036, -0.126);           // barrel-nut ring at the receiver
  rail(k, 0.0675, -0.425, -0.47, 0.022);
  prof(k, [[-0.438, 0.072], [-0.466, 0.072], [-0.468, 0.0765], [-0.44, 0.0755]], 0.02, D, 0, 0.001);
  prof(k, [[0.15, 0.077], [0.126, 0.077], [0.126, 0.0815], [0.15, 0.081]], 0.022, D, 0, 0.001);
  // barrel, gas block peeking out, three-port muzzle brake
  tube(k, 0.0092, 0.0092, 0.14, Mt, 0, 0.04, -0.54);
  tube(k, 0.0125, 0.0125, 0.012, D, 0, 0.04, -0.482, 14);
  lathe(k, [[-0.598, 0], [-0.598, 0.013], [-0.603, 0.0145], [-0.652, 0.0145], [-0.656, 0.012], [-0.656, 0]], D, 0, 0.04, 0);
  for (let i = 0; i < 3; i++) box(k, 0.03, 0.004, 0.006, Mt, 0, 0.049, -0.612 - i * 0.013);
  // weapon light low on the right side, clear of the sight picture
  box(k, 0.01, 0.014, 0.028, D, 0.031, 0.036, -0.4);
  tube(k, 0.0105, 0.0105, 0.07, D, 0.043, 0.036, -0.4, 14);
  tube(k, 0.0125, 0.0125, 0.016, D, 0.043, 0.036, -0.44, 14);
  box(k, 0.006, 0.008, 0.01, VM.poly, 0.043, 0.047, -0.378);             // tail-cap switch
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0105, 16), VM.lens); lens.position.set(0.043, 0.036, -0.4485); lens.rotation.y = Math.PI; g.add(lens);
  // lower receiver with magwell, trigger guard, trigger, pistol grip, controls
  prof(k, [[0.142, 0.018], [0.142, -0.004], [0.122, -0.02], [0.072, -0.027], [0.004, -0.027], [-0.012, -0.031], [-0.02, -0.074], [-0.106, -0.074], [-0.111, -0.02], [-0.121, 0.018]], 0.046, Mt, 0, 0.002);
  prof(k, [[0.072, -0.026], [0.072, -0.05], [0.062, -0.058], [-0.004, -0.058], [-0.013, -0.05], [-0.013, -0.03]], 0.012, Mt, 0, 0.0015,
    [[[0.064, -0.029], [0.064, -0.047], [0.057, -0.052], [0.001, -0.052], [-0.006, -0.046], [-0.006, -0.03]]]);
  prof(k, [[0.043, -0.027], [0.048, -0.027], [0.046, -0.04], [0.039, -0.049], [0.035, -0.047], [0.041, -0.038]], 0.006, D, 0, 0.001);
  box(k, 0.006, 0.006, 0.016, D, 0.024, 0.006, 0.105);     // safety selector
  k.add(new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 12), D, 0.0245, -0.008, -0.006, 0, 0, Math.PI / 2);   // magazine release
  prof(k, [[0.02, 0.004], [-0.018, 0.004], [-0.022, 0.014], [0.016, 0.014]], 0.004, D, -0.025, 0.001);          // bolt catch
  prof(k, [[0.066, -0.026], [0.108, -0.026], [0.118, -0.04], [0.148, -0.128], [0.146, -0.139], [0.118, -0.143], [0.102, -0.137], [0.084, -0.09], [0.089, -0.08], [0.081, -0.068], [0.085, -0.058], [0.076, -0.046]], 0.032, P, 0, 0.004);
  // buffer tube, castle nut and QD sling point, collapsible stock with a rubber butt pad
  tube(k, 0.0158, 0.0158, 0.21, D, 0, 0.034, 0.25, 18);
  tube(k, 0.019, 0.019, 0.012, D, 0, 0.034, 0.152, 10);
  k.add(new THREE.TorusGeometry(0.009, 0.0022, 6, 14), Mt, -0.026, 0.03, 0.158, 0, Math.PI / 2, 0);
  prof(k, [[0.218, 0.062], [0.345, 0.064], [0.353, 0.058], [0.361, -0.068], [0.351, -0.078], [0.332, -0.078], [0.292, -0.022], [0.236, -0.002], [0.222, 0.01], [0.216, 0.048]], 0.046, P, 0, 0.004);
  rbox(k, 0.05, 0.144, 0.014, 0.004, D, 0, -0.006, 0.366);
  box(k, 0.02, 0.01, 0.05, D, 0, -0.004, 0.25);
  // curved 30-round polymer magazine with a round-count window
  const mag = new THREE.Group(); g.add(mag);
  const km = new Kit(mag);
  prof(km, [[-0.024, -0.02], [-0.102, -0.02], [-0.108, -0.1, -0.103, -0.06], [-0.121, -0.198, -0.113, -0.15], [-0.121, -0.207], [-0.054, -0.212], [-0.047, -0.2], [-0.029, -0.07, -0.036, -0.12]], 0.026, T, 0, 0.002);
  for (const s of [-1, 1]) prof(km, [[-0.038, -0.045], [-0.093, -0.045], [-0.098, -0.1], [-0.042, -0.1]], 0.0015, D, s * 0.0138, 0);
  for (const s of [-1, 1]) prof(km, [[-0.088, -0.108], [-0.1, -0.108], [-0.106, -0.168], [-0.094, -0.168]], 0.0012, VM.brass, s * 0.0137, 0);
  prof(km, [[-0.052, -0.206], [-0.124, -0.2], [-0.126, -0.214], [-0.05, -0.221]], 0.032, D, 0, 0.002);
  km.build();
  // holographic sight on a riser: the window sits 7.5 cm from the eye when aiming
  const ret = holoSight(k, g, { y: 0.118, z: -0.012, eye: 0.075, w: 0.042, h: 0.032, railY: 0.0775 });
  gripHand(k, [0.09, -0.034], [0.13, -0.136], 0.018, 0.026, V(0.13, -0.3, 0.5), { trigger: [0.04, -0.04] });
  supportHand(k, -0.315, 0.038, 0.03, 0.033, V(-0.2, -0.3, 0.02));
  k.build();
  return { g, mag, reticle: ret, flash: flashRig(g, -0.67, 0.16), sightY: 0.118, adsZ: -0.063 };
}

function buildSMG() {
  const g = new THREE.Group(), k = new Kit(g);
  const Mt = VM.metal, D = VM.dark, P = VM.poly, T = VM.tan;
  // pressed-steel receiver with its cocking tube above the barrel, rail on top
  prof(k, [[0.12, 0.0], [0.12, 0.05], [0.106, 0.062], [-0.14, 0.062], [-0.152, 0.052], [-0.152, 0.0]], 0.044, Mt, 0, 0.004);
  for (const s of [-1, 1]) box(k, 0.002, 0.012, 0.2, D, s * 0.0232, 0.03, -0.02);
  for (const s of [-1, 1]) box(k, 0.0015, 0.006, 0.16, Mt, s * 0.0228, 0.016, -0.03);
  tube(k, 0.0105, 0.0105, 0.15, Mt, 0, 0.05, -0.225, 14);
  rbox(k, 0.012, 0.01, 0.018, 0.003, D, -0.02, 0.052, -0.19, 0, 0, 0.4);
  box(k, 0.03, 0.004, 0.22, D, 0, 0.064, -0.01);
  rail(k, 0.066, 0.1, -0.12, 0.022);
  // rear drum sight (seen at the hip only; it sits behind the eye when aiming)
  k.add(new THREE.CylinderGeometry(0.012, 0.012, 0.028, 16), D, 0, 0.072, 0.108, 0, 0, Math.PI / 2);
  box(k, 0.03, 0.012, 0.02, D, 0, 0.063, 0.108);
  // fat ribbed handguard with a sling loop
  prof(k, [[-0.152, -0.002], [-0.152, 0.045], [-0.3, 0.045], [-0.31, 0.034], [-0.31, 0.006], [-0.3, -0.006]], 0.056, T, 0, 0.008);
  for (let z = -0.17; z > -0.3; z -= 0.022) for (const s of [-1, 1]) box(k, 0.002, 0.032, 0.004, D, s * 0.0292, 0.02, z);
  k.add(new THREE.TorusGeometry(0.008, 0.002, 6, 14), Mt, -0.03, 0.03, -0.29, 0, Math.PI / 2, 0);
  // barrel, three-lug muzzle, a low front post that stays under the sight picture
  tube(k, 0.0088, 0.0088, 0.06, Mt, 0, 0.03, -0.34);
  lathe(k, [[-0.36, 0], [-0.36, 0.0125], [-0.382, 0.0125], [-0.386, 0.009], [-0.386, 0]], D, 0, 0.03, 0);
  for (let i = 0; i < 3; i++) box(k, 0.004, 0.006, 0.01, D, Math.cos(i * 2.1) * 0.013, 0.03 + Math.sin(i * 2.1) * 0.013, -0.352);
  box(k, 0.005, 0.01, 0.012, Mt, 0, 0.059, -0.305);
  // trigger group, selector, paddle release, grip
  prof(k, [[0.09, 0.002], [0.09, -0.016], [0.064, -0.02], [-0.02, -0.02], [-0.03, -0.004], [-0.04, 0.002]], 0.04, P, 0, 0.002);
  prof(k, [[0.054, -0.018], [0.054, -0.04], [0.046, -0.048], [-0.008, -0.048], [-0.016, -0.04], [-0.016, -0.018]], 0.012, P, 0, 0.0015,
    [[[0.047, -0.021], [0.047, -0.038], [0.041, -0.042], [-0.003, -0.042], [-0.009, -0.036], [-0.009, -0.021]]]);
  prof(k, [[0.026, -0.02], [0.031, -0.02], [0.029, -0.031], [0.022, -0.039], [0.019, -0.037], [0.024, -0.03]], 0.006, D, 0, 0.001);
  prof(k, [[-0.012, -0.02], [-0.03, -0.02], [-0.034, -0.03], [-0.014, -0.028]], 0.024, D, 0, 0.001);
  k.add(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), D, 0.022, -0.008, 0.07, 0, 0, Math.PI / 2);
  prof(k, [[0.052, -0.018], [0.09, -0.016], [0.1, -0.03], [0.126, -0.114], [0.123, -0.124], [0.098, -0.128], [0.083, -0.122], [0.066, -0.075], [0.07, -0.064], [0.062, -0.052], [0.066, -0.042], [0.058, -0.032]], 0.032, P, 0, 0.004);
  // retractable stock: two rods and a butt plate
  for (const [x, y] of [[-0.019, 0.044], [0.019, 0.044], [0, 0.004]]) tube(k, 0.0048, 0.0048, 0.2, D, x, y, 0.21, 10);
  prof(k, [[0.3, 0.056], [0.318, 0.056], [0.322, 0.046], [0.322, -0.07], [0.312, -0.078], [0.3, -0.07]], 0.05, D, 0, 0.003);
  // strongly curved magazine
  const mag = new THREE.Group(); g.add(mag);
  const km = new Kit(mag);
  prof(km, [[-0.034, -0.012], [-0.084, -0.012], [-0.1, -0.09, -0.086, -0.05], [-0.145, -0.172, -0.118, -0.14], [-0.138, -0.184], [-0.106, -0.188], [-0.068, -0.13, -0.083, -0.165], [-0.044, -0.06, -0.052, -0.095]], 0.022, D, 0, 0.002);
  for (const s of [-1, 1]) prof(km, [[-0.05, -0.03], [-0.074, -0.03], [-0.084, -0.08], [-0.06, -0.08]], 0.0012, Mt, s * 0.0116, 0);
  km.build();
  box(k, 0.03, 0.03, 0.058, Mt, 0, -0.012, -0.06);   // magwell
  // open reflex sight: the round window sits 7 cm from the eye when aiming
  const ret = reflexSight(k, g, { y: 0.102, z: 0.0, eye: 0.07, r: 0.0155, railY: 0.0735 });
  gripHand(k, [0.072, -0.028], [0.108, -0.122], 0.017, 0.025, V(0.13, -0.29, 0.46), { trigger: [0.024, -0.032] });
  supportHand(k, -0.232, 0.02, 0.03, 0.03, V(-0.19, -0.29, 0.1));
  k.build();
  return { g, mag, reticle: ret, flash: flashRig(g, -0.4, 0.13), sightY: 0.102, adsZ: -0.07 };
}

function buildShotgun() {
  const g = new THREE.Group(), k = new Kit(g);
  const Mt = VM.metal, D = VM.dark, T = VM.tan;
  // receiver with ejection port and a flat top, barrel under a ventilated heat shield, magazine tube
  prof(k, [[0.122, -0.006], [0.122, 0.048], [0.106, 0.056], [-0.12, 0.056], [-0.138, 0.048], [-0.138, -0.004], [-0.1, -0.02], [0.06, -0.02]], 0.048, Mt, 0, 0.003);
  box(k, 0.002, 0.022, 0.08, D, 0.0242, 0.034, -0.02);
  box(k, 0.0015, 0.004, 0.2, D, -0.0242, 0.012, 0.0);
  tube(k, 0.0122, 0.0122, 0.57, Mt, 0, 0.035, -0.42, 18);
  prof(k, [[-0.13, 0.036], [-0.13, 0.049], [-0.14, 0.052], [-0.39, 0.052], [-0.4, 0.049], [-0.4, 0.036]], 0.03, D, 0, 0.004);
  for (let z = -0.16; z > -0.39; z -= 0.026) for (const s of [-1, 1]) rbox(k, 0.002, 0.006, 0.012, 0.001, VM.poly, s * 0.0152, 0.045, z);
  tube(k, 0.0105, 0.0105, 0.47, Mt, 0, 0.0, -0.375, 16);
  lathe(k, [[-0.608, 0], [-0.608, 0.012], [-0.626, 0.012], [-0.63, 0.008], [-0.63, 0]], D, 0, 0.0, 0);
  box(k, 0.026, 0.05, 0.016, D, 0, 0.018, -0.585);
  lathe(k, [[-0.68, 0], [-0.68, 0.0135], [-0.7, 0.0135], [-0.704, 0.011], [-0.704, 0]], D, 0, 0.035, 0);
  // ghost-ring rear sight on the receiver, fibre-optic front post near the muzzle
  ghostRing(k, { y: 0.08, z: 0.1, eye: 0.075, baseY: 0.055, frontZ: -0.668, frontBase: 0.046 });
  // trigger guard, trigger, action-release lever
  prof(k, [[0.1, -0.018], [0.1, -0.042], [0.09, -0.05], [0.03, -0.05], [0.022, -0.042], [0.022, -0.018]], 0.012, D, 0, 0.0015,
    [[[0.093, -0.021], [0.093, -0.039], [0.087, -0.044], [0.035, -0.044], [0.029, -0.038], [0.029, -0.021]]]);
  prof(k, [[0.068, -0.019], [0.073, -0.019], [0.071, -0.031], [0.064, -0.04], [0.061, -0.038], [0.066, -0.03]], 0.006, D, 0, 0.001);
  prof(k, [[0.028, -0.02], [0.018, -0.02], [0.012, -0.034], [0.018, -0.036]], 0.004, D, -0.008, 0.0008);
  // walnut stock with a pistol-grip wrist, sling swivel and rubber recoil pad
  prof(k, [[0.118, 0.048], [0.2, 0.042], [0.44, 0.028], [0.462, 0.018], [0.47, -0.098], [0.446, -0.11], [0.3, -0.066], [0.18, -0.052], [0.162, -0.118], [0.132, -0.126], [0.118, -0.098], [0.104, -0.02]], 0.044, T, 0, 0.005);
  rbox(k, 0.05, 0.136, 0.016, 0.005, D, 0, -0.04, 0.475, 0.08, 0, 0);
  k.add(new THREE.TorusGeometry(0.008, 0.0022, 6, 14), Mt, 0, -0.1, 0.4, Math.PI / 2, 0, 0);
  // shell carrier on the left side of the receiver: four spare shells
  box(k, 0.004, 0.03, 0.09, D, -0.026, 0.022, -0.02);
  for (let i = 0; i < 4; i++) {
    const z = -0.054 + i * 0.022;
    k.add(new THREE.CylinderGeometry(0.0102, 0.0102, 0.046, 12), VM.shell, -0.037, 0.026, z);
    k.add(new THREE.CylinderGeometry(0.0106, 0.0106, 0.012, 12), VM.brass, -0.037, -0.002, z);
  }
  // pump: ribbed forend on the magazine tube, left hand rides with it
  const pump = new THREE.Group(); g.add(pump);
  const kp = new Kit(pump);
  prof(kp, [[-0.25, -0.022], [-0.25, 0.022], [-0.42, 0.022], [-0.42, -0.022]], 0.056, T, 0, 0.01);
  for (let z = -0.27; z > -0.41; z -= 0.02) for (const s of [-1, 1]) box(kp, 0.002, 0.03, 0.005, D, s * 0.0285, 0.0, z);
  supportHand(kp, -0.34, 0.0, 0.03, 0.03, V(-0.19, -0.28, -0.05));
  kp.build();
  gripHand(k, [0.118, -0.03], [0.148, -0.118], 0.019, 0.026, V(0.13, -0.3, 0.5), { trigger: [0.064, -0.032] });
  k.build();
  const shell = new THREE.Group(); g.add(shell);
  const ks = new Kit(shell);
  tube(ks, 0.0112, 0.0112, 0.05, VM.shell, 0, -0.02, -0.055);
  tube(ks, 0.0118, 0.0118, 0.012, VM.brass, 0, -0.02, -0.024);
  ks.build();
  shell.visible = false;
  return { g, mag: new THREE.Group(), pump, shell, flash: flashRig(g, -0.72, 0.22), sightY: 0.08, adsZ: -0.175, hold: 0.016 };
}

function buildDMR() {
  const g = new THREE.Group(), k = new Kit(g);
  const Mt = VM.metal, D = VM.dark, P = VM.poly;
  prof(k, [[0.17, 0.018], [0.17, 0.064], [0.156, 0.07], [-0.13, 0.07], [-0.136, 0.064], [-0.136, 0.018]], 0.052, Mt, 0, 0.003);
  box(k, 0.002, 0.02, 0.075, D, 0.0272, 0.046, 0.02);
  rbox(k, 0.054, 0.008, 0.026, 0.003, D, 0, 0.068, 0.185);
  rail(k, 0.0735, 0.16, -0.14, 0.024);
  // long free-float handguard, barrel, brake, folded bipod
  prof(k, [[-0.136, 0.008], [-0.136, 0.068], [-0.56, 0.068], [-0.565, 0.06], [-0.565, 0.012], [-0.56, 0.008]], 0.06, P, 0, 0.007);
  for (const s of [-1, 1]) for (let z = -0.18; z > -0.54; z -= 0.05) rbox(k, 0.003, 0.012, 0.034, 0.0014, D, s * 0.0305, 0.04, z);
  tube(k, 0.0102, 0.0102, 0.24, Mt, 0, 0.042, -0.68);
  lathe(k, [[-0.795, 0], [-0.795, 0.0165], [-0.86, 0.0165], [-0.866, 0.012], [-0.866, 0]], D, 0, 0.042, 0);
  for (let i = 0; i < 4; i++) box(k, 0.034, 0.004, 0.007, Mt, 0, 0.053, -0.81 - i * 0.013);
  box(k, 0.03, 0.016, 0.03, D, 0, -0.002, -0.53);
  for (const s of [-1, 1]) tube(k, 0.0055, 0.0055, 0.2, D, s * 0.013, -0.012, -0.42, 8);
  // lower, trigger group, grip
  prof(k, [[0.148, 0.018], [0.148, -0.004], [0.126, -0.02], [0.074, -0.027], [0.004, -0.027], [-0.012, -0.031], [-0.02, -0.07], [-0.11, -0.07], [-0.116, -0.02], [-0.136, 0.018]], 0.048, Mt, 0, 0.002);
  prof(k, [[0.074, -0.026], [0.074, -0.05], [0.064, -0.058], [-0.004, -0.058], [-0.013, -0.05], [-0.013, -0.03]], 0.012, Mt, 0, 0.0015,
    [[[0.066, -0.029], [0.066, -0.047], [0.059, -0.052], [0.001, -0.052], [-0.006, -0.046], [-0.006, -0.03]]]);
  prof(k, [[0.045, -0.027], [0.05, -0.027], [0.048, -0.04], [0.041, -0.049], [0.037, -0.047], [0.043, -0.038]], 0.006, D, 0, 0.001);
  prof(k, [[0.068, -0.026], [0.11, -0.026], [0.12, -0.04], [0.15, -0.128], [0.148, -0.139], [0.12, -0.143], [0.104, -0.137], [0.086, -0.09], [0.091, -0.08], [0.083, -0.068], [0.087, -0.058], [0.078, -0.046]], 0.032, P, 0, 0.004);
  // precision stock with cheek riser
  tube(k, 0.016, 0.016, 0.1, D, 0, 0.034, 0.21, 16);
  prof(k, [[0.215, 0.07], [0.38, 0.074], [0.39, 0.066], [0.4, -0.084], [0.388, -0.092], [0.36, -0.092], [0.3, -0.035], [0.24, -0.02], [0.22, 0.0], [0.212, 0.05]], 0.048, P, 0, 0.004);
  rbox(k, 0.036, 0.018, 0.13, 0.006, P, 0, 0.083, 0.31);
  rbox(k, 0.052, 0.16, 0.016, 0.005, D, 0, -0.01, 0.403);
  // 20-round box magazine
  const mag = new THREE.Group(); g.add(mag);
  const km = new Kit(mag);
  prof(km, [[-0.024, -0.02], [-0.106, -0.02], [-0.11, -0.13], [-0.03, -0.13]], 0.028, D, 0, 0.002);
  prof(km, [[-0.028, -0.126], [-0.114, -0.126], [-0.116, -0.14], [-0.026, -0.14]], 0.034, D, 0, 0.002);
  km.build();
  // 4x scope on rings, with turrets, bells and lenses
  lathe(k, [[0.1, 0], [0.1, 0.021], [0.075, 0.021], [0.05, 0.0172], [-0.12, 0.0172], [-0.15, 0.028], [-0.205, 0.028], [-0.205, 0]], P, 0, 0.105, 0, 1, 24);
  k.add(new THREE.CylinderGeometry(0.012, 0.012, 0.026, 16), D, 0, 0.128, -0.03);
  k.add(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 16), D, 0.027, 0.105, -0.03, 0, 0, Math.PI / 2);
  for (const z of [-0.09, 0.03]) {
    k.add(new THREE.TorusGeometry(0.019, 0.004, 8, 20), D, 0, 0.105, z);
    box(k, 0.03, 0.028, 0.016, D, 0, 0.082, z);
  }
  for (let z = 0.056; z < 0.074; z += 0.0045) k.add(new THREE.TorusGeometry(0.0212, 0.0014, 5, 24), D, 0, 0.105, z);   // power ring grip
  box(k, 0.004, 0.012, 0.008, D, 0.022, 0.112, 0.064);                                                              // throw lever
  prof(k, [[0.1, 0.087], [0.074, 0.087], [0.07, 0.105, 0.07, 0.087], [0.074, 0.123, 0.07, 0.123], [0.1, 0.123], [0.104, 0.105, 0.104, 0.123]], 0.004, P, 0.03, 0.001);   // flip cap, swung open to the side
  k.add(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), D, 0, 0.143, -0.03);
  const lensO = new THREE.Mesh(new THREE.CircleGeometry(0.026, 24), VM.lens); lensO.position.set(0, 0.105, -0.2055); lensO.rotation.y = Math.PI; g.add(lensO);
  const lensE = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), VM.lens); lensE.position.set(0, 0.105, 0.1005); g.add(lensE);
  gripHand(k, [0.092, -0.034], [0.132, -0.136], 0.018, 0.026, V(0.13, -0.3, 0.5), { trigger: [0.042, -0.04] });
  supportHand(k, -0.36, 0.038, 0.032, 0.033, V(-0.2, -0.3, -0.02));
  k.build();
  // sits lower and further out at the hip so the scope does not fill the view
  return { g, mag, flash: flashRig(g, -0.88, 0.2), sightY: 0.105, adsZ: -0.18, hip: [0.17, -0.2, -0.46] };
}

function buildPistol() {
  const g = new THREE.Group(), k = new Kit(g);
  const D = VM.dark, P = VM.poly;
  // slide with rear serrations, ejection port and sights
  const slide = new THREE.Group(); g.add(slide);
  const ks = new Kit(slide);
  prof(ks, [[0.07, 0.016], [0.07, 0.046], [0.062, 0.051], [-0.114, 0.051], [-0.12, 0.045], [-0.12, 0.016]], 0.026, VM.metal, 0, 0.002);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) box(ks, 0.0015, 0.024, 0.0022, D, s * 0.0132, 0.032, 0.062 - i * 0.0048);
  box(ks, 0.0018, 0.012, 0.042, D, 0.0122, 0.038, -0.02);
  // three-dot night sights: a narrow front post, a wide rear notch
  box(ks, 0.0034, 0.0108, 0.007, D, 0, 0.0564, -0.105);
  ball(ks, 0.0013, VM.tritium, 0, 0.0592, -0.1014);
  for (const s of [-1, 1]) { box(ks, 0.006, 0.011, 0.008, D, s * 0.0054, 0.0565, 0.06); ball(ks, 0.0012, VM.tritium, s * 0.0054, 0.0586, 0.0641); }
  box(ks, 0.012, 0.004, 0.034, VM.metal, 0, 0.0505, -0.012);   // barrel hood in the ejection port
  ks.build();
  // slide stop and take-down levers on the left of the frame
  box(k, 0.003, 0.004, 0.022, D, -0.0132, 0.02, -0.02);
  box(k, 0.003, 0.003, 0.01, D, -0.0132, 0.012, -0.052);
  tube(k, 0.0068, 0.0068, 0.008, D, 0, 0.034, -0.122, 12);
  // polymer frame with rail, trigger guard, trigger, grip
  prof(k, [[0.066, 0.017], [-0.118, 0.017], [-0.118, 0.004], [-0.042, 0.0], [-0.03, -0.004], [0.0, -0.006], [0.024, -0.004], [0.07, 0.0]], 0.024, P, 0, 0.002);
  for (let z = -0.06; z > -0.11; z -= 0.012) box(k, 0.026, 0.003, 0.004, D, 0, 0.002, z);
  prof(k, [[0.026, -0.004], [0.026, -0.026], [0.016, -0.034], [-0.04, -0.034], [-0.046, -0.022], [-0.044, -0.004]], 0.012, P, 0, 0.0015,
    [[[0.019, -0.006], [0.019, -0.024], [0.013, -0.028], [-0.035, -0.028], [-0.039, -0.02], [-0.037, -0.006]]]);
  prof(k, [[0.0, -0.005], [0.005, -0.005], [0.003, -0.016], [-0.003, -0.024], [-0.006, -0.022], [-0.001, -0.015]], 0.006, D, 0, 0.001);
  prof(k, [[0.022, 0.0], [0.068, 0.004], [0.075, -0.01], [0.096, -0.094], [0.093, -0.105], [0.052, -0.108], [0.043, -0.1], [0.031, -0.05], [0.025, -0.02]], 0.03, P, 0, 0.004);
  const mag = new THREE.Group(); g.add(mag);
  const km = new Kit(mag);
  prof(km, [[0.036, -0.03], [0.07, -0.03], [0.091, -0.104], [0.056, -0.104]], 0.021, D, 0, 0.001);
  prof(km, [[0.052, -0.103], [0.094, -0.103], [0.095, -0.114], [0.05, -0.114]], 0.032, D, 0, 0.002);
  km.build();
  gripHand(k, [0.052, -0.008], [0.078, -0.1], 0.016, 0.024, V(0.13, -0.26, 0.56), { trigger: [-0.004, -0.016] });
  // support hand cupping the grip from the left, thumb forward along the frame
  const G = VM.glove;
  rbox(k, 0.022, 0.07, 0.062, 0.009, G, -0.029, -0.058, 0.062, -0.25, 0, 0);
  [[-0.052, 0.0095], [-0.07, 0.0092], [-0.087, 0.0085]].forEach(([y, r]) => {
    fingerChain(k, [V(-0.034, y, 0.034), V(-0.026, y - 0.002, 0.012), V(0.004, y - 0.003, 0.006), V(0.03, y - 0.002, 0.02)], r, G);
  });
  fingerChain(k, [V(-0.03, -0.025, 0.07), V(-0.022, -0.012, 0.03), V(-0.018, -0.008, -0.01)], 0.0102, G);
  sleeve(k, V(-0.03, -0.09, 0.09), V(-0.19, -0.26, 0.54), 0.043, false);
  k.build();
  // arms pushed out to full extension when aiming
  return { g, mag, slide, flash: flashRig(g, -0.14, 0.11), sightY: 0.0618, adsZ: -0.47, hold: 0.022 };
}

/** M67-style fragmentation grenade held with the spoon under the palm. */
function buildNadeHand() {
  const g = new THREE.Group(), k = new Kit(g);
  ball(k, 0.032, VM.nade, 0, 0, 0, 1, 1.14, 1);
  k.add(new THREE.CylinderGeometry(0.0105, 0.012, 0.02, 12), VM.metal, 0, 0.042, 0);
  prof(k, [[0.012, 0.05], [-0.008, 0.05], [-0.036, 0.018, -0.034, 0.045], [-0.03, -0.03, -0.042, -0.01], [-0.026, -0.03], [-0.03, 0.018, -0.036, -0.005], [-0.006, 0.045, -0.028, 0.042], [0.012, 0.045]], 0.012, VM.metal, 0.0, 0.001);
  k.add(new THREE.TorusGeometry(0.011, 0.0016, 6, 20), VM.metal, 0.02, 0.046, 0.008, 0, Math.PI / 2, 0);
  const G = VM.glove;
  rbox(k, 0.03, 0.07, 0.062, 0.01, G, 0.032, -0.006, 0.012);
  [[0.018, 0.0098], [-0.002, 0.0098], [-0.022, 0.009], [-0.04, 0.0085]].forEach(([y, r]) => {
    fingerChain(k, [V(0.036, y, -0.02), V(0.018, y, -0.038), V(-0.012, y, -0.036), V(-0.03, y, -0.016)], r, G);
  });
  fingerChain(k, [V(0.03, 0.03, 0.03), V(0.005, 0.048, 0.022), V(-0.02, 0.05, 0.0)], 0.0104, G);
  sleeve(k, V(0.04, -0.035, 0.05), V(0.11, -0.22, 0.3), 0.044, true);
  k.build();
  g.visible = false;
  return g;
}

/** Clip-point combat knife: polished blade with a fuller, steel guard, stacked-leather handle. */
function buildKnifeHand() {
  const g = new THREE.Group(), k = new Kit(g);
  const S = VM.steel;
  prof(k, [[-0.045, 0.0125], [-0.168, 0.0125], [-0.2, 0.008, -0.186, 0.012], [-0.228, 0.0], [-0.206, -0.012, -0.222, -0.009], [-0.17, -0.018, -0.19, -0.017], [-0.052, -0.017], [-0.045, -0.012]], 0.0045, S, 0, 0.0011);
  for (const s of [-1, 1]) box(k, 0.0006, 0.0045, 0.085, VM.fuller, s * 0.0027, 0.004, -0.108);
  prof(k, [[-0.038, 0.026], [-0.047, 0.024], [-0.047, -0.028], [-0.042, -0.034], [-0.038, -0.028]], 0.016, VM.metal, 0, 0.002);
  // leather washers with two spacer rings, then the pommel
  lathe(k, [[-0.038, 0], [-0.038, 0.0118], [-0.03, 0.0132], [-0.012, 0.0142], [0.0, 0.0136], [0.012, 0.0146], [0.03, 0.0148], [0.05, 0.014], [0.068, 0.0128], [0.074, 0.0122], [0.074, 0]], VM.leather, 0, 0.0, 0, 0.82, 20);
  for (const z of [-0.036, 0.072]) k.add(new THREE.CylinderGeometry(0.0128, 0.0128, 0.003, 18), VM.metal, 0, 0, z, Math.PI / 2, 0, 0).scale(1, 1, 1);
  for (let z = -0.028; z < 0.066; z += 0.0065) k.add(new THREE.TorusGeometry(0.0138, 0.0006, 4, 18), VM.leatherDark, 0, 0, z, 0, 0, 0).scale(0.82, 1, 1);
  lathe(k, [[0.074, 0], [0.074, 0.0134], [0.082, 0.014], [0.09, 0.011], [0.094, 0.0]], VM.metal, 0, 0, 0, 0.84, 18);
  // fist round the handle: fingers under and round to the left, thumb on the spine side
  const G = VM.glove;
  rbox(k, 0.026, 0.05, 0.078, 0.01, G, 0.02, -0.004, 0.018);
  [[-0.024, 0.0098], [-0.004, 0.0102], [0.016, 0.0096], [0.036, 0.0088]].forEach(([z, r]) => {
    fingerChain(k, [V(0.026, -0.012, z), V(0.012, -0.026, z - 0.002), V(-0.01, -0.022, z - 0.004), V(-0.018, -0.004, z - 0.006)], r, G);
  });
  fingerChain(k, [V(0.024, 0.016, 0.026), V(0.006, 0.02, 0.002), V(-0.008, 0.016, -0.018)], 0.0105, G);
  sleeve(k, V(0.03, -0.012, 0.062), V(0.12, -0.2, 0.34), 0.044, true);
  k.build();
  g.visible = false;
  return g;
}

const SKIN_DEFAULTS = {};
export function initViewmodels() {
  Object.assign(VM, {
    metal: std({ color: 0x2a2b2e, metalness: 0.85, roughness: 0.36 }),
    dark: std({ color: 0x141517, metalness: 0.7, roughness: 0.45 }),
    poly: std({ color: 0x1c1d1f, metalness: 0.05, roughness: 0.62 }),
    tan: std({ color: 0x9a8260, metalness: 0.05, roughness: 0.7 }),
    glove: std({ color: 0x2b2722, roughness: 0.82 }),
    sleeve: std({ map: TEX.camoAlly || TEX.camoDesert, color: 0xc8c0b0, roughness: 0.9 }),
    patch: std({ map: TEX.flagPatch, roughness: 0.8 }),
    brass: std({ color: 0xd4a95a, metalness: 1, roughness: 0.3 }),
    steel: std({ color: 0xd6dade, metalness: 1, roughness: 0.16 }),
    fuller: std({ color: 0x8a9096, metalness: 1, roughness: 0.3 }),
    leather: std({ color: 0x5c3b24, roughness: 0.72 }),
    leatherDark: std({ color: 0x2e1d12, roughness: 0.8 }),
    shell: std({ color: 0xa8201a, roughness: 0.5 }),
    lens: std({ color: 0x0a1a24, metalness: 0.9, roughness: 0.05 }),
    glass: new THREE.MeshBasicMaterial({ color: 0x4a7a8a, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    optic: std({ color: 0x1b1c1e, metalness: 0.55, roughness: 0.5 }),
    holoGlass: new THREE.MeshBasicMaterial({ color: 0x6fa0b4, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
    reflexGlass: new THREE.MeshBasicMaterial({ color: 0x8fb4c8, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
    fiber: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3.2, 0.9) }),
    tritium: std({ color: 0xe8efe4, emissive: 0x7dff9a, emissiveIntensity: 0.25, roughness: 0.4 }),
    flash: new THREE.MeshBasicMaterial({ map: TEX.flash, color: new THREE.Color(6, 4, 2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    nade: std({ color: 0x5c6440, roughness: 0.6, metalness: 0.2 }),
  });
  for (const k of ['metal', 'poly', 'tan']) SKIN_DEFAULTS[k] = { color: VM[k].color.getHex(), metalness: VM[k].metalness, roughness: VM[k].roughness };
  // night-sight inserts glow a little brighter after dark
  todHooks.push((t) => { VM.tritium.emissiveIntensity = 0.25 + t.night * 1.6; });
  models.rifle = buildRifle();
  models.smg = buildSMG();
  models.shotgun = buildShotgun();
  models.dmr = buildDMR();
  models.pistol = buildPistol();
  for (const k in models) { models[k].g.visible = false; vmRoot.add(models[k].g); }
  nadeHand = buildNadeHand();
  vmScene.add(nadeHand);
  knifeHand = buildKnifeHand();
  vmScene.add(knifeHand);
}
/** Show every first-person model once so their shaders compile during loading. */
export function setAllVisible(on) {
  for (const k in models) models[k].g.visible = on;
  nadeHand.visible = on;
  knifeHand.visible = on;
}

/** Weapon finish chosen in the loadout. */
export function applySkin(id) {
  for (const k of ['metal', 'poly', 'tan']) {
    const d = SKIN_DEFAULTS[k], m = VM[k];
    m.color.setHex(d.color); m.metalness = d.metalness; m.roughness = d.roughness; m.map = null;
  }
  if (id === 'tiger') { for (const k of ['poly', 'tan']) { VM[k].map = TEX.skinTiger; VM[k].color.setHex(0xffffff); } }
  else if (id === 'night') { for (const k of ['poly', 'tan']) { VM[k].map = TEX.skinNight; VM[k].color.setHex(0xffffff); } VM.metal.color.setHex(0x1a1b1d); }
  else if (id === 'gold') {
    for (const k of ['metal', 'poly', 'tan']) { VM[k].color.setHex(k === 'metal' ? 0xd9b04a : 0xc9a040); VM[k].metalness = 1; VM[k].roughness = k === 'metal' ? 0.22 : 0.32; }
  }
  for (const k of ['metal', 'poly', 'tan']) VM[k].needsUpdate = true;
}
