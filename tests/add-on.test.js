// Runs against Luna.MockEngine and a fake fetch: no LUNA and no ElevenLabs account needed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

// The same SDK bundle the page loads: vendor/luna.global.js is a classic script that defines the
// global `Luna`, which the Add On's own classic scripts read.
runInThisContext(readFileSync(new URL('../vendor/luna.global.js', import.meta.url), 'utf8'), { filename: 'vendor/luna.global.js' });
const { Luna } = globalThis;
await import('../logic.js');
await import('../elevenlabs-api.js');
const logic = globalThis.AddOnLogic;
const { Client, ApiError } = globalThis.ElevenLabs;

async function connected() {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Demo', tracks: ['Vocal', 'Bass'] });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  return { engine, luna, session };
}

/** A fake fetch that records calls and answers from `reply(url, init)`. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const r = reply(new URL(url), init) ?? { json: {} };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => (r.audio ? 'audio/mpeg' : 'application/json') },
      json: async () => r.json,
      text: async () => JSON.stringify(r.json ?? {}),
      arrayBuffer: async () => r.audio ?? new ArrayBuffer(0),
    };
  };
  fn.calls = calls;
  return fn;
}

const sine = (seconds, rate = 44100) => {
  const a = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return a;
};

describe('WAV encoding', () => {
  it('writes a valid 16-bit PCM header and clamps samples', () => {
    const wav = logic.encodeWav([new Float32Array([0, 1, -1, 2]), new Float32Array([0, 0.5, -0.5, -2])], 48000);
    const v = new DataView(wav.buffer);
    const tag = (o) => String.fromCharCode(...wav.slice(o, o + 4));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(v.getInt16(44 + 4, true)).toBe(32767); // frame 1, left = 1
    expect(v.getInt16(44 + 12, true)).toBe(32767); // frame 3, left = 2 clamped
    expect(v.getInt16(44 + 14, true)).toBe(-32768); // frame 3, right = -2 clamped
  });
});

describe('ElevenLabs client', () => {
  it('sends the key and the documented Text to Speech request', async () => {
    const f = fakeFetch(() => ({ audio: new ArrayBuffer(8) }));
    const c = new Client('k123', { fetch: f });
    const res = await c.textToSpeech({ voiceId: 'v1', text: 'Hello', modelId: 'eleven_multilingual_v2', voiceSettings: { stability: 0.4 } });
    expect(res.bytes.byteLength).toBe(8);
    const { url, init } = f.calls[0];
    expect(url.pathname).toBe('/v1/text-to-speech/v1');
    expect(url.searchParams.get('output_format')).toBe('mp3_44100_128');
    expect(init.headers['xi-api-key']).toBe('k123');
    expect(JSON.parse(init.body)).toEqual({ text: 'Hello', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.4 } });
  });

  it('builds Sound Effects and Music bodies within the API limits', async () => {
    const f = fakeFetch(() => ({ audio: new ArrayBuffer(4) }));
    const c = new Client('k', { fetch: f });
    await c.soundEffect({ text: 'door slam', durationSeconds: 99, promptInfluence: 0.5, modelId: 'eleven_text_to_sound_v3' });
    await c.music({ prompt: 'lofi beat', lengthSeconds: 1, instrumental: true, modelId: 'music_v2_5' });
    expect(f.calls[0].url.pathname).toBe('/v1/sound-generation');
    expect(JSON.parse(f.calls[0].init.body)).toMatchObject({ text: 'door slam', duration_seconds: 30, prompt_influence: 0.5, model_id: 'eleven_text_to_sound_v3' });
    expect(f.calls[1].url.pathname).toBe('/v1/music');
    expect(JSON.parse(f.calls[1].init.body)).toEqual({ prompt: 'lofi beat', music_length_ms: 3000, force_instrumental: true, model_id: 'music_v2_5' });
  });

  it('sends multipart forms for Voice Changer and Instant Voice Clone', async () => {
    const f = fakeFetch((url) => (url.pathname === '/v1/voices/add' ? { json: { voice_id: 'new1', requires_verification: false } } : { audio: new ArrayBuffer(2) }));
    const c = new Client('k', { fetch: f });
    const clip = new File([new Uint8Array(10)], 'take.wav', { type: 'audio/wav' });
    await c.voiceChanger({ voiceId: 'v9', audio: clip, modelId: 'eleven_multilingual_sts_v2', removeBackgroundNoise: true, voiceSettings: { stability: 0.4, similarity_boost: 0.8, style: 0 } });
    const res = await c.cloneVoice({ name: ' My Voice ', files: [clip, clip], description: 'warm' });
    expect(f.calls[0].url.pathname).toBe('/v1/voice-changer/v9');
    const vc = f.calls[0].init.body;
    expect(vc.get('model_id')).toBe('eleven_multilingual_sts_v2');
    expect(vc.get('remove_background_noise')).toBe('true');
    expect(JSON.parse(vc.get('voice_settings'))).toEqual({ stability: 0.4, similarity_boost: 0.8, style: 0 });
    expect(vc.get('audio').name).toBe('take.wav');
    const ivc = f.calls[1].init.body;
    expect(ivc.get('name')).toBe('My Voice');
    expect(ivc.getAll('files')).toHaveLength(2);
    expect(res.voice_id).toBe('new1');
  });

  it('lists voices from /v1/voices when /v2/voices does not answer', async () => {
    for (const down of ['network', 502]) {
      const calls = [];
      const f = async (url, init) => {
        const u = new URL(url);
        calls.push(u.pathname);
        if (u.pathname === '/v2/voices') {
          if (down === 'network') throw new TypeError('Load failed');
          return { ok: false, status: 502, headers: { get: () => 'text/html' }, json: async () => { throw new Error('not JSON'); }, text: async () => 'Bad Gateway' };
        }
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => JSON.stringify({ voices: [{ voice_id: 'v1', name: 'Old list', category: 'premade' }] }) };
      };
      const voices = await new Client('k', { fetch: f }).voices();
      expect(voices.map((v) => v.id)).toEqual(['v1']);
      expect(calls).toEqual(['/v2/voices', '/v1/voices']);
    }
    // A rejected key is not an outage: no fallback.
    const f401 = fakeFetch(() => ({ status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } }));
    await expect(new Client('bad', { fetch: f401 }).voices()).rejects.toMatchObject({ status: 401 });
    expect(f401.calls).toHaveLength(1);
  });

  it('follows voice pagination and reports API errors with their message', async () => {
    const f = fakeFetch((url) => {
      if (url.pathname === '/v2/voices') {
        return url.searchParams.get('next_page_token')
          ? { json: { voices: [{ voice_id: 'b', name: 'Bella', category: 'premade' }], has_more: false } }
          : { json: { voices: [{ voice_id: 'a', name: 'Mine', category: 'cloned' }], has_more: true, next_page_token: 't2' } };
      }
      return { status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } };
    });
    const c = new Client('bad', { fetch: f });
    const voices = await c.voices();
    expect(voices.map((v) => v.id)).toEqual(['a', 'b']);
    expect(logic.groupVoices(voices).map((g) => g.label)).toEqual(['My voices', 'ElevenLabs voices']);
    const err = await c.subscription().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Invalid API key');
  });

  it('gets speech with character timestamps, and transcribes with word timestamps', async () => {
    const f = fakeFetch((url) => {
      if (url.pathname.endsWith('/with-timestamps')) return { json: { audio_base64: btoa('\x01\x02\x03'), alignment: { characters: ['H', 'i'], character_start_times_seconds: [0, 0.1], character_end_times_seconds: [0.1, 0.2] } } };
      if (url.pathname === '/v1/speech-to-text') return { json: { text: 'Hi there', language_code: 'en', words: [{ text: 'Hi', start: 0, end: 0.2, type: 'word' }, { text: ' ', start: 0.2, end: 0.3, type: 'spacing' }, { text: 'there', start: 0.3, end: 0.7, type: 'word' }] } };
      return { audio: new ArrayBuffer(1) };
    });
    const c = new Client('k', { fetch: f });
    const tts = await c.textToSpeechTimed({ voiceId: 'v', text: 'Hi' });
    expect(new Uint8Array(tts.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(tts.alignment.characters).toEqual(['H', 'i']);
    expect(f.calls[0].url.searchParams.get('output_format')).toBe('mp3_44100_128');
    const stt = await c.speechToText({ audio: new File([new Uint8Array(4)], 'take.wav') });
    expect(stt.words).toEqual([{ text: 'Hi', start: 0, end: 0.2 }, { text: 'there', start: 0.3, end: 0.7 }]);
    const form = f.calls[1].init.body;
    expect([form.get('model_id'), form.get('timestamps_granularity')]).toEqual(['scribe_v2', 'word']);
  });

  it('falls back to plain speech when the timestamps endpoint is unavailable', async () => {
    const f = fakeFetch((url) => (url.pathname.endsWith('/with-timestamps') ? { status: 404, json: { detail: 'Not found' } } : { audio: new ArrayBuffer(5) }));
    const tts = await new Client('k', { fetch: f }).textToSpeechTimed({ voiceId: 'v', text: 'Hi' });
    expect(tts.bytes.byteLength).toBe(5);
    expect(tts.alignment).toBeNull();
  });

  it('waits and retries when the plan allows no more requests at once', async () => {
    let n = 0;
    const f = fakeFetch(() => (++n < 3
      ? { status: 429, json: { detail: { status: 'too_many_concurrent_requests', message: 'Too many concurrent requests' } } }
      : { audio: new ArrayBuffer(4) }));
    const c = new Client('k', { fetch: f });
    c.retryDelayMs = 1;
    const res = await c.soundEffect({ text: 'boom' });
    expect(res.bytes.byteLength).toBe(4);
    expect(f.calls.length).toBe(3);
  });

  it('classifies errors so the UI can offer the next step', async () => {
    const quota = new Client('k', { fetch: fakeFetch(() => ({ status: 401, json: { detail: { status: 'quota_exceeded', message: 'Quota exceeded' } } })) });
    expect((await quota.subscription().catch((e) => e)).kind).toBe('credits');
    const bad = new Client('k', { fetch: fakeFetch(() => ({ status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid' } } })) });
    expect((await bad.subscription().catch((e) => e)).kind).toBe('key');
  });

  it('turns a network failure into a readable error', async () => {
    const c = new Client('k', { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    const err = await c.subscription().catch((e) => e);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Could not reach ElevenLabs/);
  });
});

describe('audio from a clip on the timeline', () => {
  /** A float32 stereo WAV with a LIST chunk before `data`, as DAWs write them. */
  function floatWav(frames, rate = 48000) {
    const list = 'LIST\x06\x00\x00\x00INFOxx';
    const data = frames.length * 8;
    const buf = new ArrayBuffer(12 + 24 + list.length + 8 + data);
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const str = (o, s) => [...s].forEach((ch, i) => (u8[o + i] = ch.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, buf.byteLength - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true);
    str(36, list);
    const d = 36 + list.length;
    str(d, 'data'); v.setUint32(d + 4, data, true);
    frames.forEach(([l, r], i) => { v.setFloat32(d + 8 + i * 8, l, true); v.setFloat32(d + 12 + i * 8, r, true); });
    return u8;
  }

  it('reads a float WAV header past other chunks and slices only the frames asked for', () => {
    const frames = Array.from({ length: 48 }, (_, i) => [i / 100, -i / 100]);
    const wav = floatWav(frames, 48000);
    const h = logic.parseWavHeader(wav.slice(0, 80));
    expect(h).toMatchObject({ format: 3, channels: 2, sampleRate: 48000, bitsPerSample: 32, blockAlign: 8, dataBytes: 48 * 8 });
    // 10..20 frames at 48 kHz.
    const r = logic.wavByteRange(h, (10 / 48000) * 1e9, (20 / 48000) * 1e9);
    expect(r.frames).toBe(10);
    const [l, rr] = logic.wavSamplesToFloat(h, wav.slice(r.start, r.end));
    expect(l[0]).toBeCloseTo(0.1, 5);
    expect(rr[9]).toBeCloseTo(-0.19, 5);
  });

  it('round-trips the 16-bit WAVs this Add On writes', () => {
    const wav = logic.encodeWav([new Float32Array([0, 0.5, -0.5])], 44100);
    const h = logic.parseWavHeader(wav);
    expect(h).toMatchObject({ format: 1, channels: 1, bitsPerSample: 16, dataOffset: 44, dataBytes: 6 });
    const [ch] = logic.wavSamplesToFloat(h, wav.slice(h.dataOffset));
    expect([...ch].map((x) => Math.round(x * 100) / 100)).toEqual([0, 0.5, -0.5]);
    expect(logic.parseWavHeader(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  async function sessionWithClip() {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    const wav = logic.encodeWav([sine(4)], 44100);
    const source = await session.uploadFile({ bytes: wav, name: 'take.wav' });
    const beat = Luna.TICKS_PER_BEAT; // 0.5 s at the mock's 120 BPM
    // The clip plays source 0.5 s..2.5 s from beat 4 to beat 8.
    await session.insertClip({ trackUid: bass.id, sourceUid: source.id, startTick: 4 * beat, stopTick: 8 * beat, sourceStartNs: 0.5e9, sourceStopNs: 2.5e9 });
    await engine.settled();
    return { engine, session, bass, source, beat };
  }

  it('takes only the selected part of a clip', async () => {
    const { engine, session, bass, source, beat } = await sessionWithClip();
    const ctx = '/sessions/abc/contexts/main';
    engine.setValue(ctx, 'selection_tracks', [bass.id]);
    engine.setValue(ctx, 'selection_start', 5 * beat);
    engine.setValue(ctx, 'selection_stop', 6 * beat);
    await engine.settled();
    const sel = await logic.clipSelection(session);
    expect(sel.track.id).toBe(bass.id);
    expect([sel.startTick, sel.stopTick]).toEqual([5 * beat, 6 * beat]);
    expect([sel.sourceStartNs, sel.sourceStopNs]).toEqual([1e9, 1.5e9]);
    expect(sel.sourceUid).toBe(source.id);
    expect(sel.path.endsWith(`/audio/${source.id}.wav`)).toBe(true);
  });

  it('takes the whole clip under the playhead when nothing is selected', async () => {
    const { engine, session, bass, beat } = await sessionWithClip();
    engine.setValue('/sessions/abc/contexts/main', 'last_selected_track', bass.id);
    engine.setValue('/sessions/abc', 'location', { tick: 6 * beat, bar_beat: { bar: 2, beat: 3, tick: 0 } });
    await engine.settled();
    const span = await logic.clipSelection(session);
    expect([span.startTick, span.stopTick]).toEqual([4 * beat, 8 * beat]);
    expect([span.sourceStartNs, span.sourceStopNs]).toEqual([0.5e9, 2.5e9]);
  });

  it('says so when there is no clip to take', async () => {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    engine.setValue('/sessions/abc/contexts/main', 'last_selected_track', bass.id);
    await engine.settled();
    await expect(logic.clipSelection(session)).rejects.toThrow(/No audio clip under the playhead on "Bass"/);
  });
});

describe('targets, variations, scripts and history', () => {
  async function uploaded(session, name, seconds = 1, channels = 1) {
    const chans = Array.from({ length: channels }, () => sine(seconds));
    const sourceUid = await logic.uploadAudio(session, { wav: logic.encodeWav(chans, 44100), name });
    return { sourceUid, seconds, channels, name };
  }
  // Commands sent while a transaction is open. Clip info must never be asked there: on
  // 2026-11-25 LUNA did not answer get_clip_info mid-transaction and could not quit after.
  const askedInside = (session) => {
    const asked = [];
    const post = session.post.bind(session);
    session.post = (cmd, payload) => {
      if (session.batching) asked.push(cmd);
      return post(cmd, payload);
    };
    return asked;
  };
  const clipsOn = async (session, track) => {
    const pl = session.playlistFor(track);
    await pl.clips.load();
    return pl.clips.items.map((c) => c.start.value);
  };

  it('places at the target taken when Generate was clicked, not where the playhead is now', async () => {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    engine.setValue('/sessions/abc/contexts/main', 'last_selected_track', bass.id);
    engine.setValue('/sessions/abc', 'location', { tick: 8 * Luna.TICKS_PER_BEAT, bar_beat: { bar: 3, beat: 1, tick: 0 } });
    await engine.settled();
    const target = logic.captureTarget(session, 'selected');
    expect(target).toMatchObject({ trackId: bass.id, trackName: 'Bass', tick: 8 * Luna.TICKS_PER_BEAT });
    expect(logic.targetText(target)).toMatch(/^"Bass" at 3\|1\|/);
    // The user moves on while the request runs.
    engine.setValue('/sessions/abc', 'location', { tick: 0, bar_beat: { bar: 1, beat: 1, tick: 0 } });
    await engine.settled();
    const item = await uploaded(session, 'SFX - door');
    await logic.placeSource(session, item, target);
    await engine.settled();
    expect(await clipsOn(session, bass)).toEqual([8 * Luna.TICKS_PER_BEAT]);
  });

  it('places variations on tracks of their own', async () => {
    const { engine, session } = await connected();
    const before = session.tracks.items.length;
    const items = [await uploaded(session, 'SFX - hit #1', 0.5), await uploaded(session, 'SFX - hit #2', 0.7)];
    const asked = askedInside(session);
    const placed = await logic.placeVariations(session, items, logic.captureTarget(session, 'new', 0), 'tracks');
    await engine.settled();
    expect(session.tracks.items.length).toBe(before + 2);
    expect(placed.map((p) => p.track.name.value)).toEqual(['SFX - hit #1', 'SFX - hit #2']);
    expect(engine.transactions).toEqual(['begin', 'commit']);
    expect(asked).not.toContain('new_track');
    expect(asked).not.toContain('get_clip_info');
  });

  it('takes away the empty new tracks when placing on them fails', async () => {
    const { session } = await connected();
    const before = session.tracks.items.length;
    const items = [await uploaded(session, 'SFX - hit #1', 0.5), await uploaded(session, 'SFX - hit #2', 0.7)];
    const insert = session.insertClip.bind(session);
    let n = 0;
    session.insertClip = (o) => (++n === 2 ? Promise.reject(new Error('LUNA did not answer')) : insert(o));
    await expect(logic.placeVariations(session, items, logic.captureTarget(session, 'new', 0), 'tracks')).rejects.toThrow(/did not answer/);
    expect(session.tracks.items.length).toBe(before);
  });

  it('says how many more undos the new tracks take', async () => {
    expect(logic.undoText(0)).toBe('Undo removes it.');
    expect(logic.undoText(1)).toMatch(/new track takes one more Undo/);
    expect(logic.undoText(2)).toMatch(/each of the 2 new tracks/);
    const { session } = await connected();
    const items = [await uploaded(session, 'SFX - hit #1', 0.5), await uploaded(session, 'SFX - hit #2', 0.7)];
    expect(logic.madeTracks(await logic.placeVariations(session, items, logic.captureTarget(session, 'new', 0), 'tracks'))).toBe(2);
  });

  it('never makes a track inside a transaction', async () => {
    const { session } = await connected();
    await session.transaction('x', async () => {
      expect(() => logic.newTrackFor(session, 'T', 1)).toThrow(/inside a transaction/);
    });
  });

  it('places variations as playlists of one track and keeps the first one playing', async () => {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    engine.setValue('/sessions/abc/contexts/main', 'last_selected_track', bass.id);
    await engine.settled();
    const activeBefore = session.playlistFor(bass).id;
    const items = [await uploaded(session, 'Take #1'), await uploaded(session, 'Take #2'), await uploaded(session, 'Take #3')];
    const placed = await logic.placeVariations(session, items, logic.captureTarget(session, 'selected', 0), 'playlists');
    await engine.settled();
    await session.playlists.load();
    const lanes = session.playlists.items.filter((p) => p.trackUid.value === bass.id);
    expect(lanes.length).toBe(3);
    expect(new Set(placed.map((p) => p.track.id))).toEqual(new Set([bass.id]));
    expect(session.playlistFor(bass).id).toBe(activeBefore);
    expect(await clipsOn(session, bass)).toEqual([0]);
    for (const lane of lanes) {
      await lane.clips.load();
      expect(lane.clips.items.length).toBe(1);
    }
  });

  it('lays a script out line after line, with speakers on their own tracks', async () => {
    const { engine, session } = await connected();
    const voices = [{ id: 'v-alice', name: 'Alice - Clear, Engaging Educator' }, { id: 'v-bob', name: 'Bob' }];
    const lines = logic.parseScript('Alice: Hello there.\n\nBob: Hi!\nNote: no such voice\nPlain line', voices);
    expect(lines).toEqual([
      { text: 'Hello there.', speaker: 'Alice', voiceId: 'v-alice' },
      { text: 'Hi!', speaker: 'Bob', voiceId: 'v-bob' },
      { text: 'Note: no such voice', speaker: null, voiceId: null },
      { text: 'Plain line', speaker: null, voiceId: null },
    ]);
    const items = [];
    for (const [i, l] of lines.entries()) items.push({ ...(await uploaded(session, `Line ${i + 1}`, 1)), speaker: l.speaker });
    const asked = askedInside(session);
    const placed = await logic.placeScript(session, items, logic.captureTarget(session, 'new', 0), { layout: 'sequential', gapSeconds: 0.5 });
    expect(asked.filter((c) => c === 'new_track' || c === 'get_clip_info')).toEqual([]);
    await engine.settled();
    const beat = Luna.TICKS_PER_BEAT; // 1 s of audio + 0.5 s gap = 3 beats at 120 BPM
    expect(placed.map((p) => p.startTick)).toEqual([0, 3 * beat, 6 * beat, 9 * beat]);
    expect(placed.map((p) => p.track.name.value)).toEqual(['TTS - Alice', 'TTS - Bob', 'TTS - Script', 'TTS - Script']);
    const script = session.tracks.items.find((t) => t.name.value === 'TTS - Script');
    expect(await clipsOn(session, script)).toEqual([6 * beat, 9 * beat]);
    expect(engine.transactions).toEqual(['begin', 'commit']);
  });

  it('puts changed clips back on a chosen track, each where its clip was', async () => {
    const { engine, session } = await connected();
    const vocal = session.tracks.items.find((t) => t.name.value === 'Vocal');
    const beat = Luna.TICKS_PER_BEAT;
    const items = [{ ...(await uploaded(session, 'c1', 1)), tick: 2 * beat }, { ...(await uploaded(session, 'c2', 1)), tick: 10 * beat }];
    const onVocal = await logic.placeScript(session, items, { trackId: vocal.id, tick: 0 }, { layout: 'explicit', trackName: 'Voice - X' });
    await engine.settled();
    expect(onVocal.map((p) => p.track.id)).toEqual([vocal.id, vocal.id]);
    expect(await clipsOn(session, vocal)).toEqual([2 * beat, 10 * beat]);
    const before = session.tracks.items.length;
    const onNew = await logic.placeScript(session, items, { trackId: null, tick: 0 }, { layout: 'explicit', trackName: 'Voice - X' });
    await engine.settled();
    expect(session.tracks.items.length).toBe(before + 1);
    expect(onNew[0].track.name.value).toBe('Voice - X');
  });

  it('places script lines on markers, and says when there are too few', async () => {
    const { engine, session } = await connected();
    const beat = Luna.TICKS_PER_BEAT;
    await session.addMarker(4 * beat, 'A');
    await session.addMarker(12 * beat, 'B');
    const items = [await uploaded(session, 'L1'), await uploaded(session, 'L2')];
    const placed = await logic.placeScript(session, items, logic.captureTarget(session, 'new', 0), { layout: 'markers' });
    await engine.settled();
    expect(placed.map((p) => p.startTick)).toEqual([4 * beat, 12 * beat]);
    expect(await clipsOn(session, placed[0].track)).toEqual([4 * beat, 12 * beat]);
    const three = [...items, await uploaded(session, 'L3')];
    await expect(logic.placeScript(session, three, logic.captureTarget(session, 'new', 0), { layout: 'markers' })).rejects.toThrow(/2 markers after the playhead but 3 lines/);
  });

  it('starts a result at the playhead, the selection start or the next marker', async () => {
    const { engine, session } = await connected();
    const beat = Luna.TICKS_PER_BEAT;
    expect(logic.startTick(session, 'playhead')).toEqual({ tick: 0, note: '' });
    expect(logic.startTick(session, 'selection').note).toMatch(/No selection/);
    engine.setValue('/sessions/abc/contexts/main', 'selection_start', 8 * beat);
    engine.setValue('/sessions/abc/contexts/main', 'selection_stop', 16 * beat);
    await engine.settled();
    expect(logic.startTick(session, 'selection')).toEqual({ tick: 8 * beat, note: '' });
    await session.markers.load();
    expect(logic.startTick(session, 'marker').note).toMatch(/No marker/);
    await session.addMarker(4 * beat, 'Verse');
    await engine.settled();
    await session.markers.load();
    expect(logic.startTick(session, 'marker')).toEqual({ tick: 4 * beat, note: '' });
    expect(logic.destinationText(session, 'new', 'marker')).toBe('A new track at the next marker');
    expect(logic.destinationText(session, 'new', 'selection')).toBe('A new track at the selection start');
  });

  it('keeps a generation history in the session', async () => {
    const { session } = await connected();
    const h = logic.history(session, 'com.vbilous.elevenlabs');
    await h.load();
    await h.add({ id: 'g1', kind: 'sfx', name: 'SFX - door', createdAt: 1, sourceUid: 's1' });
    await h.add({ id: 'g2', kind: 'tts', name: 'Alice - hi', createdAt: 2, sourceUid: 's2' });
    await h.update('g1', { placed: true });
    expect(h.list().map((e) => e.id)).toEqual(['g2', 'g1']);
    expect(h.list()[1].placed).toBe(true);
    expect(logic.entryForSource(h.list(), 's2').name).toBe('Alice - hi');
    await h.remove('g2');
    expect(h.list().map((e) => e.id)).toEqual(['g1']);
    await h.clear();
    expect(h.list()).toEqual([]);
  });

  it('names keys, estimates credits and reads the selection length', async () => {
    expect(logic.keyName(0, false)).toBe('C major');
    expect(logic.keyName(3, true)).toBe('F# minor');
    expect(logic.keyName(-2, false)).toBe('Bb major');
    const model = { model_rates: { character_cost_multiplier: 0.5 }, maximum_text_length_per_request: 100 };
    expect(logic.creditEstimate(120, model, { character_count: 990, character_limit: 1000 })).toEqual({ credits: 60, remaining: 10, maxChars: 100, overLimit: true, overQuota: true });
    const { engine, session } = await connected();
    expect(await logic.selectionSeconds(session)).toBeNull();
    engine.setValue('/sessions/abc/contexts/main', 'selection_start', 0);
    engine.setValue('/sessions/abc/contexts/main', 'selection_stop', 16 * Luna.TICKS_PER_BEAT);
    await engine.settled();
    expect(await logic.selectionSeconds(session)).toBe(8);
    expect(await logic.musicContext(session, 0)).toMatch(/^120 BPM/);
  });
});

describe('placing audio in LUNA', () => {
  it('puts a clip on the selected audio track at the playhead as one undo step', async () => {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    engine.setValue('/sessions/abc/contexts/main', 'last_selected_track', bass.id);
    await engine.settled();
    expect(logic.destinationText(session, 'selected')).toBe('"Bass" at the playhead');

    const wav = logic.encodeWav([sine(1)], 44100);
    const placed = await logic.placeAudio(session, { wav, seconds: 1, channels: 1, name: 'Speech - Hello', mode: 'selected' });
    await engine.settled();
    expect(placed.track.id).toBe(bass.id);
    expect(placed.startTick).toBe(0);
    // 1 s at the mock's 120 BPM is two beats.
    expect(placed.stopTick).toBe(2 * Luna.TICKS_PER_BEAT);
    const pl = session.playlistFor(bass);
    await pl.clips.load();
    expect(pl.clips.items.map((c) => c.start.value)).toEqual([0]);
    expect(engine.transactions).toEqual(['begin', 'commit']);
  });

  it('makes a new stereo track when asked', async () => {
    const { engine, session } = await connected();
    const before = session.tracks.items.length;
    const wav = logic.encodeWav([sine(0.5), sine(0.5)], 44100);
    const placed = await logic.placeAudio(session, { wav, seconds: 0.5, channels: 2, name: 'Music - lofi', mode: 'new' });
    await engine.settled();
    expect(session.tracks.items.length).toBe(before + 1);
    expect(placed.track.name.value).toBe('Music - lofi');
  });

  it('recognises an ElevenLabs key on the clipboard and nothing else', () => {
    const key = `sk_${'0123456789abcdef'.repeat(3)}`;
    expect(logic.keyFromClipboard(`  ${key}\n`)).toBe(key);
    expect(logic.keyFromClipboard(`${key}_eu`)).toBe(`${key}_eu`);
    expect(logic.keyFromClipboard('sk_live_ABCDEF1234567890XYZ')).toBeNull(); // another vendor's key
    expect(logic.keyFromClipboard('hello')).toBeNull();
    expect(logic.keyFromClipboard(undefined)).toBeNull();
  });

  it('names clips from the prompt and formats the quota', () => {
    expect(logic.clipName('SFX', '  a   heavy wooden door slams shut in a big hall  ')).toBe('SFX - a heavy wooden door slams shut i…');
    expect(logic.quotaText({ tier: 'creator', character_count: 1234, character_limit: 100000 })).toBe('creator plan · 1,234 / 100,000 credits used');
  });
});

describe('keyboard shortcuts and Help', () => {
  it('has one action per key, matches events, and documents every shortcut', async () => {
    await import('../help.js');
    const H = globalThis.AddOnHelp;
    const labels = H.SHORTCUTS.map((s) => H.keyLabel(s));
    expect(labels.filter((k, i) => labels.indexOf(k) !== i)).toEqual([]);
    const ev = (o) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, key: '', code: '', ...o });
    const mod = H.isMac ? { metaKey: true } : { ctrlKey: true };
    expect(H.match(ev({ ...mod, key: 'Enter' })).action).toBe('generate');
    expect(H.match(ev({ ...mod, key: '3' })).action).toBe('tab:music');
    expect(H.match(ev({ ...mod, shiftKey: true, key: 'U' })).action).toBe('every-clip');
    expect(H.match(ev({ key: 'p' })).action).toBe('preview-latest');
    expect(H.match(ev({ key: 'x' }))).toBeUndefined();
    const keysPage = H.sectionHtml('keys');
    for (const s of H.SHORTCUTS) expect(keysPage).toContain(s.label.replace(/&/g, '&amp;').slice(0, 20));
    for (const s of H.SECTIONS) expect(H.sectionHtml(s.id)).toContain(`<h2>${s.title}</h2>`);
  });
});

await import('../lyrics.js');
describe('lyrics: import, re-voice timing, LRC', () => {
  const Ly = globalThis.AddOnLyrics;
  const beat = Luna.TICKS_PER_BEAT; // 0.5 s at the mock's 120 BPM

  /** A session whose "Dialog" track plays source 2 s..12 s from beat 8 (4 s), with two lyric lines in the file. */
  async function withLyrics() {
    const { engine, luna, session } = await connected();
    const dialog = session.tracks.items.find((t) => t.name.value === 'Vocal');
    const sourceUid = await logic.uploadAudio(session, { wav: logic.encodeWav([sine(12)], 44100), name: 'dialog' });
    await session.insertClip({ trackUid: dialog.id, sourceUid, startTick: 8 * beat, stopTick: 28 * beat, sourceStartNs: 2e9, sourceStopNs: 12e9 });
    const words = (ws) => JSON.stringify({ words: ws.map(([word, offset, length]) => ({ word, offset: offset * 1e9, length: length * 1e9 })) });
    engine.addNode('/sessions/abc/lyrics');
    // Line 1 at 0.5 s in the file: before what the clip plays, so it is not imported.
    engine.addNode('/sessions/abc/lyrics/1', { properties: { type: 'lyric', rowid: 1, source_uid: sourceUid, units: 1, location: 0.5e9, length: 1e9, text: 'Too early.', words: words([['Too', 0, 0.4], ['early.', 0.5, 0.5]]) } });
    // Line 2 at 3 s in the file = 1 s into the clip = timeline 5 s = beat 10.
    engine.addNode('/sessions/abc/lyrics/2', { properties: { type: 'lyric', rowid: 2, source_uid: sourceUid, units: 1, location: 3e9, length: 2e9, text: 'Hello there world.', words: words([['Hello', 0, 0.5], ['there', 0.6, 0.4], ['world.', 1.5, 0.5]]) } });
    engine.addNode('/sessions/abc/lyrics/3', { properties: { type: 'lyric', rowid: 3, source_uid: sourceUid, units: 1, location: 8e9, length: 1e9, text: 'Second line.', words: words([['Second', 0, 0.5], ['line.', 0.5, 0.5]]) } });
    await engine.settled();
    engine.setValue('/sessions/abc/contexts/main', 'selection_tracks', [dialog.id]);
    engine.setValue('/sessions/abc/contexts/main', 'selection_start', 8 * beat);
    engine.setValue('/sessions/abc/contexts/main', 'selection_stop', 28 * beat);
    await engine.settled();
    return { engine, luna, session, dialog, sourceUid };
  }

  it('reads LUNA lyrics and places them through the clip that plays their file', async () => {
    const { luna, session, dialog } = await withLyrics();
    const all = await Ly.read(session, luna.raw);
    expect(all.map((l) => l.text)).toEqual(['Too early.', 'Hello there world.', 'Second line.']);
    const { lines, clips } = await Ly.inSelection(session, all);
    expect(clips).toBe(1);
    expect(lines.map((l) => l.text)).toEqual(['Hello there world.', 'Second line.']);
    expect([lines[0].startTick, lines[0].stopTick]).toEqual([10 * beat, 14 * beat]); // 5 s..7 s
    expect(lines[0].words.map((w) => w.startTick)).toEqual([10 * beat, 10 * beat + 0.6 * 2 * beat, 13 * beat]);
    expect(lines[1].startTick).toBe(20 * beat); // file 8 s = clip +6 s = timeline 10 s
    expect(lines[0].trackId).toBe(dialog.id);
  });

  it('turns character alignment into words and plans a speed retry only when needed', () => {
    const text = 'Hello there';
    const alignment = { characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.1), character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.1) };
    expect(Ly.wordsFromAlignment(alignment)).toEqual([
      { text: 'Hello', start: 0, end: expect.closeTo(0.5, 5) },
      { text: 'there', start: expect.closeTo(0.6, 5), end: expect.closeTo(1.1, 5) },
    ]);
    expect(Ly.fitPlan(2.2, 2).retrySpeed).toBeNull(); // 10% off: stretch is fine
    expect(Ly.fitPlan(3, 2).retrySpeed).toBe(1.2); // 50% too long: faster, capped at 1.2
    expect(Ly.fitPlan(1, 2, 1).retrySpeed).toBe(0.7); // far too short: slower, floored at 0.7
    expect(Ly.matchWords([{ text: 'Hello,' }], [{ text: 'hello' }])).not.toBeNull();
    expect(Ly.matchWords([{ text: 'Hello' }], [{ text: 'Hi' }])).toBeNull();
  });

  it('places re-voiced lines at their original timing, fitted, and word by word', async () => {
    const { engine, luna, session } = await withLyrics();
    const { lines } = await Ly.inSelection(session, await Ly.read(session, luna.raw));
    const items = [];
    for (const line of lines) {
      const sourceUid = await logic.uploadAudio(session, { wav: logic.encodeWav([sine(1.5)], 44100), name: line.text });
      const genWords = Ly.splitWords(line.text).map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.4 }));
      items.push({ sourceUid, seconds: 1.5, channels: 1, name: line.text, line, genWords });
    }
    const clipsOf = async (track) => { const pl = session.playlistFor(track); await pl.clips.load(); return pl.clips.items.map((c) => [c.start.value, c.stop.value]); };

    const a = await Ly.place(session, items, { mode: 'start', trackName: 'A' });
    await engine.settled();
    expect(await clipsOf(a.track)).toEqual([[10 * beat, 13 * beat], [20 * beat, 23 * beat]]); // 1.5 s natural

    const b = await Ly.place(session, items, { mode: 'fit', trackName: 'B' });
    await engine.settled();
    // 1.5 s aimed at 2 s and at 1 s: stretched and squeezed only as far as the limits (1.25x, 0.8x).
    expect(await clipsOf(b.track)).toEqual([[10 * beat, 13.75 * beat], [20 * beat, Math.round(22.4 * beat)]]);
    expect(b.limited).toBe(2);

    const c = await Ly.place(session, items, { mode: 'words', trackName: 'C' });
    await engine.settled();
    expect(c.fallbacks).toBe(0);
    for (const call of engine.requests.filter((r) => r.path.endsWith('/insert_clip'))) expect(call.data?.alg_type).toBeUndefined();
    const wordClips = await clipsOf(c.track);
    expect(wordClips.length).toBe(5); // 3 + 2 words
    expect(wordClips.map(([s]) => s).slice(0, 3)).toEqual(lines[0].words.map((w) => w.startTick));
  });

  it('never stretches a line further than a voice can take', () => {
    expect(Ly.limitedLength(2.93, 9.64)).toEqual({ seconds: expect.closeTo(3.6625, 4), limited: true }); // the 3.3x case from LUNA
    expect(Ly.limitedLength(2, 2.2)).toEqual({ seconds: expect.closeTo(2.2, 6), limited: false });
    expect(Ly.limitedLength(3, 1)).toEqual({ seconds: expect.closeTo(2.4, 6), limited: true });
  });

  it('writes LRC, plain and word by word, and groups transcribed words into lines', () => {
    const lines = [
      { start: 5, end: 7, text: 'Hello there world.', words: [{ text: 'Hello', start: 5 }, { text: 'there', start: 5.6 }, { text: 'world.', start: 6.5 }] },
      { start: 70.25, end: 71, text: 'Second line.' },
    ];
    expect(Ly.formatLrc(lines, { title: 'Dialog' })).toBe('[ti:Dialog]\n[re:AI Voice & Sound Unit]\n[00:05.00]Hello there world.\n[00:07.00]\n[01:10.25]Second line.\n[01:11.00]\n');
    expect(Ly.formatLrc(lines, { words: true }).split('\n')[1]).toBe('[00:05.00] <00:05.00>Hello <00:05.60>there <00:06.50>world.');
    const grouped = Ly.linesFromWords([
      { text: 'One', start: 0, end: 0.3 }, { text: 'two.', start: 0.4, end: 0.7 },
      { text: 'Three', start: 0.8, end: 1 }, { text: 'four', start: 3, end: 3.3 },
    ]);
    expect(grouped.map((l) => l.text)).toEqual(['One two.', 'Three', 'four']);
  });

  it('writes lines into LUNA lyrics for a source, in nanoseconds into the file', async () => {
    const { session } = await connected();
    const posts = [];
    const raw = { post: async (path, data) => { posts.push({ path, data }); return null; } };
    const n = await Ly.write(session, raw, 'src1', [{ text: 'Hi there', start: 1.5, end: 2.5, words: [{ text: 'Hi', start: 1.5, end: 1.8 }, { text: 'there', start: 1.9, end: 2.5 }] }]);
    expect(n).toBe(1);
    expect(posts[0].path).toBe('/sessions/abc/set_lyric');
    expect(posts[0].data).toMatchObject({ session_uid: 'abc', source_uid: 'src1', text: 'Hi there', location: 1.5e9, length: 1e9 });
    expect(JSON.parse(posts[0].data.words).words[1]).toEqual({ word: 'there', offset: expect.closeTo(0.4e9, -3), length: expect.closeTo(0.6e9, -3) });
  });
});

describe('Help search', () => {
  it('finds sections that hold every word, best first, with marked excerpts', () => {
    const H = globalThis.AddOnHelp;
    const lrc = H.search('lrc');
    expect(lrc[0].id).toBe('lyrics'); // the title says it
    expect(lrc[0].snippets[0]).toMatch(/<mark>LRC<\/mark>/i);
    expect(H.search('lrc word timing').every((r) => /word/i.test(H.sectionText(r.id)) && /timing/i.test(H.sectionText(r.id)))).toBe(true);
    expect(H.search('"place all"').map((r) => r.id)).toContain('results');
    expect(H.search('xyzzy')).toEqual([]);
    expect(H.search('a')).toEqual([]); // single letters are not searched
    // Shortcut labels are searchable too, and HTML in excerpts is escaped.
    expect(H.search("clear this tab's results")[0].id).toBe('keys');
    expect(H.search('lyrics & lrc').length).toBeGreaterThan(0);
    for (const r of H.search('key')) for (const s of r.snippets) expect(s).not.toMatch(/<(?!\/?mark>)/);
  });
});

describe('text files for Text to Speech', () => {
  it('reads SubRip subtitles as timed lines, without markup', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> there,\r\nfriend.\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\n{\\an8}Second line\r\n';
    const r = logic.parseTextFile('scene.srt', srt);
    expect(r.kind).toBe('subtitles');
    expect(r.cues).toEqual([{ start: 1, end: 3.5, text: 'Hello there, friend.' }, { start: 62.25, end: 64, text: 'Second line' }]);
    expect(r.text).toBe('Hello there, friend.\nSecond line');
  });

  it('reads WebVTT, turning <v Name> into a speaker the script mode knows', () => {
    const vtt = 'WEBVTT\n\nNOTE written by hand\n\nintro\n00:05.000 --> 00:07.500 align:start\n<v Alice>Hi Bob.\n\n00:08.000 --> 00:09.000\n<v.loud Bob>Hi!</v>\n';
    const r = logic.parseTextFile('dialog.vtt', vtt);
    expect(r.cues).toEqual([{ start: 5, end: 7.5, text: 'Alice: Hi Bob.' }, { start: 8, end: 9, text: 'Bob: Hi!' }]);
  });

  it('reads LRC, plain and enhanced, with repeated stamps and the blank line that ends a line', () => {
    const lrc = '[ti:Song]\n[ar:Someone]\n[00:12.00][01:12.00]Chorus line\n[00:15.50] <00:15.50>Word <00:16.10>timed\n[00:18.00]\n';
    const r = logic.parseTextFile('song.lrc', lrc);
    expect(r.kind).toBe('lrc');
    expect(r.cues).toEqual([
      { start: 12, end: 15.5, text: 'Chorus line' },
      { start: 15.5, end: 18, text: 'Word timed' },
      { start: 72, end: null, text: 'Chorus line' },
    ]);
  });

  it('reads plain text and Markdown as text, and decodes UTF-16 and BOMs', () => {
    expect(logic.parseTextFile('a.txt', 'Line one  \r\n\r\n\r\n\r\nLine two\n').text).toBe('Line one\n\nLine two');
    const md = '# Title\n\nSome **bold** and _soft_ words, a [link](https://x.y) and `code`.\n\n- item one\n- item two\n\n```\nskip me\n```\n';
    expect(logic.parseTextFile('notes.md', md).text).toBe('Title\n\nSome bold and soft words, a link and code.\n\nitem one\nitem two');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Žodis'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(logic.decodeText(utf16)).toBe('Žodis');
    expect(logic.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69]))).toBe('Hi');
    expect(logic.decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café'); // Windows-1252
  });

  it('turns timed cues into lines on the session timeline', async () => {
    const { session } = await connected();
    await session.musical.ready();
    const lines = logic.cuesToLines(session, [{ start: 1, end: 2, text: 'a' }, { start: 4, end: null, text: 'b' }]);
    expect(lines.map((l) => [l.startTick, l.stopTick])).toEqual([[2 * Luna.TICKS_PER_BEAT, 4 * Luna.TICKS_PER_BEAT], [8 * Luna.TICKS_PER_BEAT, 14 * Luna.TICKS_PER_BEAT]]);
  });
});

describe('RTF for Text to Speech', () => {
  it('reads TextEdit RTF as plain text, without fonts, colours or page settings', () => {
    // The file a user dropped from TextEdit (macOS Cocoa RTF).
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 The birch canoe slid on the smooth planks. Glue the sheet to the dark blue background.\
Four hours of steady work faced us. A large size in stockings is hard to sell.}`;
    const r = logic.parseTextFile('Harvard.rtf', rtf);
    expect(r.text).toBe('The birch canoe slid on the smooth planks. Glue the sheet to the dark blue background.\nFour hours of steady work faced us. A large size in stockings is hard to sell.');
    // The same content saved under .txt is still recognised as RTF.
    expect(logic.parseTextFile('Harvard.txt', rtf).text).toBe(r.text);
  });

  it('decodes accents, Unicode, escapes and paragraph marks', () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\uc1 Caf\'e9 \u268?esky\par Tab\tab here \{braces\} and a\~space\line next{\*\generator Word;}\emdash end}`;
    expect(logic.rtfToText(rtf)).toBe('Café Česky\nTab\there {braces} and a space\nnext—end'); // the space after a control word is its delimiter
  });
});

describe('untrusted names and History data', () => {
  const session = { sessionPackagePath: { value: '/Users/me/Song.luna/' } };

  it('builds a source path only from a real source uid', () => {
    expect(logic.sourcePath(session, '01611158500247d095aa69212b39a13d')).toBe('/Users/me/Song.luna/audio/01611158500247d095aa69212b39a13d.wav');
    for (const bad of ['../../.ssh/id_rsa', 'a/b', 'a\\b', '..', '', null, 42, 'x'.repeat(129)]) {
      expect(() => logic.sourcePath(session, bad)).toThrow(/does not name an audio file/);
    }
  });

  it('makes safe file names from prompts and voice names', () => {
    expect(logic.safeFileName('Rachel · Hello')).toBe('Rachel · Hello');
    expect(logic.safeFileName('../../etc/passwd')).toBe('etc passwd');
    expect(logic.safeFileName('a\u0000b\nc:d*e?')).toBe('a b c d e');
    expect(logic.safeFileName('...')).toBe('ElevenLabs');
    expect(logic.safeFileName(undefined)).toBe('ElevenLabs');
    expect(logic.safeFileName('x'.repeat(300))).toHaveLength(100);
  });

  it('uploads generated audio under a safe file name', async () => {
    let seen;
    const fake = { uploadFile: async ({ name }) => { seen = name; return { id: 'abc' }; } };
    await logic.uploadAudio(fake, { wav: new Uint8Array(4), name: '../evil' });
    expect(seen).toBe('evil.wav');
  });
});
