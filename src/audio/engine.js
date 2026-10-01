import { clamp, store } from '../core/utils.js';
import { settings } from '../config/settings.js';
import { camera } from '../core/renderer.js';

/*
 * Web Audio graph:  sfxBus ─┐
 *                   musicBus ┴→ master → focusLP → deafenLP → compressor → speakers
 * plus a shared outdoor reverb send. Every sound in the game is synthesized from these helpers.
 */

export const audio = { ctx: null, muted: store.get('ghasaq.muted', false) };

export function initAudio() {
  if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return false; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  const ctx = audio.ctx = new AC();
  audio.master = ctx.createGain();
  audio.focusLP = ctx.createBiquadFilter(); audio.focusLP.type = 'lowpass'; audio.focusLP.frequency.value = 20000;
  audio.deafenLP = ctx.createBiquadFilter(); audio.deafenLP.type = 'lowpass'; audio.deafenLP.frequency.value = 20000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.2;
  audio.master.connect(audio.focusLP).connect(audio.deafenLP).connect(comp).connect(ctx.destination);
  audio.sfxBus = ctx.createGain(); audio.sfxBus.connect(audio.master);
  audio.musicBus = ctx.createGain(); audio.musicBus.connect(audio.master);

  audio.verb = ctx.createConvolver();
  audio.verb.buffer = impulse(ctx, 1.6, 3.2, 0.09);
  audio.verbSend = ctx.createGain(); audio.verbSend.gain.value = 0.32;
  audio.verbSend.connect(audio.verb).connect(audio.sfxBus);
  audio.hall = ctx.createConvolver();
  audio.hall.buffer = impulse(ctx, 3.2, 2.2, 0.02);
  audio.hallSend = ctx.createGain(); audio.hallSend.gain.value = 0.5;
  audio.hallSend.connect(audio.hall).connect(audio.musicBus);

  const nl = ctx.sampleRate * 2;
  audio.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
  const nd = audio.noise.getChannelData(0);
  for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  applyVolumes();
  return true;
}
function impulse(ctx, seconds, decay, early) {
  const len = Math.floor(ctx.sampleRate * seconds), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * (1 - t) ** decay * (i < ctx.sampleRate * early ? 0.25 : 1); }
  }
  return ir;
}
export function applyVolumes() {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  audio.master.gain.setTargetAtTime(audio.muted ? 0 : settings.master, t, 0.05);
  // effects carry the game; music sits underneath them
  audio.sfxBus.gain.setTargetAtTime(settings.sfx * 1.35, t, 0.05);
  audio.musicBus.gain.setTargetAtTime(settings.music * 0.42, t, 0.2);
}
export function setMuted(m) { audio.muted = m; store.set('ghasaq.muted', m); applyVolumes(); }
export const now = () => (audio.ctx ? audio.ctx.currentTime : 0);

/** Returns an input node. With `pos` the sound is placed in 3D and muffled by distance. */
export function out(pos, gain = 1, verb = 0.3, bus) {
  const ctx = audio.ctx, g = ctx.createGain();
  g.gain.value = gain;
  let head = g;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 300;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(g); head = p;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = clamp(18000 - camera.position.distanceTo(pos) * 280, 900, 18000);
    lp.connect(head); head = lp;
  }
  g.connect(bus || audio.sfxBus);
  if (verb > 0) { const s = ctx.createGain(); s.gain.value = verb; g.connect(s); s.connect(audio.verbSend); }
  return head;
}
export function env(g, t, peak, a, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
export function tone(dest, type, t, dur, peak, f0, f1, a = 0.002) {
  const ctx = audio.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + dur);
  env(g, t, peak, a, dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
export function noiseShot(dest, t, dur, peak, type, f0, f1, q = 0.8, a = 0.002) {
  const ctx = audio.ctx, s = ctx.createBufferSource();
  s.buffer = audio.noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(g, t, peak, a, dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05);
}
function loopNoise(dest) {
  const s = audio.ctx.createBufferSource();
  s.buffer = audio.noise; s.loop = true;
  s.connect(dest); s.start(audio.ctx.currentTime, Math.random() * 1.5);
  return s;
}

/**
 * Continuous engine sounds for aircraft, placed in 3D with Doppler shift.
 * kind: 'prop' (transport plane), 'jet', 'uav', 'heli'.
 */
export function makeLoop(kind, volume = 1) {
  if (!audio.ctx) return { update() {}, stop() {} };
  const ctx = audio.ctx, t = ctx.currentTime;
  const p = ctx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = kind === 'jet' ? 40 : 16; p.rolloffFactor = 1; p.maxDistance = 3000;
  const g = ctx.createGain(); g.gain.value = 0.0001;
  g.gain.linearRampToValueAtTime(volume, t + (kind === 'jet' ? 0.3 : 1.5));
  p.connect(g).connect(audio.sfxBus);
  const sources = [], doppler = [];
  const osc = (type, f, gain, dest) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = type; o.frequency.value = f; og.gain.value = gain;
    o.connect(og).connect(dest); o.start();
    sources.push(o); doppler.push({ param: o.frequency, base: f });
    return o;
  };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  if (kind === 'prop') {
    const lp = filt('lowpass', 520); lp.connect(p);
    const am = ctx.createGain(); am.gain.value = 0.55; am.connect(lp);
    osc('sawtooth', 62, 0.5, am); osc('sawtooth', 93.5, 0.35, am); osc('sawtooth', 124, 0.18, am);
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 31; depth.gain.value = 0.4;
    lfo.connect(depth).connect(am.gain); lfo.start(); sources.push(lfo);
    const nlp = filt('lowpass', 260); const ng = ctx.createGain(); ng.gain.value = 0.6; nlp.connect(ng).connect(p);
    sources.push(loopNoise(nlp));
  } else if (kind === 'jet') {
    const bp = filt('bandpass', 700, 0.5); const bg = ctx.createGain(); bg.gain.value = 1.2; bp.connect(bg).connect(p);
    sources.push(loopNoise(bp)); doppler.push({ param: bp.frequency, base: 700 });
    const hp = filt('highpass', 3200); const hg = ctx.createGain(); hg.gain.value = 0.35; hp.connect(hg).connect(p);
    sources.push(loopNoise(hp)); doppler.push({ param: hp.frequency, base: 3200 });
    osc('sine', 85, 0.6, p);
  } else if (kind === 'uav') {
    const lp = filt('lowpass', 1100); lp.connect(p);
    const am = ctx.createGain(); am.gain.value = 0.35; am.connect(lp);
    osc('sawtooth', 168, 0.5, am); osc('sawtooth', 171, 0.4, am);
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 44; depth.gain.value = 0.12;
    lfo.connect(depth).connect(am.gain); lfo.start(); sources.push(lfo);
  } else if (kind === 'heli') {
    const lp = filt('lowpass', 650); const am = ctx.createGain(); am.gain.value = 0.5; lp.connect(am).connect(p);
    sources.push(loopNoise(lp));
    const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.type = 'square'; lfo.frequency.value = 17; depth.gain.value = 0.45;
    lfo.connect(depth).connect(am.gain); lfo.start(); sources.push(lfo);
    const lp2 = filt('lowpass', 220); lp2.connect(p);
    osc('sawtooth', 34, 0.7, lp2);
    osc('sine', 1350, 0.03, p);
  }
  let alive = true;
  return {
    update(pos, vel) {
      if (!alive) return;
      const tt = ctx.currentTime;
      p.positionX.setTargetAtTime(pos.x, tt, 0.03); p.positionY.setTargetAtTime(pos.y, tt, 0.03); p.positionZ.setTargetAtTime(pos.z, tt, 0.03);
      if (vel) {
        const lx = camera.position.x - pos.x, ly = camera.position.y - pos.y, lz = camera.position.z - pos.z;
        const d = Math.hypot(lx, ly, lz) || 1;
        const vr = (vel.x * lx + vel.y * ly + vel.z * lz) / d;
        const f = clamp(343 / (343 - vr), 0.55, 1.8);
        for (const dp of doppler) dp.param.setTargetAtTime(dp.base * f, tt, 0.04);
      }
    },
    stop(fade = 1.2) {
      if (!alive) return;
      alive = false;
      const tt = ctx.currentTime;
      g.gain.cancelScheduledValues(tt);
      g.gain.setTargetAtTime(0.0001, tt, fade / 3);
      for (const s of sources) { try { s.stop(tt + fade + 0.2); } catch { /* already stopped */ } }
    },
  };
}

export function updateListener() {
  if (!audio.ctx) return;
  const L = audio.ctx.listener, p = camera.position;
  const e = camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10];
  if (L.positionX) {
    const t = audio.ctx.currentTime;
    L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
    L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
    L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
  } else {
    L.setPosition(p.x, p.y, p.z);
    L.setOrientation(fx, fy, fz, 0, 1, 0);
  }
}
