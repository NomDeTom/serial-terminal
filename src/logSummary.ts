import {lookupDevice, lookupDeviceByModel} from './deviceInfo';
import {lookupReleaseDate} from './firmwareReleases';

// Routing.Error enum from meshtastic/protobufs mesh.proto
const NAK_ERROR_NAMES: Record<number, string> = {
  1: 'NO_ROUTE', 2: 'GOT_NAK', 3: 'TIMEOUT', 4: 'NO_INTERFACE',
  5: 'MAX_RETRANSMIT', 6: 'NO_CHANNEL', 7: 'TOO_LARGE',
  8: 'NO_RESPONSE', 9: 'DUTY_CYCLE_LIMIT',
};

// RadioLib error codes (TypeDef.h) — subset reachable on Meshtastic radio paths
const RADIOLIB_ERR: Record<number, string> = {
  [-2]: 'CHIP_NOT_FOUND', [-3]: 'MEMORY_ALLOCATION_FAILED',
  [-4]: 'PACKET_TOO_LONG', [-5]: 'TX_TIMEOUT', [-6]: 'RX_TIMEOUT',
  [-7]: 'CRC_MISMATCH', [-8]: 'INVALID_BANDWIDTH', [-9]: 'INVALID_SPREADING_FACTOR',
  [-10]: 'INVALID_CODING_RATE', [-12]: 'INVALID_FREQUENCY', [-13]: 'INVALID_OUTPUT_POWER',
  [-16]: 'SPI_WRITE_FAILED', [-18]: 'INVALID_PREAMBLE_LENGTH', [-19]: 'INVALID_GAIN',
  [-20]: 'WRONG_MODEM', [-703]: 'INVALID_TCXO_VOLTAGE', [-704]: 'INVALID_MODULATION_PARAMETERS',
  [-705]: 'SPI_CMD_TIMEOUT', [-706]: 'SPI_CMD_INVALID', [-707]: 'SPI_CMD_FAILED',
  [-1300]: 'FRONTEND_CALIBRATION_FAILED', [-1301]: 'INVALID_SIDE_DETECT',
};

// CriticalErrorCode from meshtastic/protobufs mesh.proto / mesh.pb.h
const CRIT_ERR: Record<number, string> = {
  0: 'NONE', 1: 'TX_WATCHDOG', 2: 'SLEEP_ENTER_WAIT', 3: 'NO_RADIO',
  4: 'UNSPECIFIED', 5: 'UBLOX_UNIT_FAILED', 6: 'NO_AXP192',
  7: 'INVALID_RADIO_SETTING', 8: 'TRANSMIT_FAILED', 9: 'BROWNOUT',
  10: 'SX1262_FAILURE', 11: 'RADIO_SPI_BUG',
  12: 'FLASH_CORRUPTION_RECOVERABLE', 13: 'FLASH_CORRUPTION_UNRECOVERABLE',
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
  radioOscMode?: string;        // 'TCXO' / 'XTAL' / 'XTAL (fallback)'
  tcxoInitFailed?: boolean;     // TCXO failed init, fell back to XTAL
  tcxoFallbackToXtal?: boolean; // LR11x0/LR20x0 confirmed init success in XTAL mode

  // GPS hardware
  gps?: string;
  gpsChipModel?: string;       // from cached probe
  localLat?: number;           // millionths of degree × 10
  localLon?: number;
  localAlt?: number;           // mm above sea level
  gpsSiv?: number;             // satellites in view

  // GPS lock acquisition / fault tracking
  gpsLockTimeSecs?: number;
  gpsLocksAcquired: number;
  gpsSearchFailures: number;
  gpsConsecutiveLockFailures?: number;  // rising = chip can't fix; resets to 0 on lock
  gpsNoLockPublishFailures: number;
  gpsChecksumFailDelta?: number;
  gpsChecksumFailTotal?: number;
  gpsBufferFullEvents: number;
  gpsBufferFullBytes?: number;
  gpsFrameErrors: number;
  gpsFrameErrorBaud?: string;
  gpsStaleDataEvents: number;
  gpsStaleAgeLoc?: number;
  gpsStaleAgeTime?: number;
  gpsStaleAgeDate?: number;
  gpsBogusValueRejects: number;
  gpsConfigNacks: number;
  gpsNackedMessages: string[];
  gpsConfigTimeouts: number;
  gpsTimedOutMessages: string[];
  gpsAtgmConfigFailures: number;
  gpsConfigSaveFailed?: boolean;
  gpsDefaultsMaintained?: boolean;
  gpsProbeCacheStale?: boolean;
  gpsStaleProbe?: string;
  gpsConstellations?: string;
  gpsPowerState?: string;
  gpsPowerStateTransitions: number;
  gpsUserMode?: string;
  rtcDriftCorrections: number;
  lastClockDriftSecs?: number;

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

  // Packets per channel-hash byte (the "Ch=0xNN" field in printPacket lines).
  // rx = heard over the air ("Lora RX"); tx = transmitted ("Completed sending").
  rxChannelHashCounts: Record<string, number>;
  txChannelHashCounts: Record<string, number>;

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

  // Persistence / lifecycle faults
  fsOrphan?: boolean;              // LittleFS "Found orphan" — filesystem inconsistency
  pkiKeysRegenerated?: boolean;    // "Generate new PKI keys" — node identity/keys reset
  factoryReset?: boolean;          // "Perform factory reset!"
  invalidLoraConfig?: boolean;     // invalid coding_rate/spread_factor or preset invalid for region
  missingCriticalPrefs: string[];  // persistence-critical prefs (config / nodes) that failed
  missingPrefs: string[];          // non-critical prefs (uiconfig, cannedConf, ringtone…)

  // Crash / panic
  taskWatchdogTriggered?: boolean; // ESP-IDF task_wdt fired
  watchdogTask?: string;           // starved task name (from "task_wdt:  - NAME (CPU N)")
  espPanicBacktrace?: boolean;     // "Backtrace:" line seen
  panicPc?: string;                // first PC from panic backtrace
  radioAssertFailed?: boolean;
  assertLocations: string[];       // "file:line" deduped list
  criticalErrors: Array<{code: number; file: string; line: number}>;

  // Radio driver health (source-derived)
  radioInitRetries: number;
  radioInitError?: string;
  radioStartReceiveErrors: number;
  lastStartReceiveError?: string;
  radioLibErrors: Array<{radio: string; op: string; code: number}>;
  radioBusyTxHardwareFailure?: boolean;
  startTransmitFailures: number;
  lastStartTransmitError?: string;
  missedTxDone: number;
  missedRxDone: number;
  rxInterruptWrongMode: number;
  radioRecoveryReboot?: boolean;
  loraErrorRecoveries: number;
  unsupported24GhzReverted?: boolean;
  rxSensitivityPatchFailed?: boolean;

  // WarmStore / NodeDB corruption
  warmstoreRingCorrupt?: boolean;
  warmstoreBadPages?: number;
  deviceStateDiscarded?: boolean;

  // Queue / mesh link health
  busyTxCount: number;
  fromRadioQOverflow: number;
  retransmissions: number;
  naksReceived: number;
  agcCalibFailures: number;
  gpsNotDetected?: boolean;
  packetHistoryCorrupt?: boolean;

  // PKI / security (extended)
  pkiUnknownKeyDmRefused: number;
  pkiClientKeyMismatch?: boolean;

  // Encrypted storage (fix-saveconfig branch)
  queuePushFailures: number;
  safeFileWriteFailures: number;
  encryptedStorageLockedSkips: number;
  storageLocked?: boolean;
  encryptionFailures: number;
  storageDecryptCorrupt?: boolean;
  unsafePowerSaveBlocked: number;
  filesystemMountFailed?: boolean;

  // Power / sleep
  adcErrors: number;
  powerChipFailures: string[];
  espSleepErrors: number;
  lockdownState?: string;
  lockdownActive?: boolean;

  // Informational / low-priority
  resetReasonCode?: string;
  configCoerced?: boolean;
  meshDbPurged?: number;
  scheduledReboot?: boolean;
  scheduledRebootSecs?: number;
  enteredDfuMode?: boolean;
  regionPresetSwap?: {preset: string; from: string; to: string};
  tmFlags?: Record<string, string>;
  lastNextHopDest?: string;
  lastNextHop?: number;

  // CRIT-level log catch-all
  critLogCount: number;
  lastCritLog?: string;

  // ── Sensor readings (local — Part A #161–#171) ────────────────────────────
  envPressure?: number;
  envCurrent?: number;
  envGasResistance?: number;
  envHumidity?: number;
  envTemperature?: number;
  pm10?: number; pm25?: number; pm100?: number;
  co2?: number; co2Temp?: number; co2Humidity?: number;
  hcho?: number; hchoTemp?: number; hchoHumidity?: number;
  iaqVoltage?: number; iaq?: number; distance?: number; lux?: number;
  soilTemp?: number; soilMoisture?: number;
  healthTemp?: number; heartBpm?: number; spo2?: number;
  radiation?: number;
  windSpeed?: number; windDir?: number; weight?: number;
  ch1V?: number; ch1I?: number; ch2V?: number; ch2I?: number;
  hostUptime?: number; hostDiskFree?: number; hostMemFree?: number; hostLoad?: number[];

  // Peer telemetry (Part B #172–#176)
  peerTelemetry: Record<string, Record<string, number>>;
  peerTelemetryCount: number;

  // Telemetry decode failures (Part C #177–#178)
  telemetryDecodeErrors: Record<string, number>;

  // I2C sensor driver health (Part D #179–#187)
  sensorErrors: Array<{sensor: string; op: string; code?: number}>;
  sensorsNotFound: string[];
  sensorsDropped: string[];
  sensorReadFailures: number;
  sensorChecksumFailures: number;
  sensorFrameErrors: number;
  sensorClockConflict: string[];
  sensorCalibSaveFailed?: boolean;
  bme680LibCode?: {sensor: string; lib: string; code: number};

  // Feature module diagnostics (Part E #188–#201)
  adminConfigSaveFailed?: boolean;
  configSaveFailures: number;
  adminDroppedStorageLocked: number;
  adminNoSessionKey: number;
  invalidSerialConfig?: boolean;
  unsignedNodeInfoDropped: number;
  nodeKeyDowngrade: string[];
  nodeInfoLicensedMismatch?: boolean;
  keyVerificationFailures: number;
  storeForwardPsramFull?: boolean;
  neighborDbFull: number;
  tracerouteHopLimitExceeded: number;
  tracerouteErrors: number;
  positionZeroSkipped: number;
  detectionMisconfigured?: boolean;
  femLnaUnsupported?: boolean;
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
    missingCriticalPrefs: [], missingPrefs: [],
    assertLocations: [], criticalErrors: [], radioLibErrors: [], powerChipFailures: [],
    radioInitRetries: 0, radioStartReceiveErrors: 0,
    startTransmitFailures: 0, missedTxDone: 0, missedRxDone: 0,
    rxInterruptWrongMode: 0, loraErrorRecoveries: 0,
    busyTxCount: 0, fromRadioQOverflow: 0, retransmissions: 0,
    naksReceived: 0, agcCalibFailures: 0, pkiUnknownKeyDmRefused: 0,
    queuePushFailures: 0, safeFileWriteFailures: 0, encryptedStorageLockedSkips: 0,
    encryptionFailures: 0, unsafePowerSaveBlocked: 0,
    adcErrors: 0, espSleepErrors: 0, critLogCount: 0,
    gpsLocksAcquired: 0, gpsSearchFailures: 0, gpsNoLockPublishFailures: 0,
    gpsBufferFullEvents: 0, gpsFrameErrors: 0, gpsStaleDataEvents: 0,
    gpsBogusValueRejects: 0, gpsConfigNacks: 0, gpsNackedMessages: [],
    gpsConfigTimeouts: 0, gpsTimedOutMessages: [], gpsAtgmConfigFailures: 0,
    gpsPowerStateTransitions: 0, rtcDriftCorrections: 0,
    peerTelemetry: {}, peerTelemetryCount: 0, telemetryDecodeErrors: {},
    sensorErrors: [], sensorsNotFound: [], sensorsDropped: [],
    sensorReadFailures: 0, sensorChecksumFailures: 0, sensorFrameErrors: 0,
    sensorClockConflict: [],
    configSaveFailures: 0,
    adminDroppedStorageLocked: 0, adminNoSessionKey: 0,
    unsignedNodeInfoDropped: 0, nodeKeyDowngrade: [],
    keyVerificationFailures: 0, neighborDbFull: 0,
    tracerouteHopLimitExceeded: 0, tracerouteErrors: 0, positionZeroSkipped: 0,
    rxChannelHashCounts: {}, txChannelHashCounts: {},
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

  // "[Router] NOTE! Record critical error N at FILE:N"
  (line, s) => {
    const m = line.match(/Record critical error (\d+) at (\S+):(\d+)/);
    if (!m) return;
    const entry = {code: Number(m[1]), file: m[2], line: Number(m[3])};
    const key = `${entry.code}:${entry.file}:${entry.line}`;
    if (!s.criticalErrors.some((e) => `${e.code}:${e.file}:${e.line}` === key)) {
      s.criticalErrors.push(entry);
    }
  },

  // "X init failed with -N (CODE), retrying" / "X init failed with TCXO Vref N V (err -N), retrying"
  (line, s) => {
    const m = line.match(
        /(\w+) init failed with (?:TCXO Vref [\d.]+ V \(err (-?\d+)\)|(-?\d+)).*retry/i
    );
    if (!m) return;
    s.radioInitRetries++;
    s.radioInitError = m[2] ?? m[3]; // group2 = TCXO branch; group3 = numeric-code branch
    if (m[2] !== undefined) s.tcxoInitFailed = true;
  },

  // "[RadioIf] StartReceive error: -N"
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

  // Generic RadioLib op failure: "SX1262 startReceive RadioLib err=-707"
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

  // "Hardware Failure! busyTx for more than 60s" — radio wedged in TX
  (line, s) => {
    if (/Hardware Failure! busyTx for more than 60s/.test(line)) {
      s.radioBusyTxHardwareFailure = true;
    }
  },

  // "startTransmit failed, error=N"
  (line, s) => {
    const m = line.match(/startTransmit failed, error=(-?\d+)/);
    if (!m) return;
    s.startTransmitFailures++;
    s.lastStartTransmitError = m[1];
  },

  // "caught missed RX_DONE"
  (line, s) => {
    if (/caught missed RX_DONE/.test(line)) s.missedRxDone++;
  },

  // "handleReceiveInterrupt called when not in rx mode" — ISR / state desync
  (line, s) => {
    if (/handleReceiveInterrupt called when not in rx mode/.test(line)) s.rxInterruptWrongMode++;
  },

  // "Reconfigure failed, rebooting" / "LoRa in error detected, attempting to recover"
  (line, s) => {
    if (/Reconfigure failed, rebooting/.test(line)) {
      s.radioRecoveryReboot = true;
      return;
    }
    if (/LoRa in error detected, attempting to recover/.test(line)) s.loraErrorRecoveries++;
  },

  // "does not support 2.4GHz. Revert to unset"
  (line, s) => {
    if (/does not support 2\.4GHz\. Revert to unset/.test(line)) s.unsupported24GhzReverted = true;
  },

  // "0x8B5 patch" / "0x8B5 RX sensitivity patch" — degraded RX sensitivity
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
  // "LR11x0/LR20x0/SX… init success without TCXO (XTAL mode)"
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

  // #202 Packet heard over the air — count per channel-hash byte.
  // Source: printPacket() (RadioInterface.cpp) emits "Lora RX (… Ch=0x%x …)"
  // for every received packet (RadioLibInterface.cpp:615). `Ch` is the
  // single-byte channel hash, so this tallies RX traffic volume per channel.
  (line, s) => {
    const m = line.match(/Lora RX \(.*\bCh=(0x[\da-fA-F]+)/);
    if (!m) return;
    const hash = m[1].toLowerCase();
    s.rxChannelHashCounts[hash] = (s.rxChannelHashCounts[hash] ?? 0) + 1;
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
    s.codingRateOverride || s.packetCounterCorrupted ||
    s.fsOrphan || s.pkiKeysRegenerated || s.factoryReset ||
    s.invalidLoraConfig || s.missingCriticalPrefs.length > 0 ||
    s.taskWatchdogTriggered || s.espPanicBacktrace || s.radioAssertFailed ||
    s.criticalErrors.length > 0 || s.radioInitRetries > 0 || s.warmstoreRingCorrupt ||
    s.deviceStateDiscarded || s.busyTxCount > 5 || s.fromRadioQOverflow > 0 ||
    s.pkiClientKeyMismatch || s.pkiUnknownKeyDmRefused > 0 ||
    s.radioBusyTxHardwareFailure || s.startTransmitFailures > 0 ||
    s.radioRecoveryReboot || s.filesystemMountFailed || s.storageDecryptCorrupt ||
    s.encryptionFailures > 0 || s.queuePushFailures > 0 || s.safeFileWriteFailures > 0 ||
    s.lockdownActive || s.critLogCount > 0 || s.missingPrefs.length > 0 ||
    s.powerChipFailures.length > 0 || s.gpsNotDetected || s.packetHistoryCorrupt ||
    s.enteredDfuMode || s.scheduledReboot || s.adcErrors > 0 ||
    s.tcxoFallbackToXtal || s.gpsSearchFailures > 0 || (s.gpsChecksumFailTotal ?? 0) > 0 ||
    s.gpsBufferFullEvents > 0 || s.gpsFrameErrors > 0 || s.gpsConfigNacks > 0 ||
    s.gpsConfigTimeouts > 0 || s.gpsAtgmConfigFailures > 0 || s.gpsConfigSaveFailed ||
    s.gpsDefaultsMaintained || s.gpsBogusValueRejects > 0 ||
    s.sensorErrors.length > 0 || s.sensorsDropped.length > 0 ||
    s.sensorReadFailures > 0 || s.sensorChecksumFailures > 0 ||
    s.sensorFrameErrors > 0 || s.sensorClockConflict.length > 0 ||
    s.sensorCalibSaveFailed || s.adminConfigSaveFailed ||
    s.configSaveFailures > 0 || s.adminDroppedStorageLocked > 0 ||
    s.adminNoSessionKey > 0 || s.unsignedNodeInfoDropped > 0 ||
    s.nodeInfoLicensedMismatch || s.keyVerificationFailures > 0 ||
    s.storeForwardPsramFull || s.tracerouteErrors > 0 ||
    s.detectionMisconfigured || s.femLnaUnsupported ||
    Object.keys(s.telemetryDecodeErrors).length > 0
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
    const releaseDate = lookupReleaseDate(s.firmware);
    if (releaseDate) cp.push(`released ${releaseDate}`);
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

  if (s.gpsLockTimeSecs !== undefined || s.gpsLocksAcquired > 0) {
    const t = s.gpsLockTimeSecs !== undefined ? `${s.gpsLockTimeSecs}s to lock` : '';
    const c = s.gpsLocksAcquired > 0 ? `×${s.gpsLocksAcquired} acquired` : '';
    modRows.push(['GPS lock', [t, c].filter(Boolean).join(' · '),
      'Time to first fix and lock acquisition count in this session']);
  }

  if (s.gpsConsecutiveLockFailures !== undefined) {
    const cls = s.gpsConsecutiveLockFailures > 3 ? ' class="sum-warn"' : '';
    modRows.push(['GPS failures',
      `<span${cls}>${s.gpsConsecutiveLockFailures} consecutive · ${s.gpsSearchFailures} searches</span>`,
      'Consecutive lock failures (rising = chip blind); resets to 0 on any successful fix']);
  }

  if (s.gpsConstellations) {
    modRows.push(['GNSS', s.gpsConstellations,
      'Constellation configuration acknowledged by the module']);
  }

  if (s.gpsPowerState) {
    const t = s.gpsPowerStateTransitions > 1 ? ` (×${s.gpsPowerStateTransitions} transitions)` : '';
    modRows.push(['GPS power', s.gpsPowerState + t,
      'Most recent GPS power state transition']);
  }

  if (s.gpsUserMode) {
    modRows.push(['GPS mode', s.gpsUserMode,
      'User-toggled GPS enable/disable setting at end of log']);
  }

  if (s.rtcDriftCorrections > 0) {
    const drift = s.lastClockDriftSecs !== undefined ? ` · last ${s.lastClockDriftSecs}s drift` : '';
    const driftStr = `×${s.rtcDriftCorrections} correction${s.rtcDriftCorrections !== 1 ? 's' : ''}${drift}`;
    modRows.push(['Clock drift', driftStr,
      'External time applied to correct RTC drift; frequent or large drift indicates crystal instability']);
  }

  if (s.envTemperature !== undefined || s.envHumidity !== undefined || s.envPressure !== undefined) {
    const parts: string[] = [];
    if (s.envTemperature !== undefined) parts.push(`${s.envTemperature.toFixed(1)}°C`);
    if (s.envHumidity !== undefined) parts.push(`${s.envHumidity.toFixed(1)}%`);
    if (s.envPressure !== undefined) parts.push(`${s.envPressure.toFixed(0)} hPa`);
    if (s.envGasResistance !== undefined) parts.push(`gas ${s.envGasResistance.toFixed(0)}Ω`);
    modRows.push(['Env sensor', parts.join(' · ')]);
  }

  if (s.co2 !== undefined) {
    const extra = s.co2Temp !== undefined ? ` · ${s.co2Temp.toFixed(1)}°C · ${s.co2Humidity?.toFixed(1)}%` : '';
    modRows.push(['CO₂', `${s.co2} ppm${extra}`]);
  }

  if (s.pm25 !== undefined) {
    modRows.push(['PM2.5/10/100', `${s.pm25} / ${s.pm10} / ${s.pm100 ?? '?'} µg/m³`,
      'Particulate matter concentrations (standard units)']);
  }

  if (s.iaq !== undefined || s.lux !== undefined) {
    const parts: string[] = [];
    if (s.iaq !== undefined) parts.push(`IAQ ${s.iaq}`);
    if (s.lux !== undefined) parts.push(`${s.lux.toFixed(0)} lux`);
    if (s.distance !== undefined) parts.push(`dist ${s.distance.toFixed(0)}mm`);
    modRows.push(['Light/IAQ', parts.join(' · ')]);
  }

  if (s.hcho !== undefined) {
    modRows.push(['HCHO/VOC', `${s.hcho.toFixed(3)} mg/m³`]);
  }

  if (s.radiation !== undefined) {
    modRows.push(['Radiation', `${s.radiation} µR/h`]);
  }

  if (s.windSpeed !== undefined) {
    modRows.push(['Wind', `${s.windSpeed.toFixed(1)} m/s · ${s.windDir}°`]);
  }

  if (s.soilTemp !== undefined) {
    modRows.push(['Soil', `${s.soilTemp.toFixed(1)}°C · ${s.soilMoisture}% moisture`]);
  }

  if (s.heartBpm !== undefined) {
    modRows.push(['Health', `${s.heartBpm} bpm · SpO₂ ${s.spo2}%`]);
  }

  if (s.ch1V !== undefined) {
    const inaStr = `CH1 ${s.ch1V?.toFixed(2)}V ${s.ch1I?.toFixed(0)}mA` +
      ` · CH2 ${s.ch2V?.toFixed(2)}V ${s.ch2I?.toFixed(0)}mA`;
    modRows.push(['Power INA', inaStr]);
  }

  if (s.hostUptime !== undefined) {
    const load = s.hostLoad ? `load ${s.hostLoad.map((l) => l.toFixed(2)).join('/')}` : '';
    const disk = s.hostDiskFree !== undefined ? ` · ${fmtBytes(s.hostDiskFree * 1024)} disk free` : '';
    modRows.push(['Host', `${fmtUptime(s.hostUptime)} · ${load}${disk}`]);
  }

  if (s.peerTelemetryCount > 0) {
    const peers = Object.keys(s.peerTelemetry).length;
    modRows.push(['Peer TM', `${s.peerTelemetryCount} samples from ${peers} node${peers !== 1 ? 's' : ''}`,
      'Telemetry received from neighbouring nodes in this log session']);
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
  if (s.fsOrphan) {
    evtRows.push(['Filesystem',
      '<span class="sum-err">LittleFS orphan — flash left inconsistent by interrupted write</span>',
      'LittleFS found an orphaned block: a write was interrupted by a reboot. Settings may fail ' +
      'to persist across reboots — a full erase + reflash is recommended.']);
  }
  if (s.missingCriticalPrefs.length) {
    evtRows.push(['Prefs missing',
      `<span class="sum-warn">${s.missingCriticalPrefs.join(', ')} not loaded — defaults installed</span>`,
      'Persistence-critical prefs could not be read and defaults were installed. Normal on a fresh ' +
      'device, but on a configured device it means saved settings are not surviving reboots.']);
  }
  if (s.factoryReset) {
    evtRows.push(['Factory reset',
      '<span class="sum-err">device performed a full factory reset</span>',
      'A factory-reset command wiped all prefs — node identity and settings are regenerated.']);
  }
  if (s.pkiKeysRegenerated) {
    evtRows.push(['PKI keys',
      '<span class="sum-warn">new key pair generated — node identity changed</span>',
      'The device generated new PKI keys, changing its public key and identity to peers. Unexpected ' +
      'mid-session, this points to security config not persisting.']);
  }
  if (s.invalidLoraConfig) {
    evtRows.push(['LoRa config',
      '<span class="sum-warn">invalid values received — corrected by firmware</span>',
      'The client sent an invalid LoRa config (e.g. coding_rate/spread_factor 0, or a preset ' +
      'incompatible with the region); the firmware substituted corrected values.']);
  }

  // ── New events (94–140) ──────────────────────────────────────────────────────

  if (s.lockdownActive) {
    evtRows.push(['Lockdown',
      `<span class="sum-err">🔒 ${s.lockdownState ?? 'active'}</span>`,
      'Device entered lockdown — may require admin provisioning to recover.']);
  }
  if (s.taskWatchdogTriggered) {
    const task = s.watchdogTask ? ` (starved task: ${s.watchdogTask})` : '';
    evtRows.push(['Task WDT',
      `<span class="sum-err">ESP-IDF task watchdog fired${task}</span>`,
      'The ESP-IDF task watchdog detected a starved task — indicates a blocking loop or deadlock.']);
  }
  if (s.espPanicBacktrace) {
    const pc = s.panicPc ? ` PC: ${s.panicPc}` : '';
    evtRows.push(['Panic',
      `<span class="sum-err">ESP32 panic backtrace${pc}</span>`,
      'A hard fault / panic was triggered. Load the ELF and run addr2line on the backtrace PCs.']);
  }
  if (s.radioAssertFailed) {
    const locs = s.assertLocations.join(', ');
    evtRows.push(['Radio assert',
      `<span class="sum-err">assert failed: ${locs}</span>`,
      'RadioIf assertion tripped — radio driver reached an impossible state. ' +
      'Usually follows SPI_CMD_FAILED or a wedged radio.']);
  }
  if (s.criticalErrors.length > 0) {
    const parts = s.criticalErrors.map((e) => {
      const name = CRIT_ERR[e.code] ?? `code ${e.code}`;
      return `${name} @ ${e.file}:${e.line}`;
    }).join(' · ');
    evtRows.push(['Critical error',
      `<span class="sum-err">${parts}</span>`,
      'Firmware recorded a CriticalErrorCode — see meshtastic/mesh.proto for the enum.']);
  }
  if (s.radioBusyTxHardwareFailure) {
    evtRows.push(['Radio HW fail',
      '<span class="sum-err">busyTx > 60 s — radio wedged in TX</span>',
      'The radio hardware appeared stuck transmitting for over 60 seconds. ' +
      'Antenna, RF stage, or SPI fault. A reset is usually required.']);
  }
  if (s.radioRecoveryReboot) {
    evtRows.push(['LoRa recovery',
      '<span class="sum-err">reconfigure failed — device rebooting</span>',
      'The radio reconfiguration failed and the firmware triggered a reboot to recover.']);
  }
  if (s.warmstoreRingCorrupt) {
    const pages = s.warmstoreBadPages !== undefined ? ` (${s.warmstoreBadPages} bad pages)` : '';
    evtRows.push(['WarmStore',
      `<span class="sum-err">ring unreadable${pages} — node cache empty</span>`,
      'The WarmStore ring buffer had bad pages; the node cache was discarded and will be rebuilt.']);
  }
  if (s.deviceStateDiscarded) {
    evtRows.push(['Device state',
      '<span class="sum-warn">old or invalid, discarded — clean rebuild</span>',
      'The saved device state was an unsupported version; it was discarded and rebuilt from scratch.']);
  }
  if (s.storageDecryptCorrupt) {
    evtRows.push(['Decrypt fail',
      '<span class="sum-err">storage decrypt failed — treated as corrupt</span>',
      'A persisted file could not be decrypted/decoded and was treated as corrupt. ' +
      'Settings may be lost — check encrypted storage key.']);
  }
  if (s.filesystemMountFailed) {
    evtRows.push(['FS mount',
      '<span class="sum-err">filesystem mount failed — storage unavailable</span>',
      'The LittleFS/SPIFFS partition failed to mount. ' +
      'Settings will not persist. A full erase + reflash is likely required.']);
  }
  if (s.encryptionFailures > 0) {
    evtRows.push(['Encrypt fail',
      `<span class="sum-err">×${s.encryptionFailures} encryption / OOM errors</span>`,
      'SafeFile encrypted writes failed — settings may not be persisted. Possible RAM pressure.']);
  }
  if (s.queuePushFailures > 0) {
    evtRows.push(['Queue full',
      `<span class="sum-err">×${s.queuePushFailures} CRIT: queue push failed</span>`,
      'toPhone / MQTT / notification queue pushes failed at CRIT severity — packets were dropped.']);
  }
  if (s.safeFileWriteFailures > 0) {
    evtRows.push(['SafeFile',
      `<span class="sum-warn">×${s.safeFileWriteFailures} write integrity failure</span>`,
      'SafeFile readback hash mismatch or rename failure — a settings write did not complete safely.']);
  }
  if (s.pkiClientKeyMismatch) {
    evtRows.push(['PKI mismatch',
      '<span class="sum-warn">client public key differs from stored key</span>',
      'The connecting client presented a public key that does not match what the node has stored. ' +
      'Could indicate key rotation or a replay attack.']);
  }
  if (s.pkiUnknownKeyDmRefused > 0) {
    evtRows.push(['PKI DM blocked',
      `<span class="sum-warn">×${s.pkiUnknownKeyDmRefused} DM refused (unknown key)</span>`,
      'Direct messages were refused because the destination node\'s public key is not known. ' +
      'The nodes may not have exchanged node-info yet.']);
  }
  if (s.critLogCount > 0) {
    evtRows.push(['CRIT logs',
      `<span class="sum-err">×${s.critLogCount} CRIT-level log lines</span>`,
      s.lastCritLog ? `Last: ${s.lastCritLog}` :
        'CRIT-level lines (queue overflow / unrecoverable storage failures)']);
  }
  if (s.radioInitRetries > 0) {
    const rn = s.radioInitRetries;
    const plural = rn !== 1 ? 'ies' : '';
    const errCode = s.radioInitError ? RADIOLIB_ERR[Number(s.radioInitError)] ?? s.radioInitError : '';
    const errStr = errCode ? ` (${errCode})` : '';
    evtRows.push(['Radio init',
      `<span class="sum-warn">×${rn} init retr${plural}${errStr}</span>`,
      'Radio chip initialisation failed and was retried — usually SPI/power/TCXO instability.']);
  }
  if (s.startTransmitFailures > 0) {
    const err = s.lastStartTransmitError ?
      ` (${RADIOLIB_ERR[Number(s.lastStartTransmitError)] ?? s.lastStartTransmitError})` : '';
    evtRows.push(['TX fail',
      `<span class="sum-warn">×${s.startTransmitFailures} startTransmit failed${err}</span>`,
      'RadioLib startTransmit() returned an error — the radio could not begin a transmission.']);
  }
  if (s.radioStartReceiveErrors > 0) {
    const err = s.lastStartReceiveError ?
      ` (${RADIOLIB_ERR[Number(s.lastStartReceiveError)] ?? s.lastStartReceiveError})` : '';
    evtRows.push(['RX start fail',
      `<span class="sum-warn">×${s.radioStartReceiveErrors} StartReceive error${err}</span>`,
      'RadioIf StartReceive() returned an error — the radio could not be put back into RX mode.']);
  }
  if (s.radioLibErrors.length > 0) {
    const parts = s.radioLibErrors.map((e) => {
      const name = RADIOLIB_ERR[e.code] ?? String(e.code);
      return `${e.radio} ${e.op} ${name}`;
    }).join(' · ');
    evtRows.push(['RadioLib err',
      `<span class="sum-warn">${parts}</span>`,
      'RadioLib returned error codes during radio operations. ' +
      'SPI_CMD_FAILED (-707) is the most common and usually indicates SPI/TCXO instability.']);
  }
  if (s.fromRadioQOverflow > 0) {
    evtRows.push(['RX queue',
      `<span class="sum-warn">×${s.fromRadioQOverflow} fromRadioQ full — packets dropped</span>`,
      'The queue from the radio to the Router overflowed. ' +
      'Usually caused by a burst of traffic faster than the Router can process.']);
  }
  if (s.busyTxCount > 5) {
    const cls = s.busyTxCount > 20 ? 'sum-warn' : '';
    const txt = `×${s.busyTxCount} busyTx`;
    evtRows.push(['busyTx', cls ? `<span class="${cls}">${txt}</span>` : txt,
      'TX was attempted while the radio was already transmitting — indicates TX queue pressure.']);
  }
  if (s.powerChipFailures.length > 0) {
    evtRows.push(['Power chip',
      `<span class="sum-warn">${s.powerChipFailures.join(', ')} init failed</span>`,
      'Power management chip(s) failed to initialise — battery readings and charging control ' +
      'may be unavailable.']);
  }
  if (s.gpsNotDetected) {
    evtRows.push(['GPS', 'not detected — marked absent for this boot',
      'No GNSS module was found during probing or the probe was given up. GPS is disabled.']);
  }
  if (s.tcxoFallbackToXtal) {
    evtRows.push(['TCXO→XTAL',
      '<span class="sum-warn">radio fell back to XTAL oscillator mode</span>',
      'TCXO init failed; radio is running on a crystal oscillator. ' +
      'Expect increased frequency drift, temperature-dependent SNR degradation, and a higher freq offset.']);
  }
  if (s.gpsSearchFailures > 0) {
    const consec = s.gpsConsecutiveLockFailures !== undefined ?
      ` · ${s.gpsConsecutiveLockFailures} consecutive` : '';
    const cls = (s.gpsConsecutiveLockFailures ?? 0) > 3 ? 'sum-warn' : 'sum-note';
    evtRows.push(['GPS search',
      `<span class="${cls}">×${s.gpsSearchFailures} ended without fix${consec}</span>`,
      'GPS searches timed out without acquiring a fix. Rising consecutive-failure count means ' +
      'the chip is blind — check antenna, sky view, and baud rate.']);
  }
  if ((s.gpsChecksumFailTotal ?? 0) > 0) {
    const delta = s.gpsChecksumFailDelta !== undefined ? ` (+${s.gpsChecksumFailDelta} new)` : '';
    evtRows.push(['GPS checksum',
      `<span class="sum-warn">×${s.gpsChecksumFailTotal} NMEA checksum failures${delta}</span>`,
      'NMEA sentence checksum mismatches — EMI, loose wiring, or baud rate mismatch.']);
  }
  if (s.gpsBufferFullEvents > 0) {
    const bytes = s.gpsBufferFullBytes !== undefined ? ` · ${s.gpsBufferFullBytes}B pending` : '';
    evtRows.push(['GPS buffer',
      `<span class="sum-warn">×${s.gpsBufferFullEvents} UART buffer full${bytes}</span>`,
      'GPS UART buffer overran — CPU could not drain it fast enough. Correlate with task-watchdog events.']);
  }
  if (s.gpsFrameErrors > 0) {
    const baud = s.gpsFrameErrorBaud ? ` at ${s.gpsFrameErrorBaud} baud` : '';
    evtRows.push(['GPS framing',
      `<span class="sum-warn">×${s.gpsFrameErrors} UBlox frame error${baud}</span>`,
      'UBlox framing errors indicate a baud rate mismatch between firmware and GPS module.']);
  }
  if (s.gpsStaleDataEvents > 0) {
    evtRows.push(['GPS stale',
      `×${s.gpsStaleDataEvents} stale-data event`,
      'GPS position or time data aged out before a fresh fix arrived.']);
  }
  if (s.gpsBogusValueRejects > 0) {
    evtRows.push(['GPS bogus',
      `×${s.gpsBogusValueRejects} bogus NMEA value rejected`,
      'HDOP or course values were out of range and discarded — malformed NMEA sentences.']);
  }
  if (s.gpsConfigNacks > 0) {
    const msgs = s.gpsNackedMessages.length > 0 ? ` (${s.gpsNackedMessages.join(', ')})` : '';
    evtRows.push(['GPS NACK',
      `<span class="sum-warn">×${s.gpsConfigNacks} config NACKed${msgs}</span>`,
      'The GPS module rejected config commands. Module may be running on defaults (wrong rate/constellation).']);
  }
  if (s.gpsConfigTimeouts > 0) {
    const msgs = s.gpsTimedOutMessages.length > 0 ? ` (${s.gpsTimedOutMessages.join(', ')})` : '';
    evtRows.push(['GPS timeout',
      `<span class="sum-warn">×${s.gpsConfigTimeouts} config no response${msgs}</span>`,
      'GPS module did not respond to config commands — communication problem or wrong baud.']);
  }
  if (s.gpsAtgmConfigFailures > 0) {
    evtRows.push(['ATGM config',
      `<span class="sum-warn">×${s.gpsAtgmConfigFailures} ATGM336H config failure</span>`,
      'ATGM336H could not be configured — NMEA rate, constellation, or update frequency not set.']);
  }
  if (s.gpsConfigSaveFailed) {
    evtRows.push(['GNSS save',
      '<span class="sum-warn">unable to save GNSS module config</span>',
      'Configuration save to the GNSS module failed — settings will not persist across power cycles.']);
  }
  if (s.gpsDefaultsMaintained) {
    evtRows.push(['GNSS defaults',
      '<span class="sum-warn">reconfigure refused — defaults maintained</span>',
      'GNSS module refused constellation reconfiguration; likely a GPS-only module. ' +
      'Multi-constellation config will not take effect.']);
  }
  if (s.gpsProbeCacheStale) {
    evtRows.push(['GPS cache',
      `stale probe cleared${s.gpsStaleProbe ? ` (was ${s.gpsStaleProbe})` : ''}`,
      'Cached GPS module identity was stale and cleared; a fresh probe will run.']);
  }
  if (s.gpsNoLockPublishFailures > 0) {
    evtRows.push(['GPS pub fail',
      `×${s.gpsNoLockPublishFailures} publish skipped (no lock)`,
      'Position publish was skipped because no GPS lock was acquired in time.']);
  }
  if (s.packetHistoryCorrupt) {
    evtRows.push(['Pkt history',
      '<span class="sum-warn">invalid size — reset to default</span>',
      'The packet deduplication history had an invalid size and was reset.']);
  }
  if (s.encryptedStorageLockedSkips > 0) {
    evtRows.push(['Storage locked',
      `<span class="sum-warn">×${s.encryptedStorageLockedSkips} saves skipped (locked)</span>`,
      'Encrypted storage was locked — save operations were skipped. ' +
      'Settings written during lockout are not persisted.']);
  }
  if (s.unsafePowerSaveBlocked > 0) {
    evtRows.push(['Low-power save',
      `<span class="sum-warn">×${s.unsafePowerSaveBlocked} save blocked (unsafe voltage)</span>`,
      'Settings save was refused because battery voltage was too low. ' +
      'Config changes may not survive this reboot.']);
  }
  if (s.adcErrors > 0) {
    evtRows.push(['ADC',
      `<span class="sum-warn">×${s.adcErrors} ADC init/calibration error</span>`,
      'ADC initialisation or calibration failed — battery percentage readings may be unreliable.']);
  }
  if (s.missingPrefs.length > 0) {
    evtRows.push(['Prefs (opt)',
      `${s.missingPrefs.join(', ')} not found — defaults used`,
      'Optional preference files were missing; defaults were installed. ' +
      'Normal on first boot; on an existing device may indicate UI config loss.']);
  }
  if (s.scheduledReboot) {
    evtRows.push(['Reboot sched',
      `rebooting in ${s.scheduledRebootSecs ?? '?'} s`,
      'The firmware scheduled a deliberate reboot (e.g. after a firmware update or config change).']);
  }
  if (s.enteredDfuMode) {
    evtRows.push(['DFU mode',
      '<span class="sum-warn">device entered DFU (firmware update) mode</span>',
      'The device rebooted into DFU mode for a firmware update. Log ends here.']);
  }
  if (s.regionPresetSwap) {
    const {preset, from, to} = s.regionPresetSwap;
    evtRows.push(['Region swap',
      `${preset}: ${from} → ${to}`,
      `The ${preset} preset automatically swapped the region from ${from} to ${to}.`]);
  }
  if (s.configCoerced) {
    evtRows.push(['Config coerce',
      'telemetry/position intervals coerced to role-aware minimum',
      'Config values were below the minimum allowed for the node role and were raised automatically.']);
  }
  if (s.unsupported24GhzReverted) {
    evtRows.push(['2.4 GHz',
      '<span class="sum-warn">chip does not support 2.4 GHz — region reverted to UNSET</span>',
      'A 2.4 GHz frequency was configured but the radio chip does not support it; region was reset.']);
  }
  if (s.rxSensitivityPatchFailed) {
    evtRows.push(['RX patch',
      '<span class="sum-warn">0x8B5 RX sensitivity patch failed</span>',
      'The SX126x RX sensitivity workaround (register 0x8B5 patch) could not be applied. ' +
      'Receive sensitivity may be degraded.']);
  }
  if (s.loraErrorRecoveries > 0) {
    evtRows.push(['LoRa recovery',
      `×${s.loraErrorRecoveries} LoRa-in-error recovery attempted`,
      'The firmware detected a LoRa radio error and attempted to recover without rebooting.']);
  }
  if (s.agcCalibFailures > 0) {
    evtRows.push(['AGC calib',
      `<span class="sum-warn">×${s.agcCalibFailures} calibration timeout</span>`,
      'AGC calibration reset timed out — indicates radio hardware stress or SPI instability.']);
  }
  if (s.missedTxDone > 0 || s.missedRxDone > 0) {
    const parts: string[] = [];
    if (s.missedTxDone > 0) parts.push(`TX_DONE ×${s.missedTxDone}`);
    if (s.missedRxDone > 0) parts.push(`RX_DONE ×${s.missedRxDone}`);
    evtRows.push(['Missed IRQ',
      parts.join(' · '),
      'Radio interrupts were missed (caught and recovered). Occasional occurrences are normal; ' +
      'frequent misses indicate IRQ latency or SPI contention.']);
  }
  if (s.rxInterruptWrongMode > 0) {
    evtRows.push(['RX ISR',
      `<span class="sum-warn">×${s.rxInterruptWrongMode} ISR wrong mode</span>`,
      'handleReceiveInterrupt was called while the radio was not in RX mode — ' +
      'indicates a radio state desync that may cause missed packets.']);
  }
  if (s.espSleepErrors > 0) {
    evtRows.push(['Sleep err',
      `<span class="sum-warn">×${s.espSleepErrors} ESP sleep API error</span>`,
      'esp_light_sleep_start or esp_sleep_enable_*_wakeup returned a non-zero result. ' +
      'Power consumption may be higher than expected.']);
  }
  if (s.retransmissions > 0 || s.naksReceived > 0) {
    const parts: string[] = [];
    if (s.retransmissions > 0) parts.push(`${s.retransmissions} retx`);
    if (s.naksReceived > 0) parts.push(`${s.naksReceived} NAK rcvd`);
    evtRows.push(['Retransmit', parts.join(' · '),
      'Reliable-send retransmissions and NAKs received from peers. ' +
      'High counts indicate poor link quality or congestion.']);
  }

  // ── Sensor / module diagnostics ──────────────────────────────────────────

  if (s.sensorsDropped.length > 0) {
    evtRows.push(['Sensor drop',
      `<span class="sum-warn">${s.sensorsDropped.join(', ')} dropped — can't connect</span>`,
      'Sensor detected on I2C scan but driver could not communicate with it. ' +
      'Check wiring, I2C address, and module variant.']);
  }
  if (s.sensorErrors.length > 0) {
    const parts = s.sensorErrors.map((e) => {
      const code = e.code !== undefined ? ` (${e.code})` : '';
      return `${e.sensor}: ${e.op}${code}`;
    });
    evtRows.push(['Sensor error',
      `<span class="sum-warn">${parts.join(' · ')}</span>`,
      'I2C sensor driver failed an operation. Distinct sensor+op pairs shown; ' +
      'repeated failures are deduplicated.']);
  }
  if (s.sensorReadFailures > 0) {
    evtRows.push(['Sensor read',
      `<span class="sum-warn">×${s.sensorReadFailures} incomplete read</span>`,
      'Sensor returned fewer bytes than expected — intermittent bus fault.']);
  }
  if (s.sensorChecksumFailures > 0) {
    evtRows.push(['Sensor CRC',
      `<span class="sum-warn">×${s.sensorChecksumFailures} checksum mismatch</span>`,
      'Sensor CRC/checksum errors — EMI, loose wiring, or bus contention. ' +
      'Pairs with GPS checksum failures if it is a board-wide bus issue.']);
  }
  if (s.sensorFrameErrors > 0) {
    evtRows.push(['Sensor frame',
      `<span class="sum-warn">×${s.sensorFrameErrors} frame header invalid</span>`,
      'Sensor sent an unrecognised frame header — driver/chip mismatch or partial read.']);
  }
  if (s.sensorClockConflict.length > 0) {
    evtRows.push(['I2C clock',
      `<span class="sum-warn">${s.sensorClockConflict.join(', ')} disabled (screen clock conflict)</span>`,
      'Display forces a slower I2C clock speed that the sensor cannot use. Sensor is disabled.']);
  }
  if (s.sensorCalibSaveFailed) {
    evtRows.push(['Sensor calib',
      '<span class="sum-warn">calibration / state file save failed</span>',
      'BSEC2 or sensor calibration state could not be saved — calibration restarts on next boot.']);
  }
  if (Object.keys(s.telemetryDecodeErrors).length > 0) {
    const parts = Object.entries(s.telemetryDecodeErrors)
        .map(([k, n]) => `${k}×${n}`).join(' · ');
    evtRows.push(['TM decode',
      `<span class="sum-warn">${parts} decode error</span>`,
      'Telemetry protobuf decode failed — packet corruption or firmware mismatch.']);
  }
  if (s.adminConfigSaveFailed || s.configSaveFailures > 0) {
    evtRows.push(['Config save',
      `<span class="sum-warn">×${s.configSaveFailures} config change not saved to disk</span>`,
      'Admin-applied config change was accepted but not persisted. ' +
      'Device will revert to previous config on reboot.']);
  }
  if (s.adminDroppedStorageLocked > 0) {
    evtRows.push(['Admin drop',
      `<span class="sum-warn">×${s.adminDroppedStorageLocked} admin payload dropped (storage locked)</span>`,
      'AdminModule discarded an incoming config payload because storage was locked.']);
  }
  if (s.adminNoSessionKey > 0) {
    evtRows.push(['Admin auth',
      `<span class="sum-warn">×${s.adminNoSessionKey} admin message without session key</span>`,
      'Admin command arrived with no session key — could indicate an older client or replay.']);
  }
  if (s.unsignedNodeInfoDropped > 0) {
    const nodes = s.nodeKeyDowngrade.length > 0 ? ` (${s.nodeKeyDowngrade.join(', ')})` : '';
    const kdSpan = `<span class="sum-err">×${s.unsignedNodeInfoDropped}` +
      ` unsigned NodeInfo from previously-signing node${nodes}</span>`;
    evtRows.push(['Key downgrade', kdSpan,
      'A node that previously signed its NodeInfo sent an unsigned packet — possible key downgrade or spoof.']);
  }
  if (s.nodeInfoLicensedMismatch) {
    evtRows.push(['NodeInfo mismatch',
      '<span class="sum-warn">is_licensed flag mismatch</span>',
      'A NodeInfo packet had an invalid is_licensed state.']);
  }
  if (s.keyVerificationFailures > 0) {
    evtRows.push(['Key verify',
      `<span class="sum-warn">×${s.keyVerificationFailures} Hash2 mismatch</span>`,
      'Key verification (Hash2) failed — possible MitM or tampered packet.']);
  }
  if (s.storeForwardPsramFull) {
    evtRows.push(['S&F PSRAM',
      '<span class="sum-warn">PSRAM full — oldest messages overwritten</span>',
      'Store & Forward buffer exhausted; oldest messages were overwritten by newer ones.']);
  }
  if (s.tracerouteErrors > 0) {
    evtRows.push(['TraceRoute',
      `×${s.tracerouteErrors} alloc/null/self error`,
      'TraceRoute module encountered allocation, null-service, or self-route errors.']);
  }
  if (s.detectionMisconfigured) {
    evtRows.push(['Detection mod',
      '<span class="sum-warn">no monitor pin set — module disabled</span>',
      'Detection Sensor Module has no GPIO monitor pin configured. Module will not function.']);
  }
  if (s.femLnaUnsupported) {
    evtRows.push(['FEM LNA',
      '<span class="sum-warn">LNA mode configured but FEM does not support it</span>',
      'FEM LNA control was requested but the detected FEM chip does not support it.']);
  }
  if (s.invalidSerialConfig) {
    evtRows.push(['Serial mod', '<span class="sum-warn">invalid serial module config</span>',
      'Serial module config was rejected as invalid. Module may not start.']);
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

// Grouped bar chart of packets per channel-hash byte: rx (heard) vs tx (sent).
export function renderChannelHashChart(s: DeviceSummary): string {
  const hashes = [...new Set([
    ...Object.keys(s.rxChannelHashCounts),
    ...Object.keys(s.txChannelHashCounts),
  ])].sort((a, b) => Number(a) - Number(b));
  if (hashes.length === 0) return '';

  const W = 290;
  const H = 110;
  const pL = 22; const pB = 22; const pT = 8; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const n = hashes.length;
  const rx = hashes.map((h) => s.rxChannelHashCounts[h] ?? 0);
  const tx = hashes.map((h) => s.txChannelHashCounts[h] ?? 0);
  const maxVal = Math.max(1, ...rx, ...tx);
  const groupW = cW / n;
  const gap = Math.max(2, groupW * 0.25);
  const barW = (groupW - gap) / 2;
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  for (let i = 0; i < n; i++) {
    const gx = pL + i * groupW + gap / 2;
    const rH = (rx[i] / maxVal) * cH;
    const tH = (tx[i] / maxVal) * cH;
    if (rH > 0) {
      const ry = (pT + cH - rH).toFixed(1);
      parts.push(`<rect x="${gx.toFixed(1)}" y="${ry}" width="${barW.toFixed(1)}" ` +
        `height="${rH.toFixed(1)}" fill="#67EA94" opacity="0.85" rx="1"/>`);
    }
    if (tH > 0) {
      const ty = (pT + cH - tH).toFixed(1);
      parts.push(`<rect x="${(gx + barW).toFixed(1)}" y="${ty}" width="${barW.toFixed(1)}" ` +
        `height="${tH.toFixed(1)}" fill="#a78bfa" opacity="0.75" rx="1"/>`);
    }
    const lx = (gx + barW).toFixed(1);
    const ly = (pT + cH + 14).toFixed(1);
    parts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="8" fill="#6b7280">` +
      `${hashes[i]}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  const legend = `<div class="hc-legend">` +
    `<span class="hc-dot" style="background:#67EA94"></span>heard` +
    `<span class="hc-dot" style="background:#a78bfa;margin-left:8px"></span>sent</div>`;
  return `<div class="hc-section"><div class="hc-label">Packets per channel hash</div>${svg}${legend}</div>`;
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
