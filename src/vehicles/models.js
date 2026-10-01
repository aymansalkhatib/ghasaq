import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU } from '../core/utils.js';
import { MAT, std } from '../assets/materials.js';
import { TEX } from '../assets/textures.js';

/*
 * Aircraft, parachute and supply-crate models. Every craft faces +Z.
 * Fuselages and nacelles are turned (lathe) from side profiles, wings and fins are plan-view
 * outlines extruded to their thickness, and the static parts of each craft are merged per
 * material. Propellers and rotors are their own groups, with a blur disc for when they spin.
 */

const cyl = (r1, r2, len, seg, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat); m.rotation.x = Math.PI / 2; return m; };
const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
function place(parent, obj, x, y, z) { obj.position.set(x, y, z); obj.castShadow = true; parent.add(obj); return obj; }
function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}

/* ---------- a parts list merged into one mesh per material ---------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
class Parts {
  constructor(g) { this.g = g; this.map = new Map(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s));
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  build() {
    for (const [mat, list] of this.map) {
      const geos = list.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        return n;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      this.g.add(mesh);
    }
    this.map.clear();
  }
}
/** Solid of revolution along Z from [z, r] pairs; `shape(v)` may bend the vertices afterwards. */
function lathe(pts, seg = 20, shape = null) {
  if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.slice().reverse();
  const g = new THREE.LatheGeometry(pts.map(([z, r]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  if (shape) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
  }
  return g;
}
/** Plan-view outline [x, z] extruded `t` thick (vertical), centred on y = 0: wings and tailplanes. */
function plate(pts, t, bevel = 0) {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}
/** Side-view outline [z, y] extruded `t` thick across X: fins and pylons. */
function fin(pts, t, bevel = 0) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}
/** Propeller hub with n blades (in the XY plane, spinning about Z) and a blur disc. */
function propeller(n, radius, chord, mat, blurR) {
  const hub = new THREE.Group();
  hub.add(new THREE.Mesh(new THREE.ConeGeometry(radius * 0.16, radius * 0.36, 12).rotateX(Math.PI / 2), MAT.darkMetal));
  for (let k = 0; k < n; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(chord, radius, 0.05).translate(0, radius / 2, 0), mat);
    b.rotation.set(0, 0.35, (k / n) * TAU, 'ZYX');
    hub.add(b);
  }
  if (blurR) {
    const blur = new THREE.Mesh(new THREE.CircleGeometry(blurR, 32), new THREE.MeshBasicMaterial({ map: TEX.rotor, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8 }));
    blur.position.z = 0.04;
    hub.add(blur);
  }
  return hub;
}

/** Four-engine tactical transport (the supply and paratrooper drops). About 30 m long, 40 m span. */
export function buildTransport() {
  const g = new THREE.Group(), k = new Parts(g), M = MAT.hullGrey, D = MAT.hullDark;
  // fuselage: blunt nose, long constant section, tail cone sweeping up to the ramp
  const up = (v) => { if (v.z < -6) v.y += (-6 - v.z) * 0.13; if (v.y < -1.2) v.y = -1.2 + (v.y + 1.2) * 0.5; };
  k.add(lathe([[15.9, 0], [15.7, 0.75], [15.1, 1.45], [14.1, 1.95], [12.6, 2.2], [6, 2.25], [-6, 2.25], [-9, 2.08], [-12, 1.65], [-14.8, 1.0], [-16.6, 0.45], [-17.3, 0.1]], 28, up), M);
  // flight-deck glazing and the dark nose radome
  k.add(lathe([[14.9, 1.62], [14.2, 1.98], [13.4, 2.14]], 28, (v) => { if (v.y < 0.9) v.y = 0.9 + (v.y - 0.9) * 0.02; v.multiplyScalar(1.012); }), MAT.glass);
  k.add(lathe([[15.95, 0], [15.75, 0.72], [15.3, 1.2]], 20, (v) => { v.y -= 0.12; }), D);
  // landing-gear sponsons and the rear ramp line
  for (const s of [-1, 1]) k.add(new THREE.CapsuleGeometry(0.62, 5.2, 4, 12).rotateX(Math.PI / 2), M, s * 2.05, -1.35, 0.4);
  // high wing with four nacelles and props
  const wing = [[0, 2.8], [20.5, 1.4], [20.5, -0.9], [0, -2.1]];
  for (const s of [-1, 1]) k.add(plate(wing.map(([x, z]) => [x * s, z]), 0.5, 0.12), M, 0, 2.25, 1.2);
  k.add(new THREE.BoxGeometry(4.2, 0.55, 4.6), M, 0, 2.05, 1.2);
  const props = [];
  for (const x of [-11.6, -5.8, 5.8, 11.6]) {
    k.add(lathe([[6.0, 0.35], [5.6, 0.62], [4.7, 0.78], [1.5, 0.75], [-1.4, 0.5], [-2.6, 0.12]], 16), D, x, 1.55, 1.8);
    k.add(new THREE.BoxGeometry(0.5, 0.4, 3.4), D, x, 2.0, 1.2);   // pylon into the wing
    const hub = propeller(4, 2.05, 0.3, MAT.darkMetal, 2.1);
    place(g, hub, x, 1.55, 6.25);
    props.push(hub);
  }
  // tail: tall fin with a rudder line, stabilisers low on the tail cone
  k.add(fin([[-12.2, 2.4], [-14.6, 8.4], [-16.8, 8.6], [-17.6, 3.3], [-16.6, 2.2]], 0.42, 0.1), M);
  k.add(fin([[-16.3, 3.2], [-16.9, 8.4], [-17.2, 8.4], [-17.5, 3.4]], 0.44), D);
  const tail = [[0, 1.6], [6.6, 0.4], [6.6, -1.1], [0, -1.9]];
  for (const s of [-1, 1]) k.add(plate(tail.map(([x, z]) => [x * s, z]), 0.32, 0.08), M, 0, 2.9, -15.4);
  k.build();
  const lights = [place(g, glowSprite(new THREE.Color(5, 0.3, 0.2), 1.6), -20.4, 2.25, 0.4), place(g, glowSprite(new THREE.Color(0.3, 5, 0.6), 1.6), 20.4, 2.25, 0.4), place(g, glowSprite(new THREE.Color(5, 5, 5), 1.4), 0, 8.8, -16.4)];
  return { g, props, lights };
}

/** Swept-wing strike jet, about 16 m long, with bombs and missiles on the pylons. */
export function buildJet() {
  const g = new THREE.Group(), k = new Parts(g), M = MAT.hullJet, D = MAT.darkMetal;
  // area-ruled fuselage, flattened a little, chin intake under the cockpit
  k.add(lathe([[8.8, 0], [8.0, 0.2], [6.6, 0.45], [4.4, 0.72], [1.8, 0.9], [-3.4, 0.95], [-6.2, 0.82], [-7.2, 0.62]], 22, (v) => { v.x *= 1.12; v.y *= 0.9; }), M);
  k.add(lathe([[3.6, 0.1], [3.2, 0.55], [1.2, 0.6], [-2.2, 0.5]], 16, (v) => { v.y = v.y * 0.75 - 0.75; }), M);
  k.add(new THREE.CircleGeometry(0.42, 16).scale(1, 0.7, 1), D, 0, -0.75, 3.62);
  // bubble canopy
  const cg = new THREE.SphereGeometry(0.62, 18, 12, 0, TAU, 0, Math.PI / 2);
  cg.scale(0.85, 0.75, 2.6);
  k.add(cg, MAT.glass, 0, 0.55, 4.1);
  // swept wings, tailplanes, twin canted fins
  const wing = [[0.7, 1.8], [5.4, -2.6], [5.4, -3.6], [0.7, -4.2]];
  for (const s of [-1, 1]) k.add(plate(wing.map(([x, z]) => [x * s, z]), 0.16, 0.04), M, 0, -0.08, 0);
  const tp = [[0.7, -4.6], [3.2, -6.4], [3.2, -7.1], [0.7, -7.2]];
  for (const s of [-1, 1]) k.add(plate(tp.map(([x, z]) => [x * s, z]), 0.12, 0.03), M, 0, -0.05, 0);
  for (const s of [-1, 1]) {
    const f = fin([[-3.9, 0.6], [-6.2, 2.9], [-7.0, 2.9], [-7.2, 0.6]], 0.14, 0.03);
    f.rotateZ(-s * 0.3);
    k.add(f, M, s * 0.55, 0.1, 0);
    // pylons with a bomb and a wingtip missile
    k.add(new THREE.BoxGeometry(0.14, 0.3, 1.4), M, s * 2.4, -0.28, -1.8);
    k.add(new THREE.CapsuleGeometry(0.2, 1.3, 4, 10).rotateX(Math.PI / 2), MAT.hullDark, s * 2.4, -0.55, -1.7);
    k.add(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 8).rotateX(Math.PI / 2), MAT.hullGrey, s * 5.45, -0.05, -2.6);
  }
  // nozzle
  k.add(lathe([[-7.1, 0.62], [-7.9, 0.56], [-8.0, 0.5], [-7.4, 0.42]], 18), D);
  k.build();
  const glow = [];
  const disc = place(g, new THREE.Mesh(new THREE.CircleGeometry(0.44, 16), MAT.engineGlow), 0, 0, -7.6); disc.rotation.y = Math.PI;
  for (const z of [-8.3, -9.2]) glow.push(place(g, glowSprite(new THREE.Color(5, 2.2, 0.8), 2.4), 0, 0, z));
  place(g, glowSprite(new THREE.Color(5, 0.3, 0.2), 0.8), -5.45, -0.05, -1.3);
  place(g, glowSprite(new THREE.Color(0.3, 5, 0.6), 0.8), 5.45, -0.05, -1.3);
  return { g, glow };
}

/** Long-endurance recon drone: slim body, sensor turret, long straight wings, V-tail, pusher prop. */
export function buildUAV() {
  const g = new THREE.Group(), k = new Parts(g), M = MAT.hullJet;
  k.add(lathe([[4.2, 0], [4.0, 0.3], [3.4, 0.48], [2.2, 0.52], [-1.5, 0.42], [-3.4, 0.22], [-3.7, 0.12]], 18, (v) => { if (v.z > 1.8) v.y += (v.z - 1.8) * 0.08; }), M);
  k.add(new THREE.SphereGeometry(0.26, 14, 10), MAT.glass, 0, -0.52, 3.1);
  k.add(new THREE.CylinderGeometry(0.12, 0.16, 0.2, 10), MAT.hullDark, 0, -0.36, 3.1);
  const wing = [[0.3, 0.7], [7.4, 0.3], [7.4, -0.25], [0.3, -0.5]];
  for (const s of [-1, 1]) k.add(plate(wing.map(([x, z]) => [x * s, z]), 0.12, 0.03), M, 0, 0.3, 0.3, 0, 0, s * 0.04);
  for (const s of [-1, 1]) { const f = fin([[-2.2, 0], [-3.4, 1.6], [-3.9, 1.6], [-3.7, 0]], 0.08); f.rotateZ(-s * 0.75); k.add(f, M, s * 0.1, 0.2, 0); }
  k.add(fin([[-2.6, 0], [-3.6, -0.9], [-3.9, -0.9], [-3.7, 0]], 0.08), M);
  k.build();
  const prop = propeller(3, 0.95, 0.14, MAT.darkMetal, 0.95);
  place(g, prop, 0, 0, -3.85);
  prop.rotation.y = Math.PI;
  const blink = place(g, glowSprite(new THREE.Color(6, 0.4, 0.3), 1.2), 0, -0.3, 0);
  return { g, prop, blink };
}

/**
 * The invaders' assault-transport helicopter: cabin with glazed nose, twin engines over the cabin,
 * five-blade main rotor, tail boom with fin and tail rotor, stub wings with rocket pods, fixed
 * wheels, open side doors (the fast-rope doors), a door gun, and the invaders' red spear emblem.
 */
let heliEmblem = null;
export function buildHeli() {
  const g = new THREE.Group(), k = new Parts(g), M = MAT.hullDark, D = MAT.darkMetal;
  // cabin: turned, then squared off at the floor and drooped at the nose
  k.add(lathe([[4.3, 0], [4.1, 0.55], [3.5, 1.05], [2.4, 1.38], [0.5, 1.48], [-2.2, 1.45], [-3.4, 1.2], [-3.9, 0.8]], 22, (v) => {
    v.x *= 0.92;
    if (v.y < -0.9) v.y = -0.9 + (v.y + 0.9) * 0.3;
    if (v.z > 1.8) v.y -= (v.z - 1.8) * 0.16;
    v.y += 0.05;
  }), M);
  // glazed nose and cockpit side windows
  k.add(lathe([[4.25, 0.1], [4.05, 0.62], [3.4, 1.1], [2.5, 1.32]], 22, (v) => {
    v.x *= 0.93; v.y -= (v.z - 1.8) * 0.16; v.y += 0.07;
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.2;
    v.multiplyScalar(1.004);
  }), MAT.glass);
  for (const s of [-1, 1]) for (const z of [-1.9, -0.9]) k.add(new THREE.BoxGeometry(0.04, 0.42, 0.62), MAT.glass, s * 1.34, 0.45, z);
  // open sliding doors (dark openings) with the door rails
  for (const s of [-1, 1]) {
    k.add(new THREE.BoxGeometry(0.05, 1.2, 1.5), MAT.rubber, s * 1.335, -0.1, 0.55);
    k.add(new THREE.BoxGeometry(0.08, 0.06, 2.6), D, s * 1.36, 0.58, 0.2);
  }
  // engines and gearbox fairing over the cabin, intakes and exhausts
  k.add(lathe([[2.2, 0.2], [1.9, 0.6], [0.2, 0.72], [-2.4, 0.66], [-3.1, 0.3]], 16, (v) => { v.x *= 1.35; v.y *= 0.7; }), M, 0, 1.55, 0);
  for (const s of [-1, 1]) {
    k.add(new THREE.CircleGeometry(0.28, 14), MAT.rubber, s * 0.45, 1.62, 2.21);
    k.add(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 12).rotateZ(s * 1.2), D, s * 0.95, 1.55, -2.6);
  }
  // tail boom, fin, stabiliser
  k.add(lathe([[-3.4, 0.72], [-6.5, 0.45], [-10.2, 0.26]], 14, (v) => { v.y += 0.35 + (-3.4 - v.z) * 0.02; }), M);
  k.add(fin([[-9.2, 0.6], [-10.4, 2.7], [-11.1, 2.7], [-10.8, 0.4]], 0.16, 0.04), M);
  for (const s of [-1, 1]) k.add(plate([[0, -8.4], [s * 1.5, -8.7], [s * 1.5, -9.2], [0, -9.3]], 0.08), M, 0, 0.55, 0);
  // stub wings with rocket pods, fixed wheels
  for (const s of [-1, 1]) {
    k.add(plate([[1.2 * s, 0.9], [2.9 * s, 0.6], [2.9 * s, -0.3], [1.2 * s, -0.5]], 0.14, 0.03), M, 0, -0.2, 0.1, 0, 0, -s * 0.12);
    k.add(lathe([[1.1, 0.12], [0.9, 0.24], [-0.9, 0.24], [-1.0, 0.18]], 12), D, s * 2.4, -0.55, 0.3);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.add(new THREE.CircleGeometry(0.045, 8), MAT.rubber, s * 2.4 + Math.cos(a) * 0.13, -0.55 + Math.sin(a) * 0.13, 1.41); }
    k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6).rotateZ(s * 0.5), D, s * 1.35, -1.25, -0.6);
    k.add(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16).rotateZ(Math.PI / 2), MAT.rubber, s * 1.55, -1.6, -0.6);
  }
  k.add(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 14).rotateZ(Math.PI / 2), MAT.rubber, 0, -1.45, 3.1);
  k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), D, 0, -1.1, 3.1);
  // mast
  k.add(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 12), D, 0, 2.2, 0);
  k.build();
  // the invaders' emblem on both sides of the tail boom
  if (!heliEmblem) heliEmblem = new THREE.MeshStandardMaterial({ map: TEX.enemyPatch, roughness: 0.7, side: THREE.DoubleSide });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.67), heliEmblem); e.position.set(s * 0.57, 0.45, -5.4); e.rotation.y = s * Math.PI / 2; g.add(e); }
  // main rotor: five drooping blades and a blur disc
  const rotor = new THREE.Group(); place(g, rotor, 0, 2.5, 0);
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.22, 12), D));
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Group(); arm.rotation.y = (i / 5) * TAU;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 7.4).translate(0, 0, 3.9), D);
    b.rotation.x = 0.035;
    arm.add(b); rotor.add(arm);
  }
  const blur = new THREE.Mesh(new THREE.CircleGeometry(8.2, 40), new THREE.MeshBasicMaterial({ map: TEX.rotor, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2; place(g, blur, 0, 2.48, 0); blur.castShadow = false;
  // tail rotor on the left of the fin
  const tailRotor = new THREE.Group(); place(g, tailRotor, -0.22, 1.85, -10.55);
  for (let i = 0; i < 4; i++) { const b = box(0.04, 1.7, 0.16, D); b.rotation.x = (i / 4) * TAU; tailRotor.add(b); }
  const tb = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20), new THREE.MeshBasicMaterial({ map: TEX.rotor, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  tb.rotation.y = Math.PI / 2; tailRotor.add(tb);
  // door gun in the right door
  const gun = place(g, cyl(0.05, 0.05, 1.1, 8, D), 1.5, -0.05, 0.9);
  place(g, box(0.12, 0.18, 0.4, D), 1.5, -0.1, 0.35);
  const gunTip = new THREE.Object3D(); gunTip.position.set(1.55, -0.05, 1.5); g.add(gunTip);
  const lights = [place(g, glowSprite(new THREE.Color(5, 0.3, 0.2), 1), 0, -1.0, -2), place(g, glowSprite(new THREE.Color(5, 0.3, 0.2), 0.7), 0, 2.8, -10.9)];
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.set(0, 0, -2.5); g.add(hitbox);
  return { g, rotor, tailRotor, blur, gun, gunTip, lights, hitbox };
}

/**
 * Canopy with an apex vent and suspension lines. 'cargo' is a large orange-and-white chute whose
 * lines run to the four corners of the load; 'trooper' is a smaller olive chute for a paratrooper.
 */
export function buildParachute(kind = 'trooper') {
  const cargo = kind === 'cargo';
  const R = cargo ? 4.6 : 3.4, lift = cargo ? 6.4 : 5.2;
  const g = new THREE.Group();
  const cgeo = new THREE.SphereGeometry(R, 28, 9, 0, TAU, Math.PI * 0.07, Math.PI * 0.36);
  // scalloped rim: the gores bulge between the suspension lines
  const p = cgeo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x), k = 1 + Math.abs(Math.sin(a * 8)) * 0.035;
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  cgeo.computeVertexNormals();
  const canopy = new THREE.Mesh(cgeo, cargo ? MAT.canopyCargo : MAT.canopy);
  canopy.scale.y = 0.6; canopy.position.y = lift; canopy.castShadow = true;
  g.add(canopy);
  const rimY = lift + R * 0.6 * Math.cos(Math.PI * 0.43), rimR = R * Math.sin(Math.PI * 0.43);
  const ends = cargo ? [[-0.6, 1.05, -0.5], [0.6, 1.05, -0.5], [-0.6, 1.05, 0.5], [0.6, 1.05, 0.5]] : [[0, 1.5, 0]];
  const pts = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU, e = ends[k % ends.length];
    pts.push(Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, e[0], e[1], e[2]);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: cargo ? 0xe8e0d0 : 0x2a2620 })));
  return { g, canopy };
}

/** Palletised supply crate with straps, stencils, a beacon and a smoke canister. */
export function buildSupplyCrate() {
  const g = new THREE.Group();
  // pallet
  for (const z of [-0.45, 0, 0.45]) place(g, box(1.34, 0.1, 0.12, MAT.pallet), 0, 0.05, z);
  for (let k = 0; k < 6; k++) place(g, box(0.2, 0.03, 1.1, MAT.pallet), -0.56 + k * 0.224, 0.115, 0);
  // body: stencilled sides, plain ends
  const sides = [MAT.supplyShell, MAT.supplyShell, MAT.supplyShell, MAT.supplyShell, MAT.supplySide, MAT.supplySide];
  place(g, new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.82, 1.0), sides), 0, 0.54, 0);
  // steel corner caps
  for (const x of [-0.6, 0.6]) for (const y of [0.15, 0.93]) for (const z of [-0.48, 0.48]) place(g, box(0.1, 0.1, 0.1, MAT.darkMetal), x, y, z);
  // orange cargo straps over the top and down the sides
  for (const x of [-0.32, 0.32]) {
    place(g, box(0.08, 0.02, 1.04, MAT.strap), x, 0.96, 0);
    for (const z of [-0.51, 0.51]) place(g, box(0.08, 0.82, 0.02, MAT.strap), x, 0.54, z);
    place(g, box(0.1, 0.06, 0.04, MAT.metal), x, 0.6, 0.53);
  }
  const lid = place(g, box(1.26, 0.06, 1.02, MAT.supplyShell), 0, 0.98, 0);
  // beacon and antenna
  place(g, cyl(0.04, 0.05, 0.1, 10, MAT.darkMetal), 0.45, 1.06, -0.35).rotation.x = 0;
  const strobe = place(g, glowSprite(new THREE.Color(0.4, 5, 0.8), 1.1), 0.45, 1.16, -0.35);
  const ant = place(g, cyl(0.006, 0.006, 0.5, 4, MAT.metal), -0.5, 1.25, -0.4); ant.rotation.x = 0;
  // green smoke canister strapped to a corner
  place(g, cyl(0.05, 0.05, 0.2, 10, std({ color: 0x2f7a3a, roughness: 0.6 })), 0.66, 0.3, 0.52).rotation.x = 0;
  return { g, lid, strobe };
}

export function buildBomb() {
  const g = new THREE.Group();
  const m = std({ color: 0x4a4f44, metalness: 0.5, roughness: 0.5 });
  g.add(cyl(0.18, 0.18, 1.5, 12, m));
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), m); nose.position.z = 0.75; nose.scale.z = 1.6; g.add(nose);
  for (let k = 0; k < 4; k++) { const f = box(0.02, 0.5, 0.35, MAT.darkMetal); f.position.z = -0.8; f.rotation.z = (k / 4) * TAU; g.add(f); }
  return g;
}
