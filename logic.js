// AI Voice & Sound Unit: engine logic with no DOM, so tests can exercise it against
// Luna.MockEngine. main.js decodes audio and renders; this file encodes WAV and places
// generated audio on the LUNA timeline.

const AddOnLogic = {
  SECRET_NAME: 'elevenlabs.api_key',

  /**
   * 16-bit PCM WAV from planar float channels (-1..1), the format LUNA imports everywhere.
   * @param {Float32Array[]} channels
   * @param {number} sampleRate
   * @returns {Uint8Array}
   */
  encodeWav(channels, sampleRate) {
    const numChannels = channels.length;
    const frames = numChannels ? channels[0].length : 0;
    const blockAlign = numChannels * 2;
    const dataBytes = frames * blockAlign;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numChannels, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, dataBytes, true);
    let o = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
        o += 2;
      }
    }
    return new Uint8Array(buf);
  },

  /**
   * The API key in clipboard text, or null. ElevenLabs keys are `sk_` and then lowercase
   * hex, letters, digits and underscores (regional keys carry a suffix).
   */
  keyFromClipboard(text) {
    const t = String(text ?? '').trim();
    return /^sk_[0-9a-f]{20,}[a-z0-9_]*$/.test(t) ? t : null;
  },

  /** A clip/track-safe name from a prompt: first words, at most 40 characters. */
  clipName(prefix, text) {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim();
    const short = words.length > 32 ? `${words.slice(0, 32).trimEnd()}…` : words;
    return short ? `${prefix} - ${short}` : prefix;
  },

  /** The track generated audio lands on when the user chose "selected track". */
  targetTrack(session) {
    const t = session.focusedTrack.value;
    return t && t.trackType.value === 'audio' ? t : undefined;
  },

  /** What the destination row says. `at`: 'playhead' (default), 'selection' or 'marker'. */
  destinationText(session, mode, at = 'playhead') {
    if (!session) return 'No session open: generated audio can be previewed but not placed.';
    const where = AddOnLogic.AT_TEXT[at] ?? AddOnLogic.AT_TEXT.playhead;
    if (mode === 'new') return `A new track ${where}`;
    const t = AddOnLogic.targetTrack(session);
    return t ? `"${t.name.value ?? t.id}" ${where}` : 'No audio track selected: a new track will be made';
  },
  AT_TEXT: { playhead: 'at the playhead', selection: 'at the selection start', marker: 'at the next marker' },

  /**
   * Where a new result starts: the playhead, the start of the timeline selection, or the first
   * marker at or after the playhead. Falls back to the playhead, with a note, when there is no
   * selection or no marker. Markers must have been loaded (session.markers.load()).
   * @returns {{ tick: number, note: string }}
   */
  startTick(session, at = 'playhead') {
    const head = Math.max(0, Math.round(session.transport.tick || 0));
    if (at === 'selection') {
      const a = session.context.selectionStart.value;
      const b = session.context.selectionStop.value;
      if (typeof a === 'number' && typeof b === 'number' && b > a) return { tick: Math.max(0, Math.round(a)), note: '' };
      return { tick: head, note: 'No selection on the timeline, so it goes at the playhead.' };
    }
    if (at === 'marker') {
      let ticks = [];
      try { ticks = session.markers.sorted.map((m) => m.location.value).filter((t) => typeof t === 'number' && t >= head); } catch { /* not loaded */ }
      if (ticks.length) return { tick: Math.round(ticks[0]), note: '' };
      return { tick: head, note: 'No marker at or after the playhead, so it goes at the playhead.' };
    }
    return { tick: head, note: '' };
  },

  // ---------- where generated audio goes ----------

  /** "12|1|000" for a tick, or '' while the maps are not loaded. */
  barText(session, tick) {
    try { return Luna.formatBarBeat(session.musical.timeline.barBeat(tick)); } catch { return ''; }
  },

  /**
   * The destination as it is now: the selected audio track (or a new track) at the
   * playhead. Taken when the user clicks Generate, so the audio lands there even if they
   * have moved on by the time it is ready.
   * @returns {{ mode: 'selected'|'new', trackId: string|null, trackName: string|null, tick: number, where: string }}
   */
  captureTarget(session, mode = 'selected', tick) {
    const t = typeof tick === 'number' ? tick : Math.max(0, Math.round(session.transport.tick || 0));
    const track = mode === 'new' ? undefined : AddOnLogic.targetTrack(session);
    return {
      mode,
      trackId: track ? track.id : null,
      trackName: track ? (track.name.value ?? track.id) : null,
      tick: t,
      where: AddOnLogic.barText(session, t),
    };
  },

  /** Short text for a target: `"Vocal" at 12|1|000` or `a new track at 12|1|000`. */
  targetText(target) {
    if (!target) return '';
    const at = target.where ? ` at ${target.where}` : '';
    return target.trackId ? `"${target.trackName}"${at}` : `a new track${at}`;
  },

  /** Put generated WAV bytes into the session as a source (no clip yet). Resolves its uid. */
  async uploadAudio(session, { wav, name, onProgress }) {
    if (!session) throw new Error('Open a session in LUNA first');
    const source = await session.uploadFile({ bytes: wav, name: `${AddOnLogic.safeFileName(name)}.wav`, onProgress });
    return source.id;
  },

  /**
   * A file name made from a prompt or a voice name (voice names in ElevenLabs' shared library
   * are chosen by strangers): no folders, control characters or leading dots, 100 characters
   * at most.
   */
  safeFileName(name) {
    const s = String(name ?? '')
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 100)
      .trim();
    return s || 'ElevenLabs';
  },

  /** The track a target names, if it still exists and is an audio track. */
  trackFor(session, target) {
    if (!target || !target.trackId) return undefined;
    const t = session.tracks.byId(target.trackId);
    return t && t.trackType.value === 'audio' ? t : undefined;
  },

  /** The tick span of `seconds` of audio starting at `startTick`, unstretched. */
  spanTicks(session, startTick, seconds) {
    const tl = session.musical.timeline;
    const stop = Math.round(tl.tickAtSeconds(tl.seconds(startTick) + seconds));
    return Math.max(stop, startTick + 1);
  },

  /** insertClip for one generated source. Call inside a transaction. */
  insertGenerated(session, { trackUid, playlistUid, item, startTick }) {
    return session.insertClip({
      trackUid: playlistUid ? undefined : trackUid,
      playlistUid,
      sourceUid: item.sourceUid,
      startTick,
      stopTick: AddOnLogic.spanTicks(session, startTick, item.seconds),
      sourceStartNs: 0,
      sourceStopNs: Math.round(item.seconds * 1e9),
      name: item.name,
      lengthFollows: 'time',
    });
  },

  /**
   * A new audio track, listed and loaded. Call it before a transaction, never inside one:
   * inside a batch the track has no playlist yet, so a clip put on it makes the SDK ask LUNA
   * get_clip_info mid-transaction. On 2026-11-25 LUNA never answered that, the abort hung as
   * well, and LUNA could not quit. Made first, the track has its playlist and nothing is asked.
   */
  newTrackFor(session, name, channels) {
    if (session.batching) throw new Error('newTrackFor() inside a transaction');
    return session.newTrack({ name, stemFormat: channels > 1 ? 'stereo' : 'mono', makeNameUnique: true }).then((r) => r[0]);
  },

  /** Run `run`; if it fails, take away the (still empty) tracks made for it, then rethrow. */
  async onNewTracks(session, made, run) {
    try {
      return await run();
    } catch (err) {
      const ids = made.filter(Boolean).map((t) => t.id);
      if (ids.length) await session.deleteTracks(ids).catch(() => undefined);
      throw err;
    }
  },

  /**
   * Place one uploaded source at a target, as one undo step. A target track that is gone
   * (deleted, or not audio) becomes a new track.
   * @param {{ sourceUid: string, seconds: number, channels: number, name: string }} item
   * @returns {Promise<{ track, clip, startTick, stopTick }>}
   */
  async placeSource(session, item, target) {
    if (!(item.seconds > 0)) throw new Error('The generated audio is empty');
    await session.musical.ready();
    let track = AddOnLogic.trackFor(session, target);
    const startTick = Math.max(0, Math.round(target.tick));
    const made = [];
    if (!track) made.push((track = await AddOnLogic.newTrackFor(session, item.name, item.channels)));
    let clip;
    await AddOnLogic.onNewTracks(session, made, () => session.transaction(`ElevenLabs: ${item.name}`, async () => {
      clip = await AddOnLogic.insertGenerated(session, { trackUid: track.id, item, startTick });
    }));
    return { track, clip, startTick, stopTick: AddOnLogic.spanTicks(session, startTick, item.seconds) };
  },

  /**
   * Place several variations at one target, as one undo step.
   * `as: 'tracks'`: each on a new track of its own. `as: 'playlists'`: all on one track, the
   * first on its current playlist and each other one on a new empty playlist of that track;
   * the playlist that was active stays active, so variation 1 is what plays.
   */
  async placeVariations(session, items, target, as = 'playlists') {
    if (!items.length) return [];
    await session.musical.ready();
    const startTick = Math.max(0, Math.round(target.tick));
    const placed = [];
    if (as === 'tracks') {
      const made = [];
      for (const item of items) made.push(await AddOnLogic.newTrackFor(session, item.name, item.channels));
      await AddOnLogic.onNewTracks(session, made, () => session.transaction(`ElevenLabs: ${items.length} variations`, async () => {
        for (let i = 0; i < items.length; i++) {
          await AddOnLogic.insertGenerated(session, { trackUid: made[i].id, item: items[i], startTick });
          placed.push({ track: made[i] });
        }
      }));
      return placed;
    }
    // Playlists. A batch transaction holds new nodes back until its commit, so the empty
    // playlists are made first (each is its own undo step in LUNA), then every variation goes
    // in by playlist uid in one undo step.
    let track = AddOnLogic.trackFor(session, target);
    if (!track) track = await AddOnLogic.newTrackFor(session, items[0].name.replace(/ #\d+$/, ''), Math.max(...items.map((i) => i.channels)));
    await session.playlists.load();
    const lanes = () => session.playlists.items.filter((p) => p.trackUid.value === track.id);
    const original = session.playlistFor(track) ?? lanes()[0];
    if (!original) throw new Error(`"${track.name.value}" has no playlist to put the variations on`);
    const originalVersion = original.version.value;
    const targets = [original];
    for (let i = 1; i < items.length; i++) {
      const before = new Set(lanes().map((p) => p.id));
      await session.newPlaylists([track.id], { duplicate: false });
      let fresh;
      for (let tries = 0; tries < 40 && !fresh; tries++) {
        await session.playlists.reload();
        fresh = lanes().find((p) => !before.has(p.id));
        if (!fresh) await new Promise((r) => setTimeout(r, 50));
      }
      if (!fresh) throw new Error('LUNA did not show the new playlist. The variations so far are in the results list.');
      targets.push(fresh);
    }
    if (typeof originalVersion === 'number' && session.playlistFor(track)?.id !== original.id) await session.setPlaylist(track.id, originalVersion);
    await session.transaction(`ElevenLabs: ${items.length} variations`, async () => {
      for (let i = 0; i < items.length; i++) {
        await AddOnLogic.insertGenerated(session, { playlistUid: targets[i].id, item: items[i], startTick });
        placed.push({ track, playlist: targets[i] });
      }
    });
    return placed;
  },

  /**
   * Place script lines (batch Text to Speech) as one undo step.
   * layout 'sequential': one after another from target.tick with `gapSeconds` between.
   * layout 'markers': each line on the next marker at or after target.tick.
   * Lines with a speaker go to a new track per speaker; the rest to the target.
   * @param {{ sourceUid, seconds, channels, name, speaker?: string|null }[]} items
   */
  async placeScript(session, items, target, { layout = 'sequential', gapSeconds = 0.5, trackName = 'TTS - Script' } = {}) {
    await session.musical.ready();
    const tl = session.musical.timeline;
    let starts;
    if (layout === 'explicit') {
      starts = items.map((i) => Math.max(0, Math.round(i.tick))); // Voice Changer on several clips: where each came from
    } else if (layout === 'markers') {
      await session.markers.load();
      const ticks = session.markers.sorted.map((m) => m.location.value).filter((t) => t >= target.tick);
      if (ticks.length < items.length) throw new Error(`There are ${ticks.length} marker${ticks.length === 1 ? '' : 's'} after the playhead but ${items.length} line${items.length === 1 ? '' : 's'}. Add markers or place the lines one after another.`);
      starts = ticks.slice(0, items.length);
    } else {
      starts = [];
      let t = Math.max(0, Math.round(target.tick));
      for (const item of items) {
        starts.push(t);
        t = Math.round(tl.tickAtSeconds(tl.seconds(t) + item.seconds + Math.max(0, gapSeconds)));
      }
    }
    // Tracks first, in the order the lines need them, then every clip in one undo step.
    const made = [];
    const speakerTracks = new Map();
    let main = AddOnLogic.trackFor(session, target);
    const trackOf = [];
    for (const item of items) {
      if (item.speaker) {
        if (!speakerTracks.has(item.speaker)) {
          const t = await AddOnLogic.newTrackFor(session, `TTS - ${item.speaker}`, 1);
          made.push(t);
          speakerTracks.set(item.speaker, t);
        }
        trackOf.push(speakerTracks.get(item.speaker));
      } else {
        if (!main) made.push((main = await AddOnLogic.newTrackFor(session, trackName, Math.max(1, ...items.map((x) => x.channels || 1)))));
        trackOf.push(main);
      }
    }
    const placed = [];
    await AddOnLogic.onNewTracks(session, made, () => session.transaction(`ElevenLabs: script (${items.length} line${items.length === 1 ? '' : 's'})`, async () => {
      for (let i = 0; i < items.length; i++) {
        await AddOnLogic.insertGenerated(session, { trackUid: trackOf[i].id, item: items[i], startTick: starts[i] });
        placed.push({ track: trackOf[i], startTick: starts[i] });
      }
    }));
    return placed;
  },

  /**
   * Upload a WAV and put it on the timeline, unstretched, as one undo step: at `atTick`
   * (where it came from) or the playhead, on the selected audio track or a new one.
   */
  async placeAudio(session, { wav, seconds, channels, name, mode = 'selected', onProgress, atTick }) {
    if (!session) throw new Error('Open a session in LUNA first');
    if (!(seconds > 0)) throw new Error('The generated audio is empty');
    const sourceUid = await AddOnLogic.uploadAudio(session, { wav, name, onProgress });
    const target = AddOnLogic.captureTarget(session, mode, typeof atTick === 'number' ? atTick : undefined);
    return AddOnLogic.placeSource(session, { sourceUid, seconds, channels, name }, target);
  },

  // ---------- script (batch Text to Speech) ----------

  /**
   * Lines of a script. "Name: text" picks the voice whose name starts with Name, and puts
   * that speaker on a track of their own; a prefix that names no voice is kept as text.
   */
  parseScript(text, voices) {
    const lines = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^([^:]{1,40}):\s+(.+)$/.exec(line);
      if (m) {
        const who = m[1].trim().toLowerCase();
        const voice = voices.find((v) => v.name.toLowerCase() === who)
          ?? voices.find((v) => v.name.toLowerCase().startsWith(`${who} `) || v.name.toLowerCase().startsWith(`${who} -`) || v.name.toLowerCase().split(/[\s-]/)[0] === who);
        if (voice) { lines.push({ text: m[2].trim(), speaker: m[1].trim(), voiceId: voice.id }); continue; }
      }
      lines.push({ text: line, speaker: null, voiceId: null });
    }
    return lines;
  },

  // ---------- music context ----------

  /** "C major", "F# minor" from a key signature's sharps (+) or flats (-). */
  keyName(sharpsAndFlats, isMinor) {
    const major = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
    const minor = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
    const i = Math.max(-7, Math.min(7, Math.round(sharpsAndFlats || 0))) + 7;
    return isMinor ? `${minor[i]} minor` : `${major[i]} major`;
  },

  /** Tempo and key at a tick, for a music prompt: "120 BPM, in A minor". */
  async musicContext(session, tick) {
    await session.musical.ready();
    const parts = [];
    try { parts.push(`${Math.round(session.musical.tempoAt(tick) * 10) / 10} BPM`); } catch { /* no tempo yet */ }
    const keys = session.musical.keySignatures.items
      .filter((k) => typeof k.tick.value === 'number' && k.tick.value <= tick)
      .sort((a, b) => b.tick.value - a.tick.value);
    if (keys[0]) parts.push(`in ${AddOnLogic.keyName(keys[0].sharpsAndFlats.value, keys[0].isMinor.value)}`);
    return parts.join(', ');
  },

  /** Seconds covered by the timeline selection, or null when nothing is selected. */
  async selectionSeconds(session) {
    const a = session.context.selectionStart.value;
    const b = session.context.selectionStop.value;
    if (typeof a !== 'number' || typeof b !== 'number' || b <= a) return null;
    await session.musical.ready();
    const tl = session.musical.timeline;
    return tl.seconds(b) - tl.seconds(a);
  },

  // ---------- credits ----------

  /**
   * What a Text to Speech request will cost, from the model's rate and the plan's quota.
   * @returns {{ credits: number, remaining: number|null, maxChars: number|null, overLimit: boolean, overQuota: boolean }}
   */
  creditEstimate(chars, model, sub) {
    const rate = model?.model_rates?.character_cost_multiplier ?? 1;
    const credits = Math.ceil(chars * rate);
    const remaining = sub && typeof sub.character_limit === 'number' ? Math.max(0, sub.character_limit - (sub.character_count ?? 0)) : null;
    const maxChars = model?.maximum_text_length_per_request ?? null;
    return { credits, remaining, maxChars, overLimit: !!maxChars && chars > maxChars, overQuota: remaining !== null && credits > remaining };
  },

  // ---------- generation history, kept in the session ----------

  /**
   * The session's generation history, one storage record per generation, so it is saved
   * with the session and survives reloads. Entries hold settings and the source uid, never
   * audio bytes or the API key.
   */
  history(session, addOnId) {
    const store = session.storage.context(`${addOnId}.history`);
    let loaded = false;
    const api = {
      async load() { if (!loaded) { await store.load(); loaded = true; } },
      list() {
        return (store.records.value ?? [])
          .map((r) => store.value(r, 'entry').value)
          .filter((e) => e && e.id)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      },
      async add(entry) {
        await api.load();
        await store.add(entry.id, 'entry', entry);
      },
      async update(id, patch) {
        await api.load();
        const prop = store.value(id, 'entry');
        if (!prop.value) return;
        await store.set(id, 'entry', { ...prop.value, ...patch });
      },
      async remove(id) { await api.load(); await store.remove(id); },
      async clear() { await api.load(); await store.clear(); },
      onChange(fn) { return store.records.onChange(fn); },
    };
    return api;
  },

  /** The history entry that produced a source, for "Load settings from clip". */
  entryForSource(entries, sourceUid) {
    return entries.find((e) => e.sourceUid === sourceUid);
  },

  /** Every audio clip the timeline selection covers on the selected track, top layers only. */
  async clipsInSelection(session) {
    const a = session.context.selectionStart.value;
    const b = session.context.selectionStop.value;
    if (typeof a !== 'number' || typeof b !== 'number' || b <= a) throw new Error('Select a range on the timeline that covers the clips to change');
    const selTracks = session.context.selectionTracks.value ?? [];
    const track = session.tracks.items.find((t) => t.trackType.value === 'audio' && selTracks.includes(t.id)) ?? AddOnLogic.targetTrack(session);
    if (!track) throw new Error('Select an audio track first');
    const pl = session.playlistFor(track);
    if (!pl) throw new Error(`"${track.name.value}" has no clips`);
    await pl.clips.load();
    const inRange = pl.clips.items.filter((c) => c.clipType.value !== 'midi' && c.stop.value > a && c.start.value < b);
    const visible = inRange.filter((c) => !inRange.some((d) => d !== c && (d.layer.value ?? 0) > (c.layer.value ?? 0) && d.start.value <= c.start.value && d.stop.value >= c.stop.value));
    visible.sort((x, y) => x.start.value - y.start.value);
    if (!visible.length) throw new Error(`No audio clips in the selection on "${track.name.value}"`);
    const out = [];
    for (const clip of visible) {
      const startTick = Math.max(a, clip.start.value);
      const stopTick = Math.min(b, clip.stop.value);
      const [s0, s1] = await AddOnLogic.sourceSpan(session, clip, startTick, stopTick);
      out.push({ track, clip, startTick, stopTick, sourceUid: clip.sourceUid.value, sourceStartNs: s0, sourceStopNs: s1, path: AddOnLogic.sourcePath(session, clip.sourceUid.value) });
    }
    return out;
  },

  // ---------- audio from a clip on the timeline ----------

  /**
   * The audio the user pointed at: the clip on the selected track under the timeline
   * selection (only the selected part of it), or, with no range selected, the whole clip
   * under the playhead. Returns where it sits and which part of its source file it plays.
   * @returns {Promise<{ track, clip, startTick, stopTick, sourceUid, sourceStartNs, sourceStopNs, path }>}
   */
  async clipSelection(session) {
    if (!session) throw new Error('Open a session in LUNA first');
    const ctx = session.context;
    const selTracks = ctx.selectionTracks.value ?? [];
    const audioTracks = session.tracks.items.filter((t) => t.trackType.value === 'audio');
    const track = audioTracks.find((t) => selTracks.includes(t.id)) ?? AddOnLogic.targetTrack(session);
    if (!track) throw new Error('Select an audio clip on the timeline first');

    const a = ctx.selectionStart.value;
    const b = ctx.selectionStop.value;
    const hasRange = typeof a === 'number' && typeof b === 'number' && b > a;
    const from = hasRange ? a : Math.round(session.transport.tick || 0);
    const to = hasRange ? b : from;

    const pl = session.playlistFor(track);
    if (!pl) throw new Error(`"${track.name.value}" has no clips`);
    await pl.clips.load();
    // The clip that sounds at the start of the range: it covers that point, top layer first.
    const covering = pl.clips.items
      .filter((c) => c.clipType.value !== 'midi' && c.start.value <= from && c.stop.value > from)
      .sort((x, y) => (y.layer.value ?? 0) - (x.layer.value ?? 0));
    const clip = covering[0]
      // a range that starts before the clip: the first clip inside it
      ?? (hasRange ? pl.clips.items.filter((c) => c.stop.value > from && c.start.value < to).sort((x, y) => x.start.value - y.start.value)[0] : undefined);
    if (!clip) throw new Error(hasRange ? `No audio clip in the selection on "${track.name.value}"` : `No audio clip under the playhead on "${track.name.value}". Select a clip first.`);

    const startTick = hasRange ? Math.max(from, clip.start.value) : clip.start.value;
    const stopTick = hasRange ? Math.min(to, clip.stop.value) : clip.stop.value;
    const [srcA, srcB] = await AddOnLogic.sourceSpan(session, clip, startTick, stopTick);
    const sourceUid = clip.sourceUid.value;
    return {
      track, clip, startTick, stopTick, sourceUid,
      sourceStartNs: srcA, sourceStopNs: srcB,
      path: AddOnLogic.sourcePath(session, sourceUid),
    };
  },

  /**
   * Which nanoseconds of the clip's source play between two ticks. The clip maps its span
   * onto sourceStart..sourceStop linearly in time, so this honours tempo changes under an
   * unstretched clip and the stretch of a stretched one.
   */
  async sourceSpan(session, clip, startTick, stopTick) {
    await session.musical.ready();
    const tl = session.musical.timeline;
    const t0 = tl.seconds(clip.start.value);
    const t1 = tl.seconds(clip.stop.value);
    const s0 = clip.sourceStart.value;
    const s1 = clip.sourceStop.value;
    const at = (tick) => Math.round(s0 + ((tl.seconds(tick) - t0) / (t1 - t0)) * (s1 - s0));
    return [at(startTick), at(stopTick)];
  },

  /**
   * Where LUNA keeps a source on disk: `<session package>/audio/<uid>.wav`. Observed on
   * LUNA 3.1 for macOS; the SDK does not document it, so a read failure says so.
   */
  /** A source uid as LUNA makes them: letters, digits, `-` and `_`, no path. */
  isSourceUid(uid) {
    return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
  },

  sourcePath(session, sourceUid, ext = 'wav') {
    const pkg = session.sessionPackagePath.value;
    if (!pkg) throw new Error('LUNA did not say where this session is saved');
    // The uid can come from History in session storage, which a shared session file brings
    // along: never let it name a file outside the session's audio folder.
    if (!AddOnLogic.isSourceUid(sourceUid)) throw new Error('This entry does not name an audio file of the session');
    return `${pkg.replace(/[\\/]+$/, '')}/audio/${sourceUid}.${ext}`;
  },

  /**
   * Parse a RIFF/WAVE header. Returns the format and where the sample data lies, or null
   * when the bytes are not a WAV LUNA can hand over (PCM 16/24/32 or float 32/64).
   * `bytes` needs to reach at least the start of the `data` chunk.
   */
  parseWavHeader(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let o = 12;
    let fmt = null;
    while (o + 8 <= u8.length) {
      const id = tag(o);
      const size = v.getUint32(o + 4, true);
      const body = o + 8;
      if (id === 'fmt ') {
        if (body + 16 > u8.length) return null;
        let format = v.getUint16(body, true);
        if (format === 0xfffe && size >= 26 && body + 26 <= u8.length) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE: sub-format GUID starts with the tag
        fmt = {
          format, // 1 = PCM, 3 = IEEE float
          channels: v.getUint16(body + 2, true),
          sampleRate: v.getUint32(body + 4, true),
          blockAlign: v.getUint16(body + 12, true),
          bitsPerSample: v.getUint16(body + 14, true),
        };
      } else if (id === 'data') {
        if (!fmt) return null;
        const ok = (fmt.format === 1 && [16, 24, 32].includes(fmt.bitsPerSample)) || (fmt.format === 3 && [32, 64].includes(fmt.bitsPerSample));
        return ok ? { ...fmt, dataOffset: body, dataBytes: size } : null;
      }
      o = body + size + (size & 1); // chunks are word-aligned
    }
    return null;
  },

  /** The byte range of a WAV's sample data that holds `startNs..stopNs`. */
  wavByteRange(header, startNs, stopNs) {
    const frames = Math.floor(header.dataBytes / header.blockAlign);
    const f0 = Math.max(0, Math.min(frames, Math.floor((startNs / 1e9) * header.sampleRate)));
    const f1 = Math.max(f0, Math.min(frames, Math.ceil((stopNs / 1e9) * header.sampleRate)));
    return { start: header.dataOffset + f0 * header.blockAlign, end: header.dataOffset + f1 * header.blockAlign, frames: f1 - f0 };
  },

  /** Interleaved WAV sample bytes to planar float channels. */
  wavSamplesToFloat(header, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const { channels, blockAlign, bitsPerSample, format } = header;
    const frames = Math.floor(u8.length / blockAlign);
    const out = Array.from({ length: channels }, () => new Float32Array(frames));
    const bps = bitsPerSample / 8;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const o = i * blockAlign + c * bps;
        let s;
        if (format === 3) s = bps === 4 ? v.getFloat32(o, true) : v.getFloat64(o, true);
        else if (bps === 2) s = v.getInt16(o, true) / 0x8000;
        else if (bps === 3) s = (((u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16)) << 8) >> 8) / 0x800000;
        else s = v.getInt32(o, true) / 0x80000000;
        out[c][i] = s;
      }
    }
    return out;
  },

  // ---------- text files for Text to Speech ----------

  TEXT_FILE_TYPES: ['txt', 'text', 'md', 'markdown', 'rtf', 'srt', 'vtt', 'lrc'],

  /**
   * Plain text from RTF (TextEdit's default format, also Word's): paragraphs and line breaks
   * kept, fonts, colours, styles and other hidden groups dropped, `\'xx` (Windows-1252) and
   * `\uN` characters decoded.
   */
  rtfToText(rtf) {
    const SKIP = new Set(['fonttbl', 'colortbl', 'expandedcolortbl', 'stylesheet', 'info', 'pict', 'listtable', 'listoverridetable', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'rsidtbl', 'mmathPr', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'object', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'objdata', 'shppict', 'nonshppict', 'bkmkstart', 'bkmkend']);
    const cp1252 = new TextDecoder('windows-1252');
    const s = String(rtf);
    let out = '';
    const stack = [{ skip: false, uc: 1 }];
    let state = stack[0];
    let pendingSkip = 0; // fallback characters to drop after \uN
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '{') {
        state = { skip: state.skip, uc: state.uc };
        stack.push(state);
        if (s[i + 1] === '\\' && s[i + 2] === '*') state.skip = true; // {\* ...}: an optional destination
        continue;
      }
      if (c === '}') {
        stack.pop();
        state = stack[stack.length - 1] ?? stack[0];
        if (!stack.length) stack.push(state);
        continue;
      }
      if (c === '\\') {
        const n = s[i + 1];
        if (n === undefined) break;
        if (n === '\n' || n === '\r') { if (!state.skip) out += '\n'; i++; continue; } // "\" + newline: a paragraph (Cocoa RTF)
        if (n === '\\' || n === '{' || n === '}') { if (!state.skip) { if (pendingSkip) pendingSkip--; else out += n; } i++; continue; }
        if (n === '~') { if (!state.skip) out += ' '; i++; continue; }
        if (n === '-' || n === '*') { i++; continue; }
        if (n === '_') { if (!state.skip) out += '-'; i++; continue; }
        if (n === "'") {
          const hex = s.substr(i + 2, 2);
          i += 3;
          if (state.skip) continue;
          if (pendingSkip) { pendingSkip--; continue; }
          out += cp1252.decode(new Uint8Array([parseInt(hex, 16) || 0x3f]));
          continue;
        }
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40));
        if (!m) { i++; continue; }
        i += m[0].length;
        const word = m[1];
        const arg = m[2] === undefined ? null : Number(m[2]);
        if (SKIP.has(word)) { state.skip = true; continue; }
        if (state.skip) continue;
        if (word === 'par' || word === 'line' || word === 'sect' || word === 'page' || word === 'row') out += '\n';
        else if (word === 'tab' || word === 'cell') out += '\t';
        else if (word === 'uc' && arg !== null) state.uc = arg;
        else if (word === 'u' && arg !== null) { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); pendingSkip = state.uc; }
        else if (word === 'emdash') out += '—';
        else if (word === 'endash') out += '–';
        else if (word === 'bullet') out += '•';
        else if (word === 'lquote') out += '‘';
        else if (word === 'rquote') out += '’';
        else if (word === 'ldblquote') out += '“';
        else if (word === 'rdblquote') out += '”';
        continue;
      }
      if (c === '\n' || c === '\r') continue; // line breaks in the source are not text
      if (state.skip) continue;
      if (pendingSkip) { pendingSkip--; continue; }
      out += c;
    }
    return out.split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^ +/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  },
  MAX_TEXT_FILE_BYTES: 2 * 1024 * 1024,

  /** Bytes of a text file to a string: UTF-8 (with or without BOM) or UTF-16 with a BOM. */
  decodeText(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    const start = u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf ? 3 : 0;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8.subarray(start));
    } catch {
      return new TextDecoder('windows-1252').decode(u8.subarray(start)); // older Windows text files
    }
  },

  /** "00:01:02,500" / "01:02.5" / "1:02.50" to seconds, or NaN. */
  parseClock(s) {
    const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(s).trim());
    if (!m) return NaN;
    const frac = m[4] ? Number(`0.${m[4]}`) : 0;
    return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + frac;
  },

  /** Markup inside a subtitle cue out; a WebVTT voice `<v Alice>` becomes "Alice: ". */
  cueText(raw) {
    let speaker = null;
    const t = String(raw)
      .replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>/gi, (_, who) => { speaker = speaker ?? who.trim(); return ''; })
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return t && speaker ? `${speaker}: ${t}` : t;
  },

  /**
   * A text file for Text to Speech. Subtitles (.srt, .vtt) and lyrics (.lrc) come back as
   * timed `cues` (seconds), one line each; plain text and Markdown as `text`.
   * @returns {{ kind: 'text'|'subtitles'|'lrc', text: string, cues: { start: number, end: number|null, text: string }[] | null }}
   */
  parseTextFile(name, content) {
    const ext = String(name).toLowerCase().split('.').pop();
    const src = String(content).replace(/\r\n?/g, '\n');
    if (ext === 'srt' || ext === 'vtt' || (/^WEBVTT/.test(src) && ext !== 'lrc')) {
      const cues = [];
      for (const block of src.split(/\n{2,}/)) {
        const lines = block.split('\n');
        const at = lines.findIndex((l) => l.includes('-->'));
        if (at < 0) continue; // header, NOTE, STYLE, REGION
        const [a, b] = lines[at].split('-->');
        const start = AddOnLogic.parseClock(a);
        const end = AddOnLogic.parseClock(b.trim().split(/\s+/)[0]);
        const text = AddOnLogic.cueText(lines.slice(at + 1).join('\n'));
        if (Number.isFinite(start) && text) cues.push({ start, end: Number.isFinite(end) ? end : null, text });
      }
      cues.sort((x, y) => x.start - y.start);
      return { kind: 'subtitles', text: cues.map((c) => c.text).join('\n'), cues };
    }
    if (ext === 'lrc') {
      const cues = [];
      for (const line of src.split('\n')) {
        const stamps = [];
        let rest = line.replace(/^\s*((?:\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)/, (all) => { all.replace(/\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g, (_, t) => { stamps.push(AddOnLogic.parseClock(t.replace(/:(\d{1,3})$/, '.$1').replace(/^(\d+)\.(\d{1,2})\.(\d+)$/, '$1:$2.$3'))); return ''; }); return ''; });
        if (!stamps.length) continue; // [ti:...] and other tags, or untimed lines
        rest = rest.replace(/<\d+:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
        for (const s of stamps) cues.push({ start: s, end: null, text: rest });
      }
      cues.sort((x, y) => x.start - y.start);
      // A blank timed line ends the line before it; it is not a line of its own.
      for (let i = 0; i < cues.length; i++) {
        const next = cues[i + 1];
        if (next) cues[i].end = next.start;
      }
      const spoken = cues.filter((c) => c.text);
      return { kind: 'lrc', text: spoken.map((c) => c.text).join('\n'), cues: spoken };
    }
    // RTF by extension, or by content (TextEdit's RTF saved under another name).
    if (ext === 'rtf' || /^\s*\{\\rtf/.test(src)) return { kind: 'text', text: AddOnLogic.rtfToText(src), cues: null };
    let text = src;
    if (ext === 'md' || ext === 'markdown') {
      text = text
        .replace(/^```[\s\S]*?^```[ \t]*$/gm, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
        .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
        .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
        .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2')
        .replace(/`([^`]+)`/g, '$1');
    }
    text = text.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { kind: 'text', text, cues: null };
  },

  /** Timed cues (seconds from the session start) as lines for the lyric-timing modes. */
  cuesToLines(session, cues) {
    const tl = session.musical.timeline;
    return cues.map((c, i) => {
      const next = cues[i + 1];
      const end = c.end ?? (next ? next.start : c.start + 3);
      return { text: c.text, startTick: Math.round(tl.tickAtSeconds(Math.max(0, c.start))), stopTick: Math.round(tl.tickAtSeconds(Math.max(c.start + 0.1, end))), words: [] };
    });
  },

  /** "1,234 / 10,000 characters used" from /v1/user/subscription. */
  quotaText(sub) {
    if (!sub || typeof sub.character_limit !== 'number') return '';
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const tier = sub.tier ? `${sub.tier} plan · ` : '';
    return `${tier}${fmt(sub.character_count ?? 0)} / ${fmt(sub.character_limit)} credits used`;
  },

  /** Voices grouped for a <select>: your own (cloned/generated/professional) first. */
  groupVoices(voices) {
    const mine = voices.filter((v) => v.category && v.category !== 'premade');
    const rest = voices.filter((v) => !v.category || v.category === 'premade');
    const byName = (a, b) => a.name.localeCompare(b.name);
    return [
      { label: 'My voices', voices: mine.sort(byName) },
      { label: 'ElevenLabs voices', voices: rest.sort(byName) },
    ].filter((g) => g.voices.length);
  },
};

globalThis.AddOnLogic = AddOnLogic;
