import * as THREE from 'three';
import { TAU, rand } from '../../core/utils.js';
import { MAT } from '../../assets/materials.js';
import { worldRoot, block, boxGeo, scaleUV, addDeco, addCollider, house, crate, sandbags, arch, palm, rock, stall, brazier, truck, barrier, planter, lampPost, stringLights, jars, carpet, banner } from '../builder.js';
import { desertFloor, horizonDunes } from './common.js';

/*
 * Qasr al-Rimal (قصر الرمال): a walled citadel of 72 × 72 m inside a 92 × 92 m playable area.
 * North is -Z. Gates face north, west and east, and a shell has opened a breach in the east wall;
 * raiders gather under their banners outside them. Mid-range fights across a fountain courtyard,
 * with sniper nests on the four corner towers. Inside: a guard post by the north gate whose roof
 * you can climb to, a wrecked lorry in each yard, and an arcaded market strung with lights.
 */

const Z = (name, x0, x1, z0, z1) => ({ name, x0, x1, z0, z1 });

export default {
  id: 'citadel',
  name: 'قصر الرمال',
  spawns: [[-6, -42], [0, -43], [6, -42], [-42, -5], [-43, 0], [-42, 5], [42, -5], [43, 0], [42, 5], [43, 19.5]],
  hover: [[0, -22], [-20, 2], [20, -2], [0, 14]],
  // sniper nests on the corner towers, stepped in toward the courtyard so they can see it
  snipers: [[-34.2, 10, -34.2], [34.2, 10, -34.2], [-34.2, 10, 34.2], [34.2, 10, 34.2]],
  start: [0, 9], startYaw: 0,
  // inside the walls, clear of the wall thickness: supplies are only ever dropped in here
  interior: (x, z) => Math.abs(x) < 33.5 && Math.abs(z) < 33.5,
  dropFallback: [0, 10],
  zoneFallback: 'قصر الرمال',
  zones: [
    Z('مخفر البوابة', 7, 15.5, -33.5, -26.5),
    Z('الثغرة الشرقية', 29.5, 40, 15, 24),
    Z('البوابة الشمالية', -8, 8, -38, -30),
    Z('البوابة الغربية', -38, -29, -6, 6),
    Z('البوابة الشرقية', 29, 38, -6, 6),
    Z('النافورة', -6, 6, -6, 6),
    Z('السوق', -12, 12, 19, 26),
    Z('القاعة الجنوبية', -10, 10, 26, 35),
    Z('الساحة الشمالية', -14, 14, -30, -6),
    Z('الساحة الجنوبية', -14, 14, 6, 19),
    Z('البرج الشمالي الغربي', -36, -26, -36, -26),
    Z('البرج الشمالي الشرقي', 26, 36, -36, -26),
    Z('البرج الجنوبي الغربي', -36, -26, 26, 36),
    Z('البرج الجنوبي الشرقي', 26, 36, 26, 36),
    Z('الحي الغربي', -36, -14, -36, 36),
    Z('الحي الشرقي', 14, 36, -36, 36),
    Z('الصحراء شمال الأسوار', -48, 48, -48, -36),
    Z('الصحراء جنوب الأسوار', -48, 48, 36, 48),
    Z('الصحراء غرب الأسوار', -48, -36, -48, 48),
    Z('الصحراء شرق الأسوار', 36, 48, -48, 48),
  ],
  labels: [{ t: 'البوابة الشمالية', x: 0, z: -40.5, r: 0 }, { t: 'البوابة الغربية', x: -40.5, z: 0, r: -Math.PI / 2 }, { t: 'البوابة الشرقية', x: 40.5, z: 0, r: Math.PI / 2 }],
  props: {
    crate: [[-12, -3], [12, 3], [-3, 12], [3, -12], [-21, -12], [21, 12], [-31, 14], [31, -14], [-10, 30], [11, 31], [30, 30], [-30, -30]],
    xbarrel: [[-12.3, -9.0], [12.3, 9.0], [-18, 10], [18, -10], [-2, -33], [-33, 2], [33, -2], [0, 20], [-28, -16], [28, 16]],
    barrel: [[-12.4, 1.2], [12.4, -1.2], [-15, -20], [16, 20], [-5, 16.5], [6, -17], [31, 31.5], [-31, -31.5]],
  },
  // menu backdrop: three raiders in front of the fountain, seen from the south courtyard
  showcase: {
    soldiers: [['raider', 'rifle', 1.6, 6.2, -0.15], ['heavy', 'rifle', -0.6, 5.2, 0.3], ['night', 'sniper', 3.4, 4.8, -0.5]],
    cam: [-1.2, 2.3, 16.5], look: [1.4, 1.7, 4.2],
  },
  birds: [0, 27, 0],

  build({ flags }) {
    desertFloor();

    // outer cliffs keep everyone on the map
    for (const [x, z, w, d] of [[0, -48, 100, 4], [0, 48, 100, 4], [-48, 0, 4, 100], [48, 0, 4, 100]]) block(x, z, w, d, 9, MAT.rock, { surface: 'stone', tile: 5 });

    // citadel walls with three gates
    const H = 7, T = 2, R0 = 36, m0 = new THREE.Matrix4();
    const wallSeg = (x, z, w, d) => {
      block(x, z, w, d, H, MAT.stone, { tile: 4, surface: 'stone' });
      const along = w > d, len = along ? w : d;
      const m = new THREE.Matrix4();
      for (let s = -len / 2 + 0.6; s < len / 2 - 0.4; s += 2) addDeco(boxGeo(along ? 1 : T + 0.2, 0.9, along ? T + 0.2 : 1, 2), MAT.stone, m.makeTranslation(along ? x + s : x, H + 0.45, along ? z : z + s));
    };
    wallSeg(-20.5, -R0, 35, T); wallSeg(20.5, -R0, 35, T);
    wallSeg(0, R0, 74, T);
    wallSeg(-R0, -20.5, T, 35); wallSeg(-R0, 20.5, T, 35);
    // the east wall is breached south of the gate: rubble spills both ways through a 4 m gap
    wallSeg(R0, -20.5, T, 35); wallSeg(R0, 10.25, T, 14.5); wallSeg(R0, 29.75, T, 16.5);
    for (const [x, z, s2] of [[34.2, 18.2, 0.5], [35.4, 20.6, 0.6], [37.6, 18.8, 0.55], [36.4, 21.3, 0.45], [33.8, 20.9, 0.4], [38.4, 20.2, 0.5]]) {
      const g = new THREE.DodecahedronGeometry(s2, 0); g.scale(1, 0.55, 1);
      addDeco(g, MAT.stone, m0.makeRotationY(x * 3).setPosition(x, 0.12, z));
    }
    for (const [x, z] of [[35, 16.9], [35, 22.1]]) { const g = new THREE.BoxGeometry(2.2, 0.35, 0.9); addDeco(g, MAT.stone, m0.makeRotationY(0.4).setPosition(x, 0.17, z)); }
    for (const [x, z, alongX] of [[0, -R0, true], [-R0, 0, false], [R0, 0, false]]) {
      block(x, z, alongX ? 6 : T, alongX ? T : 6, 2.2, MAT.stone, { y0: 4.8, surface: 'stone' });
      for (const s of [-3.6, 3.6]) block(alongX ? x + s : x, alongX ? z : z + s, alongX ? 1.2 : 2.8, alongX ? 2.8 : 1.2, 7.8, MAT.stone, { surface: 'stone' });
    }
    flags.push(new THREE.Vector3(0, 7.0, -R0));   // on the gate lintel
    // heavy gate doors swung open against the inside of the wall
    for (const [x, z, alongX] of [[0, -R0 + 1.12, true], [-R0 + 1.12, 0, false], [R0 - 1.12, 0, false]]) {
      for (const s2 of [-1, 1]) {
        const cx = alongX ? x + s2 * 5.6 : x, cz = alongX ? z : z + s2 * 5.6;
        block(cx, cz, alongX ? 2.8 : 0.22, alongX ? 0.22 : 2.8, 4.6, MAT.planks, { surface: 'wood', tile: 1.4 });
        for (const y of [0.9, 2.3, 3.7]) addDeco(new THREE.BoxGeometry(alongX ? 2.9 : 0.1, 0.14, alongX ? 0.1 : 2.9), MAT.darkMetal, m0.makeTranslation(cx + (alongX ? 0 : Math.sign(x) * -0.14), y, cz + (alongX ? 0.14 : 0)));
      }
      // lamp posts either side of each gateway (glow only)
      for (const s2 of [-1, 1]) lampPost(alongX ? x + s2 * 4.6 : x + Math.sign(-x) * 2.4, alongX ? z + 2.4 : z + s2 * 4.6, alongX ? 0 : Math.sign(-x) * Math.PI / 2);
    }
    const m = new THREE.Matrix4();
    for (const [x, z] of [[-R0, -R0], [R0, -R0], [-R0, R0], [R0, R0]]) {
      block(x, z, 6.4, 6.4, 10, MAT.stone, { geo: scaleUV(new THREE.CylinderGeometry(3.2, 3.5, 10, 16), 5, 2.5), surface: 'stone' });
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU;
        addDeco(new THREE.BoxGeometry(1, 0.9, 0.7), MAT.stone, m.makeRotationY(-a).setPosition(x + Math.cos(a) * 3, 10.45, z + Math.sin(a) * 3));
      }
      flags.push(new THREE.Vector3(x + Math.sign(x) * 2.0, 10, z + Math.sign(z) * 2.0));
    }

    // houses: x, z, w, d, h, door side, seed, lantern
    house(-23, -23, 12, 10, 7, 'E', 1, true);
    house(23, -24, 12, 9, 6, 'W', 2, false);
    house(-24, 23, 11, 11, 8, 'E', 3, false);
    block(-25.5, 21.5, 4.5, 4.5, 3.5, MAT.plaster, { y0: 8, surface: 'plaster' });
    house(24, 23, 10, 12, 7, 'W', 4, true);
    house(0, 28, 16, 6, 6, 'N', 5, true);
    house(-27, 6, 7, 9, 5.5, 'E', 6, false);
    house(27, -6, 7, 9, 5.5, 'W', 7, true);

    arch(0, -15, true); arch(-15, 0, false); arch(15, 0, false);

    // fountain
    block(0, 0, 5.4, 5.4, 0.8, MAT.stone, { geo: new THREE.CylinderGeometry(2.6, 2.8, 0.8, 8), surface: 'stone' });
    const water = new THREE.Mesh(new THREE.CircleGeometry(2.35, 8), MAT.water);
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = Math.PI / 8;
    water.position.y = 0.72;
    worldRoot.add(water);
    block(0, 0, 0.8, 0.8, 1.9, MAT.stone, { geo: new THREE.CylinderGeometry(0.3, 0.45, 1.9, 8), surface: 'stone' });
    addDeco(new THREE.CylinderGeometry(0.9, 0.4, 0.3, 12), MAT.stone, m.makeTranslation(0, 1.95, 0));

    for (const [x, z, s] of [[-7.5, -7.5, 11], [7.5, -7.5, 12], [-7.5, 7.5, 13], [7.5, 7.5, 14]]) palm(x, z, rand(6.2, 7.6), s);
    brazier(-4.5, 4.5); brazier(4.5, -4.5);

    sandbags(-9, -10, 5, 1.1); sandbags(9, 10, 5, 1.1);
    sandbags(10, -10, 1.1, 4.5); sandbags(-10, 10, 1.1, 4.5);
    sandbags(0, -29, 6, 1.1); sandbags(-29, -6, 1.1, 5); sandbags(29, 6, 1.1, 5);
    // chicanes of concrete barriers inside each gate
    barrier(-4.8, -31.2, 3, true); barrier(4.8, -31.2, 3, true);
    barrier(-31.2, 4.8, 3, false); barrier(31.2, -4.8, 3, false);

    // guard post by the north gate: an outside stair climbs to its roof, which overlooks the gate and the north yard
    house(11, -30.5, 7, 4.5, 3.4, 'W', 8, false, { stairs: { face: 'S', dir: -1 } });
    sandbags(11, -26.2, 3.4, 1.1);
    // wrecked lorries: big cover in the north yard and the east quarter
    truck(-8, -24, 0.25, 71);
    truck(21, 8, Math.PI / 2 - 0.05, 72, true);
    // low planters round the fountain (step over them), benches of stone between
    planter(0, 5.3, 3, 0.8); planter(0, -5.3, 3, 0.8); planter(5.3, 0, 0.8, 3); planter(-5.3, 0, 0.8, 3);
    sandbags(-19, 13.5, 4, 1.1);

    for (const [x, z, y] of [[-17, -17, 0], [-15.5, -17, 0], [-17, -15.5, 0], [-17, -17, 1.4], [17, 16, 0], [18.5, 16, 0], [17, 17.5, 0],
      [-16, 16, 0], [-16, 17.5, 0], [-16, 16, 1.4], [16, -17, 0], [17.5, -17, 0], [16, -17, 1.4], [5, -22, 0], [6.5, -22, 0], [-7, 21.5, 0]]) crate(x, z, y);
    stall(-5, 23.2); stall(5, 23.2);
    // the market arcade in front of the south hall, lanterns strung across the square
    for (const x of [-7.2, -4.3, -1.4, 1.4, 4.3, 7.2]) block(x, 24.55, 0.45, 0.45, 3.2, MAT.stone, { surface: 'stone' });
    block(0, 24.75, 15.4, 1.1, 0.3, MAT.planks, { y0: 3.2, surface: 'wood', tile: 1.5 });
    addDeco(boxGeo(15.8, 0.12, 1.4, 2), MAT.stone, m0.makeTranslation(0, 3.56, 24.75));
    carpet(-5.8, 3.0, 24.94, Math.PI, 1.3, 2.1); carpet(5.8, 3.0, 24.94, Math.PI, 1.3, 2.1); carpet(2.9, 2.9, 24.94, Math.PI, 1.1, 1.7);
    lampPost(-9.5, 19.4, Math.PI); lampPost(9.5, 19.4, Math.PI);
    stringLights([-7.2, 3.15, 24.3], [-9.5, 2.95, 19.6], 8, 0.35);
    stringLights([7.2, 3.15, 24.3], [9.5, 2.95, 19.6], 8, 0.35);
    stringLights([-9.5, 2.95, 19.6], [9.5, 2.95, 19.6], 18, 0.8);
    jars(-2.6, 22.2, 5, 3); jars(10.8, 22.3, 4, 9); jars(-26.5, 12, 4, 13);

    // approach zone outside the gates
    for (const [x, z, s] of [[-9, -41, 1.3], [9, -41.5, 1.5], [-41, -9, 1.4], [-41.5, 10, 1.2], [41, 9, 1.4], [41.5, -9, 1.3], [-20, -42, 1.8], [20, -42, 1.6], [-42, 22, 1.7], [42, -22, 1.8]]) rock(x, z, s, Math.floor(x * 7 + z * 13));
    for (const [x, z] of [[-3, -40], [4, -42.5], [-40, 3], [40, -3]]) crate(x, z, 0, 1.2);
    // the invaders' banners where they gather to attack (their own fictional emblem)
    for (const [x, z, r] of [[-9.5, -44, 0], [9.5, -44, 0], [-44, -9.5, Math.PI / 2], [-44, 9.5, Math.PI / 2], [44, -9.5, -Math.PI / 2], [44, 9.5, -Math.PI / 2], [44.2, 25, -Math.PI / 2]]) banner(x, z, r);

    horizonDunes(22);
  },
};

