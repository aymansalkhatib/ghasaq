import * as THREE from 'three';
import { game, run, enemies, grenades } from '../core/state.js';
import { applyTOD } from '../core/sky.js';
import { input } from '../input/input.js';
import { spawnEnemy, updateEnemies, noise, Enemy } from '../entities/enemy.js';
import { updateGrenades } from '../weapons/grenades.js';
import { player, updatePlayer } from '../entities/player.js';
import { Ally, squadTalk } from '../entities/ally.js';
import { startRun, endRun, startWave } from '../systems/waves.js';
import { callSupport, confirmStrike } from '../systems/support.js';
import { spawnHelicopter } from '../vehicles/helicopter.js';
import { explode } from '../fx/explosions.js';
import { enterMenu, openBriefing, openRecord, openSettings, openControls, showScreen, switchMap, clearShowcase, pause } from '../ui/screens.js';
import { loadMap, MAP_INFO, MAP_DEFS, SPAWNS, SNIPER_SPOTS, HOVER_POINTS, PLAYER_START } from '../world/map.js';
import { dropPoint, validDrop } from '../systems/support.js';
import { addSupplyCrate } from '../systems/pickups.js';
import { buildSupplyCrate, buildTransport, buildJet, buildHeli, buildUAV } from '../vehicles/models.js';
import { isBlocked } from '../world/nav.js';
import { supportHeight } from '../world/collision.js';
import { scene, camera } from '../core/renderer.js';
import { buildSoldier, animateSoldier } from '../entities/soldier-model.js';
import { renderVocal, vocal } from '../audio/vocal.js';
import { renderHeartbeat } from '../audio/heartbeat.js';
import { initAudio } from '../audio/engine.js';
import { music } from '../audio/music.js';
import { lastWords, updateHUD } from '../ui/hud.js';
import { profile } from '../systems/progression.js';
import { settings } from '../config/settings.js';
import { weaponState, melee, switchSlot, updateArsenal } from '../weapons/arsenal.js';
import { vmRoot, models, knifeHand, nadeHand } from '../weapons/viewmodels.js';

/*
 * Developer tool: open the game with #autotest-<scenario> to run a scripted scene
 * (used for automated screenshots). Scenarios: menu, brief, record, settings, combat,
 * night, strike, aar, touch.
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const V = (x, z) => new THREE.Vector3(x, 0, z);

async function combat(opts = {}) {
  enterMenu();
  startRun({ map: opts.map || 'citadel', mode: 'dusk', diff: 'veteran', primary: opts.primary || 'rifle', skin: opts.skin || 'std' });
  showScreen(null);
  game.toSpawn = 0;
  run.sp = 6000;
  if (opts.wave) { startWave(opts.wave); game.toSpawn = 0; game.heliDue = -1; game.snipersDue = []; game.hour = opts.hour; applyTOD(opts.hour); }
  const a = spawnEnemy('raider', 'rifle', V(-2.5, -7));
  spawnEnemy('heavy', 'rifle', V(2.8, -11));
  spawnEnemy('night', 'grenadier', V(-6, -16));
  spawnEnemy('raider', 'rifle', V(5, -19));
  return a;
}

/** Checks every map: spawns, sniper nests and hover points are sane, and 400 supply drops from
    random player positions all land inside the walls on a reachable spot. Results go to the console. */
async function dropTest() {
  for (const id of Object.keys(MAP_DEFS)) {
    loadMap(id);
    let bad = 0, fallback = 0, n = 0;
    const issues = [];
    for (const s of SPAWNS) if (isBlocked(s.x, s.z)) issues.push('spawn blocked ' + s.x + ',' + s.z);
    for (const s of SNIPER_SPOTS) { const h = supportHeight(s.x, s.z, s.y + 0.5); if (Math.abs(h - s.y) > 0.3) issues.push('sniper floor ' + s.x + ',' + s.z + ' h=' + h.toFixed(2)); }
    for (const h of HOVER_POINTS) if (isBlocked(h.x, h.z)) issues.push('hover over blocked ' + h.x + ',' + h.z);
    if (isBlocked(PLAYER_START.x, PLAYER_START.z)) issues.push('start blocked');
    if (!validDrop(MAP_INFO.dropFallback.x, MAP_INFO.dropFallback.z)) issues.push('fallback invalid');
    while (n < 400) {
      const x = (Math.random() - 0.5) * 88, z = (Math.random() - 0.5) * 88;
      if (isBlocked(x, z)) continue;
      n++;
      player.pos.set(x, 0, z); player.yaw = Math.random() * 6.28;
      const p = dropPoint(6);
      const isFb = p.distanceTo(MAP_INFO.dropFallback) < 0.01;
      if (isFb) fallback++;
      if (!MAP_INFO.interior(p.x, p.z) || (!isFb && !validDrop(p.x, p.z))) bad++;
    }
    console.log('DROPTEST', id, 'n=' + n, 'bad=' + bad, 'fallback=' + fallback, issues.length ? 'ISSUES: ' + issues.join(' | ') : 'no issues');
  }
  loadMap(profile.map || 'citadel');
}

export async function runAutotest(name) {
  await wait(300);
  if (name === 'menu') { enterMenu(); return; }
  if (name === 'brief') { enterMenu(); openBriefing(); return; }
  if (name === 'record') { enterMenu(); openRecord(); return; }
  if (name === 'settings') { enterMenu(); openSettings('main'); return; }
  if (name === 'controls' || name === 'guide') { enterMenu(); openControls('main'); return; }
  if (name === 'keys') { enterMenu(); openControls('main', 'keys'); return; }
  if (name === 'village') { switchMap('village'); enterMenu(); return; }
  if (name === 'vbrief') { profile.map = 'village'; switchMap('village'); enterMenu(); openBriefing(); return; }
  if (name === 'station') { switchMap('station'); enterMenu(); return; }
  if (name === 'sbrief') { profile.map = 'station'; switchMap('station'); enterMenu(); openBriefing(); return; }
  // jump and vault check: logs VAULT lines (apex of a plain jump, then climbing a 1.4 m crate and vaulting a 1.1 m wall)
  if (name === 'vault') {
    enterMenu();
    startRun({ map: 'village', mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    clearShowcase();
    game.toSpawn = 0;
    await wait(100);
    game.state = 'paused';
    const step = (n, fwd) => { for (let i = 0; i < n; i++) { input.kb.f = fwd ? 1 : 0; updatePlayer(1 / 60); } input.kb.f = 0; };
    // plain jump in the open well square
    player.pos.set(2, 0, 5); player.vel.set(0, 0, 0); player.onGround = true; step(10, false);
    let apex = 0; input.jump = true;
    for (let i = 0; i < 70; i++) { updatePlayer(1 / 60); apex = Math.max(apex, player.pos.y); }
    // a single 1.4 m crate in the ruined quarter (crate at -20, 23): walk at it from the east and jump
    player.pos.set(-17.6, 0, 23); player.yaw = Math.PI / 2; player.vel.set(0, 0, 0); player.onGround = true; step(10, false);
    step(20, true); input.jump = true; step(50, true);
    const onCrate = player.pos.y;
    // the 1.1 m orchard wall (mudWall at 11, 12): vault it from the north
    player.pos.set(11, 0, 10.6); player.yaw = Math.PI; player.vel.set(0, 0, 0); player.onGround = true; step(10, false);
    step(10, true); input.jump = true; step(70, true);
    console.log('VAULT', 'jumpApex=' + apex.toFixed(2), 'crateTop=' + onCrate.toFixed(2), 'wallZ=' + player.pos.z.toFixed(2) + ' (wall at 12)', 'y=' + player.pos.y.toFixed(2));
    return;
  }
  // ally check: two allies beside the player against three raiders, 25 s; logs ALLYSIM
  if (name === 'allysim') {
    enterMenu();
    startRun({ map: 'citadel', mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    clearShowcase();
    game.toSpawn = 0; game.heliDue = -1; game.snipersDue = [];
    await wait(100);
    game.state = 'paused';
    player.pos.set(0, 0, 12); player.yaw = 0; player.hp = 1e9;
    const hurt = player.hurt; player.hurt = () => {};
    const A = [new Ally(V(-3, 13), 'الرقيب سالم'), new Ally(V(3, 13), 'العريف فهد')];
    for (const a of A) a.landed = true;
    for (let i = 0; i < 3; i++) spawnEnemy('raider', 'rifle', V(-4 + i * 4, -22));
    const log = { cover: 0, crouch: 0, fire: 0, hits: 0 };
    const td = Enemy.prototype.takeDamage;
    Enemy.prototype.takeDamage = function (amt, part, pt, dir, w, ...r) { if (w === 'ally') log.hits++; return td.call(this, amt, part, pt, dir, w, ...r); };
    const fire = Ally.prototype.fire;
    Ally.prototype.fire = function (...a) { log.fire++; return fire.apply(this, a); };
    for (let k = 0; k < 25 * 30; k++) {
      updateEnemies(1 / 30);
      for (const a of A.slice()) { a.update(1 / 30); if (a.cover) log.cover++; if (a.crouch) log.crouch++; }
      scene.updateMatrixWorld();   // hit boxes follow their soldiers (normally done by the renderer)
    }
    Ally.prototype.fire = fire; player.hurt = hurt; Enemy.prototype.takeDamage = td;
    console.log('ALLYSIM', 'alliesAlive=' + A.filter((a) => a.alive).length, 'raidersLeft=' + enemies.length, 'allyShots=' + log.fire, 'allyHits=' + log.hits, 'kills=' + A.reduce((s, a) => s + a.kills, 0),
      'inCover%=' + ((log.cover / (25 * 30 * 2)) * 100).toFixed(0), 'crouched%=' + ((log.crouch / (25 * 30 * 2)) * 100).toFixed(0));
    return;
  }
  if (name === 'gear') { enterMenu(); openBriefing(true); return; }
  // menu redesign checks: pause over a live fight, village briefing loadout
  if (name === 'pause') { await combat(); await wait(900); pause(); return; }
  // briefing on the loadout tab, then deploy: the menu camera, view offset and borrowed weapon must hand back cleanly
  if (name === 'deploy') {
    enterMenu(); openBriefing(true);
    await wait(1500);
    for (let i = 0; i < 300 && document.querySelector('#menuVeil.on'); i++) await wait(200);
    await wait(1500);
    document.getElementById('briefStart').click();
    game.toSpawn = 0;
    return;
  }
  if (name === 'vgear') { profile.map = 'village'; switchMap('village'); enterMenu(); openBriefing(true); return; }
  // weapon close-ups: w-rifle, w-smg, w-shotgun, w-dmr, w-pistol, w-knife, w-ads (rifle aimed), w-sleeve
  if (name.startsWith('w-')) {
    const w = name.slice(2);
    enterMenu();
    startRun({ map: 'citadel', mode: 'dusk', diff: 'veteran', primary: ['smg', 'shotgun', 'dmr'].includes(w) ? w : 'rifle', skin: 'std' });
    showScreen(null);
    game.toSpawn = 0;
    player.yaw = 3.0; player.pitch = -0.05;
    await wait(400);
    if (w === 'pistol') { switchSlot('secondary'); await wait(900); }
    if (w === 'ads') { weaponState.ads = 1; input.aim = true; }
    if (w === 'knife') { melee(); await wait(120); game.state = 'paused'; }
    return;
  }
  // sight pictures: ads-<weapon>[-hip] aims down the sight at a raider 12 m away (ads-dmr stops half-way, before the scope overlay)
  // aiming check: ads-<weapon>[-far][-hip][-mid]. far puts the raider at 35 m instead of 12 m,
  // hip keeps the weapon at the hip, mid stops the scope half way in (before its overlay)
  if (name.startsWith('ads-')) {
    const [, w, ...flags] = name.split('-');
    const hipOnly = flags.includes('hip'), far = flags.includes('far'), mid = flags.includes('mid');
    enterMenu();
    startRun({ map: 'citadel', mode: 'dusk', diff: 'veteran', primary: w === 'pistol' ? 'rifle' : w, skin: 'std' });
    showScreen(null);
    game.toSpawn = 0;
    clearShowcase();
    player.pos.set(2.5, 0, 22); player.yaw = 0.1; player.pitch = -0.02;
    await wait(300);
    // step the player and the weapon by hand: headless frames are too sparse to rely on
    game.state = 'paused';
    const e = spawnEnemy('raider', 'rifle', V(far ? -0.9 : 1.3, far ? -13 : 10));
    e.yaw = Math.PI;
    if (far) player.yaw = 0.02;
    if (w === 'pistol') switchSlot('secondary');
    for (let i = 0; i < 90; i++) {
      input.aim = !hipOnly && i > 30;
      if (w === 'dmr' && mid) weaponState.ads = Math.min(weaponState.ads, 0.62);
      updatePlayer(1 / 60); updateArsenal(1 / 60);
    }
    updateHUD(1 / 60);   // the crosshair and scope overlay as they would look in play
    return;
  }
  // every first-person model laid out side-on in one frame (right side toward the camera)
  if (name === 'armory') {
    enterMenu();
    startRun({ map: 'citadel', mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    game.toSpawn = 0;
    player.pitch = 0.9;           // look at the sky for a plain backdrop
    await wait(300);
    game.state = 'paused';
    vmRoot.position.set(0, 0, 0); vmRoot.rotation.set(0, 0, 0);
    const lay = { rifle: [-0.62, 0.42], dmr: [0.62, 0.42], smg: [-0.62, 0.0], shotgun: [0.62, 0.0], pistol: [-0.55, -0.42] };
    for (const [k, [x, y]] of Object.entries(lay)) {
      const g = models[k].g;
      g.visible = true; g.position.set(x + 0.12, y, -2.2); g.rotation.set(0, -Math.PI / 2, 0);
    }
    knifeHand.visible = true; knifeHand.position.set(0.12, -0.42, -2.0); knifeHand.rotation.set(0, -Math.PI / 2, 0);
    nadeHand.visible = true; nadeHand.position.set(0.72, -0.42, -2.0); nadeHand.rotation.set(0, -Math.PI / 2, 0);
    document.getElementById('hud').hidden = true;
    return;
  }
  // the four soldier types up close: two walking, one running, one crouched
  if (name === 'troops') {
    enterMenu();
    showScreen(null);
    game.state = 'paused';
    const poses = [['ally', 'rifle', -1.5, 0, { vel: new THREE.Vector3(0, 0, 1.6), yaw: 0 }], ['raider', 'rifle', -0.5, 0.4, { vel: new THREE.Vector3(0, 0, 4.8), yaw: 0 }],
      ['heavy', 'rifle', 0.6, 0, { vel: new THREE.Vector3(1.4, 0, 0.6), yaw: 0 }], ['night', 'grenadier', 1.6, 0.3, { vel: new THREE.Vector3(0, 0, 0), yaw: 0, crouch: true }]];
    for (const [kind, role, x, zoff, o] of poses) {
      const ch = buildSoldier(kind, 7, role);
      ch.root.position.set(x, 0, 18 + zoff);
      ch.root.rotation.y = 0.35;
      scene.add(ch.root);
      for (let i = 0; i < 9; i++) animateSoldier(ch, 0.05, o);
    }
    camera.position.set(0.3, 1.25, 23.2);
    camera.lookAt(0.1, 0.95, 18);
    return;
  }
  // map tour: tour-<map>-<k> frames the map from a raised viewpoint (k = 0..5) in daylight, no HUD
  if (name.startsWith('tour-')) {
    const [, map, kk] = name.split('-');
    const k = Number(kk) || 0;
    enterMenu();
    startRun({ map, mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    game.toSpawn = 0;
    const hour = [15, 15, 15, 15, 18.6, 21, 15, 19.3, 15, 15, 15, 15][k] ?? 15;
    game.hour = hour; applyTOD(hour);
    await wait(300);
    game.state = 'paused';
    document.getElementById('hud').hidden = true;
    vmRoot.visible = false;
    const views = [[-40, 16, -40, 0, 0, 0], [40, 16, -40, 0, 0, 0], [40, 16, 40, 0, 0, 0], [-40, 16, 40, 0, 0, 0], [0, 2.2, 30, 0, 1.5, -10], [0, 2.2, -30, 0, 1.5, 10],
      [3, 4.5, -19, 11, 2, -30], [0, 3.5, 11, 0, 2.2, 24], [26, 3, 12, 36, 1.5, 20], [-20, 3, -20, -32, 1, -19], [18, 4, 1, 14, 3, -8], [0, 3, -22, 1, 1.5, -32]];
    const [x, y, z, lx, ly, lz] = views[k] || views[0];
    camera.position.set(x, y, z);
    camera.lookAt(lx, ly, lz);
    camera.fov = 70; camera.updateProjectionMatrix();
    return;
  }
  // soldier poses in daylight: poses (front), poses-side, poses-back. Left to right: aiming walk,
  // low-ready patrol, sprint at port arms, armoured push, crouched ally, dodge hop
  if (name.startsWith('poses')) {
    const view = name.split('-')[1] || 'front';
    enterMenu();
    clearShowcase();
    showScreen(null);
    applyTOD(15);
    game.state = 'paused';
    const Z = V(0, 0);
    const poses = [
      ['raider', 'rifle', { vel: V(0, 1.4), yaw: 0, ready: 1 }],
      ['raider', 'grenadier', { vel: V(0, 1.5), yaw: 0, ready: 0 }],
      ['night', 'rifle', { vel: V(0, 5.2), yaw: 0, sprint: true, ready: 0 }],
      ['heavy', 'rifle', { vel: V(0, 1.2), yaw: 0 }],
      ['ally', 'rifle', { vel: Z, yaw: 0, crouch: true }],
      ['raider', 'rifle', { vel: V(2.5, 0), yaw: 0, air: true }],
    ];
    poses.forEach(([kind, role, o], i) => {
      const ch = buildSoldier(kind, 11 + i, role);
      ch.root.position.set(-3.1 + i * 1.25, o.air ? 0.35 : 0, 18);
      ch.root.rotation.y = 0;
      scene.add(ch.root);
      for (let k = 0; k < 24; k++) animateSoldier(ch, 0.04, o);
    });
    const cams = { front: [0, 1.3, 24.5], side: [7.5, 1.3, 18.2], back: [0, 1.4, 11.5] };
    const c = cams[view] || cams.front;
    camera.position.set(c[0], c[1], c[2]);
    camera.lookAt(0, 0.95, 18);
    camera.fov = 50; camera.updateProjectionMatrix();
    document.getElementById('hud').hidden = true;
    return;
  }
  // aircraft close-ups: air (the whole fleet), air-heli, air-jet, air-transport
  if (name.startsWith('air')) {
    const which = name.split('-')[1] || 'all';
    enterMenu();
    clearShowcase();
    showScreen(null);
    applyTOD(15.5);
    game.state = 'paused';
    const put = (m, x, y, z, ry, rz = 0) => { m.g.position.set(x, y, z); m.g.rotation.set(0, ry, rz, 'YXZ'); scene.add(m.g); return m; };
    let look = [0, 14, -20];
    if (which === 'all') {
      put(buildTransport(), -6, 34, -75, 2.3, 0.12);
      put(buildJet(), 22, 20, -38, -2.0, -0.5);
      put(buildHeli(), -10, 9, -24, 0.9);
      put(buildUAV(), 9, 16, -20, 1.4, 0.3);
    } else if (which === 'heli') { put(buildHeli(), 0, 6, -12, 0.75); look = [0, 6, -12]; }
    else if (which === 'jet') { put(buildJet(), 0, 8, -16, 0.9, -0.25); look = [0, 8, -16]; }
    else { put(buildTransport(), 0, 16, -44, 0.85, 0.1); look = [0, 16, -44]; }
    camera.position.set(0, 3, 6);
    camera.lookAt(look[0], look[1], look[2]);
    camera.fov = 55; camera.updateProjectionMatrix();
    document.getElementById('hud').hidden = true;
    return;
  }
  // AI behaviour check: aisim-<difficulty>[-map] runs 70 s of raider logic against a player dug in
  // behind cover who fires now and then, and logs how the squad fought (AISIM ... in the console)
  if (name.startsWith('aisim')) {
    const [, diff = 'veteran', map = 'citadel'] = name.split('-');
    enterMenu();
    startRun({ map, mode: 'dusk', diff, primary: 'rifle', skin: 'std' });
    showScreen(null);
    clearShowcase();
    game.toSpawn = 0; game.heliDue = -1; game.snipersDue = [];
    await wait(100);
    game.state = 'paused';
    const P0 = map === 'village' ? V(2, 9.5) : map === 'station' ? V(1, 14) : V(0, 9);
    player.pos.copy(P0); player.yaw = 0; player.crouch = true; player.eyeH = 1.08;
    player.hp = 1e9; player.armor = 0;
    let hits = 0, dmg = 0, shots = 0, nades = 0, firstHit = -1, t = 0;
    const hurt = player.hurt;
    player.hurt = function (d) { hits++; dmg += d; if (firstHit < 0) firstHit = t; };
    const fire = Enemy.prototype.fire;
    Enemy.prototype.fire = function (...a) { shots++; return fire.apply(this, a); };
    const spots = SPAWNS.slice().sort((a, b) => b.distanceTo(P0) - a.distanceTo(P0)).slice(0, 4);
    for (let i = 0; i < 6; i++) spawnEnemy(i === 5 ? 'heavy' : 'raider', i === 2 ? 'grenadier' : 'rifle', spots[i % spots.length].clone().add(V(i * 0.7 - 2, 0)));
    const stateTime = {}, seen = new Set();
    let flankers = 0, minDist = 99;
    const dt = 1 / 30, t0 = performance.now();
    for (let k = 0; k < 70 * 30; k++) {
      t += dt;
      if (k % 75 === 0) noise(player.pos, 48, 'shot');
      updateEnemies(dt);
      updateGrenades(dt);
      for (const e of enemies) {
        if (e.throwT > 0.66) nades++;
        stateTime[e.state] = (stateTime[e.state] || 0) + dt;
        if (e.state === 'flank' && !seen.has(e)) { seen.add(e); flankers++; }
        minDist = Math.min(minDist, e.pos.distanceTo(player.pos));
      }
    }
    player.hurt = hurt;
    Enemy.prototype.fire = fire;
    const st = Object.entries(stateTime).map(([s, v]) => s + ':' + v.toFixed(0)).join(' ');
    console.log('AISIM', map, diff, 'alive=' + enemies.length, 'shots=' + shots, 'hits=' + hits, 'dmg=' + dmg.toFixed(0), 'firstHit=' + firstHit.toFixed(1),
      'nades=' + nades, 'flankers=' + flankers, 'closest=' + minDist.toFixed(1), 'ms/frame=' + ((performance.now() - t0) / 2100).toFixed(2), '| man-seconds per state', st);
    return;
  }
  if (name === 'droptest') { await dropTest(); enterMenu(); return; }
  if (name === 'vcombat') {
    const a = await combat({ map: 'village' });
    callSupport('ally');
    await wait(400);
    input.fire = true;
    await wait(500);
    input.fire = false;
    return;
  }
  if (name === 'vsupply' || name === 'csupply') {
    await combat({ map: name === 'vsupply' ? 'village' : 'citadel' });
    const t = dropPoint(6);
    const c = buildSupplyCrate();
    scene.add(c.g);
    addSupplyCrate(c, t.setY(supportHeight(t.x, t.z, 2)));
    player.pos.set(t.x + 3.2, 0, t.z + 3.2);
    player.yaw = Math.atan2(3.2, 3.2);
    player.pitch = -0.25;
    console.log('SUPPLY at', t.x.toFixed(1), t.z.toFixed(1), 'interior', MAP_INFO.interior(t.x, t.z));
    return;
  }
  if (name === 'death') {
    await combat();
    await wait(600);
    player.hurt(500, new THREE.Vector3(-2.5, 0, -7), false, 'غازٍ 01');
    return;
  }
  if (name === 'combat' || name === 'touch') {
    const a = await combat();
    callSupport('uav');
    await wait(400);
    callSupport('ally');
    callSupport('supply');
    player.pitch = -0.02;
    input.fire = true;
    await wait(700);
    input.fire = false;
    if (a.alive) a.takeDamage(500, 'head', new THREE.Vector3(a.pos.x, 1.65, a.pos.z), new THREE.Vector3(-0.3, 0.1, -1).normalize(), 'rifle', 90);
    await wait(500);
    explode(new THREE.Vector3(-5, 0.2, -15), 7.5, 170, 'nade');
    return;
  }
  // weapon light at night: torch-citadel / torch-village (raiders 10–25 m ahead in the beam)
  // the weapon light at night 1.3 m from a house wall: it must light the wall evenly, not blind
  // renders every human sound offline and logs its level (peak, RMS, crest factor), then fires
  // every music stinger and a knife kill's last words through the live audio graph
  if (name === 'vocaltest') {
    const sr = 44100;
    for (const kind of ['grunt', 'cry']) {
      for (const heavy of [false, true]) {
        const ctx = new OfflineAudioContext(1, sr * 2, sr);
        const len = renderVocal(ctx, ctx.destination, 0.05, kind, { f0: heavy ? 90 : 112, tract: heavy ? 0.9 : 1, until: 0 });
        const d = (await ctx.startRendering()).getChannelData(0);
        let peak = 0, sum = 0, n = 0;
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); peak = Math.max(peak, v); if (v > 0.001) { sum += d[i] * d[i]; n++; } }
        const rms = Math.sqrt(sum / Math.max(1, n));
        console.warn('VOCAL', kind, heavy ? 'heavy' : 'man', 'len=' + len.toFixed(2), 'peak=' + peak.toFixed(3), 'rms=' + rms.toFixed(3), 'crest=' + (peak / (rms || 1)).toFixed(1));
      }
    }
    for (const [label, interval] of [['calm', 1.05], ['racing', 0.5]]) {
      const ctx = new OfflineAudioContext(1, sr * 2, sr);
      renderHeartbeat(ctx, ctx.destination, 0.05, 1, interval);
      const d = (await ctx.startRendering()).getChannelData(0);
      let peak = 0, sum = 0, n = 0, hi = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); peak = Math.max(peak, v); if (v > 0.001) { sum += d[i] * d[i]; n++; } }
      // how much survives a small laptop speaker (roughly: nothing below 120 Hz)
      const c2 = new OfflineAudioContext(1, sr * 2, sr), hp = c2.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120; hp.connect(c2.destination);
      renderHeartbeat(c2, hp, 0.05, 1, interval);
      const d2 = (await c2.startRendering()).getChannelData(0);
      for (let i = 0; i < d2.length; i++) hi = Math.max(hi, Math.abs(d2[i]));
      console.warn('HEART', label, 'peak=' + peak.toFixed(3), 'rms=' + Math.sqrt(sum / Math.max(1, n)).toFixed(3), 'above120Hz_peak=' + hi.toFixed(3));
    }
    enterMenu();
    initAudio(); music.init();
    for (const st of ['contact', 'assault', 'retreat', 'laststand', 'streak', 'wave', 'clear']) music.stinger(st);
    music.setState('combat'); music.setIntensity(1); music.boost(0.5);
    vocal('cry', null, player.voice);
    lastWords('غازٍ 07');
    await wait(1500);
    console.warn('STINGERS ok', 'speech=' + document.querySelector('#speech .sp-text').textContent);
    window.__done = true;
    return;
  }
  // two squad mates on the ground trade a line on the radio (written only)
  if (name === 'banter') {
    await combat({ map: 'village' });
    for (const [k, n] of [[0, 'الرقيب سالم'], [1, 'العريف فهد']]) { const al = new Ally(new THREE.Vector3(-2 + k * 4, 0, 10), n); al.land(); }
    await wait(3200);
    squadTalk('push', true);
    await wait(2600);
    window.__done = true;
    return;
  }
  // the field-of-view setting must change the in-game camera
  if (name === 'fovtest') {
    await combat();
    game.state = 'paused';
    const seen = [];
    for (const v of [65, 80, 100]) { settings.fov = v; for (let i = 0; i < 5; i++) updateArsenal(1 / 60); seen.push(v + '->' + camera.fov.toFixed(1)); }
    settings.fov = 80;
    console.warn('FOV', seen.join(' '));
    window.__done = true;
    return;
  }
  if (name === 'sndsettings') { enterMenu(); openSettings('main'); document.querySelector('#setTabs [data-tab="snd"]')?.click(); return; }
  if (name === 'torchwall') {
    enterMenu();
    startRun({ map: 'citadel', mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    clearShowcase();
    startWave(5); game.toSpawn = 0; game.heliDue = -1; game.snipersDue = []; game.hour = 22; applyTOD(22);
    await wait(200);
    game.state = 'paused';
    player.pos.set(-22.2, 0, 6); player.yaw = Math.PI / 2; player.pitch = -0.08; player.torch = true;
    for (let i = 0; i < 40; i++) { updatePlayer(1 / 60); updateArsenal(1 / 60); }
    return;
  }
  if (name.startsWith('torch')) {
    const map = name.split('-')[1] || 'citadel';
    enterMenu();
    startRun({ map, mode: 'dusk', diff: 'veteran', primary: 'rifle', skin: 'std' });
    showScreen(null);
    clearShowcase();
    startWave(5); game.toSpawn = 0; game.heliDue = -1; game.snipersDue = []; game.hour = 22; applyTOD(22);
    await wait(200);
    game.state = 'paused';
    player.pos.set(0, 0, 22); player.yaw = 0; player.pitch = -0.04; player.torch = true;
    for (const [x, z] of [[-1.5, 12], [2.5, 7], [4, -2]]) { const e = spawnEnemy('night', 'rifle', V(x, z)); e.yaw = Math.PI; }
    for (let i = 0; i < 40; i++) { updatePlayer(1 / 60); updateArsenal(1 / 60); }
    return;
  }
  if (name === 'night') {
    await combat({ wave: 4, hour: 20.6, primary: 'dmr', skin: 'tiger' });
    spawnEnemy('night', 'sniper', new THREE.Vector3(-34.2, 10, -34.2));
    spawnHelicopter(4, () => ['night', 'rifle']);
    player.torch = true;
    player.yaw = 0.35;
    return;
  }
  if (name === 'strike') {
    await combat();
    callSupport('strike');
    player.pitch = -0.25;
    await wait(600);
    confirmStrike();
    return;
  }
  if (name === 'aar') {
    await combat();
    await wait(400);
    Object.assign(run, { kills: 23, hs: 9, shots: 180, hits: 96, bestStreak: 7, wavesCleared: 5 });
    run.lines = { 'قتل': { count: 21, pts: 2100 }, 'إصابة في الرأس': { count: 9, pts: 450 }, 'صمود حتى 21:00': { count: 5, pts: 2500 }, 'برميل متفجر': { count: 2, pts: 150 } };
    run.score = 5200;
    game.hour = 21.3;
    endRun(false);
  }
}
