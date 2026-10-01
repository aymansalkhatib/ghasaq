import { clamp, store } from '../core/utils.js';
import { game, run } from '../core/state.js';
import { RANKS, MEDALS, SKINS, WEAPONS, MODES, DIFFICULTY, PRIMARIES } from '../config/balance.js';
import { sfx } from '../audio/sfx.js';
import { xpPopup, medalToast } from '../ui/hud.js';

/*
 * The service record: XP and rank, unlocks, medals, star ratings and the local leaderboard.
 * Saved in localStorage so it survives between sessions.
 */

const KEY = 'ghasaq.profile.v2';
const DEFAULT = () => ({
  xp: 0, loadout: 'rifle', skin: 'std', diff: 'veteran', mode: 'dusk', map: 'citadel', medals: {},
  totals: { kills: 0, hs: 0, runs: 0, wins: 0, barrelKills: 0, heliDowns: 0, shots: 0, hits: 0, playTime: 0, bestHour: 0, allyKills: 0 },
  best: { dusk: [], dawn: [] },
  stars: { recruit: 0, veteran: 0, legend: 0 },
  firstRun: true,
});
export const profile = Object.assign(DEFAULT(), store.get(KEY, {}));
profile.totals = Object.assign(DEFAULT().totals, profile.totals);
// carry over the best hour from the first version of the game
const legacy = store.get('ghasaq.record', null);
if (legacy && !profile.migrated) { profile.totals.bestHour = Math.max(profile.totals.bestHour, legacy.hour || 0); profile.migrated = true; }
export function saveProfile() { store.set(KEY, profile); }

export function rankIndex(xp = profile.xp) {
  let i = 0;
  while (i < RANKS.length - 1 && xp >= RANKS[i + 1].xp) i++;
  return i;
}
export function rankProgress(xp = profile.xp) {
  const idx = rankIndex(xp), rank = RANKS[idx], next = RANKS[idx + 1];
  return { idx, rank, next, frac: next ? clamp((xp - rank.xp) / (next.xp - rank.xp), 0, 1) : 1 };
}
export const weaponUnlocked = (id) => rankIndex() >= WEAPONS[id].rank;
export const skinUnlocked = (id) => rankIndex() >= SKINS.find((s) => s.id === id).rank;
export const modeUnlocked = (id) => rankIndex() >= MODES[id].rank;

/** Adds score/XP (scaled by difficulty) and support points (raw). */
export function award(label, pts, opts = {}) {
  const v = Math.round(pts * DIFFICULTY[game.diff].xpMul);
  run.score += v;
  if (!opts.noSupport) run.sp += pts;
  const line = run.lines[label] || (run.lines[label] = { count: 0, pts: 0 });
  line.count++;
  line.pts += v;
  if (!opts.silent) xpPopup(v, label);
}

export function unlockMedal(id) {
  if (profile.medals[id] || run.medals.includes(id)) return;
  const M = MEDALS.find((m) => m.id === id);
  if (!M) return;
  run.medals.push(id);
  profile.medals[id] = Date.now();
  saveProfile();
  medalToast(M);
  sfx.medal();
  award('وسام: ' + M.name, M.xp, { silent: true, noSupport: true });
}

/** Grade letter and stars for the finished run. */
function rate(won) {
  const target = game.mode === 'dusk' ? 8 : 13;
  const reach = clamp(run.wavesCleared / target, 0, 1);
  const acc = run.shots ? run.hits / run.shots : 0;
  const hsr = run.kills ? run.hs / run.kills : 0;
  const hurt = clamp(run.dmgTaken / (100 * (run.wavesCleared + 1)), 0, 1);
  const perf = reach * 45 + clamp(acc / 0.5, 0, 1) * 20 + clamp(hsr / 0.5, 0, 1) * 15 + (1 - hurt) * 20;
  const grade = perf >= 88 ? 'S' : perf >= 75 ? 'A' : perf >= 60 ? 'B' : perf >= 45 ? 'C' : 'D';
  let stars = 0;
  if (game.mode === 'dusk') {
    if (run.wavesCleared >= 4) stars = 1;
    if (won) stars = 2;
    if (won && (grade === 'S' || grade === 'A')) stars = 3;
  } else stars = run.wavesCleared >= 13 ? 3 : run.wavesCleared >= 10 ? 2 : run.wavesCleared >= 6 ? 1 : 0;
  return { grade, stars, perf: Math.round(perf) };
}

/** Commits the run to the profile and returns the after-action report. */
export function finalizeRun(won) {
  const before = profile.xp, rankBefore = rankIndex(before);
  const { grade, stars, perf } = rate(won);
  const T = profile.totals;
  T.kills += run.kills; T.hs += run.hs; T.runs++; if (won) T.wins++;
  T.barrelKills += run.barrelKills; T.heliDowns += run.heliDowns; T.shots += run.shots; T.hits += run.hits;
  T.playTime += run.time; T.allyKills += run.allyKills;
  T.bestHour = Math.max(T.bestHour, game.hour);
  profile.xp += run.score;
  const rankAfter = rankIndex(profile.xp);
  const unlocks = [];
  for (let r = rankBefore + 1; r <= rankAfter; r++) {
    for (const id of PRIMARIES) if (WEAPONS[id].rank === r) unlocks.push({ kind: 'سلاح', name: WEAPONS[id].full });
    for (const s of SKINS) if (s.rank === r) unlocks.push({ kind: 'طلاء', name: s.name });
    for (const [id, m] of Object.entries(MODES)) if (m.rank === r) unlocks.push({ kind: 'وضع', name: m.name });
  }
  const board = profile.best[game.mode] || (profile.best[game.mode] = []);
  const entry = { score: run.score, hour: game.hour, kills: run.kills, grade, diff: game.diff, date: Date.now() };
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  board.length = Math.min(board.length, 5);
  const place = board.indexOf(entry);
  if (game.mode === 'dusk') profile.stars[game.diff] = Math.max(profile.stars[game.diff] || 0, stars);
  profile.firstRun = false;
  saveProfile();
  const lines = Object.entries(run.lines).map(([label, l]) => ({ label, count: l.count, pts: l.pts })).sort((a, b) => b.pts - a.pts);
  return {
    won, mode: game.mode, diff: game.diff, hour: game.hour, score: run.score, lines, grade, stars, perf,
    xpBefore: before, xpAfter: profile.xp, rankBefore, rankAfter, unlocks, place,
    medals: run.medals.map((id) => MEDALS.find((m) => m.id === id)),
    stats: { kills: run.kills, hs: run.hs, acc: run.shots ? Math.round((run.hits / run.shots) * 100) : 0, streak: run.bestStreak, time: run.time, waves: run.wavesCleared },
  };
}
