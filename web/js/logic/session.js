// Play-session clock for the gentle break nudge (SPEC). Counts round time only;
// a long pause (away from the game) starts a new session. Never blocks play.

export function createSession({ breakMinutes, now = Date.now(), idleResetMs = 10 * 60 * 1000 } = {}) {
  return { playedMs: 0, lastActive: now, nudgedAtMs: 0, breakMinutes: breakMinutes | 0, idleResetMs };
}

/** Add a finished round's play time. */
export function addPlay(s, ms, now = Date.now()) {
  if (now - s.lastActive > s.idleResetMs + Math.max(0, ms)) { s.playedMs = 0; s.nudgedAtMs = 0; }
  s.playedMs += Math.max(0, ms | 0);
  s.lastActive = now;
  return s;
}

/** True when the nudge should show now (once per `breakMinutes` of play; 0 = off). */
export function shouldNudge(s) {
  if (!s.breakMinutes) return false;
  const step = s.breakMinutes * 60000;
  return s.playedMs - s.nudgedAtMs >= step;
}

export function markNudged(s) { s.nudgedAtMs = s.playedMs; return s; }
