import * as THREE from 'three';
import { CANNON, world, G, cv } from '../core/physics.js';
import { rand } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { ragdolls, debris } from '../core/state.js';
import { settings } from '../config/settings.js';
import { supportHeight } from '../world/collision.js';
import { bloodPool } from '../fx/decals.js';

/* Turns a posed soldier into linked rigid bodies when he dies. */

export const SEG_ORDER = ['torso', 'head', 'uArmL', 'lArmL', 'uArmR', 'lArmR', 'thighL', 'shinL', 'thighR', 'shinR'];
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
const MAX_RAGDOLLS = 8;

export function makeRagdoll(ch, impulse, hitPart, hitPoint) {
  ch.root.updateMatrixWorld(true);
  const parts = {};
  for (const key of SEG_ORDER) {
    const s = ch.segs[key];
    s.group.getWorldPosition(_p);
    s.group.getWorldQuaternion(_q);
    _c.set(0, s.dir * s.len / 2, 0).applyQuaternion(_q).add(_p);
    const body = new CANNON.Body({
      mass: s.mass, shape: s.makeShape(),
      position: new CANNON.Vec3(_c.x, _c.y, _c.z),
      quaternion: new CANNON.Quaternion(_q.x, _q.y, _q.z, _q.w),
      linearDamping: 0.06, angularDamping: 0.4,
      collisionFilterGroup: G.RAG, collisionFilterMask: G.STATIC | G.PROP | G.NADE,
      sleepSpeedLimit: 0.25, sleepTimeLimit: 0.8,
    });
    body.velocity.set(ch.vel.x, ch.vel.y || 0, ch.vel.z);
    world.addBody(body);
    parts[key] = { seg: s, body };
  }
  const constraints = [];
  for (const key of SEG_ORDER) {
    const s = ch.segs[key];
    if (!s.parent) continue;
    const A = parts[s.parent].body, B = parts[key].body;
    s.group.getWorldPosition(_p);
    const c = new CANNON.ConeTwistConstraint(A, B, {
      pivotA: A.pointToLocalFrame(cv(_p)),
      pivotB: new CANNON.Vec3(0, -s.dir * s.len / 2, 0),
      axisA: A.vectorToLocalFrame(B.quaternion.vmult(new CANNON.Vec3(0, 1, 0))),
      axisB: new CANNON.Vec3(0, 1, 0),
      angle: s.cone, twistAngle: s.twist, collideConnected: false,
    });
    world.addConstraint(c);
    constraints.push(c);
  }
  for (const key of SEG_ORDER) {
    const s = ch.segs[key];
    scene.attach(s.group);
    for (const hb of s.hitboxes) hb.userData.ragBody = parts[key].body;
  }
  const hp = parts[hitPart] || parts.torso;
  hp.body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
    new CANNON.Vec3(hitPoint.x - hp.body.position.x, hitPoint.y - hp.body.position.y, hitPoint.z - hp.body.position.z));
  parts.torso.body.applyImpulse(new CANNON.Vec3(impulse.x * 0.35, impulse.y * 0.2, impulse.z * 0.35));
  // the rifle falls out of his hands as its own rigid body
  if (ch.rifle) {
    scene.attach(ch.rifle);
    ch.rifle.getWorldPosition(_p);
    const rb = new CANNON.Body({
      mass: 3.5, shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.09, 0.45)), position: cv(_p),
      quaternion: new CANNON.Quaternion().copy(ch.rifle.quaternion),
      collisionFilterGroup: G.PROP, collisionFilterMask: G.STATIC | G.PROP,
    });
    rb.velocity.set(impulse.x * 0.03 + rand(-1, 1), 1.5, impulse.z * 0.03 + rand(-1, 1));
    rb.angularVelocity.set(rand(-4, 4), rand(-4, 4), rand(-4, 4));
    world.addBody(rb);
    debris.push({ mesh: ch.rifle, body: rb, t: 0, life: 26 });
  }
  const rag = { parts, constraints, t: 0, pooled: false, ch };
  ragdolls.push(rag);
  if (ragdolls.length > MAX_RAGDOLLS) removeRagdoll(ragdolls[0]);
  return rag;
}
export function removeRagdoll(r) {
  for (const c of r.constraints) world.removeConstraint(c);
  for (const key of SEG_ORDER) { world.removeBody(r.parts[key].body); scene.remove(r.parts[key].seg.group); }
  const i = ragdolls.indexOf(r);
  if (i >= 0) ragdolls.splice(i, 1);
}
export function clearRagdolls() { while (ragdolls.length) removeRagdoll(ragdolls[0]); }

export function explodeRagdolls(center, radius, power) {
  for (const r of ragdolls) {
    for (const key of SEG_ORDER) {
      const b = r.parts[key].body;
      const d = _p.set(b.position.x - center.x, b.position.y - center.y + 0.4, b.position.z - center.z);
      const dist = d.length();
      if (dist > radius) continue;
      b.wakeUp();
      d.normalize().multiplyScalar(power * (1 - dist / radius) * b.mass * 0.35);
      b.applyImpulse(new CANNON.Vec3(d.x, d.y + power * 0.1 * b.mass * 0.35, d.z));
    }
  }
}

export function updateRagdolls(dt) {
  for (let i = ragdolls.length - 1; i >= 0; i--) {
    const r = ragdolls[i];
    r.t += dt;
    const sink = r.t > 26 ? (r.t - 26) * 0.25 : 0;
    for (const key of SEG_ORDER) {
      const { seg, body } = r.parts[key];
      seg.group.quaternion.copy(body.quaternion);
      _p.set(0, seg.dir * seg.len / 2, 0).applyQuaternion(seg.group.quaternion);
      seg.group.position.set(body.position.x - _p.x, body.position.y - _p.y - sink, body.position.z - _p.z);
    }
    const tb = r.parts.torso.body;
    if (!r.pooled && r.t > 1.4 && tb.velocity.length() < 0.35) {
      r.pooled = true;
      if (settings.blood) bloodPool(tb.position.x, tb.position.z, supportHeight(tb.position.x, tb.position.z, tb.position.y));
    }
    if (r.t > 29) removeRagdoll(r);
  }
}
