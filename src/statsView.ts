/**
 * "Live stats" info-panel: the Summary pane and the Data (charts) pane, plus the
 * boot-scope toggle ("Since last boot" vs "All logs"). Renders from the active
 * session's accumulated DeviceSummary; the rendering itself lives in
 * summaryRenderer.ts / sensorTelemetry.ts.
 */
import {dom, active} from './appContext';
import {
  renderSummary, renderHopChart, renderChannelHashChart, renderNodeStatusTile,
  renderNodeCountChart, renderSeenNodesTable,
} from './summaryRenderer';
import {parseLog as parseSensorLog, toSeries, renderTelemetryCharts} from './sensorTelemetry';
import {refreshDiagnosis} from './diagnosisView';
import type {Session} from './logView';

// Data-panel chart controls (shared across sessions, re-applied on each render)
let dataSuppressZero = false;
const dataAutoRange = new Set<string>();    // series keys the user pinned to auto
const dataFixedRange = new Set<string>();   // series keys the user pinned to fixed

// Caption shown in the summary pane before any data has been parsed.
function restingCaption(): string {
  const msg = active.kind === 'file' ?
    'Upload a log file to begin' :
    'Select a port to begin';
  return `<div class="summary-resting">${msg}</div>`;
}

export function refreshSummary(s: Session): void {
  if (!dom.summaryEl || s !== active) return;
  const html = renderSummary(s.showAllBoots ? s.cumulative : s.summary);
  dom.summaryEl.innerHTML = html || restingCaption();
}

function renderDataControls(): string {
  const z = dataSuppressZero ? ' checked' : '';
  return '<div class="dp-controls">' +
    `<label><input type="checkbox" id="dp_suppress_zero"${z}>suppress zero series</label>` +
    '</div>';
}

export function refreshDataPlot(s: Session): void {
  if (!dom.dataPlotEl || s !== active) return;
  const sum = s.showAllBoots ? s.cumulative : s.summary;
  const statusHtml = renderNodeStatusTile(sum);
  const nodeCountHtml = renderNodeCountChart(sum);
  const hopHtml = renderHopChart(sum);
  const chanHtml = renderChannelHashChart(sum);
  // Telemetry parse is O(n) over lineHistory — only run when the panel is open.
  let telHtml = '';
  if (dom.panelDataEl && !dom.panelDataEl.hidden) {
    const opts = {
      suppressZero: dataSuppressZero,
      autoRange: dataAutoRange,
      fixedRange: dataFixedRange,
      large: dom.workspaceEl.classList.contains('analysis'),
    };
    telHtml = renderTelemetryCharts(toSeries(parseSensorLog(s.lineHistory.join('\n'))), opts);
  }
  const nodesHtml = renderSeenNodesTable(sum);
  const chartsHtml = statusHtml + nodeCountHtml + hopHtml + chanHtml + nodesHtml + telHtml;
  if (!chartsHtml) {
    dom.dataPlotEl.innerHTML = '';
    return;
  }
  dom.dataPlotEl.innerHTML = renderDataControls() + `<div class="dp-charts">${chartsHtml}</div>`;
  dom.dataDotEl?.classList.add('visible');
}

// Delegated handler for the data-panel chart controls (content is rebuilt on
// every refresh, so the listener lives on the container).
export function initDataControls(): void {
  dom.dataPlotEl.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'dp_suppress_zero') {
      dataSuppressZero = (t as HTMLInputElement).checked;
      refreshDataPlot(active);
    } else if (t.classList.contains('dp-autorange')) {
      const key = t.dataset['key'];
      if (key === undefined) return;
      // Record the user's explicit pin so it overrides the metric's default.
      if ((t as HTMLInputElement).checked) {
        dataAutoRange.add(key);
        dataFixedRange.delete(key);
      } else {
        dataFixedRange.add(key);
        dataAutoRange.delete(key);
      }
      refreshDataPlot(active);
    }
  });
}

// ── Boot-scope segmented toggle ("Since last boot" vs "All logs") ─────────────
export function syncBootToggle(): void {
  if (!dom.bootSinceBtn) return;
  dom.bootSinceBtn.classList.toggle('active', !active.showAllBoots);
  dom.bootAllBtn.classList.toggle('active', active.showAllBoots);
}

export function setBootScope(allLogs: boolean): void {
  active.showAllBoots = allLogs;
  syncBootToggle();
  refreshSummary(active);
  refreshDiagnosis(active);
  refreshDataPlot(active);
}
