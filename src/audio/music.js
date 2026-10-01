import { clamp, damp, mulberry32 } from '../core/utils.js';
import { audio, now, env } from './engine.js';

/*
 * Adaptive score in maqam Hijaz on D (D Eb F# G A Bb C).
 *
 * The music is composed on the fly from rules rather than looped:
 *  - an 8-bar chord progression per section, alternating a sparse A and a fuller B section;
 *  - melodies built from rhythm templates, moving by step and landing on chord tones,
 *    with bars 5–8 answering bars 1–4 (call and response) and a cadence on the tonic;
 *  - phrases are seeded, so each theme comes back and becomes recognisable.
 * Instruments are synthesized: Karplus-Strong oud and qanun, breathy ney, darbuka (doum/tek/ka),
 * frame drum, soft pads, a plucked bass and taiko/brass for the peaks of a fight.
 */

const HIJAZ = [0, 1, 4, 5, 7, 8, 10];
const ROOT = 50; // D3
const midiOf = (deg, oct = 0) => { const o = Math.floor(deg / 7), i = ((deg % 7) + 7) % 7; return ROOT + (oct + o) * 12 + HIJAZ[i]; };
const m2f = (m) => 440 * 2 ** ((m - 69) / 12);

// chords as scale degrees: D, Eb, D, Cm, Gm, Eb, D, D
const PROG = [[0, 2, 4], [1, 3, 5], [0, 2, 4], [-1, 1, 3], [3, 5, 7], [1, 3, 5], [0, 2, 4], [0, 2, 4]];
const RHYTHMS = [[0, 4, 8, 12], [0, 6, 8, 12], [0, 4, 6, 8, 12], [0, 3, 6, 8, 12], [0, 8, 10, 12], [0, 2, 4, 8, 12], [0, 4, 8, 10, 12, 14]];
const LONG = [[0, 8], [0, 6, 12], [0, 4, 8], [0, 12]];
const BPM = { menu: 76, calm: 84, combat: 114 };

function isChordTone(deg, chord) { const d = ((deg % 7) + 7) % 7; return chord.some((c) => ((c % 7) + 7) % 7 === d); }
function nearestChordTone(deg, chord) {
  for (let k = 0; k < 4; k++) { if (isChordTone(deg + k, chord)) return deg + k; if (isChordTone(deg - k, chord)) return deg - k; }
  return deg;
}
/** An 8-bar melody: [{ step, deg, len, vel }] with steps in sixteenths. */
function compose(seed, rhythms, lo, hi) {
  const r = mulberry32(seed), ev = [];
  const rA = rhythms[Math.floor(r() * rhythms.length)], rB = rhythms[Math.floor(r() * rhythms.length)];
  let deg = lo + Math.floor((hi - lo) / 2);
  const first = [];
  for (let b = 0; b < 4; b++) {
    const rh = b % 2 ? rB : rA;
    for (let i = 0; i < rh.length; i++) {
      if (i === 0) deg = nearestChordTone(deg, PROG[b]);
      else deg += [-1, 1, 1, -1, 2, -2, 0][Math.floor(r() * 7)];
      deg = clamp(deg, lo, hi);
      const len = (i + 1 < rh.length ? rh[i + 1] : 16) - rh[i];
      first.push({ step: b * 16 + rh[i], deg, len, vel: i === 0 ? 0.5 : 0.34 + r() * 0.08 });
    }
  }
  ev.push(...first);
  // answer phrase: the same shape a step lower, then a cadence home on the tonic
  for (const n of first) {
    if (n.step >= 48) continue;
    const bar = 4 + Math.floor(n.step / 16);
    ev.push({ step: n.step + 64, deg: clamp(nearestChordTone(n.deg - 1, PROG[bar]), lo, hi), len: n.len, vel: n.vel });
  }
  ev.push({ step: 112, deg: lo + 7 <= hi ? lo + 7 : lo, len: 12, vel: 0.5 });
  return ev;
}

const bufs = new Map();
function ksBuffer(ctx, freq, dur = 1.9, bright = 0.5) {
  const sr = ctx.sampleRate, n = Math.floor(sr * dur), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const N = Math.max(2, Math.round(sr / freq)), line = new Float32Array(N);
  let prev = 0, mean = 0;
  for (let i = 0; i < N; i++) { prev += (Math.random() * 2 - 1 - prev) * bright; line[i] = prev; mean += prev; }
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  let idx = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const nx = (idx + 1) % N;
    d[i] = line[idx];
    line[idx] = (line[idx] + line[nx]) * 0.5 * 0.9975;
    idx = nx;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = 0.9 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] *= k * Math.min(1, i / 60);
  return buf;
}

export const music = {
  state: 'off', pending: null, intensity: 0, target: 0, step: 0, next: 0, bpm: 76,
  phrase: 0, melody: [], counter: [], section: 'A',
  init() {
    if (!audio.ctx || this.bus) return;
    const ctx = audio.ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.7;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 5200;
    this.bus.connect(warm).connect(audio.musicBus);
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.bus.connect(this.wet).connect(audio.hallSend);
    for (let d = -9; d <= 21; d++) { const m = midiOf(d); if (!bufs.has(m)) bufs.set(m, ksBuffer(ctx, m2f(m))); }
    this.next = ctx.currentTime + 0.1;
    this.newPhrase();
    this.timer = setInterval(() => this.tick(), 25);
  },
  setState(s) {
    if (s === this.state) { this.pending = null; return; }
    if (this.state === 'off' || s === 'silent' || s === 'off') this.apply(s); else this.pending = s;
  },
  apply(s) { this.state = s; this.pending = null; if (BPM[s]) this.bpm = BPM[s]; this.step = 0; this.phrase = 0; this.newPhrase(); },
  setIntensity(v) { this.target = clamp(v, 0, 1); },
  /** A sudden lift (contact, an assault): the score jumps up now and settles back to its target. */
  boost(v) { this.intensity = clamp(Math.max(this.intensity, this.target) + v, 0, 1); },
  update(dt) { this.intensity += (this.target - this.intensity) * damp(this.target > this.intensity ? 1.2 : 0.35, dt); },

  newPhrase() {
    const theme = this.phrase % 4;   // four themes that come back in turn
    this.section = this.phrase % 2 ? 'B' : 'A';
    const menu = this.state === 'menu';
    this.melody = compose(1000 + theme * 17 + (menu ? 7 : 0), menu ? LONG : RHYTHMS, menu ? 4 : 2, menu ? 13 : 11);
    this.counter = compose(2000 + theme * 23, RHYTHMS, -2, 6);
  },
  tick() {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== 'running' || this.state === 'off') return;
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.15) {
      const s16 = 60 / this.bpm / 4;
      this.play(this.step, this.next, s16);
      this.next += s16;
      this.step++;
      if (this.step % 128 === 0) { this.phrase++; this.newPhrase(); }
    }
  },
  play(step, t, s16) {
    const s = step % 16, bar = Math.floor(step / 16) % 8, ps = step % 128;
    if (s === 0 && this.pending && bar % 4 === 0) { this.apply(this.pending); return; }
    const st = this.state, I = this.intensity, B = this.section === 'B';
    if (st === 'silent') return;
    const chord = PROG[bar];
    if (s === 0) { this.pad(chord.map((d) => midiOf(d)), t, s16 * 16, st === 'combat' ? 0.1 + I * 0.1 : 0.12); this.bass(midiOf(chord[0], -1), t, 0.5); }
    if (s === 10 && st !== 'menu') this.bass(midiOf(chord[0], -1), t, 0.3);
    if (st === 'menu') {
      for (const n of this.melody) if (n.step === ps) this.ney(midiOf(n.deg, 1), t, n.len * s16 * 0.95, 0.24);
      if (B) { for (const n of this.counter) if (n.step === ps) this.pluck(midiOf(n.deg), t, n.vel * 0.55); }
      else if (s % 4 === 0) this.pluck(midiOf(chord[(s / 4) % 3] + 7), t, 0.18);
      if (s === 0) this.daf(t, 0.3);
      if (s === 8 && B) this.daf(t, 0.16);
      if (bar === 7 && s === 8) this.run(t, s16);
      return;
    }
    if (st === 'calm') {
      for (const n of this.counter) if (n.step === ps) this.pluck(midiOf(n.deg), t, n.vel * 0.6);
      if (s === 0) this.doum(t, 0.4);
      if (s === 8) this.tek(t, 0.25);
      return;
    }
    // combat: layers enter with intensity. Maqsum on the darbuka, a driving oud ostinato that
    // leans on the Hijaz half step, then melody, war drums and brass as the fight peaks.
    if (I > 0.1) {
      if (s === 0 || s === 8 || (I > 0.85 && (s === 4 || s === 12))) this.doum(t, 0.8);
      if (s === 2 || s === 6 || s === 12 || s === 14) this.tek(t, s === 14 ? 0.35 : 0.55);
      if (I > 0.45 && s % 2 === 1) this.ka(t, 0.14 + I * 0.08);
      if (bar % 4 === 3 && s >= 12) this.tek(t, 0.55);   // fill into the next phrase
    }
    if (I > 0.28 && s % 2 === 0) {
      const lean = s % 8 === 4 ? 1 : s % 8 === 6 && bar % 2 ? -1 : 0;
      this.pluck(midiOf(chord[0] + lean, -1), t, 0.16 + I * 0.14, 1);
    }
    if (I > 0.42) for (const n of this.counter) if (n.step === ps) this.pluck(midiOf(n.deg), t, n.vel * (B ? 0.75 : 0.6));
    if (I > 0.58) for (const n of this.melody) if (n.step === ps) this.pluck(midiOf(n.deg + 7), t, n.vel * 0.6, 1);
    if (I > 0.72) {
      if (s === 0 || s === 10) this.taiko(t, s === 0 ? 0.7 : 0.45);
      if (s === 0 && bar % 2 === 0) this.brass(chord.map((d) => midiOf(d)), t, s16 * 6, 0.32);
      if (bar === 7 && s === 8) this.run(t, s16);
    }
    if (I > 0.88 && bar % 4 === 3 && s === 0) this.riser(t, s16 * 16, 0.5);
  },

  /* ---------- instruments ---------- */
  pluck(midi, t, vel, rate = 1) {
    const ctx = audio.ctx, buf = bufs.get(midi) || bufs.get(midiOf(0));
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 240; body.gain.value = 5; body.Q.value = 1.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const g = ctx.createGain(); g.gain.value = vel * 0.5;
    src.connect(body).connect(lp).connect(g).connect(this.bus);
    src.start(t); src.stop(t + 2);
  },
  /** A fast qanun run up the scale, used as a fill at the end of phrases. */
  run(t, s16) { [0, 1, 2, 3, 4, 5, 6, 7].forEach((d, i) => this.pluck(midiOf(d + 7), t + i * s16 * 0.5, 0.2 + i * 0.02, 1)); },
  bass(midi, t, vel) {
    const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = m2f(midi);
    lp.type = 'lowpass'; lp.frequency.value = 420;
    env(g, t, vel * 0.35, 0.01, 0.9);
    o.connect(lp).connect(g).connect(this.bus);
    o.start(t); o.stop(t + 1.1);
  },
  ney(midi, t, dur, vel) {
    const ctx = audio.ctx, f = m2f(midi), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.12);
    g.gain.setValueAtTime(vel, t + Math.max(0.14, dur - 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    g.connect(this.bus);
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const o2g = ctx.createGain(); o2g.gain.value = 0.1;
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.2;
    vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(10, t + 0.45);
    vib.connect(vg); vg.connect(o1.detune); vg.connect(o2.detune);
    // a short grace note from above, a hallmark of ney phrasing
    o1.detune.setValueAtTime(180, t); o1.detune.linearRampToValueAtTime(0, t + 0.07);
    o1.connect(g); o2.connect(o2g).connect(g);
    const n = ctx.createBufferSource(); n.buffer = audio.noise; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.2; bp.Q.value = 2.2;
    const ng = ctx.createGain(); ng.gain.value = 0.1;
    n.connect(bp).connect(ng).connect(g);
    for (const o of [o1, o2, vib, n]) { o.start(t); o.stop(t + dur + 0.45); }
  },
  osc(type, f, t, dur, peak, a, detune = 0) {
    const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    env(g, t, peak, a, dur);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + a + dur + 0.1);
    return o;
  },
  noise(t, dur, peak, type, f, q = 1) {
    const ctx = audio.ctx, s = ctx.createBufferSource(); s.buffer = audio.noise;
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const g = ctx.createGain(); env(g, t, peak, 0.002, dur);
    s.connect(b).connect(g).connect(this.bus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  doum(t, v) { const o = this.osc('sine', 105, t, 0.4, v * 0.7, 0.003); o.frequency.exponentialRampToValueAtTime(58, t + 0.2); this.noise(t, 0.05, v * 0.25, 'lowpass', 400); },
  tek(t, v) { this.noise(t, 0.06, v * 0.4, 'bandpass', 3600, 1.2); this.osc('sine', 1100, t, 0.03, v * 0.1, 0.001); },
  ka(t, v) { this.noise(t, 0.045, v * 0.4, 'bandpass', 2600, 1); },
  daf(t, v) { const o = this.osc('sine', 72, t, 0.6, v * 0.6, 0.003); o.frequency.exponentialRampToValueAtTime(50, t + 0.3); this.noise(t, 0.22, v * 0.18, 'highpass', 6000); },
  taiko(t, v) { const o = this.osc('sine', 58, t, 1.0, v, 0.004); o.frequency.exponentialRampToValueAtTime(36, t + 0.5); this.noise(t, 0.3, v * 0.4, 'lowpass', 320); },
  /** Warm pad: triangle and sine voices, gently filtered (no buzzy sawtooth drone). */
  pad(midis, t, dur, vel) {
    const ctx = audio.ctx, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * 0.32, t + 0.9);
    g.gain.setValueAtTime(vel * 0.32, t + Math.max(0.95, dur - 0.3)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
    lp.connect(g).connect(this.bus);
    for (const m of midis) for (const [type, det] of [['triangle', -5], ['sine', 5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = m2f(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 1.3);
    }
  },
  brass(midis, t, dur, vel) {
    const ctx = audio.ctx, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.15); lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain(); env(g, t, vel * 0.25, 0.05, dur);
    lp.connect(g).connect(this.bus);
    for (const m of midis) for (const det of [-8, 0, 8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = m2f(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.2);
    }
  },

  /** Rising noise and pitch that builds towards the next downbeat. */
  riser(t, dur, vel) {
    const ctx = audio.ctx, src = ctx.createBufferSource(); src.buffer = audio.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel * 0.35, t + dur * 0.95); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.bus);
    src.start(t); src.stop(t + dur + 0.05);
    const o = this.osc('sawtooth', m2f(midiOf(0, -1)), t, dur, vel * 0.12, dur * 0.9);
    o.frequency.exponentialRampToValueAtTime(m2f(midiOf(7)), t + dur);
  },

  /* ---------- stingers ---------- */
  stinger(name) {
    if (!audio.ctx || !this.bus) return;
    const t = now() + 0.05;
    if (name === 'wave') {
      let tt = t;
      for (const gap of [0.26, 0.21, 0.17, 0.14, 0.12, 0.1]) { this.taiko(tt, 0.45); tt += gap; }
      this.taiko(tt, 0.85);
      this.brass([midiOf(0), midiOf(4), midiOf(7)], tt, 2.2, 0.7);
    } else if (name === 'clear') {
      [0, 1, 2, 3, 4, 5, 6].forEach((d, i) => this.pluck(midiOf(d), t + i * 0.08, 0.4));
      this.pluck(midiOf(7), t + 0.6, 0.55);
      this.pad([midiOf(0), midiOf(2), midiOf(4)], t + 0.6, 3, 0.4);
    } else if (name === 'victory') {
      this.brass([midiOf(0), midiOf(2), midiOf(4)], t, 1.6, 0.75);
      this.brass([midiOf(-1), midiOf(1), midiOf(3)], t + 1.6, 1.4, 0.7);
      this.brass([midiOf(0), midiOf(4), midiOf(7)], t + 3.0, 4, 0.85);
      for (const k of [0, 1.6, 3.0, 3.4]) this.taiko(t + k, 0.8);
      [[7, 1.2], [6, 0.4], [5, 0.8], [4, 1.6]].reduce((acc, [d, len]) => { this.ney(midiOf(d, 1), t + 3 + acc, len, 0.28); return acc + len; }, 0);
    } else if (name === 'death') {
      this.pad([midiOf(0, -1), midiOf(1, -1)], t, 4, 0.5);
      this.taiko(t, 0.7);
    } else if (name === 'rank') {
      [0, 2, 4, 7, 9, 11, 14].forEach((d, i) => this.pluck(midiOf(d), t + i * 0.06, 0.45, 2));
      this.brass([midiOf(0), midiOf(4), midiOf(7)], t + 0.45, 1.8, 0.55);
    } else if (name === 'contact') {
      // raiders closing in: a heavy hit, a dark swell on the half step, then a riser
      this.taiko(t, 1); this.taiko(t + 0.34, 0.7);
      this.brass([midiOf(0, -1), midiOf(1, -1)], t, 1.4, 0.55);
      this.riser(t + 0.4, 1.3, 0.8);
    } else if (name === 'assault') {
      // war horns over an accelerating drum roll
      let tt = t;
      for (const gap of [0.2, 0.17, 0.14, 0.12, 0.1, 0.09]) { this.taiko(tt, 0.55); tt += gap; }
      this.brass([midiOf(0, -1), midiOf(4, -1)], tt, 0.7, 0.75);
      this.brass([midiOf(4, -1), midiOf(7, -1)], tt + 0.7, 0.5, 0.75);
      this.brass([midiOf(0), midiOf(4), midiOf(7)], tt + 1.2, 1.8, 0.85);
      this.taiko(tt, 1); this.taiko(tt + 1.2, 1);
    } else if (name === 'retreat') {
      // the raiders fall back: a quick bright run and a lifted chord
      [0, 2, 4, 5, 7].forEach((d, i) => this.pluck(midiOf(d + 7), t + i * 0.07, 0.5, 1));
      this.brass([midiOf(0), midiOf(2), midiOf(4)], t + 0.35, 1.2, 0.65);
      this.taiko(t + 0.35, 0.8);
    } else if (name === 'laststand') {
      // near death: a slow double heartbeat on the war drum under a dark cluster
      for (const k of [0, 0.22, 1.1, 1.32]) this.taiko(t + k, k % 1.1 ? 0.55 : 0.9);
      this.pad([midiOf(0, -1), midiOf(1, -1), midiOf(0)], t, 3, 0.55);
    } else if (name === 'streak') {
      this.taiko(t, 0.9);
      this.brass([midiOf(0), midiOf(4), midiOf(7)], t, 0.5, 0.6);
      this.tek(t + 0.12, 0.6); this.tek(t + 0.2, 0.6);
    } else if (name === 'support') {
      [[4, 0], [5, 0.14], [7, 0.28]].forEach(([d, k]) => this.brass([midiOf(d)], t + k, 0.3, 0.4));
    }
  },
};
