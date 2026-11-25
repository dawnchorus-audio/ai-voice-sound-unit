# AI Voice & Sound Unit

Bring ElevenLabs into LUNA: speech, sound effects, music, voice changing and voice cloning, placed
straight onto your timeline where you were working. Re-voice LUNA's extracted lyrics at their
original timing, and turn lyrics or speech into LRC files. Uses your own ElevenLabs account.

Requires LUNA 3.1.1 or later, on macOS or Windows, and an ElevenLabs account with an API key
(the free plan works for speech, sound effects, voice changing and lyrics; Music and Voice Clone
need a paid plan).

Made by **dawnchorus**. An independent project, not made, affiliated with or endorsed by
ElevenLabs or Universal Audio. ElevenLabs is a trademark of its owner.

## Install

1. Install **AI Voice & Sound Unit** from Discover on UA Universe or in LUNA. Or download
   `AI-Voice-and-Sound-Unit.lunaaddon` from this repository's [latest release](../../releases/latest)
   and double-click it.
2. Restart LUNA, open a session, then open **Add Ons > Windows > AI Voice & Sound Unit**.
3. When LUNA asks whether the Add On may reach `api.elevenlabs.io` and `storage.googleapis.com`
   (voice samples), choose **Allow**.

## Get started

1. **Add your API key.** Create a key in your ElevenLabs account (Developers → API Keys) and copy
   it. In the Add On, click the lamp at the top right (it shows a red key and **No key**), press
   **Paste key**, then ⌘V (Ctrl+V on Windows) in the key field: the key is checked and saved.
2. **Choose where audio goes.** **DEST ▸** at the bottom of the screen says where the next result
   lands: the selected track or a new track. **Place at** chooses the start: the playhead, the
   selection or the next marker.
3. **Pick a mode and press the red key**: **Speech** (type text, pick a voice), **SFX** (describe a
   sound), **Music** (describe the music), **Changer** (re-voice a clip or a file), **Clone**
   (make a voice from samples) or **Lyrics** (find LUNA's lyrics, re-voice them, make LRC).
   With **Place automatically** on, the result is placed as soon as it is ready, where you were
   when you pressed the key, even if you have moved on.

Everything else is in **Help** inside the Add On (**?** at the top right, or ⌘/ / Ctrl+/), with a
search box and the full list of keyboard shortcuts.

## What it does

- **Speech**: any ElevenLabs voice and model, with Stability, Similarity, Style and Speed. Up to
  four takes at once, placed as playlists of one track or as tracks of their own. **Lines** makes
  one clip per line, one after another or on markers; start a line with a voice's name
  (`Alice: Hello!`) to give each speaker a track. Import text from .txt, .md and .rtf, and
  subtitles (.srt, .vtt) or .lrc at their own timing.
- **SFX** and **Music**: length from the timeline selection; Music adds the session's tempo and
  key to the prompt.
- **Changer**: re-voice the selected part of a clip (it goes back where the clip is), every clip in
  a selection at once, or an audio file.
- **Clone**: an Instant Voice Clone from clips or files, with a consent switch; your cloned voices
  are listed and can be deleted.
- **Lyrics**: re-voice what LUNA's **Extract Lyrics** found, at the original timing: each line at
  its start, fitted to its length, or each word at its original time. Transcribe a voice-over
  with ElevenLabs Speech to Text. Copy the lines as text or LRC (with word timing), or write them
  into LUNA's lyrics.
- **Tape and History**: each mode lists its takes; **History** keeps every generation of the
  session with its prompt and settings, to play, place again or reuse. **Reuse clip settings**
  opens the settings that made a selected clip.
- Two looks: **Vintage**, a hardware panel in Cream or Black, and **Studio**, clean and dark.

## Your account and your data

- Requests go straight from your computer to ElevenLabs, under your own account, plan and
  credits. There is no server in between. The free ElevenLabs plan is for non-commercial use only.
- Your API key is kept in your system's key store (macOS Keychain, Windows Credential Manager),
  never in the Add On's files or the session.
- Only what you generate from is sent to ElevenLabs: the text or prompt, and for Changer, Clone
  and Transcribe the selected audio.
- Generated audio is saved into your LUNA session's audio files, with History saved in the
  session. Clearing History does not delete those files.
- Only clone voices you have the right to clone, with the speaker's consent.

## Feedback and problems

Press **Feedback** (the speech-bubble key at the top, or ⇧⌘B / Ctrl+Shift+B) to report a bug, ask
a question or suggest an idea. It opens a short form in your web browser; the Add On fills in only
its version and build, Mac or Windows, the look and the mode you were in. The version and build
also show at the top of Help.

Common problems:

- **"Could not reach ElevenLabs"**: allow `api.elevenlabs.io` and `storage.googleapis.com` in
  LUNA's **Settings > Add Ons > SERVERS**, then reopen the window.
- **"The API key was rejected"**: the key was deleted, expired or restricted; create a new one.
- **Paste key says it could not read the clipboard**: LUNA does not let an Add On read the
  clipboard itself; press ⌘V / Ctrl+V in the key field, which the Add On selects for you.
- **Music or Clone is refused**: these need a paid ElevenLabs plan.

## Uninstall

Remove **AI Voice & Sound Unit** in LUNA's **Settings > Add Ons**. Audio it placed stays in your
sessions. To remove the saved key first, use **Forget key** on the key screen.

## Building from source

How it is built, tested and packed is in [DEVELOPING.md](DEVELOPING.md).

```sh
npm install
npm test
npx ua-builder pack
```

## License

MIT, see [LICENSE](LICENSE). The bundled LUNA Builder SDK (`vendor/luna.global.js`) is
© Universal Audio, Inc., under the Apache License 2.0 (`vendor/LICENSE-luna-builder-sdk`).
