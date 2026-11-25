// Voice & Sound Unit: lyrics and LRC. No DOM, so tests can drive it against Luna.MockEngine.
//
// LUNA keeps lyrics (Extract Lyrics) under `<session>/lyrics/<rowid>`, one node per line:
// `text`, `location` and `length` in nanoseconds into the audio source named by `source_uid`,
// and `words`, a JSON string `{"words":[{word, offset, length}]}` with offsets from the line's
// start. The times belong to the audio file, not the timeline: moving the clip moves its
// lyrics (measured on LUNA 3.1, 2026-11-17). So a line's place on the timeline comes from the
// clip that plays that file.

const AddOnLyrics = {
  /** Read every lyric line of the session. */
  async read(session, raw) {
    const node = await raw.get(`${session.path}/lyrics`, { levels: 2 });
    const lines = [];
    for (const c of node?.children ?? []) {
      const p = Object.fromEntries(Object.entries(c.properties ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? v.value : v]));
      if (p.type && p.type !== 'lyric') continue;
      let words = [];
      try { words = (typeof p.words === 'string' ? JSON.parse(p.words) : p.words)?.words ?? []; } catch { /* no word timing */ }
      lines.push({
        rowid: p.rowid ?? Number(c.path),
        sourceUid: p.source_uid,
        location: Number(p.location) || 0,
        length: Number(p.length) || 0,
        text: String(p.text ?? '').trim(),
        words: words.map((w) => ({ text: String(w.word ?? ''), offset: Number(w.offset) || 0, length: Number(w.length) || 0 })),
      });
    }
    return lines.filter((l) => l.text).sort((a, b) => a.location - b.location);
  },

  /**
   * A position in a clip's source (nanoseconds) on the timeline (ticks), through the clip's
   * own mapping: linear in time between its start and stop, so it honours tempo changes under
   * an unstretched clip and the stretch of a stretched one.
   */
  sourceToTick(tl, clip, ns) {
    const t0 = tl.seconds(clip.start.value);
    const t1 = tl.seconds(clip.stop.value);
    const s0 = clip.sourceStart.value;
    const s1 = clip.sourceStop.value;
    return Math.round(tl.tickAtSeconds(t0 + ((ns - s0) / (s1 - s0)) * (t1 - t0)));
  },

  /**
   * The lyric lines the user pointed at, placed on the timeline: lines of clips on the selected
   * track (or any track) inside the selection, or of the clip under the playhead when there is
   * no range. A line counts when it starts inside what the clip plays.
   * @returns {Promise<{ lines: { text, startTick, stopTick, words: { text, startTick, stopTick }[], sourceUid, clipUid, trackId }[], clips: number }>}
   */
  async inSelection(session, allLines) {
    await session.musical.ready();
    const tl = session.musical.timeline;
    const ctx = session.context;
    const a = ctx.selectionStart.value;
    const b = ctx.selectionStop.value;
    const hasRange = typeof a === 'number' && typeof b === 'number' && b > a;
    const from = hasRange ? a : Math.round(session.transport.tick || 0);
    const to = hasRange ? b : from;
    const sources = new Set(allLines.map((l) => l.sourceUid));
    const selTracks = ctx.selectionTracks.value ?? [];
    const audio = session.tracks.items.filter((t) => t.trackType.value === 'audio');
    const tracks = audio.some((t) => selTracks.includes(t.id)) ? audio.filter((t) => selTracks.includes(t.id)) : audio;
    const out = [];
    let clipCount = 0;
    for (const track of tracks) {
      const pl = session.playlistFor(track);
      if (!pl) continue;
      await pl.clips.load();
      for (const clip of pl.clips.items) {
        if (!sources.has(clip.sourceUid.value)) continue;
        const hit = hasRange ? clip.stop.value > from && clip.start.value < to : clip.start.value <= from && clip.stop.value > from;
        if (!hit) continue;
        clipCount++;
        const s0 = clip.sourceStart.value;
        const s1 = clip.sourceStop.value;
        for (const line of allLines) {
          if (line.sourceUid !== clip.sourceUid.value || line.location < s0 || line.location >= s1) continue;
          const startTick = AddOnLyrics.sourceToTick(tl, clip, line.location);
          if (hasRange && (startTick < from || startTick >= to)) continue;
          const stopTick = AddOnLyrics.sourceToTick(tl, clip, Math.min(s1, line.location + line.length));
          const words = line.words.map((w) => ({
            text: w.text,
            startTick: AddOnLyrics.sourceToTick(tl, clip, line.location + w.offset),
            stopTick: AddOnLyrics.sourceToTick(tl, clip, Math.min(s1, line.location + w.offset + w.length)),
            sourceStart: (line.location + w.offset) / 1e9,
            sourceEnd: (line.location + w.offset + w.length) / 1e9,
          }));
          out.push({
            text: line.text, startTick, stopTick, words, sourceUid: line.sourceUid, clipUid: clip.id, trackId: track.id, trackName: track.name.value,
            sourceStart: line.location / 1e9, sourceEnd: (line.location + line.length) / 1e9,
          });
        }
      }
    }
    out.sort((x, y) => x.startTick - y.startTick);
    return { lines: out, clips: clipCount };
  },

  /** Split text into words the way TTS and the lyric words do: on whitespace. */
  splitWords(text) {
    return String(text ?? '').trim().split(/\s+/).filter(Boolean);
  },

  /**
   * Word spans in generated audio from ElevenLabs' character alignment (with-timestamps):
   * `{ characters[], character_start_times_seconds[], character_end_times_seconds[] }`.
   * @returns {{ text, start, end }[]} seconds into the generated audio
   */
  wordsFromAlignment(alignment) {
    if (!alignment || !Array.isArray(alignment.characters)) return [];
    const chars = alignment.characters;
    const st = alignment.character_start_times_seconds ?? [];
    const en = alignment.character_end_times_seconds ?? [];
    const words = [];
    let cur = null;
    for (let i = 0; i < chars.length; i++) {
      if (/\s/.test(chars[i])) { if (cur) { words.push(cur); cur = null; } continue; }
      if (!cur) cur = { text: '', start: st[i], end: en[i] };
      cur.text += chars[i];
      cur.end = en[i];
    }
    if (cur) words.push(cur);
    return words;
  },

  /**
   * B: how a generated line compares with the original's length. `retrySpeed` is the speed
   * to generate again with when the difference is too big to stretch well, else null.
   */
  fitPlan(generatedSeconds, targetSeconds, currentSpeed = 1, { tolerance = 0.25, min = 0.7, max = 1.2 } = {}) {
    const ratio = generatedSeconds / targetSeconds; // > 1: too long, needs to go faster
    const ok = ratio <= 1 + tolerance && ratio >= 1 / (1 + tolerance);
    const speed = Math.max(min, Math.min(max, Math.round(currentSpeed * ratio * 100) / 100));
    return { ratio, retrySpeed: ok || speed === currentSpeed ? null : speed };
  },

  /**
   * Place re-voiced lyric lines as one undo step, on one new track.
   * mode 'start' (A): each line at its original start, natural length.
   * mode 'fit' (A+B): each line stretched or squeezed to the original line's span.
   * mode 'words' (A+B+C): each word its own clip at the original word's start; a word longer
   *   than the room before the next original word is squeezed into it, a shorter one keeps
   *   its length. Lines whose words do not match fall back to 'fit'.
   * @param {{ sourceUid, seconds, channels, name, line: {startTick, stopTick, words}, genWords?: {text,start,end}[] }[]} items
   */
  /**
   * How far LUNA may stretch or squeeze a re-voiced line or word: beyond this a voice sounds
   * broken, and LUNA's playback asserted on a 3.3x stretch (LUNA 3.1, 2026-11-17). A line
   * that would need more keeps as close to its length as the limit allows.
   */
  MAX_STRETCH: 1.25,
  MIN_STRETCH: 0.8,

  /** The clip length (seconds) for `natural` seconds of audio aimed at `target` seconds, within the limits. */
  limitedLength(natural, target) {
    const ratio = target / natural;
    const r = Math.max(AddOnLyrics.MIN_STRETCH, Math.min(AddOnLyrics.MAX_STRETCH, ratio));
    return { seconds: natural * r, limited: Math.abs(r - ratio) > 1e-6 };
  },

  async place(session, items, { mode = 'fit', trackName = 'TTS - Lyrics' } = {}) {
    await session.musical.ready();
    const tl = session.musical.timeline;
    const after = (tick, secs) => Math.round(tl.tickAtSeconds(tl.seconds(tick) + secs));
    let fallbacks = 0;
    let limited = 0;
    let clips = 0;
    let track;
    // No alg_type on the clips: they use the track's own algorithm, like any clip LUNA makes.
    // Sources carry silence after the speech (see main.js decodeToWav), so a stretched clip
    // never reads past the end of its file.
    await session.transaction(`ElevenLabs: lyrics (${items.length} line${items.length === 1 ? '' : 's'})`, async () => {
      [track] = await session.newTrack({ name: trackName, stemFormat: items.some((i) => i.channels > 1) ? 'stereo' : 'mono', makeNameUnique: true });
      for (const item of items) {
        const full = Math.round(item.seconds * 1e9);
        const words = mode === 'words' ? AddOnLyrics.matchWords(item.line.words, item.genWords) : null;
        if (words) {
          let lineLimited = false;
          for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const nextStart = i + 1 < words.length ? words[i + 1].orig.startTick : Math.max(item.line.stopTick, w.orig.stopTick);
            const s0 = Math.max(0, Math.round((w.gen.start - 0.02) * 1e9));
            const s1 = Math.min(full, Math.round((i + 1 < words.length ? Math.min(w.gen.end + 0.03, words[i + 1].gen.start) : w.gen.end + 0.08) * 1e9));
            const genLen = Math.max(0.001, (s1 - s0) / 1e9);
            const start = w.orig.startTick;
            // A word keeps its length when there is room; otherwise it is squeezed, at most to MIN_STRETCH.
            const room = tl.seconds(nextStart) - tl.seconds(start);
            const len = room >= genLen ? { seconds: genLen, limited: false } : AddOnLyrics.limitedLength(genLen, room);
            if (len.limited) lineLimited = true;
            await session.insertClip({ trackUid: track.id, sourceUid: item.sourceUid, startTick: start, stopTick: Math.max(start + 1, after(start, len.seconds)), sourceStartNs: s0, sourceStopNs: Math.max(s0 + 1, s1), name: w.orig.text, lengthFollows: 'time' });
            clips++;
          }
          if (lineLimited) limited++;
          continue;
        }
        if (mode === 'words') fallbacks++;
        let seconds = item.seconds;
        if (mode !== 'start') {
          const len = AddOnLyrics.limitedLength(item.seconds, tl.seconds(item.line.stopTick) - tl.seconds(item.line.startTick));
          seconds = len.seconds;
          if (len.limited) limited++;
        }
        await session.insertClip({ trackUid: track.id, sourceUid: item.sourceUid, startTick: item.line.startTick, stopTick: Math.max(item.line.startTick + 1, after(item.line.startTick, seconds)), sourceStartNs: 0, sourceStopNs: full, name: item.name, lengthFollows: 'time' });
        clips++;
      }
    });
    return { track, clips, fallbacks, limited };
  },

  /** Pair original lyric words with generated words, or null when the words differ. */
  matchWords(origWords, genWords) {
    if (!origWords?.length || !genWords?.length || origWords.length !== genWords.length) return null;
    const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    for (let i = 0; i < origWords.length; i++) if (norm(origWords[i].text) !== norm(genWords[i].text)) return null;
    return origWords.map((orig, i) => ({ orig, gen: genWords[i] }));
  },

  // ---------- LRC ----------

  /** [mm:ss.xx], minutes unbounded, centiseconds. */
  lrcTime(seconds) {
    const cs = Math.max(0, Math.round(seconds * 100));
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  },

  /**
   * LRC text. `lines`: { start, end?, text, words?: { text, start }[] } in seconds.
   * With `words`, enhanced LRC: `[00:12.30] <00:12.30>Hello <00:12.71>world`.
   */
  formatLrc(lines, { title, artist, words = false } = {}) {
    const out = [];
    if (title) out.push(`[ti:${title.replace(/[\[\]\n]/g, ' ')}]`);
    if (artist) out.push(`[ar:${artist.replace(/[\[\]\n]/g, ' ')}]`);
    out.push('[re:Voice & Sound Unit]');
    for (const l of [...lines].sort((a, b) => a.start - b.start)) {
      const text = String(l.text).replace(/\s*\n\s*/g, ' ').trim();
      if (words && l.words?.length) {
        out.push(`[${AddOnLyrics.lrcTime(l.start)}] ${l.words.map((w) => `<${AddOnLyrics.lrcTime(w.start)}>${w.text}`).join(' ')}`);
      } else {
        out.push(`[${AddOnLyrics.lrcTime(l.start)}]${text}`);
      }
      // A blank timed line ends a line that is followed by silence, so players clear it.
      const next = lines.find((n) => n.start > l.start);
      if (typeof l.end === 'number' && (!next || next.start - l.end > 1)) out.push(`[${AddOnLyrics.lrcTime(l.end)}]`);
    }
    return `${out.join('\n')}\n`;
  },

  /**
   * Group timed words (Speech to Text) into lines: a new line after sentence punctuation,
   * after a pause, or before a line gets too long.
   */
  linesFromWords(words, { pause = 0.7, maxChars = 70 } = {}) {
    const lines = [];
    let cur = null;
    for (const w of words) {
      if (!w.text || typeof w.start !== 'number') continue;
      const gap = cur ? w.start - cur.end : 0;
      if (cur && (gap > pause || cur.text.length + w.text.length + 1 > maxChars || /[.!?…]["»”']?$/.test(cur.words[cur.words.length - 1].text))) {
        lines.push(cur);
        cur = null;
      }
      if (!cur) cur = { start: w.start, end: w.end, text: '', words: [] };
      cur.text = cur.text ? `${cur.text} ${w.text}` : w.text;
      cur.end = w.end ?? w.start;
      cur.words.push({ text: w.text, start: w.start, end: w.end });
    }
    if (cur) lines.push(cur);
    return lines;
  },

  /** Placed lines (ticks) to LRC lines (seconds on the session timeline, or from `zeroTick`). */
  tickLinesToSeconds(session, lines, zeroTick = 0) {
    const tl = session.musical.timeline;
    const z = tl.seconds(zeroTick);
    return lines.map((l) => ({
      text: l.text,
      start: tl.seconds(l.startTick) - z,
      end: tl.seconds(l.stopTick) - z,
      words: (l.words ?? []).map((w) => ({ text: w.text, start: tl.seconds(w.startTick) - z })),
    }));
  },

  /**
   * Write lines into LUNA's lyrics for an audio source (`set_lyric` with `source_uid`, so the
   * times are nanoseconds into that file and the lyrics move with its clips).
   * `lines`: { text, start, end, words?: { text, start, end }[] } in seconds into the source.
   */
  async write(session, raw, sourceUid, lines) {
    let n = 0;
    for (const l of lines) {
      const location = Math.round(l.start * 1e9);
      const length = Math.max(1, Math.round((l.end - l.start) * 1e9));
      const payload = { session_uid: session.uid, source_uid: sourceUid, text: l.text, location, length };
      if (l.words?.length) {
        payload.words = JSON.stringify({
          words: l.words.map((w) => ({ word: w.text, offset: Math.max(0, Math.round((w.start - l.start) * 1e9)), length: Math.max(1, Math.round(((w.end ?? w.start) - w.start) * 1e9)) })),
        });
      }
      await raw.post(`${session.path}/set_lyric`, payload);
      n++;
    }
    return n;
  },
};

globalThis.AddOnLyrics = AddOnLyrics;
