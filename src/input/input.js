import { canvas } from '../core/renderer.js';
import { game } from '../core/state.js';
import { isTouch } from '../config/settings.js';

/*
 * Raw input state from keyboard, mouse and gamepad. Touch controls write into the same
 * object from ui/touch.js. One-shot actions (reload, supports, pause…) are dispatched to
 * handlers registered with onAction().
 */

export const input = {
  kb: { f: 0, b: 0, l: 0, r: 0 },
  stickX: 0, stickY: 0, padX: 0, padY: 0,
  fire: false, aim: false, jump: false, sprint: false, crouch: false,
  swayX: 0, swayY: 0,
};
export function moveVector() {
  let x = input.kb.r - input.kb.l + input.stickX + input.padX;
  let y = input.kb.f - input.kb.b + input.stickY + input.padY;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}
export function releaseAll() {
  Object.assign(input.kb, { f: 0, b: 0, l: 0, r: 0 });
  input.fire = input.aim = input.jump = input.sprint = input.crouch = false;
  input.stickX = input.stickY = input.padX = input.padY = 0;
}

const handlers = {};
export function onAction(name, fn) { handlers[name] = fn; }
const act = (name, ...a) => handlers[name] && handlers[name](...a);

/* ---------- pointer lock (optional; without it the mouse still steers while moving over the page) ---------- */
let lockWorks = false;
function lockFailed() {
  if (!lockWorks) game.noLock = true;
  else if (game.state === 'playing') act('lockHint');
}
export function lockPointer() {
  if (isTouch) { game.noLock = true; return; }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(lockFailed);
  } catch { lockFailed(); }
}
export function unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) { lockWorks = true; game.noLock = false; }
  else if (game.state === 'playing' && !game.noLock) act('pause');
});
document.addEventListener('pointerlockerror', lockFailed);

/* ---------- keyboard ---------- */
const MOVE = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (game.state !== 'playing') { act('menuKey', e); return; }
  if (MOVE[e.code]) { input.kb[MOVE[e.code]] = 1; e.preventDefault(); return; }
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
    // crouch is C only: Ctrl combinations (Ctrl+W) are browser shortcuts that close the tab
    case 'KeyC': input.crouch = true; break;
    case 'KeyE': act('use'); break;
    case 'KeyR': act('reload'); break;
    case 'Digit1': act('weapon', 'primary'); break;
    case 'Digit2': act('weapon', 'secondary'); break;
    case 'KeyG': act('nadeDown'); break;
    case 'KeyQ': act('focus'); break;
    case 'KeyF': act('torch'); break;
    case 'KeyV': act('melee'); break;
    case 'Digit3': act('support', 'uav'); break;
    case 'Digit4': act('support', 'supply'); break;
    case 'Digit5': act('support', 'ally'); break;
    case 'Digit6': act('support', 'strike'); break;
    case 'Tab': act('map', true); e.preventDefault(); break;
    case 'KeyP': act('pause'); break;
    case 'Escape': act('escape'); break;
  }
});
addEventListener('keyup', (e) => {
  if (MOVE[e.code]) input.kb[MOVE[e.code]] = 0;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
  if (e.code === 'KeyC') input.crouch = false;
  if (e.code === 'KeyG') act('nadeUp');
  if (e.code === 'Tab') act('map', false);
});
addEventListener('blur', () => { releaseAll(); act('blur'); });

/* ---------- mouse ---------- */
canvas.addEventListener('mousedown', (e) => {
  if (game.state !== 'playing' || isTouch) return;
  if (!document.pointerLockElement && !game.noLock) { lockPointer(); return; }
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.aim = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; if (e.button === 2) input.aim = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
/*
 * Chrome on Windows occasionally reports a huge movementX/Y under pointer lock (especially
 * right after locking), which snaps the view. Drop those spikes and ignore the first events
 * after a lock is acquired.
 */
let lockedAt = 0;
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement) lockedAt = performance.now(); });
addEventListener('mousemove', (e) => {
  if (game.state !== 'playing' || isTouch) return;
  if (!document.pointerLockElement && !game.noLock) return;
  if (performance.now() - lockedAt < 120) return;
  const dx = e.movementX, dy = e.movementY;
  if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return;
  act('look', Math.max(-120, Math.min(120, dx)), Math.max(-120, Math.min(120, dy)), 'mouse');
});
addEventListener('wheel', () => { if (game.state === 'playing') act('weapon', 'toggle'); }, { passive: true });

/* ---------- gamepad (standard mapping) ---------- */
const prev = [];
const dz = (v) => (Math.abs(v) < 0.15 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.15) / 0.85));
let navCool = 0;
export function pollGamepad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && Array.from(pads).find((p) => p && p.connected);
  if (!gp) return;
  const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
  const down = (i) => b(i) && !prev[i];
  const up = (i) => !b(i) && prev[i];
  if (game.state === 'playing') {
    input.padX = dz(gp.axes[0] || 0);
    input.padY = -dz(gp.axes[1] || 0);
    const lx = dz(gp.axes[2] || 0), ly = dz(gp.axes[3] || 0);
    if (lx || ly) {
      const curve = (v) => Math.sign(v) * Math.abs(v) ** 1.8;
      act('look', curve(lx) * 900 * dt, curve(ly) * 620 * dt, 'pad');
    }
    input.fire = b(7);
    input.aim = b(6);
    if (down(0)) input.jump = true;
    if (down(1)) input.crouch = !input.crouch;
    if (down(10)) input.sprint = !input.sprint;
    if (input.padY < 0.3) input.sprint = false;
    if (down(2)) act('reload');
    if (down(3)) act('use') || act('weapon', 'toggle');
    if (down(4)) act('nadeDown');
    if (up(4)) act('nadeUp');
    if (down(5)) act('focus');
    if (down(11)) act('melee');
    if (down(12)) act('support', 'uav');
    if (down(15)) act('support', 'supply');
    if (down(13)) act('support', 'ally');
    if (down(14)) act('support', 'strike');
    if (down(8)) act('map', true);
    if (up(8)) act('map', false);
    if (down(9)) act('pause');
  } else {
    navCool -= dt;
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    let dir = null;
    if (down(12) || (ay < -0.6 && navCool <= 0)) dir = 'up';
    else if (down(13) || (ay > 0.6 && navCool <= 0)) dir = 'down';
    else if (down(14) || (ax < -0.6 && navCool <= 0)) dir = 'left';
    else if (down(15) || (ax > 0.6 && navCool <= 0)) dir = 'right';
    if (dir) { navCool = 0.22; act('menuNav', dir); }
    if (down(0)) act('menuNav', 'ok');
    if (down(1)) act('menuNav', 'back');
    if (down(9)) act('menuNav', 'start');
  }
  for (let i = 0; i < gp.buttons.length; i++) prev[i] = b(i);
}
