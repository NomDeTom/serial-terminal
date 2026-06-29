import { DeviceSummary } from './deviceSummary';

interface Finding {
  title: string;
  detail?: string;
}

// RadioLib TypeDef.h codes reachable on SX126x/LR11x0/LR2021/RF95 Meshtastic paths.
// Source: coverage-additional.md §RadioLib error reference.
const RADIOLIB_NAME: Record<number, string> = {
  [-2]: 'CHIP_NOT_FOUND', // Radio not on SPI bus; wiring or dead chip
  [-3]: 'MEMORY_ALLOCATION_FAILED', // Heap exhaustion during radio init
  [-5]: 'TX_TIMEOUT', // TX never asserted done; antenna/RF fault
  [-6]: 'RX_TIMEOUT', // RX window elapsed, often benign
  [-7]: 'CRC_MISMATCH', // Corrupted reception; noise/antenna/interference
  [-16]: 'SPI_WRITE_FAILED', // SPI readback mismatch; bus integrity problem
  [-703]: 'INVALID_TCXO_VOLTAGE', // TCXO Vref out of range; triggers XTAL fallback
  [-705]: 'SPI_CMD_TIMEOUT', // Radio stopped responding; busy line / power / clock
  [-706]: 'SPI_CMD_INVALID', // SPI framing wrong; bus corruption or wrong chip
  [-707]: 'SPI_CMD_FAILED', // Dominant real-world fault; SPI/TCXO/power-rail instability
  [-1300]: 'FRONTEND_CALIBRATION_FAILED', // LR11x0/LR2021 RF front-end calibration failure
  [-1301]: 'INVALID_SIDE_DETECT', // LR11x0 FEM/antenna routing mismatch
};

// meshtastic/protobufs CriticalErrorCode enum (mesh.proto / mesh.pb.h).
// Source: coverage-additional.md §CriticalError crosswalk.
const CRIT_ERR_NAME: Record<number, string> = {
  1: 'TX_WATCHDOG', // TX never completed; pairs with radioBusyTxHardwareFailure
  2: 'SLEEP_ENTER_WAIT', // Timed out waiting to enter sleep
  3: 'NO_RADIO', // No radio hardware found on bus at all
  4: 'UNSPECIFIED',
  5: 'UBLOX_UNIT_FAILED', // GPS (ublox) init failure
  6: 'NO_AXP192', // Expected AXP192 PMIC not present
  7: 'INVALID_RADIO_SETTING', // Most common in corpus; bad coding rate / SF / preset
  8: 'TRANSMIT_FAILED', // Transmit attempt failed
  9: 'BROWNOUT', // Supply voltage fell below ~2.4 V threshold
  10: 'SX1262_FAILURE', // SX1262 radio failure
  11: 'RADIO_SPI_BUG', // Known SPI bug condition tripped
  12: 'FLASH_CORRUPTION_RECOVERABLE',
  13: 'FLASH_CORRUPTION_UNRECOVERABLE',
};

// NAK error names (from NAK_ERROR_NAMES in logSummary.ts) with plain-English meanings.
// Sources: Router.cpp (perhapsEncode/send/sendLocal), ReliableRouter.cpp, NextHopRouter.cpp,
//          MeshModule.cpp, AdminModule.cpp, PhoneAPI.cpp
const NAK_MEANINGS: Record<string, string> = {
  NO_ROUTE: 'no known path to that destination in routing table',
  GOT_NAK: 'destination node returned an explicit NAK',
  TIMEOUT: 'no ACK or NAK received within the retry window',
  NO_INTERFACE: 'no radio interface available to transmit (Router.cpp sendLocal)',
  MAX_RETRANSMIT: '3 retransmissions exhausted with no response (NextHopRouter.cpp)',
  NO_CHANNEL:
    'channel hash lookup failed — channel disabled or packet undecryptable (Router.cpp perhapsEncode / ReliableRouter.cpp)',
  TOO_LARGE: 'encoded payload exceeds MAX_LORA_PAYLOAD_LEN for this modem preset (Router.cpp perhapsEncode)',
  NO_RESPONSE: 'packet had want_ack but no module claimed it (MeshModule.cpp)',
  DUTY_CYCLE_LIMIT: 'hourly TX% exceeds regional duty-cycle limit — transmit suppressed (Router.cpp send)',
  BAD_REQUEST: 'malformed or invalid packet/admin command (Router.cpp send / AdminModule.cpp)',
  NOT_AUTHORIZED: 'request came from non-admin node or channel (MeshModule.cpp / AdminModule.cpp)',
  PKI_FAILED:
    'PKI encryption failed — client-supplied key mismatches stored key, or pki_encrypted forced but unusable (Router.cpp perhapsEncode)',
  PKI_UNKNOWN_PUBKEY:
    'received PKI-encrypted packet but sender public key is unknown — cannot decrypt (ReliableRouter.cpp)',
  ADMIN_BAD_SESSION_KEY: 'admin session key in packet does not match established session (AdminModule.cpp)',
  ADMIN_PUBLIC_KEY_UNAUTHORIZED: 'sender public key not in the authorised admin key list (AdminModule.cpp)',
  RATE_LIMIT_EXCEEDED: 'client sending packets faster than the phone API rate limit allows (PhoneAPI.cpp)',
  PKI_SEND_FAIL_PUBLIC_KEY: 'PKI DM attempted but no public key stored for destination node (Router.cpp perhapsEncode)',
};

function rlibFmt(code: number): string {
  return RADIOLIB_NAME[code] ? `${RADIOLIB_NAME[code]} (${code})` : `unknown (${code})`;
}
function critFmt(code: number): string {
  return CRIT_ERR_NAME[code] ? `${CRIT_ERR_NAME[code]} (${code})` : `unknown (${code})`;
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

// Test if radioLibErrors contains SPI-class codes (the dominant real-world fault category).
function hasSpiErrors(s: DeviceSummary): boolean {
  return s.radioLibErrors.some((e) => [-16, -705, -706, -707].includes(e.code));
}

export function renderDiagnosis(s: DeviceSummary): string {
  const diag: Finding[] = [];
  const crit: Finding[] = [];
  const warn: Finding[] = [];
  const info: Finding[] = [];

  // ── DIAGNOSIS — compound root-cause conclusions ────────────────────────────
  // These fire when multiple signals converge on a single confident root cause.

  // Radio wiring faults (DIY/promicro builds). Validated against the SX1262 pin-pull
  // corpus (2026-06-26): each break has a distinct signature, except that a broken
  // NSS/SCK/MOSI/MISO/NRST all collapse to the same "chip not found" result — the
  // firmware genuinely cannot tell them apart.

  // (1) Radio not detected — chip absent or SPI/control wiring broken.
  // Signature: the fitted radio's driver logged "No <chip> radio with TCXO/XTAL" and no
  // driver ever reached init success. The -2 (CHIP_NOT_FOUND) results from the other
  // built-in drivers (RF95, LR11x0, LR20x0) are expected — only one radio is fitted.
  if (s.configuredRadioNotFound && !s.radioInitSucceeded) {
    const chip = s.configuredRadioMissingName ?? 'radio';
    diag.push({
      title: `Radio not detected — ${chip} did not respond on the SPI bus`,
      detail:
        'The firmware probed every radio driver it was built with; none found the fitted ' +
        'radio. (The CHIP_NOT_FOUND / -2 results for the other drivers are normal — only one radio ' +
        'is fitted.) The configured chip returned chip-not-found on both TCXO and XTAL attempts, so ' +
        'the MCU could not read it back over SPI. On a DIY/promicro build this usually means a broken ' +
        'connection on a radio control line rather than a dead chip: NSS/CS, SCK, MOSI, MISO, or NRST ' +
        '(reset) — all five produce this identical signature, so check continuity on each, plus the ' +
        'radio 3V3 and GND. A genuinely absent or dead module looks the same.',
    });
  }

  // (2) Radio IRQ line (DIO1) not firing. Signature: init succeeded but channel-activity
  // scans (CAD / scanChannel) keep timing out — CAD-done is signalled over DIO1.
  if (s.radioInitSucceeded && s.scanChannelFailures >= 2) {
    diag.push({
      title: 'Radio interrupt line (DIO1/IRQ) not firing — channel scans time out',
      detail:
        `The radio initialised correctly but ${s.scanChannelFailures} channel-activity scan` +
        `${s.scanChannelFailures !== 1 ? 's' : ''} (scanChannel/CAD) returned err=-1. CAD completion ` +
        'is delivered to the MCU over the radio interrupt line (DIO1, shown as the "irq" pin in the ' +
        'SX126xInterface log). With that line broken the chip runs the scan but the MCU never sees the ' +
        'done-interrupt, so it times out: the radio still configures over SPI (init succeeds) and TX ' +
        'may appear to "complete" by timeout, but listen-before-talk is dead and received packets are ' +
        'missed. Check continuity of the DIO1/IRQ wire. Left unfixed this escalates to SPI command ' +
        'errors (-705/-707) as driver and chip fall out of sync.',
    });
  }

  // (3) Radio BUSY line stuck — TX-hang reboot loop. Signature: init succeeded, packets were
  // enqueued, but none ever keyed up, and the device rebooted repeatedly. Every SPI command
  // waits for BUSY to go low first; a broken BUSY wedges that wait until the watchdog resets.
  if (s.radioInitSucceeded && s.boots >= 2 && s.txEnqueued > 0 && s.txCompleted === 0) {
    diag.push({
      title: 'Radio BUSY line stuck — device reboot-loops on first transmit',
      detail:
        `The radio initialised successfully and ${s.txEnqueued} packet` +
        `${s.txEnqueued !== 1 ? 's were' : ' was'} queued for transmit, but not one transmission ever ` +
        `started or completed, and the device rebooted ${s.boots} times. Before every SPI command the ` +
        'SX126x driver waits for the chip BUSY line to go low; if that line is broken (or stuck high) ' +
        'the wait never returns, the radio task hangs, and the watchdog resets the board — so every ' +
        'boot dies at the first TX. Check continuity of the BUSY wire (the "busy" pin in the ' +
        'SX126xInterface log). A chip that never releases BUSY looks the same.',
    });
  }

  // Storage write-interrupt loop (from diagnosis-2026-06-20-config-persistence.md)
  if (s.fsOrphan && s.missingCriticalPrefs.length > 0) {
    diag.push({
      title: 'Config-loss loop: storage writes interrupted by reboots',
      detail:
        'LittleFS orphan + missing ' +
        s.missingCriticalPrefs.join(', ') +
        '. ' +
        'Each reboot finds the filesystem inconsistent (left by the previous interrupted save), ' +
        'loads factory defaults, and may regenerate node identity. ' +
        'The device then saves, reboots on the setting change (normal on NRF52), ' +
        'and the cycle repeats. ' +
        'Fix: full chip erase + reflash — partial reflash skipping the FS partition will not repair the orphan.',
    });
  }

  // NodeDB / prefs write failure — correlated from the multi-line cluster
  // (encode error + "Can't write prefs!" + "Failed to save to disk, retrying" +
  // FLASH_CORRUPTION critical error). One root cause, not four loose counters.
  if (s.nodeDbWriteFailure) {
    const f = s.nodeDbWriteFailure;
    const n = s.nodeDbWriteFailures ?? 1;
    const unrecoverable = f.critCode === 13;
    const utf8 = f.cause ? /utf8/i.test(f.cause) : false;
    const causeText = utf8
      ? 'A peer sent a node name/info packet with invalid UTF-8, so the NodeDB protobuf ' + 'could not be serialised'
      : f.cause
        ? `Protobuf encoding failed (${f.cause})`
        : 'A persisted protobuf could not be written to flash';
    const outcome =
      f.critCode !== undefined
        ? ` Flash reformat + retry was attempted and the firmware recorded ${critFmt(f.critCode)}.`
        : f.retried
          ? ' Flash reformat + retry was attempted.'
          : '';
    const finding = {
      title:
        `NodeDB save failed — settings not persisted${n > 1 ? ` (${n}×)` : ''}` +
        (unrecoverable ? ' [unrecoverable]' : ''),
      detail:
        `${causeText}, so the save aborted` +
        (f.cantWritePrefs ? ' ("Can\'t write prefs!")' : '') +
        '.' +
        outcome +
        ' ' +
        (utf8
          ? 'The node list is rebuilt from heard packets on every reboot; the offending node ' +
            'can be found by unusual characters in its name. Known firmware issue — no action ' +
            'until an upstream fix.'
          : 'Recurring flash-corruption writes point to a worn or failing FS partition; a full ' +
            'chip erase + reflash is the most reliable fix.'),
    };
    if (unrecoverable) crit.push(finding);
    else diag.push(finding);
  }

  // Radio SPI bus instability
  if (hasSpiErrors(s) && (s.radioRecoveryReboot || s.agcCalibFailures > 3)) {
    const spiCount = s.radioLibErrors.filter((e) => [-16, -705, -706, -707].includes(e.code)).length;
    diag.push({
      title: 'Radio SPI bus instability confirmed across multiple symptoms',
      detail:
        `${spiCount} SPI-class RadioLib error${spiCount !== 1 ? 's' : ''} ` +
        (s.radioRecoveryReboot ? '+ recovery reboot ' : '') +
        (s.agcCalibFailures > 3 ? `+ ${s.agcCalibFailures} AGC calibration failures ` : '') +
        'all point to the same root cause. ' +
        'Likely causes: loose radio module socket, power-rail noise during TX (' +
        'add 100 µF decoupling near radio VCC), SPI clock line interference, ' +
        'or a failing solder joint on the SPI bus.',
    });
  }

  // Mesh channel saturated
  const utilNum = s.channelUtil !== undefined ? parseFloat(s.channelUtil) : 0;
  if (utilNum >= 65) {
    diag.push({
      title: `Mesh channel saturated (${s.channelUtil}%) — LongFast reliability threshold exceeded`,
      detail:
        'At ≥65% utilisation the LongFast preset (and similar wide-BW presets) ' +
        'becomes unreliable: collisions dominate, most ACK-requested packets time out, ' +
        'and duty-cycle limits are frequently hit. ' +
        'Remedies (ranked): 1) Switch to a narrower preset (MediumSlow/MediumFast) ' +
        'to reduce airtime per packet. ' +
        '2) Reduce hop limit from default 3 to 1 or 2. ' +
        '3) Reduce telemetry broadcast frequency on nearby nodes. ' +
        '4) Split the mesh across multiple channels.',
    });
  }

  // GPS total failure with identified cause (serial link)
  // Uses checksum failures only — frame errors (gpsFrameErrors) come from baud-rate probing and
  // are normal on any device where the GPS chip was previously configured to a non-default speed.
  const gpsChecksums = s.gpsChecksumFailTotal ?? 0;
  if (s.gpsChipModel && s.gpsLocksAcquired === 0 && gpsChecksums > 5) {
    diag.push({
      title: `GPS chip (${s.gpsChipModel}) detected but NMEA data stream is corrupted`,
      detail:
        `${gpsChecksums} NMEA checksum failure${gpsChecksums !== 1 ? 's' : ''} after chip was detected. ` +
        'The firmware only logs checksum failures once the running total exceeds 4, ' +
        'so this count reflects persistent corruption, not warm-up noise. ' +
        'Root causes in order of likelihood: ' +
        '(1) loose or swapped TX/RX wires; ' +
        '(2) baud-rate settled at wrong speed after probe (chip re-initialised differently on a prior boot); ' +
        '(3) EMI from nearby radio antenna coupling into the GPS UART cable; ' +
        '(4) inadequate decoupling on GPS module VCC.',
    });
  }

  // OOM crash (task watchdog + very low heap)
  if (s.taskWatchdogTriggered && s.heapFree !== undefined && s.heapFree < 20000) {
    diag.push({
      title: 'Memory exhaustion crash: watchdog fired while heap critically low',
      detail:
        `Task watchdog triggered with ${Math.round(s.heapFree / 1024)} KB heap free. ` +
        'At this level the device is well below the 40 KB threshold at which HTTPS processing is ' +
        'suppressed, and approaching the 1.5 KB MINIMUM_SAFE_FREE_HEAP floor at which the NodeDB ' +
        'stops accepting new nodes. The mesh task was likely blocked on a failed heap allocation ' +
        'and stopped yielding within the 90-second watchdog window (8 seconds on RP2040/RP2350). ' +
        'Remedies: disable unused modules (Store & Forward, Detection Sensor, MQTT bridging), ' +
        'use a device with PSRAM, or reduce the node DB size. ' +
        (s.psramTotal
          ? `This device has PSRAM (${Math.round(s.psramTotal / 1024)} KB total); ` +
            'check if CONFIG_FREERTOS_PLACE_TASK_STACKS_IN_EXT_RAM is enabled.'
          : 'This device has no PSRAM; RAM-intensive features should be disabled.'),
    });
  }

  // ── CRITICAL ───────────────────────────────────────────────────────────────

  if (s.espPanicBacktrace) {
    crit.push({
      title: 'ESP32 crash — panic backtrace captured',
      detail:
        (s.panicPc ? `First PC: ${s.panicPc}. ` : '') +
        'Decode with: xtensa-esp32-elf-addr2line -pfiaC -e firmware.elf <PC addresses>. ' +
        'The Backtrace: line (visible in the terminal log) contains all PC:SP pairs needed. ' +
        'Common crash sites: heap corruption, null pointer dereference, stack overflow.',
    });
  }
  if (s.taskWatchdogTriggered) {
    crit.push({
      title: 'Task watchdog fired — firmware stopped responding for ≥90 seconds',
      detail:
        (s.watchdogTask ? `Starved task: "${s.watchdogTask}". ` : '') +
        'The application watchdog is set to 90 seconds on ESP32 and NRF52 (8 seconds on RP2040/RP2350). ' +
        'It fires when no monitored task yields to the idle task within that window. ' +
        'Causes: infinite loop in radio or mesh processing, mutex deadlock, ' +
        'blocking I2C/SPI call that never returns, or heap allocation stall.',
    });
  }
  if (s.criticalErrors.length > 0) {
    const n = s.criticalErrors.length;
    const decoded = s.criticalErrors
      .slice(0, 3)
      .map((e) => `${critFmt(e.code)} @ ${e.file}:${e.line}`)
      .join('; ');
    crit.push({
      title: `Critical firmware error${n > 1 ? 's' : ''}: ${critFmt(s.criticalErrors[0].code)}`,
      detail: decoded + (n > 3 ? ` +${n - 3} more` : ''),
    });
  }
  if (s.filesystemMountFailed) {
    crit.push({
      title: 'Filesystem mount failed — all settings unavailable',
      detail:
        'LittleFS could not be mounted. The device runs on factory defaults and ' +
        'cannot persist any configuration. ' +
        'Causes: worn flash (block erase failures), partition table mismatch, ' +
        'or Adafruit LittleFS library bug (versions < 1.7.2 had critical corruption bugs on NRF52). ' +
        'Full chip erase + reflash with current firmware is the most reliable fix.',
    });
  }
  if (s.storageDecryptCorrupt) {
    crit.push({
      title: 'Encrypted storage corrupted — config and keys unloadable',
      detail:
        'Decrypt failed and storage was treated as corrupt. ' +
        'The device will regenerate its PKI keys and lose all stored settings. ' +
        'Causes: power loss during an encrypted write, firmware downgrade to a version ' +
        'with an incompatible encryption format, or a flash integrity failure. ' +
        'Factory reset clears the corrupted state.',
    });
  }
  if (s.missingCriticalPrefs.length > 0) {
    crit.push({
      title: 'Critical config files missing — factory defaults loaded',
      detail:
        `Missing on this boot: ${s.missingCriticalPrefs.join(', ')}. ` +
        'The device has no stored channel, radio, or node settings. ' +
        'Settings applied via app will save, but if the filesystem is in a corrupt cycle ' +
        '(see DIAGNOSIS above) they will be lost again on the next reboot.',
    });
  }
  // Suppressed when "Radio not detected" already fired: there, the -707 retries come from the
  // other (unfitted) drivers probing a bus with no chip, so this generic line would mislead.
  if (s.radioInitError && !s.configuredRadioNotFound) {
    crit.push({ title: 'Radio failed to initialise', detail: s.radioInitError });
  }

  // ── WARNING ────────────────────────────────────────────────────────────────

  // protoEncodeErrors — nodeDB silently not persisted (from findings-2026-06-20 §8).
  // Suppressed when the correlated NodeDB-write-failure finding already explains it.
  if (s.protoEncodeErrors > 0 && !s.nodeDbWriteFailure) {
    warn.push({
      title: `NodeDB save blocked by invalid UTF-8 in received node name (${s.protoEncodeErrors}×)`,
      detail:
        'A neighbouring node sent a name or info packet with invalid UTF-8 bytes — ' +
        'common with third-party Meshtastic clients that do not validate string encoding. ' +
        'The device cannot serialise the NodeDB protobuf, so the node list is never written to flash ' +
        'and is rebuilt from heard packets on every reboot. ' +
        'Known firmware issue; no action required until a firmware fix is released. ' +
        'The affected node can be identified by looking for unusual characters in node names.',
    });
  }

  if (s.buildDate) {
    const days = Math.floor((Date.now() - new Date(s.buildDate).getTime()) / 86400000);
    if (days >= 180) {
      warn.push({
        title: `Firmware is ${Math.round(days / 30)} months old (built ${s.buildDate})`,
        detail:
          'Consider upgrading to a recent stable release. ' +
          'Issues visible in this log may already be fixed upstream.',
      });
    }
  }
  if (s.firmware) {
    const vl = s.firmware.toLowerCase();
    const tag = vl.includes('alpha')
      ? 'alpha'
      : vl.includes('beta')
        ? 'beta'
        : vl.includes('rc')
          ? 'release candidate'
          : null;
    if (tag) {
      warn.push({
        title: `Running ${tag} pre-release firmware (${s.firmware})`,
        detail:
          'Pre-release builds may have known bugs, unfinished features, or changed ' +
          'wire-format that makes them incompatible with older firmware on the same mesh.',
      });
    }
  }
  if (s.region === 'UNSET') {
    warn.push({
      title: 'LoRa region not configured — transmit disabled',
      detail:
        'The device rejects all outgoing LoRa packets until a region is set. ' +
        'Set the region via the app or CLI before deployment. ' +
        'If a region was previously configured, missing config.proto (see Critical section) is likely the cause.',
    });
  }

  const rxTotal = (s.rxBad ?? 0) + (s.rxGood ?? 0);
  if (rxTotal >= 20 && (s.rxBad ?? 0) / rxTotal >= 0.1) {
    const pct = ((s.rxBad! / rxTotal) * 100).toFixed(1);
    warn.push({
      title: `High packet error rate (${pct}% bad of ${rxTotal} received)`,
      detail:
        'Packets are received at the radio layer but fail to decode. ' +
        'Common causes: RF interference (CRC errors), wrong channel PSK ' +
        '(packets received but decryption fails → channelDecodeFailures), ' +
        'or signal too weak (check lastRssi — below −120 dBm causes frequent CRC errors on SX126x).',
    });
  }

  if (utilNum >= 50 && utilNum < 65) {
    warn.push({
      title: `Channel utilisation high (${s.channelUtil}%)`,
      detail:
        'At 50%+ collisions become frequent. ' +
        'Client nodes stop sending their own telemetry above 25%; ' +
        'router nodes stop above 40% — so if you see high utilisation despite those suppressions, ' +
        'the mesh is genuinely overloaded. ' +
        'Reduce telemetry intervals, hop limit, or the number of nodes transmitting nearby.',
    });
  }
  if (s.dutyCycleHits > 0) {
    warn.push({
      title: `Hit regulatory duty-cycle limit (${s.dutyCycleHits}×)`,
      detail:
        'Transmissions were suppressed to comply with regional duty-cycle rules. ' +
        'EU_868 allows 10% duty cycle per hour on a rolling basis. ' +
        'US_915 has no hourly duty-cycle restriction but does have a max dwell time. ' +
        'Reduce transmit frequency, TX power, or hop limit to stay within the regional limit.',
    });
  }

  // GPS heuristics (from coverage-gnss.md derived fault table)
  const gpsDisabled = s.gpsUserMode === 'DISABLED';
  if (!gpsDisabled) {
    if (s.gpsChipModel && s.gpsLocksAcquired === 0 && s.gpsSearchFailures > 0 && gpsChecksums <= 5) {
      const gpsSats = s.gpsSiv ?? s.gpsSats;
      const hint =
        gpsSats !== undefined && gpsSats < 4
          ? `Only ${gpsSats} satellite${gpsSats !== 1 ? 's' : ''} visible — ` +
            'move device outside with clear sky (GPS cold start needs ~30 s with 6+ sats in view).'
          : 'Check antenna connection and sky view. Cold-start TTFF: 27–45 s (NEO-6M), ~30 s (L76K) in good conditions.';
      warn.push({
        title: `GPS hardware (${s.gpsChipModel}) detected but never obtained a fix`,
        detail: `${s.gpsSearchFailures} failed search${s.gpsSearchFailures !== 1 ? 'es' : ''}. ` + hint,
      });
    }
    if (s.gpsBufferFullEvents > 0) {
      warn.push({
        title: `GPS UART buffer overrun (${s.gpsBufferFullEvents}×)`,
        detail:
          `GPS serial buffer had ${s.gpsBufferFullBytes ?? 'unknown'} bytes waiting when it overflowed. ` +
          'The firmware loop is not draining the UART fast enough — the device is CPU- or I/O-starved. ' +
          'Look for concurrent watchdog events or very high heap pressure.',
      });
    }
    if (s.gpsConfigNacks > 5 || s.gpsConfigTimeouts > 5 || s.gpsAtgmConfigFailures > 0) {
      const msgs = [...s.gpsNackedMessages, ...s.gpsTimedOutMessages].slice(0, 4).join(', ');
      warn.push({
        title: `GPS module rejecting config commands ` + `(${s.gpsConfigNacks} NACKs, ${s.gpsConfigTimeouts} timeouts)`,
        detail:
          (msgs ? `UBX messages: ${msgs}. ` : '') +
          'A GPS-only chip (no GLONASS/Galileo) will NACK multi-constellation UBX-CFG commands. ' +
          'Chip is running on its factory default constellation/rate, which reduces TTFF and fix accuracy ' +
          "compared to firmware's intended configuration, but the device will still get fixes. " +
          'If the chip normally supports multi-constellation, check the UBX baud rate and ' +
          'whether ATGM or L76K-specific init is needed.',
      });
    }
    if ((s.gpsConsecutiveLockFailures ?? 0) >= 3 && s.gpsLocksAcquired > 0) {
      warn.push({
        title: `GPS lost lock — ${s.gpsConsecutiveLockFailures} consecutive failures since last fix`,
        detail:
          'GPS was working earlier this session but re-acquisition is failing now. ' +
          'Check for obstructions (vehicle went indoors, antenna cable pulled loose), ' +
          'or UART buffer-full events indicating the loop is too busy to service GPS.',
      });
    }
  }

  if (s.watchdogReset || s.espRstCode === 'RTCWDT_RTC_RESET' || s.espRstCode === 'TG1WDT_SYS_RESET') {
    warn.push({
      title: 'Previous reboot was a watchdog reset',
      detail:
        (s.espRstCode ? `ESP reset code: ${s.espRstCode}. ` : '') +
        'The firmware was unresponsive for the watchdog timeout (5 s default) and the hardware reset it. ' +
        'Check for crash loops (high rebootCount), resource exhaustion (low heap), ' +
        'or a blocking I2C/SPI call that never returns.',
    });
  }
  if (s.retransmissions > 20) {
    warn.push({
      title: `High retransmission count (${s.retransmissions})`,
      detail:
        'ACK-requested packets are not being acknowledged on the first attempt. ' +
        'Reliable packets are retransmitted up to 3 times before generating a MAX_RETRANSMIT NAK. ' +
        'Root causes: weak link on one or more hops (check lastRssi/lastSnr), ' +
        'destination node unreachable or in CLIENT_MUTE role, ' +
        'or channel congestion causing the ACK to collide on the return path.',
    });
  }
  if (s.heapFree !== undefined && s.heapFree < 40000 && !s.taskWatchdogTriggered) {
    const pct = s.heapTotal ? ` (${Math.round((s.heapFree / s.heapTotal) * 100)}%)` : '';
    warn.push({
      title: `Very low heap memory (${Math.round(s.heapFree / 1024)} KB free${pct})`,
      detail:
        `Documented firmware cutoffs: HTTPS processing is skipped below 40 KB; ` +
        'the NodeDB stops accepting new nodes below 1.5 KB (MINIMUM_SAFE_FREE_HEAP in configuration.h). ' +
        'At these levels the device may silently drop features or crash. ' +
        'Disable unused modules, or use a device with PSRAM ' +
        '(task stacks can be placed in external RAM to free internal heap).',
    });
  }
  if (s.fsOrphan && s.missingCriticalPrefs.length === 0) {
    warn.push({
      title: 'LittleFS orphan found — filesystem inconsistency recovered',
      detail:
        'A partial write was left as an orphaned inode and recovered at mount time. ' +
        'Cause: reset or power loss interrupted a filesystem write. ' +
        'Single occurrence is usually harmless; repeated occurrences indicate flash wear ' +
        'or frequent unexpected resets during saves. Factory reset cleans the filesystem.',
    });
  }
  if (s.pkiKeysRegenerated) {
    const storageIssue = s.fsOrphan || s.missingCriticalPrefs.length > 0;
    warn.push({
      title: 'PKI keys regenerated — node identity changed',
      detail:
        (storageIssue
          ? 'Likely triggered by missing/corrupt key storage (see storage findings above). '
          : 'Triggered unexpectedly — investigate whether config.proto was lost. ') +
        'All existing DM sessions are broken until the remote contacts re-exchange keys ' +
        'with the new public key. The node ID may also have changed.',
    });
  }
  if (s.adminConfigSaveFailed || s.configSaveFailures > 2) {
    warn.push({
      title: 'Configuration not persisting to storage',
      detail:
        `${s.configSaveFailures} save failure${s.configSaveFailures !== 1 ? 's' : ''}. ` +
        'Changes applied via app are lost on reboot. ' +
        'Possible causes: storage lockdown active (adminDroppedStorageLocked > 0), ' +
        'low battery causing save rejection (unsafePowerSaveBlocked), ' +
        'LittleFS write failure, or encrypted storage locked.',
    });
  }

  if (s.radioLibErrors.length > 0) {
    const n = s.radioLibErrors.length;
    const decoded = s.radioLibErrors
      .slice(0, 3)
      .map((e) => `${e.radio} ${e.op} → ${rlibFmt(e.code)}`)
      .join('; ');
    warn.push({
      title: `RadioLib errors (${n} event${n !== 1 ? 's' : ''})`,
      detail:
        decoded +
        (n > 3 ? ` +${n - 3} more. ` : '. ') +
        (hasSpiErrors(s)
          ? 'SPI-class errors (SPI_CMD_FAILED, SPI_WRITE_FAILED) are the dominant real-world fault ' +
            'and indicate bus instability — see DIAGNOSIS above.'
          : 'CRC_MISMATCH errors indicate RF noise or very weak signal. ' +
            'Check antenna connection and local interference sources.'),
    });
  }
  if (s.radioRecoveryReboot && !hasSpiErrors(s)) {
    warn.push({
      title: 'Radio entered recovery reboot cycle',
      detail:
        'Repeated radio failures triggered an automatic device reboot. ' +
        'The firmware detected the radio was in an unrecoverable error state and rebooted to reset it. ' +
        'Check SPI bus connections, power supply stability, and radio module seating.',
    });
  }
  if (s.warmstoreRingCorrupt || s.deviceStateDiscarded) {
    warn.push({
      title: s.warmstoreRingCorrupt
        ? 'WarmStore ring buffer corrupt — mesh history lost'
        : 'Device state discarded — NodeDB rebuilt from scratch',
      detail: s.warmstoreRingCorrupt
        ? `${s.warmstoreBadPages ?? 'unknown'} bad page${(s.warmstoreBadPages ?? 0) !== 1 ? 's' : ''} in ring. ` +
          'Peer position and telemetry history is gone; the device will rebuild from live traffic. ' +
          'Repeated bad pages may indicate flash wearing.'
        : 'DeviceState was too old/invalid and was discarded. ' +
          'Normal after a major firmware upgrade that changes the serialisation format.',
    });
  }
  if (s.lockdownActive) {
    warn.push({
      title: 'Storage lockdown active — admin commands rejected',
      detail:
        (s.lockdownState ? `State: ${s.lockdownState}. ` : '') +
        'The device has entered a locked state where config saves and admin payloads are dropped. ' +
        'This is intentional security behaviour triggered by repeated failed admin auth, ' +
        'provisioning timeout, or session limit exceeded.',
    });
  }
  if (s.busyRxCount > 20) {
    warn.push({
      title: `Frequent RX-busy collisions (${s.busyRxCount})`,
      detail:
        'The radio was still in RX when a TX was requested. ' +
        'Indicates multiple nodes transmitting simultaneously — a sign of channel congestion. ' +
        'Reduce hop limit, spread-factor, or the number of nearby transmitting nodes.',
    });
  }
  if (s.channelDecodeFailures > 10) {
    warn.push({
      title: `Repeated channel decode failures (${s.channelDecodeFailures})`,
      detail:
        'Packets pass radio-layer CRC but fail decryption or protobuf decode. ' +
        'Most likely cause: a node on the mesh is using a different channel PSK (encryption key). ' +
        'Also possible: firmware version mismatch producing incompatible wire format, ' +
        'or RF noise producing valid-length frames with corrupted payload.',
    });
  }
  const totalNaks = Object.values(s.nakErrors).reduce((a, b) => a + b, 0);
  if (totalNaks > 30) {
    const top = Object.entries(s.nakErrors).sort(([, a], [, b]) => b - a)[0];
    const meaning = top ? (NAK_MEANINGS[top[0]] ?? 'unknown') : '';
    warn.push({
      title: `Excessive NAK errors (${totalNaks} total)`,
      detail:
        (top ? `Most frequent: ${top[0]} × ${top[1]} — ${meaning}. ` : '') +
        'NAK codes: NO_ROUTE = no path to dest, MAX_RETRANSMIT = 3 attempts failed, ' +
        'TIMEOUT = no reply within window, DUTY_CYCLE_LIMIT = transmit suppressed, ' +
        'NO_CHANNEL = channel disabled/undecryptable, BAD_REQUEST = malformed packet, ' +
        'NOT_AUTHORIZED = non-admin sender, PKI_FAILED = key mismatch, ' +
        'PKI_UNKNOWN_PUBKEY = sender key unknown, PKI_SEND_FAIL_PUBLIC_KEY = no dest key stored, ' +
        'ADMIN_BAD_SESSION_KEY = session mismatch, ADMIN_PUBLIC_KEY_UNAUTHORIZED = key not in admin list, ' +
        'RATE_LIMIT_EXCEEDED = phone API rate limit hit.',
    });
  }
  if (s.safeFileWriteFailures > 5) {
    warn.push({
      title: `Repeated safe-file write failures (${s.safeFileWriteFailures})`,
      detail:
        'SafeFile atomic writes are failing: tmp file rename fails or readback hash mismatches. ' +
        'Indicates filesystem full (check fsUsed/fsTotal), flash block wearing, ' +
        'or a concurrent process holding a file lock. ' +
        'Free space or factory-reset to clean the filesystem.',
    });
  }
  if (s.fromRadioQOverflow > 0) {
    warn.push({
      title: `Radio→app queue overflow (${s.fromRadioQOverflow}×)`,
      detail:
        'Packets are delivered from radio to the app layer faster than they can be consumed. ' +
        'The oldest queued packet is discarded. ' +
        'Cause: CPU overload (concurrent mesh + BLE + telemetry processing), ' +
        'or a burst of high-density mesh traffic. ' +
        'Correlates with task-watchdog events and very low heap.',
    });
  }
  if (s.agcCalibFailures > 3 && !hasSpiErrors(s)) {
    warn.push({
      title: `AGC calibration failures (${s.agcCalibFailures})`,
      detail:
        'Every 60 seconds the firmware sends CALIBRATE_ALL (0x7F) to the SX126x and waits ' +
        'up to 50 ms for the BUSY pin to go low. Each of these events means that wait timed out — ' +
        'the remaining calibration steps were skipped for that cycle. ' +
        'The SX126x BUSY pin is driven by the radio chip itself, so a timeout points to ' +
        'the chip being slow to respond: power-rail noise during the calibration burst, ' +
        'a marginal SPI connection, or a radio module in a degraded state. ' +
        'Correlate with RadioLib SPI-class errors to confirm bus instability.',
    });
  }
  if (s.nvsUsed !== undefined && s.nvsFree !== undefined && s.nvsUsed + s.nvsFree > 0) {
    const nvsTotal = s.nvsUsed + s.nvsFree;
    if (s.nvsUsed / nvsTotal > 0.85) {
      warn.push({
        title:
          `NVS flash nearly full (${s.nvsUsed}/${nvsTotal} entries, ` + `${Math.round((s.nvsUsed / nvsTotal) * 100)}%)`,
        detail:
          'NVS (non-volatile storage) holds BLE bonding keys, some config, and OTA state. ' +
          'At ≥85% used, new BLE pairings may fail and config writes return NVS_NO_FREE_PAGES. ' +
          'This correlates with bleNvsErrors. Factory reset clears NVS.',
      });
    }
  }

  // ── INFO ───────────────────────────────────────────────────────────────────

  if (gpsDisabled) {
    info.push({
      title: 'GPS disabled by user — position and time-sync inactive',
      detail:
        'gpsUserMode = DISABLED. No lock attempts are made; GPS-related warnings above are not applicable. ' +
        'Re-enable GPS in device settings to restore position and NTP-like time correction.',
    });
  }
  if (s.gpsDefaultsMaintained && !gpsDisabled) {
    info.push({
      title: 'GPS running on factory defaults (GPS-only, no GLONASS/Galileo)',
      detail:
        "The chip rejected the firmware's multi-constellation configuration. " +
        'GPS-only operation gives slightly longer cold-start TTFF compared to multi-constellation. ' +
        'Normal for chips like the L76K GPS-only variant or ATGM336H in GPS-only mode.',
    });
  }
  if (utilNum >= 25 && utilNum < 50) {
    info.push({
      title: `Channel utilisation elevated (${s.channelUtil}%)`,
      detail:
        'Above 25% client nodes automatically suppress their own telemetry broadcasts. ' +
        'Above 40% router nodes also suppress. The mesh is self-throttling; no action needed yet ' +
        'but monitor — if utilisation climbs toward 65% switch to a narrower preset.',
    });
  }
  if (s.buildVariant && s.buildVariant !== 'meshtastic/firmware') {
    const hasStorageIssues =
      s.fsOrphan || s.safeFileWriteFailures > 0 || s.configSaveFailures > 0 || s.adminConfigSaveFailed;
    info.push({
      title: `Custom firmware fork: ${s.buildVariant}`,
      detail:
        (hasStorageIssues
          ? 'Storage issues observed alongside a custom firmware fork — ' +
            'may be a fork-specific save bug (e.g. jamesjsm/mtfw had a LittleFS write path issue). '
          : '') +
        'Not an official Meshtastic release. Behaviour, wire format, and OTA compatibility ' +
        'may differ from mainline. Issues specific to this build should be reported to the fork author.',
    });
  }
  if (s.tcxoFallbackToXtal) {
    info.push({
      title: 'Radio oscillator in XTAL mode (TCXO absent or failed)',
      detail:
        'The LR11x0/LR20x0 fell back to internal crystal after TCXO init failed. ' +
        'Frequency accuracy reduces from ±1.5 ppm (TCXO) to ±tens of ppm (XTAL), ' +
        'which has minimal impact on standard presets (LongFast, MediumSlow). ' +
        'Impact is significant only for Very Long Range Slow and sub-62.5 kHz bandwidth modes. ' +
        'Correlate with freqOffset readings to assess actual drift in your environment.',
    });
  }
  if (s.batteryPct === '101') {
    info.push({
      title: 'Device is externally powered (USB or DC) — no battery measurement',
      detail:
        'battery_level=101 is the Meshtastic convention for "externally powered / no battery". ' +
        'The voltage=0 reading that accompanies it is normal for USB-only boards that have no ' +
        'ADC connected to a battery sense pin.',
    });
  }
  if (s.nodeDbFullEvictions > 5) {
    info.push({
      title: `Node database full — oldest nodes evicted ${s.nodeDbFullEvictions} times`,
      detail:
        `The default node DB limit is 100 nodes (80 on T-Echo). ` +
        'When full, the least-recently-heard node is replaced by the new one. ' +
        'High eviction counts mean the mesh has more active nodes than the DB can hold. ' +
        'Evicted nodes lose their position/telemetry history and DM sessions may break. ' +
        'The DB also stops growing if free heap falls below 1500 bytes (MINIMUM_SAFE_FREE_HEAP).',
    });
  }
  if (s.factoryReset) {
    info.push({
      title: 'Factory reset performed during this session',
      detail:
        'All settings cleared. Admin payload 94 triggers a full factory reset. ' +
        'If this was not deliberately triggered, check adminNoSessionKey and ' +
        'adminDroppedStorageLocked counters for signs of unauthorised admin access.',
    });
  }
  if (s.sensorsDropped.length > 0) {
    const n = s.sensorsDropped.length;
    info.push({
      title: `I²C sensor${n > 1 ? 's' : ''} detected on bus but dropped by driver`,
      detail:
        `${s.sensorsDropped.join(', ')}. ` +
        'The I²C scan found the address but the driver could not communicate with the chip. ' +
        'Causes: wiring fault (SCL/SDA swapped), wrong I²C address variant (some sensors have ' +
        'address-select pins), or an incompatible chip revision that does not respond to init commands.',
    });
  }
  if (s.nodeKeyDowngrade.length > 0 || s.unsignedNodeInfoDropped > 0) {
    const detail =
      s.nodeKeyDowngrade.length > 0
        ? `Nodes: ${s.nodeKeyDowngrade.slice(0, 3).join(', ')}. ` +
          'A node that previously signed its NodeInfo sent an unsigned packet. ' +
          'Could be: key storage lost on the remote node (same config-loss loop), ' +
          'firmware downgrade on the peer, or a spoofing attempt.'
        : `${s.unsignedNodeInfoDropped} unsigned NodeInfo packet` +
          `${s.unsignedNodeInfoDropped !== 1 ? 's' : ''} dropped. ` +
          'Monitor for recurrence and cross-reference with the transmitting node ID.';
    info.push({ title: 'Possible key-downgrade or spoofing observed', detail });
  }
  if (s.storeForwardPsramFull) {
    info.push({
      title: 'Store & Forward PSRAM buffer full — oldest messages overwriting',
      detail:
        'The S&F ring buffer has wrapped. Late-connecting clients miss earlier messages. ' +
        'Reduce the S&F record count or retention period in module settings.',
    });
  }
  if (s.securityWarning) {
    info.push({
      title: 'Public key broadcast triggered',
      detail:
        '"advertised your public key" logged: the device broadcast its public key ' +
        'in response to receiving a message from a node whose key it did not have. ' +
        'Normal on first contact with a new peer. ' +
        'Repeated occurrences may indicate key exchange is failing or an unexpected peer is probing.',
    });
  }
  if (s.positionZeroSkipped > 0 && !s.gpsLock && !gpsDisabled) {
    info.push({
      title: `Position broadcasts suppressed — GPS has no fix yet (${s.positionZeroSkipped}×)`,
      detail:
        'Zero-coordinate packets are filtered to prevent poisoning the mesh with ' +
        '0°N 0°E (which is a real location in the Gulf of Guinea). ' +
        'Normal until GPS achieves a fix. If GPS should be working here, check GPS findings above.',
    });
  }
  if (s.configCoerced) {
    info.push({
      title: 'Telemetry/position intervals auto-coerced to role minimum',
      detail:
        'The firmware detected a configured interval shorter than the role-aware minimum and adjusted it. ' +
        'Normal after a firmware upgrade that changes role defaults. ' +
        'Manually set your desired intervals via the app to override.',
    });
  }
  if (s.reliableSendFailures > 10) {
    info.push({
      title: `Reliable send failures (${s.reliableSendFailures})`,
      detail:
        'Messages sent with ACK request received no reply after 3 retransmissions. ' +
        'The destination node may be out of range, offline, in CLIENT_MUTE role, ' +
        'or unreachable via the current mesh topology.',
    });
  }
  if (s.noHwRng) {
    info.push({
      title: 'No hardware random number generator (HWRNG)',
      detail:
        'The crypto stack uses a software PRNG seeded from timing jitter. ' +
        'Weaker than HWRNG, particularly on first boot before entropy accumulates. ' +
        'Some NRF52 boards and ESP32 variants have HWRNG — check the board definition.',
    });
  }

  if (diag.length === 0 && crit.length === 0 && warn.length === 0 && info.length === 0) {
    return '<div class="diag-none">No notable issues detected in this log.</div>';
  }

  return (
    group('diag-diag', '◈', 'DIAGNOSIS', diag) +
    group('diag-crit', '⚡', 'CRITICAL', crit) +
    group('diag-warn', '⚠', 'WARNING', warn) +
    group('diag-info', 'ℹ', 'INFO', info)
  );
}
