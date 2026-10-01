import * as THREE from 'three';
import { TAU, rand } from '../core/utils.js';
import { scene, camera } from '../core/renderer.js';
import { aircraft } from '../core/state.js';
import { supportHeight } from '../world/collision.js';
import { makeLoop } from '../audio/engine.js';
import { sfx } from '../audio/sfx.js';
import { fx } from '../fx/particles.js';
import { explode } from '../fx/explosions.js';
import { player } from '../entities/player.js';
import { buildTransport, buildJet, buildUAV, buildBomb } from './models.js';

/* Scripted flights: transport drops, the air-strike jet, and the recon drone. */

const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** A four-engine transport crosses over `target` and calls onDrop(pos) right above it (the chute steers the rest). */
export function flyTransport(target, onDrop) {
  const m = buildTransport();
  scene.add(m.g);
  const a = rand(0, TAU), dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const speed = 62, lead = 6;
  const pos = target.clone().addScaledVector(dir, -460).setY(78);
  const vel = dir.clone().multiplyScalar(speed);
  const snd = makeLoop('prop', 1.5);
  let dropped = false, t = 0, after = 0, heading = Math.atan2(dir.x, dir.z), bank = 0;
  const side = Math.random() < 0.5 ? -1 : 1;
  aircraft.push({
    update(dt) {
      t += dt;
      // after the drop it banks away in a gentle climbing turn
      let turn = 0;
      if (dropped) { after += dt; turn = after > 1.5 && after < 11 ? 0.11 * side : 0; }
      heading += turn * dt;
      bank += (-turn * 2.8 - bank) * (1 - Math.exp(-1.2 * dt));
      vel.set(Math.sin(heading) * speed, dropped && after > 1.5 && after < 14 ? 3 : 0, Math.cos(heading) * speed);
      pos.addScaledVector(vel, dt);
      m.g.position.copy(pos);
      // a heavy aircraft in warm evening air: a slow wallow in roll and pitch
      m.g.rotation.set(-vel.y / speed + Math.sin(t * 0.7) * 0.012, heading, bank + Math.sin(t * 0.5) * 0.02, 'YXZ');
      for (const p of m.props) p.rotation.z += dt * 42;
      m.lights[2].visible = (t * 1.2) % 1 < 0.15;
      snd.update(pos, vel);
      const along = _v.copy(pos).sub(target).dot(dir);
      if (!dropped && along >= -lead) { dropped = true; onDrop(pos.clone().setY(pos.y - 3)); }
      if (dropped && Math.hypot(pos.x - target.x, pos.z - target.z) > 560) { snd.stop(); scene.remove(m.g); return false; }
      return true;
    },
    remove() { snd.stop(0.2); scene.remove(m.g); },
  });
}

/** A jet runs in from the player's side and lays five bombs across `target`. */
export function airstrike(target) {
  const dir = target.clone().sub(player.pos).setY(0);
  if (dir.lengthSq() < 4) dir.set(rand(-1, 1), 0, rand(-1, 1));
  dir.normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  const speed = 190;
  const m = buildJet();
  m.g.visible = false;
  scene.add(m.g);
  const pos = target.clone().addScaledVector(dir, -1100).setY(68);
  const vel = dir.clone().multiplyScalar(speed);
  const bombs = [];
  let t = 0, released = 0, releaseT = 0, snd = null, lastDist = Infinity, boomed = false, bank = 0, pull = 0;
  const side = Math.random() < 0.5 ? -1 : 1;
  aircraft.push({
    update(dt) {
      t += dt;
      if (t < 3.2) return true;
      if (!snd) { snd = makeLoop('jet', 2.4); m.g.visible = true; }
      const along = _v.copy(pos).sub(target).dot(dir);
      // bombs away: pull up and roll into a hard climbing turn
      if (released >= 5) {
        pull = Math.min(1, pull + dt * 0.8);
        vel.y = Math.min(60, vel.y + dt * 70);
        vel.applyAxisAngle(_up, side * pull * 0.35 * dt);
      }
      bank += (side * -pull * 1.1 - bank) * (1 - Math.exp(-3 * dt));
      pos.addScaledVector(vel, dt);
      m.g.position.copy(pos);
      m.g.lookAt(_v.copy(pos).add(vel));
      m.g.rotateZ(bank);
      for (const gl of m.glow) gl.scale.setScalar(2.6 + Math.random() * 1.2);
      for (const s of [-1, 1]) fx.contrail(m.g.localToWorld(_v.set(s * 6.2, -0.1, -2.5)));
      snd.update(pos, vel);
      const cd = camera.position.distanceTo(pos);
      if (!boomed && cd > lastDist && cd < 260) { boomed = true; sfx.sonicBoom(pos); player.shake = Math.max(player.shake, 0.6); }
      lastDist = cd;
      if (released < 5 && along >= -150) {
        releaseT -= dt;
        if (releaseT <= 0) {
          releaseT = 0.07;
          const off = (released - 2) * 6.5;
          const ix = target.x + dir.x * off + perp.x * rand(-1.5, 1.5), iz = target.z + dir.z * off + perp.z * rand(-1.5, 1.5);
          const to = new THREE.Vector3(ix, supportHeight(ix, iz, 40), iz);
          const g = buildBomb();
          g.position.copy(pos);
          scene.add(g);
          bombs.push({ g, from: pos.clone().setY(pos.y - 1), to, t: 0, T: 1.35 + released * 0.02 });
          if (released === 0) sfx.bombWhistle(target);
          released++;
        }
      }
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.t += dt;
        const u = Math.min(1, b.t / b.T);
        const prev = _v.copy(b.g.position);
        b.g.position.set(b.from.x + (b.to.x - b.from.x) * u, b.from.y + (b.to.y - b.from.y) * u * u, b.from.z + (b.to.z - b.from.z) * u);
        b.g.lookAt(prev.lerp(b.g.position, 2));
        if (u >= 1) {
          scene.remove(b.g);
          bombs.splice(i, 1);
          explode(b.to.clone().setY(b.to.y + 0.3), 8.5, 420, 'airstrike', true);
        }
      }
      if (t > 28 && bombs.length === 0) { snd.stop(); scene.remove(m.g); return false; }
      return true;
    },
    remove() { if (snd) snd.stop(0.2); scene.remove(m.g); for (const b of bombs) scene.remove(b.g); },
  });
}

/** Recon drone orbiting the citadel for `duration` seconds. */
export function launchUAV(duration, onEnd) {
  const m = buildUAV();
  scene.add(m.g);
  const R = 36, w = 26 / R, snd = makeLoop('uav', 1.3);
  const pos = new THREE.Vector3(), tangent = new THREE.Vector3(), leave = new THREE.Vector3();
  let a = rand(0, TAU), t = 0, leaving = false;
  aircraft.push({
    update(dt) {
      t += dt;
      if (!leaving) {
        a += w * dt;
        pos.set(Math.cos(a) * R, 76, Math.sin(a) * R);
        tangent.set(-Math.sin(a), 0, Math.cos(a));
        if (t > duration) { leaving = true; leave.copy(tangent).multiplyScalar(30); if (onEnd) onEnd(); }
      } else pos.addScaledVector(leave, dt);
      m.g.position.copy(pos);
      m.g.lookAt(_v.copy(pos).add(tangent));
      m.g.rotateZ(leaving ? 0 : -0.35);
      m.prop.rotation.z += dt * 60;
      m.blink.visible = (t * 1.5) % 1 < 0.15;
      snd.update(pos, tangent.clone().multiplyScalar(26));
      if (leaving && t > duration + 14) { snd.stop(); scene.remove(m.g); return false; }
      return true;
    },
    remove() { snd.stop(0.2); scene.remove(m.g); },
  });
}

export function updateAircraft(dt) {
  for (let i = aircraft.length - 1; i >= 0; i--) if (!aircraft[i].update(dt)) aircraft.splice(i, 1);
}
export function clearAircraft() {
  for (const a of aircraft) a.remove();
  aircraft.length = 0;
}
