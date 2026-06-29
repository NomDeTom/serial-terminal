import {DeviceSummary, emptySummary} from './deviceSummary';
import {lookupDevice, lookupDeviceByModel} from './deviceInfo';
import {feedMultiLine} from './multiLineMatch';

// The channel *index* (0-7) is printed on "decoded message" lines. printPacket()
// historically renders it as hex with a redundant prefix ("Ch=0x0%x" → "Ch=0x5");
// a proposed firmware change prints it as a plain decimal ("Ch=5"). Identify the
// value from its local context — a leading 0x means hex, bare digits mean decimal —
// so either format parses to the same number. (The channel *hash* on Lora RX /
// "Completed sending" lines is a separate field and stays hex.)
function parseChannelIndex(raw: string): number {
  return /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
}

// Append an online/total node-count sample, skipping consecutive duplicates and
// capping the history so a long session can't grow it without bound.
function recordNodeCount(s: DeviceSummary, online: number, total: number): void {
  const last = s.nodeCountHistory[s.nodeCountHistory.length - 1];
  if (last && last.online === online && last.total === total) return;
  s.nodeCountHistory.push({online, total});
  if (s.nodeCountHistory.length > 500) s.nodeCountHistory.shift();
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
    if (Number(m[2]) === 0) {
      s.radioType = s.radioType ?? m[1];
      s.radioInitSucceeded = true;
    }
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
    if (/LR2021 init success/.test(line)) {
      s.radioType = 'LR2021';
      s.radioInitSucceeded = true;
    }
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
      s.radioInitSucceeded = true;
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
      recordNodeCount(s, s.numOnlineNodes, s.numTotalNodes);
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

  // NAK (Routing.Error) codes. Two firmware LOG strings carry the numeric code:
  //   "Error=%d, return NAK and drop packet" — Router.cpp abortSendAndNak()
  //   "Alloc an err=%d,to=…"                  — MeshModule.cpp allocAckNak()
  // Code → name/meaning live in routingError.ts (see mesh.pb.h _meshtastic_Routing_Error).
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

  // ── Persistence / lifecycle faults ────────────────────────────────────────

  // LittleFS inconsistency: "lfs debug:2510: Found orphan 21 20"
  (line, s) => {
    if (/lfs .*Found orphan/i.test(line)) s.fsOrphan = true;
  },

  // "Generate new PKI keys" — node identity/keys regenerated
  (line, s) => {
    if (/Generate new PKI keys/.test(line)) s.pkiKeysRegenerated = true;
  },

  // "Perform factory reset!" / "Initiate full factory reset"
  (line, s) => {
    if (/Perform factory reset|Initiate full factory reset/.test(line)) s.factoryReset = true;
  },

  // Invalid LoRa config from client: "Invalid coding_rate 0", "Invalid spread_factor 0",
  // "Preset NarrowSlow invalid for UNSET", "Invalid LoRa config received from client"
  (line, s) => {
    if (/Invalid coding_rate|Invalid spread_factor|Preset \w+ invalid for|Invalid LoRa config received/
        .test(line)) {
      s.invalidLoraConfig = true;
    }
  },

  // Persistence-critical prefs failed to load: "Could not open / read /prefs/config.proto".
  // Only config/nodes are persistence-critical; uiconfig/ringtone/cannedConf are optional.
  (line, s) => {
    const m = line.match(/Could not open \/ read \/prefs\/(config|nodes)\.proto/);
    if (m) {
      const f = `${m[1]}.proto`;
      if (!s.missingCriticalPrefs.includes(f)) s.missingCriticalPrefs.push(f);
    }
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

  // ── Crash / fault detection (#94–#102) ────────────────────────────────────

  // ESP-IDF task watchdog: trigger line + follow-up naming the starved task
  (line, s) => {
    if (/task_wdt: Task watchdog got triggered/.test(line)) {
      s.taskWatchdogTriggered = true;
      return;
    }
    const m = line.match(/task_wdt:\s+-\s+(\S+) \(CPU \d+\)/);
    if (m) s.watchdogTask = s.watchdogTask ?? m[1];
  },

  // ESP32 panic backtrace
  (line, s) => {
    const m = line.match(/^Backtrace:\s+(0x[0-9a-fA-F]+)/);
    if (m) {
      s.espPanicBacktrace = true;
      s.panicPc = s.panicPc ?? m[1];
    }
  },

  // "[RadioIf] assert failed src/mesh/X.cpp:N"
  (line, s) => {
    const m = line.match(/\[RadioIf\] assert failed (src\/\S+):\s*(\d+)/);
    if (!m) return;
    s.radioAssertFailed = true;
    const loc = `${m[1]}:${m[2]}`;
    if (!s.assertLocations.includes(loc)) s.assertLocations.push(loc);
  },

  // CriticalErrorCode — emitted by recordCriticalError() (NodeDB.cpp) via RECORD_CRITICALERROR macro:
  //   NodeDB.cpp:3811  LOG_ERROR("NOTE! Record critical error %d at %s:%lu", code, filename, address)
  //   NodeDB.cpp:3813  LOG_ERROR("NOTE! Record critical error %d, address=0x%lx", code, address)
  // Only the "at FILE:LINE" form (NodeDB.cpp:3811) is captured here — it provides a source location
  // to deduplicate on. The address-only form (NodeDB.cpp:3813) is not captured.
  // Code → name/meaning live in criticalError.ts (see mesh.pb.h _meshtastic_CriticalErrorCode).
  (line, s) => {
    const m = line.match(/Record critical error (\d+) at (\S+):(\d+)/);
    if (!m) return;
    const entry = {code: Number(m[1]), file: m[2], line: Number(m[3])};
    const key = `${entry.code}:${entry.file}:${entry.line}`;
    if (!s.criticalErrors.some((e) => `${e.code}:${e.file}:${e.line}` === key)) {
      s.criticalErrors.push(entry);
    }
  },

  // Radio init retry — two log forms, both from LR11x0/LR20x0 init paths:
  //   LR11x0Interface.cpp:102  LOG_WARN("LR11x0 init failed with %d (SPI_CMD_FAILED), retrying after delay...")
  //   LR11x0Interface.cpp:110  LOG_WARN("LR11x0 init failed with TCXO Vref %f V (err %d), retrying without TCXO")
  //   LR20x0Interface.cpp:118/126 — identical forms for LR20x0.
  // The TCXO branch fires when INVALID_TCXO_VOLTAGE (-703) is returned; driver falls back to XTAL
  // (see TCXO/oscillator matcher). Code → name live in radioLibError.ts.
  (line, s) => {
    const m = line.match(
        /(\w+) init failed with (?:TCXO Vref [\d.]+ V \(err (-?\d+)\)|(-?\d+)).*retry/i
    );
    if (!m) return;
    s.radioInitRetries++;
    s.radioInitError = m[2] ?? m[3]; // group2 = TCXO branch; group3 = numeric-code branch
    if (m[2] !== undefined) s.tcxoInitFailed = true;
  },

  // Configured radio not found after exhausting all init retries:
  //   RadioInterface.cpp:435  LOG_WARN("No SX1262 radio with TCXO, Vref %fV", SX126X_DIO3_TCXO_VOLTAGE)
  //   RadioInterface.cpp:448  LOG_WARN("No SX1262 radio with XTAL, Vref 0.0V")
  //   RadioInterface.cpp:465  LOG_WARN("No SX1268 radio with TCXO, Vref %fV")
  // The "with TCXO/XTAL" suffix distinguishes this from the normal probe misses ("No RF95 radio"
  // etc. — RadioInterface.cpp:401/418/477/504/518/532/546/559) where the driver was compiled in
  // but is simply not the fitted chip; those have no TCXO/XTAL suffix and are expected.
  (line, s) => {
    const m = line.match(/No (\S+) radio with (?:TCXO|XTAL)/);
    if (!m) return;
    s.configuredRadioNotFound = true;
    s.configuredRadioMissingName = s.configuredRadioMissingName ?? m[1];
  },

  // CAD (channel-activity detection) scan failure — completion is delivered over DIO1 IRQ;
  // a RadioLib error here means the scan never completed or returned an error code.
  //   SX126xInterface.cpp:368  LOG_ERROR("SX126X scanChannel %s%d", radioLibErr, result)
  //   LR11x0Interface.cpp:302 / LR20x0Interface.cpp:309 / RF95Interface.cpp:312 /
  //   SX128xInterface.cpp:291 — all call lora.scanChannel() and use radioLibErr prefix.
  (line, s) => {
    if (/scanChannel RadioLib err=/.test(line)) s.scanChannelFailures++;
  },

  // Count boot banners (S:B line). On the per-boot summary applyBootLine resets state and
  // this then re-counts to 1; on the cumulative summary it accumulates → reboot-loop signal.
  (line, s) => {
    if (/S:B:\d+,/.test(line)) s.boots++;
  },

  // "enqueue for send (" — a packet was handed to the radio for transmission.
  (line, s) => {
    if (/enqueue for send \(/.test(line)) s.txEnqueued++;
  },

  // "Started Tx (" / "Completed sending (" — the radio actually keyed up. If packets are
  // enqueued but this never happens, TX is wedged (e.g. BUSY line stuck).
  (line, s) => {
    if (/Started Tx \(|Completed sending \(/.test(line)) s.txCompleted++;
  },

  // RX restart failure — radio could not be returned to receive mode:
  //   LR11x0Interface.cpp:277  LOG_ERROR("StartReceive error: %d", err)
  //   LR20x0Interface.cpp:284  LOG_ERROR("StartReceive error: %d", err)
  // The SX126x and RF95 forms use the "RadioLib err=" prefix and are captured by the generic
  // radioLibErrors matcher (#121) instead:
  //   SX126xInterface.cpp:334  LOG_ERROR("SX126X startReceiveDutyCycleAuto %s%d", radioLibErr, err)
  //   RF95Interface.cpp:296    LOG_ERROR("RF95 startReceive %s%d", radioLibErr, err)
  // Code → name live in radioLibError.ts.
  (line, s) => {
    const m = line.match(/\[RadioIf\] StartReceive error:\s*(-?\d+)/);
    if (!m) return;
    s.radioStartReceiveErrors++;
    s.lastStartReceiveError = m[1];
  },

  // "WarmStore: ring unreadable (N bad page(s)), empty"
  (line, s) => {
    const m = line.match(/WarmStore: ring unreadable \((\d+) bad page/);
    if (!m) return;
    s.warmstoreRingCorrupt = true;
    s.warmstoreBadPages = Number(m[1]);
  },

  // "Devicestate N is old or invalid, discard"
  (line, s) => {
    if (/Devicestate \d+ is old or invalid, discard/.test(line)) s.deviceStateDiscarded = true;
  },

  // Non-critical prefs missing (extension of #82 — catches uiconfig, cannedConf, ringtone, …)
  (line, s) => {
    const m = line.match(/Could not open \/ read \/prefs\/(\w+)\.proto/);
    if (!m) return;
    if (['config', 'nodes'].includes(m[1])) return; // handled by #82
    const f = `${m[1]}.proto`;
    if (!s.missingPrefs.includes(f)) s.missingPrefs.push(f);
  },

  // ── Queue / mesh link health (#103–#110) ──────────────────────────────────

  // "[RadioIf] Can not send yet, busyTx"
  (line, s) => {
    if (/Can not send yet, busyTx/.test(line)) s.busyTxCount++;
  },

  // "caught missed TX_DONE"
  (line, s) => {
    if (/caught missed TX_DONE/.test(line)) s.missedTxDone++;
  },

  // GPS not detected / given up
  (line, s) => {
    if (/No GNSS Module|GPS not detected; marked not present|Give up on GPS probe/.test(line)) {
      s.gpsNotDetected = true;
    }
  },

  // "Packet History - Invalid size -N, using default N"
  (line, s) => {
    if (/Packet History - Invalid size/.test(line)) s.packetHistoryCorrupt = true;
  },

  // "[Router] Sending retransmission …, tries left=N"
  (line, s) => {
    if (/Sending retransmission .*tries left=/.test(line)) s.retransmissions++;
  },

  // "[Router] Received a NAK for 0xN, stopping retransmissions"
  (line, s) => {
    if (/Received a NAK for 0x[\da-fA-F]+, stopping/.test(line)) s.naksReceived++;
  },

  // "[Router] fromRadioQ full, drop oldest!"
  (line, s) => {
    if (/fromRadioQ full, drop oldest/.test(line)) s.fromRadioQOverflow++;
  },

  // "AGC reset: calibration did not complete within Nms" — radio calibration failure
  (line, s) => {
    if (/AGC reset: calibration did not complete within \d+ms/.test(line)) s.agcCalibFailures++;
  },

  // ── Security / PKI (#111–#112) ────────────────────────────────────────────

  // "Unknown public key for destination node 0xN (portnum N), refusing to send legacy DM"
  (line, s) => {
    if (/Unknown public key for destination node.*refusing to send legacy DM/.test(line)) {
      s.pkiUnknownKeyDmRefused++;
    }
  },

  // "Client public key differs from requested: 0xN, stored key begins 0xN"
  (line, s) => {
    if (/Client public key differs from requested/.test(line)) s.pkiClientKeyMismatch = true;
  },

  // ── Low priority / informational (#113–#120) ──────────────────────────────

  // "Reset reason: 0xN" (NRF52 hex reset reason code)
  (line, s) => {
    const m = line.match(/Reset reason: (0x[\da-fA-F]+)/);
    if (m) s.resetReasonCode = m[1];
  },

  // "Coerce (telemetry|position) … to role-aware minimum on defaults"
  (line, s) => {
    if (/Coerce (?:telemetry|position).* to role-aware minimum/.test(line)) s.configCoerced = true;
  },

  // "cleanupMeshDB purged N entries"
  (line, s) => {
    const m = line.match(/cleanupMeshDB purged (\d+) entries/);
    if (m) s.meshDbPurged = Number(m[1]);
  },

  // "[Router] Reboot in N seconds"
  (line, s) => {
    const m = line.match(/Reboot in (\d+) seconds/);
    if (!m) return;
    s.scheduledReboot = true;
    s.scheduledRebootSecs = Number(m[1]);
  },

  // "rebooting device into DFU mode"
  (line, s) => {
    if (/rebooting device into DFU mode/i.test(line)) s.enteredDfuMode = true;
  },

  // "Preset X (implies region swap|swaps region) Y to Z"
  (line, s) => {
    const m = line.match(/Preset (\w+) (?:implies region swap|swaps region) (\w+) to (\w+)/);
    if (m) s.regionPresetSwap = {preset: m[1], from: m[2], to: m[3]};
  },

  // "[TM] Enabled: pos_dedup=N nodeinfo_resp=N …"
  (line, s) => {
    const m = line.match(/\[TM\] Enabled: (.+)/);
    if (!m) return;
    s.tmFlags = {};
    for (const part of m[1].trim().split(/\s+/)) {
      const eq = part.indexOf('=');
      if (eq >= 0) s.tmFlags[part.slice(0, eq)] = part.slice(eq + 1);
    }
  },

  // "Setting next hop for packet with dest XXXX to N"
  (line, s) => {
    const m = line.match(/Setting next hop for packet with dest (\w+) to (\d+)/);
    if (!m) return;
    s.lastNextHopDest = m[1];
    s.lastNextHop = Number(m[2]);
  },

  // ── Source-derived: RadioLib driver surface (#121–#128) ───────────────────

  // Generic RadioLib op failure. Drivers build the log line using the shared prefix constant:
  //   RadioLibInterface.h:337  const char* radioLibErr = "RadioLib err=";
  // producing e.g. "SX126X setSyncWord RadioLib err=-707". Emit sites:
  //   SX126xInterface.cpp:231  setSyncWord, :241 setPreambleLength, :255 setOutputPower,
  //                            :261 setRxBoostedGainMode, :334 startReceiveDutyCycleAuto,
  //                            :368 scanChannel
  //   RF95Interface.cpp:226    setSyncWord, :231 setCurrentLimit, :236 setPreambleLength,
  //                            :272 standby, :296 startReceive, :319 isChannelActive
  //   LR11x0Interface.cpp:211  setRxBoostedGainMode
  //   LR20x0Interface.cpp:217  setRxBoostedGainMode
  // Code → name/meaning live in radioLibError.ts.
  (line, s) => {
    const m = line.match(
        /(SX126[0-9xX]+|LR11x0|LR2021|RF95|STM32WL|LLCC68) (\w+) RadioLib err=(-?\d+)/
    );
    if (!m) return;
    const entry = {radio: m[1], op: m[2], code: Number(m[3])};
    const key = `${entry.radio}:${entry.op}:${entry.code}`;
    if (!s.radioLibErrors.some((e) => `${e.radio}:${e.op}:${e.code}` === key)) {
      s.radioLibErrors.push(entry);
    }
  },

  // RadioLibInterface.cpp:107  LOG_ERROR("Hardware Failure! busyTx for more than 60s")
  // TX busy line held for >60 s — radio wedged; pairs with CriticalErrorCode TX_WATCHDOG (1).
  (line, s) => {
    if (/Hardware Failure! busyTx for more than 60s/.test(line)) {
      s.radioBusyTxHardwareFailure = true;
    }
  },

  // RadioLibInterface.cpp:694  LOG_ERROR("startTransmit failed, error=%d", res)
  // Code → name live in radioLibError.ts.
  (line, s) => {
    const m = line.match(/startTransmit failed, error=(-?\d+)/);
    if (!m) return;
    s.startTransmitFailures++;
    s.lastStartTransmitError = m[1];
  },

  // RadioLibInterface.cpp:653  LOG_WARN("caught missed RX_DONE")
  // IRQ fired but DIO1 pin was already low when ISR ran — DIO1 toggled too fast to catch.
  (line, s) => {
    if (/caught missed RX_DONE/.test(line)) s.missedRxDone++;
  },

  // RadioLibInterface.cpp:536  LOG_ERROR("handleReceiveInterrupt called when not in rx mode, which shouldn't happen")
  // ISR fired while the driver thought it was not in RX — state desync, usually follows SPI fault.
  (line, s) => {
    if (/handleReceiveInterrupt called when not in rx mode/.test(line)) s.rxInterruptWrongMode++;
  },

  // RadioInterface.cpp:575  LOG_WARN("Reconfigure failed, rebooting")
  // main.cpp:1350            LOG_ERROR("LoRa in error detected, attempting to recover")
  (line, s) => {
    if (/Reconfigure failed, rebooting/.test(line)) {
      s.radioRecoveryReboot = true;
      return;
    }
    if (/LoRa in error detected, attempting to recover/.test(line)) s.loraErrorRecoveries++;
  },

  // RadioInterface.cpp:570  LOG_WARN("LoRa chip does not support 2.4GHz. Revert to unset")
  (line, s) => {
    if (/does not support 2\.4GHz\. Revert to unset/.test(line)) s.unsupported24GhzReverted = true;
  },

  // SX126xInterface.cpp:173  LOG_WARN("Failed to apply SX1262 register 0x8B5 patch for RX improvement")
  // SX126xInterface.cpp:470  LOG_WARN("SX126x resetAGC: failed to re-apply 0x8B5 RX sensitivity patch")
  // Register 0x8B5 bit 0 enables an undocumented RX sensitivity improvement; failure means the
  // SPI write was rejected, so RX sensitivity is degraded.
  (line, s) => {
    if (/0x8B5 (?:patch|RX sensitivity patch)/.test(line)) s.rxSensitivityPatchFailed = true;
  },

  // ── Storage / queue failure (#129–#135) ───────────────────────────────────

  // CRIT-level queue-push failures (toPhone / MQTT / notification queues)
  (line, s) => {
    if (/Failed to (?:add a message to mqttQueue|queue a (?:packet|notification) into \w+)/
        .test(line)) {
      s.queuePushFailures++;
    }
  },

  // SafeFile atomic-write integrity failure
  (line, s) => {
    if (/Readback failed hash mismatch|Can.t open tmp file for readback|can.t rename new pref file/
        .test(line)) {
      s.safeFileWriteFailures++;
    }
  },

  // Encrypted storage locked — save skipped (narrow to actual save-skip lines; the boot-time
  // "Encrypted storage locked, using default config" INFO line is excluded intentionally)
  (line, s) => {
    if (/saveToDisk.*encrypted storage locked|Config save skipped.*encrypted storage is locked/i
        .test(line)) {
      s.encryptedStorageLockedSkips++;
      s.storageLocked = true;
    }
  },

  // Encryption failures
  (line, s) => {
    if (/Failed to encrypt and write|OOM (?:encoding|decrypting)/.test(line)) {
      s.encryptionFailures++;
    }
  },

  // Storage decrypt / decode failed — treating as corrupt
  (line, s) => {
    if (/Decrypt failed for .*treating as corrupt|decrypt\/decode failed during reload/
        .test(line)) {
      s.storageDecryptCorrupt = true;
    }
  },

  // Save blocked due to unsafe power level (low battery)
  (line, s) => {
    if (/trying to save\w+\(\) on unsafe device power level/.test(line)) {
      s.unsafePowerSaveBlocked++;
    }
  },

  // Filesystem mount failed / not implemented
  (line, s) => {
    if (/Filesystem mount failed|Filesystem not implemented/.test(line)) {
      s.filesystemMountFailed = true;
    }
  },

  // ── Power / sleep / lockdown (#136–#139) ──────────────────────────────────

  // ADC init / calibration failures — unreliable battery readings
  (line, s) => {
    if (/ADC (?:oneshot (?:init|handle)|channel config|calibration).*(?:fail|not initialized)/i
        .test(line)) {
      s.adcErrors++;
    }
  },

  // Power management chip failures
  (line, s) => {
    const m = line.match(/(BQ27220|BQ25896) init failed|No (AXP\d+) power management/);
    if (!m) return;
    const chip = m[1] ?? m[2];
    if (!s.powerChipFailures.includes(chip)) s.powerChipFailures.push(chip);
  },

  // ESP sleep API errors (non-zero return)
  (line, s) => {
    const m = line.match(/esp_(?:light_sleep_start|sleep_enable_\w+) result (-?\d+)/);
    if (m && Number(m[1]) !== 0) s.espSleepErrors++;
  },

  // Lockdown state: "Lockdown: Device locked" / "session limit reached … locking and rebooting"
  (line, s) => {
    const m = line.match(/Lockdown: (.+)/);
    if (!m) return;
    s.lockdownState = m[1].trim();
    s.lockdownActive = true;
  },

  // ── CRIT log catch-all (#140) ─────────────────────────────────────────────
  // Every CRIT-level line is currently invisible (existing #23 only catches ERROR).
  (line, s) => {
    if (!/^CRIT\s+\|/.test(line)) return;
    s.critLogCount++;
    if (!s.lastCritLog) s.lastCritLog = line.slice(0, 120).trim();
  },

  // ── TCXO / oscillator (#141) ──────────────────────────────────────────────
  // TCXO → XTAL fallback: INVALID_TCXO_VOLTAGE (-703) on first init triggers a retry without
  // TCXO; on success the driver logs:
  //   LR11x0Interface.cpp:114  LOG_INFO("LR11x0 init success without TCXO (XTAL mode)")
  //   LR20x0Interface.cpp:130  LOG_INFO("LR20x0 init success without TCXO (XTAL mode)")
  // The preceding failure line is captured by the radioInitRetries matcher (LR11x0Interface.cpp:110).
  (line, s) => {
    const m = line.match(/(LR11x0|LR20x0|SX\w+) init success without TCXO \(XTAL mode\)/);
    if (!m) return;
    s.tcxoFallbackToXtal = true;
    s.radioOscMode = 'XTAL (fallback)';
  },

  // ── GPS lock acquisition (#142–#144) ──────────────────────────────────────
  // "[GPS] Took Ns to get lock"
  (line, s) => {
    const m = line.match(/\[GPS\] Took (\d+)s to get lock/);
    if (!m) return;
    s.gpsLockTimeSecs = Number(m[1]);
    s.gpsLocksAcquired++;
  },

  // "[GPS] GPS search ended without fix after Ns (consecutive failures: N)"
  (line, s) => {
    const m = line.match(
        /\[GPS\] GPS search ended without fix after (\d+)s \(consecutive failures: (\d+)\)/
    );
    if (!m) return;
    s.gpsSearchFailures++;
    s.gpsConsecutiveLockFailures = Number(m[2]);
  },

  // "didn't get a GPS lock in time"
  (line, s) => {
    if (/didn.t get a GPS lock in time/.test(line)) s.gpsNoLockPublishFailures++;
  },

  // ── GPS serial-link integrity (#145–#149) ─────────────────────────────────
  // "[GPS] N new GPS checksum failures, for a total of N"
  (line, s) => {
    const m = line.match(/\[GPS\] (\d+) new GPS checksum failures, for a total of (\d+)/);
    if (!m) return;
    s.gpsChecksumFailDelta = Number(m[1]);
    s.gpsChecksumFailTotal = Number(m[2]);
  },

  // "[GPS] GPS Buffer full with N bytes waiting"
  (line, s) => {
    const m = line.match(/\[GPS\] GPS Buffer full with (\d+) bytes waiting/);
    if (!m) return;
    s.gpsBufferFullEvents++;
    s.gpsBufferFullBytes = Number(m[1]);
  },

  // "[GPS] UBlox Frame Errors (baudrate N)"
  (line, s) => {
    const m = line.match(/\[GPS\] UBlox Frame Errors \(baudrate (\d+)\)/);
    if (!m) return;
    s.gpsFrameErrors++;
    s.gpsFrameErrorBaud = m[1];
  },

  // "[GPS] SOME data is TOO OLD: LOC N, TIME N, DATE N"
  (line, s) => {
    const m = line.match(/\[GPS\] SOME data is TOO OLD: LOC (\d+), TIME (\d+), DATE (\d+)/);
    if (!m) return;
    s.gpsStaleDataEvents++;
    s.gpsStaleAgeLoc = Number(m[1]);
    s.gpsStaleAgeTime = Number(m[2]);
    s.gpsStaleAgeDate = Number(m[3]);
  },

  // "[GPS] BOGUS hdop/course.value() REJECTED"
  (line, s) => {
    if (/\[GPS\] BOGUS (?:hdop|course)\.value\(\) REJECTED/.test(line)) s.gpsBogusValueRejects++;
  },

  // ── GPS module config failures (#150–#154) ────────────────────────────────
  // "[GPS] Got NACK/NAK for class XX message XX"
  (line, s) => {
    const m = line.match(/\[GPS\] Got NA[CK]K? for class ([0-9A-Fa-f]{2}) message ([0-9A-Fa-f]{2})/);
    if (!m) return;
    s.gpsConfigNacks++;
    const msg = `${m[1]}:${m[2]}`;
    if (!s.gpsNackedMessages.includes(msg)) s.gpsNackedMessages.push(msg);
  },

  // "[GPS] No response for class XX message XX"
  (line, s) => {
    const m = line.match(/\[GPS\] No response for class ([0-9A-Fa-f]{2}) message ([0-9A-Fa-f]{2})/);
    if (!m) return;
    s.gpsConfigTimeouts++;
    const msg = `${m[1]}:${m[2]}`;
    if (!s.gpsTimedOutMessages.includes(msg)) s.gpsTimedOutMessages.push(msg);
  },

  // "[GPS] ATGM336H: Could not …"
  (line, s) => {
    if (/\[GPS\] ATGM336H: Could not/.test(line)) s.gpsAtgmConfigFailures++;
  },

  // "[GPS] Unable to save GNSS module config"
  (line, s) => {
    if (/\[GPS\] Unable to save GNSS module config/.test(line)) s.gpsConfigSaveFailed = true;
  },

  // "reconfigure GNSS - defaults maintained"
  (line, s) => {
    if (/reconfigure GNSS - defaults maintained/.test(line)) s.gpsDefaultsMaintained = true;
  },

  // ── GPS probe / detection (#155–#157) ─────────────────────────────────────
  // "[GPS] <chip> detected" — negative lookahead avoids "GPS not detected"
  (line, s) => {
    const m = line.match(/\[GPS\] (?!GPS not)(\S+) detected/);
    if (m && !s.gpsChipModel) s.gpsChipModel = m[1];
  },

  // "[GPS] Cached GPS probe is stale (chip @ baud), clearing cache"
  (line, s) => {
    const m = line.match(/\[GPS\] Cached GPS probe is stale \(([^@]+) @ (\d+)\), clearing cache/);
    if (!m) return;
    s.gpsProbeCacheStale = true;
    s.gpsStaleProbe = `${m[1].trim()} @ ${m[2]}`;
  },

  // "[GPS] GPS+SBAS+GLONASS+Galileo configured" / "[GPS] GPS+SBAS configured"
  (line, s) => {
    const m = line.match(/\[GPS\] (GPS\+SBAS(?:\+GLONASS\+Galileo)?) configured/);
    if (m) s.gpsConstellations = m[1];
  },

  // ── GPS power / time (#158–#160) ──────────────────────────────────────────
  // "[GPS] GPS power state move from X to Y"
  (line, s) => {
    const m = line.match(/\[GPS\] GPS power state move from (\w+) to (\w+)/);
    if (!m) return;
    s.gpsPowerState = `${m[1]}→${m[2]}`;
    s.gpsPowerStateTransitions++;
  },

  // "Reapply external time to correct clock drift N secs"
  (line, s) => {
    const m = line.match(/Reapply external time to correct clock drift (-?\d+) secs/);
    if (!m) return;
    s.rtcDriftCorrections++;
    s.lastClockDriftSecs = Number(m[1]);
  },

  // "[GPS] User toggled GpsMode. Now ENABLED/DISABLED"
  (line, s) => {
    const m = line.match(/\[GPS\] User toggled GpsMode\. Now (ENABLED|DISABLED)/);
    if (m) s.gpsUserMode = m[1];
  },

  // ── Sensor readings — local broadcast (#161–#171) ─────────────────────────

  // #161 Environment: barometric_pressure, current, gas_resistance, humidity, temperature
  (line, s) => {
    const m = line.match(
        /Send: barometric_pressure=([\d.-]+), current=([\d.-]+), gas_resistance=([\d.-]+), relative_humidity=([\d.-]+), temperature=([\d.-]+)/
    );
    if (!m) return;
    s.envPressure = Number(m[1]); s.envCurrent = Number(m[2]);
    s.envGasResistance = Number(m[3]); s.envHumidity = Number(m[4]);
    s.envTemperature = Number(m[5]);
  },

  // #162 Air quality: PM10 / PM2.5 / PM100
  (line, s) => {
    const m = line.match(
        /Send: pm10_(?:standard|environmental)=(\d+), pm25_(?:standard|environmental)=(\d+), pm100_(?:standard|environmental)=(\d+)/
    );
    if (!m) return;
    s.pm10 = Number(m[1]); s.pm25 = Number(m[2]); s.pm100 = Number(m[3]);
  },

  // #163 CO₂ sensor
  (line, s) => {
    const m = line.match(/Send: co2=(\d+), co2_t=([\d.-]+), co2_rh=([\d.-]+)/);
    if (!m) return;
    s.co2 = Number(m[1]); s.co2Temp = Number(m[2]); s.co2Humidity = Number(m[3]);
  },

  // #164 HCHO / VOC sensor
  (line, s) => {
    const m = line.match(/Send: hcho=([\d.-]+), hcho_t=([\d.-]+), hcho_rh=([\d.-]+)/);
    if (!m) return;
    s.hcho = Number(m[1]); s.hchoTemp = Number(m[2]); s.hchoHumidity = Number(m[3]);
  },

  // #165 Light / IAQ
  (line, s) => {
    const m = line.match(/Send: voltage=([\d.-]+), IAQ=(\d+), distance=([\d.-]+), lux=([\d.-]+)/);
    if (!m) return;
    s.iaqVoltage = Number(m[1]); s.iaq = Number(m[2]);
    s.distance = Number(m[3]); s.lux = Number(m[4]);
  },

  // #166 Soil
  (line, s) => {
    const m = line.match(/Send: soil_temperature=([\d.-]+), soil_moisture=(\d+)/);
    if (!m) return;
    s.soilTemp = Number(m[1]); s.soilMoisture = Number(m[2]);
  },

  // #167 Health (temperature, heart rate, SpO2)
  (line, s) => {
    const m = line.match(/Send: temperature=([\d.-]+), heart_bpm=(\d+), spO2=(\d+)/);
    if (!m) return;
    s.healthTemp = Number(m[1]); s.heartBpm = Number(m[2]); s.spo2 = Number(m[3]);
  },

  // #168 Radiation — µ is multi-byte UTF-8, match ..? instead of the literal
  (line, s) => {
    const m = line.match(/Send: radiation=([\d.-]+)..?R\/h/);
    if (m) s.radiation = Number(m[1]);
  },

  // #169 Wind / weight
  (line, s) => {
    const m = line.match(/Send: wind speed=([\d.-]+)m\/s, direction=(\d+) degrees, weight=([\d.-]+)kg/);
    if (!m) return;
    s.windSpeed = Number(m[1]); s.windDir = Number(m[2]); s.weight = Number(m[3]);
  },

  // #170 Power — INA219/226 dual-channel
  (line, s) => {
    const m = line.match(
        /Send: ch1_voltage=([\d.-]+), ch1_current=([\d.-]+), ch2_voltage=([\d.-]+), ch2_current=([\d.-]+)/
    );
    if (!m) return;
    s.ch1V = Number(m[1]); s.ch1I = Number(m[2]);
    s.ch2V = Number(m[3]); s.ch2I = Number(m[4]);
  },

  // #171 Host metrics (Linux / Portduino)
  (line, s) => {
    const m = line.match(
        /Send: uptime=(\d+), diskfree=(\d+), memory free=(\d+), load=([\d.]+), ([\d.]+), ([\d.]+)/
    );
    if (!m) return;
    s.hostUptime = Number(m[1]); s.hostDiskFree = Number(m[2]);
    s.hostMemFree = Number(m[3]);
    s.hostLoad = [Number(m[4]), Number(m[5]), Number(m[6])];
  },

  // ── Peer telemetry (#172–#176, combined) ──────────────────────────────────
  // "(Received [Host Metrics ]from X): key=val, ..." — generic KV capture.
  // Capped at 20 unique senders to avoid unbounded growth.
  (line, s) => {
    const m = line.match(/\(Received(?:[^)]+)? from ([^)]+)\):\s*(.*)/);
    if (!m || !m[2].includes('=')) return;
    const sender = m[1].trim();
    if (!s.peerTelemetry[sender]) {
      if (Object.keys(s.peerTelemetry).length >= 20) return;
      s.peerTelemetry[sender] = {};
    }
    s.peerTelemetryCount++;
    const kv = /([A-Za-z][\w ]*?)\s*=\s*(-?\d+(?:\.\d+)?)/g;
    let kvm: RegExpExecArray | null;
    while ((kvm = kv.exec(m[2])) !== null) {
      s.peerTelemetry[sender][kvm[1].trim()] = Number(kvm[2]);
    }
  },

  // ── Telemetry decode failures (#177–#178) ────────────────────────────────
  (line, s) => {
    const m = line.match(/Error decoding (\w+) module!/);
    if (m) s.telemetryDecodeErrors[m[1]] = (s.telemetryDecodeErrors[m[1]] ?? 0) + 1;
  },

  (line, s) => {
    if (/Unable to decode last packet/.test(line)) {
      s.telemetryDecodeErrors.unknown = (s.telemetryDecodeErrors.unknown ?? 0) + 1;
    }
  },

  // ── I2C sensor driver health (#179–#187) ──────────────────────────────────

  // #179 "<Sensor>: Unable to <op>[. Error code: N]"
  (line, s) => {
    const m = line.match(/(\w[\w\d]*): Unable to ([^.]+?)(?:\. Error code: (\d+))?$/);
    if (!m) return;
    const entry = {sensor: m[1], op: m[2].trim(), ...(m[3] !== undefined && {code: Number(m[3])})};
    const key = `${m[1]}:${entry.op}`;
    if (!s.sensorErrors.some((e) => `${e.sensor}:${e.op}` === key)) s.sensorErrors.push(entry);
  },

  // #180 "<Sensor> not found on I2C at 0xNN"
  (line, s) => {
    const m = line.match(/(\w[\w\d]*) not found on I2C at (0x[\da-fA-F]+)/);
    if (!m) return;
    const id = `${m[1]}@${m[2]}`;
    if (!s.sensorsNotFound.includes(id)) s.sensorsNotFound.push(id);
  },

  // #181 "Can't connect to detected <Sensor> sensor"
  (line, s) => {
    const m = line.match(/Can.t connect to detected (\w+) sensor\. Remove from nodeTelemetrySensorsMap/);
    if (!m) return;
    if (!s.sensorsDropped.includes(m[1])) s.sensorsDropped.push(m[1]);
  },

  // #182 "<Sensor> read failed: incomplete data (N bytes)"
  (line, s) => {
    if (/\w+ read failed: incomplete data \(\d+ bytes\)/.test(line)) s.sensorReadFailures++;
  },

  // #183 "<Sensor> checksum failed"
  (line, s) => {
    if (/\w+ checksum failed: computed 0x[\da-fA-F]+, received 0x[\da-fA-F]+/.test(line)) {
      s.sensorChecksumFailures++;
    }
  },

  // #184 "<Sensor> frame header invalid"
  (line, s) => {
    if (/\w+ frame header invalid: 0x[\da-fA-F]+ 0x[\da-fA-F]+/.test(line)) s.sensorFrameErrors++;
  },

  // #185 Sensor vs display I2C clock conflict
  (line, s) => {
    const m = line.match(/(\w+) can.t be used at this clock speed, with a screen/);
    if (!m) return;
    if (!s.sensorClockConflict.includes(m[1])) s.sensorClockConflict.push(m[1]);
  },

  // #186 Calibration / state file save failure
  (line, s) => {
    if (/Failed to save calibration data|Can.t remove old state file/.test(line)) {
      s.sensorCalibSaveFailed = true;
    }
  },

  // #187 BME680 / BSEC2 library status code
  (line, s) => {
    const m = line.match(/(\w+) (BSEC2|BME68X) code: (-?\d+)/);
    if (m) s.bme680LibCode = {sensor: m[1], lib: m[2], code: Number(m[3])};
  },

  // ── Feature module diagnostics (#188–#201) ────────────────────────────────

  // #188 Config applied but not saved to disk
  (line, s) => {
    if (/Config applied but save failed|Failed to save config changes to disk/.test(line)) {
      s.adminConfigSaveFailed = true;
      s.configSaveFailures++;
    }
  },

  // #189 AdminModule dropped payload — storage locked
  (line, s) => {
    if (/AdminModule: dropping admin payload.*storage locked/.test(line)) {
      s.adminDroppedStorageLocked++;
    }
  },

  // #190 Admin message without session key (security)
  (line, s) => {
    if (/Admin message without session_key!/.test(line)) s.adminNoSessionKey++;
  },

  // #191 Invalid serial module config
  (line, s) => {
    if (/Invalid serial config/.test(line)) s.invalidSerialConfig = true;
  },

  // #192 Unsigned NodeInfo from previously-signing node (key downgrade / spoof)
  (line, s) => {
    const m = line.match(/Dropping unsigned NodeInfo from node (0x[\da-fA-F]+) that previously signed/);
    if (!m) return;
    s.unsignedNodeInfoDropped++;
    if (!s.nodeKeyDowngrade.includes(m[1])) s.nodeKeyDowngrade.push(m[1]);
  },

  // #193 NodeInfo is_licensed mismatch
  (line, s) => {
    if (/Invalid nodeInfo detected, is_licensed mismatch/.test(line)) {
      s.nodeInfoLicensedMismatch = true;
    }
  },

  // #194 Key verification (Hash2) mismatch
  (line, s) => {
    if (/Hash2 did not match/.test(line)) s.keyVerificationFailures++;
  },

  // #195 Store & Forward PSRAM full
  (line, s) => {
    if (/S&F - PSRAM Full\. Starting overwrite/.test(line)) s.storeForwardPsramFull = true;
  },

  // #196 Neighbor DB eviction
  (line, s) => {
    if (/Neighbor DB is full, replace oldest neighbor/.test(line)) s.neighborDbFull++;
  },

  // #197 TraceRoute hop limit exceeded
  (line, s) => {
    if (/Route exceeded maximum hop limit!/.test(line)) s.tracerouteHopLimitExceeded++;
  },

  // #198 TraceRoute allocation / null / self errors
  (line, s) => {
    if (/Cannot trace route to self|Failed to allocate TraceRoute packet|MeshService is NULL!|Invalid node number for trace route/.test(line)) {
      s.tracerouteErrors++;
    }
  },

  // #199 Position publish skipped — no GPS fix yet or position privacy
  (line, s) => {
    if (/Skip position send because lat\/lon are zero!/.test(line)) s.positionZeroSkipped++;
  },

  // #200 Detection sensor module misconfigured (no monitor pin)
  (line, s) => {
    if (/Detection Sensor Module:.*no monitor pin is set/.test(line)) {
      s.detectionMisconfigured = true;
    }
  },

  // #201 FEM LNA mode configured but chip doesn't support it
  (line, s) => {
    if (/FEM LNA mode configured but current FEM does not support LNA control/.test(line)) {
      s.femLnaUnsupported = true;
    }
  },

  // #202 Packet heard over the air — count per channel-hash byte and update per-node stats.
  // Source: printPacket() (RadioInterface.cpp) emits "Lora RX (… Ch=0x%x …)"
  // for every received packet (RadioLibInterface.cpp:615). `Ch` is the
  // single-byte channel hash, so this tallies RX traffic volume per channel.
  // Also stores id → hash for correlation with the later "decoded message" line.
  (line, s) => {
    if (!/Lora RX \(/.test(line)) return;
    const idM = line.match(/Lora RX \(id=(0x[\da-fA-F]+)/);
    const chM = line.match(/\bCh=(0x[\da-fA-F]+)/);
    if (!idM || !chM) return;
    const hash = chM[1].toLowerCase();
    const id = idM[1].toLowerCase();
    s.rxChannelHashCounts[hash] = (s.rxChannelHashCounts[hash] ?? 0) + 1;
    const isDup = s._seenPacketIds.has(id);
    if (isDup) {
      s.dupChannelHashCounts[hash] = (s.dupChannelHashCounts[hash] ?? 0) + 1;
    } else {
      s._seenPacketIds.add(id);
      s._rxHashById[id] = hash;
    }

    const frM = line.match(/\bfr=(0x[\da-fA-F]+)/);
    if (!frM) return;
    const nodeId = frM[1].toLowerCase();
    if (!s.seenNodes[nodeId]) {
      s.seenNodes[nodeId] = {
        heard: 0, decoded: 0, dup: 0, hopSum: 0, hopCount: 0,
        hopMin: Infinity, channels: {},
      };
    }
    const ns = s.seenNodes[nodeId];
    ns.heard++;
    if (isDup) ns.dup++;
    ns.channels[hash] = (ns.channels[hash] ?? 0) + 1;
    const hopLimM = line.match(/\bHopLim=(\d+)/);
    const hopStartM = line.match(/\bhopStart=(\d+)/);
    if (hopLimM && hopStartM) {
      const hops = Number(hopStartM[1]) - Number(hopLimM[1]);
      if (hops >= 0) {
        ns.hopSum += hops;
        ns.hopCount++;
        if (hops < ns.hopMin) ns.hopMin = hops;
      }
    }
    const rssiM = line.match(/\brxRSSI=([-\d]+)/);
    const snrM = line.match(/\brxSNR=([-\d.]+)/);
    if (rssiM) ns.lastRssi = Number(rssiM[1]);
    if (snrM) ns.lastSnr = Number(snrM[1]);
  },

  // #203 Packet transmitted — count per channel-hash byte.
  // Source: printPacket() emits "Completed sending (… Ch=0x%x …)" once per
  // sent packet on both hardware (RadioLibInterface.cpp:524) and native
  // (SimRadio.cpp:98). Symmetric counterpart to #202's RX tally.
  (line, s) => {
    const m = line.match(/Completed sending \(.*\bCh=(0x[\da-fA-F]+)/);
    if (!m) return;
    const hash = m[1].toLowerCase();
    s.txChannelHashCounts[hash] = (s.txChannelHashCounts[hash] ?? 0) + 1;
  },

  // #204 Packet decoded by Router — count per channel-hash byte and update per-node decoded.
  // Source: Router.cpp emits "decoded message (id=0xNN …)" on successful decrypt.
  // The Ch= on this line is the channel *index* (0-7), not the hash, so we look up
  // the hash from the earlier "Lora RX" line via the shared packet id. The index is
  // captured separately (parseChannelIndex tolerates the hex and decimal print forms).
  (line, s) => {
    const m = line.match(/decoded message \(id=(0x[\da-fA-F]+)/);
    if (!m) return;
    const id = m[1].toLowerCase();
    const hash = s._rxHashById[id];
    if (hash) {
      s.decodedChannelHashCounts[hash] = (s.decodedChannelHashCounts[hash] ?? 0) + 1;
      delete s._rxHashById[id];
    }
    const frM = line.match(/\bfr=(0x[\da-fA-F]+)/);
    const chIdxM = line.match(/\bCh=(0x[\da-fA-F]+|\d+)/);
    if (frM) {
      const nodeId = frM[1].toLowerCase();
      if (s.seenNodes[nodeId]) {
        s.seenNodes[nodeId].decoded++;
        if (chIdxM) s.seenNodes[nodeId].lastChannelIndex = parseChannelIndex(chIdxM[1]);
      }
    }
  },

  // #205 Node status update — "Node status update: N online, N total"
  // Source: NodeStatus.h:59. Keeps online/total fresh between full telemetry
  // broadcasts (#26) and feeds the Node-status data tile.
  (line, s) => {
    const m = line.match(/Node status update: (\d+) online, (\d+) total/);
    if (!m) return;
    s.numOnlineNodes = Number(m[1]);
    s.numTotalNodes = Number(m[2]);
    recordNodeCount(s, s.numOnlineNodes, s.numTotalNodes);
  },
];

export function updateSummary(line: string, summary: DeviceSummary): void {
  for (const matcher of MATCHERS) {
    matcher(line, summary);
  }
  feedMultiLine(line, summary);
}

export function updateSummaryCumulative(line: string, s: DeviceSummary): void {
  applyBootLine(line, s, false);
  for (const matcher of MATCHERS.slice(1)) {
    matcher(line, s);
  }
  feedMultiLine(line, s);
}
