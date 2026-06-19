/**
 * Meshtastic Log Analyser
 * Based on GoogleChromeLabs/serial-terminal (Apache-2.0)
 */

import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {serial as polyfill, SerialPort as SerialPortPolyfill} from 'web-serial-polyfill';
import {PiiFilter} from './piiFilter';
import {parseLine, colorize, preprocessLine} from './logParser';
import {DeviceSummary, emptySummary, updateSummary, renderSummary} from './logSummary';
import {initDeviceInfo} from './deviceInfo';

declare class PortOption extends HTMLOptionElement {
  port: SerialPort | SerialPortPolyfill;
}

const MAX_HISTORY = 10_000;
const bufferSize = 8 * 1024;

const piiFilter = new PiiFilter();
const lineHistory: string[] = [];   // clean (ANSI-stripped, PII-filtered) lines
const levelFilter = new Set(['D', 'I', 'W', 'E', 'C']);
const seenModules = new Set<string>();    // modules discovered so far
const hiddenModules = new Set<string>(); // modules toggled off (empty = all visible)
let lineBuffer = '';                     // accumulates a partial line between chunks
let summary: DeviceSummary = emptySummary();
let summaryEl: HTMLElement;
let moduleBtnsEl: HTMLElement;

let portSelector: HTMLSelectElement;
let connectButton: HTMLButtonElement;
let baudRateSelector: HTMLSelectElement;
let customBaudRateInput: HTMLInputElement;
let dataBitsSelector: HTMLSelectElement;
let paritySelector: HTMLSelectElement;
let stopBitsSelector: HTMLSelectElement;
let flowControlCheckbox: HTMLInputElement;
let autoconnectCheckbox: HTMLInputElement;
let statusDot: HTMLElement;

let portCounter = 1;
let port: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;

const urlParams = new URLSearchParams(window.location.search);
const usePolyfill = urlParams.has('polyfill');

const term = new Terminal({
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

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.loadAddon(new WebLinksAddon());

function moduleKey(module: string): string {
  return module || '__boot__';
}

function linePassesFilter(line: string): boolean {
  const {level, module} = parseLine(line);
  if (level && !levelFilter.has(level)) return false;
  if (hiddenModules.has(moduleKey(module))) return false;
  return true;
}

function addModuleButton(key: string): void {
  const label = key === '__boot__' ? 'boot' : key;
  const btn = document.createElement('button');
  btn.className = 'module-btn active';
  btn.textContent = label;
  btn.dataset['mod'] = key;
  btn.addEventListener('click', () => {
    if (hiddenModules.has(key)) {
      hiddenModules.delete(key);
      btn.classList.add('active');
    } else {
      hiddenModules.add(key);
      btn.classList.remove('active');
    }
    rerender();
  });
  moduleBtnsEl.appendChild(btn);
}

function addLine(raw: string): void {
  const clean = preprocessLine(raw);     // strip ANSI + systemd prefix before storing
  const filtered = piiFilter.filter(clean);
  if (lineHistory.length >= MAX_HISTORY) lineHistory.shift();
  lineHistory.push(filtered);
  updateSummary(filtered, summary);
  refreshSummary();
  const key = moduleKey(parseLine(filtered).module);
  if (!seenModules.has(key)) {
    seenModules.add(key);
    addModuleButton(key);
  }
  if (linePassesFilter(filtered)) {
    term.writeln(colorize(filtered));
  }
}

function refreshSummary(): void {
  if (!summaryEl) return;
  const html = renderSummary(summary);
  if (html) {
    summaryEl.innerHTML = html;
    summaryEl.closest<HTMLElement>('.summary-panel')!.hidden = false;
  }
}

function rerender(): void {
  term.clear();
  for (const line of lineHistory) {
    if (linePassesFilter(line)) {
      term.writeln(colorize(line));
    }
  }
}

function processChunk(chunk: Uint8Array): void {
  const text = new TextDecoder().decode(chunk);
  const parts = (lineBuffer + text).split('\n');
  lineBuffer = parts.pop() ?? '';
  for (const line of parts) {
    addLine(line.replace(/\r$/, ''));
  }
}

function findPortOption(p: SerialPort | SerialPortPolyfill): PortOption | null {
  for (let i = 0; i < portSelector.options.length; ++i) {
    const option = portSelector.options[i];
    if (option.value === 'prompt') continue;
    const portOption = option as PortOption;
    if (portOption.port === p) return portOption;
  }
  return null;
}

function addNewPort(p: SerialPort | SerialPortPolyfill): PortOption {
  const portOption = document.createElement('option') as PortOption;
  portOption.textContent = `Port ${portCounter++}`;
  portOption.port = p;
  portSelector.appendChild(portOption);
  return portOption;
}

function maybeAddNewPort(p: SerialPort | SerialPortPolyfill): PortOption {
  return findPortOption(p) ?? addNewPort(p);
}

function saveLog(): void {
  if (lineHistory.length === 0) return;
  const blob = new Blob([lineHistory.join('\n')], {type: 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `meshtastic-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
}

function clearLog(): void {
  lineHistory.length = 0;
  lineBuffer = '';
  piiFilter.reset();
  summary = emptySummary();
  seenModules.clear();
  hiddenModules.clear();
  term.clear();
  if (moduleBtnsEl) moduleBtnsEl.innerHTML = '';
  if (summaryEl) {
    summaryEl.innerHTML = '';
    summaryEl.closest<HTMLElement>('.summary-panel')!.hidden = true;
  }
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
}

async function connectToPort(): Promise<void> {
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
  connectButton.disabled = true; // keep disabled until open succeeds

  try {
    await port.open(options);
    connectButton.disabled = false;
  } catch (e) {
    if (e instanceof Error) {
      term.writeln(`\x1b[31m<ERROR: ${e.message}>\x1b[0m`);
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

        if (value) processChunk(value);
        if (done) break;
      }
    } catch (e) {
      if (e instanceof Error) {
        term.writeln(`\x1b[31m<ERROR: ${e.message}>\x1b[0m`);
      }
    } finally {
      reader?.releaseLock();
      reader = undefined;
    }
  }

  if (port) {
    try {
      await port.close();
    } catch {/* ignore */}
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

document.addEventListener('DOMContentLoaded', async () => {
  initDeviceInfo(); // fire-and-forget; ready well before any log arrives
  const terminalElement = document.getElementById('terminal')!;
  term.open(terminalElement);
  fitAddon.fit();
  window.addEventListener('resize', () => fitAddon.fit());

  summaryEl = document.getElementById('summaryContent')!;
  moduleBtnsEl = document.getElementById('module_buttons')!;
  statusDot = document.getElementById('statusDot')!;
  portSelector = document.getElementById('ports') as HTMLSelectElement;
  connectButton = document.getElementById('connect') as HTMLButtonElement;
  baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  customBaudRateInput = document.getElementById('custom_baudrate') as HTMLInputElement;
  dataBitsSelector = document.getElementById('databits') as HTMLSelectElement;
  paritySelector = document.getElementById('parity') as HTMLSelectElement;
  stopBitsSelector = document.getElementById('stopbits') as HTMLSelectElement;
  flowControlCheckbox = document.getElementById('rtscts') as HTMLInputElement;
  autoconnectCheckbox = document.getElementById('autoconnect') as HTMLInputElement;

  connectButton.addEventListener('click', () => {
    if (port) disconnectFromPort();
    else connectToPort();
  });

  baudRateSelector.addEventListener('change', () => {
    customBaudRateInput.hidden = baudRateSelector.value !== 'custom';
  });

  // Advanced panel toggle
  const advancedPanel = document.getElementById('advanced')!;
  document.getElementById('advanced_toggle')!.addEventListener('click', (e) => {
    advancedPanel.hidden = !advancedPanel.hidden;
    (e.currentTarget as HTMLButtonElement).textContent =
      advancedPanel.hidden ? 'Advanced ▾' : 'Advanced ▴';
  });

  // Level filter buttons
  document.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = btn.dataset['level']!;
      if (levelFilter.has(level)) {
        levelFilter.delete(level);
        btn.classList.remove('active');
      } else {
        levelFilter.add(level);
        btn.classList.add('active');
      }
      rerender();
    });
  });


  // PII toggle
  const piiButton = document.getElementById('pii_toggle') as HTMLButtonElement;
  piiButton.addEventListener('click', () => {
    piiFilter.enabled = !piiFilter.enabled;
    piiButton.textContent = `🔒 PII: ${piiFilter.enabled ? 'ON' : 'OFF'}`;
    piiButton.classList.toggle('btn-active', piiFilter.enabled);
  });

  document.getElementById('save')!.addEventListener('click', saveLog);
  document.getElementById('clear')!.addEventListener('click', clearLog);
  document.getElementById('summary_hide')!.addEventListener('click', () => {
    summaryEl.closest<HTMLElement>('.summary-panel')!.hidden = true;
  });

  // Polyfill switcher
  const polyfillSwitcher = document.getElementById('polyfill_switcher') as HTMLAnchorElement;
  if (usePolyfill) {
    polyfillSwitcher.href = './';
    polyfillSwitcher.textContent = '→ Native API';
  } else {
    polyfillSwitcher.href = './?polyfill';
    polyfillSwitcher.textContent = '→ Polyfill';
  }

  const serial = usePolyfill ? polyfill : navigator.serial;
  const ports = await serial.getPorts();
  ports.forEach((p) => addNewPort(p));

  if (!usePolyfill) {
    navigator.serial.addEventListener('connect', (event) => {
      const portOption = addNewPort(event.target as SerialPort);
      if (autoconnectCheckbox.checked) {
        portOption.selected = true;
        connectToPort();
      }
    });
    navigator.serial.addEventListener('disconnect', (event) => {
      findPortOption(event.target as SerialPort)?.remove();
    });
  }
});
