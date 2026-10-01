import * as THREE from 'three';
import { arNum, clamp, fmtClock, lerp, pick, rand, randi, smooth } from '../core/utils.js';
import { game, run, enemies, refs, allies, resetRun } from '../core/state.js';
import { applyTOD, tod } from '../core/sky.js';
import { settings } from '../config/settings.js';
import { DIFFICULTY, SCORE, FOCUS, GRENADE, waveDef, waveSkill } from '../config/balance.js';
import { SPAWNS, SNIPER_SPOTS, loadMap } from '../world/map.js';
import { resetProps } from '../world/props.js';
import { clearRagdolls } from '../entities/ragdoll.js';
import { fx } from '../fx/particles.js';
import { clearDecals } from '../fx/decals.js';
import { clearTransientFx } from '../fx/tracers.js';
import { setStorm } from '../fx/weather.js';
import { sfx } from '../audio/sfx.js';
import { music } from '../audio/music.js';
import { radio, clearRadio } from '../audio/radio.js';
import { spawnEnemy, clearEnemies, waveCfg, aiCfg } from '../entities/enemy.js';
import { player, resetPlayer } from '../entities/player.js';
import { resetArsenal, inv, refillAmmo } from '../weapons/arsenal.js';
import { applySkin } from '../weapons/viewmodels.js';
import { resetGrenades } from '../weapons/grenades.js';
import { spawnHelicopter, clearHelicopter } from '../vehicles/helicopter.js';
import { clearAircraft } from '../vehicles/flights.js';
import { clearParachutes } from '../vehicles/parachute.js';
import { lockPointer, unlockPointer, releaseAll } from '../input/input.js';
import { focus, resetFocus, setFocus, addFocus, focusKill } from './focus.js';
import { spawnPickup, clearPickups } from './pickups.js';
import { resetSupport } from './support.js';
import { profile, saveProfile, award, unlockMedal, finalizeRun } from './progression.js';
import { challengeEvent } from './challenges.js';
import { updateTension, tensionEvent, resetTension } from './tension.js';
import { squadTalk } from '../entities/ally.js';
import { banner, showMsg, popText, killFeed, showHUD, hint, clearFeed, updateAmmoHUD } from '../ui/hud.js';
import { openAAR } from '../ui/screens.js';

/* Run lifecycle: start, waves and their events, kill rewards, intermissions and the end of the run. */

export function startRun(opts) {
  game.mode = opts.mode; game.diff = opts.diff;
  profile.mode = opts.mode; profile.diff = opts.diff; profile.loadout = opts.primary; profile.skin = opts.skin;
  if (opts.map) profile.map = opts.map;
  saveProfile();
  resetRun();
  clearBattlefield();
  loadMap(profile.map);
  resetPlayer();
  resetArsenal(opts.primary);
  applySkin(opts.skin);
  resetFocus();
  resetGrenades();
  resetSupport();
  resetTension();
  clearFeed();
  game.hour = 16;
  applyTOD(16);
  game.stormWave = Math.random() < 0.75 ? pick([1, 5]) : -1;
  game.torchAuto = false;
  game.storm = 0; setStorm(false);
  showHUD(true);
  game.state = 'playing';
  music.setState('combat');
  music.setIntensity(0.2);
  startWave(0);
  lockPointer();
  if (settings.hints && profile.firstRun) scheduleHints();
}

export function clearBattlefield() {
  clearEnemies();
  clearRagdolls();
  resetGrenades();
  resetProps();
  clearDecals();
  clearPickups();
  clearParachutes();
  clearAircraft();
  clearHelicopter();
  for (const a of allies.slice()) a.dispose();
  fx.clear();
  clearTransientFx();
  clearRadio();
}

function scheduleHints() {
  const touch = document.body.classList.contains('touch');
  const lines = touch
    ? [[4, 'حرّك إصبعك الأيسر للمشي، واسحب يميناً للنظر'], [11, 'اضغط زر الإطلاق واسحب عليه لتصوّب في الوقت نفسه'], [20, 'اجمع نقاط الإسناد، ثم افتح قائمة الإسناد لاستدعاء الدعم']]
    : [[4, 'تحرّك بين السواتر: الغزاة يطلقون عليك بدقة أكبر وأنت واقف'], [11, 'زر الفأرة الأيمن للتصويب الدقيق، وShift للركض'], [20, 'نقاط الإسناد تُكسب بالقتل. الأزرار 3 إلى 6 تستدعي الدعم الجوي'], [30, 'الإصابة في الرأس تملأ التركيز. اضغط Q لإبطاء الزمن']];
  for (const [t, text] of lines) setTimeout(() => { if (game.state === 'playing' && game.wave === 0) hint(text); }, t * 1000);
}

function kindPicker(def) {
  return () => {
    if (Math.random() < def.heavy) return ['heavy', 'rifle'];
    const kind = Math.random() < def.night ? 'night' : 'raider';
    return [kind, Math.random() < def.gren ? 'grenadier' : 'rifle'];
  };
}
let currentDef = null;
export function startWave(i) {
  const def = currentDef = waveDef(i);
  const skill = waveSkill(i), D = DIFFICULTY[game.diff];
  Object.assign(waveCfg, { spread: skill.spread * D.spread, react: skill.react * D.react, pause: skill.pause, dmg: skill.dmg * D.dmg });
  Object.assign(aiCfg, D.ai);
  game.wave = i;
  const total = Math.round(def.n * D.count);
  const heliTroops = def.heli ? 4 : 0;
  game.toSpawn = Math.max(1, total - heliTroops - def.snipers);
  game.heliDue = def.heli ? 16 : -1;
  game.snipersDue = Array.from({ length: def.snipers }, (_, k) => 7 + k * 22);
  game.maxAlive = def.max;
  game.spawnT = 2;
  game.inter = 0;
  game.waveTime = 0;
  run.waveDmg = 0;
  const storm = i === game.stormWave;
  setStorm(storm);
  const extra = [def.heli ? 'مروحية معادية' : '', def.snipers ? 'قنّاص على الأبراج' : '', storm ? 'عاصفة رملية' : ''].filter(Boolean).join(' · ');
  banner(fmtClock(def.h), `الموجة ${arNum(i + 1)} · ${def.title}`, `يصل ${arNum(total)} من الغزاة${extra ? ' · ' + extra : ''}`);
  sfx.bell(Math.min(8, def.h % 12 || 12));
  music.stinger('wave');
  music.setState('combat');
  if (storm) setTimeout(() => radio('عاصفة رملية تقترب. الرؤية ستنعدم على الطرفين، ابقَ قريباً من الساتر.', 'hq', true), 2500);
  if (def.snipers) setTimeout(() => radio('انتبه: قنّاص يتمركز على أحد الأبراج. راقب وميض منظاره.', 'hq'), 6500);
  if (def.h % 24 === 19) setTimeout(() => showMsg('حلّ الظلام · اضغط F لتشغيل المصباح', 3200), 4000);
}

function spawnRegular() {
  const ranked = SPAWNS.map((p) => ({ p, d: p.distanceTo(player.pos) })).sort((a, b) => b.d - a.d);
  const base = ranked[randi(4)].p;
  const pos = base.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
  const [kind, role] = kindPicker(currentDef)();
  spawnEnemy(kind, role, pos);
}
function spawnSniper() {
  const taken = enemies.filter((e) => e.role === 'sniper').map((e) => e.pos);
  const free = SNIPER_SPOTS.filter((s) => !taken.some((t) => t.distanceTo(s) < 1));
  if (!free.length) return;
  const spot = free.sort((a, b) => b.distanceTo(player.pos) - a.distanceTo(player.pos))[randi(Math.min(2, free.length))];
  spawnEnemy(Math.random() < 0.5 ? 'night' : 'raider', 'sniper', spot);
}
const remaining = () => game.toSpawn + enemies.length + (game.heliDue >= 0 ? 4 : 0) + game.snipersDue.length + (refs.heli && refs.heli.troops > 0 && refs.heli.state === 'hover' ? refs.heli.troops : 0) + (refs.heli && refs.heli.state === 'approach' ? refs.heli.troops : 0);

export function updateWaves(dt) {
  if (game.inter > 0) {
    updateTension(dt, false);
    game.inter -= dt;
    const t = smooth(clamp(1 - game.inter / 10, 0, 1));
    game.hour = lerp(game.hourFrom, game.hourTo, t);
    applyTOD(game.hour);
    if (game.inter <= 0) startWave(game.wave + 1);
    return;
  }
  const def = currentDef;
  game.waveTime += dt;
  game.hour = Math.min(def.h + 0.9, game.hour + dt / 90);
  applyTOD(game.hour);
  // the flashlight switches itself on the first time it gets properly dark
  if (!game.torchAuto && tod.night > 0.6) {
    game.torchAuto = true;
    if (!player.torch) { player.torch = true; showMsg('تم تشغيل المصباح تلقائياً · F لإطفائه', 2600); }
  }
  if (game.toSpawn > 0 && enemies.length < game.maxAlive) {
    game.spawnT -= dt;
    if (game.spawnT <= 0) { spawnRegular(); game.toSpawn--; game.spawnT = rand(0.8, 1.8); }
  }
  if (game.heliDue >= 0 && game.waveTime >= game.heliDue) { game.heliDue = -1; spawnHelicopter(4, kindPicker(def)); tensionEvent('assault'); }
  while (game.snipersDue.length && game.waveTime >= game.snipersDue[0]) { game.snipersDue.shift(); spawnSniper(); }

  // the score, stingers and the distant battle follow the fight
  updateTension(dt, true);

  if (remaining() === 0 && player.alive) waveCleared();
}

function waveCleared() {
  const i = game.wave, def = currentDef;
  run.wavesCleared++;
  challengeEvent('wave');
  const nextHour = def.h + 1;
  award('صمود حتى ' + fmtClock(nextHour), SCORE.waveBase + SCORE.wavePer * (i + 1));
  if (run.waveDmg === 0) { award('موجة بلا خدش', SCORE.flawless); unlockMedal('flawless'); }
  if (nextHour >= 20) unlockMedal('h20');
  if (game.mode === 'dawn' && nextHour >= 29) unlockMedal('dawn');
  setStorm(false);
  if (game.mode === 'dusk' && i === 7) {
    game.hour = 24; applyTOD(24);
    award('النصر عند منتصف الليل', SCORE.victory);
    unlockMedal('win');
    if (game.diff === 'legend') unlockMedal('legend');
    run.won = true;
    sfx.bell(12);
    music.stinger('victory');
    music.setState('silent');
    game.inter = 0;
    game.state = 'dying';
    setTimeout(() => endRun(true), 4500);
    return;
  }
  game.inter = 10;
  game.hourFrom = game.hour;
  game.hourTo = waveDef(i + 1).h;
  player.heal(25, 40);
  refillAmmo(0.35);
  inv.nades = Math.min(GRENADE.max, inv.nades + 1);
  updateAmmoHUD(true);
  banner(fmtClock(game.hourTo), 'صمدت ساعة أخرى', 'إمداد: ذخيرة، ودرع، وقنبلة، و٢٥ نقطة صحة');
  music.stinger('clear');
  music.setState('calm');
  setTimeout(() => { if (game.state === 'playing') squadTalk('between', true); }, 3500);
}

/** Called by every raider death. info: { headshot, weapon, dist, explosive } */
export function onEnemyKilled(e, info) {
  run.kills++;
  const enemyCaused = info.weapon === 'enemyNade';
  if (!enemyCaused) {
    if (info.headshot) run.hs++;
    run.multi = run.time - run.lastKill < 2.6 ? run.multi + 1 : 1;
    run.lastKill = run.time;
    run.streak++;
    run.bestStreak = Math.max(run.bestStreak, run.streak);
    if (info.weapon === 'ally') {
      award('مساعدة الرفيق', SCORE.allyAssist);
    } else {
      award(e.role === 'sniper' ? 'قتل قنّاص' : e.kind === 'heavy' ? 'قتل مدرّع' : 'قتل', SCORE.kill + (e.kind === 'heavy' ? 60 : 0) + (e.role === 'sniper' ? 80 : 0));
      if (info.headshot) award('إصابة في الرأس', SCORE.headshot);
      if (!info.explosive && info.dist > 45) award('طلقة بعيدة', SCORE.longshot);
      if (!info.explosive && info.dist >= 60) unlockMedal('longshot');
      if (info.weapon === 'barrel') { award('برميل متفجر', SCORE.barrel); run.barrelKills++; if (profile.totals.barrelKills + run.barrelKills >= 10) unlockMedal('barrels'); }
      else if (info.explosive) award('قتل بالانفجار', SCORE.explosive);
      if (run.multi >= 2) award('قتل متتالٍ', SCORE.multi * (run.multi - 1));
      if (info.weapon === 'knife') award(e.backstabbed ? 'طعنة صامتة من الخلف' : 'طعنة', SCORE.melee + (e.backstabbed ? SCORE.backstab : 0));
      challengeEvent('kill', { weapon: info.weapon, role: e.role });
      if (info.headshot) challengeEvent('headshot');
      if (focus.active) challengeEvent('focusKill');
    }
    focusKill();
    addFocus(info.headshot ? FOCUS.headGain : FOCUS.killGain + (info.explosive ? FOCUS.explosiveGain : 0));
    const labels = ['', '', 'قتل مزدوج', 'قتل ثلاثي', 'قتل رباعي', 'مجزرة'];
    if (run.multi >= 2) { addFocus(FOCUS.multiGain); popText(labels[Math.min(run.multi, 5)]); }
    if (run.multi >= 3) tensionEvent('streak');
    if (run.multi >= 2 && Math.random() < 0.5) squadTalk('praise');
    else if (info.weapon === 'knife' && e.backstabbed) popText('طعنة صامتة');
    else if (info.headshot) popText('إصابة في الرأس');
    if (run.kills === 1) unlockMedal('first');
    if (run.hs >= 25) unlockMedal('hs25');
    if (info.weapon !== 'ally') sfx.killConfirm(run.multi);
  }
  killFeed(e, info);
  if (Math.random() < 0.3) spawnPickup(e.pos, Math.random() < 0.5 ? 'med' : 'ammo');
  if (game.state === 'playing' && remaining() === 0) game.slowmo = 1.3;
}

export function onPlayerDied() {
  game.state = 'dying';
  if (focus.active) setFocus(false);
  music.stinger('death');
  music.setState('silent');
  releaseAll();
  setTimeout(() => { if (game.state === 'dying') endRun(false); }, 2800);
}

export function endRun(won) {
  if (game.state === 'over') return;
  game.state = 'over';
  if (focus.active) setFocus(false);
  setStorm(false);
  unlockPointer();
  releaseAll();
  showHUD(false);
  const report = finalizeRun(won || run.won);
  openAAR(report);
  setTimeout(() => music.setState('menu'), 2500);
}
