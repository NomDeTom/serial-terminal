import {lookupDevice, lookupDeviceByModel} from './deviceInfo';

// Routing.Error enum from meshtastic/protobufs mesh.proto
const NAK_ERROR_NAMES: Record<number, string> = {
  1: 'NO_ROUTE', 2: 'GOT_NAK', 3: 'TIMEOUT', 4: 'NO_INTERFACE',
  5: 'MAX_RETRANSMIT', 6: 'NO_CHANNEL', 7: 'TOO_LARGE',
  8: 'NO_RESPONSE', 9: 'DUTY_CYCLE_LIMIT',
};

export interface DeviceSummary {
  // Device identity
  hardware?: string;       // APP_ENV (platformio target)
  hwModelId?: number;      // HW_VENDOR integer
  hwModelSlug?: string;    // HardwareModel enum name e.g. TRACKER_T1000_E
  displayName?: string;    // human-readable name from hardware list
  deviceImage?: string;
  firmware?: string;
  buildDate?: string;      // human-readable from "Build timestamp: <unix>"
  buildVariant?: string;
  nodeId?: string;
  nodeName?: string;
  // Radio
  radioType?: string;
  radioFirmware?: string;
  radioTcxo?: string;   // 'TCXO' | 'XTAL'
  radioVref?: string;   // e.g. '1.8V'
  frequency?: string;
  bandwidth?: string;
  txPower?: string;
  modemPreset?: string;
  region?: string;
  // GPS hardware
  gps?: string;
  // I²C
  i2cDevices: string[];
  // Battery (from Power module)
  batteryPct?: string;
  batteryMv?: string;
  usbPower?: boolean;
  isCharging?: boolean;
  // RF environment
  noiseFloor?: string;
  lastRssi?: string;
  lastSnr?: string;
  freqOffset?: string;
  // Boot health
  bootErrors: number;
  noHwRng?: boolean;    // "No radio instance available to provide entropy" — normal on SW-RNG devices
  rebootCount?: number;
  // Packet stats (from Router/NodeInfo)
  txGood?: number;
  txRelay?: number;
  rxGood?: number;
  rxBad?: number;
  // GPS live status (from GPS module)
  gpsLock?: boolean;
  gpsSats?: number;
  // Channel telemetry (from DeviceTelemetry module)
  airUtilTx?: string;
  channelUtil?: string;
  numOnlineNodes?: number;
  numTotalNodes?: number;
  // Hop scaling (from HopScaling module)
  hopLimit?: number;
  hopFill?: string;
  hopPolite?: string;
  hopNextRoll?: string;
  hopPerHop?: number[];
  hopScaledPerHop?: number[];
  hopSeenPerHour?: number[];
  // BLE (from NimBLE / Bluefruit logs)
  bleConnections: number;
  bleDisconnections: number;
  bleNvsErrors: number;     // NIMBLE_NVS bonding corruption
  bleGattFailures: number;  // BLEServer GATT connection failures
  // MQTT
  mqttProxyMode?: boolean;
  mqttState?: string;       // 'connecting' | 'connected' | 'disconnected' | 'failed'
  mqttErrors: number;       // failed connection attempts
  // ── Event / error counters ──────────────────────────────
  busyRxCount: number;
  dutyCycleHits: number;
  nakErrors: Record<string, number>;  // Routing.Error code → count
  channelDecodeFailures: number;
  sslErrors: number;
  powerLossEvents: number;
  radioProbeFailures: string[];
  securityWarning?: boolean;
  rtcMissing?: boolean;
  watchdogReset?: boolean;
}

export function emptySummary(): DeviceSummary {
  return {
    i2cDevices: [], bootErrors: 0,
    bleConnections: 0, bleDisconnections: 0, bleNvsErrors: 0, bleGattFailures: 0,
    mqttErrors: 0,
    busyRxCount: 0, dutyCycleHits: 0, nakErrors: {}, channelDecodeFailures: 0,
    sslErrors: 0, powerLossEvents: 0, radioProbeFailures: [],
  };
}

const MATCHERS: Array<(line: string, s: DeviceSummary) => void> = [
  // "S:B:71,2.8.0.63b1cb7,tracker-t1000-e,NomDeTom/MeshtasticFirmware"
  // Fields: HW_VENDOR, APP_VERSION, APP_ENV (platformio target), APP_REPO
  (line, s) => {
    const m = line.match(/S:B:(\d+),([\w.]+),([\w-]+),([\w/.]+)/);
    if (m) {
      if (s.firmware) {
        // New boot detected — reset accumulated state so summary reflects only the last session
        (Object.keys(s) as string[]).forEach((k) => {
          delete (s as Record<string, unknown>)[k];
        });
        Object.assign(s, emptySummary());
      }
      s.hwModelId = Number(m[1]);
      s.firmware = m[2]; s.hardware = m[3]; s.buildVariant = m[4];
      // Look up by platformio target first, fall back to hwModel integer
      const entry = lookupDevice(m[3]) ?? lookupDeviceByModel(s.hwModelId);
      if (entry) {
        s.displayName = entry.displayName;
        s.hwModelSlug = entry.hwModelSlug;
        s.deviceImage = entry.images?.[0];
      }
    }
  },
  // "Build timestamp: 1766016000"
  (line, s) => {
    const m = line.match(/Build timestamp: (\d+)/);
    if (m) {
      const d = new Date(Number(m[1]) * 1000);
      s.buildDate = d.toISOString().slice(0, 10);
    }
  },
  // "Use nodenum 0x5a165586"
  (line, s) => {
    const m = line.match(/Use nodenum (0x[0-9a-fA-F]+)/);
    if (m) {
      s.nodeId = m[1];
    }
  },
  // "owner = NomDeTom (NdTm)" — user-set node long name
  (line, s) => {
    const m = line.match(/owner = ([^(]+)/);
    if (m) {
      s.nodeName = m[1].trim();
    }
  },
  // Radio chip: "(chip) init result N" — 0 = success, negative = probe failure
  (line, s) => {
    const m = line.match(/(\w+) init result (-?\d+)/);
    if (!m) return;
    if (Number(m[2]) === 0) {
      s.radioType = s.radioType ?? m[1];
    }
  },
  // Radio chip detection — LR11x0 family (interface creation line)
  (line, s) => {
    if (/LR11x0Interface/.test(line)) s.radioType = s.radioType ?? 'LR11x0';
  },
  // Radio chip detection — SX126x family (interface creation line)
  (line, s) => {
    if (/SX126xInterface/.test(line)) s.radioType = s.radioType ?? 'SX126x';
  },
  // "LR11x0 Device 1, HW 34, FW 3.7, WiFi 3.2, GNSS 2.0"
  (line, s) => {
    const m = line.match(/LR11x0 Device \d+, HW \d+, FW ([\d.]+)/);
    if (m) s.radioFirmware = m[1];
  },
  // "Radio freq=906.875, ..." or "Frequency set to 869.525024"
  (line, s) => {
    const m = line.match(/Radio freq=([\d.]+)/) ?? line.match(/Frequency set to ([\d.]+)/);
    if (m) {
      s.frequency = String(Math.round(Number(m[1]) * 1000) / 1000);
    }
  },
  // "SX1262 init success, TCXO, Vref 1.800000V" — refines chip variant and oscillator type
  (line, s) => {
    const m = line.match(/(SX\w+) init success(?:, (TCXO|XTAL))?(?:, Vref ([\d.]+)V)?/);
    if (m) {
      s.radioType = m[1];
      if (m[2]) {
        s.radioTcxo = m[2];
      }
      if (m[3]) {
        s.radioVref = `${Number(m[3]).toFixed(1)}V`;
      }
    }
  },
  // "Set radio: region=UNSET, name=LongFast, ..."
  (line, s) => {
    const m = line.match(/Set radio: region=(\w+), name=(\w+)/);
    if (m) {
      s.region = m[1]; s.modemPreset = m[2];
    }
  },
  // "Final Tx power: 22 dBm" or "Power output set to 10"
  (line, s) => {
    const m = line.match(/Final Tx power: (\d+) dBm/) ?? line.match(/Power output set to (\d+)/);
    if (m) {
      s.txPower = s.txPower ?? m[1];
    }
  },
  // "Bandwidth set to 250.000000"
  (line, s) => {
    const m = line.match(/Bandwidth set to ([\d.]+)/);
    if (m) s.bandwidth = String(Math.round(Number(m[1])));
  },
  // "Using cached GPS probe: AG3335 @ 115200"
  (line, s) => {
    const m = line.match(/Using cached GPS probe: (.+)/);
    if (m) s.gps = m[1].trim();
  },
  // "QMA6100P found at address 0x12"
  (line, s) => {
    const m = line.match(/(\w+) found at address (0x[0-9a-fA-F]+)/);
    if (m) {
      const entry = `${m[1]} @ ${m[2]}`;
      if (!s.i2cDevices.includes(entry)) s.i2cDevices.push(entry);
    }
  },
  // "usbPower=1, isCharging=1, batMv=4186, batPct=99"
  (line, s) => {
    const m = line.match(/usbPower=(\d+), isCharging=(\d+), batMv=(\d+), batPct=(\d+)/);
    if (m) {
      s.usbPower = m[1] === '1';
      s.isCharging = m[2] === '1';
      s.batteryMv = m[3];
      s.batteryPct = m[4];
    }
  },
  // "Noise floor: -93 dBm"
  (line, s) => {
    const m = line.match(/Noise floor: (-?\d+ dBm)/);
    if (m) s.noiseFloor = m[1];
  },
  // "Number of Device Reboots: 46"
  (line, s) => {
    const m = line.match(/Number of Device Reboots: (\d+)/);
    if (m) s.rebootCount = Number(m[1]);
  },
  // "[RadioIf] Lora RX (... rxSNR=X rxRSSI=X ...)"
  (line, s) => {
    const m = line.match(/\[RadioIf\].*rxSNR=([-\d.]+) rxRSSI=([-\d]+)/);
    if (m) {
      s.lastSnr = m[1];
      s.lastRssi = m[2];
    }
  },
  // "[RadioIf] Corrected frequency offset: N"
  (line, s) => {
    const m = line.match(/\[RadioIf\].*Corrected frequency offset: ([-\d.]+)/);
    if (m) s.freqOffset = m[1];
  },
  // "txGood=N,txRelay=N,rxGood=N,rxBad=N"
  (line, s) => {
    const m = line.match(/txGood=(\d+),txRelay=(\d+),rxGood=(\d+),rxBad=(\d+)/);
    if (m) {
      s.txGood = Number(m[1]); s.txRelay = Number(m[2]);
      s.rxGood = Number(m[3]); s.rxBad = Number(m[4]);
    }
  },
  // "No radio instance available to provide entropy" — normal on SW-RNG devices, not a real error
  (line, s) => {
    if (/No radio instance available to provide entropy/.test(line)) s.noHwRng = true;
  },
  // Count boot-phase ERROR lines (uptime ≤ 5s), excluding known-normal non-errors
  (line, s) => {
    if (/No radio instance available to provide entropy/.test(line)) return;
    const m = line.match(/^ERROR\s+\|\s+\S+\s+(\d+)\s/);
    if (m && Number(m[1]) <= 5) s.bootErrors++;
  },
  // [GPS] Publish pos@..., Sats=N, GPSlock=N
  (line, s) => {
    const m = line.match(/\[GPS\].*Sats=(\d+), GPSlock=(\d+)/);
    if (m) {
      s.gpsSats = Number(m[1]);
      s.gpsLock = m[2] === '1';
    }
  },
  // [DeviceTelemetry] Send: air_util_tx=..., channel_utilization=...
  (line, s) => {
    const m = line.match(/\[DeviceTelemetry\].*air_util_tx=([\d.]+), channel_utilization=([\d.]+)/);
    if (m) {
      s.airUtilTx = Number(m[1]).toFixed(2);
      s.channelUtil = Number(m[2]).toFixed(2);
    }
  },
  // [DeviceTelemetry] Sending local stats: ..., num_online_nodes=N, num_total_nodes=N
  (line, s) => {
    const m = line.match(/num_online_nodes=(\d+), num_total_nodes=(\d+)/);
    if (m) {
      s.numOnlineNodes = Number(m[1]);
      s.numTotalNodes = Number(m[2]);
    }
  },
  // [HopScaling] [HOPSCALE] hop=N ... fill=N% ... polite=N/N nextRoll=Nmin
  (line, s) => {
    const m = line.match(/\[HopScaling\].*hop=(\d+).*fill=(\d+%).*polite=(\d+\/\d+).*nextRoll=(\S+)/);
    if (m) {
      s.hopLimit = Number(m[1]); s.hopFill = m[2];
      s.hopPolite = m[3]; s.hopNextRoll = m[4];
    }
  },
  // "[HopScaling] [HOPSCALE] nodes perHop: [1 1 3 3 1 0 0 0]"
  (line, s) => {
    const m = line.match(/\[HopScaling\].*nodes perHop: \[([^\]]+)\]/);
    if (m) s.hopPerHop = m[1].trim().split(/\s+/).map(Number);
  },
  // "[HopScaling] [HOPSCALE] last scaled perHop: [1 1 3 3 1 0 0 0]"
  (line, s) => {
    const m = line.match(/\[HopScaling\].*last scaled perHop: \[([^\]]+)\]/);
    if (m) s.hopScaledPerHop = m[1].trim().split(/\s+/).map(Number);
  },
  // "[HopScaling] [HOPSCALE] scaledSeenPerHour (h0=now): [0 5 3 5 6 6 2 1 1 0 0 1 0]"
  (line, s) => {
    const m = line.match(/\[HopScaling\].*scaledSeenPerHour \(h0=now\): \[([^\]]+)\]/);
    if (m) s.hopSeenPerHour = m[1].trim().split(/\s+/).map(Number);
  },
  // "PowerFSM init, USB power=N" — sets USB state before battery module reports
  (line, s) => {
    const m = line.match(/PowerFSM init, USB power=(\d)/);
    if (m && s.usbPower === undefined) s.usbPower = m[1] === '1';
  },
  // ── BLE matchers ─────────────────────────────────────────────────────────
  // "BLE incoming connection 77:3d:d7:b1:29:7c"
  (line, s) => {
    if (/BLE incoming connection/.test(line)) s.bleConnections++;
  },
  // "BLE disconnected"
  (line, s) => {
    if (/^BLE disconnected/.test(line) || /\] BLE disconnected/.test(line)) {
      s.bleDisconnections++;
    }
  },
  // "NIMBLE_NVS: NVS data size mismatch" / "NVS operation failed"
  (line, s) => {
    if (/NIMBLE_NVS/.test(line)) s.bleNvsErrors++;
  },
  // "BLEServer.cpp:...] handleGATTServerEvent(): Connection failed"
  (line, s) => {
    if (/handleGATTServerEvent\(\).*Connection failed/.test(line)) s.bleGattFailures++;
  },
  // ── MQTT matchers ─────────────────────────────────────────────────────────
  // "MQTT configured to use client proxy"
  (line, s) => {
    if (/MQTT configured to use client proxy/.test(line)) s.mqttProxyMode = true;
  },
  // "Connecting to MQTT server" / "MQTT connected" / "connection lost" / "Failed to connect"
  (line, s) => {
    if (/Connecting to MQTT server/.test(line)) {
      s.mqttState = 'connecting';
      return;
    }
    if (/MQTT connected/.test(line)) {
      s.mqttState = 'connected';
      return;
    }
    if (/MQTT.*connection lost|MQTT.*disconnected/i.test(line)) {
      s.mqttState = 'disconnected'; return;
    }
    if (/Failed to connect to MQTT|MQTT.*connect.*fail/i.test(line)) {
      s.mqttState = 'failed'; s.mqttErrors++;
    }
  },
  // ── Event / error matchers ────────────────────────────────────────────────
  // "[RadioIf] Can not send yet, busyRx"
  (line, s) => {
    if (/Can not send yet, busyRx/.test(line)) s.busyRxCount++;
  },
  // "DutyCycle limit" / "Duty cycle limit"
  (line, s) => {
    if (/[Dd]uty.?[Cc]ycle limit/.test(line)) s.dutyCycleHits++;
  },
  // "Error=N, return NAK and drop packet" / "Alloc an err=N,to=..."
  (line, s) => {
    let m = line.match(/Error=(\d+),\s*return NAK/);
    if (!m) m = line.match(/Alloc an err=(\d+)/);
    if (m) s.nakErrors[m[1]] = (s.nakErrors[m[1]] ?? 0) + 1;
  },
  // "[Router] No suitable channel found for decoding, hash was 0xNN!"
  (line, s) => {
    if (/No suitable channel found for decoding/.test(line)) s.channelDecodeFailures++;
  },
  // "[Router] Remote device X has advertised your public key ... compromised key"
  (line, s) => {
    if (/advertised your public key/.test(line)) s.securityWarning = true;
  },
  // "RTC not found (found address 0x00)"
  (line, s) => {
    if (/RTC not found/.test(line)) s.rtcMissing = true;
  },
  // SSL certificate errors
  (line, s) => {
    const sslRe = /SSL Certificate File can.t be loaded|Error reading File.*\.pem/;
    const sslRe2 = /Error opening private key|Major Error Gen.*SSL/;
    if (sslRe.test(line) || sslRe2.test(line)) s.sslErrors++;
  },
  // "[PowerFSM] Loss of power in Powered"
  (line, s) => {
    if (/Loss of power in Powered/.test(line)) s.powerLossEvents++;
  },
  // "reset_reason=intWatchdog"
  (line, s) => {
    if (/reset_reason=intWatchdog/.test(line)) s.watchdogReset = true;
  },
  // Radio probe failures: "No RF95 radio" / "No SX1262 radio with TCXO" / "No SX1262 radio with XTAL"
  (line, s) => {
    const m = line.match(/No (\S+) radio/);
    if (m && !s.radioProbeFailures.includes(m[1])) s.radioProbeFailures.push(m[1]);
  },
];

export function updateSummary(line: string, summary: DeviceSummary): void {
  for (const matcher of MATCHERS) {
    matcher(line, summary);
  }
}

export function renderSummary(s: DeviceSummary): string {
  const hasNak = Object.keys(s.nakErrors).length > 0;
  const hasEvents = s.securityWarning || s.watchdogReset || s.sslErrors > 0 ||
    hasNak || s.busyRxCount > 5 || s.channelDecodeFailures > 0 || s.powerLossEvents > 0 ||
    s.dutyCycleHits > 0 || s.bleNvsErrors > 0 || s.bleGattFailures > 0;
  if (!s.hardware && !s.firmware && !s.radioType && !hasEvents) return '';

  const rows: Array<[string, string, string?]> = [];

  if (s.nodeName) {
    rows.push(['Name', s.nodeName]);
  }
  if (s.nodeId) {
    rows.push(['Node ID', `<code>${s.nodeId}</code>`]);
  }

  const hwLabel = s.displayName ?? s.hardware ?? '';
  if (hwLabel) {
    const slug = s.hwModelSlug ? ` <span class="sum-tag">${s.hwModelSlug}</span>` : '';
    const id = s.hwModelId !== undefined && !s.hwModelSlug ?
      ` <span class="sum-tag">model ${s.hwModelId}</span>` : '';
    const hwTt: string[] = [];
    if (s.displayName && s.hardware) hwTt.push(`Target: ${s.hardware}`);
    if (s.hwModelId !== undefined) hwTt.push(`Model ID: ${s.hwModelId}`);
    rows.push(['Hardware', `${hwLabel}${slug}${id}`, hwTt.join(' · ') || undefined]);
  }
  if (s.firmware) {
    const isCustom = !!(s.buildVariant && s.buildVariant !== 'meshtastic/firmware');
    const build = isCustom ? ` <span class="sum-tag">${s.buildVariant}</span>` : '';
    const date = s.buildDate ? ` <span style="color:var(--muted)">${s.buildDate}</span>` : '';
    const cp: string[] = [];
    if (s.buildVariant === 'meshtastic/firmware') cp.push('Mainline release');
    else if (isCustom) cp.push('Custom firmware fork');
    const vl = s.firmware.toLowerCase();
    if (vl.includes('alpha')) cp.push('alpha pre-release');
    else if (vl.includes('beta')) cp.push('beta pre-release');
    else if (vl.includes('rc')) cp.push('release candidate');
    if (s.buildDate) cp.push(`compiled ${s.buildDate}`);
    rows.push(['Firmware', `${s.firmware}${build}${date}`, cp.join(' · ') || undefined]);
  }
  if (s.radioType) {
    const parts = [s.radioType];
    if (s.radioFirmware) parts.push(`FW ${s.radioFirmware}`);
    if (s.radioTcxo) parts.push(s.radioVref ? `${s.radioTcxo} ${s.radioVref}` : s.radioTcxo);
    if (s.frequency) parts.push(`${s.frequency} MHz`);
    if (s.bandwidth) parts.push(`${s.bandwidth} kHz BW`);
    if (s.txPower) parts.push(`${s.txPower} dBm`);
    if (s.modemPreset) parts.push(s.modemPreset);
    rows.push(['Radio', parts.join(' · ')]);
  }

  if (s.region) {
    const warn = s.region === 'UNSET' ? ' <span class="sum-warn">⚠ not configured</span>' : '';
    const tt = s.region === 'UNSET' ? 'Region not set — device will not transmit LoRa' : undefined;
    rows.push(['Region', `${s.region}${warn}`, tt]);
  }

  if (s.gps) rows.push(['GPS', s.gps]);
  if (s.i2cDevices.length) rows.push(['I²C', s.i2cDevices.join(', ')]);

  if (s.batteryPct !== undefined) {
    const mv = s.batteryMv ? ` · ${(Number(s.batteryMv) / 1000).toFixed(2)} V` : '';
    const usb = s.usbPower ? ' · USB' : '';
    const chg = s.isCharging ? ' · charging' : '';
    rows.push(['Battery', `${s.batteryPct}%${mv}${usb}${chg}`]);
  }

  if (s.noiseFloor) {
    rows.push(['Noise floor', s.noiseFloor, 'Ambient RSSI noise floor in dBm']);
  }
  if (s.rebootCount !== undefined) {
    rows.push(['Reboots', String(s.rebootCount), 'Device restarts counted in this log session']);
  }

  if (s.bootErrors > 0) {
    rows.push(['Boot errors', `<span class="sum-warn">${s.bootErrors}</span>`,
      'Hardware initialization failures at startup']);
  }

  // ── Module status ──────────────────────────────────────
  const modRows: Array<[string, string, string?]> = [];

  if (s.gpsLock !== undefined) {
    const lock = s.gpsLock ? '<span style="color:#67EA94">locked</span>' : 'no lock';
    const sats = s.gpsSats !== undefined ? ` · ${s.gpsSats} sat${s.gpsSats === 1 ? '' : 's'}` : '';
    modRows.push(['GPS', lock + sats]);
  }

  if (s.airUtilTx !== undefined) {
    modRows.push(['Channel', `TX ${s.airUtilTx}% · util ${s.channelUtil}%`]);
  }

  if (s.numOnlineNodes !== undefined) {
    modRows.push(['Nodes', `${s.numOnlineNodes} online / ${s.numTotalNodes} total`]);
  }

  if (s.hopLimit !== undefined) {
    const fillWarn = s.hopFill && parseInt(s.hopFill, 10) > 50 ?
      ` <span class="sum-warn">${s.hopFill}</span>` : ` ${s.hopFill}`;
    const politeNote = s.hopPolite && s.hopPolite !== '0/0' ?
      ` · polite ${s.hopPolite} skipped` : '';
    modRows.push(['Hop limit',
      `${s.hopLimit}${fillWarn} fill${politeNote} · resets ${s.hopNextRoll}`]);
  }

  if (s.lastRssi !== undefined) {
    const snr = s.lastSnr !== undefined ? ` · SNR ${s.lastSnr} dB` : '';
    const offset = s.freqOffset !== undefined ? ` · Δf ${Number(s.freqOffset).toFixed(0)} Hz` : '';
    modRows.push(['RadioIf', `RSSI ${s.lastRssi} dBm${snr}${offset}`]);
  }

  if (s.rxGood !== undefined) {
    const bad = s.rxBad ? ` · <span class="sum-warn">${s.rxBad} bad</span>` : '';
    modRows.push(['Packets',
      `TX ${s.txGood} (+${s.txRelay} relay) · RX ${s.rxGood}${bad}`]);
  }

  if (s.bleConnections > 0) {
    const disc = s.bleDisconnections > 0 ? ` · ${s.bleDisconnections} disconn` : '';
    modRows.push(['BLE', `${s.bleConnections} session${s.bleConnections !== 1 ? 's' : ''}${disc}`]);
  }

  if (s.mqttProxyMode || s.mqttState) {
    const mode = s.mqttProxyMode ? 'proxy ' : '';
    const state = s.mqttState ?? '';
    const errs = s.mqttErrors > 0 ? ` <span class="sum-warn">×${s.mqttErrors} failed</span>` : '';
    modRows.push(['MQTT', `${mode}${state}${errs}`.trim()]);
  }

  // ── Events / errors ────────────────────────────────────
  const evtRows: Array<[string, string, string?]> = [];

  if (s.securityWarning) {
    evtRows.push(['Security', '<span class="sum-err">⚠ key advertised by remote — regenerate keys</span>',
      'A remote node is advertising your network key — regenerate keys immediately to secure the channel']);
  }
  if (s.watchdogReset) {
    evtRows.push(['Reset', '<span class="sum-err">watchdog reset (intWatchdog)</span>',
      'Firmware crash triggered a hardware watchdog reset']);
  }
  if (s.sslErrors > 0) {
    const plural = s.sslErrors !== 1 ? 's' : '';
    evtRows.push(['SSL',
      `<span class="sum-err">${s.sslErrors} cert error${plural} — check certificate files</span>`,
      'TLS certificate validation failed — check that cert/key files are valid and not expired']);
  }
  if (hasNak) {
    const parts = Object.entries(s.nakErrors).map(([code, count]) => {
      const name = NAK_ERROR_NAMES[Number(code)] ?? `err${code}`;
      return `${name} ×${count}`;
    }).join(' · ');
    evtRows.push(['NAK drops', `<span class="sum-warn">${parts}</span>`,
      'Packets acknowledged at the radio layer but rejected by the remote node']);
  }
  if (s.busyRxCount > 0) {
    const cls = s.busyRxCount > 20 ? 'sum-warn' : '';
    const count = s.busyRxCount > 999 ? '>999' : `×${s.busyRxCount}`;
    const label = s.busyRxCount > 20 ? 'RF congestion' : 'busyRx';
    evtRows.push([label, cls ? `<span class="${cls}">${count}</span>` : count,
      'Radio was mid-receive when a TX was attempted — high counts indicate a congested RF environment']);
  }
  if (s.dutyCycleHits > 0) {
    evtRows.push(['Duty cycle',
      `<span class="sum-warn">×${s.dutyCycleHits} TX blocked — regulatory limit</span>`,
      'LoRa duty cycle limit hit (EU regulation) — TX was blocked to stay within the legal airtime cap']);
  }
  if (s.channelDecodeFailures > 0) {
    evtRows.push(['Decode fail',
      `<span class="sum-warn">×${s.channelDecodeFailures} (unknown channel hash)</span>`,
      'Received packets whose channel hash did not match any known channel — likely a mismatched channel key']);
  }
  if (s.powerLossEvents > 0) {
    evtRows.push(['Power loss', `<span class="sum-warn">×${s.powerLossEvents}</span>`,
      'Unexpected power interruptions detected in this session']);
  }
  if (s.bleNvsErrors > 0) {
    evtRows.push(['BLE NVS',
      `<span class="sum-warn">×${s.bleNvsErrors} bonding data corrupted — clear NVS to fix</span>`,
      'Bluetooth bonding data in flash is corrupted — erase NVS partition to restore pairing']);
  }
  if (s.bleGattFailures > 0) {
    evtRows.push(['BLE GATT', `<span class="sum-warn">×${s.bleGattFailures} connection failed</span>`,
      'Bluetooth GATT connection establishment failures — may affect app connectivity']);
  }
  if (s.noHwRng) {
    evtRows.push(['Entropy', 'SW RNG (no hardware radio entropy source)',
      'No hardware random number generator found — using software entropy (lower security)']);
  }
  if (s.rtcMissing) {
    evtRows.push(['RTC', 'not detected',
      'Real-time clock not detected — timestamps may be inaccurate until GPS or NTP sync']);
  }
  // Only show radio probe failures if no radio was ever successfully initialised
  if (s.radioProbeFailures.length && !s.radioType) {
    evtRows.push(['Radio probe', `failed: ${s.radioProbeFailures.join(', ')}`,
      'Radio chip detection failed — check hardware connections and solder joints']);
  }

  const img = s.deviceImage ?
    `<img class="device-img" src="/img/devices/${s.deviceImage}" alt="${hwLabel}">` : '';

  function renderRow([label, value, tooltip]: [string, string, string?]): string {
    const tt = tooltip ? ` data-tooltip="${tooltip}"` : '';
    return `<div class="sum-row"${tt}><span class="sum-label">${label}</span>` +
      `<span class="sum-value">${value}</span></div>`;
  }

  const modDivider = modRows.length ? '<div class="sum-divider">MODULE STATUS</div>' : '';
  const evtDivider = evtRows.length ? '<div class="sum-divider sum-divider-err">EVENTS</div>' : '';

  const grid = '<div class="sum-grid">' +
    rows.map(renderRow).join('') +
    modDivider + modRows.map(renderRow).join('') +
    evtDivider + evtRows.map(renderRow).join('') +
    '</div>';

  return img + grid;
}

// ── Hop scaling charts ──────────────────────────────────────────────────────

export function renderHopChart(s: DeviceSummary): string {
  const hasBar = !!(s.hopPerHop && s.hopScaledPerHop);
  const hasLine = !!s.hopSeenPerHour;
  if (!hasBar && !hasLine) return '';
  const parts: string[] = [];
  if (hasBar) parts.push(hopBarChart(s.hopPerHop!, s.hopScaledPerHop!));
  if (hasLine) parts.push(hopLineChart(s.hopSeenPerHour!));
  return parts.join('');
}

function svgGridLine(x1: number, x2: number, y: number): string {
  const ys = y.toFixed(1);
  return `<line x1="${x1}" x2="${x2}" y1="${ys}" y2="${ys}" stroke="#374151" stroke-width="0.5"/>`;
}

function svgGridLabel(x: number, y: number, text: string|number): string {
  const tx = x.toFixed(1);
  const ty = (y + 3).toFixed(1);
  return `<text x="${tx}" y="${ty}" text-anchor="end" font-size="8" fill="#6b7280">${text}</text>`;
}

function renderGridLines(pL: number, cW: number, pT: number, cH: number, maxVal: number): string[] {
  const out: string[] = [];
  const tickCount = Math.min(maxVal, 4);
  for (let t = 0; t <= tickCount; t++) {
    const v = Math.round((t / tickCount) * maxVal);
    const y = pT + cH - (v / maxVal) * cH;
    out.push(svgGridLine(pL, pL + cW, y));
    out.push(svgGridLabel(pL - 3, y, v));
  }
  return out;
}

function hopBarChart(base: number[], scaled: number[]): string {
  const W = 220;
  const H = 110;
  const pL = 22;
  const pB = 22;
  const pT = 8;
  const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const n = base.length;
  const maxVal = Math.max(1, ...base.map((b, i) => b + (scaled[i] ?? 0)));
  const barW = cW / n;
  const gap = Math.max(2, barW * 0.2);
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  for (let i = 0; i < n; i++) {
    const bv = base[i] ?? 0;
    const sv = scaled[i] ?? 0;
    const rx = (pL + i * barW + gap / 2).toFixed(1);
    const rw = (barW - gap).toFixed(1);
    const bH = (bv / maxVal) * cH;
    const sH = (sv / maxVal) * cH;
    if (bH > 0) {
      const ry = (pT + cH - bH).toFixed(1);
      const rh = bH.toFixed(1);
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#67EA94" opacity="0.85" rx="1"/>`);
    }
    if (sH > 0) {
      const ry = (pT + cH - bH - sH).toFixed(1);
      const rh = sH.toFixed(1);
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#a78bfa" opacity="0.75" rx="1"/>`);
    }
    const lx = (pL + i * barW + barW / 2).toFixed(1);
    const ly = (pT + cH + 14).toFixed(1);
    parts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="8" fill="#6b7280">${i}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  const legend = `<div class="hc-legend">` +
    `<span class="hc-dot" style="background:#67EA94"></span>base` +
    `<span class="hc-dot" style="background:#a78bfa;margin-left:8px"></span>scaled</div>`;
  return `<div class="hc-section"><div class="hc-label">Nodes per hop</div>${svg}${legend}</div>`;
}

function hopLineChart(data: number[]): string {
  const W = 280;
  const H = 110;
  const pL = 22;
  const pB = 22;
  const pT = 8;
  const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const pts = [...data].reverse(); // oldest on left, h0=now on right
  const n = pts.length;
  const maxVal = Math.max(1, ...pts);
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  const coords = pts.map((v, i) => ({
    x: pL + (n > 1 ? (i / (n - 1)) * cW : cW / 2),
    y: pT + cH - (v / maxVal) * cH,
  }));

  const areaBase = pT + cH;
  const areaPoints = [
    `${coords[0].x.toFixed(1)},${areaBase}`,
    ...coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`),
    `${coords[n - 1].x.toFixed(1)},${areaBase}`,
  ].join(' ');
  parts.push(`<polygon points="${areaPoints}" fill="#67EA94" opacity="0.1"/>`);

  const linePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  parts.push(`<polyline points="${linePts}" fill="none" stroke="#67EA94" stroke-width="1.5"/>`);

  const labelEvery = Math.ceil(n / 6);
  const ly = (pT + cH + 14).toFixed(1);
  for (let i = 0; i < n; i++) {
    if (i % labelEvery !== 0 && i !== n - 1) continue;
    const label = i === n - 1 ? 'now' : `-${n - 1 - i}h`;
    const lx2 = coords[i].x.toFixed(1);
    parts.push(`<text x="${lx2}" y="${ly}" text-anchor="middle" font-size="8" fill="#6b7280">${label}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  return `<div class="hc-section"><div class="hc-label">Scaled seen / hour</div>${svg}</div>`;
}
