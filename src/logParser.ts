// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
// systemd journal: "Mar 03 12:53:22 host meshtasticd[798]: "
const SYSTEMD_RE = /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+\[\d+\]:\s*/;

// Strips ANSI escape sequences (colours, cursor codes, etc.)
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// Strips ANSI codes and known log-capture wrapper prefixes (systemd journal, etc.)
export function preprocessLine(text: string): string {
  return text.replace(ANSI_RE, '').replace(SYSTEMD_RE, '');
}

const A = {
  reset: '\x1b[0m',
  timestamp: '\x1b[90m',
  module: '\x1b[35m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  critical: '\x1b[1;31m',
};

// Maps firmware level strings → single-char keys used by the level filter
const LEVEL_MAP: Record<string, string> = {
  INFO: 'I', DEBUG: 'D', WARN: 'W', ERROR: 'E', CRITICAL: 'C',
};

const LABELS: Record<string, string> = {
  D: 'DBG', I: 'INF', W: 'WRN', E: 'ERR', C: 'CRT',
};

function levelAnsi(level: string): string {
  switch (level) {
    case 'D': return A.debug;
    case 'I': return A.info;
    case 'W': return A.warn;
    case 'E': return A.error;
    case 'C': return A.critical;
    default: return A.reset;
  }
}

// Actual firmware format (after ANSI strip):
//   "INFO  | ??:??:?? 0 message"
//   "DEBUG | ??:??:?? 1 [Module] message"
const REAL_FMT =
  /^(INFO|DEBUG|WARN|ERROR|CRITICAL)\s+\|\s+(\S+)\s+(\d+)\s+(?:\[([^\]]+)\]\s+)?(.*)/;

// Legacy formats kept for compatibility
const NEW_FMT = /^([DIWEC])\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\[([^\]]+)\]\s*(.*)/;
const OLD_FMT = /^\[(\d+)\]\s+\[([DIWEC])\]\s+\[([^\]]+)\]\s*(.*)/;
// ESP32 SDK native log: "[  6303][I][esp32-hal-i2c.c:112] init(): ..."
const ESP32_FMT = /^\[\s*\d+\]\[([DIWEV])\]\[([^\]]+)\]\s*(.*)/;
// ESP-IDF error log: "E (12617) NIMBLE_NVS: message"
const ESPIDF_FMT = /^([DIWEV])\s+\((\d+)\)\s+([\w_]+):\s*(.*)/;

const ESP32_LEVEL: Record<string, string> = {I: 'I', D: 'D', W: 'W', E: 'E', V: 'D'};

export interface ParsedLine {
  level: string;   // D/I/W/E/C, or '' for unrecognised
  module: string;
  uptime?: number; // seconds since boot (real fmt only)
}

export function parseLine(line: string): ParsedLine {
  let m = line.match(REAL_FMT);
  if (m) {
    return {
      level: LEVEL_MAP[m[1]] ?? '',
      module: m[4] ?? '',
      uptime: Number(m[3]),
    };
  }
  m = line.match(NEW_FMT);
  if (m) return {level: m[1].toUpperCase(), module: m[3]};
  m = line.match(OLD_FMT);
  if (m) return {level: m[2].toUpperCase(), module: m[3]};
  m = line.match(ESP32_FMT);
  if (m) return {level: ESP32_LEVEL[m[1]] ?? 'I', module: m[2]};
  m = line.match(ESPIDF_FMT);
  if (m) return {level: ESP32_LEVEL[m[1]] ?? 'I', module: m[3]};
  return {level: '', module: ''};
}

export function colorize(line: string): string {
  let m = line.match(REAL_FMT);
  if (m) {
    const [, lvlWord, time, uptime, module, msg] = m;
    const lvl = LEVEL_MAP[lvlWord] ?? '';
    const c = levelAnsi(lvl);
    const label = LABELS[lvl] ?? lvlWord;
    const mod = module ? ` ${A.module}[${module}]${A.reset}` : '';
    return `${A.timestamp}${time} ${uptime}s${A.reset} ${c}${label}${A.reset}${mod} ${msg}`;
  }
  m = line.match(NEW_FMT);
  if (m) {
    const [, level, time, module, msg] = m;
    const c = levelAnsi(level.toUpperCase());
    const label = LABELS[level.toUpperCase()] ?? level;
    return `${A.timestamp}${time}${A.reset} ${c}${label}${A.reset} ${A.module}[${module}]${A.reset} ${msg}`;
  }
  m = line.match(OLD_FMT);
  if (m) {
    const [, ts, level, module, msg] = m;
    const c = levelAnsi(level.toUpperCase());
    const label = LABELS[level.toUpperCase()] ?? level;
    return `${A.timestamp}[${ts}]${A.reset} ${c}${label}${A.reset} ${A.module}[${module}]${A.reset} ${msg}`;
  }
  m = line.match(ESP32_FMT);
  if (m) {
    const lvl = ESP32_LEVEL[m[1]] ?? 'I';
    const c = levelAnsi(lvl);
    return `${c}${LABELS[lvl] ?? lvl}${A.reset} ${A.module}[${m[2]}]${A.reset} ${m[3]}`;
  }
  m = line.match(ESPIDF_FMT);
  if (m) {
    const lvl = ESP32_LEVEL[m[1]] ?? 'I';
    const c = levelAnsi(lvl);
    return `${A.timestamp}(${m[2]})${A.reset} ${c}${LABELS[lvl] ?? lvl}${A.reset} ` +
      `${A.module}[${m[3]}]${A.reset} ${m[4]}`;
  }
  return line;
}
