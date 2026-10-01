import './styles/base.css';
import './styles/menus.css';
import './styles/hud.css';
import './styles/touch.css';

import * as THREE from 'three';
import { scene, camera, renderer, composer, vmScene, vmCamera, onResize, applyQuality } from './core/renderer.js';
import { buildSoldier } from './entities/soldier-model.js';
import { buildTransport, buildJet, buildUAV, buildHeli, buildParachute, buildSupplyCrate, buildBomb } from './vehicles/models.js';
import { setAllVisible } from './weapons/viewmodels.js';
import { applyTOD } from './core/sky.js';
import { game } from './core/state.js';
import { settings, onSettingsChange } from './config/settings.js';
import { buildTextures } from './assets/textures.js';
import { buildMaterials } from './assets/materials.js';
import { loadMap } from './world/map.js';
import { profile } from './systems/progression.js';
import { initAmbient } from './world/ambient.js';
import { initParticles } from './fx/particles.js';
import { initDecals } from './fx/decals.js';
import { initTracers } from './fx/tracers.js';
import { applyVolumes, setMuted, audio } from './audio/engine.js';
import { sfx } from './audio/sfx.js';
import { initSoldierMaterials } from './entities/soldier-model.js';
import { initEnemies } from './entities/enemy.js';
import { player, resetPlayer, applyLook } from './entities/player.js';
import { initViewmodels } from './weapons/viewmodels.js';
import { resetArsenal, startReload, switchSlot, melee } from './weapons/arsenal.js';
import { nadeDown, nadeUp } from './weapons/grenades.js';
import { focus, setFocus } from './systems/focus.js';
import { support, callSupport, cancelStrike } from './systems/support.js';
import { useNearest } from './systems/pickups.js';
import { onAction } from './input/input.js';
import { showMsg, setMap } from './ui/hud.js';
import { initScreens, showScreen, buildShowcase, updateMenuScene, pause, menuKey, menuNav } from './ui/screens.js';
import { initTouch } from './ui/touch.js';
import { frame } from './core/loop.js';
import { $ } from './ui/dom.js';

/* Boot: build every system in order while the loading screen shows progress. */

const TIPS = [
  'كل موجة ساعة من الزمن، والشمس تغرب أمامك موجةً بعد موجة.',
  'نقاط الإسناد تُكسب بالقتال وتُنفق على الطائرات والرفيق والغارة.',
  'الإصابة في الرأس تشحن التركيز، والتركيز يبطئ الزمن.',
  'المروحية المعادية تُنزل جنوداً بالحبال. أسقطها قبل أن تفرغ حمولتها.',
];
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
function progress(p, text) {
  $('bootBar').style.transform = `scaleX(${p})`;
  if (text) $('bootStep').textContent = text;
}

/*
 * Compile every shader the game can need (all soldier variants, aircraft, parachutes,
 * first-person weapons) behind the loading screen, so nothing stutters the first time it appears.
 */
function prewarm() {
  const g = new THREE.Group();
  const add = (o, x, y, z, s = 1) => { o.position.set(x, y, z); o.scale.multiplyScalar(s); g.add(o); };
  [['raider', 'grenadier'], ['night', 'sniper'], ['heavy', 'rifle'], ['ally', 'rifle']].forEach(([k, r], i) => add(buildSoldier(k, 7 + i, r).root, -1 + i, 0, 3));
  add(buildTransport().g, 0, 3, -6, 0.08);
  add(buildJet().g, 2, 2, -4, 0.15);
  add(buildUAV().g, -2, 2, -4, 0.4);
  add(buildHeli().g, 0, 1, -3, 0.2);
  add(buildParachute().g, 1, 0, 2, 0.3);
  add(buildSupplyCrate().g, -1, 0, 2);
  add(buildBomb(), 0, 0.5, 2);
  scene.add(g);
  setAllVisible(true);
  renderer.compile(scene, camera);
  renderer.compile(vmScene, vmCamera);
  composer.render();
  scene.remove(g);
  setAllVisible(false);
}

function bindActions() {
  onAction('look', applyLook);
  onAction('reload', startReload);
  onAction('weapon', (slot) => switchSlot(slot));
  onAction('nadeDown', nadeDown);
  onAction('nadeUp', nadeUp);
  onAction('focus', () => setFocus(!focus.active, player.alive));
  onAction('torch', () => { player.torch = !player.torch; sfx.click(2600, 0.2); });
  onAction('melee', melee);
  onAction('use', useNearest);
  onAction('support', callSupport);
  onAction('map', setMap);
  onAction('pause', pause);
  onAction('escape', () => { if (support.designating) cancelStrike(); else if (game.noLock) pause(); });
  onAction('lockHint', () => showMsg('انقر داخل الشاشة لقفل مؤشر الماوس', 2200));
  onAction('blur', () => { if (game.state === 'playing' && game.noLock) pause(); });
  onAction('menuKey', menuKey);
  onAction('menuNav', menuNav);
}

async function boot() {
  $('bootTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  await nextFrame();
  progress(0.1, 'رسم الرمال والحجر والخشب…');
  await nextFrame();
  buildTextures();
  progress(0.4, 'تجهيز الخامات والجنود والأسلحة…');
  await nextFrame();
  buildMaterials();
  initParticles(); initDecals(); initTracers();
  initSoldierMaterials(); initEnemies(); initViewmodels();
  progress(0.6, 'بناء ساحة المعركة…');
  await nextFrame();
  initAmbient();
  loadMap(profile.map || 'citadel');
  progress(0.85, 'تسخين المحرك…');
  await nextFrame();
  resetPlayer();
  resetArsenal('rifle');
  applyTOD(18.4);
  buildShowcase();
  updateMenuScene(0.016);
  prewarm();
  bindActions();
  // the old corner button kept its own mute flag: carry it over into the setting once
  if (audio.muted && !settings.muted) settings.muted = true;
  setMuted(!!settings.muted);
  onSettingsChange((key, value) => {
    if (key === 'muted' || key === '*') setMuted(!!settings.muted);
    if (key === 'quality' || key === 'grain' || key === '*') applyQuality();
    if (['master', 'music', 'sfx', '*'].includes(key)) applyVolumes();
    if (key === 'hudScale' || key === '*') document.documentElement.style.setProperty('--hud-scale', settings.hudScale);
  });
  document.documentElement.style.setProperty('--hud-scale', settings.hudScale);
  initScreens();
  initTouch();
  addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  progress(1, 'جاهز');
  game.state = 'splash';
  showScreen('splash');
  requestAnimationFrame(frame);
  // developer tool: #autotest-<scenario> runs a scripted scene (see src/dev/autotest.js); #touch-autotest-… forces touch UI
  const test = location.hash.match(/autotest-([\w-]+)/);
  if (test) import('./dev/autotest.js').then((m) => m.runAutotest(test[1]));
}

boot().catch((err) => {
  console.error(err);
  const e = $('err');
  e.hidden = false;
  e.textContent = 'تعذّر تشغيل اللعبة: ' + (err && err.message ? err.message : err);
});
