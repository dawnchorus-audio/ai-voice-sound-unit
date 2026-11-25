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
    { group: 'Generate', action: 'generate', mod: true, key: 'Enter', field: true, label: 'Generate on the current tab' },
    { group: 'Generate', action: 'cancel', key: 'Escape', field: true, label: 'Cancel the newest running job (closes an open chip panel, Help or History first)' },
    { group: 'Generate', action: 'cancel', mod: true, key: '.', field: true, label: 'Cancel the newest running job' },
    { group: 'Generate', action: 'variations-up', mod: true, shift: true, key: 'ArrowUp', field: true, label: 'More variations (up to 4)' },
    { group: 'Generate', action: 'variations-down', mod: true, shift: true, key: 'ArrowDown', field: true, label: 'Fewer variations' },

    { group: 'Tabs', action: 'tab:tts', mod: true, key: '1', field: true, label: 'Text to Speech' },
    { group: 'Tabs', action: 'tab:sfx', mod: true, key: '2', field: true, label: 'Sound Effects' },
    { group: 'Tabs', action: 'tab:music', mod: true, key: '3', field: true, label: 'Music' },
    { group: 'Tabs', action: 'tab:vc', mod: true, key: '4', field: true, label: 'Voice Changer' },
    { group: 'Tabs', action: 'tab:ivc', mod: true, key: '5', field: true, label: 'Voice Clone' },
    { group: 'Tabs', action: 'tab:lyrics', mod: true, key: '6', field: true, label: 'Lyrics & LRC' },
    { group: 'Tabs', action: 'tab:key', mod: true, key: ',', field: true, label: 'API Key' },
    { group: 'Tabs', action: 'tab-prev', mod: true, shift: true, code: 'BracketLeft', key: '[', field: true, label: 'Previous tab' },
    { group: 'Tabs', action: 'tab-next', mod: true, shift: true, code: 'BracketRight', key: ']', field: true, label: 'Next tab' },

    { group: 'Timeline', action: 'use-clip', mod: true, key: 'u', field: true, label: 'Voice Changer: use the selected clip · Voice Clone: add it as a sample' },
    { group: 'Timeline', action: 'clear-vc', mod: true, key: 'Backspace', label: 'Voice Changer: clear the recording it will change' },
    { group: 'Timeline', action: 'every-clip', mod: true, shift: true, key: 'u', field: true, label: 'Voice Changer: change every clip in the selection' },
    { group: 'Timeline', action: 'load-from-clip', mod: true, key: 'l', field: true, label: 'Load the settings that made the selected clip' },
    { group: 'Generate', action: 'import-text', mod: true, shift: true, key: 'o', field: true, label: 'Text to Speech: import text (.txt, .md, .rtf), subtitles or LRC from a file' },
    { group: 'Timeline', action: 'import-lyrics', mod: true, key: 'i', field: true, label: 'Import the lyrics of the selection into Text to Speech' },
    { group: 'Timeline', action: 'find-lyrics', mod: true, shift: true, key: 'i', field: true, label: 'Find the lyrics of the selection (Lyrics & LRC tab)' },
    { group: 'Timeline', action: 'copy-lyrics', mod: true, shift: true, key: 'c', field: true, label: 'Lyrics & LRC: Copy Text (what the field shows)' },
    { group: 'Timeline', action: 'lyrics-view', mod: true, shift: true, key: 't', field: true, label: 'Lyrics & LRC: switch the field between Text and LRC' },
    { group: 'Timeline', action: 'selection-length', mod: true, shift: true, key: 'l', field: true, label: 'Sound Effects / Music: length from the timeline selection' },
    { group: 'Timeline', action: 'toggle-dest', mod: true, shift: true, key: 'n', field: true, label: 'Switch destination: selected track / new track' },
    { group: 'Timeline', action: 'toggle-auto', mod: true, shift: true, key: 'a', field: true, label: 'Turn "Place automatically" on or off' },

    { group: 'Results', action: 'preview-latest', key: 'p', label: 'Play or stop the newest result on this tab' },
    { group: 'Results', action: 'place-latest', mod: true, key: 'p', field: true, label: 'Place the newest result on this tab at the playhead' },
    { group: 'Results', action: 'clear', mod: true, key: 'k', field: true, label: 'Clear this tab\'s results (History keeps everything)' },
    { group: 'Results', action: 'history', mod: true, shift: true, key: 'h', field: true, label: 'Open or close History' },

    { group: 'Window', action: 'voice-search', mod: true, key: 'f', field: true, label: 'Open the voice list and search voices (Text to Speech, Voice Changer)' },
    { group: 'Window', action: 'paste-key', mod: true, shift: true, key: 'v', field: true, label: 'Paste the API key from the clipboard' },
    { group: 'Window', action: 'look', mod: true, shift: true, key: 'e', field: true, label: 'Next look: Studio, Vintage Cream, Vintage Black' },
    { group: 'Window', action: 'help', mod: true, key: '/', field: true, label: 'Open or close Help' },
    { group: 'Window', action: 'search-help', mod: true, shift: true, key: 'f', field: true, label: 'Search Help' },
    { group: 'Window', action: 'help', key: '?', label: 'Open Help' },
    { group: 'Window', action: 'help', key: 'F1', field: true, label: 'Open Help' },
  ];

  /** LUNA's own keys that keep working in this window (outside text fields). */
  const LUNA_KEYS = [
    { keys: 'Space', label: 'Play / stop' },
    { keys: isMac ? '⌘Z  ·  ⇧⌘Z' : 'Ctrl+Z  ·  Ctrl+Y', label: 'Undo / redo in LUNA (placing audio is one undo step)' },
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
<p><b>AI Voice &amp; Sound Unit</b> (by dawnchorus) brings ElevenLabs into LUNA: Text to Speech, Sound Effects, Music, Voice Changer and Voice Clone, plus re-voicing LUNA's extracted lyrics at their original timing and LRC files. What it makes goes straight onto your timeline.</p>
<p><b>Opening it</b>: it opens as a window of its own that you can move anywhere, from LUNA's <b>Add Ons</b> menu or the Add Ons browser.</p>
<p><b>Look</b>: the half-filled circle in the header (<kbd>${isMac ? '⇧⌘E' : 'Ctrl+Shift+E'}</kbd> steps through them) chooses how the Add On looks: <b>Studio</b>, clean and dark, with tabs, or <b>Vintage</b>, one hardware panel in a <b>Cream</b> or <b>Black</b> finish, with mode keys and LEDs, an amber screen, knobs, and a slide switch for every on/off option (left is off, right is on). In Vintage the same button is <b>◐ Cream / Black</b> on the panel. It starts in Vintage Cream. Only the look changes: every setting, shortcut and History entry is the same in both, and the Add On remembers your choice (see <b>The Vintage panel</b>).</p>
<ol>
  <li><b>Add your API key</b>: in Studio on the <b>API Key</b> tab (the key icon at the right end of the tabs), in Vintage by clicking the lamp at the top right (it shows a red key until a key is saved). Follow the steps there, then click <b>Paste key</b>. The key is kept in your system's secure key store, never in the Add On's files or the session.</li>
  <li><b>Choose where audio goes</b> with the destination: in Studio the dashed chip (⤓) under the tab, in Vintage <b>DEST ▸</b> at the bottom of the screen. It says in words where the next result will land. Click it to choose the <b>Selected track</b> (the audio track you last clicked in LUNA) or a <b>New track</b>, and <b>Place automatically</b>. Under <b>Position</b>, choose where a new result starts: the <b>Playhead</b>, the <b>Selection start</b> or the <b>Next marker</b> (at or after the playhead), as they are when you click Generate; with no selection or marker it goes at the playhead.</li>
  <li><b>Generate</b> on any tab. With <b>Place automatically</b> on, the result (all variations, if you asked for several) is placed as soon as it is ready, where you were when you clicked Generate. Otherwise it waits in the results list until you place it.</li>
</ol>
<p><b>How a Studio tab is laid out</b> (Vintage: see <b>The Vintage panel</b>): the card at the top holds what you write or bring (text, a description, a recording, samples, lyrics). The chips on its bottom bar are the choices: voice, model, ×variations, toggles such as Loop or Lines, and ⚙ for the finer settings. Chips with a list or settings open a small panel; click outside it or press <kbd>Esc</kbd> to close it. The main button sits at the right of the card (<kbd>${isMac ? '⌘↩' : 'Ctrl+Enter'}</kbd>). On Speech, SFX, Music and Voice Changer, under the card are the destination chip and <b>This tab</b>: jobs still running and this tab's results, newest first. Clone, Lyrics and API Key make nothing to place, so they show neither. The status line at the very bottom says what just happened.</p>
<p><b>Search</b>: type in the box at the top of Help (or press <kbd>${isMac ? '⇧⌘F' : 'Ctrl+Shift+F'}</kbd> anywhere) to find every section that mentions your words, shortcuts included. Put words in quotes to find a phrase, such as <i>"place all"</i>. <kbd>↩</kbd> opens the best match, <kbd>Esc</kbd> clears the search.</p>
<p>Every placement is one undo step in LUNA: <kbd>${isMac ? '⌘Z' : 'Ctrl+Z'}</kbd> removes it.</p>
<p>Not sure what a button does? Hover over it: every button has a short description, with its shortcut when it has one.</p>
<p>Every button shows that it worked: buttons that do something tell you how it went on the button itself, without changing size, for example <i>Refreshing…</i> then <b>✓ 23 voices</b>, or <b>✓ Started</b> for a generation. A red <b>Failed</b> means the status line at the bottom of the window says why.</p>`,
    },
    {
      id: 'vintage', title: 'The Vintage panel', html: `
<p>In the <b>Vintage</b> look the Add On is one hardware panel. It does everything the Studio tabs do, with the same settings, History and shortcuts; only the controls look different.</p>
<ul>
  <li><b>Top strip</b>: under the lamp and credits, <b>◐ Cream / Black</b> opens Look (Studio, Vintage, finish), and the small keys are the Studio header's: ⟳ Reuse clip settings, History, ☕ Support and <b>?</b> Help; the lamp says <b>Online</b> (green: key saved, connected to a LUNA session), <b>Waiting</b> or <b>No session</b> (yellow: LUNA is starting or reconnecting, or no session is open), <b>No LUNA</b> (LUNA could not be reached) or a red key with <b>No key</b> (add your ElevenLabs API key); click it (hover shows a key) to add, change or forget the API key. <b>CR</b> is the credits left on your ElevenLabs plan this period, read when the key is checked and after every generation; click it for your plan, Help and support.</li>
  <li><b>Mode keys</b>: Speech, SFX, Music, Changer, Clone, Lyrics.</li>
  <li><b>The screen</b>: on top the voice (click to search, preview and pick; <b>My voices</b> shows only yours) and the model (click for the next one, Shift-click for the previous one); then the text, recording or samples; then the status line, the count and <b>DEST ▸</b> (click it to choose the track, the position and Place automatically).</li>
  <li><b>Soft keys</b> under the screen do what the Studio buttons do (Import text, Len = sel, Tempo &amp; key, Read sel, + Sample, Find, Transcribe…); a wider window shows more of them in the row; when they don't all fit, <b>More ▸</b> opens the rest in a row below.</li>
  <li><b>Knobs</b>: drag up or down (Shift for finer steps), scroll, or click one and use the arrow keys; a double-click puts the default back. Options with two positions are slide switches: left is off, right is on.</li>
  <li><b>Takes</b> 1–4 (variations), <b>Takes as</b> Playlists or Tracks (how several takes are placed together), <b>Place at</b> Playhead, Selection (its start) or Markers (the next one), and the red key.</li>
  <li><b>The tape</b> lists this mode's takes, lettered A, B, C…, with ▶ and Place; <b>History</b> opens every result.</li>
</ul>`,
    },
    {
      id: 'tts', title: 'Text to Speech', html: `
<p>Type text, pick a voice and a model, and click <b>Generate</b>.</p>
<ul>
  <li><b>Voice</b>: the first chip shows the chosen voice. Click it to search by name, accent or gender and pick from the list (double-click or <kbd>↩</kbd> picks and closes); ▶ plays the voice's sample before you spend credits, and <b>↻ Refresh</b> reloads your voices from ElevenLabs. Your own cloned voices are listed first.</li>
  <li><b>Credits</b>: the small line under the text shows the estimated cost and what is left on your plan, and warns when the text is too long for the model.</li>
  <li><b>⚙ Voice settings</b>: Stability (lower is more expressive), Similarity (closeness to the original voice), Style and Speed.</li>
  <li><b>Script mode</b> (the <b>Lines</b> chip, <i>one clip per line</i>): every line becomes its own clip. Its options appear under the card: <i>one after another</i> with a gap you choose, or <i>on markers</i> from the playhead on. Start a line with a voice's name and a colon, such as <code>Alice: Hello!</code>, to speak it in that voice; each speaker gets a track of their own.</li>
  <li><b>Import text…</b> (or drop a file from ${isMac ? 'Finder' : 'File Explorer'} anywhere on the tab): <b>.txt</b>, <b>.md</b> and <b>.rtf</b> (rich text, as from Word${isMac ? ' or TextEdit' : ' or WordPad'}) fill the text field as plain text: Markdown and RTF formatting is removed, paragraphs stay. Subtitles (<b>.srt</b>, <b>.vtt</b>) and <b>.lrc</b> become one line per cue and, with a session open, keep their timing, counted from the session start: they use <i>At the original lyric timing</i>, with the same timing choices as lyrics. A WebVTT voice (<code>&lt;v Alice&gt;</code>) becomes <i>Alice:</i> and speaks in that voice if you have one by that name.</li>
  <li><b>Import lyrics</b>: re-voice a recording that LUNA's <b>Extract Lyrics</b> has transcribed. See <i>Lyrics &amp; LRC</i>.</li>
</ul>`,
    },
    {
      id: 'lyrics', title: 'Lyrics & LRC', html: `
<h3>The Lyrics &amp; LRC tab</h3>
<ul>
  <li><b>Find lyrics in the selection</b> puts the lyrics LUNA extracted for the selected clip (or range, or the clip under the playhead) straight into the field, one line per lyric line. The heading above it says how many lines, from which clip and which time span.</li>
  <li><b>Transcribe selected clip</b> does the same for a voice-over without lyrics, with ElevenLabs Speech to Text (uses credits).</li>
  <li><b>Text | LRC</b> shows the same lyrics as plain text or as an LRC file with times. Corrections you type are kept when you switch, as long as each line stays a line. <b>Word timing</b>, next to it, adds a time to every word in the LRC (enhanced LRC). Hover over each of them for what it does.</li>
  <li><b>Re-voice in Text to Speech</b> takes the lines as corrected in the field, with their timing, to the Text to Speech tab (below).</li>
</ul>
<h3>Re-voice lyrics at their original timing</h3>
<ol>
  <li>In LUNA, run <b>Extract Lyrics</b> on a dialog or vocal clip.</li>
  <li>Select the clip, or a range over part of it, and click <b>Import lyrics</b> on the Text to Speech tab (or <b>Find lyrics</b> → <b>Re-voice in Text to Speech</b> here). Each lyric line becomes a line of text; you can fix words, but keep one line per lyric line.</li>
  <li>Choose a voice and the <b>Timing</b>:
    <ul>
      <li><b>Start of each line</b>: each new line starts where the original did, at its natural length.</li>
      <li><b>Fit each line to its length</b>: LUNA also stretches or squeezes it toward the original length, by at most 1.25× longer or 0.8× shorter so the voice stays natural. A line far off is first generated once more at a fitting speed (turn this off to save credits). A line that would need more keeps as close as the limit allows, and the Add On tells you.</li>
      <li><b>Each word at its original time</b>: the new line is cut into words, each starting where the original word did; a word longer than the room before the next is squeezed, at most to 0.8×. Lines whose words you changed are placed whole.</li>
    </ul></li>
  <li>Generate. The result goes on a new track under the original, one undo step. You can place the same result again with another timing from the results list without generating again.</li>
</ol>
<p>Lyrics in LUNA belong to the audio file, not to the timeline: when you move a clip, its lyrics move with it, and the Add On always places lines by the clip that plays them.</p>
<h3>LRC files</h3>
<ul>
  <li>Switch the field to <b>LRC</b> for LUNA's lyrics or a transcription, or use <b>LRC</b> on a Text to Speech result (<b>LRC</b> in the results list; the timing comes with the speech), from a re-voiced lyrics or script result, or from any voice-over with <b>Transcribe selected clip</b> (ElevenLabs Speech to Text, uses credits).</li>
  <li><b>LRC times count from</b> the session start (to match an export of the whole song) or from the start of the audio file. <b>Word timing</b> (next to <b>Text | LRC</b>) writes enhanced LRC with a time for every word.</li>
  <li><b>Copy Text</b> puts what the field shows (plain text or LRC) on the clipboard, to paste into any editor, subtitle tool or message. The button turns green and reads <b>✓ Copied</b> for a moment when it worked, or red <b>Copy failed</b> when LUNA did not allow it (then select the text and press ${isMac ? '⌘C' : 'Ctrl+C'}).</li>
  <li>To keep it as a file, paste into ${isMac ? 'TextEdit, choose <i>Format → Make Plain Text</i>,' : 'Notepad'} and save it as <b>.lrc</b> or <b>.txt</b>. The Add On cannot save files itself: LUNA does not let an Add On write to disk yet.</li>
  <li><b>Add to LUNA lyrics</b> writes the lines and word timing straight into LUNA's lyrics for that audio, as Extract Lyrics would, without a file (click twice to confirm).</li>
</ul>`,
    },
    {
      id: 'sfx', title: 'Sound Effects', html: `
<p>Describe the sound (<i>heavy wooden door slams shut in a stone hall</i>) and click <b>Generate</b>.</p>
<ul>
  <li><b>Length</b> chip: 0.5 to 30 seconds, or empty to let the model decide. <b>Selection</b> in the chip takes the length of the timeline selection.</li>
  <li><b>Loop</b> makes a sound that loops seamlessly, without a click.</li>
  <li><b>⚙</b>: Prompt influence (how literally the prompt is followed) and the model.</li>
</ul>`,
    },
    {
      id: 'music', title: 'Music', html: `
<p>Describe the music and click <b>Compose</b>. It can take a minute; you can keep working in LUNA meanwhile.</p>
<ul>
  <li><b>+ Tempo &amp; key</b> adds the session's tempo and key at the playhead to the prompt, so the music fits your song.</li>
  <li><b>Length</b> chip: 3 seconds to 10 minutes. <b>Selection</b> in the chip takes the length of the timeline selection, for example exactly 8 bars.</li>
  <li><b>Instrumental</b> asks for no vocals.</li>
  <li><b>⚙</b>: the music model.</li>
</ul>`,
    },
    {
      id: 'vc', title: 'Voice Changer', html: `
<p>Re-voices a recording with another voice, keeping its timing and delivery.</p>
<ul>
  <li><b>Use selected clip</b>: click a clip on the timeline (or select part of it) and press the button. Only the selected part is read, straight from the session's audio file, without clip gain, fades or plug-ins. The result goes back to the same place on the timeline.</li>
  <li>Two ways to run it, side by side at the bottom of the card: <b>Change voice</b> re-voices the one recording shown in the drop zone; <b>Change every clip in selection</b> re-voices every clip in the timeline selection at once, without using the drop zone. Select a range over several clips; each is changed (one request each), and each result goes where its clip is, on the track the destination chip named when you started: <b>Selected track</b> (usually the clips' own track, where the results go on top of the originals and play instead of them) or <b>New track</b>. In the results list, <b>Place all on</b> lets you place them again on the track you started with, the clips' own track, or a new track.</li>
  <li>Or drop an audio file on the drop zone, or click it to choose one. The chosen recording shows in the drop zone; <b>Clear</b> next to it removes it.</li>
  <li>The <b>voice chip</b> picks the new voice (search, ▶ sample, ↻ Refresh), like on Text to Speech. <b>Denoise</b> removes background noise from the input first.</li>
  <li><b>⚙ Voice settings</b>: Stability, Similarity and Style of the new voice, as on Text to Speech.</li>
</ul>`,
    },
    {
      id: 'ivc', title: 'Voice Clone', html: `
<p>Creates a new voice in your ElevenLabs account from recordings of a speaker (Instant Voice Clone).</p>
<ul>
  <li>Type a <b>Voice name</b> at the top of the card (a description is optional). If something is missing when you click <b>Create voice</b>, the Add On points at that field.</li>
  <li>Add clean recordings, 1 to 2 minutes in total works well: drop files, choose them, or use <b>Add selected clip</b> to take them from the timeline.</li>
  <li>Confirm that you own the voice or have the speaker's permission. Cloning someone's voice without permission is not allowed.</li>
  <li>The new voice is selected in Text to Speech and Voice Changer straight away. Your cloned voices are listed on this tab, where you can delete them (click twice).</li>
  <li>Instant Voice Clone depends on your ElevenLabs plan; the tab says so when your plan does not include it.</li>
</ul>`,
    },
    {
      id: 'results', title: 'Results, variations and history', html: `
<ul>
  <li><b>This tab</b>, under the destination chip, lists the jobs still running and what was generated on that tab (scripts and lyrics count as Text to Speech, multi-clip changes as Voice Changer). When something finishes on a tab you are not on, that tab gets a <b>●</b> until you open it. <b>History</b> has everything, from every tab. ▶ plays a result and the small waveform shows its shape; <b>Place at playhead</b> puts it at the playhead on the destination; <b>Place at …</b> puts it where you were when you clicked Generate.</li>
  <li><b>Variations</b> (1 to 4): makes several versions in one go (each costs credits). With <b>Place automatically</b> on, they all go onto the timeline where you clicked Generate, as <b>Playlists</b> (one track, one playlist per variation; variation 1 stays active) or as <b>Tracks</b> (one new track each), whichever you chose last in <b>Place all as</b> or, in Vintage, <b>Takes as</b> (Playlists at first). To audition them first, turn <b>Place automatically</b> off: they wait in the list, where you place the one you like or <b>Place all</b>.</li>
  <li><b>Re-voiced lyrics</b> arrive as one group; <b>Place on a new track</b> can place them again with another timing (start, fitted, word by word) without generating again.</li>
  <li><b>LRC</b> on a speech result or a lyrics/script group opens its timing on the <i>Lyrics &amp; LRC</i> tab, ready to copy or add to LUNA's lyrics.</li>
  <li><b>Clear</b> empties the current tab's list to free space; other tabs keep theirs. Nothing is lost: <b>History</b> keeps every generation of this session, saved with the session, with its prompt and settings. From History you can play, place, reuse the settings, or remove an entry. <b>Remove</b> and <b>Clear history</b> delete only the History entries: the audio stays in the session's audio files even if it was never placed (an Add On cannot delete session audio yet), and audio on the timeline is untouched.</li>
  <li><b>Reuse clip settings</b> (the ⟳ key in the header, in both looks; ${isMac ? '⌘L' : 'Ctrl+L'}): select a clip the Add On made and click it; its tab opens with the prompt and settings that made it, ready to tweak and generate again.</li>
  <li>The header also shows which LUNA session the Add On works with: in Studio <b>Session: name</b> with a green dot when connected, yellow while it connects or reconnects, grey when no session is open; in Vintage the lamp (hover it for the session's name). Results go into that session and History is that session's.</li>
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
  <dt>Paste key does nothing</dt><dd>LUNA may not let the page read the clipboard. Paste into the field with ${isMac ? '⌘V' : 'Ctrl+V'} and click <b>Save and check</b>.</dd>
  <dt>"LUNA could not hand over the clip's audio"</dt><dd>The Add On reads clip audio from the session's audio folder. If that fails, bounce or export the clip and drop the file on the drop zone.</dd>
  <dt>The result is on the wrong track</dt><dd>Check the destination chip under the tab before you click Generate: it names the track and position. Results that wait in the list can be placed anywhere later.</dd>
</dl>`,
    },
    {
      id: 'privacy', title: 'Privacy and credits', html: `
<ul>
  <li>Your API key stays in your system's secure key store and is sent only to api.elevenlabs.io.</li>
  <li>Only what you generate from is sent to ElevenLabs: the text or prompt, and for Voice Changer, Voice Clone and Transcribe the selected audio. LUNA's lyrics are read in the Add On and only sent as the text you generate from. Nothing else from your session leaves your computer.</li>
  <li>Every request uses your ElevenLabs credits. Variations, script and lyric lines, multi-clip changes and transcriptions each count as separate requests, and in lyrics mode a line generated again at a fitting speed counts twice.</li>
  <li>Writing to your session happens only when you place audio or click <b>Add to LUNA lyrics</b>; both are undoable in LUNA.</li>
  <li>A session someone sent you brings its History along. The Add On shows it as plain text, loads its settings only into the matching tab's fields, and plays only audio files inside that session. Nothing in it can run code or reach your API key.</li>
</ul>`,
    },
    {
      id: 'support', title: 'Support the Add On', html: `
<p>The Add On is free. If it saves you time and you'd like to say thanks, the <b>cup</b> button in the header (in both looks) opens the maker's support page (monobank Base) in your web browser, where you can leave a tip by card, from any country. It's entirely optional: nothing in the Add On changes either way.</p>
<p>The tip goes to the maker (dawnchorus) through monobank, not ElevenLabs, and has nothing to do with your ElevenLabs credits or plan. The Add On sends nothing about you or your session; it only opens the page.</p>`,
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
