const KNOWN: Record<string, string> = {
  'ffffffff': 'BROADCAST',
  '00000000': 'NULL',
};

// ANSI codes used in terminal highlights
const HI = '\x1b[47m\x1b[30m';  // white bg + black text — marks raw PII values
const HI0 = '\x1b[0m';
const PH = '\x1b[33m';          // amber text — marks [REDACTED]/[NODE-N] placeholders
const PH0 = '\x1b[0m';

// A public key is logged as a run of space-separated hex byte pairs
// ("Saved Pubkey:  45 09 24 …"). 8+ groups distinguishes it from short hex.
const PUBKEY_RE = /((?:Saved|Incoming) Pubkey:\s+)((?:[0-9a-fA-F]{2}\s+){7,}[0-9a-fA-F]{2})/g;

export class PiiFilter {
  enabled = false;
  private nodeMap = new Map<string, string>();
  private counter = 0;
  private keyMap = new Map<string, string>();
  private keyCounter = 0;

  filter(text: string): string {
    if (!this.enabled) return text;
    return text
    // Public keys (Curve25519, 32 bytes) → [PUBKEY-N]. Done first so the
    // node-ID rules below never nibble at the key's hex bytes.
        .replace(PUBKEY_RE, (_, lbl, hex) => `${lbl}[${this.pubAlias(hex)}]`)
    // Node IDs with 0x or ! prefix → [NODE-N]
        .replace(/(?:0x|!)([0-9a-fA-F]{8})/gi, (_, hex) => `[${this.alias(hex)}]`)
    // Node IDs with @ prefix (pos@XXXXXXXX) → @[NODE-N]
        .replace(/@([0-9a-fA-F]{8})/gi, (_, hex) => `@[${this.alias(hex)}]`)
    // Node IDs printed as bare hex in node= fields (no 0x prefix, e.g. "POSITION node=72336512")
        .replace(/\bnode=([0-9a-fA-F]{8})\b/gi, (_, hex) => `node=[${this.alias(hex)}]`)
    // JSON long/short names from nodeInfo payloads
        .replace(/"longName"\s*:\s*"[^"]*"/g, '"longName":"[REDACTED]"')
        .replace(/"shortName"\s*:\s*"[^"]*"/g, '"shortName":"[REDACTED]"')
    // GPS key=value pairs (decimal or scaled-integer forms)
        .replace(/\blat(?:itude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, 'lat=[REDACTED]')
        .replace(/\blon(?:gitude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, 'lon=[REDACTED]')
    // BLE peer device name (e.g. "BLE Connected to Thomas's S10")
        .replace(/(BLE Connected to ).+/i, '$1[REDACTED]')
    // Node long name in "owner = " line
        .replace(/(owner = )[^(]+/, '$1[REDACTED] ');
  }

  // Wraps raw PII patterns in ANSI highlight — used in the terminal when PII is OFF
  // to show what would be redacted. Call this on the already-colorized line.
  annotate(text: string): string {
    return text
        .replace(PUBKEY_RE, (_, lbl, hex) => `${lbl}${HI}${hex}${HI0}`)
        .replace(/(?:0x|!)([0-9a-fA-F]{8})/gi, `${HI}$&${HI0}`)
        .replace(/@([0-9a-fA-F]{8})/gi, `@${HI}$1${HI0}`)
        .replace(/\bnode=([0-9a-fA-F]{8})\b/gi, `node=${HI}$1${HI0}`)
        .replace(/"longName"\s*:\s*"[^"]*"/g, `${HI}$&${HI0}`)
        .replace(/"shortName"\s*:\s*"[^"]*"/g, `${HI}$&${HI0}`)
        .replace(/\blat(?:itude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, `${HI}$&${HI0}`)
        .replace(/\blon(?:gitude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, `${HI}$&${HI0}`)
        .replace(/(BLE Connected to )(.+)/i, `$1${HI}$2${HI0}`)
        .replace(/(owner = )([^(]+)/, `$1${HI}$2${HI0}`);
  }

  // Wraps [REDACTED]/[NODE-N] placeholders in amber — used when PII is ON.
  highlightPlaceholders(text: string): string {
    return text.replace(
        /\[(NODE-\d+|PUBKEY-\d+|BROADCAST|NULL|REDACTED)\]/g,
        `${PH}$&${PH0}`,
    );
  }

  private alias(hex: string): string {
    const key = hex.toLowerCase();
    if (KNOWN[key]) return KNOWN[key];
    if (!this.nodeMap.has(key)) {
      this.nodeMap.set(key, `NODE-${++this.counter}`);
    }
    return this.nodeMap.get(key)!;
  }

  // Stable alias for a public key — keeps distinct keys distinguishable in the
  // redacted output (so "same key seen twice" is still visible) without
  // exposing the key itself. Normalised on whitespace so spacing can't fork it.
  private pubAlias(hex: string): string {
    const key = hex.replace(/\s+/g, '').toLowerCase();
    if (!this.keyMap.has(key)) {
      this.keyMap.set(key, `PUBKEY-${++this.keyCounter}`);
    }
    return this.keyMap.get(key)!;
  }

  // Call on disconnect/clear so node numbering resets
  reset(): void {
    this.nodeMap.clear();
    this.counter = 0;
    this.keyMap.clear();
    this.keyCounter = 0;
  }
}
