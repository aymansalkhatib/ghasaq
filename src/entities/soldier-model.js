import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CANNON } from '../core/physics.js';
import { TAU, DOWN, clamp, mulberry32, wrapAngle } from '../core/utils.js';
import { todHooks } from '../core/sky.js';
import { TEX } from '../assets/textures.js';

/*
 * Procedural soldiers built from primitives, with a 10-segment skeleton that the
 * ragdoll system can take over. The soldier faces +Z; his right hand side is -X.
 *
 * Every body segment is modelled from many small parts (plate carrier, magazine pouches, radio,
 * knee and elbow pads, holster, helmet rails, ear defenders...) which are then baked into one mesh
 * per material. The baked geometry is shared by every soldier of the same kind, role and variant,
 * so a squad costs a few dozen draw calls instead of hundreds.
 *
 * Faction marks, readable at a distance: the invaders wear a red armband and their fictional
 * red spear-head emblem; the defenders wear the Syrian flag on chest and shoulder and a green band.
 */

const RB = (w, h, d, s = 2, r = 0.03) => new RoundedBoxGeometry(w, h, d, s, r);
/**
 * A limb in uniform: rounded at both ends, tapering from rTop to rBot, with a muscle bulge
 * (calf, biceps) around `at` (0 = bottom, 1 = top). Baggy cloth, not a mannequin tube.
 */
function limbGeo(rTop, rBot, len, bulge = 0, at = 0.6) {
  const pts = [];
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * rBot, -len / 2 + rBot - Math.cos(a) * rBot)); }
  const y0 = -len / 2 + rBot, y1 = len / 2 - rTop;
  for (let i = 1; i < 8; i++) {
    const t = i / 8, b = Math.max(0, 1 - Math.abs(t - at) / 0.35);
    pts.push(new THREE.Vector2(rBot + (rTop - rBot) * t + bulge * b * b * (3 - 2 * b), y0 + (y1 - y0) * t));
  }
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * rTop, y1 + Math.sin(a) * rTop)); }
  return new THREE.LatheGeometry(pts, 14);
}
/** Side profile (z, y) extruded across X, for the rifles. */
function profGeo(pts, t) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.length === 4) s.quadraticCurveTo(p[2], p[3], p[0], p[1]); else s.lineTo(p[0], p[1]); }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -t / 2);
  g.rotateY(Math.PI / 2);   // profile z grows toward the stock, like the first-person models: the muzzle ends up at +Z
  return g;
}
const CG = {
  pelvis: RB(0.34, 0.2, 0.22, 2, 0.06), belly: RB(0.31, 0.26, 0.2, 2, 0.07), vest: RB(0.43, 0.36, 0.29, 2, 0.06),
  plate: RB(0.34, 0.3, 0.05, 2, 0.02), pouch: RB(0.09, 0.12, 0.06, 1, 0.02), pack: RB(0.28, 0.34, 0.14, 2, 0.04),
  magPouch: RB(0.078, 0.1, 0.05, 1, 0.012), magTip: RB(0.026, 0.03, 0.04, 1, 0.006), cummer: new THREE.CylinderGeometry(0.2, 0.2, 0.15, 18),
  strap: RB(0.065, 0.024, 0.32, 1, 0.01), handle: new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI),
  radio: RB(0.08, 0.16, 0.06, 1, 0.015), neck: new THREE.CylinderGeometry(0.055, 0.065, 0.1, 10),
  scarf: new THREE.TorusGeometry(0.085, 0.042, 8, 18), head: new THREE.SphereGeometry(0.115, 22, 16),
  nose: RB(0.03, 0.045, 0.035, 1, 0.012), jaw: RB(0.13, 0.06, 0.1, 1, 0.03),
  wrap: new THREE.SphereGeometry(0.126, 20, 14), wrapTail: RB(0.09, 0.2, 0.03, 1, 0.012),
  helmet: new THREE.SphereGeometry(0.142, 22, 12, 0, TAU, 0, Math.PI * 0.56), rim: new THREE.TorusGeometry(0.134, 0.013, 6, 26),
  hRail: RB(0.014, 0.028, 0.13, 1, 0.005), shroud: RB(0.055, 0.035, 0.022, 1, 0.006), earCup: new THREE.CylinderGeometry(0.045, 0.045, 0.032, 14),
  lens: new THREE.CylinderGeometry(0.032, 0.03, 0.022, 16), band: new THREE.TorusGeometry(0.122, 0.011, 6, 26),
  visor: RB(0.21, 0.075, 0.07, 2, 0.025), shoulder: new THREE.SphereGeometry(0.072, 14, 10),
  uArm: limbGeo(0.068, 0.055, 0.35, 0.006, 0.65), lArm: limbGeo(0.057, 0.045, 0.31, 0.006, 0.7),
  armband: new THREE.CylinderGeometry(0.071, 0.07, 0.055, 16, 1, true), elbow: RB(0.08, 0.06, 0.085, 1, 0.022),
  glove: RB(0.075, 0.1, 0.065, 1, 0.022), thigh: limbGeo(0.102, 0.079, 0.51, 0.008, 0.7),
  shin: limbGeo(0.077, 0.062, 0.46, 0.012, 0.72), knee: RB(0.11, 0.12, 0.06, 1, 0.025), cuff: new THREE.CylinderGeometry(0.07, 0.074, 0.06, 14),
  holster: RB(0.05, 0.15, 0.095, 1, 0.015), pistolGrip: RB(0.03, 0.07, 0.035, 1, 0.008),
  sole: RB(0.126, 0.035, 0.29, 1, 0.012), toe: RB(0.116, 0.07, 0.07, 2, 0.028),
  boot: RB(0.118, 0.11, 0.25, 2, 0.035), antenna: new THREE.CylinderGeometry(0.004, 0.004, 0.45, 4),
  strobe: new THREE.SphereGeometry(0.02, 8, 6), nade: new THREE.SphereGeometry(0.03, 10, 8),
  brim: new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20), crown: new THREE.CylinderGeometry(0.12, 0.13, 0.1, 16),
  nvg: RB(0.07, 0.05, 0.06, 1, 0.012), tube: new THREE.CylinderGeometry(0.016, 0.016, 0.06, 10),
  scope: new THREE.CylinderGeometry(0.022, 0.022, 0.26, 12), patch: RB(0.06, 0.04, 0.01, 1, 0.005),
  patchPlane: new THREE.PlaneGeometry(0.075, 0.05), belt: new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18),
  buckle: RB(0.05, 0.035, 0.012, 1, 0.004),
  // rifles (third person)
  akRecv: profGeo([[0.12, 0.03], [-0.2, 0.03], [-0.2, -0.03], [-0.02, -0.035], [0.12, -0.03]], 0.05),
  akMag: profGeo([[-0.03, -0.03], [-0.1, -0.03], [-0.13, -0.12, -0.105, -0.08], [-0.16, -0.2, -0.15, -0.16], [-0.11, -0.22], [-0.09, -0.14, -0.08, -0.19], [-0.03, -0.03, -0.05, -0.08]], 0.034),
  akGuard: profGeo([[-0.2, 0.026], [-0.42, 0.024], [-0.42, -0.03], [-0.2, -0.034]], 0.056),
  akStock: profGeo([[0.12, 0.022], [0.44, -0.01], [0.44, -0.12], [0.38, -0.12], [0.2, -0.05], [0.12, -0.03]], 0.04),
  arStock: profGeo([[0.13, 0.02], [0.2, 0.02], [0.34, 0.03], [0.35, -0.1], [0.3, -0.1], [0.23, -0.03], [0.13, -0.02]], 0.046),
  grip: profGeo([[0.06, -0.03], [0.1, -0.03], [0.12, -0.13], [0.09, -0.135], [0.07, -0.06]], 0.032),
  barrel: new THREE.CylinderGeometry(0.011, 0.011, 1, 10), brake: new THREE.CylinderGeometry(0.018, 0.018, 0.07, 10),
  sight: RB(0.03, 0.04, 0.07, 1, 0.006), sling: RB(0.03, 0.006, 0.5, 1, 0.002), bipod: new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6),
};
const PATCH = {};
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export const VMATS = {};
let glintMat = null;
const FACTION = {};   // armband materials: red for the invaders, green for the defenders
function variantMats(kind) {
  const m = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85 }, o));
  const camo = { heavy: TEX.camoHeavy, night: TEX.camoNight, ally: TEX.camoAlly }[kind] || TEX.camoDesert;
  return {
    uniform: m({ map: camo, roughness: 0.92 }),
    vest: m({ map: TEX.webbing, color: { heavy: 0x3a3d40, night: 0x4a4d45, ally: 0x6b6a4a }[kind] || 0xa28b62 }),
    gear: m({ color: kind === 'heavy' ? 0x1d1f22 : 0x2f2a23, roughness: 0.7 }),
    armor: m({ color: 0x33373b, metalness: 0.55, roughness: 0.45 }),
    wrap: m({ map: TEX.webbing, color: kind === 'night' ? 0x5a5448 : 0xcdbd9c, roughness: 1 }),
    // neck scarf: dark red on the invaders (with the armband it marks them at a glance), olive on the defenders
    scarf: m({ map: TEX.webbing, color: kind === 'ally' ? 0x6b6a4a : 0x8a2a22, roughness: 1 }),
    face: m({ color: kind === 'ally' ? 0x6e4d36 : 0x1e1a17, roughness: 0.9 }),
    helmet: m({ color: { heavy: 0x24272a, night: 0x3d4238, ally: 0x5d6048 }[kind] || 0x6b6247, roughness: 0.62 }),
    lens: m({ color: 0x0c0d10, metalness: 0.6, roughness: 0.12 }),
    visor: m({ color: 0x140606, emissive: 0xff2a14, emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.4 }),
    boot: m({ color: 0x2b231b, roughness: 0.75 }),
    gunMetal: m({ color: 0x232426, metalness: 0.75, roughness: 0.4 }),
    gunPoly: m({ color: kind === 'heavy' ? 0x1b1c1e : kind === 'ally' ? 0x8a7a5e : 0x6a4a2c, roughness: 0.7 }),
    strobe: m({ color: 0x220000, emissive: kind === 'ally' ? 0x33ff66 : 0xff3322, emissiveIntensity: 0 }),
    nade: m({ color: 0x4e5634, roughness: 0.6 }),
  };
}
export function initSoldierMaterials() {
  for (const k of ['raider', 'night', 'heavy', 'ally']) VMATS[k] = variantMats(k);
  PATCH.syria = new THREE.MeshStandardMaterial({ map: TEX.flagPatch, roughness: 0.8, side: THREE.DoubleSide });
  PATCH.enemy = new THREE.MeshStandardMaterial({ map: TEX.enemyPatch, roughness: 0.8, side: THREE.DoubleSide });
  FACTION.enemy = new THREE.MeshStandardMaterial({ color: 0xb3261e, emissive: 0x3a0604, roughness: 0.8, side: THREE.DoubleSide });
  FACTION.ally = new THREE.MeshStandardMaterial({ color: 0x2f8a46, emissive: 0x06200c, roughness: 0.8, side: THREE.DoubleSide });
  glintMat = new THREE.SpriteMaterial({ map: TEX.glint, color: new THREE.Color(6, 5.6, 4.8), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
  todHooks.push((t) => {
    for (const k in VMATS) {
      VMATS[k].strobe.emissiveIntensity = t.night * 6;
      VMATS[k].visor.emissiveIntensity = 0.4 + t.night * 3;
    }
  });
}

const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
function mesh(geo, mat, x, y, z, parent, sx, sy, sz) {
  const o = new THREE.Mesh(geo, mat);
  o.position.set(x, y, z);
  if (sx) o.scale.set(sx, sy, sz);
  parent.add(o);
  return o;
}
function makeSeg(parent, x, y, z, len, dir, hx, hz, mass, cone, twist, parentKey, sphere) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  return {
    group, len, dir, mass, cone, twist, parent: parentKey, hitboxes: [],
    makeShape: () => (sphere ? new CANNON.Sphere(hx) : new CANNON.Box(new CANNON.Vec3(hx, len / 2, hz))),
  };
}
function addHitbox(ch, s, part, w, h, d) {
  const hb = new THREE.Mesh(box(w, h, d), hitboxMat);
  hb.position.set(0, s.dir * s.len / 2, 0);
  hb.userData = { ch, part };
  s.group.add(hb);
  s.hitboxes.push(hb);
  ch.hitboxes.push(hb);
}

/* ---------- baking a segment's parts into one mesh per material (cached per variant) ---------- */
const baked = new Map();
const NO_SHADOW = new Set();
function bake(group, key) {
  const parts = group.children.filter((o) => o.isMesh && !o.userData.part);
  let list = baked.get(key);
  if (!list) {
    const byMat = new Map();
    for (const m of parts) {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(g);
    }
    list = [];
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) { merged.computeBoundingSphere(); list.push([mat, merged]); }
    }
    baked.set(key, list);
  }
  for (const m of parts) group.remove(m);
  for (const [mat, geo] of list) {
    const o = new THREE.Mesh(geo, mat);
    o.castShadow = !NO_SHADOW.has(mat);
    o.receiveShadow = true;
    group.add(o);
  }
}

/* ---------- arms: two-bone IK so the hands stay on the rifle whatever it does ---------- */
const UPPER = 0.3, LOWER = 0.29;
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _qi = new THREE.Quaternion(), _n = new THREE.Vector3(), _pv = new THREE.Vector3(), _el = new THREE.Vector3(), _hd = new THREE.Vector3();
/** Orient an upper/lower arm pair so it reaches from shoulder through elbow to hand (torso space). */
function armPose(sh, el, hand, out = { u: new THREE.Quaternion(), l: new THREE.Quaternion() }) {
  out.u.setFromUnitVectors(DOWN, _d1.subVectors(el, sh).normalize());
  _d2.subVectors(hand, el).applyQuaternion(_qi.copy(out.u).invert()).normalize();
  out.l.setFromUnitVectors(DOWN, _d2);
  return out;
}
/** Elbow placed by the law of cosines in the plane of shoulder, hand and a pole direction. */
function ikArm(sh, hand, pole, out) {
  _n.subVectors(hand, sh);
  const L = clamp(_n.length(), 0.08, (UPPER + LOWER) * 0.995);
  _n.normalize();
  const cosA = clamp((UPPER * UPPER + L * L - LOWER * LOWER) / (2 * UPPER * L), -1, 1), a = Math.acos(cosA);
  _pv.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  _el.copy(sh).addScaledVector(_n, Math.cos(a) * UPPER).addScaledVector(_pv, Math.sin(a) * UPPER);
  _hd.copy(sh).addScaledVector(_n, L);
  return armPose(sh, _el, _hd, out);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SH_R = V(-0.235, 0.5, 0), SH_L = V(0.235, 0.5, 0);
const POLE_R = V(-0.7, -0.6, -0.2).normalize(), POLE_L = V(0.5, -0.8, 0.1).normalize();
// rifle carries in torso space: shouldered, low ready (muzzle dipped), port arms across the chest at a run
const CARRY = {
  aim: { p: V(-0.11, 0.37, 0.24), q: new THREE.Quaternion() },
  low: { p: V(-0.08, 0.29, 0.24), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.12, 0)) },
  port: { p: V(0.0, 0.3, 0.2), q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), V(-0.78, -0.55, -0.3), V(0.2, 0.3, 1))) },
};
const GRIP_R = V(0, -0.085, -0.095), GRIP_L = V(0, -0.045, 0.3);

export function buildSoldier(kind, seed = 1, role = 'rifle') {
  // four looks per kind and role: every soldier of a look shares its baked geometry
  const variant = ((seed % 4) + 4) % 4;
  const r = mulberry32(variant * 7919 + kind.length * 131 + role.length * 17 + 1);
  const M = VMATS[kind];
  const heavy = kind === 'heavy', ally = kind === 'ally', sniper = role === 'sniper';
  const key = `${kind}|${role}|${variant}|`;
  NO_SHADOW.add(M.strobe); NO_SHADOW.add(PATCH.syria); NO_SHADOW.add(PATCH.enemy);
  const ch = { kind, role, root: new THREE.Group(), segs: {}, hitboxes: [], vel: new THREE.Vector3(), phase: seed % 1000 / 1000 * TAU, poses: {}, ready: 1, sprintK: 0, prevYaw: null, landT: 0, wasAir: false };
  const hips = new THREE.Group();
  hips.position.y = 0.98;
  ch.root.add(hips);
  ch.hips = hips;
  const S = ch.segs;
  const band = ally ? FACTION.ally : FACTION.enemy, emblem = ally ? PATCH.syria : PATCH.enemy;

  S.torso = makeSeg(hips, 0, 0, 0, 0.58, 1, 0.19, 0.14, 22, 0, 0, null);
  const T = S.torso.group;
  mesh(CG.pelvis, M.uniform, 0, 0.02, 0, T);
  mesh(CG.belly, M.uniform, 0, 0.2, 0, T);
  // plate carrier: vest, cummerbund, shoulder straps, front magazine pouches, back panel with a grab handle
  mesh(CG.vest, M.vest, 0, 0.4, 0, T);
  mesh(CG.cummer, M.vest, 0, 0.3, -0.01, T, 1, 1, 0.78);
  for (const s of [-1, 1]) mesh(CG.strap, M.vest, s * 0.13, 0.6, -0.02, T);
  for (const px of [-0.085, 0, 0.085]) {
    mesh(CG.magPouch, M.vest, px, 0.3, 0.165, T);
    mesh(CG.magTip, heavy ? M.gear : M.gunPoly, px, 0.36, 0.165, T);
  }
  mesh(CG.pouch, M.gear, 0.12, 0.45, 0.16, T, 0.9, 0.7, 0.8);      // admin pouch
  mesh(CG.pouch, M.gear, 0.15, 0.08, 0.1, T);
  mesh(CG.pouch, M.gear, -0.16, 0.1, 0.06, T, 0.8, 0.9, 1);           // first-aid pouch on the belt
  mesh(CG.pack, M.gear, 0, 0.4, -0.2, T);
  mesh(CG.handle, M.gear, 0, 0.6, -0.17, T);
  mesh(CG.radio, M.gear, 0.1, 0.42, -0.29, T);
  mesh(CG.antenna, M.gear, 0.12, 0.72, -0.29, T).rotation.z = -0.15;
  mesh(CG.neck, M.face, 0, 0.6, 0, T);
  mesh(CG.scarf, M.scarf, 0, 0.575, 0.01, T).rotation.x = Math.PI / 2;
  if (heavy) { mesh(CG.plate, M.armor, 0, 0.4, 0.165, T); mesh(CG.plate, M.armor, 0, 0.4, -0.3, T); mesh(CG.plate, M.armor, 0, 0.16, 0.13, T, 0.7, 0.55, 1); }
  if (role === 'grenadier') {
    for (const [x, y] of [[-0.13, 0.46], [-0.05, 0.46], [0.05, 0.46], [0.13, 0.46]]) mesh(CG.nade, M.nade, x, y, 0.17, T);
    mesh(CG.pack, M.gear, 0.18, 0.12, 0.02, T, 0.5, 0.6, 1);
  }
  if (ally) mesh(CG.patch, M.strobe, 0.2, 0.47, 0.06, T);
  // chest flag (defenders) or emblem (invaders) on the vest
  mesh(CG.patchPlane, emblem, 0.1, 0.5, 0.146, T);
  mesh(CG.patchPlane, emblem, 0, 0.5, -0.275, T, 1.4, 1.4, 1).rotation.y = Math.PI;
  mesh(CG.strobe, M.strobe, -0.14, 0.52, -0.17, T);
  // belt with buckle
  mesh(CG.belt, M.gear, 0, 0.1, 0, T);
  mesh(CG.buckle, M.gunMetal, 0, 0.1, 0.112, T);
  addHitbox(ch, S.torso, 'torso', 0.4, 0.62, 0.3);

  S.head = makeSeg(T, 0, 0.6, 0, 0.3, 1, 0.13, 0.13, 5, 0.7, 0.5, 'torso', true);
  const Hd = S.head.group;
  mesh(CG.head, M.face, 0, 0.13, 0.005, Hd, 0.95, 1.08, 1.02);
  mesh(CG.nose, M.face, 0, 0.12, 0.112, Hd);
  mesh(CG.jaw, M.face, 0, 0.06, 0.04, Hd);
  const helmetOn = !sniper && (heavy || ally || r() < 0.55);
  if (sniper) {
    mesh(CG.wrap, M.wrap, 0, 0.14, -0.01, Hd, 1, 1, 1.04);
    mesh(CG.brim, M.uniform, 0, 0.2, 0, Hd);
    mesh(CG.crown, M.uniform, 0, 0.25, 0, Hd);
  } else if (helmetOn) {
    mesh(CG.helmet, M.helmet, 0, 0.15, -0.005, Hd, 1, 0.92, 1.08);
    mesh(CG.rim, M.helmet, 0, 0.152, -0.005, Hd, 1, 1.08, 1).rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) mesh(CG.hRail, M.gear, s * 0.132, 0.17, -0.01, Hd);
    mesh(CG.shroud, M.gear, 0, 0.245, 0.13, Hd);
    if (heavy) mesh(CG.visor, M.visor, 0, 0.14, 0.1, Hd);
    else if (ally) {
      mesh(CG.nvg, M.gear, 0, 0.24, 0.12, Hd);
      for (const s of [-1, 1]) mesh(CG.tube, M.gear, s * 0.022, 0.28, 0.13, Hd);
      mesh(CG.head, M.face, 0, 0.1, 0.02, Hd, 0.9, 0.7, 0.95);
    } else {
      mesh(CG.band, M.gear, 0, 0.19, 0, Hd, 1.05, 1, 1.12).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) mesh(CG.lens, M.lens, s * 0.045, 0.19, 0.12, Hd).rotation.x = Math.PI / 2 - 0.3;
      // a scarf over the face below the goggles
      mesh(CG.wrap, M.wrap, 0, 0.075, 0.02, Hd, 0.98, 0.55, 1.02);
    }
    if (heavy || ally) for (const s of [-1, 1]) mesh(CG.earCup, M.gear, s * 0.118, 0.12, 0.0, Hd).rotation.z = Math.PI / 2;
    mesh(CG.strobe, M.strobe, 0.02, 0.29, -0.06, Hd);
  } else {
    mesh(CG.wrap, M.wrap, 0, 0.145, -0.01, Hd, 1, 1.02, 1.04);
    mesh(CG.wrapTail, M.wrap, 0.02, 0.02, -0.13, Hd).rotation.x = 0.35;
    for (const s of [-1, 1]) mesh(CG.lens, M.lens, s * 0.042, 0.15, 0.108, Hd, 0.8, 1, 0.8).rotation.x = Math.PI / 2;
  }
  addHitbox(ch, S.head, 'head', 0.26, 0.3, 0.28);

  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? -1 : 1;
    const u = S['uArm' + side] = makeSeg(T, sx * 0.235, 0.5, 0, 0.3, -1, 0.06, 0.06, 3, 1.3, 0.6, 'torso');
    mesh(CG.shoulder, heavy ? M.armor : M.vest, 0, -0.02, 0, u.group, 1.15, 0.95, 1.15);
    mesh(CG.uArm, M.uniform, 0, -0.14, 0, u.group);
    // shoulder patch on the right arm, faction band round the left
    if (side === 'R') { const p = mesh(CG.patchPlane, emblem, sx * 0.071, -0.1, 0, u.group); p.rotation.y = sx * Math.PI / 2; }
    else mesh(CG.armband, band, 0, -0.13, 0, u.group);
    addHitbox(ch, u, 'arm', 0.13, 0.32, 0.13);
    const l = S['lArm' + side] = makeSeg(u.group, 0, -0.3, 0, 0.29, -1, 0.05, 0.05, 2, 1.2, 0.4, 'uArm' + side);
    mesh(CG.lArm, M.uniform, 0, -0.13, 0, l.group);
    mesh(CG.elbow, M.gear, 0, -0.02, -0.035, l.group);
    mesh(CG.cuff, M.gear, 0, -0.245, 0, l.group, 0.62, 0.7, 0.62);
    mesh(CG.glove, M.gear, 0, -0.29, 0.005, l.group);
    addHitbox(ch, l, 'arm', 0.11, 0.3, 0.11);
    bake(l.group, key + 'lArm' + side);
    bake(u.group, key + 'uArm' + side);
  }
  const holster = heavy || ally || r() < 0.4;
  for (const side of ['R', 'L']) {
    const sx = side === 'R' ? -1 : 1;
    const t = S['thigh' + side] = makeSeg(hips, sx * 0.1, -0.02, 0, 0.46, -1, 0.08, 0.08, 9, 0.9, 0.3, 'torso');
    mesh(CG.thigh, M.uniform, 0, -0.22, 0, t.group);
    // cargo pocket on the outside of the thigh, a drop-leg holster or pouch as well
    mesh(CG.pouch, M.uniform, sx * 0.1, -0.24, 0.0, t.group, 0.5, 1.2, 1.3);
    if (side === 'R' && holster) { mesh(CG.holster, M.gear, sx * 0.105, -0.14, 0.02, t.group); mesh(CG.pistolGrip, M.gunMetal, sx * 0.105, -0.04, -0.01, t.group).rotation.x = -0.25; }
    else if (r() < 0.6 || heavy) mesh(CG.pouch, M.gear, sx * 0.095, -0.12, 0.02, t.group);
    addHitbox(ch, t, 'leg', 0.17, 0.48, 0.17);
    const s = S['shin' + side] = makeSeg(t.group, 0, -0.46, 0, 0.5, -1, 0.065, 0.065, 5, 1.0, 0.2, 'thigh' + side);
    mesh(CG.knee, heavy ? M.armor : M.gear, 0, -0.02, 0.078, s.group);
    mesh(CG.shin, M.uniform, 0, -0.21, 0, s.group);
    mesh(CG.cuff, M.uniform, 0, -0.39, 0, s.group);
    mesh(CG.boot, M.boot, 0, -0.44, 0.035, s.group);
    mesh(CG.sole, M.gear, 0, -0.495, 0.04, s.group);
    mesh(CG.toe, M.boot, 0, -0.465, 0.13, s.group);
    addHitbox(ch, s, 'leg', 0.14, 0.52, 0.2);
    bake(s.group, key + 'shin' + side);
    bake(t.group, key + 'thigh' + side);
  }
  bake(Hd, key + 'head');
  bake(T, key + 'torso');

  // weapon, carried in the hands; centred on its own origin so it can drop as a rigid body
  const rifle = new THREE.Group();
  rifle.position.copy(CARRY.aim.p);
  T.add(rifle);
  const long = sniper ? 1.35 : 1;
  const G = (geo, mat, x, y, z, rx = 0, sx = 1, sy = 1, sz = 1) => { const o = mesh(geo, mat, x, y, z, rifle, sx, sy, sz); o.rotation.x = rx; return o; };
  if (ally) {
    // AR-pattern carbine with a holographic sight
    G(CG.akRecv, M.gunMetal, 0, 0.004, 0.03, 0, 0.9, 1, 0.85);
    G(CG.akGuard, M.gunPoly, 0, 0.006, 0.05, 0, 0.95, 1.05, 1);
    G(CG.arStock, M.gunPoly, 0, 0, 0);
    G(CG.sight, M.gunMetal, 0, 0.055, 0.04);
  } else {
    // AK-pattern rifle: wooden furniture and a long curved magazine
    G(CG.akRecv, M.gunMetal, 0, 0, 0.05);
    G(CG.akGuard, M.gunPoly, 0, 0, 0.05 * long, 0, 1, 1, long);
    G(CG.akStock, M.gunPoly, 0, 0, 0.02);
    if (!sniper) G(CG.sight, M.gunMetal, 0, 0.045, 0.05, 0, 0.8, 0.8, 0.8);
  }
  G(CG.akMag, heavy || ally ? M.gear : M.gunMetal, 0, 0, 0.05);
  G(CG.grip, M.gunPoly, 0, 0, 0);
  G(CG.barrel, M.gunMetal, 0, 0.005, 0.46 * long, Math.PI / 2, 1, 0.24 * long, 1);
  G(CG.brake, M.gunMetal, 0, 0.005, 0.58 * long, Math.PI / 2);
  G(CG.sling, M.gear, 0.03, -0.05, 0.05, 0.12);
  if (sniper) {
    G(CG.scope, M.gunMetal, 0, 0.075, 0.05, Math.PI / 2);
    for (const s of [-1, 1]) G(CG.bipod, M.gunMetal, s * 0.02, -0.06, 0.4, 0.9);
  }
  G(box(0.02, 0.02, 0.05), M.gunMetal, 0.035, -0.005, 0.3);
  bake(rifle, key + 'rifle');
  if (sniper) {
    ch.glint = new THREE.Sprite(glintMat.clone());
    ch.glint.position.set(0, 0.075, 0.19);
    ch.glint.scale.set(0.001, 0.001, 1);
    rifle.add(ch.glint);
  }
  ch.rifle = rifle;
  ch.muzzle = new THREE.Object3D(); ch.muzzle.position.set(0, 0.005, 0.62 * long); rifle.add(ch.muzzle);
  ch.laser = new THREE.Object3D(); ch.laser.position.set(0.035, -0.005, 0.33); rifle.add(ch.laser);

  ch.poses.upR = armPose(SH_R, V(-0.29, 0.78, 0.06), V(-0.25, 1.06, 0.1));
  ch.poses.upL = armPose(SH_L, V(0.29, 0.78, 0.06), V(0.25, 1.06, 0.1));
  ch.poses.throwR = armPose(SH_R, V(-0.3, 0.72, -0.16), V(-0.26, 0.98, -0.28));
  ch.poses.R = { u: new THREE.Quaternion(), l: new THREE.Quaternion() };
  ch.poses.L = { u: new THREE.Quaternion(), l: new THREE.Quaternion() };
  ch.carryP = CARRY.aim.p.clone(); ch.carryQ = new THREE.Quaternion();
  if (heavy) ch.root.scale.setScalar(1.1);
  return ch;
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _pa = new THREE.Vector3(), _hand = new THREE.Vector3(), _rq = new THREE.Quaternion(), _re = new THREE.Euler();
function setArm(ch, side, pose) {
  ch.segs['uArm' + side].group.quaternion.copy(pose.u);
  ch.segs['lArm' + side].group.quaternion.copy(pose.l);
}
function blendArm(ch, side, a, b, w) {
  ch.segs['uArm' + side].group.quaternion.slerpQuaternions(_qa.copy(a.u), _qb.copy(b.u), w);
  ch.segs['lArm' + side].group.quaternion.slerpQuaternions(_qa.copy(a.l), _qb.copy(b.l), w);
}

/**
 * Procedural animation. Options:
 *  vel + yaw (preferred) or speed, pitch, twist, look, flinch, kick, crouch,
 *  ready (0 = rifle at low ready, 1 = shouldered), sprint (port arms at a run), air (tucked legs),
 *  para (hanging under a canopy), rope (fast-roping), throw (0..1 grenade swing).
 *
 * The stride follows the distance actually covered (no foot sliding). When moving sideways or
 * backwards the hips turn toward the direction of travel and the torso counter-turns so the
 * rifle stays on target. Turning on the spot shuffles the feet. Running leans the body forward;
 * standing still shifts the weight. The hands follow the rifle through two-bone IK.
 */
export function animateSoldier(ch, dt, o) {
  const S = ch.segs;
  let speed = o.speed || 0, fwd = speed, side = 0;
  if (o.vel) {
    speed = Math.hypot(o.vel.x, o.vel.z);
    const sy = Math.sin(o.yaw || 0), cy = Math.cos(o.yaw || 0);
    fwd = o.vel.x * sy + o.vel.z * cy;
    side = o.vel.x * cy - o.vel.z * sy;
  }
  // turning on the spot: a few short shuffling steps
  let turn = 0;
  if (o.yaw !== undefined && dt > 0) {
    if (ch.prevYaw !== null) turn = clamp(Math.abs(wrapAngle(o.yaw - ch.prevYaw)) / dt / 2.5, 0, 1) * clamp(1 - speed / 1.2, 0, 1);
    ch.prevYaw = o.yaw;
  }
  ch.turnK = (ch.turnK || 0) + (turn - (ch.turnK || 0)) * (1 - Math.exp(-10 * dt));
  const hanging = o.para || o.rope;
  const gait = hanging ? 0 : Math.max(clamp(speed / 3.2, 0, 1), ch.turnK * 0.45);
  const run = hanging ? 0 : clamp((speed - 3.2) / 2.5, 0, 1);
  // one full cycle = two steps; step length grows with speed
  const stride = 1.1 + run * 0.7;
  ch.phase = (ch.phase + ((speed + ch.turnK * 1.6) * dt / stride) * Math.PI) % (Math.PI * 200);
  const dirSign = fwd < -0.3 ? -1 : 1;
  const swing = Math.sin(ch.phase) * dirSign;
  const amp = (0.5 + run * 0.3) * gait;
  let tR = -swing * amp, tL = swing * amp;
  const lift = 0.9 + run * 0.6;
  let sR = (Math.max(0, Math.sin(ch.phase + 1.3 * dirSign)) * lift + 0.1) * gait;
  let sL = (Math.max(0, Math.sin(ch.phase + 1.3 * dirSign + Math.PI)) * lift + 0.1) * gait;
  if (o.crouch) { tR -= 0.85; tL -= 0.85; sR += 1.0; sL += 1.0; }
  if (o.air) { tR -= 0.5; tL -= 0.9; sR += 0.9; sL += 1.2; }
  if (o.para) { const k = Math.sin(performance.now() * 0.002 + ch.phase) * 0.12; tR = -0.35 + k; tL = -0.2 - k; sR = 0.5; sL = 0.35; }
  if (o.rope) { tR = -0.5; tL = -0.25; sR = 0.7; sL = 0.4; }
  S.thighR.group.rotation.x = tR; S.thighL.group.rotation.x = tL;
  S.shinR.group.rotation.x = sR; S.shinL.group.rotation.x = sL;
  // landing from a hop: a quick dip in the knees
  if (ch.wasAir && !o.air) ch.landT = 0.22;
  ch.wasAir = !!o.air;
  ch.landT = Math.max(0, ch.landT - dt);
  const land = ch.landT > 0 ? Math.sin((ch.landT / 0.22) * Math.PI) : 0;

  // hips face the direction of travel when strafing; the torso turns back toward the target
  let hipYaw = 0;
  if (gait > 0.2 && Math.abs(side) > 0.4) hipYaw = clamp(Math.atan2(side, Math.abs(fwd) + 0.01) * (fwd < -0.3 ? -1 : 1), -0.9, 0.9) * 0.8;
  ch.hipYaw = (ch.hipYaw || 0) + (hipYaw - (ch.hipYaw || 0)) * (1 - Math.exp(-8 * dt));
  const t = performance.now() * 0.001 + ch.phase * 0.01;
  const idle = 1 - gait;
  ch.hips.rotation.set(0, ch.hipYaw, Math.sin(ch.phase) * 0.05 * gait + Math.sin(t * 0.7) * 0.02 * idle);
  ch.hips.position.set(Math.sin(t * 0.7) * 0.012 * idle, (o.crouch ? 0.62 : 0.98) - 0.03 * run - land * 0.08 + Math.abs(Math.cos(ch.phase)) * (0.03 + 0.03 * run) * gait, 0);

  const breathe = Math.sin(t * 1.8) * 0.02 * idle;
  const f = o.flinch || 0;
  // carry: shouldered when ready, dipped at low ready, across the chest at a sprint
  const k = 1 - Math.exp(-7 * dt);
  ch.ready += ((o.ready ?? 1) - ch.ready) * k;
  ch.sprintK += ((o.sprint ? 1 : 0) - ch.sprintK) * k;
  const sprintK = hanging ? 1 : ch.sprintK;
  const lean = 0.05 * gait + 0.14 * run + 0.1 * sprintK * run;
  S.torso.group.rotation.set(-(o.pitch || 0) * (1 - sprintK) + lean + breathe + f * 0.35, (o.twist || 0) - ch.hipYaw + Math.sin(ch.phase) * (0.06 + 0.08 * sprintK) * gait + f * 0.2, -Math.sin(ch.phase) * 0.03 * gait - f * 0.15);
  S.head.group.rotation.set(-(o.pitch || 0) * 0.3 - lean * 0.6 + (o.nod || 0), (o.look || 0) - Math.sin(ch.phase) * 0.04 * gait, 0);

  _pa.copy(CARRY.low.p).lerp(CARRY.aim.p, ch.ready);
  _rq.slerpQuaternions(CARRY.low.q, CARRY.aim.q, ch.ready);
  _pa.lerp(CARRY.port.p, sprintK);
  _rq.slerp(CARRY.port.q, sprintK);
  // the rifle rides the steps a little, and bucks with each shot
  _rq.multiply(_qc.setFromEuler(_re.set(Math.sin(ch.phase * 2) * 0.03 * gait - (o.kick || 0) * 0.12, 0, Math.sin(ch.phase) * 0.06 * gait * (0.4 + sprintK))));
  _pa.y += Math.abs(Math.cos(ch.phase)) * 0.015 * gait;
  _pa.z -= (o.kick || 0) * 0.05;
  if (o.para) _pa.y -= 0.08;
  ch.rifle.position.copy(_pa);
  ch.rifle.quaternion.copy(_rq);

  if (hanging) { setArm(ch, 'R', ch.poses.upR); setArm(ch, 'L', ch.poses.upL); return; }
  // left hand on the handguard, right hand on the grip (unless it is throwing a grenade)
  ikArm(SH_L, _hand.copy(GRIP_L).applyQuaternion(_rq).add(_pa), POLE_L, ch.poses.L);
  setArm(ch, 'L', ch.poses.L);
  ikArm(SH_R, _hand.copy(GRIP_R).applyQuaternion(_rq).add(_pa), POLE_R, ch.poses.R);
  const th = clamp(o.throw || 0, 0, 1);
  if (th > 0) blendArm(ch, 'R', ch.poses.R, ch.poses.throwR, th);
  else setArm(ch, 'R', ch.poses.R);
}
