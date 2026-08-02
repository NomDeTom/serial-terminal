/**
 * Shared log-view core. A `Session` is one terminal view over a stream of log
 * lines; the live-serial view and the loaded-file view are two instances of it.
 * This module owns the per-session state and everything about turning lines into
 * the rendered terminal: the parse/annotate pipeline (addLine), colourised
 * rendering, level/module/search filtering, the Lines-of-Interest list, gutter
 * decorations, and the PII toggle. Data sources (serialSource, fileSource) feed
 * lines in; the info panels read the accumulated DeviceSummary out.
 */
import {Terminal, IDecoration, IMarker} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {SearchAddon} from '@xterm/addon-search';
import {WebLinksAddon} from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {PiiFilter} from './piiFilter';
import {parseLine, colorize, preprocessLine} from './logParser';
import {annotateLine, Annotation} from './annotations';
import {DeviceSummary, emptySummary} from './deviceSummary';
import {updateSummary, updateSummaryCumulative} from './logSummary';
import {dom, active, switchInfoTab} from './appContext';
import {refreshPanels} from './panels';
import {isTeleplotDataLine} from './teleplot';

const MAX_HISTORY = 10_000;

interface InterestEntry {
  seq: number;              // stable id for DOM lookup
  ann: Annotation;
  snippet: string;          // ANSI-stripped line text
  marker?: IMarker;         // present only while the line is rendered (passes filters)
}

// All per-session state: each of the Live Serial and File views owns one.
export interface Session {
  kind: 'serial' | 'file';
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLElement;    // the .term-wrap toggled on view switch
  pii: PiiFilter;
  lineHistory: string[];   // capped ring-buffer for display/analysis
  fullHistory: string[];    // unbounded — used only for Save Log
  lineBuffer: string;
  summary: DeviceSummary;
  cumulative: DeviceSummary;
  showAllBoots: boolean;
  levelFilter: Set<string>;
  searchTerm: string;        // raw text from the search box
  searchFilter: boolean;     // when true, only lines matching searchTerm render
  highlightLines: boolean;   // when true, full-line decorations on matching lines
  hideTeleplotLines: boolean; // when true, Teleplot data lines (">name:value") don't render
                              // (still kept in lineHistory, so Save and the Teleplot tab are unaffected)
  seenModules: Set<string>;
  hiddenModules: Set<string>;
  interest: InterestEntry[];
  interestBySeq: Map<number, InterestEntry>;
  interestSeq: number;
  decorations: IDecoration[];
  decoMarkers: IMarker[];
  pendingWrites: PendingWrite[]; // lines held back by static scroll, not yet on-screen
  pendingSince?: number;         // timestamp of the first held-back line in the batch
  scrollDebounce?: number;       // pending static-scroll flush timer id, if any
}

// A line that passed filtering, waiting to be written once static scroll
// decides the burst has settled.
interface PendingWrite {
  clean: string;
  ann?: Annotation;
  entry?: InterestEntry;
  highlight?: boolean;
}

// Search decoration: highlight every match in amber; brighten the active one.
export const SEARCH_DECO = {
  matchBackground: 'rgba(245,158,11,0.25)',
  matchBorder: 'rgba(245,158,11,0.5)',
  matchOverviewRuler: '#f59e0b',
  activeMatchBackground: 'rgba(245,158,11,0.75)',
  activeMatchBorder: '#f59e0b',
  activeMatchColorOverviewRuler: '#f59e0b',
};

let lineTip: HTMLElement | undefined;
let autoscroll = true;

// Static scroll: while lines arrive in a quick burst, hold new lines back
// instead of writing them straight to the terminal (which, at the bottom of
// the buffer, makes xterm auto-advance the view on every single write — that
// per-line advance is the jerkiness, not the explicit scrollToBottom() call).
// Held-back lines are flushed together — written in one go and scrolled once
// — either after the burst goes quiet for STATIC_SCROLL_QUIET_MS, or after
// STATIC_SCROLL_MAX_MS regardless, so a steady trickle with no gaps doesn't
// stall the display indefinitely.
let staticScroll = true;
const STATIC_SCROLL_QUIET_MS = 120;
const STATIC_SCROLL_MAX_MS = 500;

// Drops any lines static scroll is holding back for `s` without writing them
// — used when the terminal is about to be cleared or fully rebuilt from
// lineHistory, so a stale queue doesn't write lines a second time (or write
// lines that no longer exist) when its flush timer later fires.
export function discardPendingWrites(s: Session): void {
  if (s.scrollDebounce !== undefined) {
    clearTimeout(s.scrollDebounce);
    s.scrollDebounce = undefined;
  }
  s.pendingWrites = [];
  s.pendingSince = undefined;
}

// Writes and (if requested) scrolls whatever is queued for `s`, and cancels
// any pending flush timer. Safe to call with an empty queue.
function flushPendingWrites(s: Session, scroll: boolean): void {
  if (s.scrollDebounce !== undefined) {
    clearTimeout(s.scrollDebounce);
    s.scrollDebounce = undefined;
  }
  if (s.pendingWrites.length) {
    const writes = s.pendingWrites;
    s.pendingWrites = [];
    s.pendingSince = undefined;
    for (const w of writes) writeAndDecorate(s, w.clean, w.ann, w.entry, w.highlight);
  }
  if (scroll) s.term.scrollToBottom();
}

function queueWrite(s: Session, w: PendingWrite): void {
  const now = performance.now();
  if (s.pendingWrites.length === 0) s.pendingSince = now;
  s.pendingWrites.push(w);
  if (s.scrollDebounce !== undefined) clearTimeout(s.scrollDebounce);
  const elapsed = now - (s.pendingSince ?? now);
  const wait = Math.min(STATIC_SCROLL_QUIET_MS, Math.max(0, STATIC_SCROLL_MAX_MS - elapsed));
  s.scrollDebounce = window.setTimeout(() => flushPendingWrites(s, true), wait);
}

export function createSession(
    kind: 'serial' | 'file', container: HTMLElement, mount: HTMLElement): Session {
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
    overviewRuler: {width: 12},
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon());
  term.open(mount);
  return {
    kind, term, fit, search, container, pii: new PiiFilter(),
    lineHistory: [], fullHistory: [], lineBuffer: '',
    summary: emptySummary(), cumulative: emptySummary(), showAllBoots: false,
    levelFilter: new Set(['D', 'I', 'W', 'E', 'C']),
    searchTerm: '', searchFilter: false, highlightLines: false, hideTeleplotLines: false,
    seenModules: new Set(), hiddenModules: new Set(),
    interest: [], interestBySeq: new Map(), interestSeq: 0,
    decorations: [], decoMarkers: [], pendingWrites: [],
  };
}

export function moduleKey(module: string): string {
  return module || '__boot__';
}

function linePassesFilter(s: Session, line: string): boolean {
  if (s.hideTeleplotLines && isTeleplotDataLine(line)) return false;
  const {level, module} = parseLine(line);
  if (level && !s.levelFilter.has(level)) return false;
  if (s.hiddenModules.has(moduleKey(module))) return false;
  if (s.searchFilter && s.searchTerm &&
      !line.toLowerCase().includes(s.searchTerm.toLowerCase())) return false;
  return true;
}

function countSearchMatches(s: Session): number {
  if (!s.searchTerm) return 0;
  const lc = s.searchTerm.toLowerCase();
  let n = 0;
  for (const line of s.fullHistory) {
    if (s.hideTeleplotLines && isTeleplotDataLine(line)) continue;
    const {level, module} = parseLine(line);
    if (level && !s.levelFilter.has(level)) continue;
    if (s.hiddenModules.has(moduleKey(module))) continue;
    if (line.toLowerCase().includes(lc)) n++;
  }
  return n;
}

export function updateSearchCount(s: Session): void {
  if (!dom.searchCountEl) return;
  if (!s.searchTerm) {
    dom.searchCountEl.textContent = ''; return;
  }
  const n = countSearchMatches(s);
  dom.searchCountEl.textContent = `${n}`;
}

export function addModuleButton(s: Session, key: string): void {
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
  dom.moduleBtnsEl.appendChild(btn);
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
// Interest tab can scroll to the line. When `highlight` is true, a full-width
// amber background is applied and an overview-ruler mark is added.
function writeAndDecorate(
    s: Session, clean: string, ann?: Annotation,
    entry?: InterestEntry, highlight?: boolean): void {
  if (!ann && !highlight) {
    s.term.writeln(renderLine(s, clean));
    return;
  }
  s.term.writeln(renderLine(s, clean), () => {
    const marker = s.term.registerMarker(-1);
    if (!marker) return;
    s.decoMarkers.push(marker);
    if (entry) entry.marker = marker;
    if (ann) {
      const deco = s.term.registerDecoration({marker, x: 0, width: 2, layer: 'top'});
      if (deco) {
        deco.onRender((el) => decorateGutter(el, ann, entry));
        s.decorations.push(deco);
      }
    }
    if (highlight) {
      const hdeco = s.term.registerDecoration({
        marker, x: 0, width: s.term.cols, layer: 'bottom',
        overviewRulerOptions: {color: 'rgba(245,158,11,0.8)', position: 'full'},
      });
      if (hdeco) {
        hdeco.onRender((el) => {
          el.style.backgroundColor = 'rgba(245,158,11,0.1)';
        });
        s.decorations.push(hdeco);
      }
    }
  });
}

export function disposeDecorations(s: Session): void {
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

export function refreshInterest(s: Session): void {
  if (!dom.interestEl || s !== active) return;
  dom.interestDotEl?.classList.toggle('visible', s.interest.length > 0);
  if (s.interest.length === 0) {
    dom.interestEl.innerHTML = '<div class="int-empty">No lines of interest yet.</div>';
    return;
  }
  const faults = s.interest.filter((e) => e.ann.severity !== 'info');
  const infos = s.interest.filter((e) => e.ann.severity === 'info');
  const parts: string[] = [];
  if (faults.length) parts.push(renderInterestGroup('⚠ Faults', faults, true));
  if (infos.length) parts.push(renderInterestGroup('💡 Explained', infos, false));
  dom.interestEl.innerHTML = parts.join('');
  dom.interestEl.querySelectorAll<HTMLElement>('.int-row').forEach((row) => {
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
  const row = dom.interestEl?.querySelector<HTMLElement>(`.int-row[data-seq="${entry.seq}"]`);
  if (row) {
    row.scrollIntoView({block: 'nearest'});
    row.classList.remove('int-pulse');
    void row.offsetWidth; // restart the animation
    row.classList.add('int-pulse');
  }
}

// ── Data pipeline ─────────────────────────────────────────────────────────────

// When deferRender is true the panel refreshes are skipped (caller refreshes
// once at the end) — used by bulk file loading so it isn't O(lines × render).
export function addLine(s: Session, raw: string, deferRender = false): void {
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
  s.fullHistory.push(clean);
  updateSummary(clean, s.summary);
  updateSummaryCumulative(clean, s.cumulative);
  if (!deferRender) {
    refreshPanels(s);
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
    const hl = s.highlightLines && !!s.searchTerm &&
      clean.toLowerCase().includes(s.searchTerm.toLowerCase());
    if (staticScroll && autoscroll && !deferRender) {
      queueWrite(s, {clean, ann, entry, highlight: hl});
    } else {
      writeAndDecorate(s, clean, ann, entry, hl);
      if (autoscroll && !deferRender) s.term.scrollToBottom();
    }
  }
}

export function resetFilters(s: Session): void {
  for (const lv of ['D', 'I', 'W', 'E', 'C']) s.levelFilter.add(lv);
  s.hiddenModules.clear();
  s.searchFilter = false;
  s.highlightLines = false;
  s.hideTeleplotLines = false;
  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((b) => b.classList.add('active'));
  document.querySelectorAll<HTMLButtonElement>('.module-btn').forEach((b) => b.classList.add('active'));
  dom.searchFilterBtn?.classList.remove('active');
  dom.highlightLinesBtn?.classList.remove('active');
  dom.teleplotHideDataBtn?.classList.remove('btn-active');
}

export function rerender(s: Session): void {
  // The loop below rebuilds the whole view from lineHistory, so drop any
  // queued static-scroll lines first (see discardPendingWrites).
  discardPendingWrites(s);
  disposeDecorations(s);
  s.term.clear();
  let ip = 0;
  const hlTerm = s.highlightLines && !!s.searchTerm;
  const lcTerm = hlTerm ? s.searchTerm.toLowerCase() : '';
  // overflow = lines in fullHistory that have been evicted from lineHistory (no interest entries)
  const overflow = s.fullHistory.length - s.lineHistory.length;
  for (let i = 0; i < s.fullHistory.length; i++) {
    const line = s.fullHistory[i];
    const ann = i >= overflow ? annotateLine(line) : false;
    const entry = ann ? s.interest[ip++] : undefined;
    if (linePassesFilter(s, line)) {
      const hl = hlTerm && line.toLowerCase().includes(lcTerm);
      writeAndDecorate(s, line, ann, entry, hl);
    }
  }
  refreshInterest(s);
  if (s === active) updateSearchCount(s);
}

export function processChunk(s: Session, chunk: Uint8Array): void {
  const text = new TextDecoder().decode(chunk);
  const parts = (s.lineBuffer + text).split('\n');
  s.lineBuffer = parts.pop() ?? '';
  for (const line of parts) {
    addLine(s, line.replace(/\r$/, ''));
  }
}

export function updatePiiButton(): void {
  const on = active.pii.enabled;
  const eg = on ?
    '<span class="pii-eg">lat=[REDACTED] lon=[REDACTED]</span>' :
    '<span class="pii-eg">lat=52.944 lon=-1.435</span>';
  dom.piiButton.innerHTML = `🕵️ Hide PII: ${on ? 'ON' : 'OFF'} ${eg}`;
  dom.piiButton.classList.toggle('btn-active', on);
}

export function saveLog(): void {
  const s = active;
  if (s.fullHistory.length === 0) return;
  const lines = s.pii.enabled ? s.fullHistory.map((l) => s.pii.filter(l)) : s.fullHistory;
  const blob = new Blob(['﻿', lines.join('\n')], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const rawLabel = (document.getElementById('log_label') as HTMLInputElement)?.value.trim() ?? '';
  const label = rawLabel ? '-' + rawLabel.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') : '';
  const appendMeta = (document.getElementById('log_append_meta') as HTMLInputElement)?.checked ?? false;
  const nodeId = s.pii.enabled ? '' : (s.summary.nodeId?.replace(/^0x/i, '') ?? '');
  const buildHash = s.summary.firmware?.split('.').pop() ?? '';
  const meta = appendMeta && (nodeId || buildHash) ? '-' + [nodeId, buildHash].filter(Boolean).join('-') : '';
  a.download = `meshtastic-log-${new Date().toISOString().replace(/[:.]/g, '-')}${label}${meta}.txt`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

// Autoscroll / static-scroll toggles + jump-to-bottom (state lives with the
// view it scrolls).
export function initAutoscroll(): void {
  dom.autoscrollBtn.addEventListener('click', () => {
    autoscroll = !autoscroll;
    dom.autoscrollBtn.classList.toggle('btn-active', autoscroll);
    flushPendingWrites(active, autoscroll);
  });
  dom.staticScrollBtn.addEventListener('click', () => {
    staticScroll = !staticScroll;
    dom.staticScrollBtn.classList.toggle('btn-active', staticScroll);
    if (!staticScroll) flushPendingWrites(active, autoscroll);
  });
  document.getElementById('jump_bottom')!.addEventListener('click', () => {
    flushPendingWrites(active, true);
  });
}
