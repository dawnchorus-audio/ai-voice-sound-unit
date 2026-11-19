// ElevenLabs REST client: plain fetch, no DOM, so tests can drive it with a fake fetch.
// Every audio call returns { bytes: ArrayBuffer, contentType } and asks for MP3 at
// 44.1 kHz / 128 kbps, the best format every ElevenLabs plan can use.

const ElevenLabs = (() => {
  const BASE = 'https://api.elevenlabs.io';
  const OUTPUT_FORMAT = 'mp3_44100_128';

  /**
   * An API error with the HTTP status, ElevenLabs' own message, and `kind`, which the UI
   * turns into a next step: 'key' (bad or missing key), 'credits' (quota used up),
   * 'busy' (too many requests at once), 'network', or 'other'.
   */
  class ApiError extends Error {
    constructor(status, message, code) {
      super(message);
      this.name = 'ElevenLabsError';
      this.status = status;
      this.code = code;
      const c = String(code ?? '');
      this.kind = status === 0 ? 'network'
        : c.includes('quota') || c.includes('credit') || status === 402 ? 'credits' // ElevenLabs answers 401 for both
        : status === 401 || c === 'invalid_api_key' || c === 'missing_permissions' ? 'key'
        : status === 429 ? 'busy'
        : 'other';
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** ElevenLabs puts the reason in `detail` (a string, an object or a validation list). */
  function messageFrom(status, body) {
    const d = body && body.detail;
    if (typeof d === 'string') return { message: d };
    if (Array.isArray(d)) return { message: d.map((x) => x.msg ?? JSON.stringify(x)).join('; ') };
    if (d && typeof d === 'object') return { message: d.message ?? JSON.stringify(d), code: d.status ?? d.code };
    if (status === 401) return { message: 'The API key was rejected.' };
    if (status === 429) return { message: 'Too many requests or quota used up. Try again shortly.' };
    return { message: `ElevenLabs answered HTTP ${status}.` };
  }

  class Client {
    /**
     * @param {string} apiKey
     * @param {{ fetch?: typeof fetch, base?: string }} [options]
     */
    constructor(apiKey, options = {}) {
      if (!apiKey) throw new Error('No ElevenLabs API key');
      this.apiKey = apiKey;
      this.base = options.base ?? BASE;
      this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    }

    async request(method, path, { query, json, form, audio = false, signal } = {}) {
      const url = new URL(this.base + path);
      for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      const headers = { 'xi-api-key': this.apiKey };
      let body;
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (form) {
        body = form; // the browser sets the multipart boundary
      }
      if (audio) headers.Accept = 'audio/mpeg';
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await this.fetch(url.toString(), { method, headers, body, signal });
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          throw new ApiError(0, `Could not reach ElevenLabs (${e && e.message ? e.message : 'network error'}). Check the internet connection.`);
        }
        if (res.ok) break;
        let parsed = null;
        try { parsed = await res.json(); } catch { /* not JSON */ }
        const { message, code } = messageFrom(res.status, parsed);
        // Too many requests at once (the plan's concurrency limit): wait and try again.
        const concurrent = res.status === 429 && /concurren|too_many|system_busy/i.test(String(code ?? '') + message);
        if (concurrent && attempt < (this.retries ?? 4)) {
          await sleep((this.retryDelayMs ?? 1500) * (attempt + 1));
          if (signal && signal.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
          continue;
        }
        throw new ApiError(res.status, message, code);
      }
      if (audio) return { bytes: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }

    /** Plan and character quota; also proves the key works. */
    subscription() {
      return this.request('GET', '/v1/user/subscription');
    }

    /** Models, filtered to the ones that can do `capability` ('tts' | 'sts'). */
    async models(capability) {
      const list = await this.request('GET', '/v1/models');
      const arr = Array.isArray(list) ? list : [];
      if (capability === 'tts') return arr.filter((m) => m.can_do_text_to_speech);
      if (capability === 'sts') return arr.filter((m) => m.can_do_voice_conversion);
      return arr;
    }

    /**
     * Every voice the account can use, following v2 pagination. When /v2/voices does not answer
     * (a network error or a 5xx: on 2026-11-18 it returned 502 without CORS headers, which a page
     * sees as "Load failed"), the older /v1/voices, which lists them all at once, is used instead.
     */
    async voices({ maxPages = 20 } = {}) {
      const toVoice = (v) => ({ id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url ?? null, labels: v.labels ?? {} });
      const out = [];
      let token = null;
      try {
        for (let page = 0; page < maxPages; page++) {
          const res = await this.request('GET', '/v2/voices', {
            query: { page_size: 100, include_total_count: false, next_page_token: token ?? undefined },
          });
          for (const v of res.voices ?? []) out.push(toVoice(v));
          if (!res.has_more || !res.next_page_token) break;
          token = res.next_page_token;
        }
        return out;
      } catch (e) {
        if (!(e instanceof ApiError) || !(e.status === 0 || e.status >= 500)) throw e;
        const res = await this.request('GET', '/v1/voices');
        return (res.voices ?? []).map(toVoice);
      }
    }

    /** Text to Speech. */
    textToSpeech({ voiceId, text, modelId, voiceSettings, languageCode, signal }) {
      if (!voiceId) throw new Error('Choose a voice');
      if (!text || !text.trim()) throw new Error('Enter some text');
      const json = { text, model_id: modelId || undefined };
      if (voiceSettings) json.voice_settings = voiceSettings;
      if (languageCode) json.language_code = languageCode;
      return this.request('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        query: { output_format: OUTPUT_FORMAT }, json, audio: true, signal,
      });
    }

    /**
     * Text to Speech with timestamps: the same request, answered as JSON with the audio in
     * base64 and when each character is spoken. Returns { bytes, contentType, alignment }.
     * Falls back to plain Text to Speech (alignment null) if the endpoint refuses the request
     * for a reason other than the key, credits or the text itself.
     */
    async textToSpeechTimed({ voiceId, text, modelId, voiceSettings, languageCode, signal }) {
      if (!voiceId) throw new Error('Choose a voice');
      if (!text || !text.trim()) throw new Error('Enter some text');
      const json = { text, model_id: modelId || undefined };
      if (voiceSettings) json.voice_settings = voiceSettings;
      if (languageCode) json.language_code = languageCode;
      try {
        const res = await this.request('POST', `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
          query: { output_format: OUTPUT_FORMAT }, json, signal,
        });
        if (!res.audio_base64) throw new ApiError(500, 'ElevenLabs sent no audio');
        return { bytes: base64ToBytes(res.audio_base64).buffer, contentType: 'audio/mpeg', alignment: res.alignment ?? res.normalized_alignment ?? null };
      } catch (e) {
        if (e.name === 'AbortError' || ['key', 'credits', 'network', 'busy'].includes(e.kind) || e.status === 400) throw e;
        const plain = await this.textToSpeech({ voiceId, text, modelId, voiceSettings, languageCode, signal });
        return { ...plain, alignment: null };
      }
    }

    /**
     * Speech to Text (Scribe) with word timestamps. Returns { text, language, words: { text, start, end }[] }
     * with spacing and audio events left out.
     */
    async speechToText({ audio, modelId = 'scribe_v2', languageCode, signal }) {
      if (!audio) throw new Error('No audio to transcribe');
      const form = new FormData();
      form.append('model_id', modelId);
      form.append('file', audio, audio.name || 'audio.wav');
      form.append('timestamps_granularity', 'word');
      form.append('tag_audio_events', 'false');
      if (languageCode) form.append('language_code', languageCode);
      const res = await this.request('POST', '/v1/speech-to-text', { form, signal });
      const words = (res.words ?? [])
        .filter((w) => (w.type ?? 'word') === 'word' && typeof w.start === 'number')
        .map((w) => ({ text: String(w.text).trim(), start: w.start, end: typeof w.end === 'number' ? w.end : w.start }))
        .filter((w) => w.text);
      return { text: res.text ?? words.map((w) => w.text).join(' '), language: res.language_code ?? null, words };
    }

    /** Sound Effects. `durationSeconds` null lets the model choose (0.5 to 30 s otherwise). */
    soundEffect({ text, durationSeconds = null, promptInfluence = 0.3, loop = false, modelId, signal }) {
      if (!text || !text.trim()) throw new Error('Describe the sound');
      const json = { text, prompt_influence: promptInfluence, loop };
      if (durationSeconds !== null && durationSeconds !== undefined) json.duration_seconds = Math.min(30, Math.max(0.5, durationSeconds));
      if (modelId) json.model_id = modelId;
      return this.request('POST', '/v1/sound-generation', {
        query: { output_format: OUTPUT_FORMAT }, json, audio: true, signal,
      });
    }

    /** Music from a prompt, 3 s to 10 min. */
    music({ prompt, lengthSeconds = 30, instrumental = false, modelId, signal }) {
      if (!prompt || !prompt.trim()) throw new Error('Describe the music');
      const ms = Math.round(Math.min(600, Math.max(3, lengthSeconds)) * 1000);
      const json = { prompt, music_length_ms: ms, force_instrumental: instrumental };
      if (modelId) json.model_id = modelId;
      return this.request('POST', '/v1/music', {
        query: { output_format: OUTPUT_FORMAT }, json, audio: true, signal,
      });
    }

    /** Voice Changer (speech to speech): re-voice `audio` (a Blob/File) as `voiceId`. */
    voiceChanger({ voiceId, audio, modelId, removeBackgroundNoise = false, signal }) {
      if (!voiceId) throw new Error('Choose a voice');
      if (!audio) throw new Error('Add the audio to change');
      const form = new FormData();
      form.append('audio', audio, audio.name || 'audio.wav');
      if (modelId) form.append('model_id', modelId);
      form.append('remove_background_noise', String(!!removeBackgroundNoise));
      return this.request('POST', `/v1/voice-changer/${encodeURIComponent(voiceId)}`, {
        query: { output_format: OUTPUT_FORMAT }, form, audio: true, signal,
      });
    }

    /** Instant Voice Clone. Returns { voice_id, requires_verification }. */
    cloneVoice({ name, files, description, removeBackgroundNoise = false, signal }) {
      if (!name || !name.trim()) throw new Error('Name the voice');
      if (!files || files.length === 0) throw new Error('Add at least one recording of the voice');
      const form = new FormData();
      form.append('name', name.trim());
      for (const f of files) form.append('files', f, f.name || 'sample.wav');
      if (description) form.append('description', description);
      form.append('remove_background_noise', String(!!removeBackgroundNoise));
      return this.request('POST', '/v1/voices/add', { form, signal });
    }

    deleteVoice(voiceId) {
      return this.request('DELETE', `/v1/voices/${encodeURIComponent(voiceId)}`);
    }
  }

  return { Client, ApiError, BASE, OUTPUT_FORMAT };
})();

globalThis.ElevenLabs = ElevenLabs;
