import { store } from '../core/utils.js';

/* Player-facing settings, quality presets and the schema the settings screen renders from. */

// '#touch' in the address forces the phone controls on a desktop (handy for testing the layout)
export const isTouch = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) || location.hash.includes('touch');
export const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const QUALITY = {
  low: { label: 'منخفضة', pr: 0.75, shadow: 512, bloom: false, samples: 0, particles: 0.45 },
  medium: { label: 'متوسطة', pr: 1, shadow: 1024, bloom: false, samples: 2, particles: 0.7 },
  high: { label: 'عالية', pr: 1.5, shadow: 2048, bloom: true, samples: 4, particles: 1 },
  ultra: { label: 'فائقة', pr: 2, shadow: 4096, bloom: true, samples: 4, particles: 1 },
};

const DEFAULTS = {
  // graphics
  quality: isTouch ? 'medium' : 'high',
  dynRes: true,
  fov: 80,
  grain: true,
  fps: false,
  // controls
  sens: 1,
  adsSens: 0.85,
  invertY: false,
  touchSens: 1,
  aimAssist: true,
  autoFire: false,
  hudScale: 1,
  // audio
  master: 0.85,
  music: 0.35,
  sfx: 1,
  muted: false,
  vocals: true,
  // gameplay
  blood: true,
  crosshair: 'cross',
  hints: true,
};

const KEY = 'ghasaq.settings.v2';
export const settings = Object.assign({}, DEFAULTS, store.get(KEY, {}));
if (!QUALITY[settings.quality]) settings.quality = DEFAULTS.quality;
// the first release shipped the music too loud: move anyone still on that default to the new one
if (!settings.mixV3) { if (settings.music === 0.55) settings.music = DEFAULTS.music; settings.mixV3 = true; store.set(KEY, settings); }

const listeners = [];
export function onSettingsChange(fn) { listeners.push(fn); }
export function saveSettings(changedKey) {
  store.set(KEY, settings);
  for (const fn of listeners) fn(changedKey, settings[changedKey]);
}
export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  saveSettings('*');
}

const pct = (v) => Math.round(v * 100) + '%';
export const SETTINGS_TABS = [
  { id: 'gfx', label: 'الرسوميات' },
  { id: 'ctl', label: 'التحكم' },
  { id: 'snd', label: 'الصوت' },
  { id: 'play', label: 'اللعب' },
];
export const SETTINGS_SCHEMA = [
  { tab: 'gfx', key: 'quality', label: 'جودة الرسوميات', type: 'seg', opts: Object.entries(QUALITY).map(([k, q]) => [k, q.label]), hint: 'الظلال والتوهج ودقة العرض' },
  { tab: 'gfx', key: 'dynRes', label: 'دقة ديناميكية (تخفض الدقة قليلاً عند الضغط للحفاظ على السلاسة)', type: 'toggle' },
  { tab: 'gfx', key: 'fov', label: 'مجال الرؤية', type: 'range', min: 65, max: 100, step: 1, fmt: (v) => v + '°' },
  { tab: 'gfx', key: 'grain', label: 'حبيبات الفيلم', type: 'toggle' },
  { tab: 'gfx', key: 'fps', label: 'عدّاد الإطارات', type: 'toggle' },
  { tab: 'ctl', key: 'sens', label: 'حساسية الماوس', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => Number(v).toFixed(2) },
  { tab: 'ctl', key: 'adsSens', label: 'الحساسية أثناء التصويب', type: 'range', min: 0.3, max: 1.5, step: 0.05, fmt: (v) => Number(v).toFixed(2) },
  { tab: 'ctl', key: 'invertY', label: 'عكس المحور العمودي', type: 'toggle' },
  { tab: 'ctl', key: 'touchSens', label: 'حساسية اللمس', type: 'range', min: 0.3, max: 2.5, step: 0.05, fmt: (v) => Number(v).toFixed(2) },
  { tab: 'ctl', key: 'aimAssist', label: 'مساعد التصويب (لمس وذراع تحكم)', type: 'toggle' },
  { tab: 'ctl', key: 'autoFire', label: 'إطلاق تلقائي عند التصويب على عدو (لمس)', type: 'toggle' },
  { tab: 'ctl', key: 'hudScale', label: 'حجم الواجهة', type: 'range', min: 0.8, max: 1.3, step: 0.05, fmt: pct },
  { tab: 'snd', key: 'muted', label: 'كتم الصوت', type: 'toggle' },
  { tab: 'snd', key: 'master', label: 'الصوت العام', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { tab: 'snd', key: 'music', label: 'الموسيقى', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { tab: 'snd', key: 'sfx', label: 'المؤثرات', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { tab: 'snd', key: 'vocals', label: 'صوت ألمك عند الإصابة', type: 'toggle' },
  { tab: 'play', key: 'blood', label: 'الدم والإصابات', type: 'toggle' },
  { tab: 'play', key: 'crosshair', label: 'شكل التصويب', type: 'seg', opts: [['cross', 'تقاطع'], ['dot', 'نقطة'], ['circle', 'دائرة']] },
  { tab: 'play', key: 'hints', label: 'تلميحات المبتدئين', type: 'toggle' },
];
