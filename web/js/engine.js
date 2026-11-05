// Thin wrapper around the Rust/wasm engine.
//
// Owns the requestAnimationFrame loop, canvas sizing (CSS size x devicePixelRatio),
// and the event queue: after every frame and every pointer call it drains the
// engine's events and dispatches them to listeners. Sound effects arrive as
// `sfx` events (manifest ids) and are forwarded to `onSfx(name, {semitones})`.
// Config warnings arrive as `warning` events and are also logged.
// See engine/API.md.

import init, { Game, Portrait } from '../pkg/mathmissile_engine.js';

const MAX_DPR = 2;

export class Engine {
  /** @returns {Promise<Engine>} */
  static async create(canvas, opts = {}) {
    await init();
    return new Engine(canvas, opts);
  }

  constructor(canvas, { onSfx, font } = {}) {
    this.canvas = canvas;
    this.game = new Game(canvas, font);
    this.onSfx = onSfx || (() => {});
    this._listeners = new Map();
    this._raf = 0;
    this._last = 0;
    this._fpsFrames = 0;
    this._fpsSince = 0;
    this.fps = 0;
    this._autoPaused = false;

    this._tick = this._tick.bind(this);
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    window.addEventListener('resize', this.resize);
    this._watchDpr();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.game.set_paused(true);
        this._emitLocal({ type: 'hidden' }); // the shell opens its pause screen
      } else if (!this._userPaused) this.game.set_paused(false);
      this._last = 0;
    });
    // WebGL context loss (GPU reset, too many contexts, driver hiccup): hold the
    // sim, tell the shell, and rebuild everything when the browser restores it.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // without this the context is never restored
      this.game.context_lost();
      this._last = 0;
      this._emitLocal({ type: 'context_lost' });
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        this.game.context_restored();
        this._last = 0;
        this.resize();
        this._emitLocal({ type: 'context_restored' });
      } catch (err) {
        console.error('[engine] WebGL restore failed', err);
        this._emitLocal({ type: 'context_restore_failed', message: String(err) });
      }
    });
    this.resize();
  }

  /** True while the WebGL context is lost (the sim is held). */
  get contextLost() { return this.game.is_context_lost(); }

  // ---- events ---------------------------------------------------------------

  /** Subscribe to an engine event type ('correct', 'wrong', ...; '*' = all). Returns unsubscribe. */
  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this._listeners.get(type).delete(fn);
  }

  _emit(type, ev) {
    const set = this._listeners.get(type);
    if (set) for (const fn of set) fn(ev);
  }

  /** Dispatch an event that comes from engine.js rather than the wasm queue. */
  _emitLocal(ev) {
    this._emit(ev.type, ev);
    this._emit('*', ev);
  }

  /** Drain and dispatch pending engine events. */
  pump() {
    const s = this.game.drain_events();
    if (!s) return;
    for (const ev of JSON.parse(s)) {
      if (ev.type === 'sfx') this.onSfx(ev.name, { semitones: ev.semitones || 0 });
      else if (ev.type === 'warning') console.warn('[engine]', ev.message);
      this._emit(ev.type, ev);
      this._emit('*', ev);
    }
  }

  // ---- round control -----------------------------------------------------------

  startRound(config) {
    this.game.start_round(JSON.stringify(config));
    this.pump();
  }

  stopRound() {
    this.game.stop_round();
    this.pump();
  }

  /** Live speed inputs ({base, level, offset, recent}); {x} fixes the speed index (debug). */
  setSpeed(params) {
    this.game.set_speed_params(JSON.stringify(params));
  }

  /** Calm effects: less shake, no full-screen flashes, fewer particles. */
  setCalm(on) {
    this.game.set_calm(!!on);
  }

  /** Equip cosmetics: {blade?: id, trail?: id}. Unknown ids are ignored with a warning. */
  setCosmetics(c) {
    this.game.set_cosmetics(JSON.stringify(c || {}));
  }

  /** Where coins ('sparks') and lanterns ('island') fly to, in CSS px relative to the canvas. */
  setAnchor(name, x, y) {
    this.game.set_anchor(name, x, y);
  }

  speciesIds() { return JSON.parse(this.game.species_ids()); }
  bladeIds() { return JSON.parse(this.game.blade_ids()); }
  trailIds() { return JSON.parse(this.game.trail_ids()); }

  /**
   * Monster Book art: a PNG data URL of one species, drawn by the game's shader.
   * opts: {size = 256, shiny, silhouette, mood: 'normal'|'happy'|'sleepy'|'wave'|...}.
   */
  portrait(species, opts = {}) {
    const json = JSON.stringify({ size: 256, ...opts, species });
    for (let attempt = 0; ; attempt++) {
      if (!this._portrait) this._portrait = new Portrait(document.createElement('canvas'));
      try {
        return this._portrait.draw(json);
      } catch (err) {
        // Context lost on the offscreen canvas: start over on a fresh one, once.
        if (attempt > 0 || !String(err).includes('context lost')) throw err;
        this._portrait.free?.();
        this._portrait = null;
      }
    }
  }

  /** Charged number, or null for none. */
  setCharged(n) {
    this.game.set_charged(n == null ? undefined : n);
  }

  setPaused(paused) {
    this._userPaused = paused;
    this.game.set_paused(paused);
  }

  setEffectsScale(s) {
    this.game.set_effects_scale(s);
  }

  get state() { return this.game.round_state(); }
  get score() { return this.game.score(); }
  get combo() { return this.game.combo(); }
  get roundTime() { return this.game.round_time(); }
  stats() { return JSON.parse(this.game.stats()); }
  get speedX() { return this.game.speed_x(); }
  /** Monsters on screen (CSS px): [{id, x, y, r, answerable, state, species, shiny, golden, mini, minion, special, fact}]. */
  monsters() { return JSON.parse(this.game.monsters()); }

  // ---- pointer (CSS px relative to the canvas) -------------------------------------

  pointerDown(x, y, t) { this.game.pointer_down(x, y, t); this.pump(); }
  pointerMove(x, y, t) { this.game.pointer_move(x, y, t); this.pump(); }
  pointerUp(x, y, t) { this.game.pointer_up(x, y, t); this.pump(); }
  pointerCancel() { this.game.pointer_cancel(); this.pump(); }

  // ---- loop & sizing -----------------------------------------------------------

  start() {
    if (!this._raf) this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._last = 0;
  }

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    const dt = this._last ? Math.min(now - this._last, 100) : 16.7;
    this._last = now;
    this.game.frame(dt);
    this.pump();
    this._fpsFrames++;
    if (now - this._fpsSince >= 1000) {
      this.fps = (this._fpsFrames * 1000) / (now - this._fpsSince);
      this._fpsFrames = 0;
      this._fpsSince = now;
    }
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.rect = r;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.game.resize(Math.max(1, r.width), Math.max(1, r.height), dpr);
  }

  _watchDpr() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { this.resize(); this._watchDpr(); }, { once: true });
  }
}
