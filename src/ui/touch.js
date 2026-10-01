import { isTouch } from '../config/settings.js';
import { game } from '../core/state.js';
import { SUPPORTS } from '../config/balance.js';
import { input } from '../input/input.js';
import { player, applyLook } from '../entities/player.js';
import { startReload, switchSlot, melee } from '../weapons/arsenal.js';
import { useNearest } from '../systems/pickups.js';
import { nadeDown, nadeUp } from '../weapons/grenades.js';
import { setFocus, focus } from '../systems/focus.js';
import { callSupport, supportStatus, supportCost } from '../systems/support.js';
import { setMap, mapOpen } from './hud.js';
import { pause } from './screens.js';
import { SUPPORT_ICONS } from './icons.js';
import { $, $$ } from './dom.js';

/*
 * Mobile controls. Left half: a joystick appears wherever the thumb lands (push it far forward
 * to sprint). Right half: drag to look. The fire button also looks while held, so you can
 * shoot and track a target with one thumb.
 */

const R = 56;
export function initTouch() {
  if (!isTouch) return;
  document.body.classList.add('touch');
  const zoneL = $('tZoneL'), zoneR = $('tZoneR'), base = $('tStick'), knob = $('tKnob');
  let sid = null, sx = 0, sy = 0;
  zoneL.addEventListener('pointerdown', (e) => {
    if (sid !== null || game.state !== 'playing') return;
    sid = e.pointerId; sx = e.clientX; sy = e.clientY;
    zoneL.setPointerCapture(sid);
    base.style.transform = `translate(${sx - R}px, ${sy - R}px)`;
    base.classList.add('on');
  });
  zoneL.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    let dx = (e.clientX - sx) / R, dy = (e.clientY - sy) / R;
    const l = Math.hypot(dx, dy);
    input.sprint = dy < -1.25;
    if (l > 1) { dx /= l; dy /= l; }
    input.stickX = dx; input.stickY = -dy;
    knob.style.transform = `translate(${dx * R * 0.7}px, ${dy * R * 0.7}px)`;
  });
  const endStick = (e) => {
    if (e.pointerId !== sid) return;
    sid = null; input.stickX = input.stickY = 0; input.sprint = false;
    knob.style.transform = ''; base.classList.remove('on');
  };
  zoneL.addEventListener('pointerup', endStick);
  zoneL.addEventListener('pointercancel', endStick);

  const looks = new Map();
  const startLook = (e) => { looks.set(e.pointerId, [e.clientX, e.clientY]); };
  const moveLook = (e) => {
    const p = looks.get(e.pointerId);
    if (!p || game.state !== 'playing') return;
    applyLook((e.clientX - p[0]) * 1.4, (e.clientY - p[1]) * 1.4, 'touch');
    looks.set(e.pointerId, [e.clientX, e.clientY]);
  };
  const endLook = (e) => looks.delete(e.pointerId);
  zoneR.addEventListener('pointerdown', (e) => { zoneR.setPointerCapture(e.pointerId); startLook(e); });
  zoneR.addEventListener('pointermove', moveLook);
  zoneR.addEventListener('pointerup', endLook);
  zoneR.addEventListener('pointercancel', endLook);

  for (const b of $$('#tBtns [data-t]')) {
    const t = b.dataset.t;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      b.classList.add('down');
      if (t === 'fire') { input.fire = true; startLook(e); }
      else if (t === 'aim') { input.aim = !input.aim; b.classList.toggle('lit', input.aim); }
      else if (t === 'jump') input.jump = true;
      else if (t === 'crouch') { input.crouch = !input.crouch; b.classList.toggle('lit', input.crouch); }
      else if (t === 'reload') startReload();
      else if (t === 'melee') melee();
      else if (t === 'use') useNearest();
      else if (t === 'swap') switchSlot('toggle');
      else if (t === 'nade') nadeDown();
      else if (t === 'focus') setFocus(!focus.active, player.alive);
      else if (t === 'support') $('tSupport').hidden = !$('tSupport').hidden;
      else if (t === 'map') setMap(!mapOpen());
      else if (t === 'pause') pause();
    });
    if (t === 'fire') b.addEventListener('pointermove', moveLook);
    const up = (e) => {
      b.classList.remove('down');
      if (t === 'fire') { input.fire = false; endLook(e); }
      if (t === 'nade') nadeUp();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }

  const panel = $('tSupport');
  panel.innerHTML = SUPPORTS.map((s) => `<button type="button" data-sup="${s.id}"><span>${SUPPORT_ICONS[s.id]}</span><b>${s.short}</b><em>${s.cost}</em></button>`).join('');
  panel.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    callSupport(b.dataset.sup);
    panel.hidden = true;
  });
}

/** Grey out support buttons that cannot be called right now. */
export function updateTouch() {
  if (!isTouch) return;
  const panel = $('tSupport');
  if (panel.hidden) return;
  for (const b of panel.children) { b.classList.toggle('ready', supportStatus(b.dataset.sup).ok); b.querySelector('em').textContent = supportCost(b.dataset.sup); }
}
