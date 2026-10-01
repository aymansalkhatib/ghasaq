import { lerp, rand, randi } from '../core/utils.js';
import { camera } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { audio, now, out, tone, noiseShot } from './engine.js';
import { renderHeartbeat } from './heartbeat.js';

/* Every sound effect in the game. Each one is synthesized, so nothing needs loading. */

const ok = () => !!audio.ctx;
let wind = null, windLP = null, stormGain = null, cricketT = 0, chirpT = 4, farT = 2, boomT = 9;

/** A sound far off on the horizon: panned, muffled, washed in reverb. */
function farOut(pan, gain, lowpass) {
  const ctx = audio.ctx, p = ctx.createStereoPanner(), lp = ctx.createBiquadFilter();
  p.pan.value = pan;
  lp.type = 'lowpass'; lp.frequency.value = lowpass;
  lp.connect(p).connect(out(null, gain, 0.7));
  return lp;
}

export const sfx = {
  initAmbience() {
    if (!ok() || wind) return;
    const ctx = audio.ctx;
    const s = ctx.createBufferSource(); s.buffer = audio.noise; s.loop = true;
    windLP = ctx.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 420;
    wind = ctx.createGain(); wind.gain.value = 0.05;
    s.connect(windLP).connect(wind).connect(audio.sfxBus);
    s.start();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg).connect(windLP.frequency); lfo.start();
    // storm howl: a resonant band sweeping slowly
    const s2 = ctx.createBufferSource(); s2.buffer = audio.noise; s2.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 4;
    stormGain = ctx.createGain(); stormGain.gain.value = 0;
    s2.connect(bp).connect(stormGain).connect(audio.sfxBus); s2.start();
    const l2 = ctx.createOscillator(), l2g = ctx.createGain(); l2.frequency.value = 0.13; l2g.gain.value = 380; l2.connect(l2g).connect(bp.frequency); l2.start();
  },

  /* ---------- weapons ---------- */
  shot(kind, pos) {
    if (!ok()) return;
    const t = now();
    if (kind === 'enemy' || kind === 'heavy' || kind === 'ally' || kind === 'doorgun') {
      const o = out(pos, kind === 'doorgun' ? 1.6 : 1.3, 0.5);
      noiseShot(o, t, kind === 'heavy' ? 0.2 : 0.16, 0.9, 'bandpass', kind === 'ally' ? 1800 : 1500, 500, 0.7);
      tone(o, 'sine', t, 0.14, 0.9, kind === 'heavy' ? 95 : 120, 45);
      return;
    }
    if (kind === 'sniper') {
      const o = out(pos, 2.4, 0.9);
      noiseShot(o, t, 0.05, 1, 'highpass', 2500);
      noiseShot(o, t, 0.45, 1, 'lowpass', 3000, 200);
      tone(o, 'sine', t, 0.3, 1, 90, 30);
      return;
    }
    const o = out(null, 1.35, kind === 'dmr' ? 0.8 : kind === 'shotgun' ? 0.65 : 0.45);
    const P = {
      rifle: [0.1, 5200, 140, 0.16], smg: [0.07, 6800, 190, 0.1], pistol: [0.08, 6500, 180, 0.12],
      shotgun: [0.22, 3200, 95, 0.3], dmr: [0.16, 4200, 110, 0.28],
    }[kind] || [0.1, 5200, 140, 0.16];
    noiseShot(o, t, P[0], 0.95, 'lowpass', P[1], 700);
    noiseShot(o, t, 0.03, 0.7, 'highpass', 3000);
    tone(o, 'sine', t, P[3], 1, P[2], 38);
    tone(o, 'square', t, 0.04, 0.1, P[2] * 0.65, 60);
    // mechanical action: a tiny bolt clack after the report
    noiseShot(out(null, 0.18, 0), t + 0.035, 0.02, 0.8, 'bandpass', kind === 'smg' ? 4200 : 3200, 0, 6);
  },
  pump(delay = 0.12) {
    if (!ok()) return;
    const t = now() + delay, o = out(null, 0.6, 0.05);
    noiseShot(o, t, 0.05, 0.9, 'bandpass', 1500, 700, 3); tone(o, 'triangle', t, 0.05, 0.3, 380, 240);
    noiseShot(o, t + 0.16, 0.06, 1, 'bandpass', 2100, 900, 3); tone(o, 'triangle', t + 0.16, 0.05, 0.35, 520, 300);
  },
  shell() { if (ok()) { const t = now(), o = out(null, 0.45, 0.05); noiseShot(o, t, 0.05, 0.8, 'bandpass', 1200, 600, 2); tone(o, 'triangle', t, 0.05, 0.25, 700, 400); } },
  magOut() { this.click(900, 0.35); },
  /** A raider changing magazines somewhere nearby: a dull pull, then a click and the charging handle. */
  reloadAt(pos) {
    if (!ok()) return;
    const t = now(), o = out(pos, 0.55, 0.05);
    noiseShot(o, t, 0.05, 0.6, 'bandpass', 800, 0, 3);
    noiseShot(o, t + 0.9, 0.04, 0.8, 'bandpass', 1400, 0, 4);
    noiseShot(o, t + 1.35, 0.06, 0.7, 'bandpass', 1900, 900, 3);
  },
  magIn() { this.click(1300, 0.45); this.click(700, 0.3, 0.05); },
  bolt() { this.click(700, 0.5); this.click(1600, 0.3, 0.08); },
  dry() { if (ok()) tone(out(null, 0.6, 0), 'square', now(), 0.03, 0.2, 1800, 1200); },
  click(freq = 2200, vol = 0.35, delay = 0) {
    if (!ok()) return;
    const t = now() + delay, o = out(null, vol, 0.05);
    noiseShot(o, t, 0.035, 0.8, 'bandpass', freq, 0, 4);
    tone(o, 'triangle', t, 0.05, 0.25, freq * 0.5, freq * 0.4);
  },

  /* ---------- impacts and hit feedback ---------- */
  impact(surface, pos, vol = 1) {
    if (!ok()) return;
    const t = now(), o = out(pos, vol, 0.15);
    if (surface === 'metal') { tone(o, 'triangle', t, 0.25, 0.35, rand(1400, 2200), 900); noiseShot(o, t, 0.05, 0.5, 'highpass', 4000); }
    else if (surface === 'wood') { noiseShot(o, t, 0.08, 0.7, 'bandpass', 900, 400, 1.2); tone(o, 'triangle', t, 0.06, 0.3, 320, 180); }
    else if (surface === 'flesh') { noiseShot(o, t, 0.09, 0.9, 'lowpass', 1200, 300); tone(o, 'sine', t, 0.08, 0.5, 110, 60); }
    else noiseShot(o, t, 0.07, 0.6, 'bandpass', 2400, 800, 1);
  },
  hitBody() { if (ok()) { const t = now(), o = out(null, 0.5, 0); tone(o, 'sine', t, 0.05, 0.4, 2600, 2400); noiseShot(o, t, 0.05, 0.5, 'lowpass', 900, 300); } },
  /** The signature headshot: a bright metallic ring over a dull crack. */
  hitHead() {
    if (!ok()) return;
    const t = now(), o = out(null, 0.6, 0.1);
    tone(o, 'sine', t, 0.4, 0.4, 2794); tone(o, 'sine', t, 0.3, 0.22, 4186); tone(o, 'sine', t + 0.01, 0.2, 0.15, 5588);
    noiseShot(o, t, 0.06, 0.7, 'bandpass', 1800, 700, 1.5);
  },
  hitArmor() { if (ok()) { const t = now(), o = out(null, 0.5, 0.1); for (const f of [1210, 1870, 3140]) tone(o, 'triangle', t, 0.18, 0.18, f, f * 0.97); noiseShot(o, t, 0.04, 0.5, 'highpass', 3500); } },
  killConfirm(multi = 1) {
    if (!ok()) return;
    const t = now(), o = out(null, 0.55, 0.1);
    tone(o, 'sine', t, 0.18, 0.7, 75, 45);
    for (let k = 0; k < Math.min(multi, 5); k++) tone(o, 'triangle', t + 0.05 + k * 0.07, 0.08, 0.2, 880 * 2 ** (k / 4));
  },
  whiz(pos) { if (ok()) noiseShot(out(pos, 0.9, 0), now(), 0.18, 0.7, 'bandpass', 5200, 1400, 3); },
  crack(pos) { if (ok()) noiseShot(out(pos, 0.8, 0), now(), 0.015, 1, 'highpass', 5000); },

  /* ---------- player body ---------- */
  /**
   * Footsteps: a soft crunch of sand or a light scuff on stone, never a tone. Each step is
   * slightly different (filter, length, level) so a walk does not sound like a metronome.
   */
  step(surface, vol) {
    if (!ok()) return;
    this.stepAt(null, surface, vol * 0.55);
  },
  stepAt(pos, surface, vol) {
    if (!ok()) return;
    const t = now(), o = out(pos, vol, 0);
    if (surface === 'stone') {
      noiseShot(o, t, rand(0.035, 0.05), 0.5, 'bandpass', rand(1500, 2300), rand(700, 1000), 1.6, 0.004);
    } else {
      noiseShot(o, t, rand(0.07, 0.11), 0.45, 'lowpass', rand(1400, 2000), rand(300, 500), 0.6, 0.012);
      noiseShot(o, t + rand(0.01, 0.03), 0.05, 0.18, 'bandpass', rand(3000, 4200), 0, 1.2, 0.006);
    }
  },
  land() { if (ok()) noiseShot(out(null, 0.8, 0), now(), 0.12, 0.8, 'lowpass', 800, 200); },
  jump() { if (ok()) noiseShot(out(null, 0.3, 0), now(), 0.1, 0.5, 'bandpass', 900, 500, 1); },
  breath() { if (ok()) { const t = now(), o = out(null, 0.25, 0); noiseShot(o, t, 0.45, 0.5, 'bandpass', 1400, 900, 1.2, 0.15); } },
  hurt() { if (ok()) { const o = out(null, 0.9, 0); tone(o, 'sine', now(), 0.25, 0.8, 90, 45); noiseShot(o, now(), 0.12, 0.6, 'lowpass', 1500, 300); } },
  /** Lub-dub from inside the chest; `interval` (time to the next beat) sets the lub-dub gap. */
  heartbeat(vol = 0.9, interval = 0.8) { if (ok()) renderHeartbeat(audio.ctx, out(null, vol, 0), now() + 0.01, 1, interval); },
  /** Muffles everything and rings the ears after a nearby blast. */
  deafen(amount) {
    if (!ok() || amount <= 0.05) return;
    const t = now(), f = audio.deafenLP.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(lerp(4000, 450, amount), t);
    f.setTargetAtTime(20000, t + 0.3, 0.9);
    tone(out(null, amount * 0.12, 0), 'sine', t, 2.6, 1, 3900, 0, 0.02);
  },
  pin() { this.click(3000, 0.3); this.click(2400, 0.2, 0.06); },
  swish() { if (ok()) noiseShot(out(null, 0.5, 0), now(), 0.2, 0.7, 'bandpass', 700, 3400, 1.6, 0.03); },
  stab() {
    if (!ok()) return;
    const t = now(), o = out(null, 0.8, 0.1);
    noiseShot(o, t, 0.1, 0.9, 'lowpass', 900, 250);
    tone(o, 'sine', t, 0.12, 0.6, 140, 60);
    noiseShot(o, t + 0.03, 0.08, 0.4, 'bandpass', 2200, 800, 2);
  },
  whoosh() { if (ok()) noiseShot(out(null, 0.5, 0), now(), 0.25, 0.6, 'bandpass', 600, 2400, 1.2, 0.05); },
  bounce(pos) { if (ok()) tone(out(pos, 0.7, 0.1), 'triangle', now(), 0.08, 0.5, rand(380, 520), 240); },
  nadeWarn() { if (ok()) { const t = now(), o = out(null, 0.35, 0); tone(o, 'square', t, 0.06, 0.25, 1500); tone(o, 'square', t + 0.12, 0.06, 0.25, 1500); } },

  /* ---------- world ---------- */
  explosion(pos, big) {
    if (!ok()) return;
    const t = now(), o = out(pos, big ? 3.2 : 2.4, 0.9);
    noiseShot(o, t, big ? 2.4 : 1.6, 1, 'lowpass', 2400, 60, 0.6);
    tone(o, 'sine', t, big ? 1.4 : 1.0, 1, 75, 22);
    noiseShot(o, t + 0.05, 0.5, 0.4, 'highpass', 2500, 900);
    // debris patter a moment later
    for (let k = 0; k < 6; k++) noiseShot(out(pos, 0.3, 0.2), t + 0.5 + k * rand(0.08, 0.2), 0.05, 0.6, 'bandpass', rand(1500, 3000), 0, 2);
  },
  crateBreak(pos) { if (ok()) { const t = now(), o = out(pos, 1, 0.3); for (let k = 0; k < 4; k++) noiseShot(o, t + k * 0.04, 0.12, 0.8, 'bandpass', rand(500, 1300), 300, 1.5); } },
  barrelHiss(pos) { if (ok()) noiseShot(out(pos, 0.7, 0.1), now(), 0.3, 0.8, 'highpass', 3000, 6000); },
  casing(pos, shotgun) {
    if (!ok() || camera.position.distanceTo(pos) > 4) return;
    const o = out(pos, 0.25, 0);
    if (shotgun) { tone(o, 'triangle', now(), 0.08, 0.3, rand(700, 900)); return; }
    tone(o, 'sine', now(), 0.06, 0.4, rand(3800, 4600)); tone(o, 'sine', now() + 0.07, 0.05, 0.2, rand(4200, 5200));
  },
  /** The citadel bell tolls the hour. */
  bell(count) {
    if (!ok()) return;
    for (let k = 0; k < count; k++) {
      const t = now() + 0.3 + k * 1.5, o = out(null, 0.5, 0.8);
      for (const [f, a, d] of [[196, 0.5, 4], [392.7, 0.25, 3], [466, 0.12, 2.2], [587, 0.1, 1.6], [98, 0.3, 4.5]]) tone(o, 'sine', t, d, a, f, 0, 0.004);
    }
  },
  flutter(pos) { if (ok()) { const t = now(), o = out(pos, 0.6, 0.2); for (let k = 0; k < 14; k++) noiseShot(o, t + k * 0.05, 0.05, 0.5, 'bandpass', rand(600, 1200), 0, 1.5); } },
  glint(pos) { if (ok()) { const o = out(pos, 0.5, 0.2); tone(o, 'sine', now(), 0.5, 0.25, 2600, 3100, 0.1); } },
  supplyLand(pos) { if (ok()) { const o = out(pos, 1.4, 0.3); noiseShot(o, now(), 0.3, 1, 'lowpass', 600, 120); tone(o, 'sine', now(), 0.25, 0.8, 70, 40); } },
  chute(pos) { if (ok()) { const t = now(), o = out(pos, 1, 0.2); noiseShot(o, t, 0.6, 0.9, 'bandpass', 500, 1200, 1.2, 0.05); for (let k = 0; k < 5; k++) noiseShot(o, t + 0.1 + k * 0.08, 0.05, 0.5, 'lowpass', 900, 0, 1); } },
  sonicBoom(pos) { if (ok()) { const t = now(), o = out(pos, 2.2, 0.8); noiseShot(o, t, 0.5, 1, 'lowpass', 900, 80, 0.7); tone(o, 'sine', t, 0.4, 0.9, 60, 30); } },
  bombWhistle(pos) { if (ok()) tone(out(pos, 0.5, 0.2), 'sine', now(), 1.1, 0.4, 1800, 500, 0.05); },
  heliHit(pos) { if (ok()) { const o = out(pos, 0.6, 0.1); tone(o, 'triangle', now(), 0.12, 0.3, rand(900, 1400), 700); } },

  /* ---------- radio and interface ---------- */
  radio(on) {
    if (!ok()) return;
    const t = now(), o = out(null, 0.35, 0);
    noiseShot(o, t, on ? 0.12 : 0.08, 0.7, 'bandpass', 2200, 1600, 1.5);
    tone(o, 'square', t, 0.02, 0.15, on ? 1200 : 900);
  },
  hover() { if (ok()) tone(out(null, 0.12, 0), 'sine', now(), 0.03, 0.4, 2400); },
  select() { if (ok()) { const t = now(), o = out(null, 0.3, 0.1); tone(o, 'sine', t, 0.08, 0.4, 880); tone(o, 'sine', t + 0.06, 0.12, 0.35, 1320); } },
  back() { if (ok()) { const t = now(), o = out(null, 0.25, 0.1); tone(o, 'sine', t, 0.08, 0.35, 880); tone(o, 'sine', t + 0.06, 0.12, 0.3, 587); } },
  tick() { if (ok()) tone(out(null, 0.1, 0), 'triangle', now(), 0.02, 0.4, 3000); },
  medal() {
    if (!ok()) return;
    const t = now(), o = out(null, 0.4, 0.4);
    [1047, 1319, 1568, 2093].forEach((f, i) => tone(o, 'sine', t + i * 0.07, 0.9, 0.3, f, 0, 0.005));
  },
  focus(on) {
    if (!ok()) return;
    const t = now(), f = audio.focusLP.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(on ? 850 : 20000, t, on ? 0.08 : 0.25);
    noiseShot(out(null, 0.6, 0.4), t, 0.6, 0.5, 'bandpass', on ? 3000 : 400, on ? 300 : 3000, 1.5);
  },
  setStorm(v) {
    if (!wind) return;
    const t = now();
    stormGain.gain.setTargetAtTime(v * 0.22, t, 0.5);
  },
  /** Another fight somewhere past the walls: muffled bursts of fire and the odd far-off explosion. */
  distantBattle(dt) {
    if (!ok()) return;
    farT -= dt; boomT -= dt;
    if (farT <= 0) {
      farT = rand(3.5, 8);
      const n = randi(5) + 3, gap = rand(0.07, 0.13), t = now(), o = farOut(rand(-0.9, 0.9), rand(0.07, 0.13), 1000);
      for (let k = 0; k < n; k++) {
        const tk = t + k * gap + rand(0, 0.02);
        noiseShot(o, tk, 0.12, 0.9, 'lowpass', 900, 260);
        tone(o, 'sine', tk, 0.1, 0.45, 95, 45);
      }
    }
    if (boomT <= 0) {
      boomT = rand(16, 32);
      const t = now(), o = farOut(rand(-0.8, 0.8), rand(0.18, 0.28), 340);
      noiseShot(o, t, 2.2, 1, 'lowpass', 380, 60, 0.6);
      tone(o, 'sine', t, 1.4, 0.8, 55, 25);
    }
  },
  /** Wind by day, crickets by night, the odd bird call in daylight. */
  ambience(dt) {
    if (!wind) return;
    wind.gain.setTargetAtTime(lerp(0.06, 0.035, tod.night) + tod.storm * 0.12, now(), 0.5);
    cricketT -= dt; chirpT -= dt;
    if (tod.night > 0.3 && tod.storm < 0.3 && cricketT <= 0) {
      cricketT = rand(0.4, 1.4);
      const o = out({ x: rand(-30, 30), y: 0.3, z: rand(-30, 30) }, 0.12 * tod.night, 0.2), f = rand(4200, 4900);
      for (let k = 0; k < 3; k++) tone(o, 'sine', now() + k * 0.06, 0.035, 0.5, f);
    }
    if (tod.night < 0.3 && tod.storm < 0.3 && chirpT <= 0) {
      chirpT = rand(3, 8);
      const o = out({ x: rand(-40, 40), y: 12, z: rand(-40, 40) }, 0.1, 0.3), t = now();
      for (let k = 0; k < 3; k++) tone(o, 'sine', t + k * 0.11, 0.07, 0.4, rand(2600, 3400), rand(3400, 4200));
    }
  },
};
