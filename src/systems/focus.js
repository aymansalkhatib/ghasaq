import { FOCUS } from '../config/balance.js';
import { run } from '../core/state.js';
import { sfx } from '../audio/sfx.js';
import { showMsg, focusDenied } from '../ui/hud.js';
import { unlockMedal } from './progression.js';

/*
 * Focus: headshots and kills fill a meter; spending it slows the world to a third of its speed
 * while the player keeps most of theirs. Kills during one focus count toward a medal.
 */

export const focus = { meter: 0, active: false, hb: 0, readyShown: false, kills: 0 };

/** Every run starts with enough focus for one use, so Q does something from the first wave. */
export function resetFocus() { Object.assign(focus, { meter: FOCUS.start, active: false, hb: 0, readyShown: true, kills: 0 }); }

export function setFocus(on, alive = true) {
  if (on === focus.active) return;
  if (on && (focus.meter < FOCUS.min || !alive)) {
    showMsg('التركيز غير جاهز · املأ العدّاد بالإصابات في الرأس والقتل', 1800);
    focusDenied();
    return;
  }
  focus.active = on;
  if (on) { focus.kills = 0; showMsg('تركيز · الزمن يتباطأ', 1100); }
  sfx.focus(on);
}
export function addFocus(v) {
  focus.meter = Math.min(100, focus.meter + v);
  if (focus.meter >= FOCUS.min && !focus.readyShown && !focus.active) { focus.readyShown = true; showMsg('التركيز جاهز · اضغط Q', 1800); }
}
export function focusKill() {
  if (!focus.active) return;
  focus.kills++;
  run.focusKills = Math.max(run.focusKills, focus.kills);
  if (focus.kills >= 5) unlockMedal('focus5');
}
export function updateFocus(dt) {
  if (!focus.active) return;
  focus.meter -= dt * FOCUS.drain;
  focus.hb -= dt;
  if (focus.hb <= 0) { focus.hb = 0.75; sfx.heartbeat(); }
  if (focus.meter <= 0) { focus.meter = 0; setFocus(false); }
}
export const worldTimeScale = () => (focus.active ? FOCUS.timeScale : 1);
