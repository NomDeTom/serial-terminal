/**
 * "Live stats" info-panel: the Summary pane and the Data (charts) pane, plus the
 * boot-scope toggle ("Since last boot" vs "All logs"). Renders from the active
 * session's accumulated DeviceSummary; the rendering itself lives in
 * summaryRenderer.ts / sensorTelemetry.ts.
 */
import {dom, active} from './appContext';
import {
  renderSummary, renderHopChart, renderChannelHashChart, renderNodeStatusTile,
  renderNodeCountChart, renderSeenNodesTable, renderNodeDetailTile,
  renderNodeChannelChart, renderPeerTelemetryTile,
} from './summaryRenderer';
import {
  parseLog as parseSensorLog, toSeries, renderTelemetryCharts, renderMultiNodeUtilCharts,
} from './sensorTelemetry';
import {refreshDiagnosis} from './diagnosisView';
import {layoutMasonry} from './masonryLayout';
import type {DeviceSummary} from './deviceSummary';
import type {Session} from './logView';

// Data-panel chart controls (shared across sessions, re-applied on each render)
let dataSuppressZero = false;
const dataAutoRange = new Set<string>();    // series keys the user pinned to auto
const dataFixedRange = new Set<string>();   // series keys the user pinned to fixed
const dataEnlarged = new Set<string>();     // chart keys pinned to 2x size by clicking
const dataLogScale = new Set<string>();     // chart keys pinned to a log Y-scale
const dataAvgOnly = new Set<string>();      // mesh-util metrics showing only the average

// Which node the Data pane is scoped to. LOCAL_NODE means the device we're
// connected to / whose log this is (the default, and the only scope that has
// local-hardware charts like telemetry and mesh-node counts); any other value
// is a peer node id from summary.seenNodes.
const LOCAL_NODE = '__local__';
let dataNodeFilter = LOCAL_NODE;
// Natural (uncollapsed) width of the chip row, measured while expanded. Kept so
// the collapse decision can be re-made on resize even while collapsed, when the
// hidden chips no longer contribute to scrollWidth.
let nodeChipNaturalWidth = 0;

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

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Node scope chips: "This node" plus every heard peer, labelled with the packet
// count the peer's data is drawn from. Rendered alongside the suppress-zero
// checkbox. The <select> is a permanent sibling that CSS shows only once the
// chip row is too wide to fit (see syncNodeChipOverflow).
function renderNodeFilter(sum: DeviceSummary): string {
  const peers = Object.entries(sum.seenNodes)
      .sort(([, a], [, b]) => b.heard - a.heard);
  if (peers.length === 0) return '';

  const chip = (key: string, label: string, title: string) => {
    const active = dataNodeFilter === key ? ' active' : '';
    return `<button class="dp-node-chip${active}" data-node="${escapeAttr(key)}" ` +
      `title="${escapeAttr(title)}">${label}</button>`;
  };

  const localLabel = sum.nodeId ? `This node <span class="dp-node-id">${sum.nodeId}</span>` : 'This node';
  const chips = [chip(LOCAL_NODE, localLabel,
      'Charts for the device this log came from')];
  for (const [id, ns] of peers) {
    chips.push(chip(id, `${id} <span class="dp-node-n">(${ns.heard})</span>`,
        `${ns.heard} packet${ns.heard === 1 ? '' : 's'} heard from ${id}`));
  }

  const opts = peers.map(([id, ns]) =>
    `<option value="${escapeAttr(id)}"${dataNodeFilter === id ? ' selected' : ''}>` +
    `${id} (${ns.heard})</option>`,
  ).join('');
  const placeholder = `<option value="${LOCAL_NODE}"` +
    `${dataNodeFilter === LOCAL_NODE ? ' selected' : ''}>other nodes…</option>`;

  return '<div class="dp-nodes" id="dp_node_chips">' + chips.join('') +
    `<select class="dp-node-select" id="dp_node_select">${placeholder}${opts}</select>` +
    '</div>';
}

function renderDataControls(sum: DeviceSummary): string {
  const z = dataSuppressZero ? ' checked' : '';
  return '<div class="dp-controls">' +
    `<label><input type="checkbox" id="dp_suppress_zero"${z}>suppress zero series</label>` +
    renderNodeFilter(sum) +
    '</div>';
}

// Collapse the peer chips into the dropdown when they'd overflow the pane width,
// keeping only "This node" inline. Measured, not counted, so it adapts to long
// node ids and to the pane being resized (sidebar drag, analysis mode, mobile).
function syncNodeChipOverflow(): void {
  const el = document.getElementById('dp_node_chips');
  if (!el) return;
  const avail = el.clientWidth;
  if (avail === 0) return;   // pane hidden — nothing meaningful to measure yet
  if (!el.classList.contains('collapsed')) {
    // Expanded: scrollWidth is the true natural width, so record it and collapse
    // if it doesn't fit.
    nodeChipNaturalWidth = el.scrollWidth;
    if (nodeChipNaturalWidth > avail) el.classList.add('collapsed');
    return;
  }
  // Collapsed: the hidden chips no longer count toward scrollWidth, so compare
  // against the remembered natural width. The few px of slack stop a width that
  // lands exactly on the boundary from flapping between the two states.
  if (nodeChipNaturalWidth > 0 && avail >= nodeChipNaturalWidth + 4) {
    el.classList.remove('collapsed');
  }
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

// Tiles shown when the pane is scoped to a peer node. The local-hardware charts
// (node status, mesh-node count, hop scaling, sensor telemetry) describe the
// device running the log, so they're deliberately absent here — everything below
// is derived from packets *heard from* the selected node.
function renderPeerNodeTiles(sum: DeviceSummary, nodeId: string): string {
  const detail = plot(`node:${nodeId}`, renderNodeDetailTile(sum, nodeId));
  const chans = plot(`nodeChannels:${nodeId}`,
      renderNodeChannelChart(sum, nodeId, dataLogScale.has('nodeChannels')));
  const tele = plot(`nodeTelemetry:${nodeId}`, renderPeerTelemetryTile(sum, nodeId));
  const tables = renderSeenNodesTable(sum, nodeId)
      .map(({key, html}) => plot(key, html)).join('');
  return detail + chans + tele + tables;
}

function renderLocalNodeTiles(s: Session, sum: DeviceSummary): string {
  const statusHtml = plot('nodeStatus', renderNodeStatusTile(sum));
  const nodeCountHtml = plot('nodeCount', renderNodeCountChart(sum));
  const hopHtml = plot('hop', renderHopChart(sum));
  const chanHtml = plot('channelHash', renderChannelHashChart(sum, dataLogScale.has('channelHash')));
  // Telemetry parse is O(n) over lineHistory — only run when the panel is open,
  // and reuse the one parse for both the per-metric charts and the mesh-wide
  // utilisation overlays.
  let telHtml = '';
  let meshUtilHtml = '';
  if (dom.panelDataEl && !dom.panelDataEl.hidden) {
    const opts = {
      suppressZero: dataSuppressZero,
      autoRange: dataAutoRange,
      fixedRange: dataFixedRange,
      large: dom.workspaceEl.classList.contains('analysis'),
    };
    const rows = parseSensorLog(s.lineHistory.join('\n'));
    meshUtilHtml = renderMultiNodeUtilCharts(rows, opts, dataAvgOnly)
        .map(({key, html}) => plot(key, html)).join('');
    telHtml = renderTelemetryCharts(toSeries(rows), opts);
  }
  // One tile per channel (not one tile holding every channel's table) so the
  // masonry layout can pack each by its own height instead of leaving a gap
  // shaped like the tallest channel next to every shorter one.
  const nodesHtml = renderSeenNodesTable(sum).map(({key, html}) => plot(key, html)).join('');
  return statusHtml + nodeCountHtml + hopHtml + chanHtml + meshUtilHtml + nodesHtml + telHtml;
}

export function refreshDataPlot(s: Session): void {
  if (!dom.dataPlotEl || s !== active) return;
  const sum = s.showAllBoots ? s.cumulative : s.summary;
  // A node selected in one boot scope may not exist in the other — fall back to
  // the local view rather than rendering an empty pane.
  if (dataNodeFilter !== LOCAL_NODE && !sum.seenNodes[dataNodeFilter]) {
    dataNodeFilter = LOCAL_NODE;
  }
  const chartsHtml = dataNodeFilter === LOCAL_NODE ?
    renderLocalNodeTiles(s, sum) :
    renderPeerNodeTiles(sum, dataNodeFilter);
  if (!chartsHtml) {
    dom.dataPlotEl.innerHTML = '';
    return;
  }
  dom.dataPlotEl.innerHTML = renderDataControls(sum) + `<div class="dp-charts">${chartsHtml}</div>`;
  dom.dataDotEl?.classList.add('visible');
  nodeChipNaturalWidth = 0;   // fresh DOM — remeasure from scratch
  syncNodeChipOverflow();
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
    } else if (t.classList.contains('dp-avgonly')) {
      const key = t.dataset['key'];
      if (key === undefined) return;
      if ((t as HTMLInputElement).checked) dataAvgOnly.add(key);
      else dataAvgOnly.delete(key);
      refreshDataPlot(active);
    } else if (t.id === 'dp_node_select') {
      dataNodeFilter = (t as HTMLSelectElement).value;
      refreshDataPlot(active);
    }
  });
  // Node scope chips. Bound before the tile-enlarge handler below, which bails
  // on any click inside a <button> anyway.
  dom.dataPlotEl.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.dp-node-chip');
    if (!chip?.dataset['node']) return;
    dataNodeFilter = chip.dataset['node']!;
    refreshDataPlot(active);
  });
  dom.dataPlotEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button,input,label,a')) return;
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.dp-plot');
    if (!tile?.dataset['key']) return;
    const key = tile.dataset['key']!;
    if (dataEnlarged.has(key)) dataEnlarged.delete(key); else dataEnlarged.add(key);
    refreshDataPlot(active);
  });
  // Column count and chip-row fit both depend on live container width, and the
  // pane can go from 0 width (another info-tab active, or the sidebar collapsed)
  // to real width without refreshDataPlot() re-running — so re-evaluate both on
  // any size/visibility change.
  new ResizeObserver(() => {
    syncNodeChipOverflow();
    relayoutDataCharts();
  }).observe(dom.panelDataEl);
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
