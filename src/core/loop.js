import * as THREE from 'three';
import { renderer, composer, camera, grade, keyLight, vmKey, vmScene, setResScale, getResScale } from './renderer.js';
import { sky, skyUniforms, tod } from './sky.js';
import { world } from './physics.js';
import { game, run, allies } from './state.js';
import { settings, isTouch } from '../config/settings.js';
import { FOCUS } from '../config/balance.js';
import { updateProps } from '../world/props.js';
import { refreshPropColliders } from '../world/collision.js';
import { updateAmbient } from '../world/ambient.js';
import { updateRagdolls } from '../entities/ragdoll.js';
import { updateEnemies } from '../entities/enemy.js';
import { player, updatePlayer } from '../entities/player.js';
import { fx } from '../fx/particles.js';
import { updateDecals } from '../fx/decals.js';
import { updateTransientFx } from '../fx/tracers.js';
import { updateWeather } from '../fx/weather.js';
import { sfx } from '../audio/sfx.js';
import { music } from '../audio/music.js';
import { updateListener } from '../audio/engine.js';
import { input, pollGamepad } from '../input/input.js';
import { updateArsenal } from '../weapons/arsenal.js';
import { updateGrenades } from '../weapons/grenades.js';
import { updateParachutes } from '../vehicles/parachute.js';
import { updateAircraft } from '../vehicles/flights.js';
import { updateHelicopter } from '../vehicles/helicopter.js';
import { focus, updateFocus, worldTimeScale } from '../systems/focus.js';
import { support, updateSupport } from '../systems/support.js';
import { updatePickups } from '../systems/pickups.js';
import { updateWaves } from '../systems/waves.js';
import { updateHUD, updateFps } from '../ui/hud.js';
import { updateMenuScene } from '../ui/screens.js';
import { updateTouch } from '../ui/touch.js';
import { $ } from '../ui/dom.js';

/* One frame: simulate whatever the current state needs, then render. */

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
let last = performance.now();

function stepWorld(dt) {
  world.step(1 / 60, dt, 4);
  updateProps(dt);
  refreshPropColliders();
  updateRagdolls(dt);
  fx.update(dt);
  updateTransientFx(dt);
  updateDecals(dt);
  updateParachutes(dt);
  updateAircraft(dt);
  updateHelicopter(dt);
}

function updateGame(rdt) {
  let ts = worldTimeScale();
  if (game.slowmo > 0) { game.slowmo -= rdt; ts = Math.min(ts, 0.3); }
  const wdt = rdt * ts;
  run.time += rdt;
  updatePlayer(rdt * (focus.active ? FOCUS.playerScale : 1) * (game.slowmo > 0 ? 0.5 : 1));
  if (game.state === 'playing') {
    updateSupport(rdt);
    const fire = input.fire;
    if (support.designating) input.fire = false;
    updateArsenal(rdt);
    input.fire = fire;
    updateFocus(rdt);
  }
  updateEnemies(wdt);
  for (const a of allies.slice()) a.update(wdt);
  if (game.state === 'playing') updateWaves(wdt);
  updatePickups(wdt);
  updateGrenades(wdt);
  updateWeather(wdt);
  stepWorld(wdt);
  updateAmbient(wdt);
  sfx.ambience(rdt);
  updateHUD(rdt);
  updateTouch();
  grade.uniforms.uFocus.value += ((focus.active ? 1 : 0) - grade.uniforms.uFocus.value) * (1 - Math.exp(-6 * rdt));
  grade.uniforms.uDead.value += ((player.alive ? 0 : 1) - grade.uniforms.uDead.value) * (1 - Math.exp(-2 * rdt));
  player.suppress = Math.max(0, (player.suppress || 0) - rdt * 0.45);
  grade.uniforms.uSupp.value += (Math.min(1, player.suppress) - grade.uniforms.uSupp.value) * (1 - Math.exp(-10 * rdt));
}

/*
 * Dynamic resolution: every 1.5 s of play, lower the render scale when the frame rate sags
 * below 45 FPS and raise it again when there is headroom above 57 FPS.
 */
let perfT = 0, perfFrames = 0;
function dynamicResolution(realDt) {
  if (!settings.dynRes) { setResScale(1); return; }
  if (game.state !== 'playing') return;
  perfT += realDt; perfFrames++;
  if (perfT < 1.5) return;
  const fps = perfFrames / perfT;
  perfT = 0; perfFrames = 0;
  const s = getResScale();
  if (fps < 45 && s > 0.6) setResScale(Math.max(0.6, s - 0.1));
  else if (fps > 57 && s < 1) setResScale(Math.min(1, s + 0.05));
}

const MENU_FOV = 46;
export function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.max(0, (now - last) / 1000);
  const rdt = Math.min(0.05, realDt);
  last = now;
  dynamicResolution(realDt);
  skyUniforms.uTime.value += rdt;
  grade.uniforms.uTime.value += rdt;
  grade.uniforms.uFlash.value *= Math.exp(-5 * rdt);
  pollGamepad(rdt);
  const st = game.state;
  if (st === 'playing' || st === 'dying') updateGame(rdt);
  else if (st === 'over') { stepWorld(rdt * 0.6); updateAmbient(rdt); grade.uniforms.uDead.value *= Math.exp(-rdt); }
  else if (st !== 'paused') {
    // the menu camera (src/ui/screens.js) eases between its shots and returns the lens it wants
    const menuFov = updateMenuScene(rdt) || MENU_FOV;
    stepWorld(rdt);
    updateAmbient(rdt);
    sfx.ambience(rdt);
    grade.uniforms.uDead.value = 0; grade.uniforms.uSupp.value = 0; grade.uniforms.uFocus.value = 0; grade.uniforms.uHurt.value = 0; grade.uniforms.uLow.value = 0;
    if (Math.abs(camera.fov - menuFov) > 0.01) { camera.fov = menuFov; camera.updateProjectionMatrix(); }
  }
  vmScene.visible = (st === 'playing' || st === 'paused') && player.alive;
  sky.position.copy(camera.position);
  // the shadow frustum follows the camera, snapped to texels so shadows do not shimmer
  const snap = 84 / keyLight.shadow.mapSize.x;
  _v.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
  keyLight.target.position.copy(_v);
  keyLight.position.copy(_v).addScaledVector(tod.keyDir, 120);
  vmKey.position.copy(tod.keyDir).applyQuaternion(_q.copy(camera.quaternion).invert());
  fx.setScale(renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  updateListener();
  music.update(rdt);
  updateFps(rdt);
  if (isTouch) $('rotate').hidden = innerHeight <= innerWidth;
  composer.render();
}
