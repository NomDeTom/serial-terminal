/**
 * Teleplot protocol capture: parses "Teleplot format" lines
 * (https://github.com/nesnes/teleplot) out of the raw serial/log stream and
 * renders them as live charts, independent of any Meshtastic-specific parsing.
 *
 * Mirrors the exact grammar the Teleplot VSCode extension's serial input uses
 * (server/www/classes/communication/{data/DataInputSerial.js,
 * serverMessageReading.js} in the upstream repo): on a serial stream, a line
 * starting with '>' is a data line (the leading '>' is stripped); a line NOT
 * starting with '>' is a plain log line, which our app already shows in the
 * main terminal, so it is ignored here. Of the '>'-prefixed lines:
 *   - "|cmd|arg|"      -> remote command registration (not supported here)
 *   - ">"-prefixed     -> explicit text-log marker (duplicates the terminal)
 *   - "3D|..."         -> 3D shape telemetry (not supported here)
 *   - "name:B:C§D|E"   -> variable data (what this module renders)
 * Format of a data line, after the leading '>' is stripped:
 *   name[,widgetLabel]:[timestampMs:]value[;[timestampMs:]value...][§unit]|flags
 * Flags: "t" text value, "xy" 2D point (value is "x:y" pairs, not a timestamp),
 * "np" don't plot, "clr" clear prior points for this variable.
 */

export interface TeleplotPoint {
  x: number; // seconds (from an explicit ms timestamp) or a fallback sequence number
  y: number;
}

export interface TeleplotNumericSeries {
  name: string;
  unit: string;
  noPlot: boolean;
  hasTimestamps: boolean; // false => x is a receive-order sequence number, not real time
  points: TeleplotPoint[];
}

export interface TeleplotTextSeries {
  name: string;
  noPlot: boolean;
  history: Array<{x: number; value: string}>;
}

export interface TeleplotXYSeries {
  name: string;
  noPlot: boolean;
  points: Array<{x: number; y: number}>;
}

export interface TeleplotData {
  numeric: TeleplotNumericSeries[];
  text: TeleplotTextSeries[];
  xy: TeleplotXYSeries[];
  lineCount: number; // number of recognized Teleplot data lines seen
}

// "name" or "name,widgetLabel" -> name (widget grouping is a VSCode-extension-side
// display concept; we render one chart per variable regardless of label).
function variableName(keyAndWidgetLabel: string): string {
  const idx = keyAndWidgetLabel.indexOf(',');
  return idx === -1 ? keyAndWidgetLabel : keyAndWidgetLabel.slice(0, idx);
}

// Recognizes a "variable data" line per the grammar at the top of this file
// (as opposed to a plain log line, a remote command, an explicit text-log
// marker, or a 3D shape). Shared by the parser below and by the log view's
// "Hide Data" display filter, so the two never drift apart.
export function isTeleplotDataLine(raw: string): boolean {
  if (!raw.startsWith('>')) return false;
  const msg = raw.slice(1);
  if (msg.startsWith('|')) return false;
  if (msg.startsWith('>')) return false;
  if (msg.startsWith('3D|')) return false;
  const startIdx = msg.indexOf(':');
  if (startIdx === -1) return false;
  const keyAndWidgetLabel = msg.slice(0, startIdx);
  if (keyAndWidgetLabel.slice(0, 6) === 'statsd') return false;
  return !!variableName(keyAndWidgetLabel);
}

export function parseTeleplot(lines: string[]): TeleplotData {
  const numericMap = new Map<string, TeleplotNumericSeries>();
  const textMap = new Map<string, TeleplotTextSeries>();
  const xyMap = new Map<string, TeleplotXYSeries>();
  let lineCount = 0;
  let seq = 0;

  for (const raw of lines) {
    if (!isTeleplotDataLine(raw)) continue;
    const msg = raw.slice(1);
    const startIdx = msg.indexOf(':');
    const keyAndWidgetLabel = msg.slice(0, startIdx);
    const name = variableName(keyAndWidgetLabel);

    let endIdx = msg.lastIndexOf('|');
    if (endIdx === -1 || endIdx < startIdx) endIdx = msg.length;
    const flags = endIdx < msg.length ? msg.slice(endIdx + 1) : '';
    const isText = flags.includes('t');
    const isXY = flags.includes('xy');
    const noPlot = flags.includes('np');
    const clear = flags.includes('clr');

    let unit = '';
    const unitIdx = msg.indexOf('§'); // '§'
    if (unitIdx !== -1 && unitIdx < endIdx) {
      unit = msg.slice(unitIdx + 1, endIdx);
      endIdx = unitIdx;
    }

    const values = msg.slice(startIdx + 1, endIdx).split(';').filter((v) => v.length > 0);
    if (values.length === 0) continue;
    seq++;
    let added = false;

    for (const value of values) {
      const dims = value.split(':');

      if (isXY) {
        if (dims.length < 2) continue;
        const x = parseFloat(dims[0]);
        const y = parseFloat(dims[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        let s = xyMap.get(name);
        if (!s) {
          s = {name, noPlot, points: []};
          xyMap.set(name, s);
        }
        if (clear) s.points.length = 0;
        s.points.push({x, y});
        added = true;
        continue;
      }

      const hasTs = dims.length === 2;
      const rawValue = hasTs ? dims[1] : dims[0];
      const x = hasTs ? parseFloat(dims[0]) / 1000 : seq;

      if (isText) {
        let s = textMap.get(name);
        if (!s) {
          s = {name, noPlot, history: []};
          textMap.set(name, s);
        }
        if (clear) s.history.length = 0;
        s.history.push({x: Number.isFinite(x) ? x : seq, value: rawValue});
        added = true;
        continue;
      }

      const y = parseFloat(rawValue);
      if (!Number.isFinite(y)) continue;
      let s = numericMap.get(name);
      if (!s) {
        s = {name, unit, noPlot, hasTimestamps: false, points: []};
        numericMap.set(name, s);
      }
      if (clear) s.points.length = 0;
      if (!s.unit && unit) s.unit = unit;
      if (hasTs) s.hasTimestamps = true;
      s.points.push({x: Number.isFinite(x) ? x : seq, y});
      added = true;
    }
    if (added) lineCount++;
  }

  return {
    numeric: [...numericMap.values()],
    text: [...textMap.values()],
    xy: [...xyMap.values()],
    lineCount,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────
// Visual style matches the Data tab's telemetry charts (sensorTelemetry.ts).

const PALETTE = [
  '#67EA94', '#39c5cf', '#d29922', '#a78bfa', '#ff7b72',
  '#79c0ff', '#f472b6', '#34d399', '#60a5fa', '#f59e0b',
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtV(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return v.toExponential(1);
  if (a >= 100) return Math.round(v).toString();
  if (a >= 1) return v.toFixed(1);
  return v.toPrecision(2);
}

function fmtT(v: number, hasTimestamps: boolean): string {
  if (!hasTimestamps) return `#${Math.round(v)}`;
  const secs = Math.abs(v);
  if (secs >= 3600) return `${Math.round(v / 3600)}h`;
  if (secs >= 60) return `${Math.round(v / 60)}m`;
  return `${Math.round(v)}s`;
}

export type TeleplotSortMode = 'order' | 'alpha' | 'type';

export interface TeleplotOptions {
  suppressZero: boolean;
  large: boolean;
  enlarged: Set<string>;      // series names the user clicked to pin at 2x tile size
  sortMode: TeleplotSortMode;
  manualOrder: string[];      // series names in drag order; used when sortMode === 'order'.
                               // Names not listed here fall back to the end, ordered by type
                               // then alphabetically — so newly-seen series don't need to be
                               // proactively appended, only ones the user has actually dragged.
}

function isAllZero(pts: TeleplotPoint[]): boolean {
  return pts.every((p) => p.y === 0);
}

function numericChart(series: TeleplotNumericSeries, opts: TeleplotOptions): string {
  const pts = series.points;
  if (pts.length < 2) return '';
  const big = opts.enlarged.has(series.name);
  // Width only grows in analysis mode's multi-column grid (paired with
  // grid-column: span 2 in CSS) — in the default single-column sidebar,
  // charts already render at ~the full available width, so doubling width
  // there would just get clamped straight back down by the responsive
  // `svg { max-width: 100% }` rule, at an unchanged aspect ratio, as a no-op.
  // Height always grows — that's the dimension with room to give in both
  // layouts.
  const W = (opts.large ? 300 : 290) * (big && opts.large ? 2 : 1);
  const H = (opts.large ? 200 : 90) * (big ? 2 : 1);
  const pL = 28; const pB = 18; const pT = 5; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const color = colorFor(series.name);

  let xMin = Infinity; let xMax = -Infinity;
  let yMin = Infinity; let yMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const xR = xMax - xMin;
  const yR = yMax - yMin;
  const X = (x: number): number => pL + ((x - xMin) / xR) * cW;
  const Y = (y: number): number => pT + cH - ((y - yMin) / yR) * cH;

  const out: string[] = [];

  for (let t = 0; t <= 3; t++) {
    const v = yMin + (t / 3) * yR;
    const y = Y(v);
    out.push(
        `<line x1="${pL}" x2="${(pL + cW).toFixed(1)}" ` +
      `y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#374151" stroke-width="0.5"/>`,
    );
    out.push(
        `<text x="${(pL - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" ` +
      `text-anchor="end" font-size="9" fill="#6b7280">${fmtV(v)}</text>`,
    );
  }

  const coords = pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
  const base = (pT + cH).toFixed(1);
  const area = [`${X(pts[0].x).toFixed(1)},${base}`, ...coords, `${X(pts[pts.length - 1].x).toFixed(1)},${base}`]
      .join(' ');
  out.push(`<polygon points="${area}" fill="${color}" opacity="0.08"/>`);
  out.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`);

  const ly = (pT + cH + 12).toFixed(1);
  for (let t = 0; t <= 4; t++) {
    const x = xMin + (t / 4) * xR;
    out.push(
        `<text x="${X(x).toFixed(1)}" y="${ly}" ` +
      `text-anchor="middle" font-size="9" fill="#6b7280">${fmtT(x, series.hasTimestamps)}</text>`,
    );
  }

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    out.join('') + '</svg>';
  const label = series.name + (series.unit ? ` (${series.unit})` : '');
  const badge = big ? '<span class="hc-range">2×</span>' : '';
  return `<div class="hc-section tp-tile tp-plot${big ? ' tp-enlarged' : ''}" ` +
    `data-key="${escapeAttr(series.name)}" draggable="true" ` +
    `title="${big ? 'Click to shrink · drag to reorder' : 'Click to enlarge · drag to reorder'}">` +
    `<div class="hc-head"><span class="hc-label">${escapeHtml(label)}</span>${badge}</div>${svg}</div>`;
}

function xyChart(series: TeleplotXYSeries, opts: TeleplotOptions): string {
  const pts = series.points;
  if (pts.length === 0) return '';
  const big = opts.enlarged.has(series.name);
  // Same width/height reasoning as numericChart above.
  const W = (opts.large ? 300 : 290) * (big && opts.large ? 2 : 1);
  const H = (opts.large ? 200 : 140) * (big ? 2 : 1);
  const pad = 14;
  const cW = W - pad * 2;
  const cH = H - pad * 2;
  const color = colorFor(series.name);

  let xMin = Infinity; let xMax = -Infinity;
  let yMin = Infinity; let yMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const xR = xMax - xMin;
  const yR = yMax - yMin;
  const X = (x: number): number => pad + ((x - xMin) / xR) * cW;
  // SVG y grows downward; flip so larger values plot higher.
  const Y = (y: number): number => pad + cH - ((y - yMin) / yR) * cH;

  const out: string[] = [];
  if (pts.length > 1) {
    const coords = pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
    out.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1" opacity="0.6"/>`);
  }
  const last = pts[pts.length - 1];
  for (const p of pts.slice(0, -1)) {
    out.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="1.5" fill="${color}" opacity="0.5"/>`);
  }
  out.push(`<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="3" fill="${color}"/>`);

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#374151"/>` +
    out.join('') + '</svg>';
  const coord = `${big ? '2× · ' : ''}${fmtV(last.x)}, ${fmtV(last.y)}`;
  return `<div class="hc-section tp-tile tp-plot${big ? ' tp-enlarged' : ''}" ` +
    `data-key="${escapeAttr(series.name)}" draggable="true" ` +
    `title="${big ? 'Click to shrink · drag to reorder' : 'Click to enlarge · drag to reorder'}">` +
    `<div class="hc-head"><span class="hc-label">${escapeHtml(series.name)} (xy)</span>` +
    `<span class="hc-range">${coord}</span></div>${svg}</div>`;
}

function textTile(series: TeleplotTextSeries): string {
  if (series.history.length === 0) return '';
  const recent = series.history.slice(-5).reverse();
  const rows = recent.map((h) =>
    `<div class="ns-row"><span class="ns-k">${fmtT(h.x, true)}</span>` +
    `<span class="ns-v">${escapeHtml(h.value)}</span></div>`,
  ).join('');
  return `<div class="hc-section tp-tile" data-key="${escapeAttr(series.name)}" draggable="true" ` +
    'title="Drag to reorder">' +
    `<div class="hc-label">${escapeHtml(series.name)}</div>` +
    `<div class="ns-tile">${rows}</div></div>`;
}

interface Tile {
  key: string;
  kind: 'numeric' | 'xy' | 'text';
  html: string;
}

const KIND_ORDER: Record<Tile['kind'], number> = {numeric: 0, xy: 1, text: 2};

// Tie-break used both for the "Type" sort mode and for positioning tiles the
// user hasn't dragged yet in "Order" mode.
function byTypeThenName(a: Tile, b: Tile): number {
  return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.key.localeCompare(b.key);
}

function sortTiles(tiles: Tile[], opts: TeleplotOptions): Tile[] {
  if (opts.sortMode === 'alpha') {
    return [...tiles].sort((a, b) => a.key.localeCompare(b.key));
  }
  if (opts.sortMode === 'type') {
    return [...tiles].sort(byTypeThenName);
  }
  // 'order': drag position wins; anything not yet dragged falls to the end,
  // in type-then-name order, so newly-seen series don't need to be
  // proactively appended to manualOrder.
  const pos = new Map(opts.manualOrder.map((k, i) => [k, i]));
  return [...tiles].sort((a, b) => {
    const ai = pos.get(a.key);
    const bi = pos.get(b.key);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return byTypeThenName(a, b);
  });
}

export function renderTeleplotPanel(data: TeleplotData, opts: TeleplotOptions): string {
  if (data.lineCount === 0) {
    return '<div class="summary-resting">No Teleplot-formatted lines seen yet.<br>' +
      'Send lines like <code>&gt;name:value</code> from the device to see live plots here.<br>' +
      '<a href="https://github.com/nesnes/teleplot" target="_blank" rel="noopener">Teleplot format reference</a>' +
      '</div>';
  }

  let numeric = data.numeric.filter((s) => !s.noPlot);
  if (opts.suppressZero) numeric = numeric.filter((s) => !isAllZero(s.points));
  const xy = data.xy.filter((s) => !s.noPlot);
  const text = data.text.filter((s) => !s.noPlot);

  const tiles: Tile[] = [];
  for (const s of numeric) {
    const html = numericChart(s, opts);
    if (html) tiles.push({key: s.name, kind: 'numeric', html});
  }
  for (const s of xy) {
    const html = xyChart(s, opts);
    if (html) tiles.push({key: s.name, kind: 'xy', html});
  }
  for (const s of text) {
    const html = textTile(s);
    if (html) tiles.push({key: s.name, kind: 'text', html});
  }

  if (tiles.length === 0) return '';
  return `<div class="dp-charts">${sortTiles(tiles, opts).map((t) => t.html).join('')}</div>`;
}
