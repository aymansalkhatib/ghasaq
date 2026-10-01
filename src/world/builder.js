import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, UP, mulberry32, rand } from '../core/utils.js';
import { colliders, solidMeshes } from '../core/state.js';
import { MAT } from '../assets/materials.js';

/* Building blocks for the maps: solid boxes, decorated houses, ruins, arches, palms, props of the set. */

/** Everything a map builds hangs under this group, so switching maps is a single clear. */
export const worldRoot = new THREE.Group();
worldRoot.name = 'world';

const decoGeos = new Map();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export const lanternSpots = [];
export const brazierSpots = [];

/** Forget everything queued or registered by the previous map. */
export function resetBuilder() {
  lanternSpots.length = 0;
  brazierSpots.length = 0;
  decoGeos.clear();
}

/** Box geometry whose UVs are scaled to world size so textures keep a constant texel density. */
export function boxGeo(w, h, d, tile = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  }
  return g;
}
export function scaleUV(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
/** Decoration is merged into one mesh per material at the end of the build. */
export function addDeco(geo, mat, matrix) {
  if (matrix) geo.applyMatrix4(matrix);
  if (!decoGeos.has(mat)) decoGeos.set(mat, []);
  decoGeos.get(mat).push(geo);
}
export function addCollider(minX, minY, minZ, maxX, maxY, maxZ) {
  const c = { min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ) };
  colliders.push(c);
  return c;
}
export function block(cx, cz, w, d, h, mat, o = {}) {
  const y0 = o.y0 || 0;
  const mesh = new THREE.Mesh(o.geo || boxGeo(w, h, d, o.tile || 3), mat);
  mesh.position.set(cx, y0 + h / 2, cz);
  mesh.castShadow = o.cast !== false;
  mesh.receiveShadow = true;
  mesh.userData.surface = o.surface || 'stone';
  worldRoot.add(mesh);
  if (o.solid !== false) {
    addCollider(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2);
    solidMeshes.push(mesh);
  }
  return mesh;
}
function facades(cx, cz, w, d) {
  return {
    N: { p: new THREE.Vector3(cx, 0, cz - d / 2), n: new THREE.Vector3(0, 0, -1), t: new THREE.Vector3(-1, 0, 0), L: w },
    S: { p: new THREE.Vector3(cx, 0, cz + d / 2), n: new THREE.Vector3(0, 0, 1), t: new THREE.Vector3(1, 0, 0), L: w },
    E: { p: new THREE.Vector3(cx + w / 2, 0, cz), n: new THREE.Vector3(1, 0, 0), t: new THREE.Vector3(0, 0, -1), L: d },
    W: { p: new THREE.Vector3(cx - w / 2, 0, cz), n: new THREE.Vector3(-1, 0, 0), t: new THREE.Vector3(0, 0, 1), L: d },
  };
}
// s = distance along the wall, y = height, out = distance off the wall
function facadeBox(f, sx, sy, sz, s, y, out, mat) {
  _m.makeBasis(f.t, UP, f.n);
  _m.setPosition(f.p.x + f.t.x * s + f.n.x * out, y, f.p.z + f.t.z * s + f.n.z * out);
  addDeco(new THREE.BoxGeometry(sx, sy, sz), mat, _m);
}

/**
 * Flat-roofed house with windows, beams, a door and roof clutter. opts.stairs = { face, dir } makes
 * the roof a fighting position: an outside stair climbs along that face (rising in the face's
 * tangent direction dir = ±1), the parapet becomes solid, and it opens where the stair arrives.
 */
export function house(cx, cz, w, d, h, door, seed, lantern, opts = {}) {
  const r = mulberry32(seed);
  block(cx, cz, w, d, h, r() < 0.5 ? MAT.plaster : MAT.plasterWarm, { surface: 'plaster', tile: 3.2 });
  addDeco(boxGeo(w + 0.24, 0.55, d + 0.24, 2), MAT.stone, _m.makeTranslation(cx, 0.27, cz));
  addDeco(boxGeo(w + 0.36, 0.28, d + 0.36, 2), MAT.stone, _m.makeTranslation(cx, h - 0.05, cz));
  const F = facades(cx, cz, w, d);
  const st = opts.stairs;
  let gap = null;
  if (st) {
    const f = F[st.face], n = Math.ceil(h / 0.3), run = 0.42, sTop = st.dir * (f.L / 2 - 0.85);
    gap = { face: st.face, s: sTop };
    // the stair: solid steps against the wall, the top one level with the roof beside the opening
    const sx = f.p.x + f.n.x * 0.55, sz = f.p.z + f.n.z * 0.55;
    stairRun(sx + f.t.x * (sTop - st.dir * (n * run + 0.2)), sz + f.t.z * (sTop - st.dir * (n * run + 0.2)), f.t.x * st.dir, f.t.z * st.dir, 1.05, h, n, run);
  }
  for (const key of ['N', 'S', 'E', 'W']) {
    const f = F[key];
    // parapet: decorative, or solid (with the opening) on a roof you can reach
    const runs = gap && gap.face === key ? [[-f.L / 2, gap.s - 0.65], [gap.s + 0.65, f.L / 2]] : [[-f.L / 2, f.L / 2]];
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue;
      const mid = (a + b) / 2, px = f.p.x + f.t.x * mid - f.n.x * 0.15, pz = f.p.z + f.t.z * mid - f.n.z * 0.15;
      const along = Math.abs(f.t.x) > 0.5, pw = along ? b - a : 0.3, pd = along ? 0.3 : b - a;
      addDeco(boxGeo(pw, 0.7, pd, 3), MAT.plaster, _m.makeTranslation(px, h + 0.35, pz));
      if (st) addCollider(px - pw / 2, h, pz - pd / 2, px + pw / 2, h + 0.95, pz + pd / 2);
    }
  }
  for (const key of ['N', 'S', 'E', 'W']) {
    const f = F[key];
    const n = Math.max(1, Math.floor(f.L / 3.4));
    const wy = h > 5.5 ? h - 2.3 : 2.1;
    for (let k = 0; k < n; k++) {
      const s = (k - (n - 1) / 2) * (f.L / n);
      if (key === door && Math.abs(s) < 1.6 && wy < 3) continue;
      if (r() < 0.2) continue;
      facadeBox(f, 0.95, 1.15, 0.1, s, wy, 0.04, r() < 0.55 ? MAT.windowGlow : MAT.windowDark);
      facadeBox(f, 1.2, 0.12, 0.2, s, wy - 0.64, 0.08, MAT.stone);
      facadeBox(f, 1.15, 0.1, 0.14, s, wy + 0.62, 0.06, MAT.beam);
      facadeBox(f, 0.1, 1.3, 0.14, s - 0.55, wy, 0.06, MAT.beam);
      facadeBox(f, 0.1, 1.3, 0.14, s + 0.55, wy, 0.06, MAT.beam);
      if (r() < 0.5) facadeBox(f, 0.5, 1.2, 0.06, s + (r() < 0.5 ? -0.85 : 0.85), wy, 0.1, MAT.planks);
    }
    if (key === 'N' || key === 'S') {
      for (let s = -f.L / 2 + 0.8; s < f.L / 2 - 0.5; s += 1.3) {
        _m.makeBasis(f.t, UP, f.n);
        _m.setPosition(f.p.x + f.t.x * s + f.n.x * 0.3, h - 0.55, f.p.z + f.t.z * s + f.n.z * 0.3);
        const g = new THREE.CylinderGeometry(0.09, 0.1, 0.6, 7);
        g.rotateX(Math.PI / 2);
        addDeco(g, MAT.beam, _m);
      }
    }
  }
  const fd = F[door];
  facadeBox(fd, 1.5, 2.5, 0.12, 0, 1.25, 0.05, MAT.planks);
  facadeBox(fd, 2.0, 0.3, 0.3, 0, 2.65, 0.12, MAT.stone);
  facadeBox(fd, 2.2, 0.08, 1.0, 0, 2.95, 0.5, MAT.beam);
  if (lantern) {
    facadeBox(fd, 0.22, 0.32, 0.22, 1.35, 2.55, 0.28, MAT.lantern);
    facadeBox(fd, 0.28, 0.06, 0.28, 1.35, 2.74, 0.28, MAT.darkMetal);
    facadeBox(fd, 0.05, 0.05, 0.3, 1.35, 2.8, 0.14, MAT.darkMetal);
    lanternSpots.push(new THREE.Vector3(fd.p.x + fd.t.x * 1.35 + fd.n.x * 0.53, 2.55, fd.p.z + fd.t.z * 1.35 + fd.n.z * 0.53));
  }
  // roof clutter: a water tank on legs and an old air-conditioner (solid on a roof you can reach)
  let tx = cx + (r() - 0.5) * (w - 3), tz = cz + (r() - 0.5) * (d - 3);
  if (st) { const f = F[st.face], k = Math.min(w, d) / 4; tx = cx - f.n.x * k - f.t.x * gap.s * 0.5; tz = cz - f.n.z * k - f.t.z * gap.s * 0.5; }
  addDeco(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 14), MAT.barrelBlue, _m.makeTranslation(tx, h + 1.0, tz));
  for (const [ox, oz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) addDeco(new THREE.BoxGeometry(0.06, 0.45, 0.06), MAT.metal, _m.makeTranslation(tx + ox, h + 0.22, tz + oz));
  let ax = cx + (r() - 0.5) * (w - 3), az = cz + (r() - 0.5) * (d - 3);
  if (st) { ax = tx + (tx > cx ? -1.4 : 1.4); az = tz; }
  addDeco(new THREE.BoxGeometry(0.9, 0.6, 0.6), MAT.metal, _m.makeTranslation(ax, h + 0.3, az));
  if (st) { addCollider(tx - 0.65, h, tz - 0.65, tx + 0.65, h + 1.55, tz + 0.65); addCollider(ax - 0.45, h, az - 0.3, ax + 0.45, h + 0.6, az + 0.3); }
}
/**
 * n solid steps rising from (x, z) toward (dx, dz): one merged mesh (bullets stop on it) plus a
 * collision box per step, so you walk up it like any stair.
 */
export function stairRun(x, z, dx, dz, width, height, n, run = 0.42, mat = MAT.stone) {
  const geos = [], rise = height / n;
  for (let i = 0; i < n; i++) {
    const cx = x + dx * (i + 0.5) * run, cz = z + dz * (i + 0.5) * run, hh = rise * (i + 1);
    const w = Math.abs(dx) > 0.5 ? run : width, d = Math.abs(dx) > 0.5 ? width : run;
    const g = boxGeo(w, hh, d, 2);
    g.translate(cx, hh / 2, cz);
    geos.push(g);
    addCollider(cx - w / 2, 0, cz - d / 2, cx + w / 2, hh, cz + d / 2);
  }
  const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
  m.castShadow = m.receiveShadow = true;
  m.userData.surface = 'stone';
  worldRoot.add(m);
  solidMeshes.push(m);
}

export function crate(x, z, y0 = 0, s = 1.4) {
  return block(x, z, s, s, s, MAT.crate, { y0, geo: new THREE.BoxGeometry(s, s, s), surface: 'wood' });
}
export function sandbags(cx, cz, w, d) {
  const h = 1.15, horiz = w >= d, len = horiz ? w : d, per = Math.round(len / 0.62);
  addCollider(cx - w / 2, 0, cz - d / 2, cx + w / 2, h, cz + d / 2);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.sandbag);
  hit.position.set(cx, h / 2, cz);
  hit.visible = false;
  hit.userData.surface = 'sand';
  worldRoot.add(hit);
  solidMeshes.push(hit);
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < per; k++) {
      const off = (k + (row % 2) * 0.5 - per / 2 + 0.25) * (len / per);
      if (Math.abs(off) > len / 2 - 0.2) continue;
      const g = new RoundedBoxGeometry(0.62, 0.27, (horiz ? d : w) * 0.92, 2, 0.1);
      if (!horiz) g.rotateY(Math.PI / 2);
      addDeco(g, MAT.sandbag, _m.makeTranslation(horiz ? cx + off : cx, 0.14 + row * 0.28, horiz ? cz : cz + off));
    }
  }
}
export function arch(cx, cz, alongX) {
  for (const s of [-4.2, 4.2]) {
    const x = alongX ? cx + s : cx, z = alongX ? cz : cz + s;
    block(x, z, 1.3, 1.3, 5.6, MAT.stone, { surface: 'stone' });
    addDeco(boxGeo(1.6, 0.35, 1.6, 2), MAT.stone, _m.makeTranslation(x, 0.17, z));
  }
  block(cx, cz, alongX ? 9.7 : 1.5, alongX ? 1.5 : 9.7, 1.4, MAT.stone, { y0: 4.3, surface: 'stone' });
  addDeco(boxGeo(alongX ? 10.2 : 1.8, 0.3, alongX ? 1.8 : 10.2, 2), MAT.plaster, _m.makeTranslation(cx, 5.85, cz));
}
export function palm(x, z, h, seed) {
  const r = mulberry32(seed), a = r() * TAU, lean = 0.9 + r() * 0.8;
  let prev = new THREE.Vector3(x, 0, z);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const p = new THREE.Vector3(x + Math.cos(a) * lean * t * t, t * h, z + Math.sin(a) * lean * t * t);
    const dir = _a.subVectors(p, prev), len = dir.length();
    const g = new THREE.CylinderGeometry(0.17 - t * 0.05, 0.2 - t * 0.05, len * 1.04, 8);
    _q.setFromUnitVectors(UP, dir.normalize());
    _m.compose(_b.addVectors(p, prev).multiplyScalar(0.5), _q, _c.set(1, 1, 1));
    addDeco(g, MAT.trunk, _m);
    prev = p;
  }
  for (let k = 0; k < 12; k++) {
    const g = new THREE.PlaneGeometry(3.8, 1.0, 10, 1);
    g.translate(1.9, 0, 0);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v);
      pos.setY(v, pos.getY(v) * (1 - px / 5));
      pos.setZ(v, -((px / 3.8) ** 2) * 1.7 + px * 0.25);
    }
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    _q.setFromEuler(new THREE.Euler(r() * 0.35 - 0.1, (k / 12) * TAU + r() * 0.3, 0, 'YXZ'));
    _m.compose(prev, _q, _c.set(1, 1, 1));
    addDeco(g, MAT.leaf, _m);
  }
  for (let k = 0; k < 5; k++) addDeco(new THREE.SphereGeometry(0.15, 8, 6), MAT.beam, _m.makeTranslation(prev.x + rand(-0.3, 0.3), prev.y - 0.25, prev.z + rand(-0.3, 0.3)));
  addCollider(x - 0.3, 0, z - 0.3, x + 0.3, h, z + 0.3);
}
export function rock(x, z, s, seed) {
  const r = mulberry32(seed);
  const g = new THREE.DodecahedronGeometry(s, 0);
  const pos = g.attributes.position;
  for (let v = 0; v < pos.count; v++) pos.setXYZ(v, pos.getX(v) * (1 + r() * 0.25), pos.getY(v) * 0.7, pos.getZ(v) * (1 + r() * 0.25));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, MAT.rock);
  m.position.set(x, s * 0.35, z);
  m.rotation.y = r() * TAU;
  m.castShadow = m.receiveShadow = true;
  m.userData.surface = 'stone';
  worldRoot.add(m);
  solidMeshes.push(m);
  addCollider(x - s * 0.75, 0, z - s * 0.75, x + s * 0.75, s * 0.95, z + s * 0.75);
}
export function stall(x, z) {
  block(x, z, 2.6, 1.0, 0.95, MAT.planks, { surface: 'wood', tile: 1.5 });
  for (const [ox, oz] of [[-1.3, -0.5], [1.3, -0.5], [-1.3, 0.8], [1.3, 0.8]]) addDeco(new THREE.CylinderGeometry(0.05, 0.05, oz > 0 ? 2.2 : 2.6, 6), MAT.beam, _m.makeTranslation(x + ox, oz > 0 ? 1.1 : 1.3, z + oz));
  const awn = new THREE.PlaneGeometry(3.0, 1.7);
  awn.rotateX(-Math.PI / 2 + 0.28);
  addDeco(awn, MAT.cloth, _m.makeTranslation(x, 2.42, z + 0.15));
  for (let k = 0; k < 4; k++) addDeco(new THREE.CylinderGeometry(0.18, 0.13, 0.3, 10), k % 2 ? MAT.barrelOlive : MAT.stone, _m.makeTranslation(x - 0.9 + k * 0.6, 1.1, z));
}
/** Fire bowl on a stone pedestal: an iron basin of embers that glow at dusk and burn at night. */
export function brazier(x, z) {
  addDeco(new THREE.CylinderGeometry(0.42, 0.46, 0.14, 12), MAT.stone, _m.makeTranslation(x, 0.07, z));
  addDeco(new THREE.CylinderGeometry(0.24, 0.3, 0.72, 10), MAT.stone, _m.makeTranslation(x, 0.5, z));
  addDeco(new THREE.CylinderGeometry(0.36, 0.28, 0.1, 12), MAT.stone, _m.makeTranslation(x, 0.9, z));
  const bowl = new THREE.LatheGeometry([[0.2, 0], [0.34, 0.06], [0.44, 0.22], [0.47, 0.34], [0.43, 0.34], [0.4, 0.24], [0.3, 0.1], [0.0, 0.08]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  addDeco(bowl, MAT.iron, _m.makeTranslation(x, 0.95, z));
  for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; addDeco(new THREE.TorusGeometry(0.05, 0.012, 5, 10), MAT.iron, _m.makeRotationY(-a).setPosition(x + Math.cos(a) * 0.46, 1.24, z + Math.sin(a) * 0.46)); }
  addDeco(new THREE.CylinderGeometry(0.4, 0.38, 0.06, 14), MAT.embers, _m.makeTranslation(x, 1.22, z));
  for (let k = 0; k < 7; k++) addDeco(new THREE.DodecahedronGeometry(0.07 + (k % 3) * 0.02, 0), MAT.embers, _m.makeTranslation(x + Math.cos(k * 2.4) * 0.22, 1.26, z + Math.sin(k * 2.4) * 0.22));
  addCollider(x - 0.4, 0, z - 0.4, x + 0.4, 1.28, z + 0.4);
  brazierSpots.push(new THREE.Vector3(x, 1.35, z));
}
export function decoBox(w, h, d, mat, x, y, z, rotY = 0) {
  addDeco(boxGeo(w, h, d, 2), mat, _m.makeRotationY(rotY).setPosition(x, y, z));
}

/* ---------- set dressing shared by the maps ---------- */
/** The invaders' war banner on a wooden pole, planted where they gather to attack. rot = yaw it faces. */
export function banner(x, z, rot = 0, h = 4.4) {
  addDeco(new THREE.CylinderGeometry(0.06, 0.08, h, 8), MAT.planks, _m.makeTranslation(x, h / 2, z));
  addDeco(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6).rotateZ(Math.PI / 2), MAT.beam, _m.makeRotationY(rot).setPosition(x, h - 0.12, z));
  addDeco(new THREE.SphereGeometry(0.09, 8, 6), MAT.brass, _m.makeTranslation(x, h + 0.05, z));
  const g = new THREE.PlaneGeometry(1.1, 2.2, 6, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3.2 + p.getY(i) * 0.8) * 0.06 + (1.1 - p.getY(i)) * 0.03);
  g.computeVertexNormals();
  addDeco(g, MAT.banner, _m.makeRotationY(rot).setPosition(x, h - 1.3, z));
  addCollider(x - 0.12, 0, z - 0.12, x + 0.12, h, z + 0.12);
}
/** Wooden lamp post with a glowing lantern (emissive only: the map's six real lights are elsewhere). */
export function lampPost(x, z, rot = 0) {
  addDeco(new THREE.CylinderGeometry(0.08, 0.1, 3.1, 8), MAT.planks, _m.makeTranslation(x, 1.55, z));
  addDeco(new THREE.BoxGeometry(0.06, 0.06, 0.55), MAT.beam, _m.makeRotationY(rot).setPosition(x + Math.sin(rot) * 0.25, 3.0, z + Math.cos(rot) * 0.25));
  addDeco(new THREE.BoxGeometry(0.2, 0.28, 0.2), MAT.lantern, _m.makeTranslation(x + Math.sin(rot) * 0.5, 2.82, z + Math.cos(rot) * 0.5));
  addDeco(new THREE.ConeGeometry(0.17, 0.14, 4).rotateY(Math.PI / 4), MAT.metal, _m.makeTranslation(x + Math.sin(rot) * 0.5, 3.02, z + Math.cos(rot) * 0.5));
  addCollider(x - 0.12, 0, z - 0.12, x + 0.12, 3.1, z + 0.12);
}
/** A sagging string of bulbs between two points (a market strung for the evening). */
export function stringLights(a, b, n = 12, sag = 0.5) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, z = a[2] + (b[2] - a[2]) * t;
    pts.push(new THREE.Vector3(x, y, z));
    if (i > 0 && i < n) addDeco(new THREE.SphereGeometry(0.055, 6, 4), MAT.lantern, _m.makeTranslation(x, y - 0.07, z));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), MAT.cable);
  worldRoot.add(line);
}
/** Low stone planter with a shrub: under knee height, so you step over it. */
export function planter(x, z, w, d) {
  const h = 0.42;
  addDeco(boxGeo(w, h, d, 1.5), MAT.stone, _m.makeTranslation(x, h / 2, z));
  addDeco(boxGeo(w - 0.16, 0.05, d - 0.16, 1.5), MAT.burnt, _m.makeTranslation(x, h, z));
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.9, 0.7);
    g.translate(0, 0.35, 0);
    addDeco(g, MAT.shrub, _m.makeRotationY((k / 3) * Math.PI).setPosition(x + (k - 1) * (w - 0.6) * 0.3, h, z));
  }
  addCollider(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2);
}
/** Concrete jersey barrier: waist-high cover. */
export function barrier(x, z, len, alongX) {
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0); s.lineTo(0.32, 0); s.lineTo(0.3, 0.12); s.lineTo(0.12, 0.3); s.lineTo(0.1, 0.92); s.lineTo(-0.1, 0.92); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.12); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  if (alongX) g.rotateY(Math.PI / 2);
  addDeco(g, MAT.concrete, _m.makeTranslation(x, 0, z));
  const hw = alongX ? len / 2 : 0.32, hd = alongX ? 0.32 : len / 2;
  addCollider(x - hw, 0, z - hd, x + hw, 0.92, z + hd);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.92, hd * 2), MAT.concrete);
  hit.position.set(x, 0.46, z); hit.visible = false; hit.userData.surface = 'stone';
  worldRoot.add(hit); solidMeshes.push(hit);
}
/** Clay water jars and pots, grouped against a wall. */
export function jars(x, z, n, seed) {
  const r = mulberry32(seed);
  for (let k = 0; k < n; k++) {
    const s = 0.7 + r() * 0.6, px = x + (r() - 0.5) * 1.2, pz = z + (r() - 0.5) * 0.8;
    const pts = [[0, 0], [0.16, 0.02], [0.24, 0.18], [0.25, 0.32], [0.18, 0.5], [0.1, 0.56], [0.11, 0.62], [0.08, 0.63]].map(([a, b]) => new THREE.Vector2(a * s, b * s));
    addDeco(new THREE.LatheGeometry(pts, 12), MAT.clay, _m.makeTranslation(px, 0, pz));
  }
}
/** A patterned carpet hung over a wall or a rail to air (h metres high at its top edge). */
export function carpet(x, y, z, rot, w = 1.3, h = 1.9) {
  const g = new THREE.PlaneGeometry(w, h, 1, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getY(i) / h) * Math.PI) * 0.04);
  addDeco(g, MAT.carpet, _m.makeRotationY(rot).setPosition(x, y - h / 2, z));
}
/** A burned-out car. Rotation is kept near an axis so its collision box stays tight. */
export function car(x, z, rot, seed) {
  const r = mulberry32(seed);
  const place = (g, mat, lx, ly, lz) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    addDeco(g, mat, _m.makeRotationY(rot).setPosition(x + lx * c + lz * s, ly, z - lx * s + lz * c));
  };
  place(new THREE.BoxGeometry(1.8, 0.7, 4.3), MAT.burnt, 0, 0.72, 0);
  place(new THREE.BoxGeometry(1.62, 0.62, 2.1), MAT.burnt, 0, 1.38, -0.25);
  place(new THREE.BoxGeometry(1.5, 0.5, 0.06), MAT.windowDark, 0, 1.38, 0.82);
  place(new THREE.BoxGeometry(1.7, 0.12, 0.3), MAT.rust, 0, 0.5, 2.2);
  place(new THREE.BoxGeometry(1.7, 0.12, 0.3), MAT.rust, 0, 0.5, -2.2);
  for (const [lx, lz] of [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.35], [0.86, -1.35]]) {
    const g = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14);
    g.rotateZ(Math.PI / 2);
    place(g, r() < 0.3 ? MAT.rubber : MAT.rust, lx, 0.33, lz);
  }
  solidBox(x, z, rot, 1.8, 1.7, 4.3, 'metal');
}
/** Abandoned military lorry: cab, bonnet, cargo bed under a torn canvas tilt on hoops. */
export function truck(x, z, rot, seed, burnt = false) {
  const r = mulberry32(seed), body = burnt ? MAT.burnt : MAT.hullDark;
  const place = (g, mat, lx, ly, lz) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    addDeco(g, mat, _m.makeRotationY(rot).setPosition(x + lx * c + lz * s, ly, z - lx * s + lz * c));
  };
  place(new THREE.BoxGeometry(2.3, 0.35, 6.4), MAT.rubber, 0, 0.72, 0);                // chassis
  place(new THREE.BoxGeometry(2.2, 1.35, 1.7), body, 0, 1.55, 2.0);                    // cab
  place(new THREE.BoxGeometry(2.0, 0.85, 1.2), body, 0, 1.25, 3.3);                    // bonnet
  place(new THREE.BoxGeometry(1.9, 0.55, 0.05), MAT.windowDark, 0, 1.85, 2.86);        // windscreen
  place(new THREE.BoxGeometry(2.4, 0.2, 0.15), MAT.rust, 0, 0.8, 3.95);                // bumper
  place(new THREE.BoxGeometry(2.4, 0.5, 4.0), body, 0, 1.2, -1.3);                     // cargo bed
  const tilt = new THREE.CylinderGeometry(1.2, 1.2, 3.9, 14, 1, true, -Math.PI / 2, Math.PI);
  tilt.rotateX(Math.PI / 2);
  if (!burnt || r() < 0.5) place(tilt, MAT.canvas, 0, 1.45, -1.3);
  for (const lz of [-3.0, -1.3, 0.4]) place(new THREE.TorusGeometry(1.2, 0.03, 4, 12, Math.PI), MAT.rust, 0, 1.45, lz);
  for (const [lx, lz] of [[-1.05, 3.0], [1.05, 3.0], [-1.05, -0.6], [1.05, -0.6], [-1.05, -2.2], [1.05, -2.2]]) {
    const g = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 16);
    g.rotateZ(Math.PI / 2);
    place(g, burnt ? MAT.rust : MAT.rubber, lx, 0.5, lz);
  }
  solidBox(x, z, rot, 2.4, 2.6, 7.6, 'metal', 0.3);
}
/** Invisible solid for bullets plus an axis-aligned collider around a rotated footprint. */
function solidBox(x, z, rot, w, h, d, surface, zOff = 0) {
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const hx = (w / 2) * c + (d / 2) * s, hz = (w / 2) * s + (d / 2) * c;
  addCollider(x - hx, 0, z - hz, x + hx, h, z + hz);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.82, d), MAT.burnt);
  hit.position.set(x + Math.sin(rot) * zOff, h * 0.41, z + Math.cos(rot) * zOff);
  hit.rotation.y = rot;
  hit.visible = false;
  hit.userData.surface = surface;
  worldRoot.add(hit);
  solidMeshes.push(hit);
}
/** Rusty water tower on four legs; its planked platform (with a rail) is a sniper nest. */
export function waterTower(x, z, h) {
  for (const [ox, oz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) block(x + ox, z + oz, 0.4, 0.4, h, MAT.rust, { surface: 'metal' });
  for (const y of [3, 6.5]) {
    for (const [ax, az, w, d] of [[0, -2.2, 4.4, 0.12], [0, 2.2, 4.4, 0.12], [-2.2, 0, 0.12, 4.4], [2.2, 0, 0.12, 4.4]]) addDeco(new THREE.BoxGeometry(w, 0.12, d), MAT.rust, _m.makeTranslation(x + ax, y, z + az));
  }
  block(x, z, 5.6, 5.6, 0.4, MAT.planks, { y0: h, surface: 'wood', tile: 1.5 });
  block(x, z, 3.6, 3.6, 2.6, MAT.rust, { y0: h + 0.4, geo: new THREE.CylinderGeometry(1.8, 1.8, 2.6, 18), surface: 'metal' });
  addDeco(new THREE.ConeGeometry(1.95, 0.7, 18), MAT.rust, _m.makeTranslation(x, h + 3.35, z));
  for (const [ax, az, w, d] of [[0, -2.75, 5.6, 0.06], [0, 2.75, 5.6, 0.06], [-2.75, 0, 0.06, 5.6], [2.75, 0, 0.06, 5.6]]) addDeco(new THREE.BoxGeometry(w, 0.06, d), MAT.metal, _m.makeTranslation(x + ax, h + 1.3, z + az));
  for (const s of [-0.25, 0.25]) addDeco(new THREE.BoxGeometry(0.05, h, 0.05), MAT.metal, _m.makeTranslation(x - 2.45, h / 2, z + s));
  for (let y = 0.4; y < h; y += 0.4) addDeco(new THREE.BoxGeometry(0.04, 0.04, 0.5), MAT.metal, _m.makeTranslation(x - 2.45, y, z));
}

/** Merge every queued decoration geometry into a single mesh per material. */
export function mergeDeco() {
  for (const [mat, list] of decoGeos) {
    for (const g of list) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    // indexed and non-indexed pieces (e.g. rubble polyhedra) cannot merge together: flatten when mixed
    const mixed = list.some((g) => !g.index) && list.some((g) => g.index);
    const merged = mergeGeometries(mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldRoot.add(m);
  }
  decoGeos.clear();
}
