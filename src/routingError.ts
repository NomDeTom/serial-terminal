/**
 * Routing.Error enum — single source of truth, transcribed from the firmware.
 *
 * Definitive source (codes & names):
 *   .notes/firmware/src/mesh/generated/meshtastic/mesh.pb.h  →  enum _meshtastic_Routing_Error
 *   (generated from meshtastic/protobufs mesh.proto). When the firmware bumps,
 *   re-sync ROUTING_ERROR_NAMES against that enum.
 *
 * These codes reach the log as a number in two firmware LOG lines, both captured
 * by the `nakErrors` matcher in logSummary.ts:
 *   - "Error=%d, return NAK and drop packet"  →  src/mesh/Router.cpp  abortSendAndNak()
 *   - "Alloc an err=%d,to=…"                   →  src/mesh/MeshModule.cpp  allocAckNak()
 *
 * ROUTING_ERROR_MEANINGS adds the plain-English explanation plus the specific
 * firmware call site that *produces* each code, so a maintainer can verify a
 * meaning against the emitting source. Verified real-log codes in log-inputs/:
 * 4 (NO_INTERFACE), 5 (MAX_RETRANSMIT); the rest are forward-looking.
 */

// code → name (mesh.pb.h _meshtastic_Routing_Error). NONE (0) is success, omitted.
export const ROUTING_ERROR_NAMES: Record<number, string> = {
  1: 'NO_ROUTE', 2: 'GOT_NAK', 3: 'TIMEOUT', 4: 'NO_INTERFACE',
  5: 'MAX_RETRANSMIT', 6: 'NO_CHANNEL', 7: 'TOO_LARGE',
  8: 'NO_RESPONSE', 9: 'DUTY_CYCLE_LIMIT',
  32: 'BAD_REQUEST', 33: 'NOT_AUTHORIZED', 34: 'PKI_FAILED',
  35: 'PKI_UNKNOWN_PUBKEY', 36: 'ADMIN_BAD_SESSION_KEY',
  37: 'ADMIN_PUBLIC_KEY_UNAUTHORIZED', 38: 'RATE_LIMIT_EXCEEDED',
  39: 'PKI_SEND_FAIL_PUBLIC_KEY',
};

// name → plain-English meaning + the firmware call site that emits the code.
export const ROUTING_ERROR_MEANINGS: Record<string, string> = {
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

// Display label for a captured numeric NAK code, e.g. 39 → "PKI_SEND_FAIL_PUBLIC_KEY".
export function routingErrorName(code: number): string {
  return ROUTING_ERROR_NAMES[code] ?? `err${code}`;
}

// Plain-English meaning for a captured numeric NAK code (undefined if unknown).
export function routingErrorMeaning(code: number): string | undefined {
  const name = ROUTING_ERROR_NAMES[code];
  return name ? ROUTING_ERROR_MEANINGS[name] : undefined;
}
