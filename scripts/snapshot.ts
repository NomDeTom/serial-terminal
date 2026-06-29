/**
 * Golden-output snapshot harness (regression net for the logSummary refactor).
 *
 * Runs the exact data pipeline the page uses for file loads
 * (index.ts loadFileInto -> addLine): preprocessLine -> updateSummary +
 * updateSummaryCumulative per non-empty line, then flushMultiLine, then the
 * render* functions. Captures rendered HTML/SVG + a stable JSON dump of the
 * accumulated state for every file in log-inputs/.
 *
 * Usage:  tsx scripts/snapshot.ts [outDir]   (default outDir = "snapshots")
 *
 * The harness is deliberately self-contained and DOM-free. It does NOT call
 * initDeviceInfo(), so hardware-list lookups return undefined (displayName /
 * hwModelSlug stay unset) — that is fine: the comparator only needs
 * before-vs-after determinism, not byte-for-byte parity with the live page.
 */
import {readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {preprocessLine} from '../src/logParser';
import {flushMultiLine} from '../src/multiLineMatch';
import {emptySummary} from '../src/deviceSummary';
import {updateSummary, updateSummaryCumulative} from '../src/logSummary';
import {
  renderSummary, renderHopChart, renderChannelHashChart, renderNodeStatusTile,
  renderNodeCountChart, renderSeenNodesTable,
} from '../src/summaryRenderer';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const INPUTS = join(ROOT, 'log-inputs');
const OUT = join(ROOT, process.argv[2] ?? 'snapshots');

// Stable JSON: sort object keys recursively and drop any key starting with '_'
// (transient matcher state: _ml, _rxHashById, _seenPacketIds) so diffs are
// meaningful and order-independent.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      if (k.startsWith('_')) continue;
      out[k] = stable((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function stableJson(obj: unknown): string {
  return JSON.stringify(stable(obj), null, 2);
}

function snapshotFile(name: string): void {
  const text = readFileSync(join(INPUTS, name), 'utf8');
  const lines = text.split(/\r?\n/);

  const summary = emptySummary();
  const cumulative = emptySummary();
  for (const raw of lines) {
    if (!raw) continue; // mirror `if (lines[j])` skip of empty lines in addLine
    const clean = preprocessLine(raw);
    updateSummary(clean, summary);
    updateSummaryCumulative(clean, cumulative);
  }
  flushMultiLine(summary);
  flushMultiLine(cumulative);

  const dir = join(OUT, name);
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'summary.html'), renderSummary(summary));
  writeFileSync(join(dir, 'hop.svg'), renderHopChart(summary));
  writeFileSync(join(dir, 'channelHash.svg'), renderChannelHashChart(summary));
  writeFileSync(join(dir, 'nodeStatus.html'), renderNodeStatusTile(summary));
  writeFileSync(join(dir, 'nodeCount.svg'), renderNodeCountChart(summary));
  writeFileSync(join(dir, 'seenNodes.html'), renderSeenNodesTable(summary));
  writeFileSync(join(dir, 'summary.json'), stableJson(summary));
  writeFileSync(join(dir, 'cumulative.json'), stableJson(cumulative));
}

function main(): void {
  rmSync(OUT, {recursive: true, force: true});
  mkdirSync(OUT, {recursive: true});
  const files = readdirSync(INPUTS).sort();
  let n = 0;
  for (const name of files) {
    try {
      snapshotFile(name);
      n++;
    } catch (err) {
      console.error(`FAILED on ${name}:`, err);
    }
  }
  console.log(`Wrote snapshots for ${n}/${files.length} files -> ${OUT}`);
}

main();
