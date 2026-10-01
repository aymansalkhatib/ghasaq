import * as THREE from 'three';
import { CANNON, world, G } from '../core/physics.js';
import { TAU, rand } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { props, debris, run } from '../core/state.js';
import { MAT } from '../assets/materials.js';
import { fx } from '../fx/particles.js';
import { sfx } from '../audio/sfx.js';
import { explode } from '../fx/explosions.js';
import { MAP_INFO } from './map.js';

/* Physics props (small crates, barrels), crate splinters and other loose debris. */

const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20);
const smallCrateGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
const plankGeo = new THREE.BoxGeometry(0.78, 0.1, 0.05);
const _v = new THREE.Vector3();

export function addProp(kind, x, z, y = 0) {
  let mesh, shape, mass, hp;
  if (kind === 'crate') {
    mesh = new THREE.Mesh(smallCrateGeo, MAT.crate);
    shape = new CANNON.Box(new CANNON.Vec3(0.4, 0.4, 0.4));
    mass = 16; hp = 70; y += 0.4;
  } else {
    const explosive = kind === 'xbarrel';
    mesh = new THREE.Mesh(barrelGeo, explosive ? MAT.barrelRed : (Math.random() < 0.5 ? MAT.barrelOlive : MAT.barrelBlue));
    shape = new CANNON.Cylinder(0.3, 0.3, 0.9, 12);
    mass = explosive ? 28 : 40; hp = explosive ? 30 : Infinity; y += 0.45;
  }
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.surface = kind === 'crate' ? 'wood' : 'metal';
  const body = new CANNON.Body({
    mass, shape, position: new CANNON.Vec3(x, y, z), linearDamping: 0.05, angularDamping: 0.15,
    collisionFilterGroup: G.PROP, collisionFilterMask: G.STATIC | G.PROP | G.RAG | G.ACTOR | G.NADE,
    sleepSpeedLimit: 0.2, sleepTimeLimit: 0.5,
  });
  body.quaternion.setFromEuler(0, Math.random() * TAU, 0);
  world.addBody(body);
  const prop = { kind, mesh, body, hp, alive: true, fuse: -1 };
  mesh.userData.prop = prop;
  mesh.position.copy(body.position);
  mesh.quaternion.copy(body.quaternion);
  props.push(prop);
  scene.add(mesh);
  return prop;
}
/** Loose crates and barrels, at the positions the current map lists. */
export function placeProps() {
  const P = MAP_INFO.props;
  for (const kind of ['crate', 'xbarrel', 'barrel']) for (const [x, z] of P[kind] || []) addProp(kind, x, z);
}
export function removeProp(p) {
  p.alive = false;
  world.removeBody(p.body);
  scene.remove(p.mesh);
  const i = props.indexOf(p);
  if (i >= 0) props.splice(i, 1);
}
export function resetProps() {
  for (const p of props.slice()) removeProp(p);
  for (const d of debris) { world.removeBody(d.body); scene.remove(d.mesh); }
  debris.length = 0;
  placeProps();
}

export function addDebris(mesh, body, life) {
  world.addBody(body);
  scene.add(mesh);
  mesh.castShadow = true;
  debris.push({ mesh, body, t: 0, life });
}
export function breakCrate(p, dir) {
  const c = p.body.position;
  removeProp(p);
  for (let k = 0; k < 7; k++) {
    const b = new CANNON.Body({
      mass: 1.2, shape: new CANNON.Box(new CANNON.Vec3(0.39, 0.05, 0.025)),
      position: new CANNON.Vec3(c.x + rand(-0.3, 0.3), c.y + rand(-0.3, 0.3), c.z + rand(-0.3, 0.3)),
      collisionFilterGroup: G.PROP, collisionFilterMask: G.STATIC | G.PROP | G.RAG, angularDamping: 0.2,
    });
    b.quaternion.setFromEuler(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    b.velocity.set(dir.x * 4 + rand(-3, 3), rand(1.5, 5), dir.z * 4 + rand(-3, 3));
    b.angularVelocity.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    addDebris(new THREE.Mesh(plankGeo, MAT.planks), b, 14);
  }
  fx.burstDust(c.x, c.y, c.z, 0.55, 0.42, 0.28, 26, 3.5);
  sfx.impact('wood', _v.set(c.x, c.y, c.z), 1.4);
  sfx.crateBreak(_v);
}
export function damageProp(p, dmg, point, dir, force) {
  if (!p.alive) return;
  p.body.wakeUp();
  p.body.applyImpulse(new CANNON.Vec3(dir.x * force, dir.y * force, dir.z * force),
    new CANNON.Vec3(point.x - p.body.position.x, point.y - p.body.position.y, point.z - p.body.position.z));
  if (p.kind === 'crate') {
    p.hp -= dmg;
    if (p.hp <= 0) breakCrate(p, dir);
  } else if (p.kind === 'xbarrel' && p.fuse < 0) {
    p.hp -= dmg;
    if (p.hp <= 0) { p.fuse = 0.12; sfx.barrelHiss(point); }
    else fx.fire(point.x, point.y, point.z, 4);
  }
}

export function updateProps(dt) {
  for (const p of props.slice()) {
    p.mesh.position.copy(p.body.position);
    p.mesh.quaternion.copy(p.body.quaternion);
    if (p.fuse >= 0) {
      p.fuse -= dt;
      if (p.fuse < 0) {
        const at = new THREE.Vector3().copy(p.body.position);
        removeProp(p);
        run.barrels++;
        explode(at, 7.5, 160, 'barrel');
      }
    }
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.t += dt;
    d.mesh.position.copy(d.body.position);
    d.mesh.quaternion.copy(d.body.quaternion);
    if (d.t > d.life) { world.removeBody(d.body); scene.remove(d.mesh); debris.splice(i, 1); }
  }
}
