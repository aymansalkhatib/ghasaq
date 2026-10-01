import { rand } from '../core/utils.js';
import { settings } from '../config/settings.js';
import { audio, now, out } from './engine.js';

/*
 * The player's own voice when hit: a grunt for a graze, a cry for a real wound. No words.
 * A glottal pulse (with jitter and vibrato) runs through three vowel formants that glide from one
 * vowel to the next, with breath noise on top and some saturation for the strained cry.
 */

// vowel formants F1, F2, F3 of an adult man
const VOWEL = {
  a: [760, 1240, 2550], o: [520, 900, 2450], u: [370, 820, 2350],
  e: [560, 1720, 2550], h: [700, 1450, 2650], m: [300, 1050, 2350],
};
/*
 * dur: seconds, f0: pitch contour [start, peak, end] as multiples of the man's own pitch,
 * v: vowels glided between, strain: saturation, breath: noise level, onset: 'h' at the start,
 * fry: creaky voice as it dies away, inhale: a sharp breath in before the sound.
 */
const KIND = {
  grunt: { dur: [0.17, 0.26], f0: [1.12, 1.3, 0.84], v: ['a', 'm'], gain: 0.85, strain: 1.4, breath: 0.3, onset: 0.25 },
  cry: { dur: [0.42, 0.6], f0: [1.35, 1.75, 1.05], v: ['a', 'o'], gain: 0.68, strain: 2.4, breath: 0.28, onset: 0.18 },
};

const waves = new WeakMap(), noises = new WeakMap(), curves = new Map();
/** Glottal pulse spectrum: harmonics falling at about 12 dB per octave, like a real voice. */
function glottal(ctx) {
  if (!waves.has(ctx)) {
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = 1 / n ** 1.35 * (n % 2 ? 1 : 0.85);
    waves.set(ctx, ctx.createPeriodicWave(re, im));
  }
  return waves.get(ctx);
}
function noiseOf(ctx) {
  if (ctx === audio.ctx && audio.noise) return audio.noise;
  if (!noises.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(ctx, b);
  }
  return noises.get(ctx);
}
function strainCurve(k) {
  const key = Math.round(k * 10);
  if (!curves.has(key)) {
    const c = new Float32Array(512), n = Math.tanh(k);
    for (let i = 0; i < 512; i++) { const x = i / 255.5 - 1; c[i] = Math.tanh(x * k) / n; }
    curves.set(key, c);
  }
  return curves.get(key);
}

/**
 * Builds one vocal sound into `dest` starting at time `t`. Works on any AudioContext, including an
 * OfflineAudioContext (the autotest renders every kind offline to check its level). Returns its length.
 */
export function renderVocal(ctx, dest, t, kind, voice) {
  const K = KIND[kind] || KIND.grunt;
  const dur = rand(K.dur[0], K.dur[1]), f0 = voice.f0, tr = voice.tract;
  const pre = K.inhale ? 0.2 : 0;
  const t0 = t + pre, tEnd = t0 + dur;
  const master = ctx.createGain();
  master.gain.value = K.gain;
  master.connect(dest);

  // glottal source with a pitch contour, vibrato and jitter
  const src = ctx.createOscillator();
  src.setPeriodicWave(glottal(ctx));
  src.frequency.setValueAtTime(f0 * K.f0[0], t0);
  src.frequency.linearRampToValueAtTime(f0 * K.f0[1], t0 + dur * 0.28);
  src.frequency.exponentialRampToValueAtTime(f0 * K.f0[2], tEnd);
  const vib = ctx.createOscillator(), vibG = ctx.createGain();
  vib.frequency.value = rand(5.2, 6.8);
  vibG.gain.setValueAtTime(0, t0); vibG.gain.linearRampToValueAtTime(K.strain > 2 ? 38 : 16, tEnd);
  vib.connect(vibG).connect(src.detune);
  const jit = ctx.createBufferSource(); jit.buffer = noiseOf(ctx); jit.loop = true;
  const jitLP = ctx.createBiquadFilter(); jitLP.type = 'lowpass'; jitLP.frequency.value = 28;
  const jitG = ctx.createGain(); jitG.gain.value = 55;
  jit.connect(jitLP).connect(jitG).connect(src.detune);

  // voicing envelope, creaky voice as it fades
  const voiced = ctx.createGain();
  voiced.gain.setValueAtTime(0.0001, t0);
  voiced.gain.linearRampToValueAtTime(1, t0 + 0.025);
  voiced.gain.setValueAtTime(1, t0 + dur * 0.45);
  voiced.gain.exponentialRampToValueAtTime(0.0001, tEnd);
  src.connect(voiced);
  let tail = voiced;
  let fry = null;
  if (K.fry) {
    const fg = ctx.createGain(); fg.gain.value = 1;
    fry = ctx.createOscillator(); fry.type = 'sawtooth'; fry.frequency.value = rand(34, 52);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t0); depth.gain.linearRampToValueAtTime(0, t0 + dur * 0.5); depth.gain.linearRampToValueAtTime(0.85, tEnd);
    fry.connect(depth).connect(fg.gain);
    voiced.connect(fg); tail = fg;
  }

  // vowel formants in parallel, gliding from the first vowel to the second
  const shaper = ctx.createWaveShaper(); shaper.curve = strainCurve(K.strain); shaper.oversample = '2x';
  const [v1, v2] = [VOWEL[K.v[0]], VOWEL[K.v[1]]];
  [[1, 6, 1], [2, 9, 0.55], [3, 12, 0.28]].forEach(([n, q, a], i) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(v1[i] * tr, t0);
    bp.frequency.setValueAtTime(v1[i] * tr, t0 + dur * 0.3);
    bp.frequency.linearRampToValueAtTime(v2[i] * tr, tEnd);
    const g = ctx.createGain(); g.gain.value = a * (n === 1 ? 3.2 : 4.2);
    tail.connect(bp).connect(g).connect(shaper);
  });
  // chest resonance under the vowel
  const chest = ctx.createBiquadFilter(); chest.type = 'lowpass'; chest.frequency.value = 320;
  const cg = ctx.createGain(); cg.gain.value = 0.45;
  tail.connect(chest).connect(cg).connect(shaper);
  const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 4200;
  const outG = ctx.createGain(); outG.gain.value = 0.55;
  shaper.connect(air).connect(outG).connect(master);

  // breath: an 'h' at the onset, air under the voice, an exhale at the end
  const br = ctx.createBufferSource(); br.buffer = noiseOf(ctx); br.loop = true;
  const brBP = ctx.createBiquadFilter(); brBP.type = 'bandpass'; brBP.frequency.value = 1500 * tr; brBP.Q.value = 0.7;
  const brG = ctx.createGain();
  const b = K.breath * 0.22;
  brG.gain.setValueAtTime(0.0001, t0);
  brG.gain.linearRampToValueAtTime(b + K.onset * 0.3, t0 + 0.02);
  brG.gain.linearRampToValueAtTime(b, t0 + 0.08);
  brG.gain.setValueAtTime(b, tEnd - 0.05);
  brG.gain.linearRampToValueAtTime(b * 1.4, tEnd);
  brG.gain.exponentialRampToValueAtTime(0.0001, tEnd + 0.18);
  br.connect(brBP).connect(brG).connect(master);
  // a sharp breath in before a gasp
  let inh = null;
  if (K.inhale) {
    inh = ctx.createBufferSource(); inh.buffer = noiseOf(ctx); inh.loop = true;
    const ibp = ctx.createBiquadFilter(); ibp.type = 'bandpass'; ibp.Q.value = 1.3;
    ibp.frequency.setValueAtTime(1100, t); ibp.frequency.exponentialRampToValueAtTime(2600, t0);
    const ig = ctx.createGain();
    ig.gain.setValueAtTime(0.0001, t); ig.gain.linearRampToValueAtTime(0.32, t0 - 0.03); ig.gain.linearRampToValueAtTime(0.0001, t0);
    inh.connect(ibp).connect(ig).connect(master);
  }

  const stop = tEnd + 0.25;
  for (const n of [src, vib, jit, br, fry, inh]) if (n) { n.start(n === inh ? t : t0 - 0.01); n.stop(stop); }
  return pre + dur + 0.2;
}

/** Plays a vocal sound (null `pos` = the player's own voice), never over one still sounding. */
export function vocal(kind, pos, voice, gain = 1) {
  if (!audio.ctx || !settings.vocals || !voice) return;
  const t = now();
  if (t < voice.until) return;
  const own = !pos;
  const dest = out(pos, (own ? 0.5 : 0.95) * gain, own ? 0.06 : 0.28);
  const len = renderVocal(audio.ctx, dest, t + 0.01, kind, voice);
  voice.until = t + len * 0.8;
}
