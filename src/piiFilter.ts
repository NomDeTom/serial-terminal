const KNOWN: Record<string, string> = {
  'ffffffff': 'BROADCAST',
  '00000000': 'NULL',
};

// ANSI codes used in terminal highlights
const HI = '\x1b[47m\x1b[30m';  // white bg + black text — marks raw PII values
const HI0 = '\x1b[0m';
const PH = '\x1b[33m';          // amber text — marks [REDACTED]/[NODE-N] placeholders
const PH0 = '\x1b[0m';

export class PiiFilter {
  enabled = false;
  private nodeMap = new Map<string, string>();
  private counter = 0;

  filter(text: string): string {
    if (!this.enabled) return text;
    return text
    // Node IDs with 0x or ! prefix → [NODE-N]
        .replace(/(?:0x|!)([0-9a-fA-F]{8})/gi, (_, hex) => `[${this.alias(hex)}]`)
    // Node IDs with @ prefix (pos@XXXXXXXX) → @[NODE-N]
        .replace(/@([0-9a-fA-F]{8})/gi, (_, hex) => `@[${this.alias(hex)}]`)
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
        .replace(/(?:0x|!)([0-9a-fA-F]{8})/gi, `${HI}$&${HI0}`)
        .replace(/@([0-9a-fA-F]{8})/gi, `@${HI}$1${HI0}`)
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
        /\[(NODE-\d+|BROADCAST|NULL|REDACTED)\]/g,
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

  // Call on disconnect/clear so node numbering resets
  reset(): void {
    this.nodeMap.clear();
    this.counter = 0;
  }
}
