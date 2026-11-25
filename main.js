// Voice & Sound Unit: DOM wiring. Connects to LUNA, keeps the API key in luna.secrets, runs
// ElevenLabs requests as background jobs, keeps results and the session's history, and hands
// WAV bytes to AddOnLogic to place on the timeline. No engine logic lives here.

const STORE_ID = 'com.vbilous.elevenlabs';
const ADD_ON_ID = STORE_ID; // LUNA serves media files and keeps secrets per Add On id
const $ = (id) => document.getElementById(id);
const L = AddOnLogic;

let luna;
let session;
let history; // L.history(session) for the open session
let client; // ElevenLabs.Client once a key is known
let subscription = null;
let voices = [];
let models = [];
let sessionReleases = [];
const releaseAll = (list) => { for (const u of list) u(); list.length = 0; };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const errorText = (e) => (e && e.message) || String(e);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- status line, with an optional next step ----------

let statusSeq = 0; // counts status messages, so a button can tell what its own click reported
let lastStatusKind = '';
function say(text, kind = '', action) {
  statusSeq++;
  lastStatusKind = kind;
  const el = $('status');
  el.className = kind;
  el.textContent = text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = action.label;
    b.title = action.title ?? action.label;
    b.onclick = action.run;
    el.append(' ', b);
  }
}

const PRICING_URL = 'https://elevenlabs.io/pricing';
function sayError(e, prefix = '') {
  if (e && e.name === 'AbortError') { say('Cancelled.'); return; }
  const text = prefix + errorText(e);
  if (e && e.kind === 'key') say(text, 'error', { label: 'Check the API key', title: 'Open the API Key tab to check or replace your key.', run: () => showTab('key') });
  else if (e && e.kind === 'credits') say(text, 'error', { label: 'See plans', title: 'Open the ElevenLabs plans page in your web browser.', run: () => openUrl(PRICING_URL) });
  else if (e && e.kind === 'network') say(`${text} If this keeps happening with a working connection, see Help → Troubleshooting.`, 'error');
  else say(text, 'error');
}

async function openUrl(url) {
  try {
    if (luna && (await luna.gui.available())) { await luna.gui.openUrl(url); return; }
  } catch { /* fall back to window.open */ }
  if (!window.open(url, '_blank', 'noopener')) say(`Open ${url} in your web browser.`);
}

// ---------- what LUNA's page policy blocks ----------

// In current LUNA versions the page may reach only LUNA and the servers allowed for this Add On
// (manifest "network", Settings > Add Ons > SERVERS). Say what was blocked instead of a bare
// "Load failed", and keep the list for Help → Troubleshooting.
const blockedByLuna = [];
document.addEventListener('securitypolicyviolation', (e) => {
  const what = `${e.blockedURI || 'inline'} (${e.effectiveDirective || e.violatedDirective})`;
  if (blockedByLuna.includes(what)) return;
  blockedByLuna.push(what);
  console.warn('LUNA blocked', what, e.originalPolicy);
  say(`LUNA blocked ${what}. Allow ElevenLabs' servers in LUNA's Settings → Add Ons → SERVERS, then reopen this window.`, 'error');
});
window.addEventListener('error', (e) => { if (e.message) say(`Add On error: ${e.message}`, 'error'); });

// ---------- tabs ----------

const TABS = ['tts', 'sfx', 'music', 'vc', 'ivc', 'lyrics', 'key'];
let activeTab = 'tts';
function showTab(name) {
  if (typeof closePop === 'function') closePop();
  activeTab = name;
  document.body.dataset.tab = name; // Clone, Lyrics and API Key show no destination or results (skins/studio.css)
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('active', b.dataset.tab === name);
    if (b.dataset.tab === name) b.classList.remove('has-new'); // seen
  }
  for (const s of document.querySelectorAll('main section')) s.classList.toggle('active', s.id === `tab-${name}`);
  remember();
  if (typeof groups !== 'undefined') renderResults(); // each tab lists its own results
  placeScreenParts();
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => showTab(b.dataset.tab);

// ---------- remembered settings (per viewer, this Add On only) ----------

const PREFS_KEY = `${STORE_ID}.prefs`;
function readPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } }
let prefs = readPrefs();

// ---------- skins: Vintage (default, Cream finish) and Studio; same page and ids, another stylesheet ----------

const SKINS = ['studio', 'vintage'];
const FINISHES = ['cream', 'black'];
/** Show a skin and Vintage's finish; unknown or unset values fall back to Vintage / Cream. */
function applySkin(skin, finish) {
  const s = SKINS.includes(skin) ? skin : 'vintage';
  const f = FINISHES.includes(finish) ? finish : 'cream';
  document.documentElement.dataset.skin = s;
  document.documentElement.dataset.finish = f;
  placeScreenParts();
  return { skin: s, finish: f };
}

/** Vintage draws its own panel (unit.js); keep it in step with the tab and the look. */
function placeScreenParts() { window.unitRender?.(); }
applySkin(prefs.skin, prefs.finish);
function fieldValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }
function setField(el, v) {
  if (v === undefined || v === null) return;
  if (el.type === 'checkbox') el.checked = !!v;
  else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function remember() {
  const fields = {};
  for (const el of document.querySelectorAll('[data-remember]')) {
    // A voice or model list that has not loaded yet keeps the value remembered before.
    fields[el.id] = el.tagName === 'SELECT' && !el.options.length ? prefs.fields?.[el.id] : fieldValue(el);
  }
  prefs = { ...prefs, fields, tab: activeTab, dest: destMode(), at: placeAt(), auto: $('auto-place').checked, placeAs: prefs.placeAs };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable: nothing to keep */ }
}
function restorePrefs() {
  for (const [id, v] of Object.entries(prefs.fields ?? {})) { const el = $(id); if (el && el.tagName !== 'SELECT') setField(el, v); }
  if (prefs.dest) { const r = document.querySelector(`input[name=dest][value=${prefs.dest}]`); if (r) r.checked = true; }
  if (prefs.at) { const r = document.querySelector(`input[name=at][value=${prefs.at}]`); if (r) r.checked = true; }
  if (typeof prefs.auto === 'boolean') $('auto-place').checked = prefs.auto;
}
/** Selects are filled later (voices, models); put their remembered values back then. */
function restoreSelect(sel) { const v = prefs.fields?.[sel.id]; if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; }
document.addEventListener('change', (e) => { if (e.target.matches?.('[data-remember], input[name=dest], input[name=at], #auto-place')) remember(); });

// ---------- destination ----------

const destMode = () => document.querySelector('input[name=dest]:checked').value;
/** Where a new result starts: 'playhead', 'selection' (its start) or 'marker' (the next one). */
const placeAt = () => document.querySelector('input[name=at]:checked')?.value ?? 'playhead';
function renderDestination() {
  const auto = $('auto-place').checked;
  let text = L.destinationText(session, destMode(), placeAt());
  if (session && placeAt() === 'marker') session.markers.load().catch(() => {}); // startTick() reads them
  if (session && !auto) text += ' · results wait in the list';
  $('dest-text').textContent = text;
  const short = `${text.replace(/ · results wait in the list$/, '').replace(/\.$/, '')}${session ? (auto ? ' · auto' : ' · waits in the list') : ''}`;
  $('dest-short').textContent = short;
  $('dest-chip').title = `Where results land: ${text.replace(/\.$/, '')}. Click to choose the track and automatic placing.`;
}
for (const r of document.querySelectorAll('input[name=dest], input[name=at]')) r.addEventListener('change', renderDestination);
$('auto-place').addEventListener('change', renderDestination);

// ---------- sliders, counters, credits ----------

for (const id of ['tts-stability', 'tts-similarity', 'tts-style', 'tts-speed', 'sfx-influence', 'vc-stability', 'vc-similarity', 'vc-style']) {
  const input = $(id);
  const paint = () => ($(`${id}-v`).textContent = Number(input.value).toFixed(2));
  input.addEventListener('input', paint);
  paint();
}

function ttsLines() {
  if (!$('tts-script').checked) return [{ text: $('tts-text').value, speaker: null, voiceId: null }];
  // Lyrics keep every line as text: a "Name:" in a lyric is not a speaker.
  return L.parseScript($('tts-text').value, $('tts-layout').value === 'lyrics' ? [] : voices);
}
function renderTtsCount() {
  const lines = ttsLines().filter((l) => l.text.trim());
  const chars = lines.reduce((n, l) => n + l.text.length, 0) * Number($('tts-variations').value || 1);
  const model = models.find((m) => m.model_id === $('tts-model').value);
  const est = L.creditEstimate(chars, model, subscription);
  const longest = Math.max(0, ...lines.map((l) => l.text.length));
  const fmt = (n) => n.toLocaleString('en-US');
  let text = `${fmt($('tts-text').value.length)} characters`;
  if ($('tts-script').checked) text += ` · ${lines.length} line${lines.length === 1 ? '' : 's'}`;
  if (chars) text += ` · ≈ ${fmt(est.credits)} credits`;
  if (est.remaining !== null) text += ` · ${fmt(est.remaining)} left`;
  const tooLong = est.maxChars && longest > est.maxChars;
  if (tooLong) text += ` · too long for this model (max ${fmt(est.maxChars)} per request)`;
  else if (est.overQuota) text += ' · more than your plan has left';
  $('tts-count').textContent = text;
  $('tts-count').classList.toggle('warn', !!(tooLong || est.overQuota));
  return { tooLong };
}
for (const id of ['tts-text', 'tts-model', 'tts-variations', 'tts-script']) $(id).addEventListener('input', renderTtsCount);
$('tts-script').addEventListener('change', () => {
  $('tts-script-box').classList.toggle('script-on', $('tts-script').checked);
  $('tts-variations').disabled = $('tts-script').checked;
  renderTtsCount();
});

// ---------- audio decoding and preview ----------

/** MP3 (or any browser-decodable audio) to { wav, seconds, channels }. */
async function decodeToWav(bytes) {
  let audio;
  try {
    // An OfflineAudioContext at 44.1 kHz decodes without resampling ElevenLabs' 44.1 kHz MP3.
    audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice(0));
  } catch {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try { audio = await ctx.decodeAudioData(bytes.slice(0)); } finally { ctx.close?.(); }
  }
  // 300 ms of silence after the audio: clips end where the audio ends (`seconds`), so LUNA's
  // stretch and playback can read a little past a clip's end without running off the file
  // (a clip ending exactly at the end of its file asserted in GetSourceDataPostPad).
  const pad = Math.round(audio.sampleRate * 0.3);
  const channels = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const padded = new Float32Array(audio.length + pad);
    padded.set(audio.getChannelData(c));
    channels.push(padded);
  }
  return { wav: L.encodeWav(channels, audio.sampleRate), seconds: audio.duration, channels: audio.numberOfChannels, peaks: peaksOf(audio.getChannelData(0), 64) };
}

/** `n` bars of a waveform overview, 0–1, scaled to the loudest bar. */
function peaksOf(samples, n) {
  const out = new Array(n).fill(0);
  const step = Math.max(1, Math.floor(samples.length / n));
  for (let i = 0; i < n; i++) {
    let max = 0;
    for (let j = i * step, end = Math.min(samples.length, (i + 1) * step); j < end; j += 4) { const v = Math.abs(samples[j]); if (v > max) max = v; }
    out[i] = max;
  }
  const top = Math.max(...out) || 1;
  return out.map((v) => v / top);
}
/** A small SVG waveform for a result row. */
function waveSvg(peaks) {
  if (!peaks?.length) return '';
  const bars = peaks.map((p, i) => { const h = Math.max(1.5, p * 20); return `<rect x="${i * 3}" y="${((22 - h) / 2).toFixed(1)}" width="2" height="${h.toFixed(1)}" rx="1"/>`; }).join('');
  return `<svg class="wave" viewBox="0 0 ${peaks.length * 3} 22" preserveAspectRatio="none" aria-hidden="true"><g fill="currentColor">${bars}</g></svg>`;
}

const player = new Audio();
let playingKey = null;
function paintPlayButtons() {
  for (const b of document.querySelectorAll('[data-play]')) {
    const on = b.dataset.play === playingKey;
    b.classList.toggle('on', on);
    b.textContent = on ? '■' : '▶';
  }
}
player.onended = player.onpause = () => { playingKey = null; paintPlayButtons(); };
/** Play `url` (a string or an async getter) under `key`, or stop it if it is playing. */
async function togglePlay(key, url) {
  if (playingKey === key) { player.pause(); return; }
  try {
    player.src = typeof url === 'function' ? await url() : url;
    playingKey = key;
    paintPlayButtons();
    await player.play();
  } catch (e) {
    playingKey = null;
    paintPlayButtons();
    say(`Could not play it: ${errorText(e)}`, 'error');
  }
}
const blobUrls = new Map(); // sourceUid or result id -> blob URL of the WAV, kept for this window's life

/** A playable URL for a history entry: its WAV from this window, else LUNA serves the source. */
async function entryUrl(entry) {
  const mem = blobUrls.get(entry.sourceUid) ?? blobUrls.get(entry.id);
  if (mem) return mem;
  if (!entry.sourceUid || !session || !(await luna.gui.available())) throw new Error('the audio is only in the session; open it inside LUNA');
  return luna.gui.serveMediaFile(ADD_ON_ID, L.sourcePath(session, entry.sourceUid));
}

// ---------- jobs: background generation ----------

const MAX_PARALLEL = 2;
const jobs = [];
let jobTimer = null;

function renderJobs() {
  const box = $('jobs');
  box.innerHTML = '';
  for (const j of jobs) {
    const row = document.createElement('div');
    row.className = `job ${j.state}`;
    const secs = j.startedAt ? Math.floor((Date.now() - j.startedAt) / 1000) : 0;
    const time = j.state === 'queued' ? 'waiting' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    row.innerHTML = '<span class="spin"></span><span class="label"></span><span class="time"></span><button class="ghost">Cancel</button>';
    row.querySelector('.label').textContent = `${j.label}${j.progress ? ` · ${j.progress}` : ''}`;
    row.querySelector('.time').textContent = time;
    row.querySelector('button').onclick = () => cancelJob(j);
    box.appendChild(row);
  }
  if (jobs.length && !jobTimer) jobTimer = setInterval(renderJobs, 1000);
  if (!jobs.length && jobTimer) { clearInterval(jobTimer); jobTimer = null; }
}

function cancelJob(j) {
  j.controller.abort();
  if (j.state === 'queued') { jobs.splice(jobs.indexOf(j), 1); renderJobs(); }
}
function cancelNewest() {
  const j = [...jobs].reverse().find((x) => x.state === 'running') ?? jobs[jobs.length - 1];
  if (j) { cancelJob(j); say(`Cancelled "${j.label}".`); return true; }
  return false;
}

/** Queue work that runs in the background. `run(signal, job)` does the requests. */
function enqueue(label, run) {
  if (!client) { showTab('key'); say('Add your ElevenLabs API key first.', 'error'); return; }
  const job = { id: uid(), label, state: 'queued', controller: new AbortController(), run, progress: '' };
  jobs.push(job);
  renderJobs();
  pump();
}
function pump() {
  while (jobs.filter((j) => j.state === 'running').length < MAX_PARALLEL) {
    const next = jobs.find((j) => j.state === 'queued');
    if (!next) break;
    next.state = 'running';
    next.startedAt = Date.now();
    renderJobs();
    next.run(next.controller.signal, next)
      .catch((e) => sayError(e, `${next.label}: `))
      .finally(() => {
        jobs.splice(jobs.indexOf(next), 1);
        renderJobs();
        refreshQuota();
        pump();
      });
  }
}

// ---------- results and placing ----------

const groups = []; // what the results list shows, newest first

/** The tab a result belongs to: scripts and lyrics are Text to Speech. */
const groupTab = (g) => g.tab ?? 'tts';
/** This tab's results, newest first. History has every tab's. */
const tabGroups = () => groups.filter((g) => groupTab(g) === activeTab);

function renderResults() {
  const box = $('results');
  box.innerHTML = '';
  const mine = tabGroups();
  for (const g of mine) box.appendChild(groupEl(g));
  const n = mine.reduce((sum, g) => sum + g.items.length, 0);
  const others = groups.length - mine.length;
  $('results-count').textContent = n ? `${n} result${n === 1 ? '' : 's'}${others ? ' · other tabs keep theirs · all in History' : ''}` : '';
  if (!mine.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Results from this tab appear here, newest first. History has every tab\'s results.';
    box.appendChild(empty);
  }
  $('results-clear').disabled = !mine.length;
  paintPlayButtons();
}

/** A result arrived on a tab you are not looking at: mark that tab until you open it. */
function markTabNew(tab) {
  if (tab === activeTab) return;
  document.querySelector(`#tabs button[data-tab="${tab}"]`)?.classList.add('has-new');
}

/** One result group: a single result, variations, a script, lyrics, or several changed clips. */
function groupEl(g) {
  const el = document.createElement('div');
  el.className = 'group';
  const head = document.createElement('div');
  head.className = 'title';
  const kindLabel = { variations: `${g.items.length} variations`, script: `script · ${g.items.length} lines`, clips: `${g.items.length} clips`, lyrics: `${g.items.length} lyric lines` }[g.layout] ?? '';
  head.innerHTML = `<b></b><span class="hint"></span><span class="placed"></span>`;
  head.querySelector('b').textContent = g.title;
  head.querySelector('.hint').textContent = kindLabel;
  head.querySelector('.placed').textContent = g.placedText ?? '';
  el.appendChild(head);

  for (const item of g.items) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<button class="play" title="Play">▶</button><span class="name"></span>${waveSvg(item.peaks)}<span class="placed"></span>`;
    row.querySelector('.play').dataset.play = item.id;
    row.querySelector('.play').onclick = () => togglePlay(item.id, item.url);
    row.querySelector('.name').textContent = `${g.layout === 'single' ? '' : `${item.label} · `}${item.seconds.toFixed(1)} s`;
    row.querySelector('.placed').textContent = item.placedText ?? '';
    if (g.layout === 'single' || g.layout === 'variations') {
      const canTarget = g.target && session && g.sessionUid === session.uid;
      const atOrigin = btn(`Place at ${g.target?.where || 'original spot'}`, () => placeOne(g, item, 'target'), undefined, { busy: 'Placing…', ok: '✓ Placed' });
      atOrigin.title = `Where you were when you clicked Generate: ${L.targetText(g.target)}`;
      const atHead = btn('Place at playhead', () => placeOne(g, item, 'playhead'), 'Put this result at the playhead now, on the track chosen at the bottom of the window (selected or new).', { busy: 'Placing…', ok: '✓ Placed' });
      for (const b of [atHead, atOrigin]) b.disabled = !session || g.sessionUid !== session.uid || !item.sourceUid;
      if (g.origin) row.append(atOrigin, atHead); // from a clip: back to its place first
      else row.append(atHead, ...(canTarget ? [atOrigin] : []));
      if (item.genWords?.length) row.append(btn('LRC', () => lrcFromItem(item), 'Open this speech with its word timing on the Lyrics & LRC tab, to copy as LRC or add to LUNA\'s lyrics.', { ok: '✓ Opened' }));
    }
    el.appendChild(row);
  }

  if (g.layout !== 'single') {
    const bar = document.createElement('div');
    bar.className = 'group-actions';
    const disabled = !session || g.sessionUid !== session.uid || g.items.some((i) => !i.sourceUid);
    if (g.layout === 'variations') {
      bar.innerHTML = 'Place all as <select class="as"><option value="playlists">Playlists</option><option value="tracks">Tracks</option></select> at <select class="at"></select>';
      bar.querySelector('.as').value = prefs.placeAs ?? 'playlists';
      bar.querySelector('.as').onchange = (e) => { prefs.placeAs = e.target.value; remember(); };
    } else if (g.layout === 'script') {
      bar.innerHTML = 'Place all lines at <select class="at"></select>';
    } else if (g.layout === 'clips') {
      // Each result goes where its clip is; the choice is which track.
      bar.innerHTML = 'Place all on <select class="on"></select>';
      const on = bar.querySelector('.on');
      const opts = [];
      if (g.target?.trackId) opts.push(['target', `"${g.target.trackName}" (selected when you started)`]);
      else opts.push(['target', 'a new track (as chosen when you started)']);
      if (g.sourceTrackId && g.sourceTrackId !== g.target?.trackId) opts.push(['source', `"${g.sourceTrackName}" (where the clips are)`]);
      if (g.target?.trackId) opts.push(['new', 'a new track']);
      for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; on.append(o); }
    } else if (g.layout === 'lyrics') {
      bar.innerHTML = 'At the original timing: <select class="fit"><option value="start">start of each line</option><option value="fit">each line fitted to its length</option><option value="words">each word at its time</option></select>';
      bar.querySelector('.fit').value = g.fitMode ?? 'fit';
    }
    const at = bar.querySelector('.at');
    if (at) {
      at.innerHTML = `<option value="target"></option><option value="playhead">the playhead</option>`;
      at.options[0].textContent = g.target?.where ? `${g.target.where} (where you started)` : 'where you started';
    }
    const goTitle = {
      variations: 'Place every variation at once, as playlists of one track or as tracks of their own (choose on the left), at the spot chosen on the left.',
      script: 'Place every line of the script, from the spot chosen on the left, laid out as you chose when generating.',
      lyrics: 'Place the re-voiced lines on a new track at the original lyric timing, with the timing chosen on the left. You can place them again with another timing.',
      clips: 'Place every changed clip on the track chosen on the left, each where its original clip is. On the clips\' own track the results go on top of the originals and play instead of them (Undo removes them).',
    }[g.layout];
    const go = btn(g.layout === 'lyrics' ? 'Place on a new track' : 'Place all', () => placeGroup(g, bar), goTitle, { busy: 'Placing…', ok: '✓ Placed' });
    go.disabled = disabled;
    bar.append(go);
    if (g.layout === 'lyrics' || (g.layout === 'script' && g.placedLines)) bar.append(btn('LRC', () => lrcFromGroup(g), 'Open these lines with their timing on the Lyrics & LRC tab, to copy as LRC.', { ok: '✓ Opened' }));
    el.appendChild(bar);
  }
  return el;
}

function btn(text, onclick, title, feedback) {
  const b = document.createElement('button');
  b.className = 'ghost';
  b.textContent = text;
  b.onclick = onclick;
  if (title) b.title = title;
  if (feedback) withFeedback(b, feedback);
  return b;
}

function targetFor(g, where) {
  return where === 'target' && g.target ? g.target : L.captureTarget(session, destMode());
}

async function placeOne(g, item, where) {
  try {
    const target = targetFor(g, where);
    const { track, startTick } = await L.placeSource(session, item, target);
    item.placedTick = startTick;
    item.placedText = `✓ on "${track.name.value ?? track.id}" at ${L.barText(session, startTick)}`;
    say(`Placed "${item.name}" ${item.placedText.slice(2)}. Undo removes it.`, 'ok');
    renderResults();
    history?.update(item.id, { placed: item.placedText.slice(2) }).catch(() => {});
  } catch (e) { sayError(e, 'Could not place it: '); }
}

async function placeGroup(g, bar) {
  const at = bar.querySelector('.at')?.value ?? 'target';
  const target = targetFor(g, at);
  try {
    if (g.layout === 'variations') {
      const as = bar.querySelector('.as').value;
      const placed = await L.placeVariations(session, g.items, target, as);
      g.placedText = as === 'tracks' ? `✓ on ${placed.length} new tracks` : `✓ as ${placed.length} playlists of "${placed[0].track.name.value}"`;
    } else if (g.layout === 'script') {
      const placed = await L.placeScript(session, g.items, target, g.scriptOpts);
      g.placedText = `✓ ${placed.length} lines from ${L.barText(session, placed[0].startTick)}`;
      g.placedLines = placed.map((p, i) => {
        const item = g.items[i];
        const tl = session.musical.timeline;
        const atTick = (sec) => Math.round(tl.tickAtSeconds(tl.seconds(p.startTick) + sec));
        return { text: item.text ?? item.name, startTick: p.startTick, stopTick: atTick(item.seconds), words: (item.genWords ?? []).map((w) => ({ text: w.text, startTick: atTick(w.start), stopTick: atTick(w.end) })) };
      });
    } else if (g.layout === 'lyrics') {
      const mode = bar.querySelector('.fit')?.value ?? g.fitMode ?? 'fit';
      const res = await AddOnLyrics.place(session, g.items, { mode, trackName: g.trackName });
      g.fitMode = mode;
      g.placedText = `✓ on "${res.track.name.value}" (${res.clips} clips)`;
      const notes = [];
      if (res.limited) notes.push(`${res.limited} line${res.limited === 1 ? ' needed' : 's needed'} more stretch than a voice takes, so ${res.limited === 1 ? 'it keeps' : 'they keep'} closer to the natural length`);
      if (res.fallbacks) notes.push(`${res.fallbacks} line${res.fallbacks === 1 ? ' was' : 's were'} placed whole because the words differ from the lyrics`);
      g.note = notes.join('; ');
    } else if (g.layout === 'clips') {
      const on = bar.querySelector('.on')?.value ?? 'target';
      const trackId = on === 'source' ? g.sourceTrackId : on === 'new' ? null : g.target?.trackId ?? null;
      const placed = await L.placeScript(session, g.items, { trackId, tick: 0 }, { layout: 'explicit', trackName: g.title });
      g.placedText = `✓ on "${placed[0].track.name.value}"`;
    }
    say(`Placed "${g.title}" ${g.placedText.slice(2)}.${g.note ? ` ${g.note}.` : ''} Undo removes it.`, 'ok');
    renderResults();
  } catch (e) { sayError(e, 'Could not place them: '); }
}

/**
 * Turn finished audio into results: decode, add to the session as sources, record in
 * History, then place automatically if asked. `parts` are { bytes, label, extra }.
 */
async function finish(job, ctx, parts) {
  const items = [];
  const sameSession = session && ctx.sessionUid === session.uid;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    job.progress = parts.length > 1 ? `saving ${i + 1}/${parts.length}` : 'saving';
    renderJobs();
    const decoded = await decodeToWav(p.bytes);
    const id = uid();
    const name = parts.length > 1 && ctx.layout === 'variations' ? `${ctx.title} #${i + 1}` : (p.name ?? ctx.title);
    const item = { id, name, label: p.label ?? `#${i + 1}`, ...decoded, ...p.extra };
    const url = URL.createObjectURL(new Blob([decoded.wav], { type: 'audio/wav' }));
    item.url = url;
    blobUrls.set(id, url);
    if (sameSession) {
      item.sourceUid = await L.uploadAudio(session, { wav: decoded.wav, name });
      blobUrls.set(item.sourceUid, url);
      await history?.add({
        id, kind: ctx.kind, name, prompt: p.prompt ?? ctx.prompt, settings: ctx.settings, tab: ctx.tab,
        seconds: decoded.seconds, channels: decoded.channels, sourceUid: item.sourceUid,
        createdAt: Date.now(), target: ctx.target, groupId: ctx.groupId, layout: ctx.layout,
      }).catch(() => { /* history is a convenience; the result is still here */ });
    }
    delete item.wav; // the session has it now; the blob URL plays it here
    items.push(item);
  }
  const g = { id: ctx.groupId, title: ctx.title, layout: ctx.layout, items, target: ctx.target, origin: ctx.origin, sessionUid: ctx.sessionUid, scriptOpts: ctx.scriptOpts, fitMode: ctx.fitMode, trackName: ctx.trackName, sourceTrackId: ctx.sourceTrackId, sourceTrackName: ctx.sourceTrackName };
  g.tab = ctx.tab;
  groups.unshift(g);
  markTabNew(g.tab);
  renderResults();
  if (!sameSession) { say(`"${ctx.title}" is ready to preview. ${session ? 'It was started in another session, so it cannot be placed here.' : 'Open a session in LUNA to place it.'}`, 'ok'); return; }

  // Automatic placement, at the destination taken when Generate was clicked: a single result
  // as it is; variations all at once, as playlists or tracks (the last "Place all as" choice);
  // scripts, lyrics and changed clips as a whole. With it off, everything waits in the list.
  if (!ctx.autoPlace) {
    say(g.layout === 'variations'
      ? `${items.length} variations of "${ctx.title}" are ready in the results list: play them, then place one or all.`
      : `"${ctx.title}" is ready in the results list.`, 'ok');
    return;
  }
  if (g.layout === 'single') { await placeOne(g, items[0], 'target'); return; }
  const fake = document.createElement('div');
  fake.innerHTML = `<select class="at"><option value="target" selected></option></select><select class="on"><option value="target" selected></option></select><select class="as"><option value="${prefs.placeAs === 'tracks' ? 'tracks' : 'playlists'}" selected></option></select>`;
  await placeGroup(g, fake);
}

/** The tick a new result starts at, from the Position choice; says so when it falls back. */
function startAt() {
  const { tick, note } = L.startTick(session, placeAt());
  if (note) say(note);
  return tick;
}

/** What every generation remembers at the moment Generate is clicked. */
function context(kind, title, prompt, extra = {}) {
  const tab = kind === 'script' ? 'tts' : kind;
  return {
    kind, tab, title, prompt, groupId: uid(), layout: 'single',
    sessionUid: session?.uid ?? null,
    target: session ? L.captureTarget(session, destMode(), extra.originTick ?? startAt()) : null,
    autoPlace: $('auto-place').checked,
    settings: snapshot(tab),
    ...extra,
  };
}

/** The tab's form, for History and "Load settings from clip". */
function snapshot(tab) {
  const out = {};
  for (const el of document.querySelectorAll(`#tab-${tab} [data-remember]`)) out[el.id] = fieldValue(el);
  return out;
}
/**
 * Load saved settings into a tab. They come from History in session storage, which a shared
 * session brings along, so only the tab's own remembered fields take them, as plain values.
 */
function applySnapshot(tab, settings) {
  if (typeof tab !== 'string' || !/^[a-z-]+$/.test(tab) || !$(`tab-${tab}`)) return false;
  showTab(tab);
  const allowed = new Set([...document.querySelectorAll(`#tab-${tab} [data-remember]`)].map((el) => el.id));
  for (const [id, v] of Object.entries(settings ?? {})) {
    if (!allowed.has(id) || (v !== null && typeof v === 'object')) continue;
    setField($(id), v);
  }
  return true;
}

// ---------- features ----------

const variations = (id) => ($(id).disabled ? 1 : Math.max(1, Math.min(4, Number($(id).value) || 1)));

/** Run `n` requests in parallel, as variations of one job. */
async function requestN(job, n, request) {
  let done = 0;
  job.progress = n > 1 ? `0/${n}` : '';
  return Promise.all(Array.from({ length: n }, () => request().then((r) => { done++; if (n > 1) { job.progress = `${done}/${n}`; renderJobs(); } return r; })));
}

function generateTts() {
  const voiceId = $('tts-voice').value;
  const voiceName = $('tts-voice').selectedOptions[0]?.textContent ?? 'Speech';
  const settings = {
    stability: Number($('tts-stability').value), similarity_boost: Number($('tts-similarity').value),
    style: Number($('tts-style').value), speed: Number($('tts-speed').value), use_speaker_boost: true,
  };
  const modelId = $('tts-model').value;
  if (renderTtsCount().tooLong) { say('The text is longer than this model takes in one request. Shorten it, use script mode, or pick another model.', 'error'); return; }
  if (!voiceId) { say('Choose a voice.', 'error'); return; }
  const words = (r) => AddOnLyrics.wordsFromAlignment(r.alignment);
  if ($('tts-script').checked && $('tts-layout').value === 'lyrics') { generateLyrics(voiceId, voiceName, modelId, settings); return; }
  if ($('tts-script').checked) {
    const lines = ttsLines();
    if (!lines.length) { say('Write at least one line.', 'error'); return; }
    const ctx = context('script', `Script · ${lines.length} lines`, $('tts-text').value, {
      layout: 'script', scriptOpts: { layout: $('tts-layout').value, gapSeconds: Number($('tts-gap').value) || 0 },
    });
    enqueue(ctx.title, async (signal, job) => {
      const parts = [];
      for (let i = 0; i < lines.length; i++) {
        job.progress = `line ${i + 1}/${lines.length}`;
        renderJobs();
        const line = lines[i];
        const res = await client.textToSpeechTimed({ voiceId: line.voiceId ?? voiceId, text: line.text, modelId, voiceSettings: settings, signal });
        parts.push({ bytes: res.bytes, label: `${i + 1}. ${line.speaker ? `${line.speaker}: ` : ''}${line.text.slice(0, 40)}`, name: L.clipName(line.speaker ?? voiceName, line.text), prompt: line.text, extra: { speaker: line.speaker, text: line.text, genWords: words(res) } });
      }
      await finish(job, ctx, parts);
    });
    return;
  }
  const text = $('tts-text').value;
  if (!text.trim()) { say('Enter some text.', 'error'); return; }
  const n = variations('tts-variations');
  const ctx = context('tts', L.clipName(voiceName, text), text, { layout: n > 1 ? 'variations' : 'single' });
  enqueue(ctx.title, async (signal, job) => {
    const res = await requestN(job, n, () => client.textToSpeechTimed({ voiceId, text, modelId, voiceSettings: settings, signal }));
    await finish(job, ctx, res.map((r) => ({ bytes: r.bytes, extra: { text, genWords: words(r) } })));
  });
}

// ---------- lyrics: import into Text to Speech, re-voice at the original timing ----------

let importedLyrics = null; // { lines: [{ text, startTick, stopTick, words }], from }

function lyricsLayoutUi() {
  const on = $('tts-layout').value === 'lyrics';
  for (const el of document.querySelectorAll('.lyrics-opt')) el.hidden = !on;
  document.querySelector('.gap-opt').hidden = on || $('tts-layout').value === 'markers';
  $('tts-speaker-hint').hidden = on; // lyric lines have no speakers
  $('tts-layout').querySelector('option[value=lyrics]').disabled = !importedLyrics;
  const note = $('tts-lyrics-note');
  note.hidden = !importedLyrics;
  if (importedLyrics) {
    const typed = ttsLines().length;
    const n = importedLyrics.lines.length;
    note.textContent = `Imported ${n} lyric line${n === 1 ? '' : 's'} from ${importedLyrics.from}.` + (on && typed !== n ? ` The text now has ${typed} lines; keep one line per lyric line to use the original timing.` : '');
    note.classList.toggle('warn', on && typed !== n);
  }
}
$('tts-layout').addEventListener('change', lyricsLayoutUi);
$('tts-text').addEventListener('input', () => { if (importedLyrics) lyricsLayoutUi(); });

/** Find the lyrics in the selection; shared by the TTS button and the Lyrics tab. */
async function findLyrics() {
  if (!session) throw new Error('Open a session in LUNA first');
  const all = await AddOnLyrics.read(session, luna.raw);
  if (!all.length) throw new Error('This session has no lyrics yet. Run Extract Lyrics in LUNA on the clip, or use Transcribe on the Lyrics & LRC tab.');
  const found = await AddOnLyrics.inSelection(session, all);
  if (!found.lines.length) throw new Error('No lyrics in the selection. Select the clip (or a range over it) whose lyrics LUNA extracted.');
  const tracks = [...new Set(found.lines.map((l) => l.trackName))];
  found.from = `"${tracks.join('", "')}" ${AddOnLyrics.lrcTime(session.musical.timeline.seconds(found.lines[0].startTick))}–${AddOnLyrics.lrcTime(session.musical.timeline.seconds(found.lines[found.lines.length - 1].stopTick))}`;
  return found;
}

async function importLyrics(found) {
  try {
    found = found ?? (await findLyrics());
    importedLyrics = { lines: found.lines, from: found.from };
    showTab('tts');
    setField($('tts-text'), found.lines.map((l) => l.text).join('\n'));
    setField($('tts-script'), true);
    lyricsLayoutUi();
    $('tts-layout').value = 'lyrics';
    lyricsLayoutUi();
    say(`Imported ${found.lines.length} lines. Pick a voice and timing, then Generate.`, 'ok');
  } catch (e) { sayError(e); }
}
$('tts-import-lyrics').onclick = () => importLyrics();

// ---------- text files: .txt, .md, .rtf, subtitles (.srt, .vtt), lyrics (.lrc) ----------

/**
 * Put a text file into Text to Speech. Plain text and Markdown fill the text field.
 * Subtitles and LRC become one line per cue, and with a session open they keep their timing
 * (counted from the session start) through the same modes as imported lyrics.
 */
async function importTextFile(file) {
  try {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!L.TEXT_FILE_TYPES.includes(ext) && !/^text\//.test(file.type)) throw new Error(`"${file.name}" is not a text file. Use .txt, .md, .rtf, .srt, .vtt or .lrc.`);
    if (file.size > L.MAX_TEXT_FILE_BYTES) throw new Error(`"${file.name}" is larger than 2 MB. Split it into smaller files.`);
    const parsed = L.parseTextFile(file.name, L.decodeText(new Uint8Array(await file.arrayBuffer())));
    if (!parsed.text.trim()) throw new Error(`"${file.name}" has no text to speak.`);
    showTab('tts');
    setField($('tts-text'), parsed.text);
    if (parsed.cues && session) {
      await session.musical.ready();
      importedLyrics = { lines: L.cuesToLines(session, parsed.cues), from: `"${file.name}" (timed from the session start)` };
      setField($('tts-script'), true);
      lyricsLayoutUi();
      $('tts-layout').value = 'lyrics';
      lyricsLayoutUi();
      flashButton($('tts-import-text'), '✓ Imported');
      say(`Imported ${parsed.cues.length} timed lines from "${file.name}". They go at the file's timing; pick a voice and Generate, or choose another layout.`, 'ok');
    } else {
      importedLyrics = null;
      if ($('tts-layout').value === 'lyrics') $('tts-layout').value = 'sequential';
      if (parsed.cues) setField($('tts-script'), true);
      lyricsLayoutUi();
      const lines = parsed.text.split('\n').filter((l) => l.trim()).length;
      const tip = lines > 1 && !$('tts-script').checked ? ' Turn on One clip per line to make a clip of each line.' : '';
      flashButton($('tts-import-text'), '✓ Imported');
      say(`Imported ${parsed.text.length.toLocaleString('en-US')} characters (${lines} line${lines === 1 ? '' : 's'}) from "${file.name}".${tip}`, 'ok');
    }
    renderTtsCount();
  } catch (e) { sayError(e); }
}
$('tts-import-text').onclick = () => $('tts-file').click();
$('tts-file').onchange = () => { const f = $('tts-file').files[0]; $('tts-file').value = ''; if (f) importTextFile(f); };
{
  const ta = $('tts-text');
  ta.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) { e.preventDefault(); ta.classList.add('drop-over'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('drop-over'));
  ta.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    ta.classList.remove('drop-over');
    if (!f) return; // dropped text, not a file: the field takes it as usual
    e.preventDefault();
    importTextFile(f);
  });
}

/**
 * Lyrics mode: one request per line, with timestamps. With "fit" or "words" timing, a line far
 * off its original length is generated once more at a speed that fits, if allowed.
 */
function generateLyrics(voiceId, voiceName, modelId, settings) {
  const typed = ttsLines();
  if (!importedLyrics || typed.length !== importedLyrics.lines.length) {
    say('Keep one line of text per imported lyric line, or import the lyrics again.', 'error');
    return;
  }
  const fitMode = $('tts-fit').value;
  const retry = $('tts-speed-retry').checked && fitMode !== 'start';
  // A "Name:" that names a voice (WebVTT <v Name>) speaks in that voice; anything else is text.
  const lines = importedLyrics.lines.map((l, i) => {
    const p = L.parseScript(typed[i].text, voices)[0] ?? { text: typed[i].text, voiceId: null };
    return { ...l, text: p.text, voiceId: p.voiceId };
  });
  const ctx = context('script', `Lyrics · ${voiceName} · ${lines.length} lines`, lines.map((l) => l.text).join('\n'), {
    layout: 'lyrics', fitMode, trackName: `TTS - ${voiceName} (lyrics)`,
  });
  enqueue(ctx.title, async (signal, job) => {
    const tl = session.musical.timeline;
    const parts = [];
    let retried = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      job.progress = `line ${i + 1}/${lines.length}`;
      renderJobs();
      let res = await client.textToSpeechTimed({ voiceId: line.voiceId ?? voiceId, text: line.text, modelId, voiceSettings: settings, signal });
      if (retry) {
        const target = tl.seconds(line.stopTick) - tl.seconds(line.startTick);
        const { seconds } = await decodeToWav(res.bytes);
        const plan = AddOnLyrics.fitPlan(seconds, target, settings.speed);
        if (plan.retrySpeed !== null && target > 0.3) {
          job.progress = `line ${i + 1}/${lines.length} · adjusting speed`;
          renderJobs();
          res = await client.textToSpeechTimed({ voiceId: line.voiceId ?? voiceId, text: line.text, modelId, voiceSettings: { ...settings, speed: plan.retrySpeed }, signal });
          retried++;
        }
      }
      const genWords = AddOnLyrics.wordsFromAlignment(res.alignment);
      parts.push({ bytes: res.bytes, label: `${i + 1}. ${line.text.slice(0, 48)}`, name: L.clipName(voiceName, line.text), prompt: line.text, extra: { text: line.text, line, genWords } });
    }
    await finish(job, ctx, parts);
    if (retried) say(`${retried} line${retried === 1 ? ' was' : 's were'} generated again at a fitting speed. ${$('status').textContent}`, 'ok');
  });
}

function generateSfx() {
  const text = $('sfx-text').value;
  if (!text.trim()) { say('Describe the sound.', 'error'); return; }
  const dur = $('sfx-duration').value.trim();
  const opts = { text, durationSeconds: dur === '' ? null : Number(dur), promptInfluence: Number($('sfx-influence').value), loop: $('sfx-loop').checked, modelId: $('sfx-model').value };
  const n = variations('sfx-variations');
  const ctx = context('sfx', L.clipName('SFX', text), text, { layout: n > 1 ? 'variations' : 'single' });
  enqueue(ctx.title, async (signal, job) => {
    const res = await requestN(job, n, () => client.soundEffect({ ...opts, signal }));
    await finish(job, ctx, res.map((r) => ({ bytes: r.bytes })));
  });
}

function generateMusic() {
  const prompt = $('music-text').value;
  if (!prompt.trim()) { say('Describe the music.', 'error'); return; }
  const opts = { prompt, lengthSeconds: Number($('music-length').value) || 30, instrumental: $('music-instrumental').checked, modelId: $('music-model').value };
  const n = variations('music-variations');
  const ctx = context('music', L.clipName('Music', prompt), prompt, { layout: n > 1 ? 'variations' : 'single' });
  enqueue(ctx.title, async (signal, job) => {
    const res = await requestN(job, n, () => client.music({ ...opts, signal }));
    await finish(job, ctx, res.map((r) => ({ bytes: r.bytes })));
  });
}

/** The Voice Changer's voice settings (⚙), as ElevenLabs takes them. */
const vcSettings = () => ({ stability: Number($('vc-stability').value), similarity_boost: Number($('vc-similarity').value), style: Number($('vc-style').value) });

let vcFile = null;
let vcOriginTick = null; // where vcFile came from on the timeline, when it came from a clip
function generateVc() {
  if (!vcFile) { say('Use a clip from the timeline, or drop a recording first.', 'error'); return; }
  const voiceId = $('vc-voice').value;
  if (!voiceId) { say('Choose a voice.', 'error'); return; }
  const voiceName = $('vc-voice').selectedOptions[0]?.textContent ?? 'Voice';
  const file = vcFile;
  const opts = { voiceId, modelId: $('vc-model').value, removeBackgroundNoise: $('vc-denoise').checked, voiceSettings: vcSettings() };
  const fromClip = vcOriginTick !== null;
  const ctx = context('vc', L.clipName(voiceName, file.name.replace(/\.[^.]+$/, '')), file.name, fromClip ? { originTick: vcOriginTick, origin: true } : {});
  enqueue(ctx.title, async (signal, job) => {
    const res = await client.voiceChanger({ ...opts, audio: file, signal });
    await finish(job, ctx, [{ bytes: res.bytes }]);
  });
}

/** Voice Changer over every clip in the selection: one job, results on a new track. */
async function generateVcEvery() {
  const voiceId = $('vc-voice').value;
  if (!voiceId) { say('Choose a voice.', 'error'); return; }
  let sels;
  try { sels = await L.clipsInSelection(session); } catch (e) { sayError(e); return; }
  const voiceName = $('vc-voice').selectedOptions[0]?.textContent ?? 'Voice';
  const opts = { voiceId, modelId: $('vc-model').value, removeBackgroundNoise: $('vc-denoise').checked, voiceSettings: vcSettings() };
  const ctx = context('vc', `Voice - ${voiceName} (${sels.length} clips)`, `${sels.length} clips on "${sels[0].track.name.value}"`, {
    layout: 'clips', sourceTrackId: sels[0].track.id, sourceTrackName: sels[0].track.name.value ?? 'its track',
  });
  enqueue(ctx.title, async (signal, job) => {
    const parts = [];
    for (let i = 0; i < sels.length; i++) {
      job.progress = `clip ${i + 1}/${sels.length}`;
      renderJobs();
      const { file } = await clipAudioFile(sels[i]);
      const res = await client.voiceChanger({ ...opts, audio: file, signal });
      parts.push({ bytes: res.bytes, label: `${i + 1}. ${sels[i].clip.name.value || 'clip'} at ${L.barText(session, sels[i].startTick)}`, name: L.clipName(voiceName, sels[i].clip.name.value), extra: { tick: sels[i].startTick } });
    }
    await finish(job, ctx, parts);
  });
}

let ivcFiles = [];
/** Point at a field that needs filling: scroll to it, focus it, and say what is missing. */
function needField(id, message) {
  const el = $(id);
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus();
  el.classList.remove('need');
  void el.offsetWidth;
  el.classList.add('need');
  setTimeout(() => el.classList.remove('need'), 1600);
  say(message, 'error');
}

function generateIvc() {
  // Everything ElevenLabs needs is checked here, before a job starts, next to its field.
  if (!$('ivc-name').value.trim()) { needField('ivc-name', 'Type a name for the new voice in "Voice name" at the top of this tab.'); return; }
  if (!ivcFiles.length) { needField('ivc-drop', 'Add at least one recording of the voice: drop files on the drop zone, click it to choose, or use Add selected clip.'); return; }
  if (!$('ivc-consent').checked) { needField('ivc-consent', 'Tick "I own this voice or have the speaker\'s permission to clone it" to continue.'); return; }
  const name = $('ivc-name').value;
  const files = ivcFiles;
  const description = $('ivc-desc').value.trim() || undefined;
  const removeBackgroundNoise = $('ivc-denoise').checked;
  enqueue(`Clone "${name.trim() || 'voice'}"`, async (signal) => {
    const res = await client.cloneVoice({ name, files, description, removeBackgroundNoise, signal });
    await loadVoices();
    for (const sel of document.querySelectorAll('.voice-select')) sel.value = res.voice_id;
    paintVoiceChips();
    remember();
    const note = res.requires_verification ? ' ElevenLabs needs to verify it before it can be used.' : '';
    say(`Cloned "${name.trim()}". It is selected in Text to Speech and Voice Changer.${note}`, 'ok');
    ivcFiles = [];
    renderIvcFiles();
  });
}

const GENERATE = { tts: generateTts, sfx: generateSfx, music: generateMusic, vc: generateVc, ivc: generateIvc };
$('tts-go').onclick = generateTts;
$('sfx-go').onclick = generateSfx;
$('music-go').onclick = generateMusic;
$('vc-go').onclick = generateVc;
$('vc-every').onclick = generateVcEvery;
$('ivc-go').onclick = generateIvc;

// ---------- session-aware helpers: selection length, tempo & key ----------

async function useSelectionLength(inputId, min, max) {
  if (!session) { say('Open a session in LUNA first.', 'error'); return; }
  const secs = await L.selectionSeconds(session);
  if (secs === null) { say('Select a range on the timeline first.', 'error'); return; }
  const v = Math.min(max, Math.max(min, Math.round(secs * 10) / 10));
  setField($(inputId), v);
  say(v === Math.round(secs * 10) / 10 ? `Length set to ${v} s from the selection.` : `The selection is ${secs.toFixed(1)} s; the length is limited to ${min}–${max} s, so it is ${v} s.`, v === Math.round(secs * 10) / 10 ? 'ok' : 'error');
}
$('sfx-sel-len').onclick = () => useSelectionLength('sfx-duration', 0.5, 30);
$('music-sel-len').onclick = () => useSelectionLength('music-length', 3, 600);
$('music-context').onclick = async () => {
  if (!session) { say('Open a session in LUNA first.', 'error'); return; }
  const ctx = await L.musicContext(session, Math.round(session.transport.tick || 0));
  if (!ctx) { say('LUNA did not report a tempo or key yet.', 'error'); return; }
  const t = $('music-text');
  setField(t, t.value.trim() ? `${t.value.trim().replace(/[.,]$/, '')}, ${ctx}` : ctx);
  say(`Added "${ctx}" to the prompt.`, 'ok');
};

// ---------- audio from clips on the timeline ----------

/** GET part of a served file. `full` is true when the server sent the whole file instead. */
function readRange(url, start, end) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); // not fetch(): Windows serves file:/// URLs
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    if (start !== undefined) xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
    xhr.onload = () => {
      if (!xhr.response || (xhr.status !== 200 && xhr.status !== 206 && xhr.status !== 0)) {
        reject(new Error(`could not read the clip's audio (HTTP ${xhr.status})`));
        return;
      }
      resolve({ bytes: new Uint8Array(xhr.response), full: xhr.status !== 206 });
    };
    xhr.onerror = () => reject(new Error("could not read the clip's audio"));
    xhr.send();
  });
}

/**
 * A clip selection's audio as a WAV File. On macOS LUNA serves byte ranges, so only the
 * header and the clip's own frames are read, however long the recording is.
 */
async function clipAudioFile(sel) {
  if (!(await luna.gui.available())) throw new Error('Taking audio from a clip works only inside LUNA');
  let url;
  try {
    url = await luna.gui.serveMediaFile(ADD_ON_ID, sel.path);
  } catch (e) {
    throw new Error(`LUNA could not hand over the clip's audio (${e.code || e.message}). Export the clip and drop the file here instead.`);
  }
  const head = await readRange(url, 0, 65535);
  let header = L.parseWavHeader(head.bytes);
  let whole = head.full ? head.bytes : null;
  if (!header && !whole) { // a header longer than 64 KB: read it all
    whole = (await readRange(url)).bytes;
    header = L.parseWavHeader(whole);
  }
  if (!header) throw new Error("The clip's audio file is not a WAV the Add On can read. Export the clip and drop the file here instead.");
  const range = L.wavByteRange(header, sel.sourceStartNs, sel.sourceStopNs);
  if (range.frames === 0) throw new Error('The selected part of the clip is empty');
  let body;
  if (whole) body = whole.subarray(range.start, range.end);
  else {
    const part = await readRange(url, range.start, range.end - 1);
    body = part.full ? part.bytes.subarray(range.start, range.end) : part.bytes;
  }
  const wav = L.encodeWav(L.wavSamplesToFloat(header, body), header.sampleRate);
  const name = (sel.clip.name.value || sel.track.name.value || 'clip').replace(/[\\/:*?"<>|]+/g, '_');
  return { file: new File([wav], `${name}.wav`, { type: 'audio/wav' }), seconds: range.frames / header.sampleRate };
}

async function takeClip(useIt) {
  say('Reading the clip…');
  try {
    const sel = await L.clipSelection(session);
    const { file, seconds } = await clipAudioFile(sel);
    useIt(file, sel);
    say(`Took ${seconds.toFixed(1)} s of "${sel.clip.name.value || 'clip'}" from "${sel.track.name.value}".`, 'ok');
  } catch (e) { sayError(e); }
}
$('vc-clip').onclick = () => takeClip((file, sel) => { vcFile = file; vcOriginTick = sel.startTick; renderVcFile(); });
$('ivc-clip').onclick = () => takeClip((file) => { ivcFiles = ivcFiles.concat(file); renderIvcFiles(); });

/** "Load settings from clip": the History entry whose source the selected clip plays. */
async function loadFromClip() {
  if (!session || !history) { say('Open a session in LUNA first.', 'error'); return; }
  try {
    const sel = await L.clipSelection(session);
    await history.load();
    const entry = L.entryForSource(history.list(), sel.sourceUid);
    if (!entry) { say(`"${sel.clip.name.value || 'This clip'}" was not made by this Add On in this session, or its history was cleared.`, 'error'); return; }
    reuse(entry);
  } catch (e) { sayError(e); }
}
function reuse(entry) {
  if (!entry.settings || !entry.tab) { say('This entry has no settings to load.', 'error'); return; }
  applySnapshot(entry.tab, entry.settings);
  closeOverlays();
  say(`Loaded the settings of "${entry.name}". Change what you like and generate again.`, 'ok');
}
$('load-from-clip').onclick = loadFromClip;
$('load-from-clip').title = `Select a clip this Add On made, then click to open its tab with the prompt and settings that made it, ready to tweak and generate again (${AddOnHelp.keyLabel(AddOnHelp.SHORTCUTS.find((s) => s.action === 'load-from-clip'))})`;

// ---------- files: picker, HTML drop, and LUNA path drop ----------

/** The Voice Changer input, with a Clear button next to it. */
function renderVcFile() {
  const box = $('vc-file');
  box.textContent = vcFile ? `${vcFile.name}${vcOriginTick !== null ? ` · goes back to ${L.barText(session, vcOriginTick)}` : ''}` : '';
  if (!vcFile) return;
  const b = document.createElement('button');
  b.className = 'link';
  b.textContent = 'Clear';
  b.style.marginLeft = '10px';
  b.title = `Remove this recording from Voice Changer (${AddOnHelp.keyLabel(AddOnHelp.SHORTCUTS.find((s) => s.action === 'clear-vc'))})`;
  b.onclick = (e) => { e.stopPropagation(); clearVcFile(); }; // not the drop zone's click, which opens the file picker
  box.append(b);
}
function clearVcFile() {
  if (!vcFile) { say('Voice Changer has no recording to clear.'); return; }
  vcFile = null;
  vcOriginTick = null;
  renderVcFile();
  say('Voice Changer input cleared.', 'ok');
}
function renderIvcFiles() { $('ivc-files').textContent = ivcFiles.map((f) => f.name).join(', '); }
const isAudio = (f) => /^audio\//.test(f.type) || /\.(wav|aiff?|mp3|m4a|flac|ogg|webm)$/i.test(f.name);

function takeFiles(files) {
  const audio = [...files].filter(isAudio);
  if (!audio.length) { say('That is not an audio file.', 'error'); return; }
  if (activeTab === 'vc') { vcFile = audio[0]; vcOriginTick = null; renderVcFile(); }
  else if (activeTab === 'ivc') { ivcFiles = ivcFiles.concat(audio); renderIvcFiles(); }
}

function wireDrop(zoneId, inputId) {
  const zone = $(zoneId);
  const input = $(inputId);
  zone.onclick = () => input.click();
  input.onchange = () => { takeFiles(input.files); input.value = ''; };
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); takeFiles(e.dataTransfer.files); });
}
wireDrop('vc-drop', 'vc-input');
wireDrop('ivc-drop', 'ivc-input');
$('ivc-clear').onclick = () => { ivcFiles = []; renderIvcFiles(); };

// No Luna.onPathDrop here on purpose. While a page takes path drops, LUNA claims every file
// drag and hands over only paths, and LUNA serves only audio, video and MIDI by path, so a
// dropped text file could not be read. Without it, LUNA passes drops on as ordinary HTML
// drops with the File itself (SDK EVIDENCE.md fact 102), which every drop zone here reads:
// audio on Voice Changer and Voice Clone, text, subtitles and LRC on the text field.

/** A file dropped anywhere else on the window goes where the tab expects it, never opens as a page. */
const dragHasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
document.addEventListener('dragover', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!dragHasFiles(e) || e.defaultPrevented) return; // a drop zone already took it
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (!files?.length) return;
  if (activeTab === 'tts') importTextFile(files[0]);
  else if (activeTab === 'vc' || activeTab === 'ivc') takeFiles(files);
  else say('Drop text, subtitles or LRC on Text to Speech, and audio on Voice Changer or Voice Clone.', 'error');
});

// ---------- voices and models ----------

function fillVoiceSelect(sel, query = '') {
  const q = query.trim().toLowerCase();
  const match = (v) => !q || [v.name, ...Object.values(v.labels ?? {})].join(' ').toLowerCase().includes(q);
  const keep = sel.value;
  sel.innerHTML = '';
  for (const g of L.groupVoices(voices.filter(match))) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const v of g.voices) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  else restoreSelect(sel);
  paintVoiceChips();
}

/** The voice chips on the card bars: the chosen voice's initial and name. */
const AVATAR_COLORS = ['#F5C04A', '#7AA7FF', '#C792EA', '#5FC4B0', '#F08A5D', '#E6A0C4', '#9AD0F5'];
function paintVoiceChips() {
  for (const chip of document.querySelectorAll('[data-voice-chip]')) {
    const sel = $(chip.dataset.voiceChip);
    const name = sel.selectedOptions[0]?.textContent ?? (voices.length ? 'Choose a voice' : 'Voice');
    chip.querySelector('.lbl').textContent = name;
    const av = chip.querySelector('.avatar');
    av.textContent = (name.trim()[0] || '?').toUpperCase();
    let h = 0;
    for (const c of sel.value || name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    av.style.background = AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
}
document.addEventListener('change', (e) => { if (e.target.matches?.('.voice-select')) paintVoiceChips(); });
function fillVoiceSelects() {
  for (const sel of document.querySelectorAll('.voice-select')) {
    const search = document.querySelector(`.voice-search[data-for="${sel.id}"]`);
    fillVoiceSelect(sel, search?.value ?? '');
  }
  renderClonedList();
  renderTtsCount();
}
for (const input of document.querySelectorAll('.voice-search')) {
  input.addEventListener('input', () => fillVoiceSelect($(input.dataset.for), input.value));
}
for (const b of document.querySelectorAll('[data-preview]')) {
  b.dataset.play = `voice:${b.dataset.preview}`;
  b.onclick = () => {
    const v = voices.find((x) => x.id === $(b.dataset.preview).value);
    if (!v || !v.previewUrl) { say('This voice has no sample to play.', 'error'); return; }
    togglePlay(`voice:${b.dataset.preview}`, v.previewUrl);
  };
}
for (const id of ['tts-voice', 'vc-voice']) $(id).addEventListener('change', () => { if (playingKey === `voice:${id}`) player.pause(); });

function renderClonedList() {
  const list = $('ivc-list');
  list.innerHTML = '';
  const mine = voices.filter((v) => v.category === 'cloned');
  if (!mine.length) { list.innerHTML = '<div class="hint">None yet.</div>'; return; }
  for (const v of mine) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<span class="name"></span><button class="ghost danger" title="Delete this voice from your ElevenLabs account (click twice). Clips already made with it stay.">Delete</button>';
    row.querySelector('.name').textContent = v.name;
    const b = row.querySelector('button');
    let armed = null;
    b.onclick = async () => {
      if (!armed) { // two clicks, so a stray click cannot delete a voice
        b.textContent = 'Click again to delete';
        armed = setTimeout(() => { armed = null; b.textContent = 'Delete'; }, 3000);
        return;
      }
      clearTimeout(armed);
      b.disabled = true;
      try {
        await client.deleteVoice(v.id);
        say(`Deleted the voice "${v.name}" from your ElevenLabs account.`, 'ok');
        await loadVoices();
      } catch (e) { sayError(e); b.disabled = false; }
    };
    list.appendChild(row);
  }
}

async function loadVoices() {
  voices = await client.voices();
  fillVoiceSelects();
}

function fillModelSelect(sel, list, preferred) {
  const keep = sel.value;
  sel.innerHTML = '';
  for (const m of list) {
    const o = document.createElement('option');
    o.value = m.model_id;
    o.textContent = m.name || m.model_id;
    sel.appendChild(o);
  }
  const ids = list.map((m) => m.model_id);
  const remembered = prefs.fields?.[sel.id];
  sel.value = ids.includes(keep) ? keep : ids.includes(remembered) ? remembered : preferred.find((p) => ids.includes(p)) ?? ids[0] ?? '';
}

async function loadModels() {
  models = await client.models();
  fillModelSelect($('tts-model'), models.filter((m) => m.can_do_text_to_speech), ['eleven_multilingual_v2', 'eleven_v3', 'eleven_flash_v2_5']);
  fillModelSelect($('vc-model'), models.filter((m) => m.can_do_voice_conversion), ['eleven_multilingual_sts_v2', 'eleven_english_sts_v2']);
  renderTtsCount();
}

for (const id of ['voices-refresh-1', 'voices-refresh-2']) {
  $(id).onclick = () => {
    if (!client) { say('Add your ElevenLabs API key first.', 'error'); return undefined; }
    return loadVoices().then(() => say(`Voices refreshed: ${voices.length} in your account.`, 'ok')).catch(sayError);
  };
}

async function refreshQuota() {
  if (!client) { $('quota').textContent = ''; return; }
  try {
    subscription = await client.subscription();
    $('quota').textContent = L.quotaText(subscription);
    renderTtsCount();
  } catch { /* keep the last value */ }
}

// ---------- API key ----------

async function useKey(key) {
  const candidate = new ElevenLabs.Client(key);
  const sub = await candidate.subscription(); // throws on a bad key
  client = candidate;
  subscription = sub;
  $('quota').textContent = L.quotaText(sub);
  $('ivc-plan').textContent = sub.can_use_instant_voice_cloning === false
    ? 'Your ElevenLabs plan does not include Instant Voice Clone. Upgrade your plan on elevenlabs.io to use it.'
    : '';
  // The key works once the subscription answers. Voices or models that fail to load are said
  // in the status line; they do not make the key look bad, and ↻ Refresh loads voices again.
  const [v, m] = await Promise.allSettled([loadVoices(), loadModels()]);
  const failed = [v, m].filter((r) => r.status === 'rejected');
  if (failed.length) sayError(failed[0].reason, `Could not load ${v.status === 'rejected' ? 'the voices' : 'the models'} (↻ Refresh in the voice list tries again): `);
  return !failed.length;
}

async function saveKey(key) {
  for (const id of ['key-save', 'key-paste']) $(id).disabled = true;
  say('Checking the key…');
  try {
    await useKey(key);
    await luna.secrets.set(L.SECRET_NAME, key);
    $('key-input').value = '';
    const where = luna.secrets.storage === 'keychain' ? 'saved in your keychain' : 'kept only until this page reloads';
    say(`Key works and is ${where}.`, 'ok');
    showTab('tts');
    return true;
  } catch (e) {
    sayError(e, 'That key did not work: ');
    return false;
  } finally {
    for (const id of ['key-save', 'key-paste']) $(id).disabled = false;
  }
}

$('key-save').onclick = () => {
  const key = $('key-input').value.trim();
  if (!key) { say('Paste your ElevenLabs API key into the field, or use Paste key.', 'error'); return; }
  return saveKey(key);
};

async function pasteKey() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    showTab('key');
    $('key-input').focus();
    say('The Add On could not read the clipboard. Paste the key into the field (⌘V) and click Save and check.', 'error');
    return;
  }
  const key = L.keyFromClipboard(text);
  if (!key) { say('The clipboard does not hold an ElevenLabs API key. Copy the key on the API Keys page first.', 'error'); return; }
  if (await saveKey(key)) {
    // Like ElevenLabs' own CLI: a key read from the clipboard does not stay there.
    try { if ((await navigator.clipboard.readText()).trim() === key) await navigator.clipboard.writeText(''); } catch { /* not writable */ }
  }
}
$('key-paste').onclick = pasteKey;

$('key-delete').onclick = async () => {
  try { await luna.secrets.delete(L.SECRET_NAME); } catch { /* nothing stored */ }
  client = null;
  subscription = null;
  voices = [];
  fillVoiceSelects();
  $('quota').textContent = '';
  say('API key forgotten.', 'ok');
};

$('key-open').onclick = () => openUrl('https://elevenlabs.io/app/api/api-keys?quickstart=true');

async function loadStoredKey() {
  if (luna.secrets.storage !== 'keychain') $('key-note').textContent += ' Outside LUNA the key is kept only until the page reloads.';
  let key = null;
  try { key = await luna.secrets.get(L.SECRET_NAME); } catch (e) { say(`Could not read the saved key: ${errorText(e)}`, 'error'); }
  if (!key) { showTab('key'); say('Add your ElevenLabs API key to start.'); return; }
  await tryStoredKey(key, 0);
}

/**
 * Use the saved key. A network error is not a bad key: keep the key and the tab, retry a few
 * times on its own, and offer Try again. Only ElevenLabs rejecting the key opens the API Key tab.
 */
let keyRetry = null;
async function tryStoredKey(key, attempt) {
  clearTimeout(keyRetry);
  try {
    if (await useKey(key)) say('Ready.', 'ok');
  } catch (e) {
    if (e && e.kind === 'network') {
      const again = { label: 'Try again', title: 'Connect to ElevenLabs again with the saved key.', run: () => { say('Connecting to ElevenLabs…'); tryStoredKey(key, 0); } };
      if (attempt < 5) {
        say(`Could not reach ElevenLabs; trying again in 5 s. Your saved key is kept.`, 'error', again);
        keyRetry = setTimeout(() => tryStoredKey(key, attempt + 1), 5000);
      } else {
        say('Could not reach ElevenLabs. Your saved key is kept; check the internet connection, then Try again.', 'error', again);
      }
      return;
    }
    showTab('key');
    sayError(e, 'The saved key did not work: ');
  }
}

// ---------- Lyrics & LRC tab ----------

/**
 * The lyrics on the tab: one document shown as plain text or as LRC. Each line and word may
 * carry `t` (seconds on the session timeline) and `a` (seconds into its audio file); the
 * "LRC times count from" choice picks one. Words also carry `end`. `sourceUid` + `writable`:
 * the lines belong to one audio file and can be added to LUNA's lyrics.
 */
let doc = null;
let docView = 'text';

const docLinesFor = (key) => doc.lines.map((l) => ({
  text: l.text, start: l[key].start, end: l[key].end,
  words: (l.words ?? []).filter((w) => w[key] !== undefined).map((w) => ({ text: w.text, start: w[key] })),
}));

function lrcKey() {
  const base = $('lrc-base');
  const canT = doc.lines.every((l) => l.t);
  const canA = doc.lines.every((l) => l.a);
  base.querySelector('option[value=timeline]').disabled = !canT;
  base.querySelector('option[value=audio]').disabled = !canA;
  if ((base.value === 'timeline' && !canT) || (base.value === 'audio' && !canA)) base.value = canT ? 'timeline' : 'audio';
  return base.value === 'timeline' ? 't' : 'a';
}

/** Show the document in the field, in the chosen format. */
function renderDoc() {
  const has = !!doc;
  const ta = $('lrc-text');
  for (const b of $('ly-view').querySelectorAll('button')) { b.classList.toggle('on', b.dataset.view === docView); b.disabled = !has; }
  ta.classList.toggle('lrc', docView === 'lrc');
  document.querySelector('.lrc-opts').classList.toggle('off', docView !== 'lrc');
  for (const id of ['lrc-base', 'lrc-words']) $(id).disabled = docView !== 'lrc' || !has;
  $('lrc-words-label').classList.toggle('off', docView !== 'lrc' || !has);
  $('lrc-copy').disabled = !has;
  $('ly-to-tts').disabled = !(has && session && doc.lines.every((l) => l.t));
  $('lrc-to-luna').disabled = !(has && doc.writable && doc.sourceUid && session);
  if (!has) { $('ly-title').textContent = 'No lyrics yet'; return; }
  $('ly-title').textContent = `${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'} · ${doc.title}`;
  $('ly-source').textContent = `${doc.from}${doc.inLuna ? ' · in LUNA\'s lyrics' : ''}`;
  ta.value = docView === 'lrc'
    ? AddOnLyrics.formatLrc(docLinesFor(lrcKey()), { title: doc.title, words: $('lrc-words').checked })
    : doc.lines.map((l) => l.text).join('\n');
  checkDocEdits();
}

/** Text the user typed, as lines: from the plain view directly, from the LRC view through its cues. */
function typedDocLines() {
  const v = $('lrc-text').value;
  if (docView === 'lrc') return L.parseTextFile('edit.lrc', v).cues.map((c) => c.text);
  return v.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Keep the user's corrections: line i of the field updates line i of the document. A line
 * whose words changed loses its word timing; a different number of lines keeps the timing
 * of the lines as they were and says so.
 */
function checkDocEdits() {
  if (!doc) return;
  const typed = typedDocLines();
  const warn = $('ly-warn');
  if (typed.length !== doc.lines.length) {
    warn.textContent = `The field has ${typed.length} line${typed.length === 1 ? '' : 's'} for ${doc.lines.length} timed lines. Keep one line per lyric line, or the timing cannot follow your changes.`;
    warn.classList.add('warn');
    return false;
  }
  warn.textContent = '';
  typed.forEach((text, i) => {
    const line = doc.lines[i];
    if (text === line.text) return;
    if (AddOnLyrics.splitWords(text).length !== (line.words ?? []).length) line.words = [];
    else line.words = line.words.map((w, j) => ({ ...w, text: AddOnLyrics.splitWords(text)[j] }));
    line.text = text;
  });
  return true;
}
$('lrc-text').addEventListener('input', () => checkDocEdits());
for (const b of $('ly-view').querySelectorAll('button')) {
  b.onclick = () => { if (!doc || b.dataset.view === docView) return; checkDocEdits(); docView = b.dataset.view; renderDoc(); };
}
$('lrc-base').addEventListener('change', () => { checkDocEdits(); renderDoc(); });
$('lrc-words').addEventListener('change', () => { checkDocEdits(); renderDoc(); });

function openDoc(next, view = 'text') {
  doc = next;
  docView = view;
  showTab('lyrics');
  renderDoc();
  say(`${doc.lines.length} lines from ${doc.from}.`, 'ok');
}
/** Kept name: the results list's LRC buttons open the document in the LRC view. */
const openLrc = (next) => openDoc(next, 'lrc');
renderDoc(); // empty state: formats and actions off until there are lyrics

/** From LUNA's own lyrics (Extract Lyrics) in the selection. */
function docFromFound(found) {
  const tl = session.musical.timeline;
  const sources = new Set(found.lines.map((l) => l.sourceUid));
  const one = sources.size === 1;
  return {
    title: found.lines[0].trackName, from: `LUNA lyrics, ${found.from}`,
    sourceUid: one ? [...sources][0] : null, writable: false, inLuna: true,
    lines: found.lines.map((l) => ({
      text: l.text,
      t: { start: tl.seconds(l.startTick), end: tl.seconds(l.stopTick) },
      a: one ? { start: l.sourceStart, end: l.sourceEnd } : null,
      words: l.words.map((w) => ({ text: w.text, t: tl.seconds(w.startTick), a: one ? w.sourceStart : undefined, end: tl.seconds(w.stopTick) })),
    })),
  };
}

/** From words timed in one audio file; `zero` is where that file's 0 s sits on the timeline, if known. */
function docFromWords(words, { title, from, sourceUid, zero = null }) {
  const lines = AddOnLyrics.linesFromWords(words);
  return {
    title, from, sourceUid, writable: !!sourceUid,
    lines: lines.map((l) => ({
      text: l.text,
      a: { start: l.start, end: l.end },
      t: zero === null ? null : { start: zero + l.start, end: zero + l.end },
      words: l.words.map((w) => ({ text: w.text, a: w.start, t: zero === null ? undefined : zero + w.start, end: zero === null ? w.end : zero + w.end })),
    })),
  };
}

/** From a speech result (its character timestamps). */
function lrcFromItem(item) {
  const tl = session?.musical.timeline;
  const zero = item.placedTick !== undefined && tl ? tl.seconds(item.placedTick) : null;
  openLrc(docFromWords(item.genWords, { title: item.name, from: `"${item.name}"`, sourceUid: item.sourceUid, zero }));
}

/** From a lyrics or script group: where its lines were placed (lyrics: the original timing). */
function lrcFromGroup(g) {
  const tl = session.musical.timeline;
  const placed = g.layout === 'lyrics' ? g.items.map((i) => ({ ...i.line, text: i.text ?? i.line.text })) : g.placedLines;
  openLrc({
    title: g.title, from: `"${g.title}"`, sourceUid: null, writable: false,
    lines: placed.map((l) => ({
      text: l.text,
      t: { start: tl.seconds(l.startTick), end: tl.seconds(l.stopTick) },
      a: null,
      words: (l.words ?? []).map((w) => ({ text: w.text, t: tl.seconds(w.startTick), end: tl.seconds(w.stopTick) })),
    })),
  });
}

$('ly-find').onclick = async () => {
  try {
    openDoc(docFromFound(await findLyrics()), 'text');
  } catch (e) { sayError(e); }
};

/** Re-voice the document, as corrected in the field, at its timeline timing. */
$('ly-to-tts').onclick = () => {
  if (!doc || !session) return;
  if (!checkDocEdits()) { say('Keep one line per lyric line, then re-voice.', 'error'); return; }
  const tl = session.musical.timeline;
  const tick = (sec) => Math.round(tl.tickAtSeconds(Math.max(0, sec)));
  const lines = doc.lines.map((l) => ({
    text: l.text,
    startTick: tick(l.t.start),
    stopTick: tick(l.t.end),
    words: (l.words ?? []).filter((w) => w.t !== undefined).map((w, i, ws) => ({ text: w.text, startTick: tick(w.t), stopTick: tick(w.end ?? ws[i + 1]?.t ?? l.t.end) })),
  }));
  return importLyrics({ lines, from: doc.from.replace(/^LUNA lyrics, /, '') });
};

$('ly-transcribe').onclick = async () => {
  if (!session) { say('Open a session in LUNA first.', 'error'); return; }
  let sel;
  try { sel = await L.clipSelection(session); } catch (e) { sayError(e); return; }
  enqueue(`Transcribe "${sel.clip.name.value || 'clip'}"`, async (signal, job) => {
    job.progress = 'reading the clip';
    renderJobs();
    const { file } = await clipAudioFile(sel);
    job.progress = 'transcribing';
    renderJobs();
    const res = await client.speechToText({ audio: file, signal });
    if (!res.words.length) throw new Error('ElevenLabs found no words in the selected audio.');
    const tl = session.musical.timeline;
    const off = sel.sourceStartNs / 1e9; // the transcription starts where the selection starts in the file
    const words = res.words.map((w) => ({ text: w.text, start: off + w.start, end: off + w.end }));
    const zero = tl.seconds(sel.startTick) - off; // where the file's 0 s sits on the timeline (unstretched clip)
    openDoc(docFromWords(words, { title: sel.clip.name.value || sel.track.name.value, from: `transcription of "${sel.clip.name.value || 'clip'}"`, sourceUid: sel.sourceUid, zero }), 'text');
  });
};

/**
 * Show on the button itself that it worked (or not): "✓ Copied" in green for a moment,
 * then its own label again. The status line still says the details.
 */
function flashButton(b, text, kind = 'ok', ms = 1600) {
  clearTimeout(b._flash);
  // A 30px icon button has no room for words: it keeps its icon's place and shows ✓ or ! instead.
  const icon = b.classList.contains('icon');
  if (icon) {
    if (b._html === undefined) b._html = b.innerHTML;
    b.textContent = kind === 'ok' ? '✓' : '!';
  } else {
    if (!b.dataset.label) b.dataset.label = b.textContent;
    b.textContent = text;
  }
  b.classList.remove('flash-ok', 'flash-error');
  void b.offsetWidth; // restart the animation on a quick second click
  b.classList.add(kind === 'ok' ? 'flash-ok' : 'flash-error');
  b._flash = setTimeout(() => {
    b.classList.remove('flash-ok', 'flash-error');
    if (icon) { b.innerHTML = b._html; delete b._html; return; }
    b.textContent = b.dataset.label;
    delete b.dataset.label;
  }, ms);
}

/** Copy the field to the clipboard; false when the page may not write it. */
async function copyField() {
  try {
    await navigator.clipboard.writeText($('lrc-text').value);
    return true;
  } catch {
    $('lrc-text').select();
    return document.execCommand('copy');
  }
}

$('lrc-copy').onclick = async () => {
  if (!(await copyField())) { flashButton($('lrc-copy'), 'Copy failed', 'error'); say('Could not copy. Select the text and press ⌘C.', 'error'); return; }
  flashButton($('lrc-copy'), '✓ Copied');
  say(docView === 'lrc' ? 'LRC copied: paste it into any editor, subtitle tool or message.' : 'Lyrics copied: paste them anywhere.', 'ok');
};

{
  let armed = null;
  $('lrc-to-luna').onclick = async () => {
    if (!doc || !doc.writable || !doc.sourceUid || !session) return;
    if (!checkDocEdits()) { say('Keep one line per lyric line, then add them.', 'error'); return; }
    if (!armed) { // writing into the session: a second click confirms
      $('lrc-to-luna').textContent = `Click again to add ${doc.lines.length} lines`;
      armed = setTimeout(() => { armed = null; $('lrc-to-luna').textContent = 'Add to LUNA lyrics'; }, 3000);
      return;
    }
    clearTimeout(armed); armed = null;
    $('lrc-to-luna').textContent = 'Add to LUNA lyrics';
    try {
      const lines = doc.lines.map((l) => ({ text: l.text, start: l.a.start, end: l.a.end, words: (l.words ?? []).filter((w) => w.a !== undefined).map((w) => ({ text: w.text, start: w.a, end: w.end ?? w.a })) }));
      const n = await AddOnLyrics.write(session, luna.raw, doc.sourceUid, lines);
      doc.writable = false;
      doc.inLuna = true;
      renderDoc();
      flashButton($('lrc-to-luna'), '✓ Added');
      say(`Added ${n} lines to LUNA's lyrics. They belong to the audio file, so they move with its clips.`, 'ok');
    } catch (e) { sayError(e, 'Could not add the lyrics: '); }
  };
}

// ---------- results list: Clear; History overlay ----------

$('results-clear').onclick = clearResults;
/** Clear this tab's list only; other tabs and History keep theirs. */
function clearResults() {
  const mine = new Set(tabGroups());
  if (!mine.size) return;
  for (let i = groups.length - 1; i >= 0; i--) if (mine.has(groups[i])) groups.splice(i, 1);
  if (playingKey && !playingKey.startsWith('voice:')) player.pause();
  renderResults();
  say(history ? 'Cleared this tab\'s list. Everything is still in History.' : 'Cleared this tab\'s list.', 'ok');
}

function closeOverlays() { for (const o of document.querySelectorAll('.overlay')) o.classList.remove('open'); }
const overlayOpen = () => !!document.querySelector('.overlay.open');

const KIND_LABEL = { tts: 'Speech', script: 'Script', sfx: 'SFX', music: 'Music', vc: 'Voice changer' };
function renderHistory() {
  const box = $('history-list');
  box.innerHTML = '';
  if (!history) { box.innerHTML = '<p class="hint">Open a session in LUNA: History is kept with each session.</p>'; $('history-count').textContent = ''; return; }
  const entries = history.list();
  $('history-count').textContent = `${entries.length} in this session`;
  if (!entries.length) { box.innerHTML = '<p class="hint">Nothing generated in this session yet.</p>'; return; }
  for (const e of entries) {
    const el = document.createElement('div');
    el.className = 'hist';
    const when = new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<div class="top"><button class="play" title="Play">▶</button><span class="tag ${esc(e.kind)}">${esc(KIND_LABEL[e.kind] ?? e.kind)}</span><b>${esc(e.name)}</b></div>
      <div class="prompt">${esc(e.prompt)}</div>
      <div class="meta">${esc(when)} · ${Number(e.seconds || 0).toFixed(1)} s${e.target ? ` · made for ${esc(L.targetText(e.target))}` : ''}${e.placed ? ` · placed ${esc(e.placed)}` : ''}</div>
      <div class="actions"></div>`;
    const play = el.querySelector('.play');
    play.dataset.play = `hist:${e.id}`;
    play.onclick = () => togglePlay(`hist:${e.id}`, () => entryUrl(e));
    const actions = el.querySelector('.actions');
    const item = { ...e, name: e.name };
    const g = { target: e.target, sessionUid: session?.uid };
    actions.append(
      btn('Place at playhead', () => placeOne(g, item, 'playhead'), 'Put this audio at the playhead now, on the track chosen at the bottom of the window.', { busy: 'Placing…', ok: '✓ Placed' }),
      ...(e.target ? [btn(`Place at ${e.target.where || 'original spot'}`, () => placeOne(g, item, 'target'), `Put it where it was meant to go when generated: ${L.targetText(e.target)}.`, { busy: 'Placing…', ok: '✓ Placed' })] : []),
      ...(e.settings ? [btn('Reuse settings', () => reuse(e), 'Open its tab with the prompt and settings that made it, ready to tweak and generate again.', { ok: '✓ Loaded' })] : []),
      btn('Remove', async () => { await history.remove(e.id).catch(sayError); renderHistory(); }, 'Remove this entry from History. Only the entry goes: its audio stays in the session\'s audio files, placed or not.'),
    );
    box.appendChild(el);
  }
  paintPlayButtons();
}
async function toggleHistory() {
  const o = $('history');
  if (o.classList.contains('open')) { o.classList.remove('open'); return; }
  closeOverlays();
  if (history) await history.load().catch(() => {});
  renderHistory();
  o.classList.add('open');
}
$('history-open').onclick = toggleHistory;
$('history-close').onclick = () => $('history').classList.remove('open');
{
  let armed = null;
  $('history-clear').onclick = async () => {
    if (!history) return;
    if (!armed) {
      $('history-clear').textContent = 'Click again to clear';
      armed = setTimeout(() => { armed = null; $('history-clear').textContent = 'Clear history'; }, 3000);
      return;
    }
    clearTimeout(armed); armed = null;
    $('history-clear').textContent = 'Clear history';
    await history.clear().catch(sayError);
    renderHistory();
    flashButton($('history-clear'), '✓ Cleared');
    say('History cleared. Audio already placed stays on the timeline.', 'ok');
  };
}

// ---------- Help ----------

let helpSection = 'start';
let helpQuery = '';

/** Wrap the search terms in <mark> inside the shown section, and scroll to the first one. */
function markHelpContent(root, query) {
  const ts = AddOnHelp.terms(query);
  if (!ts.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const folded = AddOnHelp.fold(text);
    const spans = [];
    for (const t of ts) for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
    if (!spans.length) continue;
    spans.sort((x, y) => x[0] - y[0]);
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [a, b] of spans) {
      if (a < pos) continue;
      frag.append(text.slice(pos, a));
      const m = document.createElement('mark');
      m.textContent = text.slice(a, b);
      frag.append(m);
      pos = b;
    }
    frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
  root.querySelector('mark')?.scrollIntoView({ block: 'center' });
}

function renderHelp() {
  const results = helpQuery ? AddOnHelp.search(helpQuery) : null;
  const counts = new Map((results ?? []).map((r) => [r.id, r.score]));
  const nav = $('help-nav');
  nav.innerHTML = '';
  for (const s of AddOnHelp.SECTIONS) {
    const b = document.createElement('button');
    b.textContent = s.title;
    b.title = `Open “${s.title}”`;
    if (results && counts.has(s.id)) { const c = document.createElement('span'); c.className = 'count'; c.textContent = '●'; b.append(c); }
    b.classList.toggle('active', s.id === helpSection && !results);
    b.onclick = () => { helpSection = s.id; showHelpSection(); };
    nav.appendChild(b);
  }
  const content = $('help-content');
  if (!results) {
    content.innerHTML = AddOnHelp.sectionHtml(helpSection);
    content.scrollTop = 0;
    return;
  }
  content.innerHTML = '';
  const head = document.createElement('h2');
  head.textContent = results.length ? `${results.length} section${results.length === 1 ? '' : 's'} for “${helpQuery}”` : `Nothing found for “${helpQuery}”`;
  content.append(head);
  if (!results.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Try fewer or different words, such as “lyrics”, “playlists” or “undo”.';
    content.append(p);
  }
  for (const r of results) {
    const hit = document.createElement('button');
    hit.className = 'help-hit';
    hit.title = `Open “${r.title}” with your words marked`;
    hit.innerHTML = `<b></b>${r.snippets.map((sn) => `<span>${sn}</span>`).join('')}`;
    hit.querySelector('b').textContent = r.title;
    hit.onclick = () => { helpSection = r.id; showHelpSection(); };
    content.append(hit);
  }
  content.scrollTop = 0;
}

/** One section, with the search terms (if any) marked. */
function showHelpSection() {
  const content = $('help-content');
  for (const b of $('help-nav').querySelectorAll('button')) b.classList.toggle('active', b.firstChild.textContent === AddOnHelp.SECTIONS.find((s) => s.id === helpSection)?.title);
  content.innerHTML = AddOnHelp.sectionHtml(helpSection);
  content.scrollTop = 0;
  if (helpQuery) markHelpContent(content, helpQuery);
}

$('help-search').addEventListener('input', () => { helpQuery = $('help-search').value.trim(); renderHelp(); });
$('help-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const first = $('help-content').querySelector('.help-hit'); if (first) { e.preventDefault(); first.click(); } }
  if (e.key === 'ArrowDown') { const first = $('help-content').querySelector('.help-hit'); if (first) { e.preventDefault(); first.focus(); } }
});

function toggleHelp(section) {
  const o = $('help');
  if (o.classList.contains('open') && !section) { o.classList.remove('open'); return; }
  closeOverlays();
  helpSection = section ?? (['tts', 'sfx', 'music', 'vc', 'ivc', 'lyrics'].includes(activeTab) ? activeTab : 'start');
  $('help-search').value = '';
  helpQuery = '';
  renderHelp();
  o.classList.add('open');
}
$('help-open').onclick = () => toggleHelp();

// ---------- Support: an optional tip on the maker's monobank Base page ----------

// The maker's monobank Base page (base.monobank.ua; international cards accepted). If it is ever
// emptied, the button says the page is coming soon instead of opening anything.
const SUPPORT_URL = 'https://base.monobank.ua/CxcJKeRQip99nf';
function openSupport() {
  if (!SUPPORT_URL) { say('Support page coming soon: it is not set up yet. Thanks for the thought!'); return; }
  say('Opening the support page in your web browser. Thank you!', 'ok');
  openUrl(SUPPORT_URL);
}
$('support-open').onclick = openSupport;

// ---------- Look: Studio or Vintage, and Vintage's finish ----------

const LOOKS = [['studio', 'cream'], ['vintage', 'cream'], ['vintage', 'black']];
function lookName({ skin, finish }) { return skin === 'vintage' ? `Vintage, ${finish === 'black' ? 'Black' : 'Cream'}` : 'Studio'; }
function renderLook() {
  const { skin, finish } = applySkin(prefs.skin, prefs.finish);
  for (const r of document.querySelectorAll('#pop-look input[name=skin]')) r.checked = r.value === skin;
  for (const r of document.querySelectorAll('#pop-look input[name=finish]')) { r.checked = r.value === finish; r.disabled = skin !== 'vintage'; }
}
function setLook(skin, finish) {
  prefs = { ...prefs, skin, finish };
  remember();
  renderLook();
  say(`Look: ${lookName(applySkin(skin, finish))}`);
}
for (const r of document.querySelectorAll('#pop-look input[name=skin]')) r.onchange = () => setLook(r.value, prefs.finish);
for (const r of document.querySelectorAll('#pop-look input[name=finish]')) r.onchange = () => setLook('vintage', r.value);
function nextLook() {
  const cur = applySkin(prefs.skin, prefs.finish);
  const i = LOOKS.findIndex(([s, f]) => s === cur.skin && (s === 'studio' || f === cur.finish));
  const [skin, finish] = LOOKS[(i + 1) % LOOKS.length];
  setLook(skin, skin === 'studio' ? cur.finish : finish);
}
renderLook();
$('help-close').onclick = () => $('help').classList.remove('open');
/** Add a button's shortcut to its tooltip, so hovering also teaches the key. */
function withShortcut(el, action) {
  const sc = AddOnHelp.SHORTCUTS.find((s) => s.action === action);
  if (el && sc && !el.title.includes(`(${AddOnHelp.keyLabel(sc)})`)) el.title = `${el.title ? `${el.title} ` : ''}(${AddOnHelp.keyLabel(sc)})`;
}
for (const b of document.querySelectorAll('#tabs button')) withShortcut(b, `tab:${b.dataset.tab}`);
for (const [id, action] of Object.entries({
  'tts-go': 'generate', 'sfx-go': 'generate', 'music-go': 'generate', 'vc-go': 'generate', 'ivc-go': 'generate',
  'vc-every': 'every-clip', 'vc-clip': 'use-clip', 'ivc-clip': 'use-clip', 'tts-import-lyrics': 'import-lyrics',
  'tts-import-text': 'import-text', 'ly-find': 'find-lyrics', 'lrc-copy': 'copy-lyrics', 'key-paste': 'paste-key',
  'results-clear': 'clear', 'history-open': 'history', 'help-open': 'help', 'look-open': 'look', 'history-close': 'cancel', 'help-close': 'cancel',
  'sfx-sel-len': 'selection-length', 'music-sel-len': 'selection-length',
})) withShortcut($(id), action);

// ---------- popovers: voice, settings, destination ----------

let openPopId = null;
function openPop(id, anchor) {
  closePop();
  const pop = $(id);
  anchor = anchor ?? document.querySelector(`[data-pop="${id}"]`);
  pop.hidden = false;
  pop.style.visibility = 'hidden';
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = '';
  openPopId = id;
  anchor.setAttribute('aria-expanded', 'true');
  if (pop.querySelector('.voice-select')) pop.querySelector('.voice-select').focus();
}
/** Close the open popover; false when none was open. */
function closePop() {
  if (!openPopId) return false;
  $(openPopId).hidden = true;
  document.querySelector(`[data-pop="${openPopId}"]`)?.setAttribute('aria-expanded', 'false');
  openPopId = null;
  return true;
}
for (const b of document.querySelectorAll('[data-pop]')) {
  b.setAttribute('aria-haspopup', 'true');
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', () => (openPopId === b.dataset.pop ? closePop() : openPop(b.dataset.pop, b)));
}
document.addEventListener('mousedown', (e) => { if (openPopId && !e.target.closest('.pop, [data-pop]')) closePop(); });
document.querySelector('main').addEventListener('scroll', closePop);
window.addEventListener('resize', closePop);
// In a voice list, a double click or Return picks the voice and closes the list.
for (const sel of document.querySelectorAll('.pop .voice-select')) {
  sel.addEventListener('dblclick', closePop);
  sel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); closePop(); } });
}

// ---------- keyboard shortcuts ----------

function latestItem() { const g = tabGroups()[0]; return g?.items[0] ? { g, item: g.items[0] } : null; }
function bumpVariations(d) {
  const sel = document.querySelector(`#tab-${activeTab} .variations`);
  if (!sel || sel.disabled) return;
  setField(sel, String(Math.max(1, Math.min(4, Number(sel.value) + d))));
  say(`Variations: ${sel.value}`);
}

const ACTIONS = {
  generate: () => GENERATE[activeTab]?.(),
  cancel: () => {
    // Esc in a Help search with text clears it first; the next Esc closes Help.
    if (document.activeElement === $('help-search') && $('help-search').value) { $('help-search').value = ''; helpQuery = ''; renderHelp(); return; }
    if (closePop()) return;
    if (overlayOpen()) { closeOverlays(); return; } if (!cancelNewest()) document.activeElement?.blur?.(); },
  'variations-up': () => bumpVariations(1),
  'variations-down': () => bumpVariations(-1),
  'tab-prev': () => showTab(TABS[(TABS.indexOf(activeTab) + TABS.length - 1) % TABS.length]),
  'tab-next': () => showTab(TABS[(TABS.indexOf(activeTab) + 1) % TABS.length]),
  'use-clip': () => (activeTab === 'ivc' ? $('ivc-clip') : (showTab('vc'), $('vc-clip'))).click(),
  'every-clip': () => { showTab('vc'); generateVcEvery(); },
  'clear-vc': () => { showTab('vc'); clearVcFile(); },
  'import-lyrics': () => importLyrics(),
  'import-text': () => { showTab('tts'); $('tts-file').click(); },
  'find-lyrics': () => { showTab('lyrics'); $('ly-find').click(); },
  'copy-lyrics': () => { if (!doc) { say('Find or transcribe lyrics first.'); return; } showTab('lyrics'); $('lrc-copy').click(); },
  'lyrics-view': () => { if (!doc) { say('Find or transcribe lyrics first.'); return; } $('ly-view').querySelector(`button[data-view="${docView === 'lrc' ? 'text' : 'lrc'}"]`).click(); },
  'load-from-clip': loadFromClip,
  'selection-length': () => {
    if (activeTab !== 'music') showTab('sfx');
    $(activeTab === 'music' ? 'music-sel-len' : 'sfx-sel-len').click();
  },
  'toggle-dest': () => { const other = destMode() === 'new' ? 'selected' : 'new'; document.querySelector(`input[name=dest][value=${other}]`).checked = true; remember(); renderDestination(); say(other === 'new' ? 'Destination: a new track' : 'Destination: the selected track'); },
  'toggle-auto': () => { setField($('auto-place'), !$('auto-place').checked); say(`Place automatically: ${$('auto-place').checked ? 'on' : 'off'}`); },
  'preview-latest': () => { const l = latestItem(); if (l) togglePlay(l.item.id, l.item.url); },
  'place-latest': () => { const l = latestItem(); if (l && l.g.layout === 'single') placeOne(l.g, l.item, 'playhead'); },
  clear: clearResults,
  history: toggleHistory,
  'voice-search': () => {
    if (!document.querySelector(`#tab-${activeTab} .voice-search`)) showTab('tts');
    const chip = document.querySelector(`#tab-${activeTab} [data-voice-chip]`);
    // Vintage hides the chip and opens the list from the screen's head instead.
    const anchor = [...document.querySelectorAll(`#tab-${activeTab} [data-pop="${chip.dataset.pop}"]`)].find((e) => e.offsetParent) ?? chip;
    openPop(chip.dataset.pop, anchor);
    const s = $(chip.dataset.pop).querySelector('.voice-search');
    s.focus(); s.select();
  },
  'paste-key': pasteKey,
  help: () => toggleHelp(),
  look: nextLook,
  'search-help': () => {
    if (!$('help').classList.contains('open')) toggleHelp();
    $('help-search').focus();
    $('help-search').select();
  },
};

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  const s = AddOnHelp.match(e);
  if (!s) return;
  const t = e.target;
  const inField = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (inField && !s.field) return;
  if (s.action.startsWith('tab:')) { e.preventDefault(); showTab(s.action.slice(4)); return; }
  const fn = ACTIONS[s.action];
  if (!fn) return;
  e.preventDefault();
  fn();
}, true);

// ---------- LUNA connection ----------

/**
 * The header's session indicator: which LUNA session results go to, and the connection.
 * state: 'connected' (green), 'waiting' (yellow: connecting, reconnecting), 'none' (grey), 'error' (red).
 */
function setSession(state, text, name) {
  const el = $('session');
  el.dataset.state = state;
  const t = $('session-text');
  t.textContent = text;
  if (name) { const b = document.createElement('b'); b.textContent = name; t.append(b); }
  el.title = {
    connected: `Connected to LUNA. Generated audio goes into the session "${name}", and History shows this session's generations.`,
    waiting: 'Waiting for LUNA: generation still works, placing on the timeline resumes when LUNA answers.',
    none: 'No session is open in LUNA: results can be previewed, but placing them needs a session.',
    error: 'The Add On cannot reach LUNA.',
  }[state];
}
const showSession = () => (session ? setSession('connected', 'Session: ', session.name.value ?? session.uid) : setSession('none', 'No session open'));

async function bindSession() {
  releaseAll(sessionReleases);
  const prev = session;
  session = luna.sessions.current();
  history = null;
  if (session) {
    await session.ready();
    showSession();
    sessionReleases.push(session.name.onChange(showSession));
    history = L.history(session, STORE_ID);
    history.load().then(() => { if ($('history').classList.contains('open')) renderHistory(); }).catch(() => {});
    sessionReleases.push(session.focusedTrack.onChange(renderDestination));
    sessionReleases.push(history.onChange(() => { if ($('history').classList.contains('open')) renderHistory(); }));
  } else {
    showSession();
  }
  if (prev !== session) renderResults();
  renderDestination();
}

async function connect() {
  restorePrefs();
  showTab(TABS.includes(prefs.tab) ? prefs.tab : 'tts');
  $('tts-script-box').classList.toggle('script-on', $('tts-script').checked);
  $('tts-variations').disabled = $('tts-script').checked;
  lyricsLayoutUi();
  renderResults();
  for (;;) {
    try {
      luna = await Luna.connect(); // inside LUNA the page URL carries ?port=
      break;
    } catch (e) {
      if (e instanceof Luna.NotRunning) setSession('waiting', 'Waiting for LUNA…');
      else setSession('error', `LUNA: ${errorText(e)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna); // LUNA's undo, redo, play and record keys outside text fields
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') setSession('waiting', 'Reconnecting to LUNA…');
    else showSession();
  });
  await bindSession();
  await loadStoredKey();
}

// ---------- button feedback ----------

/** Every click on a button presses it in for a moment, so a click always shows. */
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button');
  if (!b || b.disabled) return;
  b.classList.remove('pressed');
  void b.offsetWidth;
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 220);
}, true);

/**
 * Show a button's outcome on the button: `busy` while its work runs, then `ok` (text, or a
 * function of what the handler returned) in green, or "Failed" in red when the click put an
 * error in the status line. A handler that turns the button into "Click again…" (a two-click
 * confirmation) is left alone.
 */
function withFeedback(b, { busy, ok = '✓ Done' } = {}) {
  if (!b || b._feedback) return;
  b._feedback = true;
  const run = b.onclick;
  b.onclick = async (e) => {
    const before = statusSeq;
    const label = b.dataset.label ?? b.textContent;
    if (busy && b.classList.contains('icon')) {
      // icon buttons spin their icon instead of showing the busy text (it would spill over the header)
      clearTimeout(b._flash);
      if (b._html !== undefined) { b.innerHTML = b._html; delete b._html; }
      b.classList.remove('flash-ok', 'flash-error');
      b.classList.add('busy');
    } else if (busy) { clearTimeout(b._flash); if (!b.dataset.label) b.dataset.label = label; b.textContent = busy; b.classList.add('busy'); }
    let result;
    let threw = false;
    try { result = await run.call(b, e); } catch (err) { threw = true; sayError(err); }
    b.classList.remove('busy');
    if (!busy && b.textContent !== label && !b.dataset.label) return; // it changed its own label (two-click confirm)
    const failed = threw || (statusSeq !== before && lastStatusKind === 'error');
    flashButton(b, failed ? 'Failed' : (typeof ok === 'function' ? ok(result) : ok), failed ? 'error' : 'ok');
  };
}

for (const [id, fb] of Object.entries({
  'voices-refresh-1': { busy: 'Refreshing…', ok: () => `✓ ${voices.length} voices` },
  'voices-refresh-2': { busy: 'Refreshing…', ok: () => `✓ ${voices.length} voices` },
  'tts-go': { ok: '✓ Started' }, 'sfx-go': { ok: '✓ Started' }, 'music-go': { ok: '✓ Started' },
  'vc-go': { ok: '✓ Started' }, 'vc-every': { busy: 'Reading…', ok: '✓ Started' }, 'ivc-go': { ok: '✓ Started' },
  'tts-import-lyrics': { busy: 'Importing…', ok: '✓ Imported' },
  'sfx-sel-len': { ok: '✓ Set' }, 'music-sel-len': { ok: '✓ Set' }, 'music-context': { busy: 'Reading…', ok: '✓ Added' },
  'vc-clip': { busy: 'Reading…', ok: '✓ Taken' }, 'ivc-clip': { busy: 'Reading…', ok: '✓ Added' }, 'ivc-clear': { ok: '✓ Cleared' },
  'ly-find': { busy: 'Finding…', ok: '✓ Found' }, 'ly-transcribe': { ok: '✓ Started' }, 'ly-to-tts': { ok: '✓ Sent' },
  'key-paste': { busy: 'Checking…', ok: '✓ Saved' }, 'key-save': { busy: 'Checking…', ok: '✓ Saved' },
  'key-delete': { ok: '✓ Forgotten' }, 'key-open': { ok: '✓ Opened' },
  'results-clear': { ok: '✓ Cleared' }, 'load-from-clip': { busy: 'Loading…', ok: '✓ Loaded' },
})) withFeedback($(id), fb);

connect();
