// Voice & Sound Unit: the Vintage look's own panel, laid out as design E (a hardware unit).
// A classic script loaded after main.js. It owns no settings and makes no requests: every key,
// knob and switch drives a control of the Studio page (same ids), and the page's own elements
// (text fields, drop zones, results, status) are moved into the panel while Vintage is on and
// moved back for Studio. So remembered settings, History, shortcuts and Help stay one.
(() => {
  const $ = (id) => document.getElementById(id);
  const unit = $('unit');
  if (!unit) return;

  // ---------- parts that move between the Studio page and the panel ----------

  const docked = new Set();
  /** Move `el` into `slot`, leaving a marker where it lived. */
  function dock(el, slot) {
    if (!el) return;
    if (!el.__home) { el.__home = document.createComment(`home of ${el.id || el.className}`); el.before(el.__home); }
    slot.append(el);
    docked.add(el);
  }
  /** Put every moved part back where it lived. */
  function undockAll() {
    for (const el of docked) {
      el.__home.after(el);
      if (el.classList.contains('pop')) { el.classList.remove('docked'); el.hidden = true; }
    }
    docked.clear();
  }

  // ---------- small builders ----------

  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const press = (id) => () => $(id)?.click();
  const clearField = (id) => () => { setField($(id), ''); say('Screen cleared.'); };
  const label = (sel) => sel?.selectedOptions[0]?.textContent.trim() || '—';
  const vintage = () => document.documentElement.dataset.skin === 'vintage';

  /** A knob over a range or number input, or over a select (one step per option). */
  function knob(id, name, opt = {}) {
    const input = $(id);
    const isSel = input.tagName === 'SELECT';
    const el = h('div', 'u-knob');
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', name);
    el.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ring" cx="32" cy="32" r="29"/><circle class="cap" cx="32" cy="32" r="22"/><line class="ptr" x1="32" y1="32" x2="32" y2="13"/></svg>';
    el.append(h('span', 'name', name), h('span', 'val'));
    // The knob's own scale: indexes for a select; for "auto" fields one step below the minimum is auto.
    const min = isSel ? 0 : Number(input.min) - (opt.auto ? Number(input.step) : 0);
    const max = isSel ? input.options.length - 1 : Number(input.max);
    const step = isSel ? 1 : Number(input.step) || 0.01;
    const read = () => {
      if (isSel) return input.selectedIndex;
      if (opt.auto && input.value === '') return min;
      return Number(input.value);
    };
    const show = (v) => {
      if (isSel) return (opt.names?.[input.options[v]?.value] ?? input.options[v]?.textContent ?? '').toUpperCase();
      if (opt.auto && v <= min) return 'AUTO';
      return `${v.toFixed(opt.dp ?? 2)}${opt.suffix ?? ''}`;
    };
    const write = (v, commit) => {
      v = Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(4));
      if (v !== read()) {
        if (isSel) input.selectedIndex = v;
        else input.value = opt.auto && v <= min ? '' : String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (commit) input.dispatchEvent(new Event('change', { bubbles: true }));
      paint();
    };
    const paint = () => {
      const v = read();
      el.querySelector('.ptr').setAttribute('transform', `rotate(${-135 + 270 * ((v - min) / (max - min || 1))} 32 32)`);
      el.querySelector('.val').textContent = show(v);
      el.setAttribute('aria-valuetext', show(v));
    };
    const dflt = isSel ? [...input.options].findIndex((o) => o.defaultSelected) : (input.defaultValue === '' && opt.auto ? min : Number(input.defaultValue));
    el.title = `${opt.tip ?? name}. Drag up or down (Shift: finer), scroll, or use the arrow keys; double-click resets to ${show(Math.max(0, dflt))}.`;
    let drag = null;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); drag = { y: e.clientY, v: read() }; el.focus(); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (drag) write(drag.v + ((drag.y - e.clientY) / (isSel ? 40 : 150)) * (isSel ? 1 : (max - min)) * (e.shiftKey ? 0.2 : 1)); });
    const end = () => { if (drag) { drag = null; write(read(), true); } };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    const notch = isSel ? 1 : Math.max(step, Math.round((max - min) / 20 / step) * step);
    el.addEventListener('wheel', (e) => { e.preventDefault(); write(read() - Math.sign(e.deltaY) * notch, true); }, { passive: false });
    el.addEventListener('dblclick', () => write(Math.max(0, dflt), true));
    el.addEventListener('keydown', (e) => {
      const v = read();
      const to = { ArrowUp: v + step, ArrowRight: v + step, ArrowDown: v - step, ArrowLeft: v - step, PageUp: v + notch * 2, PageDown: v - notch * 2, Home: min, End: max }[e.key];
      if (to === undefined || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      write(to, true);
    });
    input.addEventListener('input', paint);
    input.addEventListener('change', paint);
    paint();
    el.paint = paint;
    return el;
  }

  /** A flat slide switch (left off, right on) over a checkbox, or over get/set functions. */
  function toggle(name, src) {
    const get = typeof src === 'string' ? () => $(src).checked : src.get;
    const flip = typeof src === 'string' ? () => $(src).click() : src.flip;
    const el = h('button', 'u-switch');
    el.type = 'button';
    el.setAttribute('role', 'switch');
    el.innerHTML = '<span class="legend"><i>OFF</i><i>ON</i></span><span class="slot"><span class="thumb"></span></span>';
    el.append(h('span', 'name', name));
    el.title = `${(typeof src === 'string' && $(src).closest('label')?.title) || name}. Left is off, right is on.`;
    const paint = () => { const on = !!get(); el.classList.toggle('on', on); el.setAttribute('aria-checked', on); el.disabled = typeof src === 'string' && $(src).disabled; };
    // The thumb slides first; a moment later the setting changes, and whatever it shows or hides on the
    // panel (Lines' options, say) grows or shrinks smoothly instead of jumping.
    let busy = false;
    el.addEventListener('click', () => {
      if (busy || el.disabled) return;
      busy = true;
      const on = !get();
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on);
      setTimeout(() => { easeLayout(() => { flip(); paint(); }); busy = false; }, 160);
    });
    if (typeof src === 'string') $(src).addEventListener('change', paint);
    paint();
    el.paint = paint;
    return el;
  }

  /** Run `change`, then fade in what it showed on the screen (heights are eased by smoothHeights). */
  function easeLayout(change) {
    const shown = new Set([...q('.u-body').children].filter((e) => e.offsetParent));
    change();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of q('.u-body').children) {
      if (el.offsetParent && !shown.has(el)) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
  }

  /**
   * Whatever changes a part's height (a switch, a mode, a screen, results arriving), the part grows or
   * shrinks over a quarter second instead of jumping: a ResizeObserver remembers each part's last
   * height and animates from it to the new one, before the new layout is painted.
   */
  function smoothHeights(parts) {
    if (!window.ResizeObserver || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The height a part's content wants, from where its children end: while it eases, the part itself has
    // a fixed height, but its children (which never shrink) keep their natural layout.
    const natural = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      let bottom = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
      for (const c of el.children) {
        const cr = c.getBoundingClientRect();
        if (!cr.height && !cr.width) continue;
        bottom = Math.max(bottom, cr.bottom + (parseFloat(getComputedStyle(c).marginBottom) || 0));
      }
      return bottom - r.top + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
    };
    const state = new Map(); // el -> { at: last natural height, anim, to }
    const ro = new ResizeObserver((entries) => {
      for (const { target: el } of entries) {
        const st = state.get(el) ?? {};
        const want = natural(el);
        if (st.at === undefined) { state.set(el, { at: want }); continue; }
        const goal = st.anim ? st.to : st.at;
        if (Math.abs(want - goal) < 2 || unit.hidden) { if (!st.anim) st.at = want; continue; }
        const from = el.getBoundingClientRect().height; // where it is now, mid-animation or not
        st.anim?.cancel();
        const anim = el.animate([{ height: `${st.anim ? from : st.at}px`, overflow: 'hidden' }, { height: `${want}px`, overflow: 'hidden' }], { duration: 260, easing: 'cubic-bezier(.2, .7, .3, 1)' });
        const next = { at: want, anim, to: want };
        anim.onfinish = () => { next.anim = null; next.at = natural(el); };
        state.set(el, next);
      }
    });
    for (const p of parts) ro.observe(p);
  }

  /** A soft key: presses an existing button (and shows its feedback), or runs a function. */
  function softKey(text, run, opts = {}) {
    const b = h('button', 'u-soft', text);
    b.type = 'button';
    const target = typeof run === 'string' ? $(run) : null;
    if (target) {
      const rest = target.textContent.trim();
      b.addEventListener('click', () => target.click());
      b.paint = () => {
        const now = target.textContent.trim();
        b.textContent = now && now !== rest ? now : text;
        b.title = target.title || text;
        b.disabled = target.disabled;
      };
    } else {
      b.addEventListener('click', run);
      b.title = opts.title ?? text;
      b.paint = () => { if (opts.on) b.classList.toggle('on', !!opts.on()); };
    }
    b.paint();
    return b;
  }

  // ---------- the six modes (the Studio tabs) ----------

  const voiceMine = { tts: false, vc: false }; // "MY VOICES" filter per voice list
  const MODES = {
    tts: {
      label: 'Speech', go: 'tts-go', goLabel: 'Generate', takes: 'tts-variations',
      head: { voice: 'tts-voice', prefix: 'Voice', model: 'tts-model' },
      body: () => [$('tts-text'), $('tts-script-box')], left: () => $('tts-count').textContent,
      knobs: () => [knob('tts-stability', 'Stability', { tip: 'Stability: lower is more expressive, higher is steadier' }),
        knob('tts-similarity', 'Similarity', { tip: 'Similarity: how close the voice stays to the original' }),
        knob('tts-style', 'Style', { tip: "Style: exaggerates the speaker's style" }),
        knob('tts-speed', 'Speed', { suffix: '×', tip: 'Speed: 0.7× to 1.2×' }), toggle('Lines', 'tts-script')],
      keys: () => [softKey('Voice', () => show('voices')), softKey('Model', nextModel('tts-model')), softKey('Import text', 'tts-import-text'),
        softKey('Clear', clearField('tts-text')), softKey('Import lyrics', 'tts-import-lyrics'), softKey('From clip', 'load-from-clip')],
    },
    sfx: {
      label: 'SFX', go: 'sfx-go', goLabel: 'Generate', takes: 'sfx-variations',
      head: { text: 'Sound effect ▸ prompt', model: 'sfx-model' },
      body: () => [$('sfx-text')], left: () => '',
      knobs: () => [knob('sfx-duration', 'Duration', { auto: true, dp: 1, suffix: ' s', tip: 'Duration: auto, or 0.5 to 30 seconds' }),
        knob('sfx-influence', 'Influence', { tip: 'Prompt influence: higher follows the words more literally' }), toggle('Loop', 'sfx-loop')],
      keys: () => [softKey('Len = sel', 'sfx-sel-len'), softKey('From clip', 'load-from-clip'), softKey('Clear', clearField('sfx-text'))],
    },
    music: {
      label: 'Music', go: 'music-go', goLabel: 'Compose', takes: 'music-variations',
      head: { text: 'Music ▸ prompt', model: 'music-model' },
      body: () => [$('music-text')], left: () => '',
      knobs: () => [knob('music-length', 'Length', { dp: 0, suffix: ' s', tip: 'Length: 3 seconds to 10 minutes' }), toggle('Instrumental', 'music-instrumental')],
      keys: () => [softKey('Tempo & key', 'music-context'), softKey('Len = sel', 'music-sel-len'), softKey('From clip', 'load-from-clip'), softKey('Clear', clearField('music-text'))],
    },
    vc: {
      label: 'Changer', go: 'vc-go', goLabel: 'Change',
      head: { voice: 'vc-voice', prefix: 'To voice', model: 'vc-model' },
      body: () => [$('vc-drop')], left: () => '',
      knobs: () => [knob('vc-stability', 'Stability'), knob('vc-similarity', 'Similarity'), knob('vc-style', 'Style'), toggle('Denoise', 'vc-denoise')],
      keys: () => [softKey('Voice', () => show('voices')), softKey('Model', nextModel('vc-model')), softKey('Read sel', 'vc-clip'),
        softKey('From file', () => $('vc-input').click()), softKey('Every clip', 'vc-every'), softKey('Clear', () => { clearVcFile(); say('Recording cleared.'); })],
    },
    ivc: {
      label: 'Clone', go: 'ivc-go', goLabel: 'Create',
      head: { text: () => `New voice ▸ ${$('ivc-name').value.trim() || 'name it below'}`, right: 'Instant clone' },
      body: () => [$('ivc-plan'), $('ivc-name'), $('ivc-desc'), $('ivc-drop')], left: () => `${ivcFiles.length} sample${ivcFiles.length === 1 ? '' : 's'}`,
      knobs: () => [toggle('Denoise', 'ivc-denoise'), toggle('Consent', 'ivc-consent')],
      keys: () => [softKey('+ Sample', 'ivc-clip'), softKey('From file', () => $('ivc-input').click()),
        softKey('− Sample', () => { ivcFiles = ivcFiles.slice(0, -1); renderIvcFiles(); say(ivcFiles.length ? 'Removed the last sample.' : 'No samples left.'); }), softKey('Clear', 'ivc-clear')],
      tape: () => [h('div', 'u-tape-note', 'Your cloned voices'), $('ivc-list')],
    },
    lyrics: {
      label: 'Lyrics', go: 'ly-to-tts', goLabel: 'Re-voice',
      head: { voice: 'tts-voice', prefix: 'Re-voice as', model: 'tts-model' },
      body: () => [document.querySelector('#tab-lyrics .ly-title'), $('lrc-text'), $('ly-warn'), document.querySelector('#tab-lyrics .lrc-opts')], left: () => '',
      knobs: () => [knob('tts-fit', 'Timing', { names: { start: 'Line start', fit: 'Fit line', words: 'Each word' }, tip: 'Timing of re-voiced lines: start of each line, fitted to its length, or each word' }),
        toggle('LRC view', { get: () => document.querySelector('#ly-view [data-view=lrc]')?.classList.contains('on'), flip: () => document.querySelector(`#ly-view [data-view=${document.querySelector('#ly-view [data-view=lrc]').classList.contains('on') ? 'text' : 'lrc'}]`).click() }),
        toggle('Word timing', 'lrc-words')],
      keys: () => [softKey('Find', 'ly-find'), softKey('Transcribe', 'ly-transcribe'), softKey('Copy', 'lrc-copy'), softKey('To LUNA', 'lrc-to-luna'), softKey('Voice', () => show('voices'))],
    },
  };
  const nextModel = (id) => (e) => {
    const sel = $(id);
    const n = sel.options.length;
    if (!n) { say('The models are not loaded yet: add your API key first.', 'error'); return; }
    setField(sel, sel.options[(sel.selectedIndex + (e?.shiftKey ? n - 1 : 1)) % n].value);
    say(`Model: ${label(sel)}`);
  };

  // ---------- the panel's frame ----------

  unit.innerHTML = `
    <div class="u-face">
      <div class="u-top"><span class="u-screw"></span>
        <span class="u-title"><span class="u-name">Voice &amp; Sound Unit</span><span class="u-maker">dawnchorus</span></span>
        <span class="u-grow"></span>
        <div class="u-right-top">
          <div class="u-status-row">
            <button type="button" class="u-online"><i></i><svg class="u-key" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="m16 7 3 3"/></svg><span></span></button>
            <button type="button" class="u-credits" title="Credits left on your ElevenLabs plan: click for the plan, Help and support"></button>
          </div>
          <div class="u-tools"><button type="button" class="u-finish" title="Look: Studio or Vintage, and Vintage's finish (⇧⌘E steps through them)"></button></div>
        </div>
        <span class="u-screw"></span></div>
      <div class="u-modes" role="tablist"></div>
      <div class="u-bezel">
        <div class="u-lcd">
          <div class="u-head"><span class="u-left"></span><span class="u-right"></span></div>
          <div class="u-body"></div>
          <div class="u-status"></div>
          <div class="u-foot"><span class="u-foot-left"></span><span class="u-dest"></span></div>
        </div>
        <div class="u-softkeys" role="group" aria-label="Screen keys"></div>
      </div>
      <div class="u-knobs"></div>
      <div class="u-go-row">
        <div class="u-sel">
          <div class="u-takes"><span class="u-lbl">Takes</span><div class="u-seg"></div></div>
          <div class="u-as"><span class="u-lbl">Takes as</span><div class="u-seg"></div></div>
          <div class="u-place"><span class="u-lbl">Place at</span><div class="u-seg"></div></div>
        </div>
        <span class="u-grow"></span>
        <button type="button" class="u-go"></button>
      </div>
      <div class="u-tape">
        <div class="u-tape-head"><span class="u-tape-title"></span><span class="u-grow"></span><button type="button" class="u-tape-clear">Clear</button><button type="button" class="u-tape-hist"></button></div>
        <div class="u-tape-body"></div>
      </div>
    </div>`;
  const q = (s) => unit.querySelector(s);
  smoothHeights([q('.u-bezel'), q('.u-knobs'), q('.u-sel')]);
  // a wider or narrower window fits more or fewer soft keys in the row
  if (window.ResizeObserver) {
    let lastFit = 0;
    new ResizeObserver(() => {
      const fit = Math.max(1, Math.floor((q('.u-softkeys').clientWidth + SOFT_GAP) / (SOFT_W + SOFT_GAP)));
      if (fit !== lastFit) { lastFit = fit; layoutSoft(); }
    }).observe(q('.u-bezel'));
  }

  // header tools: Studio's header buttons, as small keys (each presses the Studio button, so its
  // shortcut, tooltip and action stay the same)
  for (const id of ['load-from-clip', 'history-open', 'support-open', 'help-open']) {
    const src = $(id);
    if (!src) continue;
    const b = h('button', 'u-tool');
    b.type = 'button';
    b.innerHTML = src.innerHTML;
    b.title = src.title;
    b.setAttribute('aria-label', src.getAttribute('aria-label') ?? src.title);
    b.onclick = () => src.click();
    q('.u-tools').append(b);
  }

  // header
  q('.u-finish').onclick = (e) => (openPopId === 'pop-look' ? closePop() : openPop('pop-look', e.currentTarget));
  q('.u-online').onclick = () => (screenNow() === 'key' ? leaveKey() : show('key'));
  q('.u-credits').onclick = () => show(screen === 'plan' ? 'main' : 'plan');

  // mode keys
  for (const [tab, m] of Object.entries(MODES)) {
    const b = h('button', 'u-mode');
    b.type = 'button';
    b.dataset.tab = tab;
    b.setAttribute('role', 'tab');
    b.append(h('i'), h('span', '', m.label));
    b.title = document.querySelector(`#tabs button[data-tab="${tab}"]`)?.title ?? m.label;
    b.onclick = () => { screen = 'main'; showTab(tab); };
    q('.u-modes').append(b);
  }

  // takes and place at
  const takeKeys = [1, 2, 3, 4].map((n) => {
    const b = h('button', '', String(n));
    b.type = 'button';
    b.onclick = () => { const sel = $(MODES[activeTab]?.takes); if (sel && !sel.disabled) { setField(sel, String(n)); say(`${n} take${n > 1 ? 's' : ''} per Generate.`); } };
    q('.u-takes .u-seg').append(b);
    return b;
  });
  const placeKeys = [['playhead', 'Playhead'], ['selection', 'Selection'], ['marker', 'Markers']].map(([v, t]) => {
    const radio = document.querySelector(`input[name=at][value=${v}]`);
    const b = h('button', '', t);
    b.type = 'button';
    b.title = radio?.closest('label')?.title ?? t;
    b.onclick = () => { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); say(`New results go at the ${{ playhead: 'playhead', selection: 'selection start', marker: 'next marker' }[v]}.`); };
    q('.u-place .u-seg').append(b);
    return [b, radio];
  });

  // several takes land as playlists of one track, or as tracks of their own (the "Place all as" choice)
  const asKeys = [['playlists', 'Playlists', 'Several takes go on one track, one playlist each'], ['tracks', 'Tracks', 'Several takes go on tracks of their own']].map(([v, t, tip]) => {
    const b = h('button', '', t);
    b.type = 'button';
    b.title = `${tip} (when placed together, automatically or with Place all).`;
    b.onclick = () => { prefs.placeAs = v; remember(); renderResults(); say(`Several takes go as ${t.toLowerCase()}.`); paint(); };
    q('.u-as .u-seg').append(b);
    return [b, v];
  });

  // generate and tape
  q('.u-go').onclick = () => $(MODES[activeTab]?.go)?.click();
  q('.u-tape-clear').onclick = press('results-clear');
  q('.u-tape-hist').onclick = press('history-open');

  // ---------- screens: the text (main), the voice list, the API key, the plan ----------

  let screen = 'main';
  /** The screen shown: an open voice list or plan wins; on the API Key tab the key screen is the main one. */
  const screenNow = () => (screen !== 'main' ? screen : activeTab === 'key' ? 'key' : 'main');
  const leaveKey = () => { screen = 'main'; if (activeTab === 'key') showTab(prefs.lastMode ?? 'tts'); else { built = null; render(); } };
  let built = null; // what is drawn now: `${tab}|${screen}`
  let softKeys = [];   // this screen's soft keys
  let softOpen = false; // MORE ▸ has opened the second row
  const SOFT_W = 128, SOFT_GAP = 6; // a soft key's width: four fill the row at the 600 px window
  function layoutSoft() {
    const box = q('.u-softkeys');
    const fit = Math.max(1, Math.floor((box.clientWidth + SOFT_GAP) / (SOFT_W + SOFT_GAP)));
    const row = [];
    box.style.setProperty('--soft-cols', fit);
    if (softKeys.length <= fit) row.push(...softKeys);
    else {
      row.push(...softKeys.slice(0, fit - 1));
      const more = softKey(softOpen ? 'Less ▴' : 'More ▸', () => { softOpen = !softOpen; layoutSoft(); }, { title: softOpen ? 'Hide the second row of keys' : 'Show the rest of the keys for this mode in a row below' });
      more.classList.add('more');
      row.push(more);
      if (softOpen) row.push(...softKeys.slice(fit - 1));
    }
    box.replaceChildren(...row);
    box.dataset.fit = fit;
  }
  function show(s) { screen = s; built = null; softOpen = false; render(); }

  function headPart(spec, side) {
    const box = q(side === 'left' ? '.u-left' : '.u-right');
    box.innerHTML = '';
    if (!spec) return;
    if (typeof spec === 'string' || typeof spec === 'function') { box.append(h('span', 'u-dim', typeof spec === 'function' ? spec() : spec)); return; }
    const b = h('button', 'u-link', spec.text);
    b.type = 'button';
    b.title = spec.title ?? '';
    b.onclick = spec.run;
    box.append(b);
  }

  function voicePop(selId) { return $(selId === 'vc-voice' ? 'pop-vc-voice' : 'pop-tts-voice'); }

  /** Rebuild the parts that depend on the mode and screen. */
  function build() {
    const tab = MODES[activeTab] ? activeTab : 'tts';
    const m = MODES[tab];
    const scr = screenNow();
    built = `${activeTab}|${scr}`;
    undockAll();
    const body = q('.u-body');
    body.innerHTML = '';
    body.className = `u-body u-${scr} u-mode-${tab}`;
    const keys = q('.u-softkeys');
    keys.innerHTML = '';
    softOpen = false;
    let soft = [];

    if (scr === 'voices') {
      const sel = $(m.head.voice);
      const pop = voicePop(m.head.voice);
      pop.hidden = false;
      pop.classList.add('docked');
      dock(pop, body);
      const filter = (mine) => {
        voiceMine[sel.id] = mine;
        for (const g of sel.querySelectorAll('optgroup')) g.hidden = mine && g.label !== 'My voices';
      };
      filter(voiceMine[sel.id]);
      headPart(`Select voice ▸ ${label(sel)}`, 'left');
      headPart({ text: '◀ Back', run: () => show('main'), title: 'Back to the text' }, 'right');
      sel.onclick = sel.onkeydown = (e) => { if (e.type === 'click' || e.key === 'Enter') { say(`Voice: ${label(sel)}`); show('main'); } };
      soft = [softKey('All', () => { filter(false); render(); }, { on: () => !voiceMine[sel.id], title: 'Every voice' }),
        softKey('My voices', () => { filter(true); render(); }, { on: () => voiceMine[sel.id], title: 'Only the voices in your account (cloned, designed, library)' }),
        softKey('▶ Preview', () => pop.querySelector('.play')?.click(), { title: 'Play the selected voice\'s sample' }),
        softKey('↻ Refresh', () => pop.querySelector('[id^=voices-refresh]')?.click(), { title: 'Load your voices again from ElevenLabs' })];
    } else if (scr === 'key') {
      for (const el of [$('key-input'), $('key-note')]) dock(el, body);
      headPart('API key ▸ kept in your keychain', 'left');
      headPart({ text: '◀ Back', run: leaveKey }, 'right');
      soft = [softKey('Paste key', 'key-paste'), softKey('Save', 'key-save'), softKey('Forget key', 'key-delete'), softKey('Get a key ↗', 'key-open')];
    } else if (scr === 'plan') {
      body.append(h('div', 'u-plan-text'));
      headPart('Plan ▸ your ElevenLabs credits', 'left');
      headPart({ text: '◀ Back', run: () => show('main') }, 'right');
      soft = [softKey('See plans ↗', () => openUrl(PRICING_URL), { title: 'Open the ElevenLabs plans page in your web browser' }),
        softKey('↻ Update', async () => { await refreshQuota(); say('Credits updated.'); }, { title: 'Read the credits left again' }),
        softKey('Help', () => toggleHelp(), { title: 'Help and shortcuts' }), softKey('Support ☕', () => openSupport(), { title: $('support-open')?.title })];
    } else {
      for (const el of m.body()) dock(el, body);
      const hd = m.head;
      if (hd.voice) headPart({ text: `${hd.prefix} ▸ ${label($(hd.voice))} ▾`, run: () => show('voices'), title: 'Choose the voice: search, preview and pick' }, 'left');
      else headPart(hd.text, 'left');
      if (hd.model) headPart({ text: `${label($(hd.model))} ⇄`, run: nextModel(hd.model), title: 'Model: click for the next one, Shift-click for the previous one' }, 'right');
      else headPart(hd.right ?? '', 'right');
      soft = m.keys();
    }

    // soft keys: a fixed width each, as many in the row as fit; when there are more, the last place in
    // the row is MORE ▸, which opens the rest in a row below (and closes it again)
    softKeys = soft;
    layoutSoft();

    // knobs and switches
    const kn = q('.u-knobs');
    kn.innerHTML = '';
    const parts = m.knobs();
    kn.style.setProperty('--cols', Math.max(2, parts.length));
    kn.append(...parts);

    // status, destination, results
    dock($('status'), q('.u-status'));
    dock($('dest-chip'), q('.u-dest'));
    const tape = q('.u-tape-body');
    tape.innerHTML = ''; // a note another mode added; docked parts were put back above
    if (m.tape) for (const el of m.tape()) { if (el.id) dock(el, tape); else tape.append(el); }
    else { dock($('jobs'), tape); dock($('results'), tape); }
    q('.u-tape').classList.toggle('u-no-results', !!m.tape);
  }

  /** Repaint what changes often: labels, lit keys, counts. */
  function paint() {
    const tab = MODES[activeTab] ? activeTab : 'tts';
    const m = MODES[tab];
    for (const b of unit.querySelectorAll('.u-mode')) { const on = b.dataset.tab === activeTab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
    q('.u-finish').textContent = `◐ ${document.documentElement.dataset.finish === 'black' ? 'Black' : 'Cream'}`;
    const state = $('session')?.dataset.state;
    const ok = !!client && state === 'connected';
    q('.u-online').className = `u-online ${!client ? 'nokey' : state === 'connected' ? 'on' : 'off'}`;
    q('.u-online span').textContent = !client ? 'No key' : { connected: 'Online', none: 'No session', error: 'No LUNA' }[state] ?? 'Waiting';
    q('.u-online').title = `${$('session-text')?.textContent ?? ''}. ${client ? 'Click for the API key.' : 'Click to add your ElevenLabs API key.'}`;
    let credits = '— CR';
    if (subscription && typeof subscription.character_limit === 'number') credits = `${Math.max(0, subscription.character_limit - (subscription.character_count ?? 0))} CR`;
    q('.u-credits').textContent = credits;
    if (screen === 'plan') { const t = unit.querySelector('.u-plan-text'); if (t) t.textContent = `${$('quota').textContent || 'Add your API key to see your credits.'}\nEvery Generate uses your own ElevenLabs credits.`; }
    if (screenNow() === 'main') {
      const hd = m.head;
      const left = q('.u-left .u-link, .u-left .u-dim');
      if (left) left.textContent = hd.voice ? `${hd.prefix} ▸ ${label($(hd.voice))} ▾` : (typeof hd.text === 'function' ? hd.text() : hd.text);
      const right = q('.u-right .u-link');
      if (right && hd.model) right.textContent = `${label($(hd.model))} ⇄`;
    }
    q('.u-foot-left').textContent = m.left?.() ?? '';
    const sel = $(m.takes);
    q('.u-takes').classList.toggle('off', !sel || sel.disabled);
    takeKeys.forEach((b, i) => { const on = !!sel && sel.value === String(i + 1); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.disabled = !sel || sel.disabled; });
    q('.u-as').classList.toggle('off', !sel || sel.disabled);
    for (const [b, v] of asKeys) { const on = (prefs.placeAs ?? 'playlists') === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.disabled = !sel || sel.disabled; }
    for (const [b, radio] of placeKeys) { b.classList.toggle('on', radio.checked); b.setAttribute('aria-pressed', radio.checked); }
    const go = $(m.go);
    const rest = { tts: 'Generate', sfx: 'Generate', music: 'Compose', vc: 'Change voice', ivc: 'Create voice', lyrics: 'Re-voice in Text to Speech' }[tab];
    const now = go?.textContent.replace(/⌘↩|Ctrl\+↩/g, '').trim();
    const goKey = q('.u-go');
    const feedback = now && rest && !now.startsWith(rest);
    if (!feedback) { goKey.style.width = ''; goKey.textContent = m.goLabel; goKey.dataset.rest = goKey.offsetWidth; }
    else { if (goKey.dataset.rest > 0) goKey.style.width = `${goKey.dataset.rest}px`; goKey.textContent = now; }
    q('.u-go').disabled = !!go?.disabled;
    q('.u-go').title = go?.title ?? m.goLabel;
    q('.u-tape-title').textContent = `Tape · ${m.label}`;
    q('.u-tape-hist').textContent = `${AddOnHelp.keyLabel({ mod: true, key: 'y' })} History`;
    for (const k of unit.querySelectorAll('.u-soft, .u-knob, .u-switch')) k.paint?.();
  }

  function render() {
    const on = vintage();
    unit.hidden = !on;
    document.body.classList.toggle('unit-on', on);
    if (!on) { if (docked.size) undockAll(); built = null; return; }
    if (MODES[activeTab]) prefs.lastMode = activeTab;
    if (built !== `${activeTab}|${screenNow()}`) build();
    paint();
  }

  // Keep the panel in step: tab and look changes call render() at once; the rest is light enough to poll.
  window.unitRender = () => render();
  document.addEventListener('input', () => { if (vintage()) queueMicrotask(paint); });
  document.addEventListener('change', () => { if (vintage()) queueMicrotask(paint); });
  setInterval(() => { if (vintage()) paint(); }, 500);
  render();
})();
