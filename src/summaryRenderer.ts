import {DeviceSummary} from './deviceSummary';
import {lookupReleaseDate} from './firmwareReleases';
import {publicChannelHint} from './channelHashNames';

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

// ── Rendering helpers ──────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} KB`;
  return `${n} B`;
}

// Human "clock" duration — shows the two largest relevant units, surfacing
// days / weeks / months only once the uptime is long enough to need them.
function fmtUptime(s: number): string {
  const mo = Math.floor(s / 2592000);          // 30-day months
  const w = Math.floor((s % 2592000) / 604800);
  const d = Math.floor((s % 604800) / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (mo > 0) return `${mo}mo ${w}w`;
  if (w > 0) return `${w}w ${d}d`;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtCoord(raw: number): string {
  return (raw / 1e7).toFixed(5) + '°';
}

// Descriptive / identity / config / status / normal-traffic fields. These do NOT
// make a summary "have events". Everything else on DeviceSummary (and not _-prefixed)
// is treated as a noteworthy event, so newly added fault/event fields surface
// automatically without having to be wired into a central OR. Misclassifying a field
// here is benign in one direction only: forgetting to add a descriptive field makes
// the panel render slightly more eagerly — it can never hide data (the old failure
// mode where an event field omitted from the OR was silently dropped).
const NON_EVENT_FIELDS = new Set<keyof DeviceSummary>([
  // identity
  'hardware', 'hwModelId', 'hwModelSlug', 'displayName', 'deviceImage', 'firmware',
  'buildDate', 'buildVariant', 'nodeId', 'nodeName',
  // radio config
  'radioType', 'radioFirmware', 'radioTcxo', 'radioVref', 'radioFem', 'frequency',
  'bandwidth', 'txPower', 'requestedTxPower', 'txGainDb', 'modemPreset', 'region',
  'freqSlots', 'slotBw', 'loraBitrate', 'slotTimeMs', 'preambleTimeMs', 'radioOscMode',
  // gps identity / position / live status / labels (faults handled as events)
  'gps', 'gpsChipModel', 'localLat', 'localLon', 'localAlt', 'gpsSiv', 'gpsLockTimeSecs',
  'gpsLock', 'gpsSats', 'gpsConstellations', 'gpsPowerState', 'gpsUserMode',
  'gpsLocksAcquired', 'gpsPowerStateTransitions', 'rtcDriftCorrections',
  // i2c / battery
  'i2cDevices', 'accelChipId', 'magChipId',
  'batteryPct', 'batteryMv', 'usbPower', 'isCharging', 'batteryAdcPin',
  // memory / storage gauges
  'heapTotal', 'heapFree', 'psramTotal', 'psramFree', 'nvsUsed', 'nvsFree', 'nvsTotal',
  'fsUsed', 'fsTotal',
  // nodeDB counts / config / RF environment
  'nodeDbVersion', 'nodeDbCount', 'nodeDbPosCount', 'nodeDbTelCount', 'nodeDbEnvCount',
  'nodeDbStatusCount', 'configVersion', 'noiseFloor', 'noiseFloorSamples', 'lastRssi',
  'lastSnr', 'freqOffset',
  // boot info (descriptive)
  'rebootCount', 'wakeSource', 'bootCount', 'resetReason', 'espRstCode', 'resetReasonCode',
  // packet stats / telemetry / normal traffic & history
  'txGood', 'txRelay', 'rxGood', 'rxBad', 'uptime', 'numPacketsTx', 'numPacketsRx',
  'numPacketsRxBad', 'airUtilTx', 'channelUtil', 'numOnlineNodes', 'numTotalNodes',
  'nodeCountHistory', 'rxChannelHashCounts', 'decodedChannelHashCounts',
  'txChannelHashCounts', 'dupChannelHashCounts', 'seenNodes', 'boots', 'txEnqueued',
  'txCompleted', 'retransmissions', 'naksReceived',
  // hop scaling
  'hopLimit', 'hopFill', 'hopPolite', 'hopNextRoll', 'hopPerHop', 'hopScaledPerHop',
  'hopSeenPerHour',
  // warmstore / ble / mqtt / beacon / text (descriptive)
  'warmstoreLiveNodes', 'bleConnections', 'bleDisconnections', 'bleConnectedTo',
  'mqttProxyMode', 'mqttState', 'lastBeaconMsg', 'lastBeaconFrom', 'lastMessage',
  'lastMessageFrom',
  // radio driver descriptive (last-values / labels; fault flags stay events)
  'radioInitError', 'radioInitSucceeded', 'configuredRadioMissingName',
  'lastStartReceiveError', 'lastStartTransmitError',
  // informational
  'configCoerced', 'meshDbPurged', 'scheduledRebootSecs', 'regionPresetSwap', 'tmFlags',
  'lastNextHopDest', 'lastNextHop', 'lastCritLog',
  // local sensor readings (normal measurements)
  'envPressure', 'envCurrent', 'envGasResistance', 'envHumidity', 'envTemperature',
  'pm10', 'pm25', 'pm100', 'co2', 'co2Temp', 'co2Humidity', 'hcho', 'hchoTemp',
  'hchoHumidity', 'iaqVoltage', 'iaq', 'distance', 'lux', 'soilTemp', 'soilMoisture',
  'healthTemp', 'heartBpm', 'spo2', 'radiation', 'windSpeed', 'windDir', 'weight',
  'ch1V', 'ch1I', 'ch2V', 'ch2I', 'hostUptime', 'hostDiskFree', 'hostMemFree', 'hostLoad',
  // peer telemetry / traceroute results (descriptive)
  'peerTelemetry', 'peerTelemetryCount', 'traceroutes', 'tracerouteLastHops',
  'tracerouteMaxHops', 'tracerouteWorstSnr', 'tracerouteHopSnrs',
]);

// A field "counts" as present (a real value, not its empty default).
function isPresent(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set) return v.size > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return false;
}

export function renderSummary(s: DeviceSummary): string {
  const hasNak = Object.keys(s.nakErrors).length > 0;
  const hasEvents = (Object.keys(s) as (keyof DeviceSummary)[]).some(
      (k) => !String(k).startsWith('_') && !NON_EVENT_FIELDS.has(k) && isPresent(s[k]),
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

  if (s.traceroutes) {
    const hops = s.tracerouteLastHops !== undefined ?
      `${s.tracerouteLastHops} hop${s.tracerouteLastHops === 1 ? '' : 's'}` : '';
    const peak = (s.tracerouteMaxHops ?? 0) > (s.tracerouteLastHops ?? 0) ?
      ` <span style="color:var(--muted)">(max ${s.tracerouteMaxHops})</span>` : '';
    const snr = s.tracerouteWorstSnr !== undefined ?
      ` <span style="color:var(--muted)">worst ${s.tracerouteWorstSnr.toFixed(2)} dB</span>` : '';
    const count = s.traceroutes > 1 ? ` ×${s.traceroutes}` : '';
    modRows.push(['Traceroute', `${hops}${peak}${snr}${count}`,
      'Routes reassembled from "Route traced:" + the prefix-less hop line(s) that follow it']);
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

  // ── Nodes seen ──────────────────────────────────────────────────────────────
  const sortedNodes = Object.entries(s.seenNodes).sort(([, a], [, b]) => b.heard - a.heard);
  const nodeRows: Array<[string, string, string?]> = [];
  for (const [nodeId, ns] of sortedNodes.slice(0, 10)) {
    const avgHops = ns.hopCount > 0 ? ` · ${(ns.hopSum / ns.hopCount).toFixed(1)} hops` : '';
    const dec = ns.decoded > 0 ? ` · ${ns.decoded} dec` : '';
    const chans = Object.keys(ns.channels).join(' ');
    nodeRows.push([nodeId, `${ns.heard} heard${dec}${avgHops}`, chans || undefined]);
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
  const totalNodes = sortedNodes.length;
  const nodeDivider = nodeRows.length ?
    `<div class="sum-divider">NODES SEEN (${totalNodes})</div>` : '';

  // Remove the spacer row we added earlier (it was a placeholder for the divider)
  const filteredRows = rows.filter(([l, v]) => l !== '' || v !== '');

  const grid = '<div class="sum-grid">' +
    filteredRows.map(renderRow).join('') +
    memDivider + memRows.map(renderRow).join('') +
    modDivider + modRows.map(renderRow).join('') +
    evtDivider + evtRows.map(renderRow).join('') +
    nodeDivider + nodeRows.map(renderRow).join('') +
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
function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderChannelHashChart(s: DeviceSummary): string {
  const hashes = [...new Set([
    ...Object.keys(s.rxChannelHashCounts),
    ...Object.keys(s.decodedChannelHashCounts),
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
  const dec = hashes.map((h) => s.decodedChannelHashCounts[h] ?? 0);
  const dup = hashes.map((h) => s.dupChannelHashCounts[h] ?? 0);
  const tx = hashes.map((h) => s.txChannelHashCounts[h] ?? 0);
  const maxVal = Math.max(1, ...rx, ...dec.map((d, i) => d + dup[i]), ...tx);
  const groupW = cW / n;
  const gap = Math.max(2, groupW * 0.2);
  const barW = (groupW - gap) / 3;
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  for (let i = 0; i < n; i++) {
    const gx = pL + i * groupW + gap / 2;
    const rH = (rx[i] / maxVal) * cH;
    const dH = (dec[i] / maxVal) * cH;
    const uH = (dup[i] / maxVal) * cH;
    const tH = (tx[i] / maxVal) * cH;
    const g: string[] = [];
    // Transparent full-column hit area so the hover tooltip covers the whole group.
    g.push(`<rect x="${(pL + i * groupW).toFixed(1)}" y="${pT}" ` +
      `width="${groupW.toFixed(1)}" height="${cH}" fill="transparent"/>`);
    if (rH > 0) {
      const ry = (pT + cH - rH).toFixed(1);
      g.push(`<rect x="${gx.toFixed(1)}" y="${ry}" width="${barW.toFixed(1)}" ` +
        `height="${rH.toFixed(1)}" fill="#67EA94" opacity="0.85" rx="1"/>`);
    }
    if (dH > 0) {
      const dy = (pT + cH - dH).toFixed(1);
      g.push(`<rect x="${(gx + barW).toFixed(1)}" y="${dy}" width="${barW.toFixed(1)}" ` +
        `height="${dH.toFixed(1)}" fill="#38bdf8" opacity="0.85" rx="1"/>`);
    }
    if (uH > 0) {
      const uy = (pT + cH - dH - uH).toFixed(1);
      g.push(`<rect x="${(gx + barW).toFixed(1)}" y="${uy}" width="${barW.toFixed(1)}" ` +
        `height="${uH.toFixed(1)}" fill="#7dd3fc" opacity="0.75" rx="1"/>`);
    }
    if (tH > 0) {
      const ty = (pT + cH - tH).toFixed(1);
      g.push(`<rect x="${(gx + 2 * barW).toFixed(1)}" y="${ty}" width="${barW.toFixed(1)}" ` +
        `height="${tH.toFixed(1)}" fill="#a78bfa" opacity="0.75" rx="1"/>`);
    }
    const lx = (gx + barW * 1.5).toFixed(1);
    const ly = (pT + cH + 14).toFixed(1);
    g.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="8" fill="#6b7280">` +
      `${hashes[i]}</text>`);
    const hint = publicChannelHint(Number(hashes[i]));
    const title = `Ch ${hashes[i]} — heard ${rx[i]}, decoded ${dec[i]}, ` +
      `dup ${dup[i]}, sent ${tx[i]}` +
      (hint ? `\nPossible public channels:\n${hint}` : '\n(no known public preset)');
    parts.push(`<g><title>${xmlEscape(title)}</title>${g.join('')}</g>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  const legend = `<div class="hc-legend">` +
    `<span class="hc-dot" style="background:#67EA94"></span>heard` +
    `<span class="hc-dot" style="background:#38bdf8;margin-left:8px"></span>decoded` +
    `<span class="hc-dot" style="background:#7dd3fc;margin-left:8px"></span>dup` +
    `<span class="hc-dot" style="background:#a78bfa;margin-left:8px"></span>sent</div>`;
  return `<div class="hc-section"><div class="hc-label">Packets per channel hash</div>${svg}${legend}</div>`;
}

// A text tile showing the latest node-status snapshot (from the most recent
// "Node status update" / DeviceTelemetry broadcast).
export function renderNodeStatusTile(s: DeviceSummary): string {
  const rows: Array<[string, string]> = [];
  if (s.numOnlineNodes !== undefined) {
    rows.push(['Mesh nodes', `${s.numOnlineNodes} online / ${s.numTotalNodes ?? '?'} total`]);
  }
  if (s.batteryPct !== undefined) {
    const v = s.batteryMv ? ` · ${(Number(s.batteryMv) / 1000).toFixed(2)} V` : '';
    const charge = s.usbPower ? ' ⚡' : '';
    const pct = s.batteryPct === '101' ? 'USB / external' : `${s.batteryPct}%`;
    rows.push(['Battery', `${pct}${v}${charge}`]);
  }
  if (s.channelUtil !== undefined) {
    const air = s.airUtilTx !== undefined ? ` · TX ${s.airUtilTx}%` : '';
    rows.push(['Channel', `util ${s.channelUtil}%${air}`]);
  }
  if (s.uptime !== undefined) rows.push(['Uptime', fmtUptime(s.uptime)]);
  if (rows.length === 0) return '';
  const body = rows.map(([k, v]) =>
    `<div class="ns-row"><span class="ns-k">${k}</span><span class="ns-v">${v}</span></div>`,
  ).join('');
  return `<div class="hc-section"><div class="hc-label">Node status</div>` +
    `<div class="ns-tile">${body}</div></div>`;
}

// Two overlaid lines (online + total mesh nodes) over the recorded samples.
// Only rendered when at least two distinct samples exist.
export function renderNodeCountChart(s: DeviceSummary): string {
  const hist = s.nodeCountHistory;
  if (hist.length < 2) return '';
  const W = 290;
  const H = 110;
  const pL = 22; const pB = 22; const pT = 8; const pR = 6;
  const cW = W - pL - pR;
  const cH = H - pT - pB;
  const n = hist.length;
  const maxVal = Math.max(1, ...hist.map((p) => p.total));
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  const xAt = (i: number): number => pL + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
  const yAt = (v: number): number => pT + cH - (v / maxVal) * cH;
  const line = (key: 'online' | 'total', color: string): string => {
    const pinned = hist.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p[key]).toFixed(1)}`).join(' ');
    return `<polyline points="${pinned}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
  };
  parts.push(line('total', '#a78bfa'));
  parts.push(line('online', '#67EA94'));

  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">` +
    parts.join('') + `</svg>`;
  const legend = `<div class="hc-legend">` +
    `<span class="hc-dot" style="background:#67EA94"></span>online` +
    `<span class="hc-dot" style="background:#a78bfa;margin-left:8px"></span>total</div>`;
  return `<div class="hc-section"><div class="hc-label">Mesh nodes over time</div>${svg}${legend}</div>`;
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
  // Side-by-side grouped bars, so the y-axis is the per-bar max (not the sum).
  const maxVal = Math.max(1, ...base, ...scaled);
  const groupW = cW / n;
  const gap = Math.max(2, groupW * 0.25);
  const barW = (groupW - gap) / 2;
  const parts: string[] = renderGridLines(pL, cW, pT, cH, maxVal);

  for (let i = 0; i < n; i++) {
    const gx = pL + i * groupW + gap / 2;
    const bv = base[i] ?? 0;
    const sv = scaled[i] ?? 0;
    const bH = (bv / maxVal) * cH;
    const sH = (sv / maxVal) * cH;
    if (bH > 0) {
      const ry = (pT + cH - bH).toFixed(1);
      parts.push(`<rect x="${gx.toFixed(1)}" y="${ry}" width="${barW.toFixed(1)}" ` +
        `height="${bH.toFixed(1)}" fill="#67EA94" opacity="0.85" rx="1"/>`);
    }
    if (sH > 0) {
      const ry = (pT + cH - sH).toFixed(1);
      parts.push(`<rect x="${(gx + barW).toFixed(1)}" y="${ry}" width="${barW.toFixed(1)}" ` +
        `height="${sH.toFixed(1)}" fill="#a78bfa" opacity="0.75" rx="1"/>`);
    }
    const lx = (gx + barW).toFixed(1);
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

// Per-channel-hash node tables for the data tab.
// One hc-section per channel hash, listing every node heard on that channel.
export function renderSeenNodesTable(s: DeviceSummary): string {
  const entries = Object.entries(s.seenNodes);
  if (entries.length === 0) return '';

  const allHashes = [...new Set(
      entries.flatMap(([, ns]) => Object.keys(ns.channels)),
  )].sort((a, b) => Number(a) - Number(b));

  const sections: string[] = [];

  for (const hash of allHashes) {
    const channelNodes = entries
        .filter(([, ns]) => (ns.channels[hash] ?? 0) > 0)
        .sort(([, a], [, b]) => (b.channels[hash] ?? 0) - (a.channels[hash] ?? 0));
    if (channelNodes.length === 0) continue;

    const hint = publicChannelHint(Number(hash));
    const hintStr = hint ? ` · ${hint.split('\n')[0]}` : '';
    const chRx = s.rxChannelHashCounts[hash] ?? 0;
    const chDec = s.decodedChannelHashCounts[hash] ?? 0;
    const chDup = s.dupChannelHashCounts[hash] ?? 0;
    const statsStr = ` · ${chRx} heard · ${chDec} decoded · ${chDup} dup`;

    const hdr = `<tr class="node-hdr">` +
      `<th>Node</th><th title="Heard on this channel">Heard</th>` +
      `<th title="Total decoded packets from this node">Decoded</th>` +
      `<th title="Relay-echo duplicates from this node">Dup</th>` +
      `<th title="Average hops (hopStart − HopLim)">Avg hop</th>` +
      `<th title="Minimum hops observed — 0 = direct neighbor">Min hop</th>` +
      `<th>RSSI</th><th>SNR</th>` +
      `<th title="Channel index 0-7 from the last decoded packet">Ch#</th></tr>`;

    const rowsHtml = channelNodes.map(([nodeId, ns]) => {
      const chHeard = ns.channels[hash] ?? 0;
      const avg = ns.hopCount > 0 ? (ns.hopSum / ns.hopCount).toFixed(1) : '—';
      const min = isFinite(ns.hopMin) ? String(ns.hopMin) : '—';
      const rssi = ns.lastRssi !== undefined ? String(ns.lastRssi) : '—';
      const snr = ns.lastSnr !== undefined ? ns.lastSnr.toFixed(1) : '—';
      const chIdx = ns.lastChannelIndex !== undefined ? String(ns.lastChannelIndex) : '—';
      return `<tr><td><code>${nodeId}</code></td>` +
        `<td>${chHeard}</td><td>${ns.decoded}</td><td>${ns.dup}</td>` +
        `<td>${avg}</td><td>${min}</td>` +
        `<td>${rssi}</td><td>${snr}</td><td>${chIdx}</td></tr>`;
    }).join('');

    sections.push(
        `<div class="hc-section">` +
        `<div class="hc-label">NODES ON Ch ${hash}${hintStr}${statsStr}</div>` +
        `<div class="node-table-wrap">` +
        `<table class="node-table">${hdr}${rowsHtml}</table>` +
        `</div></div>`,
    );
  }

  return sections.join('');
}
