import * as THREE from 'three';
import { CANNON, world, G, cv, nadeMaterial } from '../core/physics.js';
import { clamp, rand } from '../core/utils.js';
import { scene, camera } from '../core/renderer.js';
import { grenades } from '../core/state.js';
import { GRENADE } from '../config/balance.js';
import { std } from '../assets/materials.js';
import { explode } from '../fx/explosions.js';
import { sfx } from '../audio/sfx.js';
import { player } from '../entities/player.js';
import { inv, busy } from './arsenal.js';
import { waveCfg } from '../entities/enemy.js';
import { updateAmmoHUD, showMsg } from '../ui/hud.js';

/*
 * Frag grenades. Hold the key to cook (the fuse keeps burning in your hand), release to throw.
 * Raider grenades use the same physics and raise a directional warning on the HUD.
 */

export const playerNade = { cooking: false, cookT: 0, throwT: 0, thrown: false, fuse: GRENADE.fuse };
const geo = new THREE.SphereGeometry(0.05, 12, 8);
let mat = null;

export function nadeDown() {
  if (inv.nades <= 0) { showMsg('لا قنابل لديك', 900); return; }
  if (playerNade.cooking || busy() || !player.alive) return;
  playerNade.cooking = true;
  playerNade.cookT = 0;
  sfx.pin();
}
export function nadeUp() {
  if (!playerNade.cooking) return;
  playerNade.cooking = false;
  playerNade.fuse = Math.max(0.35, GRENADE.fuse - playerNade.cookT);
  playerNade.throwT = 0.5;
  playerNade.thrown = false;
  inv.nades--;
  updateAmmoHUD(true);
}
export function resetGrenades() {
  Object.assign(playerNade, { cooking: false, cookT: 0, throwT: 0, thrown: false });
  for (const g of grenades) { world.removeBody(g.b); scene.remove(g.m); }
  grenades.length = 0;
}

function spawn(pos, vel, fuse, hostile) {
  if (!mat) mat = std({ color: 0x5c6440, roughness: 0.6, metalness: 0.2 });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  const b = new CANNON.Body({ mass: 0.45, shape: new CANNON.Sphere(0.05), position: cv(pos), material: nadeMaterial, linearDamping: 0.08, angularDamping: 0.3, collisionFilterGroup: G.NADE, collisionFilterMask: G.STATIC | G.PROP | G.RAG });
  b.velocity.set(vel.x, vel.y, vel.z);
  b.angularVelocity.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
  let last = 0;
  b.addEventListener('collide', (e) => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 1.8 && performance.now() - last > 90) { last = performance.now(); sfx.bounce(b.position); }
  });
  world.addBody(b);
  scene.add(m);
  grenades.push({ m, b, fuse, hostile, warned: false });
}

function throwPlayer() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const p = camera.position.clone().addScaledVector(f, 0.5).add(new THREE.Vector3(0, -0.1, 0));
  spawn(p, new THREE.Vector3(f.x * 15 + player.vel.x, f.y * 15 + 3.6 + player.vel.y * 0.5, f.z * 15 + player.vel.z), playerNade.fuse, false);
  sfx.whoosh();
}
/** Lob toward `target` on a ballistic arc. */
export function throwEnemyGrenade(from, target) {
  const d = new THREE.Vector3().subVectors(target, from);
  const horiz = Math.hypot(d.x, d.z), T = clamp(horiz / 13, 0.8, 1.6);
  const vel = new THREE.Vector3(d.x / T, (d.y + 0.5 * 9.82 * T * T) / T, d.z / T);
  spawn(from, vel, 2.6, true);
}

/** Hostile grenades near the player, for the HUD warning ring. */
export const nadeThreats = [];
export function updateGrenades(dt) {
  const pn = playerNade;
  if (pn.cooking) {
    pn.cookT += dt;
    if (pn.cookT >= GRENADE.fuse) {
      pn.cooking = false;
      inv.nades--;
      updateAmmoHUD(true);
      explode(player.pos.clone().setY(player.pos.y + 1), GRENADE.radius, GRENADE.damage, 'nade');
    }
  }
  if (pn.throwT > 0) {
    pn.throwT -= dt;
    if (!pn.thrown && pn.throwT < 0.25) { pn.thrown = true; throwPlayer(); }
  }
  nadeThreats.length = 0;
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.m.position.copy(g.b.position);
    g.m.quaternion.copy(g.b.quaternion);
    if (g.hostile) {
      const dist = g.m.position.distanceTo(player.pos);
      if (dist < 12) {
        nadeThreats.push(g.m.position);
        if (!g.warned) { g.warned = true; sfx.nadeWarn(); }
      }
    }
    if (g.fuse <= 0) {
      const at = g.m.position.clone();
      world.removeBody(g.b); scene.remove(g.m); grenades.splice(i, 1);
      explode(at, GRENADE.radius, g.hostile ? 150 * waveCfg.dmg : GRENADE.damage, g.hostile ? 'enemyNade' : 'nade');
    }
  }
}
