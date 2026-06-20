import {lookupDevice, lookupDeviceByModel} from './deviceInfo';

// Routing.Error enum from meshtastic/protobufs mesh.proto
const NAK_ERROR_NAMES: Record<number, string> = {
  1: 'NO_ROUTE', 2: 'GOT_NAK', 3: 'TIMEOUT', 4: 'NO_INTERFACE',
  5: 'MAX_RETRANSMIT', 6: 'NO_CHANNEL', 7: 'TOO_LARGE',
  8: 'NO_RESPONSE', 9: 'DUTY_CYCLE_LIMIT',
};

export interface DeviceSummary {
  // Device identity
  hardware?: string;
  hwModelId?: number;
  hwModelSlug?: string;
  displayName?: string;
  deviceImage?: string;
  firmware?: string;
  buildDate?: string;
  buildVariant?: string;
  nodeId?: string;
  nodeName?: string;

  // Radio
  radioType?: string;
  radioFirmware?: string;
  radioTcxo?: string;
  radioVref?: string;
  radioFem?: string;           // FEM chip (e.g. "SKY66122")
  frequency?: string;
  bandwidth?: string;
  txPower?: string;
  requestedTxPower?: string;   // "Requested Tx power: N dBm"
  txGainDb?: string;           // "Device LoRa Tx gain: N dB"
  modemPreset?: string;
  region?: string;
  freqSlots?: number;          // numFreqSlots
  slotBw?: string;             // slot bandwidth in kHz
  loraBitrate?: string;        // e.g. "117 B/s"
  slotTimeMs?: number;
  preambleTimeMs?: number;
  codingRateOverride?: boolean; // default CR higher than custom setting

  // GPS hardware
  gps?: string;
  gpsChipModel?: string;       // from cached probe
  localLat?: number;           // millionths of degree × 10
  localLon?: number;
  localAlt?: number;           // mm above sea level
  gpsSiv?: number;             // satellites in view

  // I²C
  i2cDevices: string[];
  accelChipId?: number;        // acc_info value
  magChipId?: number;          // mag_info value

  // Battery
  batteryPct?: string;
  batteryMv?: string;
  usbPower?: boolean;
  isCharging?: boolean;
  batteryAdcPin?: number;

  // Memory / storage
  heapTotal?: number;
  heapFree?: number;
  psramTotal?: number;
  psramFree?: number;
  nvsUsed?: number;
  nvsFree?: number;
  nvsTotal?: number;
  fsUsed?: number;
  fsTotal?: number;

  // NodeDB
  nodeDbVersion?: number;
  nodeDbCount?: number;
  nodeDbPosCount?: number;
  nodeDbTelCount?: number;
  nodeDbEnvCount?: number;
  nodeDbStatusCount?: number;
  nodeDbDiscardedOldVersion?: boolean;
  nodeDbFullEvictions: number;

  // Config
  configVersion?: number;
  configVersionMismatch?: boolean;

  // RF environment
  noiseFloor?: string;
  noiseFloorSamples?: number;
  lastRssi?: string;
  lastSnr?: string;
  freqOffset?: string;

  // Boot health
  bootErrors: number;
  noHwRng?: boolean;
  rebootCount?: number;
  wakeSource?: number;
  bootCount?: number;
  resetReason?: string;
  espRstCode?: string;
  watchdogReset?: boolean;

  // Packet stats (from Router/NodeInfo)
  txGood?: number;
  txRelay?: number;
  rxGood?: number;
  rxBad?: number;

  // DeviceTelemetry extended
  uptime?: number;             // seconds
  numPacketsTx?: number;
  numPacketsRx?: number;
  numPacketsRxBad?: number;
  packetCounterCorrupted?: boolean;

  // GPS live status
  gpsLock?: boolean;
  gpsSats?: number;

  // Channel telemetry
  airUtilTx?: string;
  channelUtil?: string;
  numOnlineNodes?: number;
  numTotalNodes?: number;

  // Hop scaling
  hopLimit?: number;
  hopFill?: string;
  hopPolite?: string;
  hopNextRoll?: string;
  hopPerHop?: number[];
  hopScaledPerHop?: number[];
  hopSeenPerHour?: number[];

  // WarmStore
  warmstoreLiveNodes?: number;

  // BLE
  bleConnections: number;
  bleDisconnections: number;
  bleNvsErrors: number;
  bleGattFailures: number;
  bleConnectedTo?: string;

  // MQTT
  mqttProxyMode?: boolean;
  mqttState?: string;
  mqttErrors: number;

  // Mesh beacon
  lastBeaconMsg?: string;
  lastBeaconFrom?: string;

  // Text messages
  lastMessage?: string;
  lastMessageFrom?: string;

  // ── Event / error counters ──────────────────────────────
  busyRxCount: number;
  dutyCycleHits: number;
  nakErrors: Record<string, number>;
  channelDecodeFailures: number;
  sslErrors: number;
  powerLossEvents: number;
  radioProbeFailures: string[];
  protoEncodeErrors: number;
  radioRxErrors: number;
  txRegionUnsetBlocked: number;
  reliableSendFailures: number;
  preHopDropMissingHopStart: number;
  tophoneQueueFull: number;
  invalidChannelIndexErrors: number;
  telemetryRateLimited: number;
  securityWarning?: boolean;
  rtcMissing?: boolean;
}

export function emptySummary(): DeviceSummary {
  return {
    i2cDevices: [],
    bootErrors: 0,
    bleConnections: 0, bleDisconnections: 0, bleNvsErrors: 0, bleGattFailures: 0,
    mqttErrors: 0,
    busyRxCount: 0, dutyCycleHits: 0, nakErrors: {}, channelDecodeFailures: 0,
    sslErrors: 0, powerLossEvents: 0, radioProbeFailures: [],
    protoEncodeErrors: 0, radioRxErrors: 0, txRegionUnsetBlocked: 0,
    reliableSendFailures: 0, preHopDropMissingHopStart: 0, tophoneQueueFull: 0,
    invalidChannelIndexErrors: 0, telemetryRateLimited: 0, nodeDbFullEvictions: 0,
  };
}

function applyBootLine(line: string, s: DeviceSummary, resetOnBoot: boolean): void {
  const m = line.match(/S:B:(\d+),([\w.]+),([\w-]+),([\w/.]+)/);
  if (!m) return;
  if (resetOnBoot && s.firmware) {
    (Object.keys(s) as string[]).forEach((k) => {
      delete (s as unknown as Record<string, unknown>)[k];
    });
    Object.assign(s, emptySummary());
  }
  s.hwModelId = Number(m[1]);
  s.firmware = m[2]; s.hardware = m[3]; s.buildVariant = m[4];
  const entry = lookupDevice(m[3]) ?? lookupDeviceByModel(s.hwModelId);
  if (entry) {
    s.displayName = entry.displayName;
    s.hwModelSlug = entry.hwModelSlug;
    s.deviceImage = entry.images?.[0];
  }
}

const MATCHERS: Array<(line: string, s: DeviceSummary) => void> = [
  // Boot line: "S:B:71,2.8.0.63b1cb7,tracker-t1000-e,NomDeTom/MeshtasticFirmware"
  (line, s) => applyBootLine(line, s, true),

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
    if (m) s.nodeId = m[1];
  },

  // "owner = NomDeTom (NdTm)"
  (line, s) => {
    const m = line.match(/owner = ([^(]+)/);
    if (m) s.nodeName = m[1].trim();
  },

  // Radio chip: "(chip) init result N" — 0 = success
  (line, s) => {
    const m = line.match(/(\w+) init result (-?\d+)/);
    if (!m) return;
    if (Number(m[2]) === 0) s.radioType = s.radioType ?? m[1];
  },

  // "LR11x0Interface" creation log
  (line, s) => {
    if (/LR11x0Interface/.test(line)) s.radioType = s.radioType ?? 'LR11x0';
  },

  // "SX126xInterface" creation log
  (line, s) => {
    if (/SX126xInterface/.test(line)) s.radioType = s.radioType ?? 'SX126x';
  },

  // "LR2021 init success" — after LR20x0 init result 0
  (line, s) => {
    if (/LR2021 init success/.test(line)) s.radioType = 'LR2021';
  },

  // "LR11x0 Device 1, HW 34, FW 3.7, …"
  (line, s) => {
    const m = line.match(/LR11x0 Device \d+, HW \d+, FW ([\d.]+)/);
    if (m) s.radioFirmware = m[1];
  },

  // "Radio freq=N" / "Frequency set to N"
  (line, s) => {
    const m = line.match(/Radio freq=([\d.]+)/) ?? line.match(/Frequency set to ([\d.]+)/);
    if (m) s.frequency = String(Math.round(Number(m[1]) * 1000) / 1000);
  },

  // "SX1262 init success, TCXO, Vref 1.800000V"
  (line, s) => {
    const m = line.match(/(SX\w+) init success(?:, (TCXO|XTAL))?(?:, Vref ([\d.]+)V)?/);
    if (m) {
      s.radioType = m[1];
      if (m[2]) s.radioTcxo = m[2];
      if (m[3]) s.radioVref = `${Number(m[3]).toFixed(1)}V`;
    }
  },

  // "Detected SKY66122 LoRa FEM"
  (line, s) => {
    const m = line.match(/Detected (\S+) LoRa FEM/);
    if (m) s.radioFem = m[1];
  },

  // "Set radio: region=EU_868, name=LongFast, …"
  (line, s) => {
    const m = line.match(/Set radio: region=(\w+), name=(\w+)/);
    if (m) {
      s.region = m[1]; s.modemPreset = m[2];
    }
  },

  // "Wanted region 18, using EU_868" — lower-priority region fallback
  (line, s) => {
    const m = line.match(/Wanted region \d+, using (\w+)/);
    if (m && !s.region) s.region = m[1];
  },

  // "Final Tx power: 22 dBm" / "Power output set to N"
  (line, s) => {
    const m = line.match(/Final Tx power: (\d+) dBm/) ?? line.match(/Power output set to (\d+)/);
    if (m) s.txPower = s.txPower ?? m[1];
  },

  // "Requested Tx power: 22 dBm; Device LoRa Tx gain: 0 dB"
  (line, s) => {
    const m = line.match(/Requested Tx power: (\d+) dBm; Device LoRa Tx gain: (-?\d+) dB/);
    if (m) {
      s.requestedTxPower = m[1]; s.txGainDb = m[2];
    }
  },

  // "Bandwidth set to 250.000000"
  (line, s) => {
    const m = line.match(/Bandwidth set to ([\d.]+)/);
    if (m) s.bandwidth = String(Math.round(Number(m[1])));
  },

  // "numFreqSlots: 8 x 125kHz"
  (line, s) => {
    const m = line.match(/numFreqSlots: (\d+) x ([\d.]+)kHz/);
    if (m) {
      s.freqSlots = Number(m[1]); s.slotBw = m[2];
    }
  },

  // "LoRA bitrate = 116.967873 bytes / sec"
  (line, s) => {
    const m = line.match(/LoRA bitrate = ([\d.]+) bytes \/ sec/i);
    if (m) s.loraBitrate = s.loraBitrate ?? `${Math.round(Number(m[1]))} B/s`;
  },

  // "Slot time: 400 msec, preamble time: 100 msec"
  (line, s) => {
    const m = line.match(/Slot time: (\d+) msec, preamble time: (\d+) msec/);
    if (m) {
      s.slotTimeMs = s.slotTimeMs ?? Number(m[1]);
      s.preambleTimeMs = s.preambleTimeMs ?? Number(m[2]);
    }
  },

  // "Default Coding Rate is higher than custom setting"
  (line, s) => {
    if (/Default Coding Rate is higher than custom setting/.test(line)) s.codingRateOverride = true;
  },

  // "Using cached GPS probe: AG3335 @ 115200"
  (line, s) => {
    const m = line.match(/Using cached GPS probe: (\S+) @ (\S+)/);
    if (m) {
      s.gpsChipModel = m[1];
      s.gps = `${m[1]} @ ${m[2]}`;
    }
  },

  // GPS probe from non-cached line: "Using GPS probe: X"
  (line, s) => {
    const m = line.match(/Using GPS probe: (.+)/);
    if (m && !s.gps) s.gps = m[1].trim();
  },

  // Set local position (raw integer coords)
  (line, s) => {
    const m = line.match(/Set local position: lat=(-?\d+) lon=(-?\d+)/);
    if (m) {
      s.localLat = Number(m[1]); s.localLon = Number(m[2]);
    }
  },

  // Full position line: POSITION node=... lat=N lon=N msl=N ... siv=N
  (line, s) => {
    const m = line.match(/POSITION node=\S+ l=\d+ lat=(-?\d+) lon=(-?\d+) msl=(-?\d+).*siv=(\d+)/);
    if (m) {
      s.localLat = Number(m[1]);
      s.localLon = Number(m[2]);
      s.localAlt = Number(m[3]);
      s.gpsSiv = Number(m[4]);
    }
  },

  // I²C devices: "QMA6100P found at address 0x12"
  (line, s) => {
    const m = line.match(/(\w+) found at address (0x[0-9a-fA-F]+)/);
    if (m) {
      const entry = `${m[1]} @ ${m[2]}`;
      if (!s.i2cDevices.includes(entry)) s.i2cDevices.push(entry);
    }
  },

  // acc_info / mag_info chip IDs
  (line, s) => {
    const ma = line.match(/acc_info = (\d+)/);
    if (ma) {
      s.accelChipId = Number(ma[1]); return;
    }
    const mm = line.match(/mag_info = (\d+)/);
    if (mm) s.magChipId = Number(mm[1]);
  },

  // Battery: "usbPower=1, isCharging=1, batMv=4186, batPct=99"
  (line, s) => {
    const m = line.match(/usbPower=(\d+), isCharging=(\d+), batMv=(\d+), batPct=(\d+)/);
    if (m) {
      s.usbPower = m[1] === '1';
      s.isCharging = m[2] === '1';
      s.batteryMv = m[3];
      s.batteryPct = m[4];
    }
  },

  // "Use analog input 35 for battery level"
  (line, s) => {
    const m = line.match(/Use analog input (\d+) for battery level/);
    if (m && s.batteryAdcPin === undefined) s.batteryAdcPin = Number(m[1]);
  },

  // Heap memory
  (line, s) => {
    let m = line.match(/Total heap: (\d+)/);
    if (m) {
      s.heapTotal = Number(m[1]); return;
    }
    m = line.match(/Free heap\s*[:\s]+(\d+)/i);
    if (m) s.heapFree = Number(m[1]);
  },

  // PSRAM
  (line, s) => {
    let m = line.match(/Total PSRAM: (\d+)/);
    if (m) {
      s.psramTotal = Number(m[1]); return;
    }
    m = line.match(/Free PSRAM\s*[:\s]+(\d+)/i);
    if (m) s.psramFree = Number(m[1]);
  },

  // NVS: "NVS: UsedEntries 42, FreeEntries 490, AllEntries 532"
  (line, s) => {
    const m = line.match(/NVS: UsedEntries (\d+), FreeEntries (\d+), AllEntries (\d+)/);
    if (m) {
      s.nvsUsed = Number(m[1]);
      s.nvsFree = Number(m[2]);
      s.nvsTotal = Number(m[3]);
    }
  },

  // Filesystem: "Filesystem files (245760/2097152 Bytes)"
  (line, s) => {
    const m = line.match(/Filesystem files \((\d+)\/(\d+) Bytes\)/);
    if (m) {
      s.fsUsed = Number(m[1]); s.fsTotal = Number(m[2]);
    }
  },

  // NodeDB v25 extended: "Loaded saved nodedatabase v25: 87 nodes, 54 pos, 23 tel, 2 env, 87 status"
  // Also matches older: "Loaded saved nodedatabase v25: 87 nodes"
  (line, s) => {
    const m = line.match(
        /Loaded saved nodedatabase v(\d+): (\d+) nodes(?:, (\d+) pos, (\d+) tel, (\d+) env, (\d+) status)?/
    );
    if (m) {
      s.nodeDbVersion = Number(m[1]);
      s.nodeDbCount = Number(m[2]);
      if (m[3] !== undefined) {
        s.nodeDbPosCount = Number(m[3]);
        s.nodeDbTelCount = Number(m[4]);
        s.nodeDbEnvCount = Number(m[5]);
        s.nodeDbStatusCount = Number(m[6]);
      }
      return;
    }
    // Older format: "Loaded saved nodedatabase version N, with nodes count: N"
    const m2 = line.match(/Loaded saved nodedatabase version (\d+), with nodes count: (\d+)/);
    if (m2) {
      s.nodeDbVersion = Number(m2[1]); s.nodeDbCount = Number(m2[2]);
    }
  },

  // "NodeDatabase N is old, discard"
  (line, s) => {
    if (/NodeDatabase \d+ is old, discard/.test(line)) s.nodeDbDiscardedOldVersion = true;
  },

  // "Node database full with N nodes, dropping oldest"
  (line, s) => {
    if (/Node database full with/.test(line)) s.nodeDbFullEvictions++;
  },

  // Noise floor: "Noise floor: -93 dBm"
  (line, s) => {
    const m = line.match(/Noise floor: (-?\d+) dBm/);
    if (m) s.noiseFloor = `${m[1]} dBm`;
  },

  // Noise floor from local stats: "Sending local stats: ... noise_floor=-93"
  (line, s) => {
    const m = line.match(/[Ss]ending local stats:.*noise_floor=(-?\d+)/);
    if (m) {
      s.noiseFloor = `${m[1]} dBm`;
    }
  },

  // Noise floor with sample count: "Noise floor: -93 dBm (samples: 42)"
  (line, s) => {
    const m = line.match(/Noise floor: (-?\d+) dBm \(samples: (\d+)/);
    if (m) {
      s.noiseFloor = `${m[1]} dBm`;
      s.noiseFloorSamples = Number(m[2]);
    }
  },

  // "Number of Device Reboots: 46"
  (line, s) => {
    const m = line.match(/Number of Device Reboots: (\d+)/);
    if (m) s.rebootCount = Number(m[1]);
  },

  // NRF52 wake cause: "Booted, wake cause 2 (boot count 46), reset_reason=intWatchdog"
  (line, s) => {
    const m = line.match(/Booted, wake cause (\d+) \(boot count (\d+)\), reset_reason=(\w+)/);
    if (m) {
      s.wakeSource = Number(m[1]);
      s.bootCount = Number(m[2]);
      s.resetReason = m[3];
      if (m[3] === 'intWatchdog') s.watchdogReset = true;
    }
  },

  // ESP32 bootloader crash: "rst:0x8 (TG1WDT_SYS_RST),boot:0x12 ..."
  (line, s) => {
    const m = line.match(/^rst:(0x[\da-fA-F]+) \((\w+)\)/);
    if (m && (m[2].includes('WDT') || m[2].includes('PANIC'))) {
      s.watchdogReset = true;
      s.espRstCode = m[2];
    }
  },

  // "reset_reason=intWatchdog" (NRF52 standalone line)
  (line, s) => {
    if (/reset_reason=intWatchdog/.test(line) && !s.resetReason) s.watchdogReset = true;
  },

  // [RadioIf] Lora RX … rxSNR=N rxRSSI=N
  (line, s) => {
    const m = line.match(/\[RadioIf\].*rxSNR=([-\d.]+) rxRSSI=([-\d]+)/);
    if (m) {
      s.lastSnr = m[1]; s.lastRssi = m[2];
    }
  },

  // [RadioIf] Corrected frequency offset: N
  (line, s) => {
    const m = line.match(/\[RadioIf\].*Corrected frequency offset: ([-\d.]+)/);
    if (m) s.freqOffset = m[1];
  },

  // txGood=N,txRelay=N,rxGood=N,rxBad=N
  (line, s) => {
    const m = line.match(/txGood=(\d+),txRelay=(\d+),rxGood=(\d+),rxBad=(\d+)/);
    if (m) {
      s.txGood = Number(m[1]); s.txRelay = Number(m[2]);
      s.rxGood = Number(m[3]); s.rxBad = Number(m[4]);
    }
  },

  // "No radio instance available to provide entropy"
  (line, s) => {
    if (/No radio instance available to provide entropy/.test(line)) s.noHwRng = true;
  },

  // Count boot-phase ERROR lines (uptime ≤ 5s), excluding known-normal non-errors
  (line, s) => {
    if (/No radio instance available to provide entropy/.test(line)) return;
    const m = line.match(/^ERROR\s+\|\s+\S+\s+(\d+)\s/);
    if (m && Number(m[1]) <= 5) s.bootErrors++;
  },

  // [GPS] Publish pos@…, Sats=N, GPSlock=N
  (line, s) => {
    const m = line.match(/\[GPS\].*Sats=(\d+), GPSlock=(\d+)/);
    if (m) {
      s.gpsSats = Number(m[1]); s.gpsLock = m[2] === '1';
    }
  },

  // [DeviceTelemetry] air_util_tx + channel_utilization + optional uptime
  (line, s) => {
    const m = line.match(/\[DeviceTelemetry\].*air_util_tx=([\d.]+), channel_utilization=([\d.]+)/);
    if (!m) return;
    s.airUtilTx = Number(m[1]).toFixed(2);
    s.channelUtil = Number(m[2]).toFixed(2);
    const mu = line.match(/uptime=(\d+)/);
    if (mu) s.uptime = Number(mu[1]);
  },

  // num_packets_tx / num_packets_rx / num_packets_rx_bad
  (line, s) => {
    const m = line.match(/num_packets_tx=(\d+), num_packets_rx=(\d+), num_packets_rx_bad=(\d+)/);
    if (!m) return;
    const tx = Number(m[1]);
    const rx = Number(m[2]);
    const rxBad = Number(m[3]);
    // Sanity check: if counts are absurdly large at low uptime, flag as corrupted
    if (s.uptime !== undefined && s.uptime < 300 && tx > 100_000) {
      s.packetCounterCorrupted = true;
    } else {
      s.numPacketsTx = tx;
      s.numPacketsRx = rx;
      s.numPacketsRxBad = rxBad;
    }
  },

  // num_online_nodes / num_total_nodes
  (line, s) => {
    const m = line.match(/num_online_nodes=(\d+), num_total_nodes=(\d+)/);
    if (m) {
      s.numOnlineNodes = Number(m[1]); s.numTotalNodes = Number(m[2]);
    }
  },

  // WarmStore: "replayed N ring records -> M live nodes"
  (line, s) => {
    const m = line.match(/WarmStore: replayed \d+ ring records -> (\d+) live nodes/);
    if (m) s.warmstoreLiveNodes = s.warmstoreLiveNodes ?? Number(m[1]);
  },

  // [HopScaling] hop=N fill=N% polite=N/N nextRoll=N
  (line, s) => {
    const m = line.match(/\[HopScaling\].*hop=(\d+).*fill=(\d+%).*polite=(\d+\/\d+).*nextRoll=(\S+)/);
    if (m) {
      s.hopLimit = Number(m[1]); s.hopFill = m[2];
      s.hopPolite = m[3]; s.hopNextRoll = m[4];
    }
  },

  // [HopScaling] nodes perHop: [N …]
  (line, s) => {
    const m = line.match(/\[HopScaling\].*nodes perHop: \[([^\]]+)\]/);
    if (m) s.hopPerHop = m[1].trim().split(/\s+/).map(Number);
  },

  // [HopScaling] last scaled perHop: [N …]
  (line, s) => {
    const m = line.match(/\[HopScaling\].*last scaled perHop: \[([^\]]+)\]/);
    if (m) s.hopScaledPerHop = m[1].trim().split(/\s+/).map(Number);
  },

  // [HopScaling] scaledSeenPerHour (h0=now): [N …]
  (line, s) => {
    const m = line.match(/\[HopScaling\].*scaledSeenPerHour \(h0=now\): \[([^\]]+)\]/);
    if (m) s.hopSeenPerHour = m[1].trim().split(/\s+/).map(Number);
  },

  // "PowerFSM init, USB power=N"
  (line, s) => {
    const m = line.match(/PowerFSM init, USB power=(\d)/);
    if (m && s.usbPower === undefined) s.usbPower = m[1] === '1';
  },

  // ── BLE ────────────────────────────────────────────────────────────────────

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

  // "BLE Connected to iPhone" — Bluefruit/NRF52 devices log this instead of "BLE incoming connection"
  (line, s) => {
    const m = line.match(/BLE Connected to (.+)/);
    if (!m) return;
    s.bleConnectedTo = m[1].trim();
    s.bleConnections++; // Bluefruit uses this line; NimBLE uses "BLE incoming connection" instead
  },

  // "NIMBLE_NVS: NVS data size mismatch"
  (line, s) => {
    if (/NIMBLE_NVS/.test(line)) s.bleNvsErrors++;
  },

  // "handleGATTServerEvent(): Connection failed"
  (line, s) => {
    if (/handleGATTServerEvent\(\).*Connection failed/.test(line)) s.bleGattFailures++;
  },

  // ── MQTT ───────────────────────────────────────────────────────────────────

  (line, s) => {
    if (/MQTT configured to use client proxy/.test(line)) {
      s.mqttProxyMode = true; return;
    }
    if (/Connecting to MQTT server/.test(line)) {
      s.mqttState = 'connecting'; return;
    }
    if (/MQTT connected/.test(line)) {
      s.mqttState = 'connected'; return;
    }
    if (/MQTT.*connection lost|MQTT.*disconnected/i.test(line)) {
      s.mqttState = 'disconnected'; return;
    }
    if (/Failed to connect to MQTT|MQTT.*connect.*fail/i.test(line)) {
      s.mqttState = 'failed'; s.mqttErrors++;
    }
  },

  // ── Event / error counters ────────────────────────────────────────────────

  // "[RadioIf] Can not send yet, busyRx"
  (line, s) => {
    if (/Can not send yet, busyRx/.test(line)) s.busyRxCount++;
  },

  // "DutyCycle limit" / "Duty cycle limit"
  (line, s) => {
    if (/[Dd]uty.?[Cc]ycle limit/.test(line)) s.dutyCycleHits++;
  },

  // "Error=N, return NAK" / "Alloc an err=N,to=…"
  (line, s) => {
    let m = line.match(/Error=(\d+),\s*return NAK/);
    if (!m) m = line.match(/Alloc an err=(\d+)/);
    if (m) s.nakErrors[m[1]] = (s.nakErrors[m[1]] ?? 0) + 1;
  },

  // "No suitable channel found for decoding"
  (line, s) => {
    if (/No suitable channel found for decoding/.test(line)) s.channelDecodeFailures++;
  },

  // "advertised your public key" — security warning
  (line, s) => {
    if (/advertised your public key/.test(line)) s.securityWarning = true;
  },

  // "RTC not found"
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

  // Radio probe failures: "No RF95 radio"
  (line, s) => {
    const m = line.match(/No (\S+) radio/);
    if (m && !s.radioProbeFailures.includes(m[1])) s.radioProbeFailures.push(m[1]);
  },

  // "[Router] Error: can't encode protobuf invalid utf8"
  (line, s) => {
    if (/Error: can.t encode protobuf invalid utf8/.test(line)) s.protoEncodeErrors++;
  },

  // "[RadioIf] Ignore received packet due to error=N"
  (line, s) => {
    if (/\[RadioIf\] Ignore received packet due to error=/.test(line)) s.radioRxErrors++;
  },

  // "send - lora tx disabled: Region unset"
  (line, s) => {
    if (/send - lora tx disabled: Region unset/i.test(line)) s.txRegionUnsetBlocked++;
  },

  // "[Router] Reliable send failed"
  (line, s) => {
    if (/Reliable send failed/.test(line)) s.reliableSendFailures++;
  },

  // "Drop packet (pre-hop drop): hop_start invalid/missing"
  (line, s) => {
    if (/pre-hop drop.*hop_start/.test(line) || /hop_start invalid.*missing/.test(line)) {
      s.preHopDropMissingHopStart++;
    }
  },

  // "tophone queue status queue is full"
  (line, s) => {
    if (/tophone queue.*full/i.test(line)) s.tophoneQueueFull++;
  },

  // "Invalid channel index N"
  (line, s) => {
    if (/Invalid channel index/.test(line)) s.invalidChannelIndexErrors++;
  },

  // "Rate limit portnum N"
  (line, s) => {
    if (/Rate limit portnum/.test(line)) s.telemetryRateLimited++;
  },

  // MeshBeacon text: "Beacon: split-B TEXT_MESSAGE_APP msg='…' from=0x…"
  (line, s) => {
    const m = line.match(/\[MeshBeaconBroadcast\] Beacon: split-B TEXT_MESSAGE_APP msg='([^']+)' from=(0x[\da-fA-F]+)/);
    if (m) {
      s.lastBeaconMsg = m[1]; s.lastBeaconFrom = m[2];
    }
  },

  // ServerAPI text message: "[ServerAPI] Received text msg from=0x0, id=0x…, msg=hello"
  (line, s) => {
    const m = line.match(/\[ServerAPI\] Received text msg from=(0x[\da-fA-F]+), id=0x[\da-fA-F]+, msg=(.+)/);
    if (m) {
      s.lastMessageFrom = m[1]; s.lastMessage = m[2].trim();
    }
  },

  // Fallback text message patterns (older firmware variants)
  (line, s) => {
    if (s.lastMessage) return; // already captured above
    const m1 = line.match(/[Rr]eceived text.*?from (0x[\da-fA-F]+)[,:]?\s*(.+)/);
    if (m1) {
      s.lastMessageFrom = m1[1]; s.lastMessage = m1[2].trim(); return;
    }
    const m2 = line.match(/\btext=([^,\n]+).*\bfrom=?(0x[\da-fA-F]+)/);
    if (m2) {
      s.lastMessage = m2[1].trim(); s.lastMessageFrom = m2[2];
    }
  },
];

export function updateSummary(line: string, summary: DeviceSummary): void {
  for (const matcher of MATCHERS) {
    matcher(line, summary);
  }
}

export function updateSummaryCumulative(line: string, s: DeviceSummary): void {
  applyBootLine(line, s, false);
  for (const matcher of MATCHERS.slice(1)) {
    matcher(line, s);
  }
}

// ── Rendering helpers ──────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtCoord(raw: number): string {
  return (raw / 1e7).toFixed(5) + '°';
}

export function renderSummary(s: DeviceSummary): string {
  const hasNak = Object.keys(s.nakErrors).length > 0;
  const hasEvents = !!(
    s.securityWarning || s.watchdogReset || s.sslErrors > 0 || hasNak ||
    s.busyRxCount > 5 || s.channelDecodeFailures > 0 || s.powerLossEvents > 0 ||
    s.dutyCycleHits > 0 || s.bleNvsErrors > 0 || s.bleGattFailures > 0 ||
    s.protoEncodeErrors > 0 || s.radioRxErrors > 0 || s.txRegionUnsetBlocked > 0 ||
    s.reliableSendFailures > 0 || s.preHopDropMissingHopStart > 0 ||
    s.tophoneQueueFull > 0 || s.invalidChannelIndexErrors > 0 ||
    s.telemetryRateLimited > 0 || s.nodeDbFullEvictions > 0 ||
    s.nodeDbDiscardedOldVersion || s.configVersionMismatch ||
    s.codingRateOverride || s.packetCounterCorrupted
  );
  if (!s.hardware && !s.firmware && !s.radioType && !hasEvents) return '';

  const rows: Array<[string, string, string?]> = [];

  if (s.nodeName) rows.push(['Name', s.nodeName]);
  if (s.nodeId) rows.push(['Node ID', `<code>${s.nodeId}</code>`]);

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
    if (s.radioFem) parts.push(`FEM:${s.radioFem}`);
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

  if (s.freqSlots || s.loraBitrate || s.slotTimeMs) {
    const parts: string[] = [];
    if (s.freqSlots) parts.push(`${s.freqSlots} slots × ${s.slotBw ?? '?'}kHz`);
    if (s.loraBitrate) parts.push(s.loraBitrate);
    if (s.slotTimeMs) parts.push(`slot ${s.slotTimeMs}ms`);
    rows.push(['LoRa timing', parts.join(' · ')]);
  }

  if (s.gps) rows.push(['GPS', s.gps]);

  if (s.localLat !== undefined && s.localLon !== undefined) {
    const lat = fmtCoord(s.localLat);
    const lon = fmtCoord(s.localLon);
    const alt = s.localAlt !== undefined ? ` · ${Math.round(s.localAlt / 1000)}m alt` : '';
    const siv = s.gpsSiv !== undefined ? ` · ${s.gpsSiv} sats` : '';
    rows.push(['Position', `${lat}, ${lon}${alt}${siv}`,
      'Last known position from GPS (lat/lon in millionths of degree × 10)']);
  }

  if (s.i2cDevices.length || s.accelChipId !== undefined || s.magChipId !== undefined) {
    const parts: string[] = [...s.i2cDevices];
    if (s.accelChipId !== undefined) parts.push(`acc_id=${s.accelChipId}`);
    if (s.magChipId !== undefined) parts.push(`mag_id=${s.magChipId}`);
    rows.push(['I²C', parts.join(', ')]);
  }

  if (s.batteryPct !== undefined) {
    const mv = s.batteryMv ? ` · ${(Number(s.batteryMv) / 1000).toFixed(2)} V` : '';
    const usb = s.usbPower ? ' · USB' : '';
    const chg = s.isCharging ? ' · charging' : '';
    const adc = s.batteryAdcPin !== undefined ? ` · ADC pin ${s.batteryAdcPin}` : '';
    rows.push(['Battery', `${s.batteryPct}%${mv}${usb}${chg}${adc}`]);
  }

  // Memory / storage section
  const hasMemory = s.heapTotal !== undefined || s.heapFree !== undefined ||
    s.psramTotal !== undefined || s.nvsUsed !== undefined || s.fsUsed !== undefined;
  if (hasMemory) {
    rows.push(['', '', undefined]); // spacer via divider approach below — see end of grid
  }

  if (s.noiseFloor) {
    const samples = s.noiseFloorSamples !== undefined ? ` (${s.noiseFloorSamples} samples)` : '';
    rows.push(['Noise floor', s.noiseFloor + samples, 'Ambient RSSI noise floor in dBm']);
  }
  if (s.rebootCount !== undefined) {
    rows.push(['Reboots', String(s.rebootCount)]);
  }
  if (s.bootErrors > 0) {
    rows.push(['Boot errors', `<span class="sum-warn">${s.bootErrors}</span>`,
      'Hardware initialization failures at startup']);
  }

  // ── Memory section ──────────────────────────────────────────────────────────
  const memRows: Array<[string, string, string?]> = [];

  if (s.heapTotal !== undefined || s.heapFree !== undefined) {
    const total = s.heapTotal !== undefined ? fmtBytes(s.heapTotal) : '?';
    const free = s.heapFree !== undefined ? fmtBytes(s.heapFree) : '?';
    const pct = (s.heapTotal && s.heapFree) ?
      Math.round((s.heapFree / s.heapTotal) * 100) : undefined;
    const warn = pct !== undefined && pct < 20 ? ' <span class="sum-warn">low</span>' : '';
    const pctStr = pct !== undefined ? ` (${pct}% free)` : '';
    memRows.push(['Heap', `${free} free / ${total}${pctStr}${warn}`]);
  }
  if (s.psramTotal !== undefined || s.psramFree !== undefined) {
    const total = s.psramTotal !== undefined ? fmtBytes(s.psramTotal) : '?';
    const free = s.psramFree !== undefined ? fmtBytes(s.psramFree) : '?';
    memRows.push(['PSRAM', `${free} free / ${total}`]);
  }
  if (s.nvsUsed !== undefined && s.nvsTotal !== undefined) {
    const pct = Math.round((s.nvsUsed / s.nvsTotal) * 100);
    const warn = pct > 90 ? ' <span class="sum-warn">nearly full</span>' : '';
    memRows.push(['NVS', `${s.nvsUsed}/${s.nvsTotal} entries (${pct}% used)${warn}`]);
  }
  if (s.fsUsed !== undefined && s.fsTotal !== undefined) {
    const pct = Math.round((s.fsUsed / s.fsTotal) * 100);
    const warn = pct > 90 ? ' <span class="sum-warn">nearly full</span>' : '';
    memRows.push(['Filesystem', `${fmtBytes(s.fsUsed)} / ${fmtBytes(s.fsTotal)} (${pct}%)${warn}`]);
  }
  if (s.nodeDbCount !== undefined) {
    const parts: string[] = [`${s.nodeDbCount} nodes`];
    if (s.nodeDbPosCount !== undefined) parts.push(`${s.nodeDbPosCount} pos`);
    if (s.nodeDbTelCount !== undefined) parts.push(`${s.nodeDbTelCount} tel`);
    const ver = s.nodeDbVersion !== undefined ? ` v${s.nodeDbVersion}` : '';
    memRows.push(['NodeDB', parts.join(', ') + ver]);
  }

  // ── Module status ────────────────────────────────────────────────────────────
  const modRows: Array<[string, string, string?]> = [];

  if (s.uptime !== undefined) {
    modRows.push(['Uptime', fmtUptime(s.uptime)]);
  }

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

  if (s.warmstoreLiveNodes !== undefined) {
    modRows.push(['WarmStore', `${s.warmstoreLiveNodes} live nodes`]);
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
    modRows.push(['RX/TX',
      `TX ${s.txGood} (+${s.txRelay} relay) · RX ${s.rxGood}${bad}`]);
  }

  if (s.numPacketsTx !== undefined) {
    const bad = s.numPacketsRxBad ? ` · <span class="sum-warn">${s.numPacketsRxBad} RX bad</span>` : '';
    modRows.push(['Pkts (TM)', `TX ${s.numPacketsTx} · RX ${s.numPacketsRx}${bad}`,
      'Cumulative packet counters from DeviceTelemetry (all-time)']);
  }

  if (s.bleConnections > 0 || s.bleConnectedTo) {
    const disc = s.bleDisconnections > 0 ? ` · ${s.bleDisconnections} disconn` : '';
    const peer = s.bleConnectedTo ? ` peer: ${s.bleConnectedTo}` : '';
    const count = s.bleConnections;
    const sessions = count > 0 ?
      `${count} session${count !== 1 ? 's' : ''}${disc}` :
      '';
    modRows.push(['BLE', (sessions + (sessions && peer ? ' ·' : '') + peer).trim()]);
  }

  if (s.mqttProxyMode || s.mqttState) {
    const mode = s.mqttProxyMode ? 'proxy ' : '';
    const state = s.mqttState ?? '';
    const errs = s.mqttErrors > 0 ? ` <span class="sum-warn">×${s.mqttErrors} failed</span>` : '';
    modRows.push(['MQTT', `${mode}${state}${errs}`.trim()]);
  }

  if (s.lastBeaconMsg) {
    const from = s.lastBeaconFrom ? ` <span style="color:var(--muted)">from ${s.lastBeaconFrom}</span>` : '';
    modRows.push(['Beacon', `'${s.lastBeaconMsg}'` + from,
      'Beacon TEXT_MESSAGE_APP payload from MeshBeaconBroadcast (split-B)']);
  }

  if (s.lastMessage) {
    const from = s.lastMessageFrom ? ` <span style="color:var(--muted)">from ${s.lastMessageFrom}</span>` : '';
    modRows.push(['Last msg', s.lastMessage + from,
      'Last decryptable text message received in this log session']);
  }

  // ── Events / errors ──────────────────────────────────────────────────────────
  const evtRows: Array<[string, string, string?]> = [];

  if (s.securityWarning) {
    evtRows.push(['Security', '<span class="sum-err">⚠ key advertised by remote — regenerate keys</span>',
      'A remote node is advertising your network key — regenerate keys immediately']);
  }
  if (s.watchdogReset) {
    const detail = s.espRstCode ? ` (${s.espRstCode})` : s.resetReason === 'intWatchdog' ? ' (NRF52 intWatchdog)' : '';
    evtRows.push(['Reset', `<span class="sum-err">watchdog reset${detail}</span>`,
      'Firmware crash triggered a hardware watchdog reset']);
  }
  if (s.wakeSource !== undefined && s.wakeSource !== 0 && !s.watchdogReset) {
    evtRows.push(['Wake cause', String(s.wakeSource),
      `NRF52 wake-from-sleep source code (boot count: ${s.bootCount ?? '?'})`]);
  }
  if (s.sslErrors > 0) {
    evtRows.push(['SSL',
      `<span class="sum-err">${s.sslErrors} cert error${s.sslErrors !== 1 ? 's' : ''} — check certificate files</span>`,
      'TLS certificate validation failed — check that cert/key files are valid and not expired']);
  }
  if (hasNak) {
    const parts = Object.entries(s.nakErrors).map(([code, count]) => {
      const name = NAK_ERROR_NAMES[Number(code)] ?? `err${code}`;
      return `${name} ×${count}`;
    }).join(' · ');
    evtRows.push(['NAK drops', `<span class="sum-warn">${parts}</span>`,
      'Packets rejected by the router — see Routing.Error enum in mesh.proto']);
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
      'EU LoRa duty cycle limit hit — TX blocked to stay within the legal airtime cap']);
  }
  if (s.txRegionUnsetBlocked > 0) {
    evtRows.push(['Region UNSET',
      `<span class="sum-warn">×${s.txRegionUnsetBlocked} TX blocked — region not set</span>`,
      'TX blocked because the LoRa region is not configured']);
  }
  if (s.protoEncodeErrors > 0) {
    evtRows.push(['Proto error',
      `<span class="sum-warn">×${s.protoEncodeErrors} invalid UTF-8 in protobuf encode</span>`,
      'Malformed UTF-8 caused protobuf serialisation to fail — check node name / message content']);
  }
  if (s.radioRxErrors > 0) {
    evtRows.push(['RX errors',
      `<span class="sum-warn">×${s.radioRxErrors} RadioIf packets ignored (error)</span>`,
      'RadioIf discarded received packets due to an internal error code']);
  }
  if (s.reliableSendFailures > 0) {
    evtRows.push(['Send fail',
      `<span class="sum-warn">×${s.reliableSendFailures} reliable send failed (NAK returned)</span>`,
      'Reliable (ack-required) send failed after all retransmissions']);
  }
  if (s.preHopDropMissingHopStart > 0) {
    evtRows.push(['Pre-hop drop',
      `<span class="sum-warn">×${s.preHopDropMissingHopStart} dropped (hop_start missing)</span>`,
      'Packets dropped pre-hop because hop_start was invalid/missing (possible firmware version mismatch)']);
  }
  if (s.tophoneQueueFull > 0) {
    evtRows.push(['To-phone Q',
      `<span class="sum-warn">×${s.tophoneQueueFull} queue full — packets dropped</span>`,
      'Packet queue to the connected phone app overflowed']);
  }
  if (s.invalidChannelIndexErrors > 0) {
    evtRows.push(['Chan index',
      `<span class="sum-warn">×${s.invalidChannelIndexErrors} invalid channel index</span>`,
      'Router encountered a packet with an out-of-range channel index']);
  }
  if (s.channelDecodeFailures > 0) {
    evtRows.push(['Decode fail',
      `<span class="sum-warn">×${s.channelDecodeFailures} (unknown channel hash)</span>`,
      'Received packets whose channel hash did not match any known channel — likely mismatched channel key']);
  }
  if (s.telemetryRateLimited > 0) {
    evtRows.push(['Rate limit',
      `×${s.telemetryRateLimited} telemetry portnum rate-limited`,
      'DeviceTelemetry was rate-limited before being forwarded']);
  }
  if (s.nodeDbFullEvictions > 0) {
    evtRows.push(['NodeDB full',
      `<span class="sum-warn">×${s.nodeDbFullEvictions} eviction${s.nodeDbFullEvictions !== 1 ? 's' : ''}</span>`,
      'NodeDB was full — oldest node evicted to make room']);
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
  if (s.nodeDbDiscardedOldVersion) {
    evtRows.push(['NodeDB', 'old format discarded — clean rebuild',
      'NodeDB was an unsupported old version and was discarded; it will be rebuilt from beacon packets']);
  }
  if (s.configVersionMismatch) {
    evtRows.push(['Config ver', '<span class="sum-warn">version mismatch — migration applied</span>',
      'Loaded config with a different schema version; config was migrated automatically']);
  }
  if (s.codingRateOverride) {
    evtRows.push(['Coding rate', 'default CR higher than custom setting — override applied',
      'The preset\'s default coding rate was larger than the custom override; custom setting used']);
  }
  if (s.packetCounterCorrupted) {
    evtRows.push(['Pkt counter', '<span class="sum-warn">counters look corrupted (huge at low uptime)</span>',
      'Packet counters were unrealistically large for the observed uptime — counter wrap or flash corruption']);
  }
  if (s.noHwRng) {
    evtRows.push(['Entropy', 'SW RNG (no hardware radio entropy source)',
      'No hardware random number generator found — using software entropy (lower security)']);
  }
  if (s.rtcMissing) {
    evtRows.push(['RTC', 'not detected',
      'Real-time clock not detected — timestamps may be inaccurate until GPS or NTP sync']);
  }
  if (s.radioProbeFailures.length && !s.radioType) {
    evtRows.push(['Radio probe', `failed: ${s.radioProbeFailures.join(', ')}`,
      'Radio chip detection failed — check hardware connections and solder joints']);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const img = s.deviceImage ?
    `<img class="device-img" src="/img/devices/${s.deviceImage}" alt="${hwLabel}">` : '';

  function renderRow([label, value, tooltip]: [string, string, string?]): string {
    if (!label && !value) return ''; // skip spacer rows
    const tt = tooltip ? ` data-tooltip="${tooltip.replace(/"/g, '&quot;')}"` : '';
    return `<div class="sum-row"${tt}><span class="sum-label">${label}</span>` +
      `<span class="sum-value">${value}</span></div>`;
  }

  const memDivider = memRows.length ? '<div class="sum-divider">MEMORY</div>' : '';
  const modDivider = modRows.length ? '<div class="sum-divider">MODULE STATUS</div>' : '';
  const evtDivider = evtRows.length ? '<div class="sum-divider sum-divider-err">EVENTS</div>' : '';

  // Remove the spacer row we added earlier (it was a placeholder for the divider)
  const filteredRows = rows.filter(([l, v]) => l !== '' || v !== '');

  const grid = '<div class="sum-grid">' +
    filteredRows.map(renderRow).join('') +
    memDivider + memRows.map(renderRow).join('') +
    modDivider + modRows.map(renderRow).join('') +
    evtDivider + evtRows.map(renderRow).join('') +
    '</div>';

  return img + grid;
}

// ── Hop scaling charts ──────────────────────────────────────────────────────────

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
  const W = 290;
  const H = 110;
  const pL = 22; const pB = 22; const pT = 8; const pR = 6;
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
      const bFill = `fill="#67EA94" opacity="0.85" rx="1"`;
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${bH.toFixed(1)}" ${bFill}/>`);
    }
    if (sH > 0) {
      const ry = (pT + cH - bH - sH).toFixed(1);
      const sFill = `fill="#a78bfa" opacity="0.75" rx="1"`;
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${sH.toFixed(1)}" ${sFill}/>`);
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
  const W = 290;
  const H = 110;
  const pL = 22; const pB = 22; const pT = 8; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const pts = [...data].reverse();
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
    const cx = coords[i].x.toFixed(1);
    parts.push(`<text x="${cx}" y="${ly}" text-anchor="middle" font-size="8" fill="#6b7280">${label}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  return `<div class="hc-section"><div class="hc-label">Scaled seen / hour</div>${svg}</div>`;
}
