// Tiny DOM builder. Text always goes in through textContent / text nodes:
// nothing here ever sets innerHTML, so names typed by children and parents
// cannot become markup.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function setProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Big chunky button. `icon` and `label` are plain text. */
export function btn({ icon, label, cls = '', onClick, sfx = true, disabled, aria, title }) {
  const b = h('button', { type: 'button', class: `btn ${cls}`, disabled, 'aria-label': aria || label || null, title: title || null },
    icon != null ? h('span', { class: 'btn-icon', 'aria-hidden': 'true' }, icon) : null,
    label != null ? h('span', { class: 'btn-label' }, label) : null);
  if (onClick) b.addEventListener('click', (e) => { if (sfx) btn.onTap?.(); onClick(e); });
  return b;
}
btn.onTap = null;

export function clear(el) { el.replaceChildren(); return el; }

/** A bar: have / need. */
export function bar(frac, cls = '') {
  const fill = h('div', { class: 'bar-fill', style: { width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` } });
  return h('div', { class: `bar ${cls}` }, fill);
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Count a number up in an element's text. */
export function countUp(el, from, to, ms = 700, onTick) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let last = from;
    const step = (t) => {
      const f = Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - f, 3)));
      el.textContent = String(v);
      if (v !== last) { last = v; onTick?.(v); }
      if (f < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Confetti burst of DOM particles from an element (reward-screen juice). */
export function burst(at, { n = 24, colors = ['#ffd24a', '#ff7ab6', '#7be0ff', '#8dff8a', '#c59bff'], spread = 160, chars = null } = {}) {
  const r = at.getBoundingClientRect();
  const layer = document.getElementById('fx') || document.body;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('div');
    p.className = chars ? 'fx-char' : 'fx-bit';
    if (chars) p.textContent = chars[i % chars.length];
    else p.style.background = colors[i % colors.length];
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.4 + Math.random() * 0.6);
    p.style.left = `${r.left + r.width / 2}px`;
    p.style.top = `${r.top + r.height / 2}px`;
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1100);
  }
}
