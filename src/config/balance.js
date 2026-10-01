/*
 * Game balance in one place. Tweak numbers here; no other file needs to change.
 * Distances are metres, times are seconds, damage is hit points (enemies have 100, heavies 260).
 */

export const PLAYER = {
  hp: 100, armor: 50,
  walk: 4.6, sprint: 7.1, crouch: 2.1, adsMove: 0.65,
  jump: 6.0, gravity: 18,   // a 1 m hop; crates and low walls up to 1.6 m are climbed or vaulted (jump + forward)
  stamina: 100, staminaDrain: 24, staminaRegen: 16, staminaDelay: 0.9,
  regenDelay: 5, regenRate: 9, regenStep: 25,   // heals back to the next 25-point segment
  armorAbsorb: 0.5,
};

/*
 * Weapons. Each one owns a niche: the rifle is the all-rounder, the SMG shreds up close and while
 * moving, the shotgun one-shots inside a room, the DMR drops a raider with two body shots (one to the
 * head) at any range and ignores armour, and the pistol is a fast, accurate sidearm (3 body shots).
 * zoom = FOV multiplier when aiming, bloom = spread added per round of sustained fire,
 * adsSpeed = how quickly the sight comes up, ap = full damage against armour plates.
 */
export const WEAPONS = {
  rifle: {
    name: 'شاهين', full: 'بندقية «شاهين» الهجومية', cls: 'بندقية هجومية', slot: 'primary', rank: 0, mode: 'تلقائي',
    auto: true, rpm: 640, dmg: 34, mag: 30, reserve: 120, reserveMax: 180, reload: 2.1, reloadEmpty: 2.6,
    spread: 0.009, moveSpread: 0.045, jumpSpread: 0.12, adsSpread: 0.0012, recoilV: 0.016, recoilH: 0.006, bloom: 0.0022,
    zoom: 0.6, adsSpeed: 14, impulse: 75, falloff: [40, 100, 0.7], pen: 0.5, mobility: 1, sight: 'dot',
  },
  smg: {
    name: 'زوبعة', full: 'رشاش «زوبعة» الخفيف', cls: 'رشاش خفيف', slot: 'primary', rank: 2, mode: 'تلقائي',
    auto: true, rpm: 880, dmg: 29, mag: 32, reserve: 160, reserveMax: 224, reload: 1.7, reloadEmpty: 2.05,
    spread: 0.006, moveSpread: 0.012, jumpSpread: 0.06, adsSpread: 0.0024, recoilV: 0.0085, recoilH: 0.0055, bloom: 0.0012,
    zoom: 0.72, adsSpeed: 19, impulse: 60, falloff: [22, 55, 0.6], pen: 0.35, mobility: 1.12, sight: 'dot',
  },
  shotgun: {
    name: 'صقر', full: 'بندقية خرطوش «صقر»', cls: 'خرطوش', slot: 'primary', rank: 3, mode: 'تلقيم يدوي',
    auto: false, pump: 0.5, rpm: 85, dmg: 21, pellets: 9, mag: 7, reserve: 35, reserveMax: 49, shellTime: 0.44,
    spread: 0.042, moveSpread: 0.012, jumpSpread: 0.04, adsSpread: 0.029, recoilV: 0.05, recoilH: 0.012, bloom: 0,
    zoom: 0.8, adsSpeed: 15, impulse: 70, falloff: [11, 32, 0.3], pen: 0, mobility: 0.97, sight: 'iron',
  },
  dmr: {
    name: 'نشّاب', full: 'بندقية القنص «نشّاب»', cls: 'بندقية قنص', slot: 'primary', rank: 5, mode: 'طلقة مفردة',
    auto: false, rpm: 230, dmg: 92, mag: 12, reserve: 48, reserveMax: 72, reload: 2.2, reloadEmpty: 2.7,
    spread: 0.016, moveSpread: 0.055, jumpSpread: 0.15, adsSpread: 0.0002, recoilV: 0.036, recoilH: 0.008, bloom: 0,
    zoom: 0.22, adsSpeed: 11, impulse: 140, falloff: null, pen: 0.75, ap: true, mobility: 0.92, sight: 'scope',
  },
  pistol: {
    name: 'نمر', full: 'مسدس «نمر»', cls: 'مسدس', slot: 'secondary', rank: 0, mode: 'طلقة مفردة',
    auto: false, rpm: 450, dmg: 38, mag: 15, reserve: 60, reserveMax: 105, reload: 1.3, reloadEmpty: 1.6,
    spread: 0.007, moveSpread: 0.022, jumpSpread: 0.07, adsSpread: 0.0025, recoilV: 0.024, recoilH: 0.008, bloom: 0.003,
    zoom: 0.8, adsSpeed: 19, impulse: 60, falloff: [25, 55, 0.65], pen: 0.2, mobility: 1.1, sight: 'iron',
  },
};
export const PRIMARIES = ['rifle', 'smg', 'shotgun', 'dmr'];

export const GRENADE = { fuse: 3.0, radius: 7.5, damage: 175, carry: 2, max: 3 };

/* Knife: a quick stab in a cone in front of the player. From behind it always kills. */
export const MELEE = { range: 2.2, cone: 0.75, dmg: 150, duration: 0.5, hitAt: 0.16 };

export const ENEMY = {
  raider: { hp: 100, speed: 3.9, dmg: 10, burst: [3, 5], rof: 0.13, headMul: 4 },
  heavy: { hp: 260, speed: 2.7, dmg: 8, burst: [5, 8], rof: 0.09, headMul: 2.2, torsoMul: 0.8 },
  sniper: { hp: 90, charge: 2.3, dmg: 46, cooldown: 3.6, range: 130 },
  grenadier: { cooldown: [10, 15], range: [8, 32] },
};

export const ALLY = { hp: 160, dmg: 25, regen: 4, burst: [3, 5], rof: 0.12, spread: 0.017 };

/*
 * Difficulty. dmg/spread/react scale the raiders' marksmanship; ai is their tactical profile:
 * fov (degrees they watch), notice (seconds to recognise a target in plain view at 20 m),
 * hear (metres at which gunfire carries), flank/flankers (chance to circle round, and how many at
 * once), nade (chance a rifleman carries a grenade) and nadeGap (seconds between squad grenades),
 * heal (field dressings per man), cover (how reliably they get out of the open), peek (seconds
 * exposed per peek), relocate (peeks before changing cover), settle (how fast their aim tightens),
 * runGun (fire while moving), preaim (watch the last known position), hop (dodge hops),
 * push (bound forward cover to cover), strafe, snipe (sniper charge-time factor), intel (seconds for
 * a sighting to reach the whole squad).
 */
export const DIFFICULTY = {
  recruit: {
    name: 'مجنّد', desc: 'غزاة أبطأ ردّاً وأقل دقة، ونادراً ما يلتفّون أو يرمون القنابل. مثالية للتعلّم.', xpMul: 0.75, dmg: 0.6, spread: 1.35, react: 1.3, count: 0.8, regen: true,
    ai: { fov: 130, notice: 0.95, hear: 26, flank: 0.12, flankers: 1, nade: 0.2, nadeGap: 16, heal: 0, cover: 0.55, peek: [1.8, 3.2], relocate: 4, settle: 0.8, runGun: false, preaim: 0.25, hop: 0, push: 0.3, strafe: 0.5, snipe: 1.2, intel: 3.5 },
  },
  veteran: {
    name: 'محترف', desc: 'غزاة أذكياء: يتنقّلون بين السواتر، ويلتفّون عليك بينما يشغلك رفاقهم، ويرمون القنابل على من يتحصّن.', xpMul: 1, dmg: 1, spread: 0.9, react: 0.85, count: 1, regen: true,
    ai: { fov: 160, notice: 0.45, hear: 42, flank: 0.55, flankers: 2, nade: 0.75, nadeGap: 6, heal: 1, cover: 0.92, peek: [1.1, 2.2], relocate: 3, settle: 1.7, runGun: true, preaim: 0.85, hop: 0.2, push: 0.6, strafe: 0.9, snipe: 0.95, intel: 1.2 },
  },
  legend: {
    name: 'أسطورة', desc: 'غزاة أكثر عدداً وأشد دقة وتنسيقاً، لا يغفلون عنك لحظة، ولا تتجدد صحتك.', xpMul: 1.6, dmg: 1.4, spread: 0.75, react: 0.62, count: 1.25, regen: false,
    ai: { fov: 190, notice: 0.28, hear: 56, flank: 0.7, flankers: 3, nade: 0.95, nadeGap: 4, heal: 2, cover: 1, peek: [0.9, 1.8], relocate: 2, settle: 2.6, runGun: true, preaim: 1, hop: 0.35, push: 0.75, strafe: 1, snipe: 0.8, intel: 0.6 },
  },
};

export const MODES = {
  dusk: { name: 'عملية الغسق', tag: '٨ ساعات · تقييم بالنجوم', desc: 'اصمد من العصر حتى منتصف الليل. ثماني موجات، وكل موجة ساعة.', rank: 0 },
  dawn: { name: 'حتى الفجر', tag: 'صمود بلا نهاية', desc: 'تستمر الموجات بعد منتصف الليل حتى يشرق الفجر وما بعده. سجّل أعلى نتيجة.', rank: 1 },
};

/* Campaign waves: hour, count, max alive, and the share of each enemy type. */
export const DUSK_WAVES = [
  { h: 16, n: 4, max: 3, heavy: 0, night: 0, gren: 0, snipers: 0, heli: false, title: 'العصر' },
  { h: 17, n: 6, max: 4, heavy: 0, night: 0, gren: 0, snipers: 0, heli: false, title: 'ما قبل الغروب' },
  { h: 18, n: 7, max: 4, heavy: 0.12, night: 0, gren: 0.1, snipers: 1, heli: false, title: 'الغروب' },
  { h: 19, n: 8, max: 5, heavy: 0.15, night: 0.4, gren: 0.18, snipers: 0, heli: false, title: 'الغسق' },
  { h: 20, n: 10, max: 5, heavy: 0.2, night: 0.7, gren: 0.2, snipers: 1, heli: true, title: 'أول الليل' },
  { h: 21, n: 10, max: 6, heavy: 0.25, night: 0.9, gren: 0.22, snipers: 0, heli: false, title: 'عتمة الليل' },
  { h: 22, n: 11, max: 6, heavy: 0.3, night: 1, gren: 0.25, snipers: 2, heli: false, title: 'سكون الليل' },
  { h: 23, n: 14, max: 7, heavy: 0.35, night: 1, gren: 0.25, snipers: 1, heli: true, title: 'الساعة الأخيرة' },
];
const HOUR_TITLES = {
  0: 'منتصف الليل', 1: 'جوف الليل', 2: 'جوف الليل', 3: 'الهزيع الأخير', 4: 'الهزيع الأخير', 5: 'قبيل الفجر',
  6: 'الفجر', 7: 'الشروق', 8: 'الضحى', 9: 'الضحى', 10: 'الضحى', 11: 'قبيل الظهر', 12: 'الظهيرة', 13: 'الظهيرة',
  14: 'بعد الظهر', 15: 'العصر', 16: 'العصر', 17: 'ما قبل الغروب', 18: 'الغروب', 19: 'الغسق', 20: 'أول الليل',
  21: 'عتمة الليل', 22: 'سكون الليل', 23: 'الساعة الأخيرة',
};
/** Wave definition for index i (0-based). Past the campaign it keeps escalating. */
export function waveDef(i) {
  if (i < DUSK_WAVES.length) return { ...DUSK_WAVES[i], index: i };
  const k = i - DUSK_WAVES.length + 1;
  const h = 16 + i, hod = h % 24;
  const dark = hod >= 19 || hod < 6;
  return {
    index: i, h, n: Math.min(32, 14 + k * 2), max: Math.min(10, 7 + Math.floor(k / 2)),
    heavy: Math.min(0.45, 0.35 + k * 0.02), night: dark ? 1 : 0, gren: 0.28,
    snipers: 1 + (k % 3 === 0 ? 1 : 0), heli: k % 3 === 1, title: HOUR_TITLES[hod],
  };
}
/** Raider aim and pacing tighten with every wave. */
export const waveSkill = (i) => ({
  spread: Math.max(0.018, 0.036 - i * 0.0017),
  react: Math.max(0.55, 1.2 - i * 0.06),
  pause: Math.max(0.65, 1.2 - i * 0.05),
  dmg: Math.min(1.35, 0.85 + i * 0.045),
});

export const SUPPORTS = [
  { id: 'uav', name: 'طائرة استطلاع', short: 'استطلاع', key: '3', cost: 350, cd: 45, dur: 35, desc: 'تحوم فوق ساحة المعركة وتكشف مواقع الغزاة ٣٥ ثانية.' },
  { id: 'supply', name: 'إنزال إمداد', short: 'إمداد', key: '4', cost: 450, cd: 60, desc: 'طائرة نقل تُسقط بالمظلة صندوق ذخيرة ودرع وقنابل، وفوقه سلاح إضافي تأخذه بـ E.' },
  { id: 'ally', name: 'استدعاء رفيق', short: 'رفيق', key: '5', cost: 800, cd: 90, desc: 'جندي يهبط بالمظلة ويقاتل إلى جانبك. رفيقان كحدّ أقصى، والثاني أغلى.' },
  { id: 'strike', name: 'غارة جوية', short: 'غارة', key: '6', cost: 1100, cd: 100, desc: 'حدّد الهدف بمنظار الليزر، ثم تُلقي مقاتلة خمس قنابل.' },
];

export const SCORE = {
  kill: 100, headshot: 50, longshot: 40, explosive: 50, barrel: 75, multi: 50, allyAssist: 50, melee: 100, backstab: 60,
  heli: 1000, waveBase: 300, wavePer: 100, flawless: 250, victory: 3000,
};

/* Rank ladder: name, XP needed, insignia [type, count]. */
export const RANKS = [
  ['جندي', 0, 'chev', 0], ['جندي أول', 1200, 'chev', 1], ['عريف', 3000, 'chev', 2], ['رقيب', 6000, 'chev', 3],
  ['رقيب أول', 10000, 'chev', 4], ['ملازم', 15000, 'star', 1], ['ملازم أول', 22000, 'star', 2], ['نقيب', 30000, 'star', 3],
  ['رائد', 40000, 'eagle', 0], ['مقدم', 55000, 'eagle', 1], ['عقيد', 75000, 'eagle', 2], ['عميد', 100000, 'eagle', 3],
  ['لواء', 140000, 'sword', 0],
].map(([name, xp, type, n]) => ({ name, xp, type, n }));

export const SKINS = [
  { id: 'std', name: 'قياسي', rank: 0 },
  { id: 'tiger', name: 'نمر الصحراء', rank: 1 },
  { id: 'night', name: 'العمليات الليلية', rank: 3 },
  { id: 'gold', name: 'ذهبي', rank: 6 },
];

/* Allies: at most two at once; each extra one costs more, so support never becomes an army. */
export const ALLY_ROSTER = ['الرقيب سالم', 'العريف فهد'];
export const ALLY_MAX = 2;
export const allyCost = (alive) => 800 + alive * 600;

export const MAPS = {
  citadel: {
    name: 'قصر الرمال', desc: 'قلعة مسوّرة بثلاث بوابات وثغرة في السور الشرقي، وساحة نافورة وسوق مسقوف. قتال متوسط المدى.', traits: ['متوسط المدى', '٣ بوابات وثغرة', '٤ أبراج قنص'],
    note: 'الغزاة يتجمّعون تحت راياتهم الحمراء خارج البوابات الثلاث والثغرة الشرقية. الدوائر الصفراء أعشاش قنّاصة على الأبراج الأربعة، وسطح مخفر البوابة الشمالية يُصعد إليه بالدرج.',
  },
  village: {
    name: 'القرية المهجورة', desc: 'أزقة ضيقة وبيوت مهدّمة وبستان نخيل ومقبرة قديمة. قتال قريب ومفاجآت عند كل زاوية.', traits: ['قتال قريب', '٨ مداخل', 'سطح يُصعد إليه'],
    note: 'الغزاة يتسللون من المداخل الأربعة ومن ثغرات السور. أعشاش القنص: المئذنة وخزان الماء وبرج المراقبة وسطح بيت المزرعة. درج خارجي يصعد إلى سطح يطلّ على الشارع الشرقي.',
  },
  station: {
    name: 'محطة الوادي', desc: 'محطة قطار مهجورة في الصحراء: أرصفة وعربات شحن على السكة، ومستودع تقاتل داخله، وبرج ساعة يشرف على كل شيء.', traits: ['مدى متنوّع', 'عربات قطار', 'مستودع مغلق'],
    note: 'الغزاة يدخلون من بوابتي الطريق شمالاً وجنوباً، ومع السكة من الشرق والغرب، ومن ثغرتين في السور. أعشاش القنص: برج الساعة وكشك الإشارات وخزان الماء وسطح المستودع.',
  },
};

export const MEDALS = [
  { id: 'first', name: 'أول دم', desc: 'اقتل أول غازٍ.', xp: 100 },
  { id: 'hs25', name: 'عين الصقر', desc: '٢٥ إصابة في الرأس في جولة واحدة.', xp: 800 },
  { id: 'h20', name: 'صامد', desc: 'اصمد حتى الساعة 20:00.', xp: 500 },
  { id: 'win', name: 'حارس منتصف الليل', desc: 'اصمد حتى منتصف الليل.', xp: 2000 },
  { id: 'legend', name: 'أسطورة الغسق', desc: 'انتصر على صعوبة «أسطورة».', xp: 5000 },
  { id: 'tri', name: 'ضربة ثلاثية', desc: 'اقتل ثلاثة غزاة بانفجار واحد.', xp: 600 },
  { id: 'barrels', name: 'مصيدة البراميل', desc: 'عشرة قتلى بالبراميل المتفجرة (إجمالي).', xp: 700 },
  { id: 'longshot', name: 'طلقة بعيدة', desc: 'اقتل غازياً من مسافة ٦٠ متراً.', xp: 500 },
  { id: 'heli', name: 'قاهر المروحيات', desc: 'أسقط مروحية معادية.', xp: 1500 },
  { id: 'flawless', name: 'بلا خدش', desc: 'أنهِ موجة كاملة دون أي إصابة.', xp: 400 },
  { id: 'commander', name: 'قائد الإسناد', desc: 'استخدم الأنواع الأربعة من الإسناد في جولة واحدة.', xp: 800 },
  { id: 'buddy', name: 'الرفيق الوفي', desc: 'رفيقك يقتل خمسة غزاة في جولة واحدة.', xp: 600 },
  { id: 'dawn', name: 'حتى الفجر', desc: 'اصمد حتى الساعة 05:00 في وضع «حتى الفجر».', xp: 4000 },
  { id: 'focus5', name: 'زمن الصقر', desc: 'اقتل خمسة غزاة خلال تركيز واحد.', xp: 700 },
];

export const FOCUS = { min: 30, start: 35, drain: 17, timeScale: 0.32, playerScale: 0.8, killGain: 12, headGain: 28, explosiveGain: 6, multiGain: 10 };
