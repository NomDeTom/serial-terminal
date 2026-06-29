/**
 * RadioLib numeric error codes — single source of truth, transcribed from the library.
 *
 * Definitive source (codes & names):
 *   RadioLib TypeDef.h  →  RADIOLIB_ERR_* constants (negative integers).
 *   When RadioLib bumps, re-sync RADIOLIB_ERROR_NAMES against that header.
 *
 * These codes reach the log in two ways:
 *   1. Via the shared prefix string (RadioLibInterface.h:337):
 *        const char* radioLibErr = "RadioLib err=";
 *      Used in many LOG_ lines, e.g.:
 *        LOG_ERROR("SX126X setSyncWord %s%d", radioLibErr, err)
 *        → "SX126X setSyncWord RadioLib err=-707"
 *      Captured by the `radioLibErrors` matcher in logSummary.ts.
 *   2. Directly in a few dedicated lines, e.g.:
 *        RadioLibInterface.cpp:694  LOG_ERROR("startTransmit failed, error=%d", res)
 *        RadioLibInterface.cpp:563  LOG_ERROR("Ignore received packet due to error=%d …", res)
 *      Captured by the `startTransmitFailures` / `radioInitError` matchers.
 *
 * RADIOLIB_ERROR_MEANINGS covers the subset of codes that have real diagnostic signal
 * in Meshtastic logs; the rest appear only in RADIOLIB_ERROR_NAMES for display.
 */

// code → name (RadioLib TypeDef.h RADIOLIB_ERR_*).
// Full set reachable on Meshtastic radio paths (SX126x, LR11x0, LR20x0, RF95, SX128x).
export const RADIOLIB_ERROR_NAMES: Record<number, string> = {
  [-2]: 'CHIP_NOT_FOUND',
  [-3]: 'MEMORY_ALLOCATION_FAILED',
  [-4]: 'PACKET_TOO_LONG',
  [-5]: 'TX_TIMEOUT',
  [-6]: 'RX_TIMEOUT',
  [-7]: 'CRC_MISMATCH',
  [-8]: 'INVALID_BANDWIDTH',
  [-9]: 'INVALID_SPREADING_FACTOR',
  [-10]: 'INVALID_CODING_RATE',
  [-12]: 'INVALID_FREQUENCY',
  [-13]: 'INVALID_OUTPUT_POWER',
  [-16]: 'SPI_WRITE_FAILED',
  [-18]: 'INVALID_PREAMBLE_LENGTH',
  [-19]: 'INVALID_GAIN',
  [-20]: 'WRONG_MODEM',
  [-703]: 'INVALID_TCXO_VOLTAGE',
  [-704]: 'INVALID_MODULATION_PARAMETERS',
  [-705]: 'SPI_CMD_TIMEOUT',
  [-706]: 'SPI_CMD_INVALID',
  [-707]: 'SPI_CMD_FAILED',
  [-1300]: 'FRONTEND_CALIBRATION_FAILED',
  [-1301]: 'INVALID_SIDE_DETECT',
};

// name → diagnostic meaning. Covers codes with real signal in Meshtastic hardware faults.
export const RADIOLIB_ERROR_MEANINGS: Record<string, string> = {
  CHIP_NOT_FOUND: 'radio not on SPI bus — wiring fault or dead chip (SX126xInterface init)',
  MEMORY_ALLOCATION_FAILED: 'heap exhaustion during radio init',
  TX_TIMEOUT: 'TX never asserted done — antenna/RF stage fault (SX126xInterface startTransmit)',
  RX_TIMEOUT: 'RX window elapsed — often benign background noise condition',
  CRC_MISMATCH: 'corrupted reception — noise, antenna issue, or interference',
  SPI_WRITE_FAILED: 'SPI readback mismatch — bus integrity problem (RF95/SX126x init)',
  INVALID_TCXO_VOLTAGE: 'TCXO Vref out of range — triggers XTAL fallback if available',
  SPI_CMD_TIMEOUT: 'radio stopped responding; busy line, power, or clock fault (SX126xInterface)',
  SPI_CMD_INVALID: 'SPI framing wrong — bus corruption or wrong chip select',
  SPI_CMD_FAILED: 'dominant real-world fault — SPI/TCXO/power-rail instability (SX126xInterface)',
  FRONTEND_CALIBRATION_FAILED: 'LR11x0/LR20x0 RF front-end calibration failure',
  INVALID_SIDE_DETECT: 'LR11x0 FEM/antenna routing mismatch (LR11x0Interface)',
};

// Display name for a RadioLib error code, e.g. -707 → "SPI_CMD_FAILED". Undefined if unknown.
export function radioLibErrorName(code: number): string | undefined {
  return RADIOLIB_ERROR_NAMES[code];
}

// Formatted label for diagnosis output, e.g. -707 → "SPI_CMD_FAILED (-707)".
export function radioLibErrorFmt(code: number): string {
  const name = RADIOLIB_ERROR_NAMES[code];
  return name ? `${name} (${code})` : `unknown (${code})`;
}
