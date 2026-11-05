// Runs one round on the engine (engine/API.md v2): passes the planned round
// config through, forwards every event to the UI and resolves with the
// engine's `round_end` summary.

export class RoundRunner {
  constructor(engine, { onEvent } = {}) {
    this.engine = engine;
    this.onEvent = onEvent || (() => {});
    this._unsub = null;
    this.active = false;
  }

  /** Start the round for `plan` (from planRound). Resolves with the summary. */
  run(plan) {
    this.active = true;
    return new Promise((resolve, reject) => {
      this._unsub = this.engine.on('*', (ev) => {
        if (ev.type === 'sfx') return;
        this.onEvent(ev);
        if (ev.type === 'round_end') this._finish(resolve, ev.summary);
      });
      try {
        this.engine.startRound(plan.config);
      } catch (err) {
        this._finish(() => {}, null);
        reject(err);
      }
    });
  }

  abort() {
    if (this.active) this.engine.stopRound();
  }

  _finish(resolve, summary) {
    if (!this.active) return;
    this.active = false;
    this._unsub?.();
    this._unsub = null;
    resolve(summary);
  }
}
