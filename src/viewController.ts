/**
 * View controller: switching between the Live Serial and File views, rebuilding
 * the shared chrome (filter buttons, module list, search box, info panels) from
 * whichever session is active, and clearing a session. Sits above the log view
 * and the info panels so the data sources can trigger a view switch / clear
 * without importing the bootstrap.
 */
import {
  dom, active, serialSession, fileSession, setActive, switchInfoTab, updatePortBar,
} from './appContext';
import {emptySummary} from './deviceSummary';
import {
  addModuleButton, updateSearchCount, updatePiiButton, refreshInterest,
  disposeDecorations, SEARCH_DECO,
} from './logView';
import {refreshSummary, syncBootToggle} from './statsView';
import {refreshPanels} from './panels';

// Rebuild the shared chrome (panels, filter buttons, module list) from `active`.
export function syncChrome(): void {
  dom.moduleBtnsEl.innerHTML = '';
  for (const key of active.seenModules) addModuleButton(active, key);

  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((b) => {
    b.classList.toggle('active', active.levelFilter.has(b.dataset['level']!));
  });
  dom.logSearchInput.value = active.searchTerm;
  dom.searchFilterBtn.classList.toggle('active', active.searchFilter);
  dom.highlightLinesBtn.classList.toggle('active', active.highlightLines);
  updateSearchCount(active);
  // Refresh inline highlights for the newly active session's search term.
  if (active.searchTerm && !active.searchFilter) {
    active.search.findNext(active.searchTerm, {caseSensitive: false, incremental: true, decorations: SEARCH_DECO});
  }
  syncBootToggle();
  updatePiiButton();

  dom.summaryEl.innerHTML = '';
  dom.dataPlotEl.innerHTML = '';
  dom.diagnosisEl.innerHTML = '';
  dom.interestEl.innerHTML = '';
  dom.dataDotEl.classList.remove('visible');
  dom.diagnosisDotEl.classList.remove('visible');
  dom.interestDotEl.classList.remove('visible');
  refreshPanels(active);
  refreshInterest(active);
}

export function switchView(kind: 'serial' | 'file'): void {
  setActive(kind === 'serial' ? serialSession : fileSession);
  serialSession.container.hidden = kind !== 'serial';
  fileSession.container.hidden = kind !== 'file';

  document.getElementById('serial_controls')!.hidden = kind !== 'serial';
  document.getElementById('file_controls')!.hidden = kind !== 'file';
  // Advanced serial settings only make sense on the serial tab — collapse on file.
  if (kind !== 'serial') {
    const adv = document.getElementById('advanced')!;
    adv.hidden = true;
    const advBtn = document.getElementById('advanced_toggle');
    if (advBtn) advBtn.textContent = 'Advanced ▾';
  }

  document.querySelectorAll<HTMLButtonElement>('.view-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset['view'] === kind);
  });

  // Port bar visibility depends on serial port history (owned by serialSource).
  updatePortBar();

  syncChrome();
  active.fit.fit();
}

export function clearLog(): void {
  const s = active;
  s.lineHistory.length = 0;
  s.lineBuffer = '';
  s.pii.reset();
  s.summary = emptySummary();
  s.cumulative = emptySummary();
  s.seenModules.clear();
  s.hiddenModules.clear();
  s.showAllBoots = false;
  disposeDecorations(s);
  s.interest.length = 0;
  s.interestBySeq.clear();
  s.term.clear();
  if (s === fileSession) dom.fileNameEl.textContent = '';
  dom.moduleBtnsEl.innerHTML = '';
  dom.summaryEl.innerHTML = '';
  dom.dataPlotEl.innerHTML = '';
  dom.diagnosisEl.innerHTML = '';
  dom.interestEl.innerHTML = '';
  dom.dataDotEl.classList.remove('visible');
  dom.diagnosisDotEl.classList.remove('visible');
  dom.interestDotEl.classList.remove('visible');
  switchInfoTab('summary');
  refreshSummary(s);   // restore the resting caption (panel stays visible)
}
