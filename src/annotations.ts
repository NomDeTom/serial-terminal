/**
 * Line annotation catalog — single source for in-terminal commentary.
 *
 * Each entry pairs a pattern (matched against the ANSI-stripped log line) with a
 * plain-English explanation. `severity` drives presentation:
 *   - 'info'  → 💡 gutter marker ("here is what this means")
 *   - 'warn' / 'error' → ⚠ fault marker ("something noteworthy or wrong")
 *
 * Ported from .notes/findings-2026-06-20.md (§1–§55, esp. the §29 commentary
 * table) and .notes/novel-log-patterns.md (§A–§BBBB). Ordered most-specific /
 * highest-severity first; annotateLine() returns the first match.
 */

export type Severity = 'info' | 'warn' | 'error';

export interface Annotation {
  id: string;        // stable slug
  section: string;   // source reference for traceability
  test: RegExp;      // matched against the ANSI-stripped line
  title: string;     // short label for the Interest tab
  comment: string;   // explanation shown on hover and in the Interest detail
  severity: Severity;
}

export const ANNOTATIONS: Annotation[] = [
  // ── Persistence / lifecycle faults ─────────────────────────────────────────
  {
    id: 'lfs-orphan', section: '§persist', severity: 'error',
    test: /lfs .*Found orphan/i,
    title: 'LittleFS orphan',
    comment: 'LittleFS found an orphaned block — a write was interrupted by a reboot. Settings may ' +
      'fail to persist across reboots; a full erase + reflash is recommended.',
  },
  {
    id: 'cant-write-prefs', section: '§8', severity: 'error',
    test: /Can't write prefs|Failed to save to disk|Record critical error \d+ at/,
    title: 'Prefs write failed',
    comment: 'The device failed to write config / node database to flash. Settings and node list will ' +
      'not persist across reboots.',
  },
  {
    id: 'proto-encode-error', section: '§8', severity: 'error',
    test: /Error: can't encode protobuf invalid utf8/,
    title: 'Proto encode error',
    comment: 'NodeDB save failed due to invalid UTF-8 in a received node name. The node list will not ' +
      'persist across reboots. This is a known firmware bug.',
  },
  {
    id: 'factory-reset', section: '§persist', severity: 'error',
    test: /Perform factory reset|Initiate full factory reset/,
    title: 'Factory reset',
    comment: 'A factory-reset command wiped all prefs — node identity and settings are regenerated.',
  },
  {
    id: 'prefs-config-missing', section: '§7', severity: 'warn',
    test: /Could not open \/ read \/prefs\/config\.proto/,
    title: 'config.proto missing',
    comment: 'Saved radio/device config could not be read; factory defaults were installed. Normal on a ' +
      'fresh device, but on a configured device it means settings are not persisting.',
  },
  {
    id: 'prefs-nodes-missing', section: '§7', severity: 'warn',
    test: /Could not open \/ read \/prefs\/nodes\.proto/,
    title: 'nodes.proto missing',
    comment: 'The saved node database could not be read; the node list will be rebuilt from the air. On a ' +
      'configured device this means the node list is not persisting.',
  },
  {
    id: 'pki-regen', section: '§persist', severity: 'warn',
    test: /Generate new PKI keys/,
    title: 'New PKI keys',
    comment: 'The device generated new PKI keys, changing its public key and identity to peers. Unexpected ' +
      'mid-session, this points to security config not persisting.',
  },
  {
    id: 'invalid-lora', section: '§persist', severity: 'warn',
    test: /Invalid coding_rate|Invalid spread_factor|Preset \w+ invalid for|Invalid LoRa config received/,
    title: 'Invalid LoRa config',
    comment: 'The client sent an invalid LoRa config (e.g. coding_rate/spread_factor 0, or a preset ' +
      'incompatible with the region); the firmware substituted corrected values.',
  },
  {
    id: 'install-default-config', section: '§7', severity: 'warn',
    test: /Install default LocalConfig/,
    title: 'Defaults installed',
    comment: 'First boot or config was wiped — the device is running on factory-default settings.',
  },
  {
    id: 'nodedb-discard', section: '§38', severity: 'warn',
    test: /NodeDatabase \d+ is old, discard/,
    title: 'NodeDB discarded',
    comment: 'The stored node list is from a firmware version too old to migrate — all previously seen ' +
      'nodes are lost until they re-broadcast.',
  },
  {
    id: 'invalid-channel-index', section: '§37', severity: 'warn',
    test: /Invalid channel index/,
    title: 'Invalid channel index',
    comment: 'A channel record has an invalid index — a protobuf edge case, possibly from a firmware ' +
      'version mismatch. Re-save channel config from the app to fix.',
  },
  {
    id: 'packet-counter-corrupt', section: '§DDD', severity: 'warn',
    test: /num_packets_tx=\d{7,}/,
    title: 'Counter corrupted',
    comment: 'TX packet counter shows an impossible value for this uptime — uninitialised memory read as ' +
      'a counter. Known firmware bug; clears on next reboot.',
  },

  // ── Boot / radio faults ────────────────────────────────────────────────────
  {
    id: 'radio-not-found', section: '§wiring', severity: 'error',
    test: /No \S+ radio with (?:TCXO|XTAL)/,
    title: 'Radio not detected',
    comment: 'The fitted radio did not answer on the SPI bus on this init attempt. Unlike the ' +
      '"No RF95 radio" probe line (a built-in driver for a chip that simply is not fitted), this is ' +
      'the configured radio failing. If no driver reaches "init success", the chip is absent/dead or ' +
      'a control line (NSS, SCK, MOSI, MISO, NRST) is broken — these are indistinguishable in the log.',
  },
  {
    id: 'scan-channel-fail', section: '§wiring', severity: 'error',
    test: /scanChannel RadioLib err=/,
    title: 'CAD scan failed (IRQ?)',
    comment: 'A channel-activity (CAD) scan never completed. CAD-done is signalled over the radio ' +
      'interrupt line (DIO1/IRQ). Repeated failures with a radio that initialised fine point to a ' +
      'broken DIO1/IRQ wire — listen-before-talk is dead and incoming packets are missed.',
  },
  {
    id: 'task-wdt-oom', section: '§oom', severity: 'error',
    test: /task_wdt: Task watchdog got triggered/,
    title: 'Crash: Task WDT / OOM',
    comment: 'The ESP-IDF Task Watchdog fired — loopTask stopped yielding to the RTOS for longer than the ' +
      'WDT timeout. This means the task was stuck: spinloop, blocked peripheral, or a long allocation. ' +
      'If heap was low before this line (check Free heap earlier in this boot), BLE stack init is a ' +
      'likely culprit — NimBLE allocates heavily at startup. But low heap is not the only cause; check ' +
      'the backtrace lines below for the exact call site.',
  },
  {
    id: 'watchdog-reset', section: '§2', severity: 'error',
    test: /reset_reason=intWatchdog/,
    title: 'Watchdog reset',
    comment: 'The device crashed and was reset by the hardware watchdog. Check for firmware bugs or power ' +
      'instability.',
  },
  {
    id: 'esp-wdt-reset', section: '§2', severity: 'error',
    test: /^rst:0x[\da-fA-F]+ \(\w*(WDT|PANIC)\w*\)/,
    title: 'Bootloader WDT reset',
    comment: 'ESP32 bootloader reports a watchdog/panic reset before firmware even started — confirms a ' +
      'crash on the previous boot.',
  },
  {
    id: 'radioif-rx-error', section: '§17', severity: 'warn',
    test: /Ignore received packet due to error=/,
    title: 'Radio RX error',
    comment: 'A packet was received but failed radio-layer decode (CRC or header error). Usually noise or ' +
      'a very weak signal.',
  },
  {
    id: 'nodedb-full', section: '§20', severity: 'warn',
    test: /Node database full with \d+ nodes/,
    title: 'NodeDB full',
    comment: 'The node database is full — the oldest entry was evicted. Normal on a busy mesh; frequent ' +
      'evictions mean the DB is too small for your mesh size.',
  },
  {
    id: 'reliable-send-fail', section: '§46', severity: 'warn',
    test: /Reliable send failed/,
    title: 'Reliable send failed',
    comment: 'A packet sent with WantAck was never acknowledged after all retries. The app is notified of ' +
      'delivery failure. Expected for broadcasts when no node is in range.',
  },
  {
    id: 'prehop-drop', section: '§47', severity: 'warn',
    test: /pre-hop drop.*hop_start|hop_start invalid\/missing/,
    title: 'Pre-hop drop',
    comment: 'Packet dropped because it is missing the hop_start field required by current firmware. The ' +
      'sender may be running older Meshtastic firmware.',
  },
  {
    id: 'tophone-full', section: '§45', severity: 'warn',
    test: /tophone queue.*full/i,
    title: 'To-phone queue full',
    comment: 'The queue of packets waiting for the app to download was full; the oldest was discarded. ' +
      'Usually harmless during rapid connect activity.',
  },
  {
    id: 'rate-limit', section: '§49', severity: 'warn',
    test: /Rate limit portnum/,
    title: 'Telemetry rate limited',
    comment: 'Too many telemetry requests in a short window — this one was dropped. The device limits how ' +
      'often it responds to telemetry polls.',
  },
  {
    id: 'region-unset', section: '§28', severity: 'warn',
    test: /Set radio: region=UNSET|Wanted region \d+, using UNSET/,
    title: 'Region not set',
    comment: 'The LoRa region is not configured. The device will not transmit until a region is set from ' +
      'the app.',
  },
  {
    id: 'coding-rate-override', section: '§50', severity: 'warn',
    test: /Default Coding Rate is higher than custom setting/,
    title: 'Coding rate override',
    comment: 'The modem preset\'s coding rate is higher than your custom setting; the higher value is used ' +
      'for reliability. Affects range and throughput.',
  },
  {
    id: 'duty-cycle', section: '§duty', severity: 'warn',
    test: /[Dd]uty.?[Cc]ycle limit/,
    title: 'Duty cycle limit',
    comment: 'The EU LoRa duty-cycle airtime limit was hit — TX is blocked to stay within the legal cap.',
  },
  {
    id: 'packet-decode-fail', section: '§AAA', severity: 'warn',
    test: /packet decoding failed or skipped/,
    title: 'Decode failed (no PSK)',
    comment: 'Received a packet from an unknown channel (wrong encryption key). It was relayed but could ' +
      'not be decoded locally — it belongs to a channel this device is not on.',
  },
  {
    id: 'packet-history-evict', section: '§26', severity: 'warn',
    test: /Packet History.*OLDEST SLOT/,
    title: 'Dedup history full',
    comment: 'The packet-dedup history is full and is evicting the oldest entry. Very high packet rates ' +
      'can cause duplicate rebroadcasts.',
  },
  {
    id: 'packet-history-invalid', section: '§27', severity: 'warn',
    test: /Packet History - Invalid size/,
    title: 'Packet history default',
    comment: 'A config value for the packet-history size was missing or invalid; a default was used. ' +
      'Confirms config was not fully loaded.',
  },
  {
    id: 'no-radio-entropy', section: '§KKK', severity: 'warn',
    test: /No radio instance available to provide entropy/,
    title: 'No HW entropy',
    comment: 'No radio was available to seed the RNG, so a software seed is used. Random values are less ' +
      'unpredictable this boot — resolves once the radio initialises.',
  },

  // ── GPS ────────────────────────────────────────────────────────────────────
  {
    id: 'gps-probe-trying', section: '§A', severity: 'info',
    test: /\[GPS\] Trying \$.*Family\)/,
    title: 'GPS auto-detect',
    comment: 'The firmware is auto-detecting the GPS chipset by sending probe commands. Each line is a ' +
      'different chip family being tested.',
  },
  {
    id: 'gps-no-gnss', section: '§A', severity: 'info',
    test: /\[GPS\] No GNSS Module \(baudrate \d+\)/,
    title: 'No GPS at baud',
    comment: 'No GPS chip responded at this baud rate. Normal during auto-detection — the firmware will ' +
      'try other speeds.',
  },
  {
    id: 'gps-giveup', section: '§A', severity: 'info',
    test: /Give up on GPS probe/,
    title: 'GPS probe gave up',
    comment: 'GPS auto-detection exhausted all baud rates and defaulted to 9600 baud for this boot.',
  },
  {
    id: 'gps-not-detected', section: '§A', severity: 'info',
    test: /GPS not detected; marked not present/,
    title: 'GPS not present',
    comment: 'No GPS module was found after the full probe. GPS features are unavailable until the next ' +
      'reboot.',
  },
  {
    id: 'gps-power', section: '§B', severity: 'info',
    test: /GPS power state move from/,
    title: 'GPS power change',
    comment: 'The GPS hardware was powered up (OFF→ACTIVE) or down (ACTIVE→OFF).',
  },
  {
    id: 'gps-cached', section: '§BBBB', severity: 'info',
    test: /Using cached GPS probe|Loaded cached GPS probe/,
    title: 'GPS probe cached',
    comment: 'The GPS chip was identified on a previous boot; the full probe scan is skipped and the ' +
      'cached chip + baud are used.',
  },
  {
    id: 'gps-no-lock', section: '§TTT', severity: 'info',
    test: /No GPS lock/,
    title: 'No GPS lock',
    comment: 'No satellite fix yet — position data is unavailable.',
  },
  {
    id: 'position-fix', section: '§TTT', severity: 'info',
    test: /POSITION node=.*siv=\d+/,
    title: 'Position fix',
    comment: 'Full position fix data. siv = satellites in view; msl = altitude in mm above sea level; ' +
      'pdop/hdop/vdop are accuracy estimates.',
  },
  {
    id: 'truncate-pos', section: '§UUU', severity: 'info',
    test: /Truncate phone position to channel precision/,
    title: 'Position truncated',
    comment: 'Position precision reduced to the channel privacy setting before broadcasting. Higher ' +
      'numbers = coarser precision = more privacy.',
  },

  // ── Radio init / RF config ─────────────────────────────────────────────────
  {
    id: 'rf95-none', section: '§C', severity: 'info',
    test: /RF95 init result|No RF95 radio/,
    title: 'No RF95 (expected)',
    comment: 'RFM95/SX1276 radio not found (expected on this hardware). The firmware will try the SX126x ' +
      'driver next.',
  },
  {
    id: 'sx-patch', section: '§C', severity: 'info',
    test: /Applied SX1262 register .* patch/,
    title: 'SX1262 RX patch',
    comment: 'A hardware-specific patch was applied to improve receive sensitivity on this SX1262 variant.',
  },
  {
    id: 'tcxo', section: '§D', severity: 'info',
    test: /(SX126X|LR11X0)_DIO3_TCXO_VOLTAGE/,
    title: 'TCXO reference',
    comment: 'DIO3 is supplying the reference voltage to the temperature-compensated crystal oscillator.',
  },
  {
    id: 'rf-switch', section: '§D', severity: 'info',
    test: /Set DIO2 as RF switch|as RXEN/,
    title: 'RF switch pins',
    comment: 'GPIO pins are being configured to control the TX/RX antenna switch.',
  },
  {
    id: 'fem', section: '§11', severity: 'info',
    test: /Detected \S+ LoRa FEM/,
    title: 'LoRa FEM detected',
    comment: 'A LoRa front-end module (PA/LNA) was detected. The FEM adds gain, so the final TX power is ' +
      'adjusted accordingly.',
  },
  {
    id: 'rx-gain', section: '§9', severity: 'info',
    test: /Set RX gain to/,
    title: 'RX gain mode',
    comment: 'The receive gain mode was set (boosted = best sensitivity; power-saving = lower current).',
  },
  {
    id: 'agc-reset', section: '§18', severity: 'info',
    test: /SX126x AGC reset/,
    title: 'AGC recalibration',
    comment: 'Normal periodic radio recalibration. The SX126x resets its automatic gain control and ' +
      'recalibrates RF blocks, roughly once per minute at idle.',
  },
  {
    id: 'false-preamble', section: '§18', severity: 'info',
    test: /Ignore false preamble detection/,
    title: 'False preamble',
    comment: 'The radio woke thinking it heard a packet start, but it was noise. Normal in congested RF; ' +
      'high rates can indicate strong interference.',
  },
  {
    id: 'lora-bitrate', section: '§E', severity: 'info',
    test: /LoRA bitrate =/i,
    title: 'LoRa bitrate',
    comment: 'Effective LoRa data rate in bytes/second at the current modem settings. Lower spreading ' +
      'factors give higher throughput.',
  },
  {
    id: 'slot-time', section: '§E', severity: 'info',
    test: /Slot time: \d+ msec/,
    title: 'Slot / preamble time',
    comment: 'CAD slot time and minimum preamble listen time for the current modem preset.',
  },
  {
    id: 'numfreqslots', section: '§12', severity: 'info',
    test: /numFreqSlots: \d+ x/,
    title: 'Frequency slots',
    comment: 'Number of frequency slots in this region × bandwidth. Fewer slots = higher collision chance.',
  },
  {
    id: 'region-override', section: '§RR', severity: 'info',
    test: /Using region explicit override slot/,
    title: 'Region slot override',
    comment: 'A frequency slot is explicitly pinned rather than auto-calculated from the channel number.',
  },
  {
    id: 'tx-power', section: '§13', severity: 'info',
    test: /Requested Tx power: \d+ dBm/,
    title: 'TX power request',
    comment: 'Requested TX power plus the device LoRa gain offset. Final power may be lower due to ' +
      'regulatory limits or FEM gain.',
  },

  // ── Crypto / PKI ───────────────────────────────────────────────────────────
  {
    id: 'regen-pki-pub', section: '§F', severity: 'info',
    test: /Regenerate PKI public key/,
    title: 'PKI pubkey rebuild',
    comment: 'Reconstructing the public key from the stored private key. Normal at every boot.',
  },
  {
    id: 'dh-key', section: '§F', severity: 'info',
    test: /Set DH private key/,
    title: 'DH key loaded',
    comment: 'The Diffie-Hellman private key was loaded for encrypted communications.',
  },
  {
    id: 'skip-nodb-nokey', section: '§F', severity: 'info',
    test: /Skip NodeDB without key/,
    title: 'Node without key',
    comment: 'A node record has no public key — it is excluded from encrypted or signed packet exchange.',
  },
  {
    id: 'set-admin-key', section: '§U', severity: 'info',
    test: /Set admin key to/,
    title: 'Admin key set',
    comment: 'An admin session key was established. Commands from the connected app are authenticated with ' +
      'this key.',
  },

  // ── WarmStore / replay / NodeDB ────────────────────────────────────────────
  {
    id: 'warmstore-replay', section: '§G', severity: 'info',
    test: /WarmStore: replayed/,
    title: 'WarmStore replay',
    comment: 'The WarmStore ring buffer was loaded; neighbour nodes were reconstructed from the previous ' +
      'session so the map populates immediately.',
  },
  {
    id: 'warmstore-absorb', section: '§20', severity: 'info',
    test: /WarmStore absorb/,
    title: 'WarmStore absorb',
    comment: 'A node evicted from the main database was saved to a compact ring buffer for quick reload ' +
      'later. Normal on full meshes.',
  },
  {
    id: 'replay-position', section: '§G', severity: 'info',
    test: /Begin position replay|Begin telemetry replay|Replay drain complete/,
    title: 'Cached data replay',
    comment: 'The device is sending cached position/telemetry from other nodes to the app so the map ' +
      'populates immediately on connect.',
  },
  {
    id: 'nodedb-load', section: '§5', severity: 'info',
    test: /Loaded saved nodedatabase/,
    title: 'NodeDB loaded',
    comment: 'The saved node database was loaded from flash, with counts of nodes that have position, ' +
      'telemetry, environment, and status records.',
  },
  {
    id: 'install-default-nodedb', section: '§K', severity: 'info',
    test: /Install default NodeDatabase/,
    title: 'Fresh NodeDB',
    comment: 'A fresh empty node database was created (the previous one was discarded).',
  },
  {
    id: 'transmit-history', section: '§JJ', severity: 'info',
    test: /TransmitHistory: loaded/,
    title: 'TX history loaded',
    comment: 'Recently-relayed packet IDs were loaded from flash to avoid re-broadcasting them after a ' +
      'reboot.',
  },
  {
    id: 'cleanup-meshdb', section: '§29', severity: 'info',
    test: /cleanupMeshDB purged/,
    title: 'NodeDB cleanup',
    comment: 'Expired or unreachable nodes were removed from the database. Normal housekeeping.',
  },

  // ── Sensors / power ────────────────────────────────────────────────────────
  {
    id: 'i2c-acc', section: '§M', severity: 'info',
    test: /acc_info = \d+/,
    title: 'Accelerometer ID',
    comment: 'Accelerometer chip identifier (36 = QMA6100P, 38 = LIS3DH, 0 = none detected).',
  },
  {
    id: 'accel-init', section: '§N', severity: 'info',
    test: /AccelerometerThread::init ok/,
    title: 'Motion sensor ok',
    comment: 'The accelerometer / motion sensor initialised successfully — used for motion wakeup and ' +
      'position triggers.',
  },
  {
    id: 'max17048', section: '§TT', severity: 'info',
    test: /max17048.*not ready/,
    title: 'No fuel gauge',
    comment: 'The MAX17048 precision fuel gauge was not found; battery level is estimated from ADC ' +
      'voltage instead.',
  },
  {
    id: 'battery-adc', section: '§TT', severity: 'info',
    test: /Use analog input \d+ for battery level/,
    title: 'Battery ADC pin',
    comment: 'Battery voltage is measured via the ADC on the given GPIO pin.',
  },
  {
    id: 'battery-hw', section: '§51', severity: 'info',
    test: /battery hardware detected/,
    title: 'Battery HW ok',
    comment: 'Battery monitoring hardware was confirmed present and functional.',
  },

  // ── Time / clock ───────────────────────────────────────────────────────────
  {
    id: 'timezone', section: '§O', severity: 'info',
    test: /Set Timezone to GMT/,
    title: 'Timezone = GMT',
    comment: 'The device timezone defaults to UTC at boot. The app will push the correct local timezone ' +
      'on connect.',
  },
  {
    id: 'time-ntp', section: '§P', severity: 'info',
    test: /Upgrade time to quality NTP|Time source acquired/,
    title: 'Clock synced',
    comment: 'The device clock was synchronised to phone/NTP time. Packet timestamps are now accurate.',
  },
  {
    id: 'time-drift', section: '§P', severity: 'info',
    test: /Reapply external time to correct clock drift/,
    title: 'Clock drift fixed',
    comment: 'Accumulated clock drift was corrected using the time pushed by the app.',
  },

  // ── BLE / phone API ────────────────────────────────────────────────────────
  {
    id: 'ble-connected', section: '§R', severity: 'info',
    test: /BLE Connected to/,
    title: 'BLE connected',
    comment: 'A phone/app connected over Bluetooth. The name shown is the connected device.',
  },
  {
    id: 'ble-secured', section: '§R', severity: 'info',
    test: /BLE connection secured/,
    title: 'BLE secured',
    comment: 'The BLE link is now encrypted and authenticated.',
  },
  {
    id: 'ble-disconnect', section: '§R', severity: 'info',
    test: /BLE Disconnected, reason/,
    title: 'BLE disconnected',
    comment: 'The BLE link dropped. Reason 0x13 = app closed normally; other codes may indicate signal ' +
      'loss.',
  },
  {
    id: 'client-wants-config', section: '§S', severity: 'info',
    test: /Client wants config, nonce|Client only wants node info/,
    title: 'Config requested',
    comment: 'The app requested device configuration. A full config dump begins (or just the node list on ' +
      'a reconnect).',
  },
  {
    id: 'config-send-complete', section: '§S', severity: 'info',
    test: /Config Send Complete|Done sending \d+ of \d+ nodeinfos/,
    title: 'Config sent',
    comment: 'Configuration and node records were fully sent to the app; the device is in normal ' +
      'operating mode.',
  },
  {
    id: 'ble-gatt-init', section: '§WW', severity: 'info',
    test: /Init the (Device Information|Battery|Mesh bluetooth) [Ss]ervice/,
    title: 'BLE GATT init',
    comment: 'The BLE GATT stack is initialising its services (Device Info, Battery, Mesh). The device ' +
      'will start advertising for discovery.',
  },
  {
    id: 'disconnect-phone', section: '§EEE', severity: 'info',
    test: /Disconnect from phone|PhoneAPI::close|BluetoothStatus DISCONNECTED/,
    title: 'Phone disconnect',
    comment: 'The phone API session closed and the BLE link is being torn down. Normal on app close.',
  },
  {
    id: 'fromradio-state', section: '§ZZZ', severity: 'info',
    test: /FromRadio=STATE_|getFromRadio=STATE_/,
    title: 'API send state',
    comment: 'The phone-API state machine is delivering data (queue status, my-info, UI data, file ' +
      'manifest, or packets) to the connected app. Normal during connect.',
  },

  // ── Admin ──────────────────────────────────────────────────────────────────
  {
    id: 'handle-admin', section: '§T', severity: 'info',
    test: /Handle admin payload \d+/,
    title: 'Admin command',
    comment: 'The app sent an admin command (e.g. 1=get_channel, 3=get_owner, 5=get_config, ' +
      '14=get_ringtone, 34=set_config, 35=set_module_config, 43=set_time_only).',
  },
  {
    id: 'admin-not-handled', section: '§T', severity: 'info',
    test: /Module API did not handle admin message/,
    title: 'Admin response',
    comment: 'An admin response packet was handled by the routing layer — not an error.',
  },

  // ── Router / mesh flow ─────────────────────────────────────────────────────
  {
    id: 'packet-from-phone', section: '§W', severity: 'info',
    test: /PACKET FROM PHONE|Enqueued local \(/,
    title: 'Packet from app',
    comment: 'A packet from the connected app entered the router and was queued with a proper source ' +
      'address.',
  },
  {
    id: 'drop-dup-toradio', section: '§Z', severity: 'info',
    test: /Drop dup ToRadio packet/,
    title: 'Duplicate from app',
    comment: 'The app re-sent a packet the device already processed (normal BLE retry). Discarded.',
  },
  {
    id: 'sending-retx', section: '§AA', severity: 'info',
    test: /Sending retransmission .*tries left/,
    title: 'Retransmitting',
    comment: 'No acknowledgment received yet; the packet is being retried. The remaining attempt count is ' +
      'shown.',
  },
  {
    id: 'rx-snr-delay', section: '§CC', severity: 'info',
    test: /rx_snr found|Setting tx delay/,
    title: 'Relay delay',
    comment: 'Relay delay computed from received SNR — nodes closer to the sender wait longer so distant ' +
      'nodes get priority.',
  },
  {
    id: 'rebroadcast', section: '§DD', severity: 'info',
    test: /Rebroadcast received message coming from/,
    title: 'Rebroadcast',
    comment: 'The device is relaying a packet forwarded by another node. Normal mesh rebroadcast.',
  },
  {
    id: 'implicit-ack', section: '§EE', severity: 'info',
    test: /Generate implicit ack/,
    title: 'Implicit ACK',
    comment: 'Another node was heard relaying our packet — delivery confirmed without an explicit ACK.',
  },
  {
    id: 'ignore-dupe', section: '§FF', severity: 'info',
    test: /Ignore dupe incoming msg/,
    title: 'Duplicate heard',
    comment: 'A packet already processed was heard again from another relay. Discarded to prevent loops.',
  },
  {
    id: 'ignore-self', section: '§LLL', severity: 'info',
    test: /Ignore update from self|Incoming update from MYSELF/,
    title: 'Self update',
    comment: 'A packet from this device\'s own node ID was received (self-echo or pushed by the app). The ' +
      'node record is not updated from our own transmissions.',
  },
  {
    id: 'next-hop-zero', section: '§GG', severity: 'info',
    test: /Setting next hop for packet with dest .* to 0/,
    title: 'No route — flood',
    comment: 'No known route to the destination — the packet will be sent by broadcast flooding.',
  },
  {
    id: 'ack-recv', section: '§YYY', severity: 'info',
    test: /Received a ACK for 0x.*stopping retransmissions/,
    title: 'ACK received',
    comment: 'The packet was acknowledged by a peer — the retransmission timer was cancelled.',
  },
  {
    id: 'nak-recv', section: '§YYY', severity: 'info',
    test: /Received a NAK for 0x.*stopping retransmissions/,
    title: 'NAK received',
    comment: 'The packet was rejected (NAK) — retransmission cancelled, delivery failed.',
  },

  // ── User button / notifications ────────────────────────────────────────────
  {
    id: 'btn-double', section: '§HH', severity: 'info',
    test: /\[UserButton\] Double press|Double press!/,
    title: 'Button double-press',
    comment: 'The physical button was double-pressed — the device attempts a nodeinfo ping to all nodes.',
  },
  {
    id: 'skip-nodeinfo', section: '§HH', severity: 'info',
    test: /Skip send NodeInfo since we sent it/,
    title: 'NodeInfo throttled',
    comment: 'A nodeinfo ping was suppressed — one was already broadcast within the last 10 minutes.',
  },
  {
    id: 'extnotif-muted', section: '§II', severity: 'info',
    test: /External Notification Module Disabled or muted/,
    title: 'Notification muted',
    comment: 'The buzzer/LED was not triggered — the External Notification module is disabled or muted.',
  },
  {
    id: 'extnotif-off', section: '§VV', severity: 'info',
    test: /Turning off external notification|Stop RTTTL/,
    title: 'Notification reset',
    comment: 'External notification outputs (LEDs, buzzer) were reset to off at startup.',
  },
  {
    id: 'broadcast-nodeinfo', section: '§XX', severity: 'info',
    test: /Broadcasting nodeinfo ping/,
    title: 'NodeInfo broadcast',
    comment: 'The device is broadcasting its own NodeInfo to announce its identity to the mesh.',
  },

  // ── Beacon ─────────────────────────────────────────────────────────────────
  {
    id: 'beacon', section: '§KK', severity: 'info',
    test: /Beacon: split-[AB]|Beacon: switch radio for packet/,
    title: 'Mesh beacon',
    comment: 'A two-part channel-advertisement beacon: part A advertises the channel, part B carries the ' +
      'human-readable invitation text. The radio briefly retunes to send it.',
  },

  // ── Telemetry / hop scaling ────────────────────────────────────────────────
  {
    id: 'telem-reply', section: '§MM', severity: 'info',
    test: /Device telemetry reply w\/ LocalStats/,
    title: 'Telemetry reply',
    comment: 'On-demand telemetry stats (noise floor, uptime, channel use, counters) were sent in ' +
      'response to an app poll.',
  },
  {
    id: 'node-status', section: '§CCC', severity: 'info',
    test: /Node status update: \d+ online/,
    title: 'Node status',
    comment: 'How many known nodes are currently considered online (recently heard) versus the total in ' +
      'the database.',
  },
  {
    id: 'hopscale-restored', section: '§OO', severity: 'info',
    test: /\[HOPSCALE\] Restored/,
    title: 'HopScale restored',
    comment: 'HopScaling state was restored from flash. count = nodes seen in the last measurement window.',
  },
  {
    id: 'hopscale-rollhour', section: '§PP', severity: 'info',
    test: /\[HOPSCALE\] rollHour/,
    title: 'HopScale roll',
    comment: 'Hourly HopScaling evaluation. suggestedHop is the recommended hop count based on node ' +
      'density; trend shows new/returning/leaving nodes.',
  },
  {
    id: 'no-modules-portnum', section: '§SS', severity: 'info',
    test: /No modules interested in portnum/,
    title: 'No local handler',
    comment: 'No module handles this portnum from a local source. Normal for packet types that are sent ' +
      'out but not received locally.',
  },

  // ── RadioIf TX/RX lifecycle ────────────────────────────────────────────────
  {
    id: 'radioif-tx', section: '§YY', severity: 'info',
    test: /Started Tx \(|packets remain in the TX queue|Packet TX: \d+ms|Completed sending \(/,
    title: 'Radio TX',
    comment: 'Radio transmission lifecycle: start, queue depth, time-on-air (ms), and completion (return ' +
      'to receive mode).',
  },
  {
    id: 'radioif-rx', section: '§ZZ', severity: 'info',
    test: /Lora RX \(|Packet RX: \d+ms/,
    title: 'Radio RX',
    comment: 'A packet was received over LoRa. SNR/RSSI are inside the envelope; Packet RX ms is the ' +
      'time-on-air used for channel-utilisation accounting.',
  },
  {
    id: 'enqueue-send', section: '§BBB', severity: 'info',
    test: /enqueue for send \(/,
    title: 'Queued for TX',
    comment: 'A packet was placed in the radio transmit queue. relay=0xNN identifies this device as the ' +
      'relay in the packet header.',
  },

  // ── Module config ──────────────────────────────────────────────────────────
  {
    id: 'modcfg-unhandled', section: '§III', severity: 'info',
    test: /Unhandled module config type/,
    title: 'Unknown module cfg',
    comment: 'A module config type is not recognised by this firmware version\'s dispatch table — likely ' +
      'added in a newer version.',
  },

  // ── Misc boot / housekeeping ───────────────────────────────────────────────
  {
    id: 'random-seed', section: '§KKK', severity: 'info',
    test: /Set random seed \d+/,
    title: 'RNG seeded',
    comment: 'The random number generator was seeded. If it followed a no-entropy warning, values are ' +
      'less unpredictable until the radio initialises.',
  },
  {
    id: 'region-fallback', section: '§28', severity: 'info',
    test: /Wanted region \d+, using (?!UNSET)\w+/,
    title: 'Region set',
    comment: 'The LoRa region was applied during init (before the radio Set line). The first value is the ' +
      'requested region code.',
  },
  {
    id: 'config-migration', section: '§36', severity: 'info',
    test: /Loaded saved devicestate version 24|migrating to v25|Migrated \d+ nodes/,
    title: 'Config migrated',
    comment: 'Config files from a previous firmware version were loaded and silently migrated. If ' +
      'behaviour seems wrong, try re-saving settings from the app.',
  },
  {
    id: 'boot-wake', section: '§2', severity: 'info',
    test: /Booted, wake cause \d+ \(boot count/,
    title: 'Boot / wake',
    comment: 'Boot annotation: wake cause 0 = cold power-on, non-zero = woke from deep sleep; boot count ' +
      'is loops since the last full power cycle.',
  },
  {
    id: 'optional-prefs', section: '§L', severity: 'info',
    test: /Could not open \/ read \/prefs\/(uiconfig|ringtone|cannedConf)\.proto/,
    title: 'Optional prefs',
    comment: 'An optional settings file does not exist yet — defaults are used. It is created the first ' +
      'time you save these settings from the app.',
  },
];

// Returns the first annotation whose pattern matches the (ANSI-stripped) line.
export function annotateLine(line: string): Annotation | undefined {
  for (const a of ANNOTATIONS) {
    if (a.test.test(line)) return a;
  }
  return undefined;
}
