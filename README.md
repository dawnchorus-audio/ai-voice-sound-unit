# Voice & Sound Unit

A LUNA Add On that brings ElevenLabs
into LUNA and places what it makes on the timeline. Built with the
[LUNA Builder SDK](https://github.com/uaudio-labs/luna-builder-sdk).

Made by **dawnchorus** (the `manufacturer` in `manifest.json`; written in lowercase, with "daw"
in bold in the logo). An independent project, not made, affiliated with or endorsed by ElevenLabs
or Universal Audio.
ElevenLabs is a trademark of its owner.

## Install

1. Download the `.lunaaddon` file from the latest [release](../../releases/latest) and double-click
   it; LUNA installs it. Or add this repository's URL in LUNA's Add Ons browser.
2. Restart LUNA once, open **Voice & Sound Unit** from the **Add Ons** menu, and choose **Allow**
   when LUNA asks whether it may reach `api.elevenlabs.io` and `storage.googleapis.com`.
3. Paste your own ElevenLabs API key on the key tab (create one in your ElevenLabs account under
   Developers → API Keys).

Needs LUNA 3.1.1 or later.

## Your account and your data

- You use your **own ElevenLabs account**: every request is billed to your plan and credits.
  The free ElevenLabs plan is for non-commercial use only.
- The API key is kept in your OS keychain, and requests go straight from your computer to
  ElevenLabs. There is no server in between; nothing is sent anywhere else.
- Only clone voices you have the right to clone, with the speaker's consent.
- Generated audio is saved into your LUNA session (its audio files), with a History of prompts
  and settings saved alongside. Clearing History does not delete the audio files.
- A session file can come from someone else, so the History it carries is treated as
  untrusted: it is shown as text only, its settings fill only the remembered fields of their
  own tab, and an entry can only point at an audio file inside that session's audio folder.
- The Add On is free. The **cup** button in the header opens the maker's optional support page
  (monobank Base, base.monobank.ua; it takes international cards) in your web browser for a tip;
  it sends nothing and changes nothing in the Add On. `SUPPORT_URL` in `main.js` holds the page
  address (https://base.monobank.ua/CxcJKeRQip99nf); if it is empty the button says the page is
  coming soon.

The user guide and the full shortcut list live in the Add On itself: **?** in its header,
or ⌘/ (Ctrl+/), with a search box (⇧⌘F) that finds words or "phrases" across every section,
shortcuts included. They come from `help.js` (`SECTIONS`, `SHORTCUTS`, `search()`), so they
always match the code.

## What it does

| Area | Features |
|---|---|
| Text to Speech | import text from .txt/.md/.rtf, subtitles (.srt, .vtt) and .lrc (timed lines voiced at the file's timing), voice search and preview, model, credit estimate, variations (1–4), script mode (one clip per line, after one another or on markers, `Name:` speakers on their own tracks), word timing on every result |
| Lyrics | **Import lyrics** from LUNA's Extract Lyrics for the selection; re-voice at the original timing: line starts (A), fitted to each line's length with an optional speed retry (B), each word at its original time (C) |
| Lyrics & LRC tab | **Find lyrics** (or **Transcribe**) fills one editable field; **Text \| LRC** switches its format without losing corrections; re-voice from it; LRC from a speech or lyrics/script result too; session or file time base; enhanced word timing; **Copy Text**, **Add to LUNA lyrics** (`set_lyric`) |
| Sound Effects, Music | length from the timeline selection, session tempo & key into the prompt, variations |
| Voice Changer | from the selected clip (only its selected part is read), every clip in a selection, or a file; results go back to the original position |
| Voice Clone | samples from files or clips, consent check, list and delete cloned voices |
| Results | per tab (each tab lists its own; ● marks a tab with new results; History has all); background job queue with Cancel; destination captured at Generate; place at the playhead or the original spot; variations as playlists or tracks; Clear; per-session **History** (session storage); Reuse clip settings |
| Window | API key in the OS keychain (`luna.secrets`), Paste key, remembered settings, session indicator, 30+ shortcuts, Help |

## Layout (direction A, "Compose")

Every tab is one **card**: what you write or bring (text, a description, a recording, samples,
lyrics) with a bar of **chips** under it for the choices (voice, model, ×variations, toggles such
as Loop or Lines, ⚙ for the finer settings) and the tab's main button on the right (⌘↩). Chips
with a list or settings open a **popover** (`data-pop="<id>"` on the chip, `.pop` element;
`openPop`/`closePop` in `main.js`; Esc or a click outside closes it). Under the cards: the
dashed **destination chip** (track, automatic placing; one for every tab) and **This tab**, the
running jobs and the tab's results with a waveform per result (`peaksOf`, `waveSvg`). The status
line is the window's footer. History and Help open over the window from the header icons; the
API key tab is the key icon at the end of the tabs.

All element ids stayed the same through the redesign, so `main.js` wiring, remembered settings
(`data-remember`) and shortcuts did not change; selects that are chips keep their values
(`×2` shows, `2` is the value).

### Skins

The look comes in skins: **Vintage** (the hardware
faceplate of design E, in a Cream or Black finish; Vintage Cream is the default) and **Studio**
(the layout above). One page, one `main.js`, the same element ids:
`applySkin()` in `main.js` sets `data-skin` on `<html>` from the remembered `prefs.skin`, and
`skins/vintage.css` restyles the Studio page under `:root[data-skin=vintage]`
(`[data-finish=black]` for Black). Vintage draws the tabs as mode keys with LEDs, chips and
buttons as hardware keys, every two-position option (checkbox) as a flat slide switch (left off,
right on, with ON/OFF printed on its chip), the main button as the red key, sliders as faders, and the text fields,
popovers, destination, feed and status line as amber LCDs. The LCDs re-set Studio's colour
variables for everything inside them, so Studio's own rules draw them. A control with no Vintage
rule still works, in Vintage colours; check every new control in both skins. Vintage uses system fonts (condensed labels, mono
LCD; Barlow Condensed and IBM Plex Mono when installed): LUNA lets the page reach only the
manifest's servers, so web fonts would have to ship inside the Add On.

In Vintage the voice and sound sliders are also drawn as rotary **knobs** on the panel, as in
design E (`.knobs` / `.knob[data-for]` in `index.html`, `makeKnob()` in `main.js`): each knob drives
the range input named in `data-for`, so remembered settings, History and Reuse clip settings stay
the input's own. Studio hides `.knobs`; Vintage hides the Speech ⚙ (it held only those sliders) and
the Influence row of the SFX ⚙.
Next to the red key, Vintage shows **TAKES** and **TRACK** keys (`.hwkeys`, built by `makeHwKeys()`):
TAKES 1–4 set the tab's ×variations list (whose chip Vintage hides), TRACK Sel / New and Auto set
the destination's `input[name=dest]` and `#auto-place`. The keys only read and set those controls,
repainting after any `input` / `change`, so shortcuts, History and the destination chip stay in step.
On Speech, SFX and Music the text field is one **screen** in Vintage: `.lcd-head` above it shows the
voice (opens the voice list) and the model (click: next, Shift-click: previous), and `.lcd-foot` below
it takes `#status` and `#dest-row`, which `placeScreenParts()` moves in for the active tab and back
to the footer and `main` in Studio or on tabs with no screen. Vintage hides the chips these repeat
(Speech voice and model, the SFX and Music ⚙, which held only the model by then).
Under that screen, `.softkeys[data-keys="id:Label|…"]` are Vintage's soft keys: each presses the
button it names (Import text / lyrics, Length from the selection, Tempo & key), copies its tooltip and
disabled state, and shows its feedback ("Reading…", "✓ Set") while the button does. Vintage hides
the buttons they repeat; switches (Lines, Loop, Instrumental) stay slide switches.
The results list is drawn as design E's **tape** in Vintage, with CSS only (`#results .item` with a
`take` counter): the same rows, buttons and order as Studio, each take lettered A, B, C… after ▶.

The **Look** button in the header (`#look-open`, popover `#pop-look`) picks the skin and Vintage's
finish (the finish radios are disabled, not hidden, in Studio); ⇧⌘E (`look` in `SHORTCUTS`) steps
Studio → Vintage Cream → Vintage Black. `setLook()` keeps the choice in `prefs.skin` /
`prefs.finish`; `renderLook()` applies it at start.

## Files

It opens as a floating window only (*Add Ons > Windows > Voice & Sound Unit*), one page and one
Add On (id `com.vbilous.elevenlabs`). The side panel in LUNA's secondary browser is left out for
now: it is too narrow for the Add On until LUNA allows a wider panel.

| File | Purpose |
|---|---|
| `manifest.json` | What LUNA reads: id, name, window size, entry page. `id` is `com.vbilous.elevenlabs` for good: it scopes the keychain secret and the session storage, so never change it. |
| `icon.png` | The Add On's icon (512 px): a voice wave printed on the Vintage Cream faceplate. `icon` in the manifest; LUNA does not draw it in its menus yet, UA Universe shows it on the Add On's card. Drafts and the source that draws it: `notes/icon-drafts` (outside this repo). |
| `index.html` | The page. Loads the two skin stylesheets, the SDK bundle, then the scripts below in this order. |
| `skins/studio.css` | Studio, the clean dark look (direction A, Compose). It is also the base for every skin. |
| `skins/vintage.css` | Vintage, the hardware faceplate look (design E), as rules scoped to `:root[data-skin=vintage]` over Studio; Cream finish, Black with `data-finish=black`. |
| `elevenlabs-api.js` | ElevenLabs REST client (`fetch`, no DOM): TTS (with timestamps), SFX, Music, Voice Changer, Voice Clone, Speech to Text, voices, models, quota; retries on concurrency limits; classified errors. |
| `logic.js` | Engine logic with no DOM: WAV encode/parse, targets and placement (single, variations, scripts), clip audio ranges, history store, credits, music context, text files (decode, .md and .rtf to plain text, .srt/.vtt/.lrc cues). |
| `lyrics.js` | LUNA lyrics: read, map file time → timeline through the clip, place re-voiced lines (A/B/C), LRC format, transcription line grouping, `set_lyric`. |
| `help.js` | `SHORTCUTS` (the one list both the key handler and the Help page read) and the user guide sections. |
| `main.js` | DOM wiring: connection, tabs, jobs, results, history, LRC editor, key handling. |
| `vendor/luna.global.js` | The SDK as a script-tag bundle (`globalThis.Luna`). |
| `vendor/LICENSE-luna-builder-sdk`, `vendor/NOTICE-luna-builder-sdk` | The SDK's Apache 2.0 license and notice, which ship with the bundle. |
| `tests/` | Vitest against `Luna.MockEngine` (from `vendor/luna.global.js`) and a fake `fetch`; no LUNA or ElevenLabs account needed. |

## Working on it

```sh
npm install
npm test                  # mock engine + fake fetch
npx ua-builder serve      # http://localhost:8790/ ; LUNA must be running for live data
npx ua-builder install    # links this folder into LUNA's Add Ons folder; reopen the window after edits
npx ua-builder pack       # .lunaaddon file for sharing
```

Every button presses in on click (a capture listener), and action buttons show their outcome
on themselves through `withFeedback(button, { busy, ok })` (green ✓ text, or red "Failed" when
the click reported an error in the status line); code-made buttons pass it as `btn()`'s fourth
argument, so their handlers must return their promise. Header icon buttons (`.icon`) have no
room for words: while busy their icon spins, then they show a green ✓ or red ! and get their
icon back.

Every button has a `title` tooltip saying what it does (code-made buttons pass one to
`btn(text, onclick, title)`), and `withShortcut()` in `main.js` adds the shortcut to it.

Security rules the code keeps: text from ElevenLabs, History or files goes into the page with
`textContent` or through `esc()`, never as HTML; voice ids are URL-encoded; file names made
from prompts or voice names go through `AddOnLogic.safeFileName`; a source uid must pass
`AddOnLogic.isSourceUid` before it becomes a path; `applySnapshot` takes only the tab's
`data-remember` fields. The API key lives only in `luna.secrets` and is sent only in the
`xi-api-key` header to `api.elevenlabs.io`.

Every change ships with its documentation: update the Help sections and `SHORTCUTS` in
`help.js` (add a shortcut for each new user action and wire it in `main.js` `ACTIONS`), and this
README.

At start, a saved key that fails with a network error (`ApiError.kind === 'network'`) is kept:
`tryStoredKey` retries every 5 s (5 times) and offers **Try again**; only a rejected key opens the
API Key tab. Clone, Lyrics and API Key show no destination chip or results list (`body[data-tab=…]` in `skins/studio.css`): they make nothing to place. Running jobs (a clone, a transcription) still show there.

ElevenLabs outages: on 2026-11-18 `/v2/voices` returned 502 with no CORS headers (a page sees
"Load failed") while the rest of the API worked. `Client.voices()` falls back to `/v1/voices` on a
network error or 5xx, and `useKey` treats voices or models that fail to load as a status message,
not as a bad key.

Notes from testing on LUNA 3.1 (macOS):
- **Newer LUNA builds block an Add On's network** except LUNA itself (`default-src 'self'`,
  `ws://127.0.0.1:*`) unless the manifest lists the servers in a top-level `"network"` array
  (host names, wildcards like `*.example.com`, ports; no URLs or paths). LUNA asks the user once
  (Allow / Don't Allow), adds the allowed hosts for https and wss to the page's CSP, and lists
  them under *Settings > Add Ons > SERVERS* (`/gui/add_ons/<id>` `network`, `network_allowed`).
  This Add On lists `api.elevenlabs.io` and `storage.googleapis.com` (voice preview samples).
  LUNA reads the manifest at start: restart LUNA after changing it. Without it every request
  fails with "Load failed".
- Drops: the page does not use `Luna.onPathDrop`. While a page takes path drops, LUNA claims
  every file drag and passes only paths, and `serveMediaFile` serves only audio, video and MIDI,
  so text files could not be read. Without it, drops arrive as HTML drops with the `File`
  (SDK EVIDENCE.md fact 102), for audio and text alike.
- A source's audio file is `<session package>/audio/<source uid>.wav`; `luna.gui.serveMediaFile`
  hands it to the page, with byte ranges on macOS.
- Lyrics (`<session>/lyrics/<rowid>`) are timed in nanoseconds into their audio file
  (`source_uid`), not the timeline: moving a clip moves its lyrics.
- LUNA's command schemas (`get <node>?properties=0&children=0`) document `set_lyric`,
  `import_lyrics_from_lrc` (a file path only) and `set_warp`.
- An Add On window in LUNA has no downloads: an `<a download>` link opened the blob in the
  window and left it black. The SDK has no command to write a file (only `chooseSavePath`),
  so there is no Save button: **Copy Text** only, until LUNA supports downloads.
- Stretching a clip that ends exactly at the end of its file a long way was unreliable. So generated files carry 300 ms of silence
  after the audio, clips end before it, stretch is limited to 0.8–1.25×, and clips keep the
  track's algorithm (no `alg_type` on insert).

## License

MIT, see [LICENSE](LICENSE). The bundled LUNA Builder SDK (`vendor/luna.global.js`) is
© Universal Audio, Inc., under the Apache License 2.0 (`vendor/LICENSE-luna-builder-sdk`).
