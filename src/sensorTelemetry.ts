// Meshtastic serial-log sensor telemetry extractor.
//
// Parses "Send: key=val" (local) and "(Received from X): key=val" (peer)
// lines into a long-format row array suitable for time-series plotting.
// Browser-safe: no Node.js APIs.

const ANSI = /\x1b\[[0-9;]*m/g;
function clean(line: string): string {
  return line.replace(ANSI, '').replace(/[^\x09\x20-\x7e]/g, '');
}

const PREFIX = /^([A-Z]+)\s*\|\s*([\d?:]+)\s+(\d+)\s+(.*)$/;
const KV = /([A-Za-z][\w ]*?)\s*=\s*(-?\d+(?:\.\d+)?)\s*([^\s,()]*)/g;

export interface SensorRow {
  boot: number;
  uptime: number;
  time: string;
  source: string;
  category: string;
  metric: string;
  value: number;
  unit: string;
}

export interface SensorSeries {
  source: string;
  category: string;
  metric: string;
  unit: string;
  points: Array<{boot: number; uptime: number; time: string; value: number}>;
}

function categoryFromModule(mod: string | null): string {
  if (!mod) return 'unknown';
  const m = mod.replace(/Module$/, '');
  if (/DeviceTelemetry/.test(m)) return 'device';
  if (/EnvironmentTelemetry/.test(m)) return 'environment';
  if (/AirQualityTelemetry/.test(m)) return 'airQuality';
  if (/PowerTelemetry/.test(m)) return 'power';
  if (/HealthTelemetry/.test(m)) return 'health';
  if (/HostMetrics/.test(m)) return 'host';
  return m || 'unknown';
}

function parseKV(payload: string): Array<{metric: string; value: number; unit: string}> {
  const out: Array<{metric: string; value: number; unit: string}> = [];
  let m: RegExpExecArray | null;
  KV.lastIndex = 0;
  while ((m = KV.exec(payload)) !== null) {
    out.push({metric: m[1].trim(), value: Number(m[2]), unit: m[3] || ''});
  }
  return out;
}

export function parseLog(text: string): SensorRow[] {
  const rows: SensorRow[] = [];
  let boot = 0;
  let prevUptime = -1;
  let seenAny = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;

    if (/\bS:B:/.test(line)) {
      if (seenAny) boot++;
      prevUptime = -1;
      continue;
    }

    const pm = PREFIX.exec(line);
    if (!pm) continue;
    const [,, time, uptimeStr, rest] = pm;
    const uptime = Number(uptimeStr);

    if (prevUptime >= 0 && uptime + 2 < prevUptime) boot++;
    prevUptime = uptime;

    let mod: string | null = null;
    let msg = rest;
    const tag = /^\[([^\]]+)\]\s*(.*)$/.exec(rest);
    if (tag) {
      mod = tag[1];
      msg = tag[2];
    }

    const peer = /^\(Received(?:[^)]+)? from ([^)]+)\):\s*(.*)$/.exec(msg);
    if (peer) {
      const source = peer[1].trim();
      const cat = /Host Metrics/.test(msg) ? 'host' : categoryFromModule(mod);
      for (const kv of parseKV(peer[2])) {
        rows.push({boot, uptime, time, source, category: cat, ...kv});
      }
      seenAny = true;
      continue;
    }

    const local = /^(?:Send:|Sending local stats:)\s*(.*)$/.exec(msg);
    if (local && local[1].includes('=')) {
      const cat = categoryFromModule(mod);
      for (const kv of parseKV(local[1])) {
        rows.push({boot, uptime, time, source: 'local', category: cat, ...kv});
      }
      seenAny = true;
      continue;
    }

    // "[RadioIf] Corrected frequency offset: N" — per-packet crystal drift measurement
    const freqOff = /^Corrected frequency offset:\s*([-\d.]+)$/.exec(msg);
    if (freqOff && mod === 'RadioIf') {
      rows.push({boot, uptime, time, source: 'local', category: 'radio',
        metric: 'freq_offset', value: Number(freqOff[1]), unit: 'Hz'});
      seenAny = true;
    }
  }
  return rows;
}

export function toSeries(rows: SensorRow[]): SensorSeries[] {
  const map = new Map<string, SensorSeries>();
  for (const r of rows) {
    const key = `${r.source}|${r.category}|${r.metric}`;
    let s = map.get(key);
    if (!s) {
      s = {source: r.source, category: r.category, metric: r.metric, unit: r.unit, points: []};
      map.set(key, s);
    }
    s.points.push({boot: r.boot, uptime: r.uptime, time: r.time, value: r.value});
    if (!s.unit && r.unit) s.unit = r.unit;
  }
  return [...map.values()];
}

export function toCSV(rows: SensorRow[]): string {
  const head = 'boot,uptime,time,source,category,metric,value,unit';
  const esc = (v: unknown): string => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) =>
    [r.boot, r.uptime, r.time, r.source, r.category, r.metric, r.value, r.unit].map(esc).join(',')
  );
  return [head, ...body].join('\n');
}

// ── SVG telemetry chart rendering ───────────────────────────────────────────
// Produces compact line charts in the same visual style as the hop charts
// (logSummary.ts). One chart per metric, grouped by source and category.

const CAT_COLOR: Record<string, string> = {
  device: '#67EA94',
  environment: '#39c5cf',
  airQuality: '#d29922',
  power: '#a78bfa',
  health: '#ff7b72',
  host: '#79c0ff',
  radio: '#f59e0b',
};
const CAT_ORDER = ['device', 'environment', 'airQuality', 'power', 'health', 'host', 'radio'];

// Sensible fixed Y-axis ranges per telemetry metric, applied unless the user
// ticks "auto" on that chart. Keyed by the normalized metric name.
const DEFAULT_RANGES: Record<string, [number, number]> = {
  battery_level: [0, 100],
  voltage: [2, 4.5],
  ch1_voltage: [2, 4.5],
  ch2_voltage: [2, 4.5],
  channel_utilization: [0, 100],
  air_util_tx: [0, 100],
  relative_humidity: [0, 100],
  co2_rh: [0, 100],
  hcho_rh: [0, 100],
  soil_moisture: [0, 100],
  spo2: [0, 100],
  temperature: [-10, 50],
  co2_t: [-10, 50],
  hcho_t: [-10, 50],
  soil_temperature: [-10, 50],
  co2: [400, 2000],
  iaq: [0, 500],
  heart_bpm: [40, 180],
};

// Metrics that have a fixed range available but should auto-scale by default
// (they're usually only a few percent, so a 0–100 axis flattens them).
const AUTO_BY_DEFAULT = new Set(['channel_utilization', 'air_util_tx']);

function normMetric(metric: string): string {
  return metric.trim().toLowerCase().replace(/\s+/g, '_');
}

// Returns the fixed default [min, max] for a metric, or null if none is known
// (in which case the chart always auto-ranges).
function defaultRange(metric: string): [number, number] | null {
  const k = normMetric(metric);
  if (DEFAULT_RANGES[k]) return DEFAULT_RANGES[k];
  if (/^pm(10|25|100)/.test(k)) return [0, 150];
  return null;
}

function autoByDefault(metric: string): boolean {
  return AUTO_BY_DEFAULT.has(normMetric(metric));
}

export interface ChartOptions {
  suppressZero: boolean;
  autoRange: Set<string>;   // series keys the user pinned to data-driven range
  fixedRange: Set<string>;  // series keys the user pinned to the fixed default range
  large: boolean;           // analysis mode — render bigger, squarer chart tiles
}

export function seriesKey(s: SensorSeries): string {
  return `${s.source}|${s.category}|${s.metric}`;
}

function isAllZero(s: SensorSeries): boolean {
  return s.points.every((p) => p.value === 0);
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function fmtU(secs: number): string {
  if (secs >= 3600) return `${Math.round(secs / 3600)}h`;
  if (secs >= 60) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs)}s`;
}

function fmtV(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return v.toExponential(1);
  if (a >= 100) return Math.round(v).toString();
  if (a >= 1) return v.toFixed(1);
  return v.toPrecision(2);
}

function telLine(series: SensorSeries, opts: ChartOptions): string {
  const pts = series.points;
  if (pts.length < 2) return '';
  const W = opts.large ? 300 : 290;
  const H = opts.large ? 200 : 90;
  const pL = 28; const pB = 18; const pT = 5; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const color = CAT_COLOR[series.category] ?? '#6b7280';
  const key = seriesKey(series);

  let xMin = Infinity; let xMax = -Infinity;
  let dMin = Infinity; let dMax = -Infinity;
  for (const p of pts) {
    if (p.uptime < xMin) xMin = p.uptime;
    if (p.uptime > xMax) xMax = p.uptime;
    if (p.value < dMin) dMin = p.value;
    if (p.value > dMax) dMax = p.value;
  }
  if (xMin === xMax) xMax = xMin + 1;

  // Y range: a per-chart "auto" toggle, defaulting to the fixed range for most
  // metrics but to auto for the few that are usually tiny (util %). The user's
  // explicit pin (autoRange/fixedRange) overrides the default either way.
  const def = defaultRange(series.metric);
  let useAuto: boolean;
  if (opts.autoRange.has(key)) useAuto = true;
  else if (opts.fixedRange.has(key)) useAuto = false;
  else useAuto = !def || autoByDefault(series.metric);
  let yMin: number; let yMax: number;
  if (useAuto) {
    yMin = dMin; yMax = dMax;
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
  } else {
    yMin = def![0]; yMax = def![1];
  }
  const xR = xMax - xMin;
  const yR = yMax - yMin;
  const X = (u: number): number => pL + ((u - xMin) / xR) * cW;
  // Clamp to the plot area so out-of-range points (when a fixed range is used)
  // sit on the boundary instead of overflowing the tile.
  const Y = (v: number): number => {
    const y = pT + cH - ((v - yMin) / yR) * cH;
    return Math.max(pT, Math.min(pT + cH, y));
  };

  const out: string[] = [];

  // Horizontal grid lines + Y labels
  for (let t = 0; t <= 3; t++) {
    const v = yMin + (t / 3) * yR;
    const y = Y(v);
    out.push(
        `<line x1="${pL}" x2="${(pL + cW).toFixed(1)}" ` +
      `y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#374151" stroke-width="0.5"/>`,
    );
    out.push(
        `<text x="${(pL - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" ` +
      `text-anchor="end" font-size="7" fill="#6b7280">${fmtV(v)}</text>`,
    );
  }

  // One polyline per boot segment (gaps between reboots)
  let si = 0;
  while (si < pts.length) {
    const boot = pts[si].boot;
    let ei = si + 1;
    while (ei < pts.length && pts[ei].boot === boot) ei++;
    if (ei - si >= 2) {
      const coords: string[] = [];
      for (let j = si; j < ei; j++) {
        coords.push(`${X(pts[j].uptime).toFixed(1)},${Y(pts[j].value).toFixed(1)}`);
      }
      const base = (pT + cH).toFixed(1);
      const area = [
        `${X(pts[si].uptime).toFixed(1)},${base}`,
        ...coords,
        `${X(pts[ei - 1].uptime).toFixed(1)},${base}`,
      ].join(' ');
      out.push(`<polygon points="${area}" fill="${color}" opacity="0.08"/>`);
      out.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"/>`);
    }
    si = ei;
  }

  // X-axis uptime labels
  const ly = (pT + cH + 12).toFixed(1);
  for (let t = 0; t <= 4; t++) {
    const u = xMin + (t / 4) * xR;
    out.push(
        `<text x="${X(u).toFixed(1)}" y="${ly}" ` +
      `text-anchor="middle" font-size="7" fill="#6b7280">${fmtU(u)}</text>`,
    );
  }

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    out.join('') + '</svg>';
  const label = series.metric + (series.unit ? ` (${series.unit})` : '');
  // The auto-range toggle is only meaningful when a fixed default exists.
  const toggle = def ?
    `<label class="hc-range"><input type="checkbox" class="dp-autorange" ` +
      `data-key="${escapeAttr(key)}"${useAuto ? ' checked' : ''}>auto</label>` :
    '';
  return `<div class="hc-section" data-key="${escapeAttr(key)}">` +
    `<div class="hc-head"><span class="hc-label">${label}</span>${toggle}</div>` +
    `${svg}</div>`;
}

// ── Multi-node utilisation charts ───────────────────────────────────────────
// Airtime and channel utilisation reported by *every* node that got data to us
// — the local device via "Send:" lines, peers via "(Received from X):" lines —
// layered on one set of axes, with a mesh-wide average overlaid.
//
// The x-axis is the local log's uptime for every source (parseLog stamps rows
// from the line prefix, i.e. when *we* saw it), so peers with unsynchronised
// clocks or their own uptimes still land on a common timeline for free.

const UTIL_METRICS: Array<{metric: string; label: string}> = [
  {metric: 'air_util_tx', label: 'Air util TX · all nodes'},
  {metric: 'channel_utilization', label: 'Channel utilisation · all nodes'},
];

// Distinct enough to tell apart as thin overlaid lines; local always takes the
// Meshtastic green, peers take the rest in a stable (sorted) order.
const NODE_PALETTE = [
  '#38bdf8', '#a78bfa', '#f59e0b', '#ff7b72',
  '#39c5cf', '#d29922', '#79c0ff', '#c084fc',
];
const LOCAL_COLOR = '#67EA94';
const AVG_COLOR = '#f3f4f6';

interface UtilPoint { boot: number; uptime: number; value: number }

// Mesh-wide average across nodes that report at different times and rates.
//
// A plain mean of the raw samples would over-weight whichever node happens to
// report most often. Instead each node's last reading is carried forward
// (last-observation-carried-forward), and at every instant a sample arrives the
// mean is taken over all nodes heard from so far — so every node counts once,
// regardless of how chatty it is. Carry-forward is reset per boot, since a
// reading from before a reboot says nothing about the mesh after it.
function averageAcrossNodes(bySource: Map<string, UtilPoint[]>): UtilPoint[] {
  const all: Array<{src: string; p: UtilPoint}> = [];
  for (const [src, pts] of bySource) for (const p of pts) all.push({src, p});
  all.sort((a, b) => a.p.boot - b.p.boot || a.p.uptime - b.p.uptime);

  const out: UtilPoint[] = [];
  let curBoot = -1;
  let latest = new Map<string, number>();
  let i = 0;
  while (i < all.length) {
    const boot = all[i].p.boot;
    if (boot !== curBoot) {
      curBoot = boot;
      latest = new Map();
    }
    // Fold in every sample sharing this exact timestamp before averaging, so
    // simultaneous reports produce one averaged point rather than several.
    const t = all[i].p.uptime;
    while (i < all.length && all[i].p.boot === boot && all[i].p.uptime === t) {
      latest.set(all[i].src, all[i].p.value);
      i++;
    }
    let sum = 0;
    for (const v of latest.values()) sum += v;
    out.push({boot, uptime: t, value: sum / latest.size});
  }
  return out;
}

function polylineFor(
    pts: UtilPoint[], X: (u: number) => number, Y: (v: number) => number,
    color: string, width: number, dashed = false): string {
  // One polyline per boot run, so a reboot leaves a gap instead of a line
  // sweeping back across the chart. A run of a single sample can't be a line —
  // distant peers often report just once — so it's drawn as a dot instead,
  // otherwise that node would sit in the legend with nothing visible on the
  // chart (and it does still pull on the average from that point on).
  const out: string[] = [];
  let si = 0;
  while (si < pts.length) {
    const boot = pts[si].boot;
    let ei = si + 1;
    while (ei < pts.length && pts[ei].boot === boot) ei++;
    if (ei - si === 1) {
      out.push(`<circle cx="${X(pts[si].uptime).toFixed(1)}" cy="${Y(pts[si].value).toFixed(1)}" ` +
        `r="${(width + 1).toFixed(1)}" fill="${color}"/>`);
    } else {
      const coords: string[] = [];
      for (let j = si; j < ei; j++) {
        coords.push(`${X(pts[j].uptime).toFixed(1)},${Y(pts[j].value).toFixed(1)}`);
      }
      const dash = dashed ? ' stroke-dasharray="4 2"' : '';
      out.push(`<polyline points="${coords.join(' ')}" fill="none" stroke="${color}" ` +
        `stroke-width="${width}"${dash} stroke-linejoin="round"/>`);
    }
    si = ei;
  }
  return out.join('');
}

function utilChart(
    metric: string, label: string, rows: SensorRow[],
    opts: ChartOptions, averageOnly: boolean): string {
  const mine = rows.filter((r) => normMetric(r.metric) === metric);
  if (mine.length === 0) return '';

  const bySource = new Map<string, UtilPoint[]>();
  for (const r of mine) {
    if (!bySource.has(r.source)) bySource.set(r.source, []);
    bySource.get(r.source)!.push({boot: r.boot, uptime: r.uptime, value: r.value});
  }
  for (const pts of bySource.values()) {
    pts.sort((a, b) => a.boot - b.boot || a.uptime - b.uptime);
  }
  // With a single source this is just the existing per-node chart with extra
  // steps — these tiles only earn their space once there's a mesh to compare.
  if (bySource.size < 2) return '';

  const avg = averageAcrossNodes(bySource);

  const W = opts.large ? 300 : 290;
  const H = opts.large ? 200 : 110;
  const pL = 28; const pB = 18; const pT = 5; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;

  let xMin = Infinity; let xMax = -Infinity; let yMax = -Infinity;
  for (const r of mine) {
    if (r.uptime < xMin) xMin = r.uptime;
    if (r.uptime > xMax) xMax = r.uptime;
    if (r.value > yMax) yMax = r.value;
  }
  if (xMin === xMax) xMax = xMin + 1;
  // Utilisation is a non-negative percentage, so the axis is pinned at 0 rather
  // than auto-fitting the minimum — a floor of 0 keeps "how loaded is the mesh"
  // readable instead of magnifying noise.
  const yMinV = 0;
  const yMaxV = yMax > 0 ? yMax * 1.1 : 1;
  const xR = xMax - xMin;
  const yR = yMaxV - yMinV;
  const X = (u: number): number => pL + ((u - xMin) / xR) * cW;
  const Y = (v: number): number => {
    const y = pT + cH - ((v - yMinV) / yR) * cH;
    return Math.max(pT, Math.min(pT + cH, y));
  };

  const out: string[] = [];
  for (let t = 0; t <= 3; t++) {
    const v = yMinV + (t / 3) * yR;
    const y = Y(v);
    out.push(`<line x1="${pL}" x2="${(pL + cW).toFixed(1)}" ` +
      `y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#374151" stroke-width="0.5"/>`);
    out.push(`<text x="${(pL - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" ` +
      `text-anchor="end" font-size="7" fill="#6b7280">${fmtV(v)}</text>`);
  }

  // Peers in stable alphabetical order so a node keeps its colour between renders.
  const sources = [...bySource.keys()].sort((a, b) => {
    if (a === 'local') return -1;
    if (b === 'local') return 1;
    return a.localeCompare(b);
  });
  const colorOf = (src: string, idx: number): string =>
    src === 'local' ? LOCAL_COLOR : NODE_PALETTE[(idx - 1 + NODE_PALETTE.length) % NODE_PALETTE.length];

  if (!averageOnly) {
    sources.forEach((src, idx) => {
      out.push(polylineFor(bySource.get(src)!, X, Y, colorOf(src, idx), 1));
    });
  }
  out.push(polylineFor(avg, X, Y, AVG_COLOR, averageOnly ? 1.8 : 2, true));

  const ly = (pT + cH + 12).toFixed(1);
  for (let t = 0; t <= 4; t++) {
    const u = xMin + (t / 4) * xR;
    out.push(`<text x="${X(u).toFixed(1)}" y="${ly}" ` +
      `text-anchor="middle" font-size="7" fill="#6b7280">${fmtU(u)}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    out.join('') + '</svg>';

  const legendItems = [
    `<span class="hc-dot" style="background:${AVG_COLOR}"></span>mesh avg (${sources.length})`,
  ];
  if (!averageOnly) {
    sources.forEach((src, idx) => {
      const name = src === 'local' ? 'this node' : src;
      legendItems.push(`<span class="hc-dot" style="background:${colorOf(src, idx)}"></span>${name}`);
    });
  }
  const legend = `<div class="hc-legend hc-legend-wrap">${legendItems.join('')}</div>`;
  const toggle = `<label class="hc-range"><input type="checkbox" class="dp-avgonly" ` +
    `data-key="${escapeAttr(metric)}"${averageOnly ? ' checked' : ''}>avg only</label>`;
  return `<div class="hc-section">` +
    `<div class="hc-head"><span class="hc-label">${label}</span>${toggle}</div>` +
    `${svg}${legend}</div>`;
}

// One tile per utilisation metric, keyed for the masonry layout.
export function renderMultiNodeUtilCharts(
    rows: SensorRow[], opts: ChartOptions,
    averageOnly: Set<string>): Array<{key: string; html: string}> {
  const out: Array<{key: string; html: string}> = [];
  for (const {metric, label} of UTIL_METRICS) {
    const html = utilChart(metric, label, rows, opts, averageOnly.has(metric));
    if (html) out.push({key: `meshUtil:${metric}`, html});
  }
  return out;
}

export function renderTelemetryCharts(series: SensorSeries[], opts: ChartOptions): string {
  // uptime is a monotonic counter — shown as a clock in the summary, not plotted.
  let usable = series.filter((s) => s.points.length >= 2 && s.metric.toLowerCase() !== 'uptime');
  if (opts.suppressZero) {
    usable = usable.filter((s) => !isAllZero(s));
  }
  if (usable.length === 0) return '';

  const local = usable.filter((s) => s.source === 'local');
  const peers = usable.filter((s) => s.source !== 'local');
  const parts: string[] = [];
  const divHdr =
    'class="hc-label dp-divider" style="margin-top:8px;border-top:1px solid #374151;padding-top:6px;"';

  if (local.length > 0) {
    const sorted = [...local].sort((a, b) => {
      const ai = CAT_ORDER.indexOf(a.category);
      const bi = CAT_ORDER.indexOf(b.category);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    parts.push(`<div ${divHdr}>LOCAL TELEMETRY</div>`);
    for (const s of sorted) {
      const chart = telLine(s, opts);
      if (chart) parts.push(chart);
    }
  }

  if (peers.length > 0) {
    parts.push(`<div ${divHdr}>PEER TELEMETRY</div>`);
    const bySender = new Map<string, SensorSeries[]>();
    for (const s of peers) {
      if (!bySender.has(s.source)) bySender.set(s.source, []);
      bySender.get(s.source)!.push(s);
    }
    for (const [sender, ss] of bySender) {
      parts.push(`<div class="hc-label dp-divider" style="color:#f3f4f6;font-size:9px;">${sender}</div>`);
      for (const s of ss) {
        const chart = telLine(s, opts);
        if (chart) parts.push(chart);
      }
    }
  }

  return parts.join('');
}
