// Web Audio playback of web/assets/audio/manifest.json.
// - Unlocks on the first user gesture (iOS-safe: resume + silent buffer inside the gesture).
// - Buses: master → {music, sfx, voice}; volumes and mute from device settings.
// - Music per screen with a crossfade on change and on each loop (manual looping).
// - SFX pool (caps total and per-id voices), pitch by semitones.
// - Voice lines one at a time, praise rate-limited, music ducked while speaking.
// - The charge hum while a number is charged.
// Never throws to callers: audio problems only mean silence.

const MAX_SFX = 18;
const MAX_PER_ID = 4;
const MUSIC_XFADE = 0.9;
const LOOP_XFADE = 1.2;

export function createAudio({ base = 'assets/audio/', device = {} } = {}) {
  let ctx = null, master = null, buses = null;
  let manifest = {};
  const buffers = new Map();   // id → AudioBuffer
  const loading = new Map();   // id → Promise
  const live = [];             // {id, src, end}
  let settings = { master: 0.9, music: 0.6, sfx: 0.9, voice: 1, muted: false, ...device };
  let music = null;            // {id, gain, src, timer}
  let wantMusic = null;
  let hum = null;
  let lastPraise = -1e9;
  let voiceBusyUntil = 0;
  let unlocked = false;
  const manifestReady = fetch(base + 'manifest.json').then((r) => r.json()).then((m) => { manifest = m && typeof m === 'object' ? m : {}; })
    .catch((e) => { console.warn('[audio] manifest', e); });

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch { return null; }
    master = ctx.createGain();
    master.connect(ctx.destination);
    buses = { music: ctx.createGain(), sfx: ctx.createGain(), voice: ctx.createGain() };
    for (const b of Object.values(buses)) b.connect(master);
    applyVolumes();
    return ctx;
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
    buses.music.gain.setTargetAtTime(settings.music, t, 0.05);
    buses.sfx.gain.setTargetAtTime(settings.sfx, t, 0.02);
    buses.voice.gain.setTargetAtTime(settings.voice, t, 0.02);
  }

  /** Call from a user gesture handler (also auto-bound below). */
  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
      } catch { /* ignore */ }
      preload();
      if (wantMusic) playMusic(wantMusic);
    }
  }
  const onGesture = () => unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchend']) globalThis.addEventListener?.(ev, onGesture, { capture: true, passive: true });
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (unlocked) ctx.resume().catch(() => {});
  });

  function load(id) {
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = manifestReady.then(async () => {
      const e = manifest[id];
      if (!e || !ensureCtx()) return null;
      const res = await fetch(base + String(e.path).replace(/^assets\/audio\//, ''));
      if (!res.ok) throw new Error(`${id}: ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      buffers.set(id, buf);
      return buf;
    }).catch((e) => { console.warn('[audio] load', id, e?.message || e); return null; });
    loading.set(id, p);
    return p;
  }

  async function preload() {
    await manifestReady;
    const ids = Object.keys(manifest).filter((id) => manifest[id].kind === 'sfx');
    // Small files first; a few at a time so the first round is not starved.
    for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(load));
  }

  function prune() {
    const t = ctx.currentTime;
    for (let i = live.length - 1; i >= 0; i--) if (live[i].end <= t) live.splice(i, 1);
  }

  function startBuffer(id, buf, bus, { semitones = 0, volume = 1, when = 0, loop = false } = {}) {
    const e = manifest[id] || {};
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    if (semitones) src.playbackRate.value = Math.pow(2, semitones / 12);
    const g = ctx.createGain();
    g.gain.value = (e.volume ?? 1) * volume;
    src.connect(g); g.connect(bus);
    const t = Math.max(ctx.currentTime, when);
    src.start(t);
    return { src, gain: g, start: t, end: t + buf.duration / (src.playbackRate.value || 1) };
  }

  /** Play a sound effect by manifest id (engine onSfx names are manifest ids). */
  function play(id, opts = {}) {
    if (!id) return;
    if (id.startsWith('vo_')) { voice(id); return; }
    if (!ctx || ctx.state !== 'running') return;
    const buf = buffers.get(id);
    if (!buf) { load(id); return; }
    prune();
    if (live.filter((v) => v.id === id).length >= MAX_PER_ID) return;
    if (live.length >= MAX_SFX) {
      const old = live.shift();
      try { old.src.stop(); } catch { /* ended */ }
    }
    try {
      const v = startBuffer(id, buf, buses.sfx, opts);
      live.push({ id, src: v.src, end: v.end });
    } catch (e) { console.warn('[audio] play', id, e); }
  }

  /** Voice line. `praise` lines are rate-limited (20 %, ≥ 8 s apart); others always play. */
  async function voice(id, { praise = false, force = false } = {}) {
    if (!ctx || ctx.state !== 'running') { if (!buffers.has(id)) load(id); return; }
    const now = performance.now();
    if (praise && !force) {
      if (now - lastPraise < 8000 || Math.random() > 0.2) return;
    }
    if (ctx.currentTime < voiceBusyUntil - 0.05) return;
    const buf = buffers.get(id) || await load(id);
    if (!buf) return;
    if (praise) lastPraise = now;
    const v = startBuffer(id, buf, buses.voice, {});
    voiceBusyUntil = v.end;
    // Duck music under the voice.
    const g = buses.music.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(settings.music * 0.45, t, 0.05);
    g.setTargetAtTime(settings.music, v.end, 0.25);
  }

  function stopMusicNode(m, fade = MUSIC_XFADE) {
    if (!m) return;
    clearTimeout(m.timer);
    const t = ctx.currentTime;
    for (const n of m.nodes) {
      try {
        n.gain.gain.cancelScheduledValues(t);
        n.gain.gain.setValueAtTime(n.gain.gain.value, t);
        n.gain.gain.linearRampToValueAtTime(0, t + fade);
        n.src.stop(t + fade + 0.05);
      } catch { /* ignore */ }
    }
  }

  /** Switch background music (null = silence). Crossfades. */
  async function playMusic(id) {
    wantMusic = id;
    if (!ctx || !unlocked) return;
    if (music && music.id === id) return;
    const old = music;
    music = null;
    if (old) stopMusicNode(old);
    if (!id) return;
    const buf = await load(id);
    if (!buf || wantMusic !== id || (music && music.id === id)) return;
    const m = { id, nodes: [], timer: 0 };
    music = m;
    const vol = manifest[id]?.volume ?? 1;
    const startOne = (when, fadeIn) => {
      const v = startBuffer(id, buf, buses.music, { when });
      v.gain.gain.setValueAtTime(0, v.start);
      v.gain.gain.linearRampToValueAtTime(vol, v.start + fadeIn);
      m.nodes.push(v);
      if (m.nodes.length > 3) m.nodes.shift();
      if (manifest[id]?.loop !== false && buf.duration > LOOP_XFADE * 3) {
        const next = v.end - LOOP_XFADE;
        const fadeOutAt = v.end - LOOP_XFADE;
        v.gain.gain.setValueAtTime(vol, fadeOutAt);
        v.gain.gain.linearRampToValueAtTime(0, v.end);
        m.timer = setTimeout(() => { if (music === m) startOne(next, LOOP_XFADE); }, Math.max(0, (next - ctx.currentTime - 0.5) * 1000));
      }
    };
    startOne(ctx.currentTime + 0.02, old ? MUSIC_XFADE : 0.4);
  }

  /** Charge hum on/off (looped, quiet). */
  function setHum(on) {
    if (!ctx || ctx.state !== 'running') { if (on) load('sfx_charge_hum'); return; }
    if (on && !hum) {
      const buf = buffers.get('sfx_charge_hum');
      if (!buf) { load('sfx_charge_hum'); return; }
      hum = startBuffer('sfx_charge_hum', buf, buses.sfx, { loop: true, volume: 0.35 });
      hum.gain.gain.setValueAtTime(0, ctx.currentTime);
      hum.gain.gain.linearRampToValueAtTime((manifest.sfx_charge_hum?.volume ?? 1) * 0.35, ctx.currentTime + 0.15);
    } else if (!on && hum) {
      const h = hum; hum = null;
      const t = ctx.currentTime;
      h.gain.gain.cancelScheduledValues(t);
      h.gain.gain.setValueAtTime(h.gain.gain.value, t);
      h.gain.gain.linearRampToValueAtTime(0, t + 0.12);
      try { h.src.stop(t + 0.15); } catch { /* ignore */ }
    }
  }

  function setSettings(s) {
    settings = { ...settings, ...s };
    applyVolumes();
  }

  return {
    unlock, play, voice, music: playMusic, setHum, setSettings, load,
    get settings() { return { ...settings }; },
    get running() { return !!ctx && ctx.state === 'running'; },
    ids: () => Object.keys(manifest),
    ready: manifestReady,
  };
}
