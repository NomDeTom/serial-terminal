/**
 * Meshtastic Log Analyser
 * Based on GoogleChromeLabs/serial-terminal (Apache-2.0)
 *
 * Bootstrap / composition root. Looks up the DOM, creates the two Sessions
 * (Live Serial + File), and wires the shared chrome to the feature modules:
 *   - serialSource / fileSource — data sources
 *   - logView                   — shared terminal log view (render/filter/search/interest)
 *   - statsView / diagnosisView — info panels
 *   - viewController            — view switching + chrome sync + clear
 */
import {initDeviceInfo} from './deviceInfo';
import {initDom, initSessions, switchInfoTab, active, dom} from './appContext';
import {
  createSession, rerender, updateSearchCount, updatePiiButton, saveLog,
  SEARCH_DECO, initAutoscroll,
} from './logView';
import {setBootScope, refreshDataPlot, initDataControls} from './statsView';
import {switchView, clearLog} from './viewController';
import {initSerial} from './serialSource';
import {initFile} from './fileSource';

document.addEventListener('DOMContentLoaded', async () => {
  initDeviceInfo();
  initDom();

  initSessions(
      createSession('serial',
          document.getElementById('view_serial')!, document.getElementById('terminal_serial')!),
      createSession('file',
          document.getElementById('view_file')!, document.getElementById('terminal_file')!),
  );

  window.addEventListener('resize', () => active.fit.fit());
  window.addEventListener('focus', () => active.fit.fit());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) active.fit.fit();
  });

  initDataControls();
  initAutoscroll();
  initFile();

  // View tabs (Live Serial / File)
  document.querySelectorAll<HTMLButtonElement>('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset['view'] as 'serial' | 'file'));
  });

  // Advanced panel toggle
  const advancedPanel = document.getElementById('advanced')!;
  document.getElementById('advanced_toggle')!.addEventListener('click', (e) => {
    advancedPanel.hidden = !advancedPanel.hidden;
    (e.currentTarget as HTMLButtonElement).textContent =
      advancedPanel.hidden ? 'Advanced ▾' : 'Advanced ▴';
    active.fit.fit();
  });

  // Info panel tabs
  document.querySelectorAll<HTMLButtonElement>('.info-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset['panel'] as 'summary' | 'data' | 'diagnosis' | 'interest';
      switchInfoTab(panel);
      // Telemetry parse is deferred; trigger it now that the panel is visible.
      if (panel === 'data') refreshDataPlot(active);
    });
  });

  // Left edge: expand/collapse the analysis view
  const panelEdgeLeft = document.getElementById('panel_edge_left')!;
  const edgeArrow = document.getElementById('panel_edge_arrow')!;
  panelEdgeLeft.addEventListener('click', () => {
    if (dom.infoPanelEl.classList.contains('collapsed')) return;
    const on = dom.workspaceEl.classList.toggle('analysis');
    edgeArrow.textContent = on ? '⟩' : '⟨';
    panelEdgeLeft.title = on ? 'Collapse analysis view' : 'Expand analysis view';
    refreshDataPlot(active);   // regenerate charts at the new (large/small) size
    active.fit.fit();
  });

  // Right edge: hide/show (collapse to just this strip, which reopens on click)
  const panelEdgeRight = document.getElementById('panel_edge_right')!;
  const rightArrow = document.getElementById('panel_edge_right_arrow')!;
  panelEdgeRight.addEventListener('click', () => {
    const collapsed = dom.infoPanelEl.classList.toggle('collapsed');
    if (collapsed) dom.workspaceEl.classList.remove('analysis');  // not meaningful when hidden
    rightArrow.textContent = collapsed ? '«' : '»';
    panelEdgeRight.title = collapsed ? 'Show panel' : 'Hide panel';
    active.fit.fit();
  });

  // Boot-scope toggle (sidebar): "Since last boot" vs "All logs"
  dom.bootSinceBtn.addEventListener('click', () => setBootScope(false));
  dom.bootAllBtn.addEventListener('click', () => setBootScope(true));

  // Module all/none toggle
  document.getElementById('module_all_none')!.addEventListener('click', (e) => {
    const s = active;
    const allHidden = s.hiddenModules.size === s.seenModules.size && s.seenModules.size > 0;
    dom.moduleBtnsEl.querySelectorAll<HTMLButtonElement>('.module-btn').forEach((btn) => {
      const key = btn.dataset['mod']!;
      if (allHidden) {
        s.hiddenModules.delete(key);
        btn.classList.add('active');
      } else {
        s.hiddenModules.add(key);
        btn.classList.remove('active');
      }
    });
    (e.currentTarget as HTMLButtonElement).classList.toggle('active', allHidden);
    rerender(s);
  });

  // Level filter buttons
  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = btn.dataset['level']!;
      if (active.levelFilter.has(level)) {
        active.levelFilter.delete(level);
        btn.classList.remove('active');
      } else {
        active.levelFilter.add(level);
        btn.classList.add('active');
      }
      rerender(active);
    });
  });

  // Log search box + "Filter" chip (show only matching lines when active)
  const runSearch = () => {
    const term = active.searchTerm;
    if (term) active.search.findNext(term, {caseSensitive: false, incremental: true, decorations: SEARCH_DECO});
  };
  dom.logSearchInput.addEventListener('input', () => {
    active.searchTerm = dom.logSearchInput.value;
    if (active.searchFilter || active.highlightLines) {
      rerender(active);  // rerender calls updateSearchCount
    } else {
      runSearch();
      updateSearchCount(active);
    }
  });
  dom.logSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        active.search.findPrevious(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
      } else {
        active.search.findNext(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
      }
    } else if (e.key === 'Escape') {
      dom.logSearchInput.blur();
    }
  });
  document.getElementById('search_prev')!.addEventListener('click', () => {
    active.search.findPrevious(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
  });
  document.getElementById('search_next')!.addEventListener('click', () => {
    active.search.findNext(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
  });
  dom.searchFilterBtn.addEventListener('click', () => {
    active.searchFilter = !active.searchFilter;
    dom.searchFilterBtn.classList.toggle('active', active.searchFilter);
    rerender(active);
    if (!active.searchFilter && active.searchTerm) runSearch();
  });
  dom.highlightLinesBtn.addEventListener('click', () => {
    active.highlightLines = !active.highlightLines;
    dom.highlightLinesBtn.classList.toggle('active', active.highlightLines);
    rerender(active);
    if (active.searchTerm) runSearch();
  });

  // PII toggle
  updatePiiButton();
  dom.piiButton.addEventListener('click', () => {
    active.pii.enabled = !active.pii.enabled;
    updatePiiButton();
    rerender(active);
  });

  document.getElementById('save')!.addEventListener('click', saveLog);
  document.getElementById('clear')!.addEventListener('click', clearLog);

  switchView('serial');
  initSerial();
});
