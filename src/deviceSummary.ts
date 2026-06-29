import {MultiLineState, createMultiLineState} from './multiLineMatch';

export interface NodeStats {
  heard: number;
  decoded: number;
  dup: number;
  hopSum: number;
  hopCount: number;
  hopMin: number;       // Infinity until first valid hop measurement
  channels: Record<string, number>; // channel hash → heard count
  lastRssi?: number;
  lastSnr?: number;
  lastChannelIndex?: number;         // channel slot 0-7 from the last decoded packet
}

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
  // Online/total node counts over time (deduped — one point per change)
  nodeCountHistory: Array<{online: number; total: number}>;

  // Packets per channel-hash byte (the "Ch=0xNN" field in printPacket lines).
  // rx = heard over the air ("Lora RX"); decoded = successfully decoded by Router; tx = transmitted.
  rxChannelHashCounts: Record<string, number>;
  decodedChannelHashCounts: Record<string, number>;
  txChannelHashCounts: Record<string, number>;

  // Duplicate relay-echo counts per channel hash: packets heard again for an id already seen.
  dupChannelHashCounts: Record<string, number>;

  // Transient correlation state: packet id → channel hash, populated on "Lora RX" and
  // consumed on "decoded message". Not for display; cleared on boot reset.
  _rxHashById: Record<string, string>;
  // All packet ids seen this boot — used to detect relay-echo duplicates.
  _seenPacketIds: Set<string>;

  // Per-node aggregated stats for nodes heard over the air this session.
  seenNodes: Record<string, NodeStats>;

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
  radioInitSucceeded?: boolean;       // a radio driver reported "init success" / "init result 0"
  configuredRadioNotFound?: boolean;  // "No <chip> radio with TCXO/XTAL" — fitted radio never answered
  configuredRadioMissingName?: string; // chip name from that line (e.g. "SX1262")
  scanChannelFailures: number;        // "scanChannel RadioLib err=" — CAD never completes (DIO1/IRQ)
  boots: number;                      // count of S:B boot lines (cumulative: reboot-loop detection)
  txEnqueued: number;                 // "enqueue for send (" — packets handed to the radio
  txCompleted: number;                // "Started Tx (" / "Completed sending (" — TX actually keyed
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

  // ── Multi-line / correlated events (multiLineMatch.ts) ─────────────────────
  // Traceroute results (M1) — one logical event per "Route traced:" + route lines.
  traceroutes?: number;
  tracerouteLastHops?: number;
  tracerouteMaxHops?: number;
  tracerouteWorstSnr?: number;     // weakest per-hop SNR seen (dB)
  tracerouteHopSnrs: number[];     // every per-hop SNR collected (dB)
  // NodeDB / prefs write failure (M2) — four loose ERROR lines correlated into one.
  nodeDbWriteFailures?: number;
  nodeDbWriteFailure?: {
    cause?: string;                // nanopb error from "can't encode protobuf …" (e.g. "invalid utf8")
    retried: boolean;              // saw "Failed to save to disk, retrying"
    cantWritePrefs: boolean;       // saw "Can't write prefs!"
    critCode?: number;             // FLASH_CORRUPTION critical-error code (12/13) if part of the cluster
  };

  // Transient multi-line matcher state (not displayed; reset on boot).
  _ml: MultiLineState;
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
    scanChannelFailures: 0, boots: 0, txEnqueued: 0, txCompleted: 0,
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
    rxChannelHashCounts: {}, decodedChannelHashCounts: {}, txChannelHashCounts: {},
    dupChannelHashCounts: {},
    _rxHashById: {}, _seenPacketIds: new Set(),
    seenNodes: {},
    nodeCountHistory: [],
    tracerouteHopSnrs: [],
    _ml: createMultiLineState(),
  };
}
