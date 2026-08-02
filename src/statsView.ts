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
import {layoutMasonry} from './masonryLayout';
import type {Session} from './logView';

// Data-panel chart controls (shared across sessions, re-applied on each render)
let dataSuppressZero = false;
const dataAutoRange = new Set<string>();    // series keys the user pinned to auto
const dataFixedRange = new Set<string>();   // series keys the user pinned to fixed
const dataEnlarged = new Set<string>();     // chart keys pinned to 2x size by clicking
const dataLogScale = new Set<string>();     // chart keys pinned to a log Y-scale

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

// Chart tiles default to 1 masonry column; enlarging one (click-to-toggle,
// see the click handler below) requests a wider 2-column slot rather than
// jumping straight to full width.
function plot(key: string, html: string): string {
  if (!html) return '';
  const enlarged = dataEnlarged.has(key);
  return `<div class="dp-plot${enlarged ? ' dp-enlarged' : ''}" data-key="${key}" ` +
    `data-span="${enlarged ? 2 : 1}">${html}</div>`;
}

function relayoutDataCharts(): void {
  const chartsEl = dom.dataPlotEl.querySelector<HTMLElement>('.dp-charts');
  if (chartsEl) layoutMasonry(chartsEl);
}

export function refreshDataPlot(s: Session): void {
  if (!dom.dataPlotEl || s !== active) return;
  const sum = s.showAllBoots ? s.cumulative : s.summary;
  const statusHtml = plot('nodeStatus', renderNodeStatusTile(sum));
  const nodeCountHtml = plot('nodeCount', renderNodeCountChart(sum));
  const hopHtml = plot('hop', renderHopChart(sum));
  const chanHtml = plot('channelHash', renderChannelHashChart(sum, dataLogScale.has('channelHash')));
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
  // One tile per channel (not one tile holding every channel's table) so the
  // masonry layout can pack each by its own height instead of leaving a gap
  // shaped like the tallest channel next to every shorter one.
  const nodesHtml = renderSeenNodesTable(sum).map(({key, html}) => plot(key, html)).join('');
  const chartsHtml = statusHtml + nodeCountHtml + hopHtml + chanHtml + nodesHtml + telHtml;
  if (!chartsHtml) {
    dom.dataPlotEl.innerHTML = '';
    return;
  }
  dom.dataPlotEl.innerHTML = renderDataControls() + `<div class="dp-charts">${chartsHtml}</div>`;
  dom.dataDotEl?.classList.add('visible');
  relayoutDataCharts();
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
    } else if (t.classList.contains('dp-logscale')) {
      const key = t.dataset['key'];
      if (key === undefined) return;
      if ((t as HTMLInputElement).checked) dataLogScale.add(key);
      else dataLogScale.delete(key);
      refreshDataPlot(active);
    }
  });
  dom.dataPlotEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button,input,label,a')) return;
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.dp-plot');
    if (!tile?.dataset['key']) return;
    const key = tile.dataset['key']!;
    if (dataEnlarged.has(key)) dataEnlarged.delete(key); else dataEnlarged.add(key);
    refreshDataPlot(active);
  });
  // Column count depends on live container width, and the pane can go from
  // 0 width (another info-tab active, or the sidebar collapsed) to real width
  // without refreshDataPlot() re-running — reflow on any size/visibility change.
  new ResizeObserver(relayoutDataCharts).observe(dom.panelDataEl);
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
