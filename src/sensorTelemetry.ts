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
};
const CAT_ORDER = ['device', 'environment', 'airQuality', 'power', 'health', 'host'];

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
