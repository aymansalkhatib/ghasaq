/*
 * Injected before any game code (record.mjs → page.addInitScript). Replaces the page's clocks with a
 * virtual one that only moves when the recorder calls __vt.step(ms), so every frame of the film is
 * rendered at exactly 1/FPS of game time however slow the machine is.
 *
 *  - performance.now, Date, requestAnimationFrame, setTimeout and setInterval follow the virtual clock
 *  - CSS animations and transitions are paused and seeked to the virtual clock every step
 *  - AudioContext becomes an OfflineAudioContext whose currentTime is the virtual clock: every sound the
 *    game schedules lands on the right sample, and the whole soundtrack is rendered at the end (__vt.renderAudio)
 *  - Math.random is seeded, so a scene plays out the same way every time
 *
 * Settings come from window.__docCfg = { seed, audioSeconds } (set by record.mjs).
 */
(() => {
  const cfg = window.__docCfg || {};
  const VT = (window.__vt = { t: 0, hooks: [], frames: 0 });

  /* ---- seeded random (mulberry32) ---- */
  let seed = (cfg.seed || 1) >>> 0;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---- clocks ---- */
  const EPOCH = Date.UTC(2026, 9, 1, 13, 0, 0);
  const RealDate = Date;
  performance.now = () => VT.t;
  class VDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(EPOCH + VT.t); }
    static now() { return EPOCH + VT.t; }
  }
  window.Date = VDate;

  let rafs = new Map(), rafId = 0;
  window.requestAnimationFrame = (cb) => { rafs.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };

  const timers = new Map();
  let timerId = 0;
  window.setTimeout = (fn, ms = 0, ...args) => { timers.set(++timerId, { fn, at: VT.t + Math.max(0, +ms || 0), args, seq: timerId }); return timerId; };
  window.setInterval = (fn, ms = 0, ...args) => { const every = Math.max(1, +ms || 0); timers.set(++timerId, { fn, at: VT.t + every, every, args, seq: timerId }); return timerId; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  const flush = () => new Promise((r) => queueMicrotask(r));
  function nextTimer(limit) {
    let best = null, bestId = 0;
    for (const [id, tm] of timers) {
      if (tm.at > limit) continue;
      if (!best || tm.at < best.at || (tm.at === best.at && tm.seq < best.seq)) { best = tm; bestId = id; }
    }
    return best ? [bestId, best] : null;
  }

  /* ---- CSS animations follow the virtual clock ---- */
  const animT = new WeakMap();
  function stepAnimations(dt) {
    for (const a of document.getAnimations()) {
      let t = animT.get(a);
      if (t === undefined) { t = 0; try { a.pause(); } catch { /* ignore */ } }
      else t += dt;
      animT.set(a, t);
      try { a.currentTime = t; } catch { /* ignore */ }
    }
  }

  /** Advances the virtual clock by ms: due timers fire in order, CSS animations move, then one animation frame runs. */
  VT.step = async (ms) => {
    const target = VT.t + ms;
    for (let guard = 0; guard < 5000; guard++) {
      const n = nextTimer(target);
      if (!n) break;
      const [id, tm] = n;
      VT.t = Math.max(VT.t, tm.at);
      if (tm.every) tm.at += tm.every; else timers.delete(id);
      try { typeof tm.fn === 'function' ? tm.fn(...tm.args) : (0, eval)(tm.fn); } catch (e) { console.error(e); }
      await flush();
    }
    VT.t = target;
    for (const h of VT.hooks) { try { h(ms / 1000, VT.t); } catch (e) { console.error(e); } }
    const due = rafs; rafs = new Map();
    for (const cb of due.values()) { try { cb(VT.t); } catch (e) { console.error(e); } }
    await flush();
    stepAnimations(ms);
    VT.frames++;
  };

  /* ---- offline audio on the virtual clock ---- */
  const SR = 48000;
  const RealOAC = window.OfflineAudioContext;
  let vctx = null;
  const vnow = () => (vctx ? vctx.currentTime : 0);
  class VirtualAudioContext extends RealOAC {
    constructor() {
      super(2, Math.ceil(SR * (cfg.audioSeconds || 60)), SR);
      this._t0 = VT.t;
      vctx = this;
      VT.audio = this;
    }
    get currentTime() { return (VT.t - this._t0) / 1000; }
    get state() { return 'running'; }
    get baseLatency() { return 0; }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = window.webkitAudioContext = VirtualAudioContext;

  // `param.value = x` means "from now on" in a live context; offline, now is the virtual clock
  const pv = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  Object.defineProperty(AudioParam.prototype, 'value', {
    get: pv.get,
    set(v) {
      const t = vnow();
      if (t <= 0) { pv.set.call(this, v); return; }
      try { this.setValueAtTime(v, t); } catch { pv.set.call(this, v); }
    },
    configurable: true,
  });
  // start()/stop() with no time (or a time already past) mean "now"
  const S = AudioScheduledSourceNode.prototype, start = S.start, stop = S.stop;
  S.start = function (when = 0, ...rest) { return start.call(this, Math.max(+when || 0, vnow()), ...rest); };
  S.stop = function (when = 0) { return stop.call(this, Math.max(+when || 0, vnow())); };
  // old-style listener calls set a value for all time; turn them into automation at the virtual now
  const L = AudioListener.prototype;
  const setPos = L.setPosition, setOri = L.setOrientation;
  L.setPosition = function (x, y, z) {
    const t = vnow();
    if (this.positionX) { this.positionX.setValueAtTime(x, t); this.positionY.setValueAtTime(y, t); this.positionZ.setValueAtTime(z, t); } else setPos.call(this, x, y, z);
  };
  L.setOrientation = function (...a) { return setOri.apply(this, a); };

  /** Renders the whole soundtrack offline; returns its length in seconds. Read it with audioChunk(). */
  let rendered = null;
  VT.renderAudio = async () => {
    if (!vctx) return 0;
    rendered = await vctx.startRendering();
    return rendered.duration;
  };
  /** Interleaved stereo float32 PCM (base64) for [from, from + seconds) of the rendered soundtrack. */
  VT.audioChunk = (from, seconds) => {
    const b = rendered, a = Math.floor(from * SR), n = Math.max(0, Math.min(b.length - a, Math.round(seconds * SR)));
    const L0 = b.getChannelData(0), R0 = b.numberOfChannels > 1 ? b.getChannelData(1) : L0, f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { f[i * 2] = L0[a + i]; f[i * 2 + 1] = R0[a + i]; }
    const u8 = new Uint8Array(f.buffer);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
})();
