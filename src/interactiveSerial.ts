/**
 * Interactive serial: the only place in the app that writes to the open port
 * rather than just reading from it. Two input styles, toggled by the user:
 *  - "type"  — raw keystroke passthrough via xterm's onData, for a live
 *              terminal feel (echo, if any, comes from the device itself).
 *  - "entry" — a line-buffered input box; type a command, press Enter/Send.
 * Only meaningful on the Live Serial view (there's no port to write to from
 * a loaded file), so enabling it switches there, and it turns itself off if
 * the user switches to the File view directly (see setOnViewSwitched below).
 */
import {dom, serialSession, setOnViewSwitched} from './appContext';
import {switchView} from './viewController';
import {sendSerialData, isSerialConnected} from './serialSource';

type InteractiveStyle = 'type' | 'entry';

let interactiveMode = false;
let interactiveStyle: InteractiveStyle = 'type';

function syncInteractiveUi(): void {
  dom.interactiveToggleBtn.classList.toggle('active', interactiveMode);
  dom.interactiveControlsEl.hidden = !interactiveMode;
  dom.interactiveStyleTypeBtn.classList.toggle('active', interactiveStyle === 'type');
  dom.interactiveStyleEntryBtn.classList.toggle('active', interactiveStyle === 'entry');
  // Both bars live under the terminal now (not nested under
  // interactiveControlsEl), so their hidden state has to account for
  // interactiveMode itself, not just which style is selected.
  dom.interactiveTypeHintEl.hidden = !(interactiveMode && interactiveStyle === 'type');
  const showEntryBar = interactiveMode && interactiveStyle === 'entry';
  dom.interactiveEntryRowEl.hidden = !showEntryBar;
  // The terminal's available height changed (entry bar appeared/disappeared) —
  // xterm needs to know so it can recompute rows/cols.
  serialSession.fit.fit();
}

function setInteractiveStyle(style: InteractiveStyle): void {
  interactiveStyle = style;
  syncInteractiveUi();
}

function disableInteractiveMode(): void {
  if (!interactiveMode) return;
  interactiveMode = false;
  syncInteractiveUi();
}

function toggleInteractiveMode(): void {
  interactiveMode = !interactiveMode;
  if (interactiveMode) switchView('serial'); // nothing to write to from the File view
  syncInteractiveUi();
}

async function sendEntryBoxValue(): Promise<void> {
  const text = dom.interactiveInputEl.value;
  if (!text) return;
  if (!isSerialConnected()) {
    serialSession.term.writeln('\x1b[33m<Not connected — connect to a port first>\x1b[0m');
    return;
  }
  const suffix = dom.interactiveNewlineCheckbox.checked ? '\n' : '';
  await sendSerialData(text + suffix);
  serialSession.term.writeln(`\x1b[36m» ${text}\x1b[0m`);
  dom.interactiveInputEl.value = '';
}

export function initInteractiveControls(): void {
  dom.interactiveToggleBtn.addEventListener('click', toggleInteractiveMode);
  dom.interactiveStyleTypeBtn.addEventListener('click', () => setInteractiveStyle('type'));
  dom.interactiveStyleEntryBtn.addEventListener('click', () => setInteractiveStyle('entry'));
  dom.interactiveSendBtn.addEventListener('click', sendEntryBoxValue);
  dom.interactiveInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendEntryBoxValue();
    }
  });

  // Turn off when the user leaves the Live Serial view some other way (e.g.
  // clicking the File tab directly) — there's no port to write to there.
  setOnViewSwitched((kind) => {
    if (kind === 'file') disableInteractiveMode();
  });

  // Raw keystroke passthrough. onData fires on every keypress/paste typed
  // into the terminal while it has focus — always registered, but the send
  // itself is gated on mode+style so it's a no-op (and doesn't touch the
  // port) whenever interactive typing isn't actually turned on.
  serialSession.term.onData((data) => {
    if (interactiveMode && interactiveStyle === 'type' && isSerialConnected()) {
      sendSerialData(data);
    }
  });
}
