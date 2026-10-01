import { mulberry32 } from '../core/utils.js';
import { WEAPONS } from '../config/balance.js';
import { sfx } from '../audio/sfx.js';
import { profile, saveProfile, award, weaponUnlocked } from './progression.js';
import { medalToast } from '../ui/hud.js';

/*
 * Daily challenges: three tasks picked from a pool with a seed made from today's date, so every
 * player gets the same set each day. Progress carries across runs until midnight.
 */

const POOL = [
  { id: 'kills30', text: 'اقتل ٣٠ غازياً', target: 30, xp: 1500, ev: 'kill' },
  { id: 'hs10', text: 'حقّق ١٠ إصابات في الرأس', target: 10, xp: 1500, ev: 'headshot' },
  { id: 'rifle20', text: '٢٠ قتيلاً بالبندقية KH-7', target: 20, xp: 1400, ev: 'kill', weapon: 'rifle' },
  { id: 'smg15', text: '١٥ قتيلاً بالرشاش «زوبعة»', target: 15, xp: 1800, ev: 'kill', weapon: 'smg' },
  { id: 'shotgun10', text: '١٠ قتلى ببندقية الخرطوش', target: 10, xp: 1800, ev: 'kill', weapon: 'shotgun' },
  { id: 'dmr8', text: '٨ قتلى ببندقية القنص', target: 8, xp: 2000, ev: 'kill', weapon: 'dmr' },
  { id: 'pistol5', text: '٥ قتلى بالمسدس', target: 5, xp: 1600, ev: 'kill', weapon: 'pistol' },
  { id: 'knife3', text: '٣ طعنات قاتلة بالسكين', target: 3, xp: 2000, ev: 'kill', weapon: 'knife' },
  { id: 'nade5', text: '٥ قتلى بالقنابل', target: 5, xp: 1700, ev: 'kill', weapon: 'nade' },
  { id: 'barrel3', text: '٣ قتلى بالبراميل المتفجرة', target: 3, xp: 1500, ev: 'kill', weapon: 'barrel' },
  { id: 'sniper2', text: 'اقتل قنّاصَين على الأبراج', target: 2, xp: 1800, ev: 'kill', role: 'sniper' },
  { id: 'strike1', text: 'استدعِ غارة جوية', target: 1, xp: 1200, ev: 'support', support: 'strike' },
  { id: 'ally3', text: 'رفيقك يقتل ٣ غزاة', target: 3, xp: 1600, ev: 'allyKill' },
  { id: 'waves6', text: 'اصمد ٦ موجات', target: 6, xp: 1800, ev: 'wave' },
  { id: 'heli1', text: 'أسقط مروحية معادية', target: 1, xp: 2500, ev: 'heli' },
  { id: 'focus5', text: '٥ قتلى أثناء التركيز', target: 5, xp: 1600, ev: 'focusKill' },
];
const byId = Object.fromEntries(POOL.map((c) => [c.id, c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Today's three challenges, rolled once per calendar day. */
export function dailyChallenges() {
  const date = today();
  if (!profile.daily || profile.daily.date !== date) {
    let seed = 0;
    for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const r = mulberry32(seed);
    const pool = POOL.filter((c) => !c.weapon || !WEAPONS[c.weapon] || weaponUnlocked(c.weapon));
    const picked = [];
    while (picked.length < 3 && pool.length) picked.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    profile.daily = { date, items: picked.map((c) => ({ id: c.id, progress: 0, done: false })) };
    saveProfile();
  }
  return profile.daily.items.map((it) => ({ ...byId[it.id], ...it }));
}

/** Feed a gameplay event: kill {weapon, role}, headshot, support {support}, allyKill, wave, heli, focusKill. */
export function challengeEvent(ev, info = {}) {
  if (!profile.daily) dailyChallenges();
  let changed = false;
  for (const it of profile.daily.items) {
    const c = byId[it.id];
    if (!c || it.done || c.ev !== ev) continue;
    if (c.weapon && c.weapon !== info.weapon) continue;
    if (c.role && c.role !== info.role) continue;
    if (c.support && c.support !== info.support) continue;
    it.progress = Math.min(c.target, it.progress + 1);
    changed = true;
    if (it.progress >= c.target) {
      it.done = true;
      award('تحدٍّ يومي: ' + c.text, c.xp, { noSupport: true });
      medalToast({ id: 'daily', name: 'اكتمل تحدٍّ يومي', desc: `${c.text} · +${c.xp} XP` });
      sfx.medal();
    }
  }
  if (changed) saveProfile();
}

/** Time left until the challenges reset, for the menu card. */
export function resetsIn() {
  const now = new Date(), next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const m = Math.round((next - now) / 60000);
  return `${Math.floor(m / 60)}س ${m % 60}د`;
}
