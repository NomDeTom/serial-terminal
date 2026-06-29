/**
 * CriticalErrorCode enum — single source of truth, transcribed from the firmware.
 *
 * Definitive source (codes & names):
 *   .notes/firmware/src/mesh/generated/meshtastic/mesh.pb.h  →  enum _meshtastic_CriticalErrorCode
 *   (generated from meshtastic/protobufs mesh.proto). When the firmware bumps,
 *   re-sync CRITICAL_ERROR_NAMES against that enum.
 *
 * These codes reach the log via recordCriticalError() in NodeDB.cpp:
 *   NodeDB.cpp:3811  LOG_ERROR("NOTE! Record critical error %d at %s:%lu", code, filename, address)
 *   NodeDB.cpp:3813  LOG_ERROR("NOTE! Record critical error %d, address=0x%lx", code, address)
 * Captured by the `criticalErrors` matcher in logSummary.ts.
 *
 * CRITICAL_ERROR_MEANINGS adds the plain-English explanation and the specific
 * firmware call site(s) that produce each code.
 */

// code → name (mesh.pb.h _meshtastic_CriticalErrorCode). NONE (0) is success — included
// for completeness but not an error in practice.
export const CRITICAL_ERROR_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'TX_WATCHDOG',
  2: 'SLEEP_ENTER_WAIT',
  3: 'NO_RADIO',
  4: 'UNSPECIFIED',
  5: 'UBLOX_UNIT_FAILED',
  6: 'NO_AXP192',
  7: 'INVALID_RADIO_SETTING',
  8: 'TRANSMIT_FAILED',
  9: 'BROWNOUT',
  10: 'SX1262_FAILURE',
  11: 'RADIO_SPI_BUG',
  12: 'FLASH_CORRUPTION_RECOVERABLE',
  13: 'FLASH_CORRUPTION_UNRECOVERABLE',
};

// name → diagnostic meaning + firmware call site.
export const CRITICAL_ERROR_MEANINGS: Record<string, string> = {
  TX_WATCHDOG: 'TX never completed in the watchdog window — pairs with radioBusyTxHardwareFailure (RadioLibInterface.cpp watchdog)',
  SLEEP_ENTER_WAIT: 'timed out waiting to enter sleep mode (sleep.cpp)',
  NO_RADIO: 'no radio hardware found on the SPI bus at boot (main.cpp)',
  UNSPECIFIED: 'non-specific firmware-level error',
  UBLOX_UNIT_FAILED: 'GPS (ublox) unit failed to initialise (main.cpp)',
  NO_AXP192: 'expected AXP192 PMIC not present on I2C bus (main.cpp)',
  INVALID_RADIO_SETTING: 'most common in corpus — bad coding rate / SF / preset combination (RadioInterface.cpp / LR11x0/LR20x0/RF95 interface init)',
  TRANSMIT_FAILED: 'transmit attempt failed at the radio driver level (RadioLibInterface.cpp)',
  BROWNOUT: 'supply voltage fell below ~2.4 V brownout threshold (nrf52/main-nrf52.cpp)',
  SX1262_FAILURE: 'SX1262 radio subsystem failure',
  RADIO_SPI_BUG: 'known SPI bug condition tripped (RadioLibInterface.cpp:695)',
  FLASH_CORRUPTION_RECOVERABLE: 'flash/NVS corruption detected; reformat + retry succeeded (NodeDB.cpp)',
  FLASH_CORRUPTION_UNRECOVERABLE: 'flash/NVS corruption detected; reformat + retry failed — full erase required (NodeDB.cpp / nrf52/main-nrf52.cpp)',
};

// Display name for a CriticalErrorCode, e.g. 7 → "INVALID_RADIO_SETTING". Undefined if unknown.
export function criticalErrorName(code: number): string | undefined {
  return CRITICAL_ERROR_NAMES[code];
}

// Formatted label for diagnosis output, e.g. 7 → "INVALID_RADIO_SETTING (7)".
export function criticalErrorFmt(code: number): string {
  const name = CRITICAL_ERROR_NAMES[code];
  return name ? `${name} (${code})` : `unknown (${code})`;
}
