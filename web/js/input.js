// Input capture: the "charged number" (keyboard digits + on-screen pad) and
// pointer/touch swipes forwarded to the engine.

const MAX_DIGITS = 3; // answers go up to 144

/** True when an on-screen number pad should be shown. `?pad=1` / `?pad=0` override. */
export function wantsTouchPad() {
  const q = new URLSearchParams(location.search).get('pad');
  if (q === '1') return true;
  if (q === '0') return false;
  return matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/**
 * Holds the number the child has typed. Typing a digit when the number is
 * already MAX_DIGITS long starts a new number. Backspace / Escape / Delete clear
 * the charge (SPEC); Escape never pauses — pause is the shell's button.
 */
export class ChargeInput {
  /** `onSfx(id, {semitones})` gets `sfx_key_tap` (+0/+2/+4 by digit) and `sfx_backspace`. */
  constructor({ onChange, onSfx } = {}) {
    this.text = '';
    this.onChange = onChange || (() => {});
    this.onSfx = onSfx || null;
    this.enabled = true;
  }

  /** @returns {number|null} */
  get value() {
    return this.text === '' ? null : parseInt(this.text, 10);
  }

  push(digit) {
    if (!this.enabled) return;
    if (this.text.length >= MAX_DIGITS || this.text === '0') this.text = '';
    this.text += String(digit);
    if (this.onSfx) this.onSfx('sfx_key_tap', { semitones: [0, 2, 4][this.text.length - 1] || 0 });
    this.onChange(this.value);
  }

  clear() {
    if (this.text === '') return;
    this.text = '';
    if (this.onSfx) this.onSfx('sfx_backspace', { semitones: 0 });
    this.onChange(null);
  }

  /** Clear without notifying (used when the engine already cleared it). */
  reset() {
    this.text = '';
  }

  attachKeyboard(target = window) {
    target.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) {
        this.push(e.key);
        e.preventDefault();
      } else if (e.key === 'Backspace' || e.key === 'Escape' || e.key === 'Delete') {
        this.clear();
        e.preventDefault();
      }
    });
  }

  /** Build the big 0-9 + clear pad inside `container`. */
  buildPad(container) {
    container.innerHTML = '';
    const keys = ['1', '2', '3', '4', '5', 'C', '6', '7', '8', '9', '0'];
    for (const k of keys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = k === 'C' ? 'pad-key pad-clear' : 'pad-key';
      b.textContent = k === 'C' ? '⌫' : k;
      b.setAttribute('aria-label', k === 'C' ? 'clear' : k);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (k === 'C') this.clear();
        else this.push(k);
        b.classList.add('pressed');
        setTimeout(() => b.classList.remove('pressed'), 120);
      });
      container.appendChild(b);
    }
  }
}

/**
 * Forward pointer events on `canvas` to the engine. Only one pointer drives the
 * blade at a time (a resting second finger is ignored); mouse hover still moves
 * the monsters' eyes.
 */
export function bindPointer(canvas, engine) {
  let active = null;
  const pos = (e) => {
    const r = engine.rect || canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (active !== null) return;
    active = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    engine.pointerDown(x, y, e.timeStamp);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (active !== null && e.pointerId !== active) return;
    const evs = active !== null && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs.length ? evs : [e]) {
      const [x, y] = pos(ce);
      engine.pointerMove(x, y, ce.timeStamp);
    }
  });
  const end = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    const [x, y] = pos(e);
    // Losing capture without a pointerup (e.g. the element was hidden, a system
    // gesture took over) is treated like pointercancel: no wrong is judged.
    if (e.type === 'pointercancel' || e.type === 'lostpointercapture') engine.pointerCancel();
    else engine.pointerUp(x, y, e.timeStamp);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Fires after pointerup too, but `active` is already null then.
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
