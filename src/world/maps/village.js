import * as THREE from 'three';
import { TAU, mulberry32, rand } from '../../core/utils.js';
import { solidMeshes } from '../../core/state.js';
import { MAT } from '../../assets/materials.js';
import { worldRoot, block, boxGeo, addDeco, addCollider, house, crate, sandbags, arch, palm, rock, stall, brazier, car, waterTower, banner, lampPost, stringLights, planter, barrier, jars, carpet, truck } from '../builder.js';
import { desertFloor, horizonDunes } from './common.js';

/*
 * Al-Qarya al-Mahjoura (القرية المهجورة): an abandoned village inside a broken mud-brick wall.
 * Two streets cross at a well square. Around them: the mosque and its minaret (north-west),
 * the old market (north-east), a quarter of ruined houses (south-west) and a walled palm
 * orchard (south-east). Close-quarters fights, many ways in, and burned-out cars for cover.
 * A lorry and concrete barriers make a checkpoint at the north entry, an outside stair climbs to a
 * roof over the east street, lanterns are strung across the market, and an old cemetery lies
 * west of the mosque. North is -Z. Raiders gather under their banners on the outskirts.
 */

const Z = (name, x0, x1, z0, z1) => ({ name, x0, x1, z0, z1 });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/** A roofless ruin: four broken walls of random height, a doorway, rubble and a fallen beam. */
function ruin(cx, cz, w, d, h, door, seed) {
  const r = mulberry32(seed), t = 0.45;
  const mat = r() < 0.5 ? MAT.plasterWarm : MAT.mud;
  const sides = { N: [cx, cz - d / 2, w + t, true], S: [cx, cz + d / 2, w + t, true], W: [cx - w / 2, cz, d - t, false], E: [cx + w / 2, cz, d - t, false] };
  for (const [key, [x, z, L, alongX]] of Object.entries(sides)) {
    let gap = null;
    if (key === door) gap = [-1.3, 1.3];
    else if (r() < 0.5) { const c = (r() - 0.5) * (L - 4.5); gap = [c - 1.1, c + 1.1]; }
    const runs = gap ? [[-L / 2, gap[0]], [gap[1], L / 2]] : [[-L / 2, L / 2]];
    for (const [a, b] of runs) {
      let u = a;
      while (u < b - 0.25) {
        const len = Math.min(b - u, 1.4 + r() * 2.4);
        const hh = h * (0.3 + r() * 0.7);
        const mid = u + len / 2;
        block(alongX ? x + mid : x, alongX ? z : z + mid, alongX ? len : t, alongX ? t : len, hh, mat, { surface: 'plaster', tile: 3 });
        // a jagged broken top
        if (r() < 0.7) addDeco(boxGeo(alongX ? len * 0.5 : t, 0.35, alongX ? t : len * 0.5, 2), mat, _m.makeTranslation(alongX ? x + mid + (r() - 0.5) * len * 0.4 : x, hh + 0.17, alongX ? z : z + mid + (r() - 0.5) * len * 0.4));
        u += len;
      }
    }
  }
  // rubble heaps along the inside of the walls, and a charred beam fallen from the roof
  for (let k = 0; k < 9; k++) {
    const g = new THREE.DodecahedronGeometry(0.18 + r() * 0.35, 0);
    g.scale(1, 0.55, 1);
    const side = r() < 0.5 ? -1 : 1, along = r() < 0.5;
    const x = along ? cx + (r() - 0.5) * (w - 1.4) : cx + side * (w / 2 - 0.8), z = along ? cz + side * (d / 2 - 0.8) : cz + (r() - 0.5) * (d - 1.4);
    addDeco(g, r() < 0.5 ? MAT.rock : MAT.stone, _m.makeRotationY(r() * TAU).setPosition(x, 0.1, z));
  }
  // one end on the floor, the other propped on the rubble
  const len = Math.min(w, d) * 0.7, tilt = Math.asin(0.45 / len);
  _q.setFromEuler(new THREE.Euler(tilt, r() * TAU, 0, 'YXZ'));
  _m.compose(_p.set(cx + (r() - 0.5) * 1.5, 0.11 + 0.225, cz + (r() - 0.5) * 1.5), _q, _s);
  addDeco(new THREE.BoxGeometry(0.2, 0.2, len), MAT.charred, _m);
}

/** Low mud-brick wall: cover you can crouch behind. */
function mudWall(cx, cz, w, d, h = 1.1) {
  block(cx, cz, w, d, h, MAT.mud, { surface: 'plaster', tile: 2.5 });
  const along = w > d, len = along ? w : d;
  for (let s = -len / 2 + 0.5; s < len / 2 - 0.3; s += 1.1 + Math.random() * 0.6) {
    addDeco(boxGeo(along ? 0.7 : d + 0.06, 0.12, along ? d + 0.06 : 0.7, 1), MAT.mud, _m.makeTranslation(along ? cx + s : cx, h + 0.05, along ? cz : cz + s));
  }
}

function well(x, z) {
  block(x, z, 2.6, 2.6, 0.95, MAT.stone, { geo: new THREE.CylinderGeometry(1.3, 1.4, 0.95, 14), surface: 'stone' });
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 14), MAT.water);
  water.rotation.x = -Math.PI / 2;
  water.position.set(x, 0.55, z);
  worldRoot.add(water);
  for (const s of [-1.05, 1.05]) addDeco(new THREE.BoxGeometry(0.14, 2.2, 0.14), MAT.beam, _m.makeTranslation(x + s, 1.1, z));
  const bar = new THREE.CylinderGeometry(0.07, 0.07, 2.3, 8);
  bar.rotateZ(Math.PI / 2);
  addDeco(bar, MAT.beam, _m.makeTranslation(x, 2.1, z));
  addDeco(new THREE.CylinderGeometry(0.16, 0.12, 0.26, 10), MAT.darkMetal, _m.makeTranslation(x + 0.3, 1.35, z));
  addDeco(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), MAT.darkMetal, _m.makeTranslation(x + 0.3, 1.8, z));
}

function mosque(cx, cz, w, d, h) {
  block(cx, cz, w, d, h, MAT.plasterWarm, { surface: 'plaster', tile: 3.2 });
  addDeco(boxGeo(w + 0.3, 0.5, d + 0.3, 2), MAT.stone, _m.makeTranslation(cx, 0.25, cz));
  addDeco(boxGeo(w + 0.4, 0.3, d + 0.4, 2), MAT.stone, _m.makeTranslation(cx, h, cz));
  const R = Math.min(w, d) * 0.3;
  addDeco(new THREE.CylinderGeometry(R + 0.15, R + 0.25, 0.9, 24), MAT.plasterWarm, _m.makeTranslation(cx, h + 0.6, cz));
  addDeco(new THREE.SphereGeometry(R, 24, 12, 0, TAU, 0, Math.PI / 2), MAT.dome, _m.makeTranslation(cx, h + 1.05, cz));
  addDeco(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), MAT.brass, _m.makeTranslation(cx, h + 1.05 + R + 0.5, cz));
  addDeco(new THREE.SphereGeometry(0.16, 10, 8), MAT.brass, _m.makeTranslation(cx, h + 1.05 + R + 0.75, cz));
  // pointed-arch doorway and a row of arched windows on the east face
  const fx = cx + w / 2;
  addDeco(new THREE.BoxGeometry(0.12, 2.6, 1.7), MAT.planks, _m.makeTranslation(fx + 0.05, 1.3, cz));
  addDeco(new THREE.BoxGeometry(0.3, 0.35, 2.3), MAT.stone, _m.makeTranslation(fx + 0.12, 2.8, cz));
  for (const s of [-3.2, -1.6, 1.6, 3.2]) {
    if (Math.abs(s) > d / 2 - 0.8) continue;
    addDeco(new THREE.BoxGeometry(0.1, 1.3, 0.7), MAT.windowGlow, _m.makeTranslation(fx + 0.04, h - 2.2, cz + s));
    addDeco(new THREE.BoxGeometry(0.16, 0.12, 0.9), MAT.stone, _m.makeTranslation(fx + 0.08, h - 1.5, cz + s));
  }
}

/** Minaret with a balcony; its flat top (with a low parapet) is a sniper nest. */
function minaret(x, z, h) {
  block(x, z, 2.6, 2.6, h, MAT.plasterWarm, { geo: new THREE.CylinderGeometry(1.2, 1.35, h, 12), surface: 'plaster' });
  addDeco(new THREE.CylinderGeometry(1.9, 1.5, 0.35, 12), MAT.stone, _m.makeTranslation(x, h - 2.6, z));
  addDeco(new THREE.CylinderGeometry(1.95, 1.95, 0.12, 12), MAT.stone, _m.makeTranslation(x, h - 2.35, z));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    addDeco(new THREE.BoxGeometry(0.1, 0.8, 0.1), MAT.stone, _m.makeTranslation(x + Math.cos(a) * 1.85, h - 1.95, z + Math.sin(a) * 1.85));
  }
  addDeco(new THREE.CylinderGeometry(1.4, 1.3, 0.25, 12), MAT.stone, _m.makeTranslation(x, h + 0.02, z));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    addDeco(new THREE.BoxGeometry(0.5, 0.55, 0.16), MAT.plasterWarm, _m.makeRotationY(-a + Math.PI / 2).setPosition(x + Math.cos(a) * 1.3, h + 0.35, z + Math.sin(a) * 1.3));
  }
}

/** Square stone watchtower with crenellations. */
function watchtower(x, z, h) {
  block(x, z, 4.5, 4.5, h, MAT.stone, { surface: 'stone', tile: 3 });
  for (let k = 0; k < 4; k++) {
    for (let s = -1.8; s <= 1.8; s += 1.2) {
      const [ox, oz] = [[s, -2.05], [s, 2.05], [-2.05, s], [2.05, s]][k];
      addDeco(new THREE.BoxGeometry(k < 2 ? 0.7 : 0.4, 0.7, k < 2 ? 0.4 : 0.7), MAT.stone, _m.makeTranslation(x + ox, h + 0.35, z + oz));
    }
  }
  addDeco(new THREE.BoxGeometry(0.9, 1.6, 0.1), MAT.windowDark, _m.makeTranslation(x, h - 2.5, z - 2.28));
}

/** Village wall along one side, with gaps (entries and breaches) given as [from, to] runs. */
function villageWall(runs, fixed, alongX, h = 2.4) {
  for (const [a, b] of runs) {
    const len = b - a, mid = (a + b) / 2;
    block(alongX ? mid : fixed, alongX ? fixed : mid, alongX ? len : 1, alongX ? 1 : len, h, MAT.mud, { surface: 'plaster', tile: 3 });
    for (let s = a + 0.5; s < b - 0.4; s += 1.6) addDeco(boxGeo(alongX ? 0.8 : 1.1, 0.4, alongX ? 1.1 : 0.8, 1), MAT.mud, _m.makeTranslation(alongX ? s : fixed, h + 0.2, alongX ? fixed : s));
  }
}

export default {
  id: 'village',
  name: 'القرية المهجورة',
  spawns: [[-4, -43], [4, -43], [-20, -43], [-43, -4], [-43, 20], [43, 4], [43, -22], [4, 43], [24, 43]],
  hover: [[0, -14], [-14, 0], [14, 0], [0, 14]],
  snipers: [[-12, 13, -27], [29.7, 10.4, -29.7], [26, 8, 26.5], [-30.8, 9, 30.8]],
  start: [0, 7], startYaw: 0,
  // inside the village wall: supplies are only ever dropped in here
  interior: (x, z) => Math.abs(x) < 36.5 && Math.abs(z) < 36.5,
  dropFallback: [5, -5],
  zoneFallback: 'القرية المهجورة',
  zones: [
    Z('ساحة البئر', -8, 8, -8, 8),
    Z('المقبرة', -36, -28, -26, -12),
    Z('الحاجز الشمالي', -4.5, 4.5, -37.5, -25),
    Z('المئذنة', -15, -9, -30, -24),
    Z('الجامع', -30, -8, -32, -10),
    Z('خزان الماء', 28, 36, -36, -28),
    Z('السوق القديم', 6, 32, -24, -12),
    Z('برج المراقبة', -36, -28, 28, 36),
    Z('بيت المزرعة', 23, 35, 23, 35),
    Z('البستان', 4, 38, 4, 38),
    Z('الحي المهدّم', -38, -4, 4, 38),
    Z('الشارع الشمالي', -4, 4, -38, -8),
    Z('الشارع الجنوبي', -4, 4, 8, 38),
    Z('الشارع الغربي', -38, -8, -4, 4),
    Z('الشارع الشرقي', 8, 38, -4, 4),
    Z('الحي الشمالي الغربي', -38, -4, -38, -4),
    Z('الحي الشمالي الشرقي', 4, 38, -38, -4),
    Z('أطراف القرية', -48, 48, -48, 48),
  ],
  labels: [{ t: 'المدخل الشمالي', x: 0, z: -41, r: 0 }, { t: 'المدخل الجنوبي', x: 0, z: 41, r: 0 }, { t: 'المدخل الغربي', x: -41, z: 0, r: -Math.PI / 2 }, { t: 'المدخل الشرقي', x: 41, z: 0, r: Math.PI / 2 }],
  props: {
    crate: [[-6, -12], [6, 14.5], [-12, -6], [12, 6], [-20, -30], [22, -18], [-24, 18], [10, 30], [30, 16], [-24, -26.5]],
    xbarrel: [[-5.5, 11], [7, -11], [-18, -12], [18, 12], [-2, -30], [-30, 2], [30, -2], [2, 30], [-22, 32], [22, -33]],
    barrel: [[-5.5, -11], [5.5, 10.2], [-17, 25], [18.5, -24], [26, 5], [-26, -5], [35, 22], [-28, -36]],
  },
  // menu backdrop: raiders at the well square, seen from the south street
  showcase: {
    soldiers: [['raider', 'rifle', 1.6, 5.4, -0.15], ['heavy', 'rifle', -0.6, 4.4, 0.3], ['night', 'sniper', 3.4, 4.0, -0.5]],
    cam: [-1.2, 2.3, 15.8], look: [1.4, 1.7, 3.4],
  },
  birds: [0, 27, 0],

  build({ flags }) {
    desertFloor();

    // the ridge round the outskirts keeps everyone on the map
    for (const [x, z, w, d] of [[0, -48, 100, 4], [0, 48, 100, 4], [-48, 0, 4, 100], [48, 0, 4, 100]]) block(x, z, w, d, 9, MAT.rock, { surface: 'stone', tile: 5 });

    // broken mud-brick wall: four street entries and four breaches
    villageWall([[-38.5, -23], [-17, -4.5], [4.5, 38.5]], -38, true);
    villageWall([[-38.5, -4.5], [4.5, 20], [27, 38.5]], 38, true);
    villageWall([[-37.5, -4.5], [4.5, 17], [23, 37.5]], -38, false);
    villageWall([[-37.5, -25], [-19, -4.5], [4.5, 37.5]], 38, false);
    arch(0, -38, true);
    flags.push(new THREE.Vector3(0, 6.0, -38));

    // well square
    well(0, 0);
    brazier(-6, -6); brazier(6, 6);
    lampPost(-7.2, 3.6, 2.03); lampPost(7.2, -3.6, -1.11);
    // checkpoint at the north entry: an abandoned lorry and concrete barriers form a chicane
    truck(2.2, -29.5, 0.08, 81);
    barrier(-2.8, -34.2, 2.4, true);
    sandbags(-5.2, -8.5, 3, 1.1); sandbags(5.2, 8.5, 3, 1.1);

    // north-west: the mosque and its minaret
    mosque(-21, -19, 12, 10, 6.5);
    minaret(-12, -27, 13);
    house(-31, -8, 7, 7, 5, 'E', 31, true);
    ruin(-31, -31, 8, 7, 4.5, 'E', 32);
    house(-10, -12, 6, 6, 4.5, 'W', 33, false);
    sandbags(-8, -20, 1.1, 4);
    // the old cemetery west of the mosque: low headstones you can step over, a low wall to crouch behind
    for (const z of [-23, -20, -17]) for (const x of [-34, -32.5, -31, -29.6]) {
      addDeco(boxGeo(0.42, 0.12, 1.3, 1), MAT.mud, _m.makeTranslation(x, 0.06, z + 0.55));
      addDeco(new THREE.BoxGeometry(0.38, 0.42, 0.1), MAT.stone, _m.makeRotationY(x * 0.3 + z).setPosition(x, 0.21, z));
      addCollider(x - 0.2, 0, z - 0.06, x + 0.2, 0.42, z + 0.06);
    }
    mudWall(-28.2, -22.8, 0.4, 5.4, 0.62); mudWall(-28.2, -14.2, 0.4, 3.2, 0.62);
    palm(-35, -25.5, 5.6, 91);
    crate(-16, -8); crate(-17.4, -8); crate(-16, -8, 1.4);

    // north-east: the old market
    house(12, -29, 10, 8, 6, 'S', 41, true);
    house(24, -28, 8, 8, 5.5, 'S', 42, false);
    for (const x of [10, 15, 20, 25]) stall(x, -21.5);
    lampPost(7.5, -19.4, 0); lampPost(17.5, -19.4, 0); lampPost(27.8, -19.4, 0);
    stringLights([7.5, 2.95, -19.4], [17.5, 2.95, -19.4], 12, 0.45);
    stringLights([17.5, 2.95, -19.4], [27.8, 2.95, -19.4], 12, 0.45);
    carpet(9.3, 3.05, -24.94, 0, 1.3, 2); carpet(14.8, 3.05, -24.94, 0, 1.2, 1.8);
    jars(26.8, -23.3, 5, 11); jars(-14.2, -13.5, 4, 17);
    // an outside stair climbs to this roof: it looks down the east street and over the well square
    house(13, -9, 9, 6, 5, 'N', 43, false, { stairs: { face: 'S', dir: 1 } });
    house(27, -9, 10, 6, 6.5, 'N', 44, true);
    waterTower(32, -32, 10);
    flags.push(new THREE.Vector3(34.6, 10.4, -34.6));
    sandbags(6, -14, 1.1, 4);
    crate(31, -17); crate(32.4, -17); crate(31, -17, 1.4);

    // south-west: the ruined quarter and the watchtower
    ruin(-11, 11, 7, 7, 4.5, 'W', 21);
    ruin(-25, 10, 8, 6, 5, 'E', 22);
    ruin(-11, 26, 8, 8, 4, 'N', 23);
    house(-26, 25, 7, 8, 5, 'E', 24, false);
    watchtower(-32, 32, 9);
    flags.push(new THREE.Vector3(-33.6, 9, 33.6));
    for (const [x, z, s] of [[-20, 31, 1.0], [-6, 18, 0.8], [-19, 5, 0.9], [-33, 17, 1.1]]) rock(x, z, s, Math.floor(x * 5 + z * 11));
    crate(-20, 23); crate(-20, 24.4);

    // south-east: the walled palm orchard and the farmhouse
    mudWall(11, 12, 12, 0.5); mudWall(27.5, 12, 9, 0.5);
    mudWall(18, 25, 0.5, 18); mudWall(9.5, 24, 9, 0.5);
    for (const [x, z] of [[9, 9], [15, 9], [21, 9], [27, 9], [33, 9], [9, 15], [15, 15], [21, 15], [27, 15], [33, 15], [9, 21], [15, 21], [21, 21], [9, 27], [15, 27], [21, 27], [9, 33], [15, 33], [21, 33]]) palm(x + rand(-0.4, 0.4), z + rand(-0.4, 0.4), rand(5.4, 7.6), x * 3 + z * 7);
    block(12, 18, 3, 1.6, 0.6, MAT.stone, { surface: 'stone' });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.2), MAT.water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(12, 0.61, 18);
    worldRoot.add(pool);
    house(29, 29, 9, 8, 8, 'N', 51, true);

    // burned-out cars on the streets
    car(1.6, -20, 0.2, 61); car(-21, -1.5, Math.PI / 2 + 0.15, 62); car(20, 1.4, Math.PI / 2 - 0.2, 63); car(-1.5, 21, Math.PI - 0.1, 64); car(-18, 17, 0.25, 65);

    // outskirts
    for (const [x, z, s] of [[-12, -42, 1.4], [12, -42.5, 1.6], [-42, -14, 1.5], [-42, 12, 1.3], [42, 14, 1.5], [42, -10, 1.4], [-14, 42, 1.6], [14, 42, 1.3], [-30, -42, 1.8], [32, 42, 1.7]]) rock(x, z, s, Math.floor(x * 7 + z * 13));
    for (const [x, z] of [[-8, -41], [8, -41.5], [-41, 8], [41, -6], [10, 41]]) crate(x, z, 0, 1.2);
    // the invaders' banners where they gather (their own fictional emblem)
    for (const [x, z, r] of [[-9, -45, 0], [9, -45.3, 0], [-45, 9, Math.PI / 2], [-45.2, -14, Math.PI / 2], [45.3, -15, -Math.PI / 2], [45, 10, -Math.PI / 2], [8, 45, Math.PI]]) banner(x, z, r);

    horizonDunes(22);
  },
};
