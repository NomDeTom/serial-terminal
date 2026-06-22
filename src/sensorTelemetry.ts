// Meshtastic serial-log sensor telemetry extractor.
//
// Parses "Send: key=val" (local) and "(Received from X): key=val" (peer)
// lines into a long-format row array suitable for time-series plotting.
// Browser-safe: no Node.js APIs.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
function clean(line: string): string {
  // eslint-disable-next-line no-control-regex
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

function telLine(series: SensorSeries): string {
  const pts = series.points;
  if (pts.length < 2) return '';
  const W = 290;
  const H = 90;
  const pL = 28; const pB = 18; const pT = 5; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const color = CAT_COLOR[series.category] ?? '#6b7280';

  let xMin = Infinity; let xMax = -Infinity;
  let yMin = Infinity; let yMax = -Infinity;
  for (const p of pts) {
    if (p.uptime < xMin) xMin = p.uptime;
    if (p.uptime > xMax) xMax = p.uptime;
    if (p.value < yMin) yMin = p.value;
    if (p.value > yMax) yMax = p.value;
  }
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const xR = xMax - xMin;
  const yR = yMax - yMin;
  const toX = (u: number) => pL + ((u - xMin) / xR) * cW;
  const toY = (v: number) => pT + cH - ((v - yMin) / yR) * cH;

  const out: string[] = [];

  // Horizontal grid lines + Y labels
  for (let t = 0; t <= 3; t++) {
    const v = yMin + (t / 3) * yR;
    const py = toY(v);
    out.push(
        `<line x1="${pL}" x2="${(pL + cW).toFixed(1)}" ` +
      `y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#374151" stroke-width="0.5"/>`,
    );
    out.push(
        `<text x="${(pL - 3).toFixed(1)}" y="${(py + 3).toFixed(1)}" ` +
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
        coords.push(`${toX(pts[j].uptime).toFixed(1)},${toY(pts[j].value).toFixed(1)}`);
      }
      const base = (pT + cH).toFixed(1);
      const area = [
        `${toX(pts[si].uptime).toFixed(1)},${base}`,
        ...coords,
        `${toX(pts[ei - 1].uptime).toFixed(1)},${base}`,
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
        `<text x="${toX(u).toFixed(1)}" y="${ly}" ` +
      `text-anchor="middle" font-size="7" fill="#6b7280">${fmtU(u)}</text>`,
    );
  }

  const svg =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    out.join('') + '</svg>';
  const label = series.metric + (series.unit ? ` (${series.unit})` : '');
  return `<div class="hc-section"><div class="hc-label">${label}</div>${svg}</div>`;
}

export function renderTelemetryCharts(series: SensorSeries[]): string {
  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length === 0) return '';

  const local = usable.filter((s) => s.source === 'local');
  const peers = usable.filter((s) => s.source !== 'local');
  const parts: string[] = [];
  const divHdr = 'class="hc-label" style="margin-top:8px;border-top:1px solid #374151;padding-top:6px;"';

  if (local.length > 0) {
    const sorted = [...local].sort((a, b) => {
      const ai = CAT_ORDER.indexOf(a.category);
      const bi = CAT_ORDER.indexOf(b.category);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    parts.push(`<div ${divHdr}>LOCAL TELEMETRY</div>`);
    for (const s of sorted) {
      const chart = telLine(s);
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
      parts.push(`<div class="hc-label" style="color:#f3f4f6;font-size:9px;">${sender}</div>`);
      for (const s of ss) {
        const chart = telLine(s);
        if (chart) parts.push(chart);
      }
    }
  }

  return parts.join('');
}
