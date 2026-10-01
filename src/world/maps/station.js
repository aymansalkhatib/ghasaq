import * as THREE from 'three';
import { TAU, mulberry32 } from '../../core/utils.js';
import { MAT } from '../../assets/materials.js';
import { solidMeshes } from '../../core/state.js';
import { worldRoot, block, boxGeo, addDeco, addCollider, house, crate, sandbags, palm, rock, brazier, car, truck, waterTower, barrier, lampPost, stringLights, jars, banner } from '../builder.js';
import { desertFloor, horizonDunes } from './common.js';

/*
 * Mahattat al-Wadi (محطة الوادي): an abandoned railway station in the desert, walled in concrete.
 * Two tracks cross the whole map east to west between three platforms; the station hall with its
 * clock tower stands north of them, the freight yard (a warehouse you can fight through, fuel
 * tanks, workers' barracks) south. Freight wagons stand on the rails as long, tall cover — you can
 * see (and shoot) legs under them — and a derailed tank wagon lies across the yard.
 * North is -Z. Raiders gather under their banners at the road gates and where the tracks come in.
 */

const Z = (name, x0, x1, z0, z1) => ({ name, x0, x1, z0, z1 });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/** Concrete perimeter wall along one side, with gaps; coiled wire along the top. */
function fence(runs, fixed, alongX, h = 2.5) {
  for (const [a, b] of runs) {
    const len = b - a, mid = (a + b) / 2;
    block(alongX ? mid : fixed, alongX ? fixed : mid, alongX ? len : 0.5, alongX ? 0.5 : len, h, MAT.concrete, { surface: 'stone', tile: 3 });
    for (let s = a + 0.3; s < b - 0.2; s += 0.42) {
      const g = new THREE.TorusGeometry(0.2, 0.012, 4, 10);
      addDeco(g, MAT.steel, _m.makeRotationY(alongX ? 0 : Math.PI / 2).setPosition(alongX ? s : fixed, h + 0.2, alongX ? fixed : s));
    }
    for (let s = a + 1.5; s < b - 1; s += 3) addDeco(new THREE.BoxGeometry(alongX ? 0.35 : 0.62, h + 0.05, alongX ? 0.62 : 0.35), MAT.concrete, _m.makeTranslation(alongX ? s : fixed, (h + 0.05) / 2, alongX ? fixed : s));
  }
}

/** A track along X at z0 from x0 to x1: ballast bed, sleepers and two steel rails (all walkable). */
function track(z0, x0, x1) {
  const L = x1 - x0, cx = (x0 + x1) / 2;
  addDeco(boxGeo(L, 0.1, 3.4, 3), MAT.rock, _m.makeTranslation(cx, 0.05, z0));
  for (let x = x0 + 0.3; x < x1; x += 0.66) addDeco(new THREE.BoxGeometry(0.24, 0.1, 2.5), MAT.charred, _m.makeTranslation(x, 0.13, z0));
  for (const s of [-0.72, 0.72]) {
    addDeco(new THREE.BoxGeometry(L, 0.1, 0.07), MAT.steel, _m.makeTranslation(cx, 0.23, z0 + s));
    addDeco(new THREE.BoxGeometry(L, 0.03, 0.16), MAT.steel, _m.makeTranslation(cx, 0.195, z0 + s));
  }
}

/** Closed box wagon (11 m) on two bogies, sliding doors half open. */
function boxcar(x, z, seed) {
  const r = mulberry32(seed);
  block(x, z, 11, 2.9, 2.6, MAT.wagon, { y0: 1.05, surface: 'metal', tile: 2.5 });
  addDeco(new THREE.CylinderGeometry(1.55, 1.55, 11.1, 18, 1, false, -Math.PI / 2 + 0.95, Math.PI - 1.9).rotateZ(Math.PI / 2), MAT.wagon, _m.makeTranslation(x, 2.95, z));
  for (const s of [-1, 1]) {
    addDeco(new THREE.BoxGeometry(2.2, 2.2, 0.08), MAT.rust, _m.makeTranslation(x + (r() - 0.5) * 1.5, 2.25, z + s * 1.49));
    for (let k = -4; k <= 4; k += 2) addDeco(new THREE.BoxGeometry(0.07, 2.5, 0.05), MAT.rust, _m.makeTranslation(x + k * 1.2, 2.3, z + s * 1.475));
  }
  bogies(x, z, 8.4);
}
/** Flat wagon (9 m) with a lashed load of crates: climbable at 1.25 m. */
function flatcar(x, z) {
  block(x, z, 9, 2.8, 0.35, MAT.wagon, { y0: 0.9, surface: 'metal', tile: 2 });
  bogies(x, z, 6.6);
  for (const [dx, h] of [[-2.6, 1.3], [0, 0.9], [2.4, 1.3]]) block(x + dx, z, 1.8, 2.2, h, MAT.crate, { y0: 1.25, surface: 'wood', geo: new THREE.BoxGeometry(1.8, h, 2.2) });
}
/** A derailed tank wagon lying across the yard. rot small, so its collision box stays tight. */
function tankWagon(x, z, rot) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const place = (g, mat, lx, ly, lz) => addDeco(g, mat, _m.makeRotationY(rot).setPosition(x + lx * c + lz * sn, ly, z - lx * sn + lz * c));
  place(new THREE.CylinderGeometry(1.4, 1.4, 10, 20).rotateZ(Math.PI / 2), MAT.tank, 0, 2.15, 0);
  for (const s of [-1, 1]) place(new THREE.SphereGeometry(1.4, 16, 10, 0, TAU, 0, Math.PI / 2).rotateZ(-s * Math.PI / 2).scale(0.35, 1, 1), MAT.tank, s * 5, 2.15, 0);
  place(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12), MAT.tank, 0, 3.6, 0);
  place(new THREE.BoxGeometry(10.4, 0.3, 2.2), MAT.rubber, 0, 0.85, 0);
  for (const s of [-1, 1]) place(new THREE.BoxGeometry(2.4, 0.7, 2.0), MAT.rust, s * 3.6, 0.35, 0.15);
  const hx = 5.2 * Math.abs(c) + 1.4 * Math.abs(sn), hz = 5.2 * Math.abs(sn) + 1.4 * Math.abs(c);
  addCollider(x - hx, 0, z - hz, x + hx, 3.6, z + hz);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(10.4, 2.9, 2.8), MAT.tank);
  hit.position.set(x, 2.1, z); hit.rotation.y = rot; hit.visible = false; hit.userData.surface = 'metal';
  worldRoot.add(hit);
  solidMeshes.push(hit);
}
function bogies(x, z, span) {
  for (const s of [-1, 1]) {
    addDeco(new THREE.BoxGeometry(2.4, 0.45, 2.3), MAT.rubber, _m.makeTranslation(x + s * span / 2, 0.62, z));
    for (const dx of [-0.8, 0.8]) for (const dz of [-0.72, 0.72]) addDeco(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14).rotateX(Math.PI / 2), MAT.steel, _m.makeTranslation(x + s * span / 2 + dx, 0.45, z + dz));
  }
}

/** Platform: a concrete slab at step height (you walk up onto it), with a painted edge. */
function platform(cx, cz, w, d) {
  block(cx, cz, w, d, 0.4, MAT.concrete, { surface: 'stone', tile: 2 });
  for (const s of [-1, 1]) addDeco(new THREE.BoxGeometry(w, 0.02, 0.18), MAT.strap, _m.makeTranslation(cx, 0.41, cz + s * (d / 2 - 0.2)));
}
/** A platform canopy: slim columns and a metal roof. */
function canopy(cx, cz, w, d, y0, colZ) {
  for (let x = cx - w / 2 + 1; x <= cx + w / 2 - 1; x += 4) block(x, colZ, 0.26, 0.26, 3.2, MAT.steel, { y0, surface: 'metal' });
  block(cx, cz, w, d, 0.16, MAT.rust, { y0: y0 + 3.2, surface: 'metal', tile: 2 });
  addDeco(boxGeo(w + 0.2, 0.08, d + 0.2, 2), MAT.steel, _m.makeTranslation(cx, y0 + 3.4, cz));
}

/** The freight shed: you can walk (and fight) through it — a wide door on the track side, a side door east. */
function warehouse(x0, x1, z0, z1, h) {
  const t = 0.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const mat = MAT.plasterWarm;
  // north wall with the loading door (5 m), lintel over it
  block((x0 + cx - 2.5) / 2, z0, cx - 2.5 - x0, t, h, mat, { surface: 'plaster' });
  block((cx + 2.5 + x1) / 2, z0, x1 - cx - 2.5, t, h, mat, { surface: 'plaster' });
  block(cx, z0, 5, t, h - 4.4, mat, { y0: 4.4, surface: 'plaster' });
  block(cx, z1, W, t, h, mat, { surface: 'plaster' });
  block(x0, cz, t, D, h, mat, { surface: 'plaster' });
  // east wall with a side door
  block(x1, (z0 + cz - 0.9) / 2, t, cz - 0.9 - z0, h, mat, { surface: 'plaster' });
  block(x1, (cz + 0.9 + z1) / 2, t, z1 - cz - 0.9, h, mat, { surface: 'plaster' });
  block(x1, cz, t, 1.8, h - 2.4, mat, { y0: 2.4, surface: 'plaster' });
  // corrugated roof on trusses
  block(cx, cz, W + 0.6, D + 0.6, 0.3, MAT.rust, { y0: h, surface: 'metal', tile: 2 });
  for (let x = x0 + 2; x < x1 - 1; x += 3) addDeco(new THREE.BoxGeometry(0.2, 0.35, D), MAT.beam, _m.makeTranslation(x, h - 0.2, cz));
  // the door itself, rolled half up
  addDeco(new THREE.BoxGeometry(5.2, 1.2, 0.12), MAT.rust, _m.makeTranslation(cx, 3.8, z0 - 0.25));
  addDeco(new THREE.BoxGeometry(0.8, 0.8, 0.1), MAT.windowDark, _m.makeTranslation(x0 + 2, h - 1.6, z0 - 0.22));
}

/** Two horizontal fuel tanks on concrete saddles, with a walkway and pipes. */
function fuelDepot(x, z) {
  for (const dz of [-2.6, 2.6]) {
    block(x, z + dz, 8, 3.2, 3.2, MAT.tank, { y0: 0.5, geo: new THREE.CylinderGeometry(1.6, 1.6, 8, 20).rotateZ(Math.PI / 2), surface: 'metal' });
    for (const s of [-1, 1]) addDeco(new THREE.SphereGeometry(1.6, 16, 10, 0, TAU, 0, Math.PI / 2).rotateZ(-s * Math.PI / 2).scale(0.3, 1, 1), MAT.tank, _m.makeTranslation(x + s * 4, 2.1, z + dz));
    for (const s of [-2.6, 2.6]) addDeco(new THREE.BoxGeometry(0.6, 1.0, 2.6), MAT.concrete, _m.makeTranslation(x + s, 0.5, z + dz));
    addDeco(new THREE.BoxGeometry(6.4, 0.18, 0.5), MAT.strap, _m.makeTranslation(x, 2.2, z + dz + (dz > 0 ? 1.6 : -1.6)));
  }
  addDeco(new THREE.CylinderGeometry(0.12, 0.12, 6, 8).rotateX(Math.PI / 2), MAT.steel, _m.makeTranslation(x - 4.8, 0.6, z));
  addDeco(new THREE.CylinderGeometry(0.12, 0.12, 3, 8).rotateZ(Math.PI / 2), MAT.steel, _m.makeTranslation(x - 6.3, 0.6, z));
}

export default {
  id: 'station',
  name: 'محطة الوادي',
  spawns: [[-8, -40], [8, -40], [0, -43], [-8, 41], [8, 41], [-43, -1], [-43, 4], [43, 1], [43, -4], [19.5, -40]],
  hover: [[0, -22], [-16, 10.5], [14, 11], [0, 22]],
  // clock tower, the signal box roof, the water tower and the warehouse roof
  snipers: [[0, 13, -14], [-30, 6, -14], [29.7, 10.4, -24.3], [-20, 7.3, 18]],
  start: [0, 12], startYaw: 0,
  // inside the perimeter wall: supplies are only ever dropped in here
  interior: (x, z) => Math.abs(x) < 36.5 && Math.abs(z) < 28.5,
  dropFallback: [2, 15],
  zoneFallback: 'محطة الوادي',
  zones: [
    Z('برج الساعة', -2.5, 2.5, -16.5, -11.5),
    Z('صالة المحطة', -10, 10, -17.5, -10.5),
    Z('الرصيف الشمالي', -22, 22, -10.5, -5),
    Z('الرصيف الأوسط', -18, 18, -1.5, 1.5),
    Z('المستودع', -27, -13, 13.5, 22.5),
    Z('خزانات الوقود', 16, 28, 14, 24),
    Z('خزان الماء', 28, 36, -26, -18),
    Z('كشك الإشارات', -34, -26, -18, -10),
    Z('بيت ناظر المحطة', 23, 33, -16, -8),
    Z('سكن العمّال', -36, -28, 16, 26),
    Z('صهريج القطار', -14, -2, 5, 12),
    Z('موقف السيارات', -20, 20, -30, -17.5),
    Z('ساحة البضائع', -12, 16, 5, 28.5),
    Z('السكة الغربية', -38, -18, -6, 6),
    Z('السكة الشرقية', 18, 38, -6, 6),
    Z('أطراف المحطة', -48, 48, -48, 48),
  ],
  labels: [{ t: 'المدخل الشمالي', x: 0, z: -33, r: 0 }, { t: 'المدخل الجنوبي', x: 0, z: 33, r: 0 }, { t: 'السكة الغربية', x: -41, z: 1.5, r: -Math.PI / 2 }, { t: 'السكة الشرقية', x: 41, z: 1.5, r: Math.PI / 2 }],
  props: {
    crate: [[-8, -19.8], [9, -18.5], [-18, -12], [18, -12.5], [-3, 18], [11, 21], [-34, 8], [33, 10], [-9, 25], [26, -2.2]],
    xbarrel: [[-12, -20.5], [12, -21.5], [-20, 8.5], [8, 8.5], [30, 8], [-33, -8], [20, 26], [-26, 26], [3, -21], [34, -12]],
    barrel: [[-14.5, -20], [16, -21], [4, 25.5], [-11, 15], [25, 12], [-35, 12], [33, -7], [-24, -8]],
  },
  // menu backdrop: raiders on the tracks in front of the station hall, seen from the freight yard
  showcase: {
    soldiers: [['raider', 'rifle', 1.6, 6.3, -0.15], ['heavy', 'rifle', -0.6, 5.4, 0.3], ['night', 'sniper', 3.4, 5.0, -0.5]],
    cam: [-1.2, 2.3, 16.5], look: [1.4, 1.9, 4.2],
  },
  birds: [0, 27, 0],

  build({ flags }) {
    desertFloor();

    // the ridge round the outskirts keeps everyone on the map
    for (const [x, z, w, d] of [[0, -48, 100, 4], [0, 48, 100, 4], [-48, 0, 4, 100], [48, 0, 4, 100]]) block(x, z, w, d, 9, MAT.rock, { surface: 'stone', tile: 5 });

    // perimeter: road gates north and south, the tracks east and west, a breach in the north and south walls
    fence([[-38.25, -5], [5, 18], [21, 38.25]], -30, true);
    fence([[-38.25, -20], [-17, -5], [5, 38.25]], 30, true);
    fence([[-30, -6], [6, 30]], -38, false);
    fence([[-30, -6], [6, 30]], 38, false);

    // two tracks right across the map
    track(-3.2, -46, 46); track(3.2, -46, 46);
    platform(0, -8.3, 44, 4.4);
    platform(0, 0, 36, 2.6);
    canopy(0, -8.4, 30, 3.8, 0.4, -6.9);
    canopy(0, 0, 10, 2.4, 0.4, 0);
    for (const x of [-12, -6, 6, 12]) { addDeco(new THREE.BoxGeometry(1.6, 0.08, 0.5), MAT.planks, _m.makeTranslation(x, 0.85, 0)); for (const s of [-0.7, 0.7]) addDeco(new THREE.BoxGeometry(0.08, 0.45, 0.45), MAT.steel, _m.makeTranslation(x + s, 0.62, 0)); }

    // station hall with the clock tower; the tower top (with a parapet) is a sniper nest
    house(0, -14, 20, 7, 6, 'S', 101, true);
    block(0, -14, 4.4, 4.4, 13, MAT.plasterWarm, { surface: 'plaster', tile: 3 });
    addDeco(boxGeo(5, 0.3, 5, 2), MAT.stone, _m.makeTranslation(0, 12.85, -14));
    for (const [ox, oz, w, d] of [[0, -2.35, 5, 0.3], [0, 2.35, 5, 0.3], [-2.35, 0, 0.3, 5], [2.35, 0, 0.3, 5]]) {
      addDeco(boxGeo(w, 0.8, d, 2), MAT.plasterWarm, _m.makeTranslation(ox, 13.4, -14 + oz));
      addCollider(ox - w / 2, 13, -14 + oz - d / 2, ox + w / 2, 13.9, -14 + oz + d / 2);
    }
    for (const s of [-1, 1]) {
      addDeco(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 24).rotateX(Math.PI / 2), MAT.tank, _m.makeTranslation(0, 10.4, -14 + s * 2.24));
      addDeco(new THREE.BoxGeometry(0.06, 0.7, 0.03), MAT.rubber, _m.makeRotationZ(0.5).setPosition(0.12, 10.62, -14 + s * 2.3));
      addDeco(new THREE.BoxGeometry(0.05, 0.5, 0.03), MAT.rubber, _m.makeRotationZ(-1.9).setPosition(-0.18, 10.35, -14 + s * 2.3));
    }
    flags.push(new THREE.Vector3(1.9, 13, -15.9));
    stringLights([-10, 3.4, -10.4], [10, 3.4, -10.4], 20, 0.25);

    // north forecourt: the road in, a car park of wrecks, lamp posts
    truck(-10, -23.5, Math.PI / 2 + 0.06, 111, true);
    car(7, -23.5, Math.PI / 2 - 0.1, 112); car(14.5, -26.5, 0.15, 113); car(-17, -26.8, 0.2, 114);
    barrier(-3.4, -27.2, 3, true); barrier(2.8, -25.6, 3, true);
    for (const x of [-6, 6]) lampPost(x, -19.5, Math.PI);
    brazier(10, -20.5);
    sandbags(-2.5, -19.8, 4, 1.1);

    // west: the signal box (roof = sniper nest), a boxcar on the north track
    house(-30, -14, 5, 5, 6, 'E', 102, true);
    boxcar(-26, -3.2, 121);
    sandbags(-22, -12.5, 1.1, 4);

    // east: the station master's house (outside stair to its roof), the water tower, a boxcar and a flat wagon
    house(28, -12, 8, 6, 4.5, 'W', 103, true, { stairs: { face: 'N', dir: 1 } });
    waterTower(32, -22, 10);
    flags.push(new THREE.Vector3(34.6, 10.4, -24.6));
    flatcar(16, -3.2);
    boxcar(28, 3.2, 122);

    // the freight yard south of the tracks
    boxcar(6, 3.2, 123);
    tankWagon(-8, 8.6, 0.18);
    warehouse(-27, -13, 13.5, 22.5, 7);
    flags.push(new THREE.Vector3(-26.4, 7.3, 13.9));
    for (const [x, z, y] of [[-24.5, 16, 0], [-24.5, 17.4, 0], [-24.5, 16, 1.4], [-17, 20.5, 0], [-15.6, 20.5, 0], [-21, 19.5, 0]]) crate(x, z, y);
    fuelDepot(22, 19);
    house(-32, 21, 6, 7, 4.5, 'E', 104, true);
    brazier(-5, 13.5);
    for (const [x, z, y] of [[6, 16, 0], [7.4, 16, 0], [6, 16, 1.4], [-3.5, 23, 0], [-2.1, 23, 0]]) crate(x, z, y);
    sandbags(11, 12.5, 4, 1.1); sandbags(-13, 27, 4, 1.1);
    jars(-29.5, 16.6, 4, 21);
    for (const x of [-4.6, 4.6]) lampPost(x, 27.4, 0);
    for (const [x, z] of [[-35, -24], [35, 24], [-35, 9], [35.5, -28]]) palm(x, z, 6.2, x * 3 + z);

    // outskirts: rocks, and the invaders' banners where they gather (their own fictional emblem)
    for (const [x, z, s] of [[-14, -42, 1.5], [15, -43, 1.6], [-42, -14, 1.5], [-42, 14, 1.3], [42, 14, 1.5], [42, -12, 1.4], [-14, 42, 1.6], [16, 42.5, 1.3], [-30, -42, 1.8], [32, 42, 1.7]]) rock(x, z, s, Math.floor(x * 7 + z * 13));
    for (const [x, z, r] of [[-11, -44.5, 0], [11, -44.5, 0], [-11, 44.5, Math.PI], [11, 44.5, Math.PI], [-44.5, -9, Math.PI / 2], [-44.5, 9, Math.PI / 2], [44.5, -9, -Math.PI / 2], [44.5, 9, -Math.PI / 2]]) banner(x, z, r);

    horizonDunes(22);
  },
};
