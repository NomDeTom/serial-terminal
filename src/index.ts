/**
 * Meshtastic Log Analyser
 * Based on GoogleChromeLabs/serial-terminal (Apache-2.0)
 */

import {Terminal, IDecoration, IMarker} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {SearchAddon} from '@xterm/addon-search';
import {WebLinksAddon} from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {serial as polyfill, SerialPort as SerialPortPolyfill} from 'web-serial-polyfill';
import {PiiFilter} from './piiFilter';
import {parseLine, colorize, preprocessLine} from './logParser';
import {annotateLine, Annotation} from './annotations';
import {
  DeviceSummary, emptySummary, updateSummary, updateSummaryCumulative,
  renderSummary, renderHopChart, renderChannelHashChart, renderNodeStatusTile,
  renderNodeCountChart, renderSeenNodesTable,
} from './logSummary';
import {parseLog as parseSensorLog, toSeries, renderTelemetryCharts} from './sensorTelemetry';
import {renderDiagnosis} from './diagnosis';
import {initDeviceInfo} from './deviceInfo';

declare class PortOption extends HTMLOptionElement {
  port: SerialPort | SerialPortPolyfill;
}

const MAX_HISTORY = 10_000;
const bufferSize = 8 * 1024;

interface InterestEntry {
  seq: number;              // stable id for DOM lookup
  ann: Annotation;
  snippet: string;          // ANSI-stripped line text
  marker?: IMarker;         // present only while the line is rendered (passes filters)
}

// All per-session state: each of the Live Serial and File views owns one.
interface Session {
  kind: 'serial' | 'file';
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLElement;    // the .term-wrap toggled on view switch
  pii: PiiFilter;
  lineHistory: string[];
  lineBuffer: string;
  summary: DeviceSummary;
  cumulative: DeviceSummary;
  showAllBoots: boolean;
  levelFilter: Set<string>;
  searchTerm: string;        // raw text from the search box
  searchFilter: boolean;     // when true, only lines matching searchTerm render
  seenModules: Set<string>;
  hiddenModules: Set<string>;
  interest: InterestEntry[];
  interestBySeq: Map<number, InterestEntry>;
  interestSeq: number;
  decorations: IDecoration[];
  decoMarkers: IMarker[];
}

let serialSession: Session;
let fileSession: Session;
let active: Session;

let lineTip: HTMLElement | undefined;

// Shared chrome (renders from the active session)
let summaryEl: HTMLElement;
let dataPlotEl: HTMLElement;
let diagnosisEl: HTMLElement;
let interestEl: HTMLElement;
let moduleBtnsEl: HTMLElement;
let logSearchInput: HTMLInputElement;
let searchFilterBtn: HTMLButtonElement;
let portChipsEl: HTMLElement | undefined;
let infoPanelEl: HTMLElement;
let dataDotEl: HTMLElement;
let diagnosisDotEl: HTMLElement;
let interestDotEl: HTMLElement;
let panelSummaryEl: HTMLElement;
let panelDataEl: HTMLElement;
let panelDiagnosisEl: HTMLElement;
let panelInterestEl: HTMLElement;
let workspaceEl: HTMLElement;

// Search decoration: highlight every match in amber; brighten the active one.
const SEARCH_DECO = {
  matchBackground: 'rgba(245,158,11,0.25)',
  matchBorder: 'rgba(245,158,11,0.5)',
  matchOverviewRuler: '#f59e0b',
  activeMatchBackground: 'rgba(245,158,11,0.75)',
  activeMatchBorder: '#f59e0b',
  activeMatchColorOverviewRuler: '#f59e0b',
};

// Data-panel chart controls (shared across sessions, re-applied on each render)
let dataSuppressZero = false;
const dataAutoRange = new Set<string>();    // series keys the user pinned to auto
const dataFixedRange = new Set<string>();   // series keys the user pinned to fixed

let bootSinceBtn: HTMLButtonElement;
let bootAllBtn: HTMLButtonElement;
let autoscrollBtn: HTMLButtonElement;
let autoscroll = true;
let piiButton: HTMLButtonElement;
let fileNameEl: HTMLElement;
let fileProgressEl: HTMLElement;
let fileProgressFillEl: HTMLElement;
let fileProgressPctEl: HTMLElement;

interface PortRecord { label: string; status: 'available' | 'gone'; }
const portHistory = new Map<SerialPort | SerialPortPolyfill, PortRecord>();

let portSelector: HTMLSelectElement;
let connectButton: HTMLButtonElement;
let baudRateSelector: HTMLSelectElement;
let customBaudRateInput: HTMLInputElement;
let dataBitsSelector: HTMLSelectElement;
let paritySelector: HTMLSelectElement;
let stopBitsSelector: HTMLSelectElement;
let flowControlCheckbox: HTMLInputElement;
let reconnectCheckbox: HTMLInputElement;
let grabNextCheckbox: HTMLInputElement;
let statusDot: HTMLElement;

let portCounter = 1;
let port: SerialPort | SerialPortPolyfill | undefined;
let reconnectPort: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;

const urlParams = new URLSearchParams(window.location.search);
const usePolyfill = urlParams.has('polyfill');

function createSession(kind: 'serial' | 'file', container: HTMLElement, mount: HTMLElement): Session {
  const term = new Terminal({
    allowProposedApi: true,
    scrollback: MAX_HISTORY,
    theme: {
      background: '#111827',
      foreground: '#f3f4f6',
      cursor: '#67EA94',
      cursorAccent: '#111827',
      selectionBackground: '#374151',
    },
    fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
    fontSize: 13,
    convertEol: true,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());
  term.open(mount);
  return {
    kind, term, fit, search, container, pii: new PiiFilter(),
    lineHistory: [], lineBuffer: '',
    summary: emptySummary(), cumulative: emptySummary(), showAllBoots: false,
    levelFilter: new Set(['D', 'I', 'W', 'E', 'C']),
    searchTerm: '', searchFilter: false,
    seenModules: new Set(), hiddenModules: new Set(),
    interest: [], interestBySeq: new Map(), interestSeq: 0,
    decorations: [], decoMarkers: [],
  };
}

function moduleKey(module: string): string {
  return module || '__boot__';
}

function linePassesFilter(s: Session, line: string): boolean {
  const {level, module} = parseLine(line);
  if (level && !s.levelFilter.has(level)) return false;
  if (s.hiddenModules.has(moduleKey(module))) return false;
  if (s.searchFilter && s.searchTerm &&
      !line.toLowerCase().includes(s.searchTerm.toLowerCase())) return false;
  return true;
}

function addModuleButton(s: Session, key: string): void {
  const label = key === '__boot__' ? 'boot' : key;
  const btn = document.createElement('button');
  btn.className = `module-btn${s.hiddenModules.has(key) ? '' : ' active'}`;
  btn.textContent = label;
  btn.dataset['mod'] = key;
  btn.addEventListener('click', () => {
    if (s.hiddenModules.has(key)) {
      s.hiddenModules.delete(key);
      btn.classList.add('active');
    } else {
      s.hiddenModules.add(key);
      btn.classList.remove('active');
    }
    rerender(s);
  });
  moduleBtnsEl.appendChild(btn);
}

// Two leading spaces reserve a left gutter that annotation decorations overlay.
const GUTTER = '  ';

function renderLine(s: Session, clean: string): string {
  const body = s.pii.enabled ?
    s.pii.highlightPlaceholders(colorize(s.pii.filter(clean))) :
    s.pii.annotate(colorize(clean));
  return GUTTER + body;
}

// ── Line annotations (gutter markers + hover tooltip) ─────────────────────────

function showLineTip(target: HTMLElement, text: string): void {
  if (!lineTip) {
    lineTip = document.createElement('div');
    lineTip.className = 'line-tip';
    document.body.appendChild(lineTip);
  }
  lineTip.textContent = text;
  const r = target.getBoundingClientRect();
  lineTip.style.left = `${Math.round(r.right + 6)}px`;
  lineTip.style.top = `${Math.round(r.top)}px`;
  lineTip.classList.add('visible');
}

function hideLineTip(): void {
  lineTip?.classList.remove('visible');
}

function decorateGutter(el: HTMLElement, ann: Annotation, entry?: InterestEntry): void {
  if (el.dataset['wired']) return;
  el.dataset['wired'] = '1';
  el.textContent = ann.severity === 'info' ? '💡' : '⚠️';
  el.classList.add('log-gutter', ann.severity === 'info' ? 'gutter-info' : 'gutter-fault');
  el.addEventListener('mouseenter', () => showLineTip(el, ann.comment));
  el.addEventListener('mouseleave', hideLineTip);
  if (entry) el.addEventListener('click', () => openInterestEntry(entry));
}

// Writes a line to the session's terminal and attaches a gutter decoration if it
// is an annotated line. When `entry` is supplied its `marker` is linked so the
// Interest tab can scroll to the line.
function writeAndDecorate(s: Session, clean: string, ann?: Annotation, entry?: InterestEntry): void {
  if (!ann) {
    s.term.writeln(renderLine(s, clean));
    return;
  }
  s.term.writeln(renderLine(s, clean), () => {
    const marker = s.term.registerMarker(-1);
    if (!marker) return;
    s.decoMarkers.push(marker);
    if (entry) entry.marker = marker;
    const deco = s.term.registerDecoration({marker, x: 0, width: 2, layer: 'top'});
    if (deco) {
      deco.onRender((el) => decorateGutter(el, ann, entry));
      s.decorations.push(deco);
    }
  });
}

function disposeDecorations(s: Session): void {
  for (const d of s.decorations) d.dispose();
  for (const m of s.decoMarkers) m.dispose();
  s.decorations.length = 0;
  s.decoMarkers.length = 0;
  for (const e of s.interest) e.marker = undefined;
  hideLineTip();
}

// ── Lines of Interest tab ─────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInterestGroup(title: string, entries: InterestEntry[], fault: boolean): string {
  const divider = `<div class="sum-divider${fault ? ' sum-divider-err' : ''}">` +
    `${title} (${entries.length})</div>`;
  const rows = entries.map((e) => {
    const hidden = e.marker ? '' : ' <span class="int-hidden">hidden</span>';
    const snip = escapeHtml(e.snippet.slice(0, 140));
    const tip = e.ann.comment.replace(/"/g, '&quot;');
    return `<div class="int-row" data-seq="${e.seq}" data-tooltip="${tip}">` +
      `<span class="int-title">${escapeHtml(e.ann.title)}${hidden}</span>` +
      `<span class="int-snip">${snip}</span></div>`;
  }).join('');
  return divider + rows;
}

function refreshInterest(s: Session): void {
  if (!interestEl || s !== active) return;
  interestDotEl?.classList.toggle('visible', s.interest.length > 0);
  if (s.interest.length === 0) {
    interestEl.innerHTML = '<div class="int-empty">No lines of interest yet.</div>';
    return;
  }
  const faults = s.interest.filter((e) => e.ann.severity !== 'info');
  const infos = s.interest.filter((e) => e.ann.severity === 'info');
  const parts: string[] = [];
  if (faults.length) parts.push(renderInterestGroup('⚠ Faults', faults, true));
  if (infos.length) parts.push(renderInterestGroup('💡 Explained', infos, false));
  interestEl.innerHTML = parts.join('');
  interestEl.querySelectorAll<HTMLElement>('.int-row').forEach((row) => {
    row.addEventListener('click', () => {
      const e = s.interestBySeq.get(Number(row.dataset['seq']));
      if (e) revealLine(s, e);
    });
  });
}

// Flash the whole terminal row at a marker briefly, then remove the highlight.
function flashLine(s: Session, marker: IMarker): void {
  const deco = s.term.registerDecoration({marker, x: 0, width: s.term.cols});
  if (!deco) return;
  deco.onRender((el) => el.classList.add('line-flash'));
  setTimeout(() => deco.dispose(), 1200);
}

// Interest row → terminal: scroll to the line (clearing filters first if hidden).
function revealLine(s: Session, entry: InterestEntry): void {
  if (!entry.marker) {
    resetFilters(s);
    rerender(s);
  }
  if (entry.marker) {
    s.term.scrollToLine(entry.marker.line);
    flashLine(s, entry.marker);
  }
}

// Gutter marker → Interest tab: open the tab and pulse the matching row.
function openInterestEntry(entry: InterestEntry): void {
  switchInfoTab('interest');
  const row = interestEl?.querySelector<HTMLElement>(`.int-row[data-seq="${entry.seq}"]`);
  if (row) {
    row.scrollIntoView({block: 'nearest'});
    row.classList.remove('int-pulse');
    void row.offsetWidth; // restart the animation
    row.classList.add('int-pulse');
  }
}

// ── Info panel management ─────────────────────────────────────────────────────

function switchInfoTab(panel: 'summary' | 'data' | 'diagnosis' | 'interest'): void {
  panelSummaryEl.hidden = panel !== 'summary';
  panelDataEl.hidden = panel !== 'data';
  panelDiagnosisEl.hidden = panel !== 'diagnosis';
  panelInterestEl.hidden = panel !== 'interest';
  document.querySelectorAll<HTMLButtonElement>('.info-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['panel'] === panel);
  });
}

// ── Data pipeline ─────────────────────────────────────────────────────────────

// When deferRender is true the panel refreshes are skipped (caller refreshes
// once at the end) — used by bulk file loading so it isn't O(lines × render).
function addLine(s: Session, raw: string, deferRender = false): void {
  const clean = preprocessLine(raw);
  if (s.lineHistory.length >= MAX_HISTORY) {
    const removed = s.lineHistory.shift();
    // Keep the interest list aligned with the annotated lines still in history.
    if (removed !== undefined && annotateLine(removed)) {
      const old = s.interest.shift();
      if (old) {
        s.interestBySeq.delete(old.seq);
        old.marker?.dispose();
      }
    }
  }
  s.lineHistory.push(clean);
  updateSummary(clean, s.summary);
  updateSummaryCumulative(clean, s.cumulative);
  if (!deferRender) {
    refreshSummary(s);
    refreshDiagnosis(s);
    refreshDataPlot(s);
  }
  const key = moduleKey(parseLine(clean).module);
  if (!s.seenModules.has(key)) {
    s.seenModules.add(key);
    if (s === active) addModuleButton(s, key);
  }
  const ann = annotateLine(clean);
  let entry: InterestEntry | undefined;
  if (ann) {
    entry = {seq: s.interestSeq++, ann, snippet: clean};
    s.interest.push(entry);
    s.interestBySeq.set(entry.seq, entry);
    if (!deferRender) refreshInterest(s);
  }
  if (linePassesFilter(s, clean)) {
    writeAndDecorate(s, clean, ann, entry);
    if (autoscroll && !deferRender) s.term.scrollToBottom();
  }
}

// Boot-scope segmented toggle ("Since last boot" vs "All logs").
function syncBootToggle(): void {
  if (!bootSinceBtn) return;
  bootSinceBtn.classList.toggle('active', !active.showAllBoots);
  bootAllBtn.classList.toggle('active', active.showAllBoots);
}

function setBootScope(allLogs: boolean): void {
  active.showAllBoots = allLogs;
  syncBootToggle();
  refreshSummary(active);
  refreshDiagnosis(active);
  refreshDataPlot(active);
}

// Caption shown in the summary pane before any data has been parsed.
function restingCaption(): string {
  const msg = active.kind === 'file' ?
    'Upload a log file to begin' :
    'Select a port to begin';
  return `<div class="summary-resting">${msg}</div>`;
}

function refreshSummary(s: Session): void {
  if (!summaryEl || s !== active) return;
  const html = renderSummary(s.showAllBoots ? s.cumulative : s.summary);
  summaryEl.innerHTML = html || restingCaption();
}

function refreshDiagnosis(s: Session): void {
  if (!diagnosisEl || s !== active) return;
  const html = renderDiagnosis(s.showAllBoots ? s.cumulative : s.summary);
  diagnosisEl.innerHTML = html;
  const hasAlerts = html.includes('diag-crit') || html.includes('diag-warn');
  diagnosisDotEl?.classList.toggle('visible', hasAlerts);
}

function renderDataControls(): string {
  const z = dataSuppressZero ? ' checked' : '';
  return '<div class="dp-controls">' +
    `<label><input type="checkbox" id="dp_suppress_zero"${z}>suppress zero series</label>` +
    '</div>';
}

function refreshDataPlot(s: Session): void {
  if (!dataPlotEl || s !== active) return;
  const sum = s.showAllBoots ? s.cumulative : s.summary;
  const statusHtml = renderNodeStatusTile(sum);
  const nodeCountHtml = renderNodeCountChart(sum);
  const hopHtml = renderHopChart(sum);
  const chanHtml = renderChannelHashChart(sum);
  // Telemetry parse is O(n) over lineHistory — only run when the panel is open.
  let telHtml = '';
  if (panelDataEl && !panelDataEl.hidden) {
    const opts = {
      suppressZero: dataSuppressZero,
      autoRange: dataAutoRange,
      fixedRange: dataFixedRange,
      large: workspaceEl.classList.contains('analysis'),
    };
    telHtml = renderTelemetryCharts(toSeries(parseSensorLog(s.lineHistory.join('\n'))), opts);
  }
  const nodesHtml = renderSeenNodesTable(sum);
  const chartsHtml = statusHtml + nodeCountHtml + hopHtml + chanHtml + nodesHtml + telHtml;
  if (!chartsHtml) {
    dataPlotEl.innerHTML = '';
    return;
  }
  dataPlotEl.innerHTML = renderDataControls() + `<div class="dp-charts">${chartsHtml}</div>`;
  dataDotEl?.classList.add('visible');
}

function resetFilters(s: Session): void {
  for (const lv of ['D', 'I', 'W', 'E', 'C']) s.levelFilter.add(lv);
  s.hiddenModules.clear();
  s.searchFilter = false;
  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((b) => b.classList.add('active'));
  document.querySelectorAll<HTMLButtonElement>('.module-btn').forEach((b) => b.classList.add('active'));
  searchFilterBtn?.classList.remove('active');
}

function rerender(s: Session): void {
  disposeDecorations(s);
  s.term.clear();
  let ip = 0;
  for (const line of s.lineHistory) {
    const ann = annotateLine(line);
    const entry = ann ? s.interest[ip++] : undefined;
    if (linePassesFilter(s, line)) {
      writeAndDecorate(s, line, ann, entry);
    }
  }
  refreshInterest(s);
}

function processChunk(s: Session, chunk: Uint8Array): void {
  const text = new TextDecoder().decode(chunk);
  const parts = (s.lineBuffer + text).split('\n');
  s.lineBuffer = parts.pop() ?? '';
  for (const line of parts) {
    addLine(s, line.replace(/\r$/, ''));
  }
}

// ── View switching (Live Serial ↔ File) ───────────────────────────────────────

function updatePiiButton(): void {
  const on = active.pii.enabled;
  const eg = on ?
    '<span class="pii-eg">lat=[REDACTED] lon=[REDACTED]</span>' :
    '<span class="pii-eg">lat=52.944 lon=-1.435</span>';
  piiButton.innerHTML = `🕵️ Hide PII: ${on ? 'ON' : 'OFF'} ${eg}`;
  piiButton.classList.toggle('btn-active', on);
}

// Rebuild the shared chrome (panels, filter buttons, module list) from `active`.
function syncChrome(): void {
  moduleBtnsEl.innerHTML = '';
  for (const key of active.seenModules) addModuleButton(active, key);

  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((b) => {
    b.classList.toggle('active', active.levelFilter.has(b.dataset['level']!));
  });
  logSearchInput.value = active.searchTerm;
  searchFilterBtn.classList.toggle('active', active.searchFilter);
  // Refresh inline highlights for the newly active session's search term.
  if (active.searchTerm && !active.searchFilter) {
    active.search.findNext(active.searchTerm, {caseSensitive: false, incremental: true, decorations: SEARCH_DECO});
  }
  syncBootToggle();
  updatePiiButton();

  summaryEl.innerHTML = '';
  dataPlotEl.innerHTML = '';
  diagnosisEl.innerHTML = '';
  interestEl.innerHTML = '';
  dataDotEl.classList.remove('visible');
  diagnosisDotEl.classList.remove('visible');
  interestDotEl.classList.remove('visible');
  refreshSummary(active);
  refreshDiagnosis(active);
  refreshDataPlot(active);
  refreshInterest(active);
}

function switchView(kind: 'serial' | 'file'): void {
  active = kind === 'serial' ? serialSession : fileSession;
  serialSession.container.hidden = kind !== 'serial';
  fileSession.container.hidden = kind !== 'file';

  document.getElementById('serial_controls')!.hidden = kind !== 'serial';
  document.getElementById('file_controls')!.hidden = kind !== 'file';
  document.getElementById('port_bar')!.hidden = kind !== 'serial' || portHistory.size === 0;
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

  syncChrome();
  active.fit.fit();
}

// ── File loading ───────────────────────────────────────────────────────────────

function setFileProgress(frac: number): void {
  if (!fileProgressEl) return;
  fileProgressEl.hidden = false;
  const pct = Math.round(frac * 100);
  fileProgressFillEl.style.width = `${pct}%`;
  fileProgressPctEl.textContent = `${pct}%`;
}

async function loadFileInto(file: File): Promise<void> {
  switchView('file');
  clearLog();
  fileNameEl.textContent = file.name;
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
    // Bulk load deferred per-line rendering — refresh the panels once now.
    refreshSummary(fileSession);
    refreshDiagnosis(fileSession);
    refreshDataPlot(fileSession);
    refreshInterest(fileSession);
  } catch (err) {
    console.error('loadFileInto: error during line processing:', err);
  }
  if (fileProgressEl) fileProgressEl.hidden = true;
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

// ── Port management ────────────────────────────────────────────────────────────

function findPortOption(p: SerialPort | SerialPortPolyfill): PortOption | null {
  for (let i = 0; i < portSelector.options.length; ++i) {
    const option = portSelector.options[i];
    if (option.value === 'prompt') continue;
    const portOption = option as PortOption;
    if (portOption.port === p) return portOption;
  }
  return null;
}

// Clicking a port chip connects to that port (disconnecting the current one
// first if needed). Clicking the already-connected chip disconnects.
async function handlePortChipClick(
    p: SerialPort | SerialPortPolyfill, record: PortRecord): Promise<void> {
  if (p === port) {
    await disconnectFromPort();
    return;
  }
  if (record.status !== 'available') return;
  if (port) await disconnectFromPort();
  const opt = findPortOption(p);
  if (!opt) return;
  opt.selected = true;
  connectToPort();
}

function updatePortBar(): void {
  const el = portChipsEl;
  if (!el) return;
  el.innerHTML = '';

  const entries = Array.from(portHistory.entries());
  entries.sort(([pa, ra], [pb, rb]) => {
    const rank = (p: SerialPort | SerialPortPolyfill, r: PortRecord): number =>
      p === port ? 0 : r.status === 'available' ? 1 : 2;
    return rank(pa, ra) - rank(pb, rb);
  });

  const goneLabels: string[] = [];
  for (const [p, record] of entries) {
    const isConnected = p === port;
    if (!isConnected && record.status === 'gone') {
      goneLabels.push(record.label);
      continue;
    }
    const chip = document.createElement('span');
    chip.className = `port-chip ${isConnected ? 'port-connected' : 'port-available'}`;
    chip.textContent = record.label;
    chip.title = isConnected ? 'Connected — click to disconnect' : 'Click to connect';
    chip.addEventListener('click', () => handlePortChipClick(p, record));
    el.appendChild(chip);
  }

  if (goneLabels.length > 0) {
    const badge = document.createElement('span');
    badge.className = 'port-gone-count';
    badge.textContent = `+${goneLabels.length} gone`;
    badge.title = goneLabels.join(', ');
    el.appendChild(badge);
  }

  document.getElementById('port_bar')!.hidden = active.kind !== 'serial' || portHistory.size === 0;
}

function addNewPort(p: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = document.createElement('option') as PortOption;
  portOption.textContent = `Port ${portCounter++}`;
  portOption.port = p;
  portSelector.appendChild(portOption);
  portHistory.set(p, {label: portOption.textContent, status: 'available'});
  updatePortBar();
  return portOption;
}

function maybeAddNewPort(p: SerialPort | SerialPortPolyfill): PortOption {
  return findPortOption(p) ?? addNewPort(p);
}

function saveLog(): void {
  const s = active;
  if (s.lineHistory.length === 0) return;
  const lines = s.pii.enabled ? s.lineHistory.map((l) => s.pii.filter(l)) : s.lineHistory;
  const blob = new Blob([lines.join('\n')], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `meshtastic-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

function clearLog(): void {
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
  if (s === fileSession) fileNameEl.textContent = '';
  moduleBtnsEl.innerHTML = '';
  summaryEl.innerHTML = '';
  dataPlotEl.innerHTML = '';
  diagnosisEl.innerHTML = '';
  interestEl.innerHTML = '';
  dataDotEl.classList.remove('visible');
  diagnosisDotEl.classList.remove('visible');
  interestDotEl.classList.remove('visible');
  switchInfoTab('summary');
  refreshSummary(s);   // restore the resting caption (panel stays visible)
}

function getSelectedBaudRate(): number {
  if (baudRateSelector.value === 'custom') {
    return Number.parseInt(customBaudRateInput.value);
  }
  return Number.parseInt(baudRateSelector.value);
}

function setConnectedUi(connected: boolean): void {
  statusDot.classList.toggle('connected', connected);
  portSelector.disabled = connected;
  baudRateSelector.disabled = connected;
  customBaudRateInput.disabled = connected;
  dataBitsSelector.disabled = connected;
  paritySelector.disabled = connected;
  stopBitsSelector.disabled = connected;
  flowControlCheckbox.disabled = connected;
  connectButton.disabled = false;
  connectButton.textContent = connected ? 'Disconnect' : 'Connect';
}

function markDisconnected(): void {
  setConnectedUi(false);
  port = undefined;
  updatePortBar();
}

async function connectToPort(): Promise<void> {
  switchView('serial');
  if (portSelector.value === 'prompt') {
    try {
      const serial = usePolyfill ? polyfill : navigator.serial;
      port = await serial.requestPort({});
    } catch {
      return;
    }
    maybeAddNewPort(port).selected = true;
  } else {
    port = (portSelector.selectedOptions[0] as PortOption).port;
  }

  const options = {
    baudRate: getSelectedBaudRate(),
    dataBits: Number.parseInt(dataBitsSelector.value),
    parity: paritySelector.value as ParityType,
    stopBits: Number.parseInt(stopBitsSelector.value),
    flowControl: flowControlCheckbox.checked ? 'hardware' as const : 'none' as const,
    bufferSize,
  };

  connectButton.textContent = 'Connecting…';
  connectButton.disabled = true;
  setConnectedUi(true);
  updatePortBar();
  connectButton.disabled = true;

  try {
    await port.open(options);
    connectButton.disabled = false;
  } catch (e) {
    if (e instanceof Error) {
      serialSession.term.writeln(`\x1b[31m<ERROR: ${e.message}>\x1b[0m`);
    }
    markDisconnected();
    return;
  }

  while (port?.readable) {
    try {
      try {
        reader = port.readable.getReader({mode: 'byob'});
      } catch {
        reader = port.readable.getReader();
      }

      let buffer: ArrayBuffer | null = null;
      for (;;) {
        const {value, done} = await (async () => {
          if (reader instanceof ReadableStreamBYOBReader) {
            if (!buffer) buffer = new ArrayBuffer(bufferSize);
            const result = await reader.read(new Uint8Array(buffer, 0, bufferSize));
            buffer = result.value?.buffer ?? null;
            return result;
          } else {
            return (reader as ReadableStreamDefaultReader<Uint8Array>).read();
          }
        })();

        if (value) processChunk(serialSession, value);
        if (done) break;
      }
    } catch (e) {
      if (e instanceof Error) {
        serialSession.term.writeln(`\x1b[31m<ERROR: ${e.message}>\x1b[0m`);
      }
    } finally {
      reader?.releaseLock();
      reader = undefined;
    }
  }

  if (port) {
    const droppedPort = port;
    try {
      await droppedPort.close();
    } catch {/* ignore */}
    if (reconnectCheckbox?.checked) reconnectPort = droppedPort;
    markDisconnected();
  }
}

async function disconnectFromPort(): Promise<void> {
  const localPort = port;
  port = undefined;
  await reader?.cancel();
  if (localPort) {
    try {
      await localPort.close();
    } catch {/* ignore */}
  }
  markDisconnected();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initDeviceInfo();

  serialSession = createSession('serial',
      document.getElementById('view_serial')!, document.getElementById('terminal_serial')!);
  fileSession = createSession('file',
      document.getElementById('view_file')!, document.getElementById('terminal_file')!);
  active = serialSession;

  window.addEventListener('resize', () => active.fit.fit());
  window.addEventListener('focus', () => active.fit.fit());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) active.fit.fit();
  });

  summaryEl = document.getElementById('summaryContent')!;
  dataPlotEl = document.getElementById('dataPlotContent')!;
  diagnosisEl = document.getElementById('diagnosisContent')!;
  interestEl = document.getElementById('interestContent')!;
  infoPanelEl = document.getElementById('info_panel')!;
  panelSummaryEl = document.getElementById('panel_summary')!;
  panelDataEl = document.getElementById('panel_data')!;
  panelDiagnosisEl = document.getElementById('panel_diagnosis')!;
  panelInterestEl = document.getElementById('panel_interest')!;
  workspaceEl = document.querySelector('.workspace')!;
  dataDotEl = document.getElementById('data_dot')!;
  diagnosisDotEl = document.getElementById('diagnosis_dot')!;
  interestDotEl = document.getElementById('interest_dot')!;
  moduleBtnsEl = document.getElementById('module_buttons')!;
  logSearchInput = document.getElementById('log_search') as HTMLInputElement;
  searchFilterBtn = document.getElementById('search_filter') as HTMLButtonElement;
  portChipsEl = document.getElementById('port_chips')!;
  statusDot = document.getElementById('statusDot')!;
  fileNameEl = document.getElementById('file_name')!;
  fileProgressEl = document.getElementById('file_progress')!;
  fileProgressFillEl = document.getElementById('file_progress_fill')!;
  fileProgressPctEl = document.getElementById('file_progress_pct')!;
  portSelector = document.getElementById('ports') as HTMLSelectElement;
  connectButton = document.getElementById('connect') as HTMLButtonElement;
  baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  customBaudRateInput = document.getElementById('custom_baudrate') as HTMLInputElement;
  dataBitsSelector = document.getElementById('databits') as HTMLSelectElement;
  paritySelector = document.getElementById('parity') as HTMLSelectElement;
  stopBitsSelector = document.getElementById('stopbits') as HTMLSelectElement;
  flowControlCheckbox = document.getElementById('rtscts') as HTMLInputElement;
  reconnectCheckbox = document.getElementById('reconnect') as HTMLInputElement;
  grabNextCheckbox = document.getElementById('grab_next') as HTMLInputElement;
  bootSinceBtn = document.getElementById('boot_since') as HTMLButtonElement;
  bootAllBtn = document.getElementById('boot_all') as HTMLButtonElement;
  autoscrollBtn = document.getElementById('autoscroll') as HTMLButtonElement;
  piiButton = document.getElementById('pii_toggle') as HTMLButtonElement;

  connectButton.addEventListener('click', () => {
    if (port) disconnectFromPort();
    else connectToPort();
  });

  baudRateSelector.addEventListener('change', () => {
    customBaudRateInput.hidden = baudRateSelector.value !== 'custom';
  });

  // View tabs (Live Serial / File)
  document.querySelectorAll<HTMLButtonElement>('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset['view'] as 'serial' | 'file'));
  });

  // File load button
  const fileInput = document.getElementById('file_input') as HTMLInputElement;
  document.getElementById('load_file_btn')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) loadFileInto(f);
    fileInput.value = '';
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
    if (infoPanelEl.classList.contains('collapsed')) return;
    const on = workspaceEl.classList.toggle('analysis');
    edgeArrow.textContent = on ? '⟩' : '⟨';
    panelEdgeLeft.title = on ? 'Collapse analysis view' : 'Expand analysis view';
    refreshDataPlot(active);   // regenerate charts at the new (large/small) size
    active.fit.fit();
  });

  // Right edge: hide/show (collapse to just this strip, which reopens on click)
  const panelEdgeRight = document.getElementById('panel_edge_right')!;
  const rightArrow = document.getElementById('panel_edge_right_arrow')!;
  panelEdgeRight.addEventListener('click', () => {
    const collapsed = infoPanelEl.classList.toggle('collapsed');
    if (collapsed) workspaceEl.classList.remove('analysis');  // not meaningful when hidden
    rightArrow.textContent = collapsed ? '«' : '»';
    panelEdgeRight.title = collapsed ? 'Show panel' : 'Hide panel';
    active.fit.fit();
  });

  // Data-panel chart controls (delegated — content is rebuilt on every refresh)
  dataPlotEl.addEventListener('change', (e) => {
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

  // Boot-scope toggle (sidebar): "Since last boot" vs "All logs"
  bootSinceBtn.addEventListener('click', () => setBootScope(false));
  bootAllBtn.addEventListener('click', () => setBootScope(true));

  // Autoscroll toggle + jump-to-bottom
  autoscrollBtn.addEventListener('click', () => {
    autoscroll = !autoscroll;
    autoscrollBtn.classList.toggle('btn-active', autoscroll);
    if (autoscroll) active.term.scrollToBottom();
  });
  document.getElementById('jump_bottom')!.addEventListener('click', () => {
    active.term.scrollToBottom();
  });

  // Module all/none toggle
  document.getElementById('module_all_none')!.addEventListener('click', (e) => {
    const s = active;
    const allHidden = s.hiddenModules.size === s.seenModules.size && s.seenModules.size > 0;
    moduleBtnsEl.querySelectorAll<HTMLButtonElement>('.module-btn').forEach((btn) => {
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
  logSearchInput.addEventListener('input', () => {
    active.searchTerm = logSearchInput.value;
    if (active.searchFilter) {
      rerender(active);
    } else {
      runSearch();
    }
  });
  logSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        active.search.findPrevious(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
      } else {
        active.search.findNext(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
      }
    } else if (e.key === 'Escape') {
      logSearchInput.blur();
    }
  });
  document.getElementById('search_prev')!.addEventListener('click', () => {
    active.search.findPrevious(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
  });
  document.getElementById('search_next')!.addEventListener('click', () => {
    active.search.findNext(active.searchTerm, {caseSensitive: false, decorations: SEARCH_DECO});
  });
  searchFilterBtn.addEventListener('click', () => {
    active.searchFilter = !active.searchFilter;
    searchFilterBtn.classList.toggle('active', active.searchFilter);
    rerender(active);
    if (!active.searchFilter && active.searchTerm) runSearch();
  });

  // PII toggle
  updatePiiButton();
  piiButton.addEventListener('click', () => {
    active.pii.enabled = !active.pii.enabled;
    updatePiiButton();
    rerender(active);
  });

  document.getElementById('save')!.addEventListener('click', saveLog);
  document.getElementById('clear')!.addEventListener('click', clearLog);

  // Web Serial API mode indicator + switcher
  const polyfillSwitcher = document.getElementById('polyfill_switcher') as HTMLAnchorElement;
  const apiCurrent = document.getElementById('api_current')!;
  if (usePolyfill) {
    apiCurrent.textContent = 'Polyfill';
    polyfillSwitcher.href = './';
    polyfillSwitcher.textContent = 'Switch to Native';
  } else {
    apiCurrent.textContent = 'Native';
    polyfillSwitcher.href = './?polyfill';
    polyfillSwitcher.textContent = 'Switch to Polyfill';
  }

  initDragDrop();
  switchView('serial');

  const serial = usePolyfill ? polyfill : navigator.serial;
  const ports = await serial.getPorts();
  ports.forEach((p) => addNewPort(p));

  if (!usePolyfill) {
    navigator.serial.addEventListener('connect', (event) => {
      const p = event.target as SerialPort;
      const portOption = maybeAddNewPort(p);
      const rec = portHistory.get(p);
      if (rec) {
        rec.status = 'available'; updatePortBar();
      }
      if (reconnectCheckbox.checked && p === reconnectPort) {
        reconnectPort = undefined;
        portOption.selected = true;
        connectToPort();
      } else if (grabNextCheckbox.checked && !port) {
        portOption.selected = true;
        connectToPort();
      }
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      const p = event.target as SerialPort;
      findPortOption(p)?.remove();
      const rec = portHistory.get(p);
      if (rec) {
        rec.status = 'gone'; updatePortBar();
      }
    });
  }
});
