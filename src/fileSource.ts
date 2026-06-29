/**
 * File data source: loading a saved log file into the file Session — via the
 * load button, the hidden file input, or drag-and-drop — with a chunked,
 * yield-between-chunks loader so a large file doesn't freeze the UI. Feeds lines
 * into the shared log view (logView.addLine) and refreshes the panels once at the
 * end. Mirrors serialSource but for static files.
 */
import {dom, active, fileSession} from './appContext';
import {addLine, refreshInterest} from './logView';
import {switchView, clearLog} from './viewController';
import {refreshPanels} from './panels';
import {flushMultiLine} from './multiLineMatch';

function setFileProgress(frac: number): void {
  if (!dom.fileProgressEl) return;
  dom.fileProgressEl.hidden = false;
  const pct = Math.round(frac * 100);
  dom.fileProgressFillEl.style.width = `${pct}%`;
  dom.fileProgressPctEl.textContent = `${pct}%`;
}

async function loadFileInto(file: File): Promise<void> {
  switchView('file');
  clearLog();
  dom.fileNameEl.textContent = file.name;
  setFileProgress(0);
  const text = await file.text();
  const lines = text.split(/\r?\n/);
  const total = lines.length;
  const CHUNK = 2000;
  try {
    for (let i = 0; i < total; i += CHUNK) {
      const end = Math.min(i + CHUNK, total);
      for (let j = i; j < end; j++) {
        if (lines[j]) addLine(fileSession, lines[j], true);
      }
      setFileProgress(end / total);
      // Yield so the browser can paint the progress bar between chunks.
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Finalise any multi-line event still pending at end-of-stream.
    flushMultiLine(fileSession.summary);
    flushMultiLine(fileSession.cumulative);
    // Bulk load deferred per-line rendering — refresh the panels once now.
    refreshPanels(fileSession);
    refreshInterest(fileSession);
  } catch (err) {
    console.error('loadFileInto: error during line processing:', err);
  }
  if (dom.fileProgressEl) dom.fileProgressEl.hidden = true;
  active.fit.fit();
  active.term.scrollToBottom();
}

function initDragDrop(): void {
  const overlay = document.getElementById('drop_overlay')!;
  let dragDepth = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('active');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      overlay.classList.remove('active');
    }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove('active');
    const file = e.dataTransfer?.files[0];
    if (file) loadFileInto(file);
  });
}

// Wire the file-load button, the hidden file input, and drag-and-drop.
export function initFile(): void {
  const fileInput = document.getElementById('file_input') as HTMLInputElement;
  document.getElementById('load_file_btn')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) loadFileInto(f);
    fileInput.value = '';
  });
  initDragDrop();
}
