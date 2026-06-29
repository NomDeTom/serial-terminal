/**
 * Serial data source: WebSerial port lifecycle (open / read loop / close),
 * the remembered-ports bar, connection settings, and serial-specific UI wiring
 * (connect button, baud-rate control, native/polyfill switcher, navigator.serial
 * connect/disconnect events). Decoded chunks are fed into the serial Session via
 * logView.processChunk. This is the only module that touches the Web Serial API.
 */
import {serial as polyfill, SerialPort as SerialPortPolyfill} from 'web-serial-polyfill';
import {dom, active, serialSession, setUpdatePortBar} from './appContext';
import {processChunk} from './logView';
import {switchView} from './viewController';

declare class PortOption extends HTMLOptionElement {
  port: SerialPort | SerialPortPolyfill;
}

const bufferSize = 8 * 1024;

interface PortRecord { label: string; status: 'available' | 'gone'; }
const portHistory = new Map<SerialPort | SerialPortPolyfill, PortRecord>();

const urlParams = new URLSearchParams(window.location.search);
export const usePolyfill = urlParams.has('polyfill');

let portCounter = 1;
let port: SerialPort | SerialPortPolyfill | undefined;
let reconnectPort: SerialPort | SerialPortPolyfill | undefined;
let reader: ReadableStreamDefaultReader | ReadableStreamBYOBReader | undefined;

function findPortOption(p: SerialPort | SerialPortPolyfill): PortOption | null {
  for (let i = 0; i < dom.portSelector.options.length; ++i) {
    const option = dom.portSelector.options[i];
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
  const el = dom.portChipsEl;
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
  dom.portSelector.appendChild(portOption);
  portHistory.set(p, {label: portOption.textContent, status: 'available'});
  updatePortBar();
  return portOption;
}

function maybeAddNewPort(p: SerialPort | SerialPortPolyfill): PortOption {
  return findPortOption(p) ?? addNewPort(p);
}

function getSelectedBaudRate(): number {
  if (dom.baudRateSelector.value === 'custom') {
    return Number.parseInt(dom.customBaudRateInput.value);
  }
  return Number.parseInt(dom.baudRateSelector.value);
}

function setConnectedUi(connected: boolean): void {
  dom.statusDot.classList.toggle('connected', connected);
  dom.portSelector.disabled = connected;
  dom.baudRateSelector.disabled = connected;
  dom.customBaudRateInput.disabled = connected;
  dom.dataBitsSelector.disabled = connected;
  dom.paritySelector.disabled = connected;
  dom.stopBitsSelector.disabled = connected;
  dom.flowControlCheckbox.disabled = connected;
  dom.connectButton.disabled = false;
  dom.connectButton.textContent = connected ? 'Disconnect' : 'Connect';
}

function markDisconnected(): void {
  setConnectedUi(false);
  port = undefined;
  updatePortBar();
}

export async function connectToPort(): Promise<void> {
  switchView('serial');
  if (dom.portSelector.value === 'prompt') {
    try {
      const serial = usePolyfill ? polyfill : navigator.serial;
      port = await serial.requestPort({});
    } catch {
      return;
    }
    maybeAddNewPort(port).selected = true;
  } else {
    port = (dom.portSelector.selectedOptions[0] as PortOption).port;
  }

  const options = {
    baudRate: getSelectedBaudRate(),
    dataBits: Number.parseInt(dom.dataBitsSelector.value),
    parity: dom.paritySelector.value as ParityType,
    stopBits: Number.parseInt(dom.stopBitsSelector.value),
    flowControl: dom.flowControlCheckbox.checked ? 'hardware' as const : 'none' as const,
    bufferSize,
  };

  dom.connectButton.textContent = 'Connecting…';
  dom.connectButton.disabled = true;
  setConnectedUi(true);
  updatePortBar();
  dom.connectButton.disabled = true;

  try {
    await port.open(options);
    dom.connectButton.disabled = false;
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
    if (dom.reconnectCheckbox?.checked) reconnectPort = droppedPort;
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

// Wire all serial UI + register the port-bar hook + enumerate existing ports.
export async function initSerial(): Promise<void> {
  setUpdatePortBar(updatePortBar);

  dom.connectButton.addEventListener('click', () => {
    if (port) disconnectFromPort();
    else connectToPort();
  });

  dom.baudRateSelector.addEventListener('change', () => {
    dom.customBaudRateInput.hidden = dom.baudRateSelector.value !== 'custom';
  });

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
      if (dom.reconnectCheckbox.checked && p === reconnectPort) {
        reconnectPort = undefined;
        portOption.selected = true;
        connectToPort();
      } else if (dom.grabNextCheckbox.checked && !port) {
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
}
