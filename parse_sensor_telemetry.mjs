#!/usr/bin/env node
// parse_sensor_telemetry.mjs
//
// Parse Meshtastic serial logs into tidy, plottable sensor/telemetry time series.
//
// Extracts two kinds of telemetry data lines:
//   local : "[<X>Telemetry] Send: key=val, key=val, ..."   (this node's readings)
//   peer  : "(Received from <name>): key=val, ..."          (neighbouring nodes)
//           "(Received Host Metrics from <name>): ..."
//
// Output is LONG format — one row per (sample, metric) — which any plotter
// (matplotlib, gnuplot, Excel, a JS charting lib) can group by `metric` with
// x=`uptime` and y=`value`. Per-boot segmentation is tracked so an uptime reset
// (reboot) starts a new segment instead of drawing a line back to zero.
//
// Usage:
//   node parse_sensor_telemetry.mjs <logfile> [--format csv|json|both] [--out <prefix>]
//   node parse_sensor_telemetry.mjs <logfile> --html <out.html>
//   cat log.txt | node parse_sensor_telemetry.mjs --format csv
//
// Examples:
//   node parse_sensor_telemetry.mjs ../.notes/logs/foo.txt > series.csv
//   node parse_sensor_telemetry.mjs foo.txt --html chart.html && open chart.html

import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Line preprocessing
// ---------------------------------------------------------------------------

// Strip ANSI color escapes and any non-printable / non-ASCII bytes. Meshtastic
// boot banners contain non-UTF8 bytes ("//\ E S H T...") and lines are wrapped
// in color codes; both break naive matching. (Same lesson as the log mining.)
const ANSI = /\x1b\[[0-9;]*m/g;
function clean(line) {
  return line.replace(ANSI, "").replace(/[^\x09\x20-\x7e]/g, "");
}

// LEVEL | HH:MM:SS uptime [Module] message
// time may be "??:??:??"; uptime is always an integer (seconds since boot).
const PREFIX = /^([A-Z]+)\s*\|\s*([\d?:]+)\s+(\d+)\s+(.*)$/;

// A telemetry data payload is a run of `key=value[unit]` pairs. Keys may contain
// spaces ("wind speed"). Value is numeric; an optional trailing unit token is
// captured for axis labels ("m/s", "kg", "degrees", "%", "R/h").
const KV = /([A-Za-z][\w ]*?)\s*=\s*(-?\d+(?:\.\d+)?)\s*([^\s,()]*)/g;

// Map a telemetry module tag to a category label.
function categoryFromModule(mod) {
  if (!mod) return "unknown";
  const m = mod.replace(/Module$/, "");
  if (/DeviceTelemetry/.test(m)) return "device";
  if (/EnvironmentTelemetry/.test(m)) return "environment";
  if (/AirQualityTelemetry/.test(m)) return "airQuality";
  if (/PowerTelemetry/.test(m)) return "power";
  if (/HealthTelemetry/.test(m)) return "health";
  if (/HostMetrics/.test(m)) return "host";
  return m || "unknown";
}

function parseKV(payload) {
  const out = [];
  let m;
  KV.lastIndex = 0;
  while ((m = KV.exec(payload)) !== null) {
    out.push({ metric: m[1].trim(), value: Number(m[2]), unit: m[3] || "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core parse
// ---------------------------------------------------------------------------

export function parseLog(text) {
  const rows = [];
  let boot = 0;
  let prevUptime = -1;
  let seenAny = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;

    // New boot on the build banner.
    if (/\bS:B:/.test(line)) {
      if (seenAny) boot++;
      prevUptime = -1;
      continue;
    }

    const pm = PREFIX.exec(line);
    if (!pm) continue;
    const [, , /*level*/ time, uptimeStr, rest] = pm;
    const uptime = Number(uptimeStr);

    // Uptime going backwards => reboot we didn't see a banner for.
    if (prevUptime >= 0 && uptime + 2 < prevUptime) boot++;
    prevUptime = uptime;

    // Optional [Module] tag, then the message body.
    let mod = null;
    let msg = rest;
    const tag = /^\[([^\]]+)\]\s*(.*)$/.exec(rest);
    if (tag) {
      mod = tag[1];
      msg = tag[2];
    }

    // Peer telemetry: "(Received [Host Metrics ]from <name>): <kv>"
    const peer = /^\(Received(?: Host Metrics)? from ([^)]+)\):\s*(.*)$/.exec(
      msg,
    );
    if (peer) {
      const source = peer[1].trim();
      const cat = /Host Metrics/.test(msg) ? "host" : categoryFromModule(mod);
      for (const kv of parseKV(peer[2])) {
        rows.push({ boot, uptime, time, source, category: cat, ...kv });
      }
      seenAny = true;
      continue;
    }

    // Local telemetry: "Send: <kv>" or "Sending local stats: <kv>"
    const local = /^(?:Send:|Sending local stats:)\s*(.*)$/.exec(msg);
    if (local && local[1].includes("=")) {
      const cat = categoryFromModule(mod);
      for (const kv of parseKV(local[1])) {
        rows.push({
          boot,
          uptime,
          time,
          source: "local",
          category: cat,
          ...kv,
        });
      }
      seenAny = true;
      continue;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Series shaping (for JSON / HTML): group by source+category+metric
// ---------------------------------------------------------------------------

export function toSeries(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.source}|${r.category}|${r.metric}`;
    let s = map.get(key);
    if (!s) {
      s = {
        source: r.source,
        category: r.category,
        metric: r.metric,
        unit: r.unit,
        points: [],
      };
      map.set(key, s);
    }
    s.points.push({
      boot: r.boot,
      uptime: r.uptime,
      time: r.time,
      value: r.value,
    });
    if (!s.unit && r.unit) s.unit = r.unit;
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

function toCSV(rows) {
  const head = "boot,uptime,time,source,category,metric,value,unit";
  const esc = (v) =>
    /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const body = rows.map((r) =>
    [r.boot, r.uptime, r.time, r.source, r.category, r.metric, r.value, r.unit]
      .map(esc)
      .join(","),
  );
  return [head, ...body].join("\n");
}

function toHTML(series) {
  // Self-contained: data + a tiny vanilla-canvas multi-series line chart inlined.
  // No external requests (CSP-safe). Toggle series with the checkboxes.
  const data = JSON.stringify(series);
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Meshtastic sensor telemetry</title>
<style>
  body{font:13px system-ui,sans-serif;margin:16px;background:#0e1116;color:#d8dee9}
  #wrap{display:flex;gap:16px}
  #legend{width:280px;max-height:80vh;overflow:auto}
  label{display:block;padding:2px 0;cursor:pointer;white-space:nowrap}
  .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle}
  canvas{background:#161b22;border:1px solid #30363d;border-radius:6px}
  h1{font-size:15px;margin:0 0 12px}
  small{color:#8b949e}
</style></head><body>
<h1>Sensor telemetry <small>x = uptime (s), color = boot segment break shown as gaps</small></h1>
<div id="wrap">
  <canvas id="c" width="900" height="520"></canvas>
  <div id="legend"></div>
</div>
<script>
const SERIES = ${data};
const C = ['#58a6ff','#3fb950','#f85149','#d29922','#bc8cff','#39c5cf','#ff7b72','#e3b341','#79c0ff','#56d364'];
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const legend = document.getElementById('legend');
const on = new Set(SERIES.map((_,i)=>i));
SERIES.forEach((s,i)=>{
  const l=document.createElement('label');
  l.innerHTML='<input type=checkbox checked data-i='+i+'><span class=sw style="background:'+C[i%C.length]+'"></span>'+
    s.source+' · '+s.category+' · '+s.metric+(s.unit?' ('+s.unit+')':'');
  legend.appendChild(l);
});
legend.addEventListener('change',e=>{const i=+e.target.dataset.i; e.target.checked?on.add(i):on.delete(i); draw();});
function draw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  const pad=44, W=cv.width-pad*2, H=cv.height-pad*2;
  const vis=[...on];
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const i of vis) for(const p of SERIES[i].points){
    if(p.uptime<xmin)xmin=p.uptime; if(p.uptime>xmax)xmax=p.uptime;
    if(p.value<ymin)ymin=p.value; if(p.value>ymax)ymax=p.value;
  }
  if(!isFinite(xmin)){ctx.fillStyle='#8b949e';ctx.fillText('no series selected',pad,pad);return;}
  if(ymin===ymax){ymin-=1;ymax+=1;} if(xmin===xmax){xmax=xmin+1;}
  const X=u=>pad+(u-xmin)/(xmax-xmin)*W, Y=v=>pad+H-(v-ymin)/(ymax-ymin)*H;
  ctx.strokeStyle='#30363d';ctx.fillStyle='#8b949e';ctx.lineWidth=1;
  for(let g=0;g<=4;g++){const y=pad+H*g/4,val=ymax-(ymax-ymin)*g/4;
    ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(pad+W,y);ctx.stroke();
    ctx.fillText(val.toPrecision(4),2,y+3);}
  for(let g=0;g<=4;g++){const x=pad+W*g/4,val=Math.round(xmin+(xmax-xmin)*g/4);
    ctx.fillText(val,x-10,pad+H+16);}
  for(const i of vis){const s=SERIES[i];ctx.strokeStyle=C[i%C.length];ctx.lineWidth=1.5;
    ctx.beginPath();let started=false,lastBoot=null;
    for(const p of s.points){
      if(lastBoot!==null && p.boot!==lastBoot){started=false;} // gap across reboot
      lastBoot=p.boot;
      const x=X(p.uptime),y=Y(p.value);
      if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);
    }
    ctx.stroke();}
}
draw();
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  let file = null,
    format = "csv",
    out = null,
    html = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") format = args[++i];
    else if (a === "--out") out = args[++i];
    else if (a === "--html") html = args[++i];
    else if (!a.startsWith("--")) file = a;
  }

  const text = file ? readFileSync(file, "latin1") : readFileSync(0, "latin1");
  const rows = parseLog(text);

  if (html) {
    writeFileSync(html, toHTML(toSeries(rows)));
    process.stderr.write(
      `Wrote ${html} (${rows.length} samples, ${toSeries(rows).length} series)\n`,
    );
    return;
  }

  const csv = () => toCSV(rows);
  const json = () => JSON.stringify({ rows, series: toSeries(rows) }, null, 2);

  if (out) {
    if (format === "csv" || format === "both")
      writeFileSync(`${out}.csv`, csv());
    if (format === "json" || format === "both")
      writeFileSync(`${out}.json`, json());
    process.stderr.write(`Wrote ${out}.* (${rows.length} samples)\n`);
  } else {
    process.stdout.write(format === "json" ? json() : csv());
    process.stdout.write("\n");
  }
}

// Run as CLI unless imported.
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
