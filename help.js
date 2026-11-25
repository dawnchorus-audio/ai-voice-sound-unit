// AI Voice & Sound Unit: keyboard shortcuts and the user guide shown by Help.
// SHORTCUTS is the one list both the key handler (main.js) and the Help page read, so the
// page can never describe a shortcut that does not exist.

const AddOnHelp = (() => {
  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') || /Mac OS X/.test(globalThis.navigator?.userAgent ?? '');

  /**
   * key: KeyboardEvent.key (case-insensitive) or code when `code` is set.
   * mod: ⌘ on macOS, Ctrl on Windows. field: also works while typing in a text field.
   */
  const SHORTCUTS = [
    { group: 'Generate', action: 'generate', mod: true, key: 'Enter', field: true, label: 'Press the red key (Generate, Compose, Change…) of this mode' },
    { group: 'Generate', action: 'cancel', key: 'Escape', field: true, label: 'Cancel the newest running job (closes an open panel, Help or History first)' },
    { group: 'Generate', action: 'cancel', mod: true, key: '.', field: true, label: 'Cancel the newest running job' },
    { group: 'Generate', action: 'variations-up', mod: true, shift: true, key: 'ArrowUp', field: true, label: 'More takes (up to 4)' },
    { group: 'Generate', action: 'variations-down', mod: true, shift: true, key: 'ArrowDown', field: true, label: 'Fewer takes' },

    { group: 'Modes', action: 'tab:tts', mod: true, key: '1', field: true, label: 'Speech (Text to Speech)' },
    { group: 'Modes', action: 'tab:sfx', mod: true, key: '2', field: true, label: 'SFX (Sound Effects)' },
    { group: 'Modes', action: 'tab:music', mod: true, key: '3', field: true, label: 'Music' },
    { group: 'Modes', action: 'tab:vc', mod: true, key: '4', field: true, label: 'Changer (Voice Changer)' },
    { group: 'Modes', action: 'tab:ivc', mod: true, key: '5', field: true, label: 'Clone (Voice Clone)' },
    { group: 'Modes', action: 'tab:lyrics', mod: true, key: '6', field: true, label: 'Lyrics & LRC' },
    { group: 'Modes', action: 'tab:key', mod: true, key: ',', field: true, label: 'API key screen' },
    { group: 'Modes', action: 'tab-prev', mod: true, shift: true, code: 'BracketLeft', key: '[', field: true, label: 'Previous mode' },
    { group: 'Modes', action: 'tab-next', mod: true, shift: true, code: 'BracketRight', key: ']', field: true, label: 'Next mode' },

    { group: 'Timeline', action: 'use-clip', mod: true, key: 'u', field: true, label: 'Changer: Read sel · Clone: + Sample (the selected clip)' },
    { group: 'Timeline', action: 'clear-vc', mod: true, key: 'Backspace', label: 'Changer: clear the recording it will change' },
    { group: 'Timeline', action: 'every-clip', mod: true, shift: true, key: 'u', field: true, label: 'Changer: Every clip (change every clip in the selection)' },
    { group: 'Timeline', action: 'load-from-clip', mod: true, key: 'l', field: true, label: 'Reuse clip settings: load the settings that made the selected clip' },
    { group: 'Generate', action: 'import-text', mod: true, shift: true, key: 'o', field: true, label: 'Speech: Import text (.txt, .md, .rtf), subtitles or LRC from a file' },
    { group: 'Timeline', action: 'import-lyrics', mod: true, key: 'i', field: true, label: 'Speech: Import lyrics of the selection' },
    { group: 'Timeline', action: 'find-lyrics', mod: true, shift: true, key: 'i', field: true, label: 'Lyrics: Find the lyrics of the selection' },
    { group: 'Timeline', action: 'copy-lyrics', mod: true, shift: true, key: 'c', field: true, label: 'Lyrics: Copy (what the screen shows)' },
    { group: 'Timeline', action: 'lyrics-view', mod: true, shift: true, key: 't', field: true, label: 'Lyrics: LRC view on or off' },
    { group: 'Timeline', action: 'selection-length', mod: true, shift: true, key: 'l', field: true, label: 'SFX / Music: Len = sel (length from the timeline selection)' },
    { group: 'Timeline', action: 'toggle-dest', mod: true, shift: true, key: 'n', field: true, label: 'Switch destination: selected track / new track' },
    { group: 'Timeline', action: 'toggle-auto', mod: true, shift: true, key: 'a', field: true, label: 'Turn "Place automatically" on or off' },

    { group: 'Results', action: 'preview-latest', key: 'p', label: 'Play or stop the newest take of this mode' },
    { group: 'Results', action: 'place-latest', mod: true, key: 'p', field: true, label: 'Place the newest take of this mode at the playhead' },
    { group: 'Results', action: 'clear', mod: true, key: 'k', field: true, label: 'Clear this tab\'s results: the tape of this mode (History keeps everything)' },
    { group: 'Results', action: 'history', mod: true, shift: true, key: 'h', field: true, label: 'Open or close History' },

    { group: 'Window', action: 'voice-search', mod: true, key: 'f', field: true, label: 'Open the voice list and search voices (Speech, Changer)' },
    { group: 'Window', action: 'paste-key', mod: true, shift: true, key: 'v', field: true, label: 'Paste the API key from the clipboard' },
    { group: 'Window', action: 'look', mod: true, shift: true, key: 'e', field: true, label: 'Next look: Studio, Vintage Cream, Vintage Black' },
    { group: 'Window', action: 'feedback', mod: true, shift: true, key: 'b', field: true, label: 'Send feedback or report a bug (opens the form in your web browser)' },
    { group: 'Window', action: 'help', mod: true, key: '/', field: true, label: 'Open or close Help' },
    { group: 'Window', action: 'search-help', mod: true, shift: true, key: 'f', field: true, label: 'Search Help' },
    { group: 'Window', action: 'help', key: '?', label: 'Open Help' },
    { group: 'Window', action: 'help', key: 'F1', field: true, label: 'Open Help' },
  ];

  /** LUNA's own keys that keep working in this window (outside text fields). */
  const LUNA_KEYS = [
    { keys: 'Space', label: 'Play / stop' },
    { keys: isMac ? '⌘Z  ·  ⇧⌘Z' : 'Ctrl+Z  ·  Ctrl+Shift+Z', label: 'Undo / redo in LUNA (placing audio is one undo step; new tracks are their own steps)' },
    { keys: 'R', label: 'Record, as in LUNA' },
  ];

  function keyLabel(s) {
    const names = { Enter: isMac ? '↩' : 'Enter', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ' ': 'Space', Backspace: isMac ? '⌫' : 'Backspace' };
    const k = names[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key);
    if (isMac) return `${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${k}`;
    return [s.mod && 'Ctrl', s.shift && 'Shift', k].filter(Boolean).join('+');
  }

  /** The shortcut a key event matches, or undefined. */
  function match(e) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    return SHORTCUTS.find((s) => {
      if (!!s.mod !== mod || (s.key !== '?' && !!s.shift !== e.shiftKey) || e.altKey) return false;
      if (s.code) return e.code === s.code;
      return e.key.toLowerCase() === s.key.toLowerCase();
    });
  }

  function shortcutsHtml() {
    const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
    const seen = new Set();
    let html = '';
    for (const g of groups) {
      html += `<h3>${g}</h3><table class="keys">`;
      for (const s of SHORTCUTS.filter((x) => x.group === g)) {
        const k = keyLabel(s);
        if (seen.has(k)) continue;
        seen.add(k);
        html += `<tr><td><kbd>${k}</kbd></td><td>${s.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td></tr>`;
      }
      html += '</table>';
    }
    html += '<h3>LUNA keys</h3><table class="keys">';
    for (const k of LUNA_KEYS) html += `<tr><td><kbd>${k.keys}</kbd></td><td>${k.label}</td></tr>`;
    html += '</table><p class="hint">Shortcuts with ⌘/Ctrl also work while you type. Single letters (P, ?) work only outside text fields, so typing is never interrupted. Keys this window does not use go to LUNA.</p>';
    return html;
  }

  const SECTIONS = [
    {
      id: 'start', title: 'Getting started', html: `
<p><b>AI Voice &amp; Sound Unit</b> (by dawnchorus) brings ElevenLabs into LUNA: speech, sound effects, music, voice changing and voice cloning, plus re-voicing LUNA's extracted lyrics at their original timing and LRC files. What it makes goes straight onto your timeline.</p>
<p><b>Opening it</b>: it opens as a window of its own that you can move anywhere, from LUNA's <b>Add Ons</b> menu or the Add Ons browser.</p>
<p>This Help names the keys as they are on the <b>Vintage</b> panel, the look the Add On starts in. In the <b>Studio</b> look the same controls are tabs, chips and buttons; where a name differs, Help gives the Studio name in brackets.</p>
<ol>
  <li><b>Add your API key</b>: click the lamp at the top right (it shows a red key and <b>No key</b> until a key is saved; Studio: the key icon at the right end of the tabs). Follow the steps on the screen, then press <b>Paste key</b>. Inside LUNA the Add On may not read the clipboard itself; then the key field is selected for you: press ${isMac ? '⌘V' : 'Ctrl+V'} and the key is checked and saved at once. The key is kept in your system's secure key store, never in the Add On's files or the session.</li>
  <li><b>Choose where audio goes</b>: <b>DEST ▸</b> at the bottom of the screen says in words where the next result will land (Studio: the dashed ⤓ chip under the tab). Click it to choose the <b>Selected track</b> (the audio track you last clicked in LUNA) or a <b>New track</b>, and <b>Place automatically</b>. <b>Place at</b> under the knobs chooses where a new result starts: <b>Playhead</b>, <b>Selection</b> (its start) or <b>Markers</b> (the next marker at or after the playhead), as they are when you press the red key; with no selection or marker it goes at the playhead, and the status line says so (Studio: <b>Position</b> in the destination panel).</li>
  <li>Press the red key: <b>Generate</b>, <b>Compose</b>, <b>Change</b>, <b>Create</b> or <b>Re-voice</b>, by mode (<kbd>${isMac ? '⌘↩' : 'Ctrl+Enter'}</kbd>). With <b>Place automatically</b> on, the result (all takes, if you asked for several) is placed as soon as it is ready, where you were when you pressed it. Otherwise it waits on the tape until you place it.</li>
</ol>
<p><b>Look</b>: <b>◐ Cream / Black</b> on the panel (Studio: the half-filled circle in the header; <kbd>${isMac ? '⇧⌘E' : 'Ctrl+Shift+E'}</kbd> steps through them) chooses <b>Vintage</b>, a hardware panel in a <b>Cream</b> or <b>Black</b> finish, or <b>Studio</b>, clean and dark, with tabs. Only the look changes: every setting, shortcut and History entry is the same, and the Add On remembers your choice.</p>
<p><b>Search</b>: type in the box at the top of Help (or press <kbd>${isMac ? '⇧⌘F' : 'Ctrl+Shift+F'}</kbd> anywhere) to find every section that mentions your words, shortcuts included. Put words in quotes to find a phrase, such as <i>"place all"</i>. <kbd>↩</kbd> opens the best match, <kbd>Esc</kbd> clears the search.</p>
<p>Every placement is one undo step in LUNA: <kbd>${isMac ? '⌘Z' : 'Ctrl+Z'}</kbd> removes it. When the audio goes on new tracks, the tracks are made first, as steps of their own, so undo once more for each new track.</p>
<p>Not sure what a key does? Hover over it: every key has a short description, with its shortcut when it has one.</p>
<p>Every key shows that it worked, on the key itself and without changing size: for example <b>✓ 23 voices</b> after <b>↻ Refresh</b>, or <b>✓ Started</b> on the red key. A red <b>Failed</b> means the status line on the screen says why.</p>`,
    },
    {
      id: 'vintage', title: 'The panel, key by key', html: `
<ul>
  <li><b>Top strip</b>: the lamp says <b>Online</b> (green: key saved, connected to a LUNA session), <b>Waiting</b> or <b>No session</b> (yellow: LUNA is starting or reconnecting, or no session is open), <b>No LUNA</b> (LUNA could not be reached) or a red key with <b>No key</b>; click it (hover shows a key) to add, change or forget the API key. <b>CR</b> is the credits left on your ElevenLabs plan this period, read when the key is checked and after every generation (ElevenLabs can take a minute to count the newest one); click it for your plan, Help and support. Under them: <b>◐ Cream / Black</b> (Look), ⟳ <b>Reuse clip settings</b>, the clock (<b>History</b>), the speech bubble (<b>Feedback</b>), ☕ <b>Support</b> (inactive until the tip page is ready) and <b>?</b> (Help).</li>
  <li><b>Mode keys</b>: <b>Speech</b>, <b>SFX</b>, <b>Music</b>, <b>Changer</b>, <b>Clone</b>, <b>Lyrics</b> (Studio: the tabs).</li>
  <li><b>The screen</b>: on top the voice (click it to search, preview and pick; <b>My voices</b> shows only yours) and the model (click for the next one, Shift-click for the previous one); then the text, recording or samples; then the status line, the count and <b>DEST ▸</b>.</li>
  <li><b>Soft keys</b> under the screen do the mode's actions (Studio: the buttons and chips on the card). A wider window shows more of them in the row; when they don't all fit, <b>More ▸</b> opens the rest in a row below (<b>Less ▴</b> closes it).</li>
  <li><b>Knobs</b>: drag up or down (Shift for finer steps), scroll, or click one and use the arrow keys; a double-click puts the default back (Studio: ⚙ and the chips). Options with two positions are slide switches: left is off, right is on (Studio: checkboxes).</li>
  <li><b>Takes</b> 1–4 (Studio: ×1…×4), <b>Takes as</b> Playlists or Tracks (how several takes are placed together; Studio: <b>Place all as</b>), <b>Place at</b> Playhead, Selection or Markers, and the red key. Rows that do not apply to a mode show dimmed: Takes on Changer, Clone and Lyrics; Place at and DEST on Clone and Lyrics, which place nothing themselves.</li>
  <li><b>The tape</b> lists this mode's takes, lettered A, B, C…, with ▶, <b>Place at playhead</b>, <b>Place at</b> where you started, and <b>LRC</b> (Studio: <b>This tab</b>). <b>Clear</b> empties it; <b>History</b> has every result.</li>
</ul>`,
    },
    {
      id: 'tts', title: 'Speech (Text to Speech)', html: `
<p>Type text on the screen, pick a voice and a model, and press <b>Generate</b>.</p>
<ul>
  <li><b>Voice</b>: <b>VOICE ▸</b> on the screen (or the <b>Voice</b> soft key) opens the voice list: search by name, accent or gender, <b>▶ Preview</b> plays the voice's sample before you spend credits, <b>↻ Refresh</b> reloads your voices from ElevenLabs, <b>My voices</b> shows only yours (Studio: the voice chip). <b>Model</b> steps to the next model.</li>
  <li><b>Credits</b>: the line at the bottom of the screen shows the characters, the estimated cost and what is left on your plan, and warns when the text is too long for the model.</li>
  <li><b>Knobs</b>: <b>Stability</b> (lower is more expressive), <b>Similarity</b> (closeness to the original voice), <b>Style</b> and <b>Speed</b> (Studio: ⚙).</li>
  <li><b>Lines</b> switch (script mode, <i>one clip per line</i>): every line becomes its own clip. Its options appear on the screen: <i>one after another</i> with a gap you choose, or <i>on markers</i> from the playhead on. Start a line with a voice's name and a colon, such as <code>Alice: Hello!</code>, to speak it in that voice; each speaker gets a track of their own. Takes are off while Lines is on.</li>
  <li><b>Import text</b> (or drop a file from ${isMac ? 'Finder' : 'File Explorer'} on the screen): <b>.txt</b>, <b>.md</b> and <b>.rtf</b> (rich text, as from Word${isMac ? ' or TextEdit' : ' or WordPad'}) fill the text as plain text: Markdown and RTF formatting is removed, paragraphs stay. Subtitles (<b>.srt</b>, <b>.vtt</b>) and <b>.lrc</b> become one line per cue and, with a session open, keep their timing, counted from the session start: they turn Lines on and use <i>At the original lyric timing</i>, with the same timing choices as lyrics. A WebVTT voice (<code>&lt;v Alice&gt;</code>) becomes <i>Alice:</i> and speaks in that voice if you have one by that name.</li>
  <li><b>Import lyrics</b> (under <b>More ▸</b>): re-voice a recording that LUNA's <b>Extract Lyrics</b> has transcribed. See <i>Lyrics &amp; LRC</i>. <b>Clear</b> empties the text; <b>From clip</b> is ⟳ Reuse clip settings.</li>
</ul>`,
    },
    {
      id: 'lyrics', title: 'Lyrics & LRC', html: `
<h3>The Lyrics mode</h3>
<ul>
  <li><b>Find</b> puts the lyrics LUNA extracted for the selected clip (or range, or the clip under the playhead) on the screen, one line per lyric line. The heading above them says how many lines, from which clip and which time span (Studio: <b>Find in selection</b>).</li>
  <li><b>Transcribe</b> does the same for a voice-over without lyrics, with ElevenLabs Speech to Text (uses credits; Studio: <b>Transcribe selected clip</b>).</li>
  <li><b>LRC view</b> switch shows the same lyrics as plain text (off) or as an LRC file with times (on); corrections you type are kept when you switch, as long as each line stays a line (Studio: <b>Text | LRC</b>). <b>Word timing</b> adds a time to every word in the LRC (enhanced LRC).</li>
  <li><b>Re-voice</b> (the red key) takes the lines as corrected on the screen, with their timing, to Speech (below). <b>Voice</b> picks the voice first; the <b>Timing</b> knob chooses <i>Line start</i>, <i>Fit line</i> or <i>Each word</i> (Studio: <b>Re-voice in Text to Speech</b>).</li>
</ul>
<h3>Re-voice lyrics at their original timing</h3>
<ol>
  <li>In LUNA, run <b>Extract Lyrics</b> on a dialog or vocal clip.</li>
  <li>Select the clip, or a range over part of it, and press <b>Import lyrics</b> in Speech (or <b>Find</b> → <b>Re-voice</b> in Lyrics). Each lyric line becomes a line of text and Lines turns on; you can fix words, but keep one line per lyric line.</li>
  <li>Choose a voice and the <b>Timing</b>:
    <ul>
      <li><b>Start of each line</b> (Line start): each new line starts where the original did, at its natural length.</li>
      <li><b>Fit each line to its length</b> (Fit line): LUNA also stretches or squeezes it toward the original length, by at most 1.25× longer or 0.8× shorter so the voice stays natural. A line far off is first generated once more at a fitting speed (turn this off to save credits). A line that would need more keeps as close as the limit allows, and the Add On tells you.</li>
      <li><b>Each word at its original time</b> (Each word): the new line is cut into words, each starting where the original word did; a word longer than the room before the next is squeezed, at most to 0.8×. Lines whose words you changed are placed whole.</li>
    </ul></li>
  <li>Press <b>Generate</b>. The result goes on a new track under the original: the track is one undo step, the lines on it another. <b>Place on a new track</b> on the tape places the same result again with another timing, without generating again.</li>
</ol>
<p>Lyrics in LUNA belong to the audio file, not to the timeline: when you move a clip, its lyrics move with it, and the Add On always places lines by the clip that plays them.</p>
<h3>LRC files</h3>
<ul>
  <li>Turn <b>LRC view</b> on for LUNA's lyrics or a transcription, or press <b>LRC</b> on a Speech take on the tape (the timing comes with the speech), on a re-voiced lyrics or script result, or use <b>Transcribe</b> on any voice-over. A take gets times on the timeline once it is placed.</li>
  <li><b>LRC times count from</b> the session start (to match an export of the whole song) or from the start of the audio file.</li>
  <li><b>Copy</b> puts what the screen shows (plain text or LRC) on the clipboard, to paste into any editor, subtitle tool or message (Studio: <b>Copy Text</b>). The key reads <b>✓ Copied</b> for a moment when it worked, or red <b>Copy failed</b> when LUNA did not allow it (then select the text and press ${isMac ? '⌘C' : 'Ctrl+C'}).</li>
  <li>To keep it as a file, paste into ${isMac ? 'TextEdit, choose <i>Format → Make Plain Text</i>,' : 'Notepad'} and save it as <b>.lrc</b> or <b>.txt</b>. The Add On cannot save files itself: LUNA does not let an Add On write to disk yet.</li>
  <li><b>To LUNA</b> writes the lines and word timing straight into LUNA's lyrics for that audio, as Extract Lyrics would, without a file (press twice to confirm; Studio: <b>Add to LUNA lyrics</b>).</li>
</ul>`,
    },
    {
      id: 'sfx', title: 'SFX (Sound Effects)', html: `
<p>Describe the sound on the screen (<i>heavy wooden door slams shut in a stone hall</i>) and press <b>Generate</b>.</p>
<ul>
  <li><b>Duration</b> knob: 0.5 to 30 seconds, or <i>auto</i> (turn it all the way down) to let the model decide. <b>Len = sel</b> takes the length of the timeline selection (Studio: the <b>Length</b> chip and its <b>Selection</b>).</li>
  <li><b>Loop</b> switch makes a sound that loops seamlessly, without a click.</li>
  <li><b>Influence</b> knob: how literally the prompt is followed. The model is on the screen's top right (click for the next one).</li>
  <li><b>From clip</b> is ⟳ Reuse clip settings; <b>Clear</b> empties the prompt.</li>
</ul>`,
    },
    {
      id: 'music', title: 'Music', html: `
<p>Describe the music on the screen and press <b>Compose</b>. It can take a minute; you can keep working in LUNA meanwhile.</p>
<ul>
  <li><b>Tempo &amp; key</b> adds the session's tempo and key at the playhead to the prompt, so the music fits your song.</li>
  <li><b>Length</b> knob: 3 seconds to 10 minutes. <b>Len = sel</b> takes the length of the timeline selection, for example exactly 8 bars.</li>
  <li><b>Instrumental</b> switch asks for no vocals. The model is on the screen's top right.</li>
  <li>Music needs a paid ElevenLabs plan; on the free plan the status line says so, with <b>See plans</b>.</li>
</ul>`,
    },
    {
      id: 'vc', title: 'Changer (Voice Changer)', html: `
<p>Re-voices a recording with another voice, keeping its timing and delivery.</p>
<ul>
  <li><b>Read sel</b>: click a clip on the timeline (or select part of it) and press it. Only the selected part is read, straight from the session's audio file, without clip gain, fades or plug-ins. The result goes back to the same place on the timeline (Studio: <b>Use selected clip</b>).</li>
  <li><b>From file</b>, or drop an audio file on the screen: the chosen recording shows on the screen; <b>Clear</b> next to it (or the <b>Clear</b> soft key) removes it.</li>
  <li><b>Change</b> (the red key) re-voices the one recording on the screen. <b>Every clip</b> (under <b>More ▸</b>) re-voices every clip in the timeline selection at once: select a range over several clips; each is changed (one request each), and each result goes where its clip is, on the track DEST named when you started: <b>Selected track</b> (usually the clips' own track, where the results go on top of the originals and play instead of them) or <b>New track</b>. On the tape, <b>Place all on</b> places them again on the track you started with, the clips' own track, or a new track (Studio: <b>Change voice</b>, <b>Change every clip in selection</b>).</li>
  <li><b>TO VOICE ▸</b> on the screen (or <b>Voice</b>) picks the new voice, as in Speech. <b>Denoise</b> switch removes background noise from the input first.</li>
  <li><b>Knobs</b>: Stability, Similarity and Style of the new voice, as in Speech (Studio: ⚙).</li>
</ul>`,
    },
    {
      id: 'ivc', title: 'Clone (Voice Clone)', html: `
<p>Creates a new voice in your ElevenLabs account from recordings of a speaker (Instant Voice Clone).</p>
<ul>
  <li>Type the new voice's name on the screen (a description is optional). If something is missing when you press <b>Create</b>, the Add On points at it (Studio: <b>Create voice</b>).</li>
  <li>Add clean recordings, 1 to 2 minutes in total works well: <b>+ Sample</b> takes the selected clip from the timeline, <b>From file</b> or a drop adds files, <b>− Sample</b> removes the last one, <b>Clear</b> removes all (Studio: <b>Add selected clip</b>, <b>Clear samples</b>).</li>
  <li><b>Consent</b> switch: confirm that you own the voice or have the speaker's permission. Cloning someone's voice without permission is not allowed. <b>Denoise</b> removes background noise from the samples.</li>
  <li>The new voice is selected in Speech and Changer straight away. Your cloned voices are listed on the tape, where you can delete them (press twice).</li>
  <li>Instant Voice Clone depends on your ElevenLabs plan; the screen says so when your plan does not include it.</li>
</ul>`,
    },
    {
      id: 'results', title: 'Results, takes and history', html: `
<ul>
  <li><b>The tape</b> lists the jobs still running and what was made in this mode (scripts and lyrics count as Speech, multi-clip changes as Changer; Studio: <b>This tab</b>). When something finishes in a mode you are not in, its mode key (Studio: tab) gets a <b>●</b> until you open it. ▶ plays a take and the small waveform shows its shape; <b>Place at playhead</b> puts it at the playhead on the destination; <b>Place at …</b> puts it where you were when you pressed the red key. After placing, the row says where it went (hover for the whole text).</li>
  <li><b>Takes</b> (1 to 4; Studio: ×variations): makes several versions in one go (each costs credits). With <b>Place automatically</b> on, they all go onto the timeline where you started, as <b>Playlists</b> (one track, one playlist per take; take A stays active) or as <b>Tracks</b> (one new track each), as set by <b>Takes as</b> (or <b>Place all as</b> on the tape; Playlists at first). To audition them first, turn <b>Place automatically</b> off: they wait on the tape, where you place the one you like or <b>Place all</b>.</li>
  <li><b>Re-voiced lyrics</b> arrive as one group; <b>Place on a new track</b> can place them again with another timing (start, fitted, word by word) without generating again.</li>
  <li><b>LRC</b> on a speech take or a lyrics/script group opens its timing in <i>Lyrics &amp; LRC</i>, ready to copy or add to LUNA's lyrics.</li>
  <li><b>Clear</b> empties this mode's tape; other modes keep theirs. Nothing is lost: <b>History</b> (the clock key) keeps every generation of this session, saved with the session, with its prompt and settings, and where it was placed. From History you can play, place, <b>Reuse settings</b>, or <b>Remove</b> an entry. <b>Remove</b> and <b>Clear history</b> delete only the History entries: the audio stays in the session's audio files even if it was never placed (an Add On cannot delete session audio yet), and audio on the timeline is untouched.</li>
  <li><b>Reuse clip settings</b> (⟳ in the top strip, or <b>From clip</b>; ${isMac ? '⌘L' : 'Ctrl+L'}): select a clip the Add On made and press it; its mode opens with the prompt and settings that made it, ready to tweak and generate again.</li>
  <li>The lamp shows which LUNA session the Add On works with (hover it for the session's name; Studio: <b>Session: name</b> with a green, yellow or grey dot). Results go into that session and History is that session's.</li>
</ul>`,
    },
    {
      id: 'jobs', title: 'Working in the background', html: `
<ul>
  <li>Generation runs in the Add On, not in LUNA: keep playing and editing while it works. Closing the window does not stop it.</li>
  <li>When you click Generate, the destination (track and playhead) is remembered, so the result lands there even if you have moved on.</li>
  <li>Several jobs can run at once; each shows its elapsed time and a <b>Cancel</b> button. Two run at a time and the rest wait their turn; if your plan allows fewer requests at once, the Add On waits and retries.</li>
  <li>Generated audio is added to the session's audio files as soon as it is ready, so History can place it later, even after LUNA restarts. Clearing History does not remove those files.</li>
</ul>`,
    },
    { id: 'keys', title: 'Keyboard shortcuts', html: '' },
    {
      id: 'trouble', title: 'Troubleshooting', html: `
<dl>
  <dt>"Could not reach ElevenLabs"</dt><dd>A network problem, not a bad key: the saved key is kept. In current LUNA versions an Add On reaches only the servers you allowed: when LUNA asks whether <i>AI Voice &amp; Sound Unit</i> may use api.elevenlabs.io and storage.googleapis.com (voice samples), choose <b>Allow</b>. If you chose Don't Allow, allow them in LUNA's <b>Settings → Add Ons → SERVERS</b> and reopen the window. When the Add On opens without a connection it tries again on its own every 5 seconds (5 times), and <b>Try again</b> in the status line retries at once. It can also be ElevenLabs itself: when one of its services is down, the rest keeps working (the voice list then comes from an older service). Check the internet connection. If it keeps happening with a working connection, ElevenLabs may be refusing requests from the Add On's page; please report it.</dd>
  <dt>"The API key was rejected" / "missing permissions"</dt><dd>The key was deleted, expired, or is restricted. Create a new key, or allow the features you use and reading Models, Voices and User.</dd>
  <dt>"Quota exceeded" / out of credits</dt><dd>Your plan's credits are used up for this period. The header shows what is left (in Vintage, <b>CR</b>).</dd>
  <dt>Paste key says it could not read the clipboard</dt><dd>LUNA does not let an Add On read the clipboard by itself. The key field is selected for you: press ${isMac ? '⌘V' : 'Ctrl+V'}, and a key pasted there is checked and saved at once (or type it and press <b>Save</b>; Studio: <b>Save and check</b>).</dd>
  <dt>"LUNA could not hand over the clip's audio"</dt><dd>The Add On reads clip audio from the session's audio folder. If that fails, bounce or export the clip and use <b>From file</b> (or drop the file on the screen).</dd>
  <dt>Something else is wrong</dt><dd>Press <b>Feedback</b> (the speech-bubble key) and describe it; a screenshot helps.</dd>
  <dt>The result is on the wrong track</dt><dd>Check <b>DEST ▸</b> on the screen and <b>Place at</b> before you press the red key: they name the track and position. Takes that wait on the tape can be placed anywhere later.</dd>
</dl>`,
    },
    {
      id: 'privacy', title: 'Privacy and credits', html: `
<ul>
  <li>Your API key stays in your system's secure key store and is sent only to api.elevenlabs.io.</li>
  <li>Only what you generate from is sent to ElevenLabs: the text or prompt, and for Voice Changer, Voice Clone and Transcribe the selected audio. LUNA's lyrics are read in the Add On and only sent as the text you generate from. Nothing else from your session leaves your computer.</li>
  <li>Every request uses your ElevenLabs credits. Variations, script and lyric lines, multi-clip changes and transcriptions each count as separate requests, and in lyrics mode a line generated again at a fitting speed counts twice.</li>
  <li>The <b>Feedback</b> form (Tally) receives only what you type and attach, plus the Add On's version, whether it runs in LUNA, Mac or Windows, the look and the mode.</li>
  <li>Writing to your session happens only when you place audio or click <b>Add to LUNA lyrics</b>; both are undoable in LUNA.</li>
  <li>A session someone sent you brings its History along. The Add On shows it as plain text, loads its settings only into the matching tab's fields, and plays only audio files inside that session. Nothing in it can run code or reach your API key.</li>
</ul>`,
    },
    {
      id: 'support', title: 'Feedback and support', html: `
<p>The Add On is free. The <b>cup</b> key (☕) in the top strip is for an optional tip to the maker (dawnchorus); the tip page is not ready yet, so the key is inactive for now. Nothing in the Add On will ever depend on it.</p>
<p><b>Feedback</b>: the speech-bubble key in the top strip (Studio: in the header; <kbd>${isMac ? '⇧⌘B' : 'Ctrl+Shift+B'}</kbd>) opens a short form in your web browser to report a bug, ask a question or suggest an idea; you can attach a screenshot and leave an email if you'd like a reply. The form gets the Add On's version, whether it runs in LUNA, your system (Mac or Windows), the look and the mode you were in, so a report can be read without asking; nothing else is sent, and nothing at all until you submit the form.</p>
<p>A tip will go to the maker, not ElevenLabs, and has nothing to do with your ElevenLabs credits or plan. The key will only open the page in your web browser; it sends nothing about you or your session.</p>`,
    },
  ];

  function sectionHtml(id) {
    const s = SECTIONS.find((x) => x.id === id);
    if (!s) return '';
    return `<h2>${s.title}</h2>${s.id === 'keys' ? shortcutsHtml() : s.html}`;
  }

  // ---------- search ----------

  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
  /** A section as plain text, the way it reads (tags out, entities decoded). */
  function sectionText(id) {
    return sectionHtml(id)
      .replace(/<(h2|h3|li|tr|p|dt|dd|ol|ul)\b[^>]*>/gi, ' \n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim();
  }

  /** Lower case without accents, so "lrc", "LRC" and "lrç" all match. Keeps string length. */
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** The words of a query, folded; quotes keep a phrase together ("place all"). */
  function terms(query) {
    const out = [];
    String(query ?? '').replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { out.push(fold((phrase ?? word).trim())); return ''; });
    return out.filter((t) => t.length >= 2 || /\d/.test(t));
  }

  /**
   * Sections that contain every term, best first (title hits, then how often the terms
   * occur), each with up to `maxSnippets` short excerpts as HTML with the terms in <mark>.
   * @returns {{ id, title, score, snippets: string[] }[]}
   */
  function search(query, { maxSnippets = 2, radius = 50 } = {}) {
    const ts = terms(query);
    if (!ts.length) return [];
    const results = [];
    for (const s of SECTIONS) {
      const text = sectionText(s.id).replace(/\n/g, ' · ');
      const folded = fold(text);
      const title = fold(s.title);
      if (!ts.every((t) => folded.includes(t))) continue;
      // The whole query as typed, found as a phrase, beats words scattered around a section.
      const phrase = fold(String(query).replace(/"/g, '').trim().replace(/\s+/g, ' '));
      let score = ts.length > 1 && folded.includes(phrase) ? 25 : 0;
      const hits = [];
      for (const t of ts) {
        if (title.includes(t)) score += 10;
        for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) { score++; hits.push([i, i + t.length]); }
      }
      hits.sort((a, b) => a[0] - b[0]);
      const snippets = [];
      let lastEnd = -1;
      for (const [a] of hits) {
        if (snippets.length >= maxSnippets) break;
        if (a < lastEnd) continue;
        const from = Math.max(0, a - radius);
        const to = Math.min(text.length, a + radius * 2);
        lastEnd = to;
        snippets.push((from > 0 ? '…' : '') + markTerms(text.slice(from, to), ts) + (to < text.length ? '…' : ''));
      }
      results.push({ id: s.id, title: s.title, score, snippets });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  /** Escape `text` and wrap every occurrence of the terms in <mark>. */
  function markTerms(text, ts) {
    const folded = fold(text);
    const spans = [];
    for (const t of ts) for (let i = folded.indexOf(t); i >= 0; i = folded.indexOf(t, i + t.length)) spans.push([i, i + t.length]);
    spans.sort((a, b) => a[0] - b[0]);
    let out = '';
    let pos = 0;
    for (const [a, b] of spans) {
      if (a < pos) continue;
      out += `${escHtml(text.slice(pos, a))}<mark>${escHtml(text.slice(a, b))}</mark>`;
      pos = b;
    }
    return out + escHtml(text.slice(pos));
  }

  return { isMac, SHORTCUTS, LUNA_KEYS, SECTIONS, keyLabel, match, sectionHtml, sectionText, search, terms, fold };
})();

globalThis.AddOnHelp = AddOnHelp;
