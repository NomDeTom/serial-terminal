// Public-channel candidates per channel-hash byte.
//
// A Meshtastic channel hash is one byte derived from (channel name + PSK), so
// many configs collide on the same hash. This table covers only the *public*
// presets — the named channels using the well-known default PSK "AQ==" (the
// single-byte key 0x01) or no PSK at all ("" / none). Extracted from the
// channel_rainbow.csv rainbow table (rows where psk_label is AQ== or (none)).
//
// Use: given a heard/sent channel hash, suggest which public preset(s) it
// could be — e.g. hash 0x08 with the default key is the LongFast public channel.

const AQ_NAMES: Record<number, string[]> = {
  0x02: ['(empty)'],
  0x08: ['LongFast', 'TinyFast'],
  0x0e: ['ShortTurbo'],
  0x0f: ['LongSlow', 'TinySlow'],
  0x11: ['LiteSlow'],
  0x12: ['NarrowSlow'],
  0x15: ['NarrowFast'],
  0x16: ['LiteFast'],
  0x18: ['MediumSlow'],
  0x1f: ['MediumFast'],
  0x59: ['VLongSlow'],
  0x6e: ['LongMod'],
  0x70: ['ShortFast'],
  0x76: ['LongTurbo'],
  0x77: ['ShortSlow'],
};

const NONE_NAMES: Record<number, string[]> = {
  0x00: ['(empty)'],
  0x0a: ['LongFast', 'TinyFast'],
  0x0c: ['ShortTurbo'],
  0x0d: ['LongSlow', 'TinySlow'],
  0x10: ['NarrowSlow'],
  0x13: ['LiteSlow'],
  0x14: ['LiteFast'],
  0x17: ['NarrowFast'],
  0x1a: ['MediumSlow'],
  0x1d: ['MediumFast'],
  0x5b: ['VLongSlow'],
  0x6c: ['LongMod'],
  0x72: ['ShortFast'],
  0x74: ['LongTurbo'],
  0x75: ['ShortSlow'],
};

// Returns a multi-line hint listing the public presets that hash to `byte`,
// or '' if none are known. Each line names the PSK and the matching presets.
export function publicChannelHint(byte: number): string {
  const lines: string[] = [];
  const aq = AQ_NAMES[byte];
  const none = NONE_NAMES[byte];
  if (aq) lines.push(`default PSK (AQ==): ${aq.join(', ')}`);
  if (none) lines.push(`no PSK: ${none.join(', ')}`);
  return lines.join('\n');
}
