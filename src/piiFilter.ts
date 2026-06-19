const KNOWN: Record<string, string> = {
  'ffffffff': 'BROADCAST',
  '00000000': 'NULL',
};

export class PiiFilter {
  enabled = false;
  private nodeMap = new Map<string, string>();
  private counter = 0;

  filter(text: string): string {
    if (!this.enabled) return text;
    return text
    // Node IDs: 0xabcdef12 or !abcdef12
        .replace(/(?:0x|!)([0-9a-fA-F]{8})/gi, (_, hex) => `[${this.alias(hex)}]`)
    // JSON long/short names from nodeInfo payloads
        .replace(/"longName"\s*:\s*"[^"]*"/g, '"longName":"[REDACTED]"')
        .replace(/"shortName"\s*:\s*"[^"]*"/g, '"shortName":"[REDACTED]"')
    // GPS key=value pairs
        .replace(/\blat(?:itude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, 'lat=[REDACTED]')
        .replace(/\blon(?:gitude)?\s*=\s*-?[0-9]+\.?[0-9]*/gi, 'lon=[REDACTED]');
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
