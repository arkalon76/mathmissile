#!/usr/bin/env node
// Generates Math Missile audio via ElevenLabs from tools/audio_manifest.json.
// Re-runnable: skips existing files. Usage: node tools/gen_audio.mjs [--only=id,id] [--kind=sfx|music|voice] [--dry]
// API key: env ELEVENLABS_API_KEY, else read from the login shell (zsh -ic). Never logged or stored.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/assets/audio');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/audio_manifest.json'), 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? new Set(args.only.split(',')) : null;

function getKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  try {
    return execFileSync('zsh', ['-ic', 'printf %s "$ELEVENLABS_API_KEY"'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
const KEY = args.dry ? '' : getKey();
if (!args.dry && !KEY) { console.error('no API key available'); process.exit(1); }
// Only plain key characters: rules out stray shell output and header injection.
if (!args.dry && !/^[A-Za-z0-9_-]+$/.test(KEY)) { console.error('key malformed'); process.exit(1); }

/** Remove any occurrence of the key from text that is about to be logged. */
const scrub = (text) => (KEY ? String(text).split(KEY).join('***') : String(text));
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { console.error('fatal:', scrub(e?.stack ?? e?.message ?? e)); process.exit(1); });
}

const BASE = 'https://api.elevenlabs.io';
const fmt = manifest.outputFormat;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

class Fatal extends Error {}

async function call(url, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(30000, 2000 * 2 ** attempt) + Math.random() * 500;
      await sleep(wait);
      continue;
    }
    let msg = '';
    try { const j = await res.json(); msg = j?.detail?.status || j?.detail?.code || (typeof j?.detail === 'string' ? j.detail : ''); } catch {}
    const err = new Error(`HTTP ${res.status} ${String(msg).slice(0, 80)}`);
    if ([401, 402, 403].includes(res.status) || /quota|credit/i.test(String(msg))) throw new Fatal(err.message);
    throw err;
  }
  throw new Error('retries exhausted');
}

function trim(file, seconds) {
  if (!hasFfmpeg) return;
  const tmp = file + '.tmp.mp3';
  const fade = Math.min(0.03, seconds / 4);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-t', String(seconds), '-af', `afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}`, '-codec:a', 'libmp3lame', '-b:a', '128k', tmp]);
  fs.renameSync(tmp, file);
}

async function gen(a) {
  if (a.kind === 'sfx') {
    const s = manifest.sfx;
    const req = Math.max(a.duration, s.minApiSeconds);
    const buf = await call(`${BASE}/v1/sound-generation?output_format=${fmt}`, { text: a.prompt, duration_seconds: req, prompt_influence: s.prompt_influence, loop: !!a.loop, model_id: s.model_id });
    return { buf, trimTo: a.duration < req ? a.duration : null };
  }
  if (a.kind === 'music') {
    const m = manifest.music;
    const buf = await call(`${BASE}/v1/music?output_format=${fmt}`, { prompt: a.prompt, music_length_ms: Math.round(a.duration * 1000), model_id: m.model_id, force_instrumental: m.force_instrumental });
    return { buf };
  }
  const v = manifest.voice;
  const buf = await call(`${BASE}/v1/text-to-speech/${v.voice_id}?output_format=${fmt}`, { text: a.text, model_id: v.model_id, voice_settings: v.settings });
  return { buf };
}

const counts = { ok: 0, skip: 0, fail: 0 };
const failed = [];
for (const a of manifest.assets) {
  if (only && !only.has(a.id)) continue;
  if (args.kind && args.kind !== a.kind) continue;
  const file = path.join(outDir, a.kind, a.id + '.mp3');
  if (fs.existsSync(file) && fs.statSync(file).size > 0) { counts.skip++; console.log(a.id, 'skip'); continue; }
  if (args.dry) { console.log(a.id, 'would generate'); continue; }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { buf, trimTo } = await gen(a);
    fs.writeFileSync(file, buf);
    if (trimTo) trim(file, trimTo);
    counts.ok++; console.log(a.id, 'ok');
  } catch (e) {
    counts.fail++; failed.push(a.id); console.log(a.id, 'FAIL', scrub(e?.message ?? e));
    if (e instanceof Fatal) { console.log('stopping: account refused request (credits/permission)'); break; }
  }
}

// Write the game-facing manifest from files present.
function dur(file) {
  try {
    const o = execFileSync('afinfo', [file], { encoding: 'utf8' });
    return Number(/estimated duration: ([\d.]+)/.exec(o)?.[1]);
  } catch { return null; }
}
if (!args.dry) {
  const out = {};
  for (const a of manifest.assets) {
    const rel = `assets/audio/${a.kind}/${a.id}.mp3`;
    const file = path.join(root, 'web', rel);
    if (!fs.existsSync(file)) continue;
    const d = dur(file);
    out[a.id] = { path: rel, kind: a.kind, duration: d ? +d.toFixed(2) : null, loop: !!a.loop, volume: a.volume, ...(a.text ? { text: a.text } : {}) };
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(out, null, 1));
}
console.log(JSON.stringify(counts), failed.length ? 'failed: ' + failed.join(',') : '');
