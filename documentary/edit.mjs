/*
 * Cuts the recorded scenes into the film.
 *
 *   node documentary/edit.mjs [output.mp4] [--draft]
 *
 * Scenes from documentary/out/<scene>/ (video.mp4 + audio.wav) in ORDER, joined with crossfades,
 * each scene's soundtrack levelled to its target loudness, then the whole mix normalised to -16 LUFS.
 * The picture is scaled to 1920x1080 (960x540 with --draft for a quick look).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const out = args.find((a) => !a.startsWith('--')) || join(here, draft ? 'draft.mp4' : 'ghasaq-documentary.mp4');
const ORDER = (process.env.DOC_ORDER || 'A,B,C,D,E,F,G').split(',');
// loudness each scene is levelled to before the final mix (music-only scenes sit a little lower)
const TARGET = { A: -18, B: -17, C: -17, D: -18, E: -21, F: -20, G: -17.5 };
const XF = 0.8;

function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop() || '');
  return m ? parseFloat(m[1]) : -20;
}

const clips = ORDER.filter((id) => existsSync(join(here, 'out', id, 'video.mp4'))).map((id) => {
  const dir = join(here, 'out', id);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const hasAudio = existsSync(join(dir, 'audio.wav'));
  const lufs = hasAudio ? loudness(join(dir, 'audio.wav')) : null;
  const gain = hasAudio ? Math.max(-20, Math.min(20, (TARGET[id] ?? -18) - lufs)) : 0;
  console.log(`${id}: ${meta.seconds.toFixed(1)} s, ${hasAudio ? lufs.toFixed(1) + ' LUFS, gain ' + gain.toFixed(1) + ' dB' : 'no audio'}`);
  return { id, dir, dur: meta.seconds, hasAudio, gain };
});
if (!clips.length) { console.log('no scenes recorded in documentary/out/'); process.exit(1); }

const inputs = [], f = [];
clips.forEach((c, i) => {
  inputs.push('-i', join(c.dir, 'video.mp4'));
  if (c.hasAudio) inputs.push('-i', join(c.dir, 'audio.wav'));
  else inputs.push('-f', 'lavfi', '-t', String(c.dur), '-i', 'anullsrc=r=48000:cl=stereo');
  f.push(`[${i * 2}:v]settb=AVTB,fps=30,format=yuv420p[v${i}]`);
  // float soundtracks can peak above full scale: level first, then a soft limiter per scene
  f.push(`[${i * 2 + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${c.gain.toFixed(2)}dB,alimiter=limit=0.89:attack=4:release=60:level=disabled,atrim=0:${c.dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
});
let v = 'v0', a = 'a0', t = clips[0].dur;
for (let i = 1; i < clips.length; i++) {
  f.push(`[${v}][v${i}]xfade=transition=fade:duration=${XF}:offset=${(t - XF).toFixed(3)}[vx${i}]`);
  f.push(`[${a}][a${i}]acrossfade=d=${XF}:c1=tri:c2=tri[ax${i}]`);
  v = `vx${i}`; a = `ax${i}`;
  t += clips[i].dur - XF;
}
const W = draft ? 960 : 1920, H = draft ? 540 : 1080;
f.push(`[${v}]fade=t=in:st=0:d=1,fade=t=out:st=${(t - 1.6).toFixed(3)}:d=1.6,scale=${W}:${H}:flags=lanczos${draft ? '' : ',unsharp=5:5:0.35'},format=yuv420p[vout]`);
f.push(`[${a}]afade=t=in:st=0:d=1,afade=t=out:st=${(t - 2).toFixed(3)}:d=2,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

console.log(`film: ${t.toFixed(1)} s (${(t / 60).toFixed(2)} min) -> ${out}`);
const enc = draft ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-tune', 'film'];
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...inputs, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
  ...enc, '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-metadata', 'title=غسق · فيلم توثيقي', out], { stdio: 'inherit' });
process.exit(r.status || 0);
