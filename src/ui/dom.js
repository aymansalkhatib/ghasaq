/* DOM helpers shared by the HUD and menus. */

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
/** Restart a CSS animation class on an element. */
export function replay(node, cls = 'show') {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}
const cache = new Map();
/** Set text only when it changed (the HUD updates every frame). */
export function setText(id, v) {
  v = String(v);
  if (cache.get(id) === v) return;
  cache.set(id, v);
  const node = $(id);
  if (node) node.textContent = v;
}
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
