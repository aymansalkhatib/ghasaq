import { RANKS } from '../config/balance.js';

/* Inline SVG icons: weapon silhouettes, support calls, medals and rank insignia. */

const svg = (vb, body, cls = '') => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const WEAPON_ICONS = {
  rifle: svg('0 0 64 24', '<path d="M2 9h31l3-3h13v4h9v3H45l-2 2h-6l-3 7h-5l2-7H15l-4 4H4l3-5H2z"/>'),
  smg: svg('0 0 64 24', '<path d="M8 8h28l2-2h8v4h6v3h-8l-2 2h-6v8h-5v-8h-4l-3 5h-6l3-5H8z"/>'),
  shotgun: svg('0 0 64 24', '<path d="M1 10h40l2-2h10v5H44l-6 2H22l-5 6h-7l4-6H1z"/><rect x="18" y="13" width="14" height="3"/>'),
  dmr: svg('0 0 64 24', '<path d="M1 11h36l2-2h8v3h14v3H40l-2 2h-5l-2 6h-5l1-6H14l-4 4H4l3-5H1z"/><rect x="20" y="4" width="16" height="4" rx="2"/>'),
  pistol: svg('0 0 64 24', '<path d="M16 6h28v6H33l-2 2h-4l-3 8h-6l3-10h-5z"/>'),
  nade: svg('0 0 64 24', '<path d="M29 3h7v3h-7z"/><circle cx="32" cy="14" r="8"/>'),
  knife: svg('0 0 64 24', '<path d="M6 11h30c8 0 16 2 22 6-9 0-16-1-22-2H6z"/><rect x="18" y="8" width="3" height="10"/><rect x="4" y="10" width="14" height="5" rx="2"/>'),
  enemyNade: svg('0 0 64 24', '<path d="M29 3h7v3h-7z"/><circle cx="32" cy="14" r="8"/>'),
  barrel: svg('0 0 64 24', '<path d="M32 1c4 5 9 8 9 14a9 9 0 0 1-18 0c0-5 3-7 5-11 1 3 2 5 4 6 0-3-1-6 0-9z"/>'),
  airstrike: svg('0 0 64 24', '<path d="M10 11l20-3 8-6h4l-4 7 16-1 4-4h3l-2 6 2 6h-3l-4-4-16-1 4 7h-4l-8-6-20-3z"/>'),
  heli: svg('0 0 64 24', '<path d="M6 3h52v2H33v3h6c7 0 12 4 12 8s-5 5-12 5H25l-3-5H8l-2-4h16l3-4h5V5H6z"/>'),
  ally: svg('0 0 64 24', '<circle cx="32" cy="7" r="5"/><path d="M22 23c0-6 4-10 10-10s10 4 10 10z"/>'),
};
export const HEADSHOT = svg('0 0 24 24', '<path d="M12 2a8 8 0 0 1 8 8c0 3-2 5-3 6v4H7v-4c-1-1-3-3-3-6a8 8 0 0 1 8-8zm-3 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>', 'hsico');

export const SUPPORT_ICONS = {
  uav: svg('0 0 32 32', '<path d="M4 15h24v2H4z"/><path d="M13 10h6l1 12h-8z"/><path d="M11 25h10v2H11z"/><circle cx="16" cy="9" r="2"/>'),
  supply: svg('0 0 32 32', '<path d="M6 4a10 6 0 0 1 20 0z"/><path d="M8 4l6 12M24 4l-6 12" stroke="currentColor" stroke-width="1.2" fill="none"/><rect x="10" y="16" width="12" height="11" rx="1"/>'),
  ally: svg('0 0 32 32', '<path d="M6 5a10 6 0 0 1 20 0z"/><path d="M8 5l7 8M24 5l-7 8" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="16" cy="16" r="3"/><path d="M11 29c0-5 2-9 5-9s5 4 5 9z"/>'),
  strike: svg('0 0 32 32', '<path d="M3 13l12-2 5-6h3l-2 6 8-1 2-3h2l-1 5 1 5h-2l-2-3-8-1 2 6h-3l-5-6-12-2z"/><circle cx="16" cy="26" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 21v10M11 26h10" stroke="currentColor" stroke-width="1.2"/>'),
};

/** Medal icon: a star or a laurel roundel, tinted by CSS. */
export function medalIcon(id, earned) {
  return `<svg class="medal-ico${earned ? ' on' : ''}" viewBox="0 0 40 48" aria-hidden="true">
    <path d="M12 0h6l2 10-5 3zM28 0h-6l-2 10 5 3z" class="ribbon"/>
    <circle cx="20" cy="30" r="14" class="disc"/>
    <path d="M20 20l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" class="star"/>
  </svg>`;
}

/** Rank insignia: chevrons for enlisted ranks, stars for junior officers, eagles and swords above. */
export function rankInsignia(idx, size = 64) {
  const r = RANKS[Math.max(0, Math.min(RANKS.length - 1, idx))];
  let body = '';
  if (r.type === 'chev') {
    if (r.n === 0) body = '<circle cx="32" cy="32" r="9" class="ins-fill"/>';
    for (let k = 0; k < r.n; k++) { const y = 20 + k * 9; body += `<path d="M12 ${y + 10}l20-10 20 10v6l-20-10-20 10z" class="ins-fill"/>`; }
  } else if (r.type === 'star') {
    const xs = r.n === 1 ? [32] : r.n === 2 ? [22, 42] : [14, 32, 50];
    for (const x of xs) body += star(x, 32, 9);
  } else if (r.type === 'eagle') {
    body = '<path d="M32 16c3 3 4 6 4 9 6-6 14-7 20-5-6 2-10 6-12 11 4-1 8 0 10 3-5 0-9 2-12 6l-2 10h-16l-2-10c-3-4-7-6-12-6 2-3 6-4 10-3-2-5-6-9-12-11 6-2 14-1 20 5 0-3 1-6 4-9z" class="ins-fill"/>';
    const xs = r.n === 1 ? [32] : r.n === 2 ? [24, 40] : r.n === 3 ? [18, 32, 46] : [];
    for (const x of xs) body += star(x, 58, 4.5);
  } else {
    body = '<path d="M14 50L46 12l4 4L18 54zM50 50L18 12l-4 4 32 38z" class="ins-fill"/>' + star(32, 30, 7);
  }
  return `<svg class="insignia" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" class="ins-bg"/>${body}</svg>`;
}
function star(cx, cy, r) {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    d += (k ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return `<path d="${d}z" class="ins-fill"/>`;
}
