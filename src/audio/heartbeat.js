/*
 * A heartbeat heard from inside the chest: the deep "lub" of the valves closing, then a shorter,
 * softer and slightly higher "dub". Each sound is a few milliseconds of noise ringing through the
 * chest's resonances (a deep body, a knock and a little flesh) over a low sine that falls in pitch,
 * so it is felt on headphones and still heard on small laptop speakers. Works on any AudioContext,
 * so the autotest can render it offline and check its level.
 */

const noises = new WeakMap();
function noiseOf(ctx) {
  if (!noises.has(ctx)) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(ctx, b);
  }
  return noises.get(ctx);
}

function beat(ctx, dest, t, vol, pitch, len) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = vol;
  lp.connect(g).connect(dest);
  // the knock: a short burst of noise ringing through three chest resonances
  const src = ctx.createBufferSource(); src.buffer = noiseOf(ctx);
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0.0001, t);
  eg.gain.linearRampToValueAtTime(1, t + 0.004);
  eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.035 * len);
  src.connect(eg);
  for (const [f, q, a] of [[48, 2.2, 1], [96, 3.2, 0.7], [170, 4.5, 0.35]]) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * pitch; bp.Q.value = q;
    const bg = ctx.createGain(); bg.gain.value = a * 7;
    eg.connect(bp).connect(bg).connect(lp);
  }
  src.start(t, Math.random() * 0.3); src.stop(t + 0.25);
  // the body: a low sine that drops in pitch as the beat dies away
  const s = ctx.createOscillator(); s.type = 'sine';
  s.frequency.setValueAtTime(64 * pitch, t);
  s.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.13 * len);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.linearRampToValueAtTime(0.75, t + 0.01);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.17 * len);
  s.connect(sg).connect(lp);
  s.start(t); s.stop(t + 0.25);
}

/**
 * One heartbeat into `dest` at time `t`. `interval` is the time to the next beat: the pause between
 * "lub" and "dub" shortens as the heart races.
 */
export function renderHeartbeat(ctx, dest, t, vol = 1, interval = 0.8) {
  const gap = Math.min(0.3, Math.max(0.16, interval * 0.34));
  beat(ctx, dest, t, vol, 1, 1);
  beat(ctx, dest, t + gap, vol * 0.62, 1.16, 0.8);
}
