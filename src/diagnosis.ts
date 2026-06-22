import {DeviceSummary} from './logSummary';

interface Finding {
  title: string;
  detail?: string;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function item(f: Finding): string {
  const det = f.detail ? `<div class="diag-detail">${esc(f.detail)}</div>` : '';
  return `<div class="diag-item"><div class="diag-title">${esc(f.title)}</div>${det}</div>`;
}

function group(cls: string, icon: string, label: string, findings: Finding[]): string {
  if (findings.length === 0) return '';
  return (
    `<div class="diag-group ${cls}">` +
    `<div class="diag-header">${icon} ${label}</div>` +
    findings.map(item).join('') +
    '</div>'
  );
}

export function renderDiagnosis(s: DeviceSummary): string {
  const crit: Finding[] = [];
  const warn: Finding[] = [];
  const info: Finding[] = [];

  // ── CRITICAL ───────────────────────────────────────────────────────────────

  if (s.espPanicBacktrace) {
    crit.push({title: 'ESP32 crash — panic backtrace captured',
      detail: s.panicPc ? `First PC: ${s.panicPc}. See INTEREST tab for full trace.` : undefined});
  }
  if (s.taskWatchdogTriggered) {
    crit.push({title: 'Task watchdog fired — possible infinite loop or starvation',
      detail: s.watchdogTask ? `Starved task: ${s.watchdogTask}` : undefined});
  }
  if (s.criticalErrors.length > 0) {
    const n = s.criticalErrors.length;
    const e = s.criticalErrors[0];
    crit.push({title: `Critical hardware error${n > 1 ? 's' : ''} (${n})`,
      detail: `Code ${e.code} at ${e.file}:${e.line}`});
  }
  if (s.filesystemMountFailed) {
    crit.push({title: 'Filesystem mount failed — settings cannot load or save',
      detail: 'Check flash integrity. A re-flash or factory reset may be required.'});
  }
  if (s.storageDecryptCorrupt) {
    crit.push({title: 'Encrypted storage corrupted — config may not load',
      detail: 'Factory reset will clear corrupted state.'});
  }
  if (s.missingCriticalPrefs.length > 0) {
    crit.push({title: 'Critical preferences failed to load (nodes or config lost)',
      detail: s.missingCriticalPrefs.join(', ')});
  }
  if (s.radioInitError) {
    crit.push({title: 'Radio failed to initialise', detail: s.radioInitError});
  }

  // ── WARNING ────────────────────────────────────────────────────────────────

  if (s.buildDate) {
    const days = Math.floor((Date.now() - new Date(s.buildDate).getTime()) / 86400000);
    if (days >= 180) {
      warn.push({title: `Firmware is ${Math.round(days / 30)} months old (built ${s.buildDate})`,
        detail: 'Consider upgrading to a recent stable release.'});
    }
  }
  if (s.firmware) {
    const vl = s.firmware.toLowerCase();
    const tag = vl.includes('alpha') ? 'alpha' :
      vl.includes('beta') ? 'beta' :
      vl.includes('rc') ? 'release candidate' : null;
    if (tag) {
      warn.push({title: `Running ${tag} pre-release firmware (${s.firmware})`,
        detail: 'Pre-release builds may be unstable or have known bugs.'});
    }
  }
  if (s.region === 'UNSET') {
    warn.push({title: 'LoRa region not configured — device will not transmit',
      detail: 'Set the region via the app or CLI before deployment.'});
  }
  const rxTotal = (s.rxBad ?? 0) + (s.rxGood ?? 0);
  if (rxTotal >= 20 && (s.rxBad ?? 0) / rxTotal >= 0.10) {
    const pct = ((s.rxBad! / rxTotal) * 100).toFixed(1);
    warn.push({title: `High packet error rate (${pct}% of ${rxTotal} received)`,
      detail: 'Check antenna connection, power supply stability, or channel congestion.'});
  }
  if (s.channelUtil !== undefined && parseFloat(s.channelUtil) >= 50) {
    warn.push({title: `Channel utilisation high (${s.channelUtil}%)`,
      detail: 'Mesh may be saturated. Reduce telemetry frequency, TX power, or hop limit.'});
  }
  if (s.dutyCycleHits > 0) {
    warn.push({title: `Hit regulatory duty-cycle limit (${s.dutyCycleHits}×)`,
      detail: 'Transmissions were suppressed by the duty-cycle limiter. ' +
        'Reduce TX frequency, power, or check region config.'});
  }
  if ((s.gpsConsecutiveLockFailures ?? 0) >= 3) {
    warn.push({title: `GPS failing to acquire lock (${s.gpsConsecutiveLockFailures} consecutive)`,
      detail: 'GPS chip may be faulty, antenna disconnected, or device is indoors with no sky view.'});
  }
  if (s.watchdogReset || s.espRstCode === 'RTCWDT_RTC_RESET' || s.espRstCode === 'TG1WDT_SYS_RESET') {
    warn.push({title: 'Previous reboot was a watchdog reset',
      detail: s.espRstCode ? `Reset code: ${s.espRstCode}` : undefined});
  }
  if (s.retransmissions > 20) {
    warn.push({title: `High retransmission count (${s.retransmissions})`,
      detail: 'Indicates poor mesh link quality or high channel utilisation.'});
  }
  if (s.heapFree !== undefined && s.heapFree < 20000) {
    warn.push({title: `Very low heap memory (${Math.round(s.heapFree / 1024)} KB free)`,
      detail: 'Risk of out-of-memory crash. Disable unused features or use a higher-RAM device.'});
  }
  if (s.fsOrphan) {
    warn.push({title: 'LittleFS orphan found — filesystem inconsistency',
      detail: 'Can worsen over time. A factory reset will clean the filesystem.'});
  }
  if (s.pkiKeysRegenerated) {
    warn.push({title: 'PKI keys regenerated — node identity changed',
      detail: 'Contacts will lose DM encryption channels until keys are re-exchanged.'});
  }
  if (s.adminConfigSaveFailed || s.configSaveFailures > 2) {
    warn.push({title: 'Configuration not persisting to storage',
      detail: `${s.configSaveFailures} save failure${s.configSaveFailures !== 1 ? 's' : ''} ` +
        '— changes may be lost on reboot.'});
  }
  if (s.radioLibErrors.length > 0) {
    const n = s.radioLibErrors.length;
    const sample = s.radioLibErrors.slice(0, 2)
        .map((e) => `${e.radio} ${e.op}: ${e.code}`).join('; ');
    warn.push({title: `RadioLib errors (${n} event${n !== 1 ? 's' : ''})`, detail: sample});
  }
  if (s.radioRecoveryReboot) {
    warn.push({title: 'Radio entered recovery reboot cycle',
      detail: 'Repeated radio failures triggered automatic reboot. Check SPI bus connections.'});
  }
  if (s.warmstoreRingCorrupt || s.deviceStateDiscarded) {
    warn.push({title: 'Node database or WarmStore state was reset',
      detail: s.warmstoreRingCorrupt ?
        'WarmStore ring buffer corrupt — mesh history lost.' :
        'Device state (NodeDB/WarmStore) was discarded and rebuilt from scratch.'});
  }
  if (s.lockdownActive) {
    warn.push({title: 'Storage lockdown is active — admin commands rejected',
      detail: s.lockdownState ? `State: ${s.lockdownState}` : undefined});
  }
  if (s.busyRxCount > 20) {
    warn.push({title: `Frequent RX-busy collisions (${s.busyRxCount})`,
      detail: 'Multiple simultaneous transmitters. Adjust hop limit or spread-factor.'});
  }
  if (s.channelDecodeFailures > 10) {
    warn.push({title: `Repeated channel decode failures (${s.channelDecodeFailures})`,
      detail: 'Possible wrong PSK, firmware mismatch between nodes, or RF interference.'});
  }
  const totalNaks = Object.values(s.nakErrors).reduce((a, b) => a + b, 0);
  if (totalNaks > 30) {
    const top = Object.entries(s.nakErrors).sort(([, a], [, b]) => b - a)[0];
    warn.push({title: `Excessive NAK errors (${totalNaks} total)`,
      detail: top ? `Most frequent: ${top[0]} (${top[1]})` : undefined});
  }
  if (s.safeFileWriteFailures > 5) {
    warn.push({title: `Repeated safe-file write failures (${s.safeFileWriteFailures})`,
      detail: 'Filesystem may be full or flash is wearing. Check available space.'});
  }
  if (s.fromRadioQOverflow > 0) {
    warn.push({title: `Radio→app queue overflow (${s.fromRadioQOverflow} times)`,
      detail: 'Packets received faster than the app can consume them — some may be lost.'});
  }

  // ── INFO ───────────────────────────────────────────────────────────────────

  if (s.buildVariant && s.buildVariant !== 'meshtastic/firmware') {
    info.push({title: `Custom firmware fork: ${s.buildVariant}`,
      detail: 'Not an official Meshtastic release — may behave differently or have unique bugs.'});
  }
  if (s.tcxoFallbackToXtal) {
    info.push({title: 'Radio oscillator in XTAL mode (no TCXO detected)',
      detail: 'Frequency accuracy slightly reduced. Normal for hardware without a TCXO.'});
  }
  if (s.factoryReset) {
    info.push({title: 'Factory reset performed during this session',
      detail: 'All settings cleared — device needs reconfiguration.'});
  }
  if (s.sensorsDropped.length > 0) {
    const n = s.sensorsDropped.length;
    info.push({title: `Sensor${n > 1 ? 's' : ''} detected on I²C but dropped by driver`,
      detail: s.sensorsDropped.join(', ') + ' — check wiring or I²C address configuration.'});
  }
  if (s.nodeKeyDowngrade.length > 0 || s.unsignedNodeInfoDropped > 0) {
    const detail = s.nodeKeyDowngrade.length > 0 ?
      `Nodes: ${s.nodeKeyDowngrade.slice(0, 3).join(', ')}` :
      `${s.unsignedNodeInfoDropped} unsigned NodeInfo packet` +
        `${s.unsignedNodeInfoDropped !== 1 ? 's' : ''} dropped`;
    info.push({title: 'Possible key-downgrade or spoofing attempt observed', detail});
  }
  if (s.storeForwardPsramFull) {
    info.push({title: 'Store & Forward PSRAM buffer full — old messages overwritten',
      detail: 'Reduce message retention period or lower S&F record count.'});
  }
  if (s.noHwRng) {
    info.push({title: 'No hardware random number generator (HWRNG)',
      detail: 'Cryptographic entropy relies on software PRNG — may be weaker on first boot.'});
  }
  if (s.securityWarning) {
    info.push({title: 'Security warning logged',
      detail: 'Check the INTEREST tab or raw log for details.'});
  }
  if (s.positionZeroSkipped > 0 && !s.gpsLock) {
    info.push({title: `Position updates suppressed — no GPS fix yet (${s.positionZeroSkipped}×)`,
      detail: 'Zero-coordinate packets filtered until GPS acquires a fix. Normal behaviour.'});
  }
  if (s.reliableSendFailures > 10) {
    info.push({title: `Reliable send failures (${s.reliableSendFailures})`,
      detail: 'Messages sent with ACK request did not receive a reply within timeout.'});
  }

  if (crit.length === 0 && warn.length === 0 && info.length === 0) {
    return '<div class="diag-none">No notable issues detected in this log.</div>';
  }

  return (
    group('diag-crit', '⚡', 'CRITICAL', crit) +
    group('diag-warn', '⚠', 'WARNING', warn) +
    group('diag-info', 'ℹ', 'INFO', info)
  );
}
