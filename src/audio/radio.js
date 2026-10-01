import { sfx } from './sfx.js';

/*
 * Radio traffic: the squelch of the handset and an Arabic subtitle with the speaker's call sign.
 * Nothing is read aloud: the words are written, never spoken by a generated voice.
 */

const queue = [];
let busy = false, token = 0;

/** who: 'hq' (command), 'ally', 'enemy' (intercepted). `callsign` overrides the label. */
export function radio(text, who = 'hq', priority = false, callsign = '') {
  const item = { text, who, callsign };
  if (priority) queue.unshift(item); else queue.push(item);
  if (queue.length > 4) queue.length = 4;
  if (!busy) next();
}
const CALLSIGN = { hq: 'القيادة', ally: 'الرفيق', enemy: 'اتصال معادٍ ملتقط' };
function next() {
  // on phones the radio shares its spot under the clock with the opening tips: a tip finishes first
  if (queue.length && document.body.classList.contains('touch') && document.getElementById('hint')?.classList.contains('on')) {
    busy = true;
    const my = token;
    setTimeout(() => { if (my === token) next(); }, 400);
    return;
  }
  const item = queue.shift();
  const box = document.getElementById('radio');
  if (!item) { busy = false; box?.classList.remove('on'); return; }
  busy = true;
  const my = ++token;
  sfx.radio(true);
  if (box) {
    box.dataset.who = item.who;
    box.querySelector('.r-who').textContent = item.callsign || CALLSIGN[item.who] || '';
    box.querySelector('.r-text').textContent = item.text;
    box.classList.add('on');
  }
  setTimeout(() => {
    if (my !== token) return;
    sfx.radio(false);
    box?.classList.remove('on');
    setTimeout(next, 280);
  }, Math.max(2200, item.text.length * 70));
}
export function clearRadio() {
  queue.length = 0;
  token++;
  busy = false;
  document.getElementById('radio')?.classList.remove('on');
}
