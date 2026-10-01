import * as THREE from 'three';
import { TAU, arNum, clamp, fmtClock, fmtNum, pick } from '../core/utils.js';
import { camera, grade } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { game, run, enemies, pickups, refs, allies } from '../core/state.js';
import { settings } from '../config/settings.js';
import { WEAPONS, SUPPORTS, FOCUS } from '../config/balance.js';
import { TEX } from '../assets/textures.js';
import { player } from '../entities/player.js';
import { inv, weaponState, currentKey, carried } from '../weapons/arsenal.js';
import { isTouch } from '../config/settings.js';
import { playerNade, nadeThreats } from '../weapons/grenades.js';
import { focus } from '../systems/focus.js';
import { support, supportStatus, supportCost, uavActive } from '../systems/support.js';
import { rankIndex } from '../systems/progression.js';
import { WEAPON_ICONS, HEADSHOT, SUPPORT_ICONS, rankInsignia, medalIcon } from './icons.js';
import { drawTacMap } from './tacmap.js';
import { zoneAt } from '../world/zones.js';
import { MAP_INFO } from '../world/map.js';
import { $, el, replay, setText, esc } from './dom.js';

/* Everything drawn over the 3D view while playing. */

export function showHUD(on) {
  $('hud').hidden = !on;
  $('killedBy').hidden = true;
  document.body.classList.toggle('playing', on);
  if (on) {
    $('rankMini').innerHTML = rankInsignia(rankIndex(), 34);
    buildSupportBar();
    updateAmmoHUD(true);
  } else {
    setMap(false);
    setDesignator(false);
    $('scope').hidden = true;
  }
}

/* ---------- transient messages ---------- */
let msgTimer = 0, hintTimer = 0;
export function showMsg(text, ms = 1200) {
  const m = $('msg');
  m.textContent = text;
  m.classList.add('on');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('on'), ms);
}
export function hint(text) {
  const h = $('hint');
  // on phones a tip and the radio share the spot under the clock: wait for the radio to fall silent
  if (document.body.classList.contains('touch') && $('radio').classList.contains('on')) {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (document.body.classList.contains('playing')) hint(text); }, 300);
    return;
  }
  h.textContent = text;
  h.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => h.classList.remove('on'), 5500);
}
export function popText(t) { const p = $('pop'); p.textContent = t; replay(p); }
export function banner(time, title, sub) { setText('bTime', time); setText('bTitle', title); setText('bSub', sub); replay($('banner')); }
export function hitMarker(kill, head) {
  const h = $('hit');
  h.classList.toggle('kill', kill);
  h.classList.toggle('head', head);
  replay(h);
}
export function xpPopup(v, label) {
  const box = $('xpPops');
  const e = el('div', 'xp', `<b>+${fmtNum(v)}</b> <span>${esc(label)}</span>`);
  box.prepend(e);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => e.remove(), 2200);
}
/** Death card: who got you and from how far. */
export function showKilledBy(name, dist) {
  setText('kbName', name);
  setText('kbInfo', dist ? `من مسافة ${dist} متراً` : '');
  const k = $('killedBy');
  k.hidden = false;
  replay(k);
}
export function medalToast(M) {
  const t = $('medalToast');
  t.innerHTML = `${medalIcon(M.id, true)}<div><span class="mt-k">وسام جديد</span><b>${esc(M.name)}</b><span>${esc(M.desc)}</span></div>`;
  replay(t);
}
export function showDamageDir(from) {
  const dx = from.x - player.pos.x, dz = from.z - player.pos.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  const a = el('div', 'dmg-arc');
  a.style.transform = `rotate(${ang}rad)`;
  $('dmg').appendChild(a);
  setTimeout(() => a.remove(), 1200);
}
export function screenBlood(dmg) {
  if (!settings.blood || dmg < 4) return;
  const box = $('screenBlood');
  const n = dmg > 25 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const s = el('div', 'splat');
    const side = Math.random() < 0.5;
    s.style.backgroundImage = `url(${TEX.bloodScreen[Math.floor(Math.random() * TEX.bloodScreen.length)]})`;
    s.style.left = (side ? -8 + Math.random() * 20 : 70 + Math.random() * 30) + '%';
    s.style.top = (-10 + Math.random() * 90) + '%';
    s.style.setProperty('--s', (0.6 + Math.min(1, dmg / 30) * 0.8).toFixed(2));
    s.style.setProperty('--r', Math.floor(Math.random() * 360) + 'deg');
    box.appendChild(s);
    setTimeout(() => s.remove(), 2600);
  }
  while (box.children.length > 6) box.firstChild.remove();
}

/* ---------- kill feed ---------- */
export function killFeed(e, info) {
  const who = info.weapon === 'ally' ? 'الرقيب سالم' : info.weapon === 'enemyNade' ? 'نيران صديقة معادية' : 'أنت';
  const icon = WEAPON_ICONS[info.weapon] || WEAPON_ICONS.rifle;
  const item = el('div', 'kill' + (info.headshot ? ' hs' : '') + (info.weapon === 'ally' ? ' ally' : ''), `<span class="who">${who}</span>${icon}${info.headshot ? HEADSHOT : ''}<span class="vic"></span>`);
  item.querySelector('.vic').textContent = e.name;
  const feed = $('feed');
  feed.prepend(item);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => item.classList.add('out'), 5000);
  setTimeout(() => item.remove(), 5700);
}
export function clearFeed() { $('feed').innerHTML = ''; $('xpPops').innerHTML = ''; }

/* ---------- context prompt (take a weapon from a crate) ---------- */
let promptText = null;
export function setPrompt(t) {
  if (t === promptText) return;
  promptText = t;
  const p = $('prompt');
  p.textContent = isTouch ? t.replace('اضغط E', 'اضغط «أخذ»') : t;
  p.hidden = !t;
  document.body.classList.toggle('can-use', !!t);
}

/* ---------- weapon panel ---------- */
let roundsFor = null;
export function updateAmmoHUD(rebuild) {
  const key = currentKey(), W = WEAPONS[key], A = inv.ammo[key];
  if (!A) return;
  setText('mag', A.mag);
  setText('reserve', '/ ' + A.res);
  setText('wName', W.full);
  setText('wMode', W.mode);
  $('mag').classList.toggle('low', A.mag <= Math.ceil(W.mag * 0.2));
  const rounds = $('rounds');
  if (rebuild || roundsFor !== key) {
    roundsFor = key;
    $('weaponIcon').innerHTML = WEAPON_ICONS[key];
    $('wList').innerHTML = carried().map((k, i) => `<span class="${k === key ? 'on' : ''}"><em>${k === 'pistol' ? 2 : 1}</em>${WEAPON_ICONS[k]}</span>`).join('');
    rounds.innerHTML = '';
    rounds.classList.toggle('shells', !!W.pellets);
    for (let k = 0; k < W.mag; k++) rounds.appendChild(document.createElement('i'));
  }
  const kids = rounds.children;
  for (let k = 0; k < kids.length; k++) kids[k].classList.toggle('spent', k >= A.mag);
  const n = $('nades');
  if (n.children.length !== inv.nades) { n.innerHTML = ''; for (let k = 0; k < inv.nades; k++) n.appendChild(document.createElement('i')); }
}

/* ---------- support bar ---------- */
function buildSupportBar() {
  const bar = $('supportBar');
  bar.innerHTML = '';
  for (const s of SUPPORTS) {
    const b = el('button', 'sup', `<span class="sup-ico">${SUPPORT_ICONS[s.id]}</span><span class="sup-txt"><b>${s.short}</b><em>${s.cost}</em></span><kbd>${s.key}</kbd><i class="sup-fill"></i>`);
    b.type = 'button';
    b.dataset.id = s.id;
    b.setAttribute('aria-label', `${s.name} — ${s.desc}`);
    bar.appendChild(b);
  }
}
function updateSupportBar() {
  for (const b of $('supportBar').children) {
    const s = SUPPORTS.find((x) => x.id === b.dataset.id);
    const st = supportStatus(s.id), cd = support.cd[s.id];
    const cost = supportCost(s.id);
    b.querySelector('em').textContent = cost;
    const frac = cd > 0 ? 1 - cd / s.cd : clamp(run.sp / cost, 0, 1);
    b.classList.toggle('ready', st.ok);
    b.classList.toggle('cool', cd > 0);
    b.querySelector('.sup-fill').style.transform = `scaleY(${frac.toFixed(3)})`;
  }
}

/* ---------- overlays ---------- */
export function setDesignator(on) { $('binoc').hidden = !on; document.body.classList.toggle('designating', on); }
let mapOn = false;
/* ---------- a raider's last words when taken down with the knife (written, never spoken) ---------- */
const LAST_WORDS = ['أيها الوغد… لقد نلت مني…', 'من أين… جئت؟', 'لا… ليس هكذا…', 'تبّاً لك…', 'لم أرك… قادماً…', 'أمي…'];
let lastWordsT = 0;
export function lastWords(name) {
  const box = $('speech');
  box.querySelector('.sp-who').textContent = name;
  box.querySelector('.sp-text').textContent = pick(LAST_WORDS);
  box.classList.add('on');
  clearTimeout(lastWordsT);
  lastWordsT = setTimeout(() => box.classList.remove('on'), 2600);
}

export function setMap(on) {
  mapOn = on;
  $('tacmap').hidden = !on;
  if (on) $('tmTitle').textContent = `الخريطة التكتيكية · ${MAP_INFO.name}`;
}
/** Q pressed with too little focus: the meter shakes. */
export function focusDenied() {
  const b = $('focusBox');
  b.classList.remove('deny');
  void b.offsetWidth;
  b.classList.add('deny');
}
export const mapOpen = () => mapOn;

/* ---------- compass ---------- */
const compass = $('compass'), cctx = compass.getContext('2d');
const CARD = { 0: 'ش', 90: 'ق', 180: 'ج', 270: 'غ' };
const bearingTo = (x, z) => ((Math.atan2(x - player.pos.x, -(z - player.pos.z)) * 180) / Math.PI + 360) % 360;
function drawCompass() {
  const W = compass.width, H = compass.height, cx = W / 2, span = 80, k = W / 2 / span;
  cctx.clearRect(0, 0, W, H);
  const g = cctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(18,14,11,0)'); g.addColorStop(0.2, 'rgba(18,14,11,.55)'); g.addColorStop(0.8, 'rgba(18,14,11,.55)'); g.addColorStop(1, 'rgba(18,14,11,0)');
  cctx.fillStyle = g; cctx.fillRect(0, 12, W, 40);
  const heading = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
  const rel = (b) => ((b - heading + 540) % 360) - 180;
  cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 5) {
    const x = cx + rel(d) * k;
    if (x < 0 || x > W) continue;
    cctx.globalAlpha = 1 - Math.abs(x - cx) / cx;
    if (CARD[d] !== undefined) { cctx.fillStyle = d === 0 ? '#ffb36b' : '#f6efe3'; cctx.font = '700 26px Changa, sans-serif'; cctx.fillText(CARD[d], x, 32); }
    else if (d % 15 === 0) { cctx.fillStyle = '#d6cab6'; cctx.font = '500 17px Oswald, sans-serif'; cctx.fillText(String(d), x, 34); }
    else { cctx.fillStyle = '#998d7a'; cctx.fillRect(x - 1, 42, 2, 8); }
  }
  const kd = tod.keyDir, sb = ((Math.atan2(kd.x, -kd.z) * 180) / Math.PI + 360) % 360, sx = cx + rel(sb) * k;
  if (sx > 0 && sx < W) {
    cctx.globalAlpha = 1 - Math.abs(sx - cx) / cx;
    cctx.fillStyle = tod.isSun ? '#ffc46b' : '#dfe6ff';
    cctx.beginPath(); cctx.arc(sx, 8, 6, 0, TAU); cctx.fill();
    if (!tod.isSun) { cctx.fillStyle = '#15110e'; cctx.beginPath(); cctx.arc(sx + 3, 6, 5, 0, TAU); cctx.fill(); }
  }
  const reveal = uavActive();
  for (const e of enemies) {
    if (!e.alive || (e.spotted <= 0 && !reveal && !(e.static && e.charge > 0))) continue;
    const x = cx + rel(bearingTo(e.pos.x, e.pos.z)) * k;
    if (x < 0 || x > W) continue;
    cctx.globalAlpha = reveal ? 1 : clamp(e.spotted, 0.4, 1);
    cctx.fillStyle = e.static ? '#ffd24a' : '#ff5a4a';
    cctx.beginPath(); cctx.moveTo(x, 66); cctx.lineTo(x - 7, 56); cctx.lineTo(x + 7, 56); cctx.closePath(); cctx.fill();
  }
  const mark = (x, z, color) => {
    const px = cx + rel(bearingTo(x, z)) * k;
    if (px < 0 || px > W) return;
    cctx.globalAlpha = 0.95; cctx.fillStyle = color;
    cctx.fillRect(px - 5, 60, 10, 3); cctx.fillRect(px - 1.5, 56.5, 3, 10);
  };
  for (const p of pickups) mark(p.g.position.x, p.g.position.z, p.kind === 'supply' ? '#7fe0a0' : '#9be38a');
  for (const a of allies) { if (!a.alive) continue; const px = cx + rel(bearingTo(a.pos.x, a.pos.z)) * k; if (px > 0 && px < W) { cctx.globalAlpha = 1; cctx.fillStyle = '#7fe0a0'; cctx.beginPath(); cctx.arc(px, 61, 5, 0, TAU); cctx.fill(); } }
  cctx.globalAlpha = 1; cctx.fillStyle = '#ffb36b';
  cctx.beginPath(); cctx.moveTo(cx, 14); cctx.lineTo(cx - 6, 4); cctx.lineTo(cx + 6, 4); cctx.closePath(); cctx.fill();
}

/* ---------- heartbeat line ---------- */
const ecg = $('ecg'), ectx = ecg.getContext('2d');
const ecgData = new Float32Array(210);
let ecgPhase = 0, ecgAcc = 0;
const wave = (p) => 0.12 * Math.exp(-((p - 0.12) ** 2) / 0.0012) - 0.15 * Math.exp(-((p - 0.28) ** 2) / 0.00012) + Math.exp(-((p - 0.3) ** 2) / 0.00018) - 0.28 * Math.exp(-((p - 0.325) ** 2) / 0.00015) + 0.22 * Math.exp(-((p - 0.55) ** 2) / 0.003);
function drawEcg(dt) {
  const bpm = player.alive ? 64 + (100 - player.hp) * 0.95 + (focus.active ? 35 : 0) + (player.sprinting ? 25 : 0) : 0;
  ecgAcc += dt * 90;
  while (ecgAcc >= 1) {
    ecgAcc -= 1;
    ecgPhase = (ecgPhase + bpm / 60 / 90) % 1;
    ecgData.copyWithin(0, 1);
    ecgData[ecgData.length - 1] = player.alive ? wave(ecgPhase) : 0;
  }
  const W = ecg.width, H = ecg.height;
  ectx.clearRect(0, 0, W, H);
  ectx.lineWidth = 3;
  ectx.strokeStyle = player.hp > 60 ? '#f6efe3' : player.hp > 30 ? '#ffb36b' : '#ff5a4a';
  ectx.shadowColor = ectx.strokeStyle; ectx.shadowBlur = 8;
  ectx.beginPath();
  for (let i = 0; i < ecgData.length; i++) {
    const x = (i / (ecgData.length - 1)) * W, y = H * 0.62 - ecgData[i] * H * 0.5;
    if (i) ectx.lineTo(x, y); else ectx.moveTo(x, y);
  }
  ectx.stroke();
  ectx.shadowBlur = 0;
}

/* ---------- world-anchored markers (recon, ally, supply) ---------- */
const markerPool = [];
const _p = new THREE.Vector3();
function placeMarkers() {
  const list = [];
  if (uavActive()) for (const e of enemies) if (e.alive) list.push([e.pos.x, e.pos.y + 2.1, e.pos.z, 'enemy', '']);
  for (const e of enemies) if (e.alive && e.static && e.charge > 0.2) list.push([e.pos.x, e.pos.y + 2.3, e.pos.z, 'sniper', 'قنّاص']);
  for (const a of allies) if (a.alive && a.landed) list.push([a.pos.x, a.pos.y + 2.2, a.pos.z, 'ally', a.short]);
  for (const p of pickups) if (p.kind === 'supply' && !p.opened) list.push([p.g.position.x, p.g.position.y + 1.6, p.g.position.z, 'supply', 'إمداد']);
  const box = $('markers'), w = innerWidth, h = innerHeight;
  while (markerPool.length < list.length) { const m = el('div', 'mk', '<i></i><span></span>'); box.appendChild(m); markerPool.push(m); }
  for (let i = 0; i < markerPool.length; i++) {
    const m = markerPool[i], it = list[i];
    if (!it) { m.hidden = true; continue; }
    const d = Math.round(camera.position.distanceTo(_p.set(it[0], it[1], it[2])));
    _p.project(camera);
    if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) { m.hidden = true; continue; }
    m.hidden = false;
    m.className = 'mk ' + it[3];
    m.querySelector('span').textContent = it[4] ? `${it[4]} · ${d}م` : `${d}م`;
    m.style.transform = `translate(${((_p.x + 1) / 2 * w).toFixed(0)}px, ${((1 - _p.y) / 2 * h).toFixed(0)}px)`;
  }
  // grenade warnings around the crosshair
  const nw = $('nadeWarn');
  nw.hidden = nadeThreats.length === 0;
  if (nadeThreats.length) {
    const g = nadeThreats[0];
    const dx = g.x - player.pos.x, dz = g.z - player.pos.z;
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    nw.style.setProperty('--a', Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) + 'rad');
  }
}

/* ---------- per-frame ---------- */
let fpsAcc = 0, fpsN = 0;
export function updateHUD(dt) {
  setText('hpNum', Math.ceil(player.hp));
  setText('arNum', Math.ceil(player.armor));
  $('hpBar').style.transform = `scaleX(${(player.hp / 100).toFixed(3)})`;
  $('arBar').style.transform = `scaleX(${(player.armor / 100).toFixed(3)})`;
  $('hpBar').classList.toggle('crit', player.hp <= 30);
  const st = $('stamina');
  st.classList.toggle('on', player.stamina < 99);
  $('stBar').style.transform = `scaleX(${(player.stamina / 100).toFixed(3)})`;
  setText('clock', fmtClock(game.hour));
  setText('zoneName', zoneAt(player.pos.x, player.pos.z));
  const left = game.toSpawn + enemies.length;
  const label = game.mode === 'dusk' ? `الموجة ${arNum(game.wave + 1)} من ٨` : `الموجة ${arNum(game.wave + 1)}`;
  setText('waveInfo', game.inter > 0 ? 'استراحة قصيرة · إعادة تمركز' : `${label} · المتبقون ${arNum(left)}`);
  setText('scoreNum', fmtNum(run.score));
  setText('spNum', fmtNum(run.sp));
  $('focusBar').style.transform = `scaleX(${(focus.meter / 100).toFixed(3)})`;
  $('focusBox').classList.toggle('ready', focus.active || focus.meter >= FOCUS.min);
  $('focusBox').classList.toggle('on', focus.active);
  updateSupportBar();

  const xh = $('xh');
  xh.dataset.style = settings.crosshair;
  xh.style.setProperty('--gap', weaponState.spreadPx.toFixed(1) + 'px');
  // aimed in, the sight itself is the aim point (reticle, ghost ring or iron sights): no crosshair over it
  // over iron sights a small dot marks the exact point of aim, just above the front sight
  const irons = WEAPONS[currentKey()].sight === 'iron' && weaponState.ads > 0.6;
  xh.classList.toggle('irons', irons);
  xh.style.opacity = (weaponState.scoped || support.designating || player.sprinting ? 0 : irons ? 1 : Math.max(0, 1 - weaponState.ads * 1.4)).toFixed(2);
  $('scope').hidden = !weaponState.scoped;
  const ring = $('reloadRing');
  ring.hidden = weaponState.reload <= 0 || weaponState.shells;
  if (!ring.hidden) $('reloadArc').style.strokeDashoffset = (125.7 * (weaponState.reload / weaponState.reloadDur)).toFixed(1);
  const cook = $('cookRing');
  cook.hidden = !playerNade.cooking;
  if (playerNade.cooking) $('cookArc').style.strokeDashoffset = (125.7 * (playerNade.cookT / 3)).toFixed(1);

  const heli = refs.heli;
  $('boss').hidden = !(heli && heli.state !== 'dead' && heli.state !== 'crash');
  if (heli) $('bossBar').style.transform = `scaleX(${clamp(heli.hp / heli.maxHp, 0, 1).toFixed(3)})`;
  if (support.designating) {
    setText('binocDist', support.valid ? Math.round(support.dist) + ' م' : '—');
    $('binocWarn').hidden = !(support.valid && support.dist < 15);
  }
  drawCompass();
  drawEcg(dt);
  placeMarkers();
  if (mapOn) drawTacMap($('tacCanvas'), true);

  const low = clamp((45 - player.hp) / 45, 0, 1);
  const pulse = low > 0 ? (0.5 + 0.5 * Math.sin(performance.now() * 0.006)) * low * 0.5 : 0;
  $('hurt').style.opacity = Math.min(1, player.hurtFx * 0.85 + pulse).toFixed(3);
  grade.uniforms.uHurt.value = player.hurtFx;
  grade.uniforms.uLow.value = low;
}
export function updateFps(dt) {
  const f = $('fps');
  f.hidden = !settings.fps;
  if (!settings.fps) return;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { f.textContent = Math.round(fpsN / fpsAcc) + ' FPS'; fpsAcc = 0; fpsN = 0; }
}
