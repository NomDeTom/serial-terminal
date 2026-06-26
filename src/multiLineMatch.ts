// Multi-line / split-tolerant log pattern matching.
//
// The single-line MATCHERS in logSummary.ts each see exactly one line. This
// module adds a complementary layer for logical events the firmware prints across
// several lines, tolerating unrelated lines interleaved between the related ones
// (multiple FreeRTOS tasks log concurrently, so one event's lines can be split by
// another thread's output). See .notes/multiline-patterns.md for the firmware-
// confirmed patterns this encodes.
//
// Two primitives, both fed one line at a time and both bounded by a line-count
// `window` (timestamps are unreliable / may be ??:??:??):
//   • SequenceDef — an ordered chain opened by a header line, advancing through
//     steps; continuation steps are usually prefix-less. Used for traceroute.
//   • ClusterDef  — an unordered set of related signals; the event fires when a
//     qualifying combination co-occurs within the window. Used for the NodeDB
//     write-failure correlation.
//
// State lives on each DeviceSummary (`_ml`), so the per-boot summary and the
// cumulative summary track independently and a boot reset wipes it for free.

import {parseLine} from './logParser';
import type {DeviceSummary} from './logSummary';

// A line is a continuation when it carries no recognised log prefix
// (LEVEL | TIME UPTIME [Module] …). parseLine returns an empty level AND module
// for such a line — the strongest "belongs to the previous message" signal.
export function isContinuation(line: string): boolean {
  const p = parseLine(line);
  return p.level === '' && p.module === '';
}

// ── Sequence primitive ──────────────────────────────────────────────────────

interface SeqStep {
  // Returns the regex match (captures) when `line` satisfies this step, else null.
  test: (line: string, continuation: boolean) => RegExpMatchArray | null;
  // A repeat step matches one or more consecutive qualifying lines.
  repeat?: boolean;
}

interface SequenceDef {
  kind: 'sequence';
  name: string;
  window: number;            // unrelated lines tolerated between steps
  steps: SeqStep[];          // steps[0] opens the sequence
  apply: (caps: RegExpMatchArray[], s: DeviceSummary) => void;
}

interface ActiveSequence {
  def: SequenceDef;
  stepIdx: number;           // index of the step currently being matched
  caps: RegExpMatchArray[];
  gap: number;               // unrelated lines since the last advance
  matchedRepeat: boolean;    // current repeat step has matched ≥1 line
}

function seqAtRepeatEnd(act: ActiveSequence): boolean {
  const last = act.def.steps.length - 1;
  return act.stepIdx === last && !!act.def.steps[last].repeat;
}

function seqComplete(act: ActiveSequence): boolean {
  if (act.stepIdx >= act.def.steps.length) return true;
  return seqAtRepeatEnd(act) && act.matchedRepeat;
}

// ── Cluster primitive ───────────────────────────────────────────────────────

interface ClusterSignal {
  key: string;
  test: (line: string) => RegExpMatchArray | null;
  capture?: (m: RegExpMatchArray, acc: Record<string, unknown>) => void;
}

interface ClusterDef {
  kind: 'cluster';
  name: string;
  window: number;            // lines since the last signal before the cluster closes
  signals: ClusterSignal[];
  qualifies: (seen: Set<string>) => boolean;
  apply: (seen: Set<string>, acc: Record<string, unknown>, s: DeviceSummary) => void;
}

interface ActiveCluster {
  def: ClusterDef;
  seen: Set<string>;
  acc: Record<string, unknown>;
  gap: number;               // lines since the last matched signal
}

export interface MultiLineState {
  seqs: ActiveSequence[];
  clusters: ActiveCluster[];
}

export function createMultiLineState(): MultiLineState {
  return {seqs: [], clusters: []};
}

// ── Definitions ─────────────────────────────────────────────────────────────

// M1 Traceroute result (TraceRouteModule.cpp::printRoute). One LOG_INFO with
// embedded \n renders as a prefixed "Route traced:" header followed by 1-2
// prefix-less route lines: "0x.. --> 0x.. (NdB) --> .." and an optional reverse
// "(NdB) 0x.. <-- ..". See .notes/multiline-patterns.md §2.
const ROUTE_LINE = /(?:-->|<--)/;
const traceroute: SequenceDef = {
  kind: 'sequence',
  name: 'traceroute',
  window: 8,
  steps: [
    {test: (line, cont) => (!cont && /Route traced:\s*$/.test(line)) ? line.match(/.+/) : null},
    {repeat: true,
      test: (line, cont) =>
        (cont && ROUTE_LINE.test(line) && /0x[0-9a-fA-F]+/.test(line)) ? line.match(/.+/) : null},
  ],
  apply: (caps, s) => {
    const routeLines = caps.slice(1).map((c) => c[0]);
    if (routeLines.length === 0) return;
    const forward = routeLines.find((l) => l.includes('-->')) ?? routeLines[0];
    const back = routeLines.find((l) => l.includes('<--'));
    const hops = (forward.match(/-->/g) ?? []).length ||
      (back ? (back.match(/<--/g) ?? []).length : 0);
    const snrs: number[] = [];
    for (const l of routeLines) {
      const m = l.match(/\(([-\d.]+)dB\)/g) ?? [];
      for (const tok of m) snrs.push(Number(tok.slice(1, -3)));
    }
    s.traceroutes = (s.traceroutes ?? 0) + 1;
    s.tracerouteLastHops = hops;
    s.tracerouteMaxHops = Math.max(s.tracerouteMaxHops ?? 0, hops);
    for (const v of snrs) {
      s.tracerouteHopSnrs.push(v);
      s.tracerouteWorstSnr = s.tracerouteWorstSnr === undefined ?
        v : Math.min(s.tracerouteWorstSnr, v);
    }
    if (s.tracerouteHopSnrs.length > 500) {
      s.tracerouteHopSnrs.splice(0, s.tracerouteHopSnrs.length - 500);
    }
  },
};

// M2 NodeDB / prefs write failure (NodeDB.cpp saveProto + saveToDisk). Four
// loosely-ordered ERROR lines that the single-line matchers count separately;
// correlated here into one event. Qualifies only when a *write outcome* signal
// is present (a failed write or a flash-corruption critical error) — the encode
// error alone is just the cause. See .notes/multiline-patterns.md §1.
const nodeDbWrite: ClusterDef = {
  kind: 'cluster',
  name: 'nodeDbWrite',
  window: 30,
  signals: [
    {key: 'encode',
      test: (l) => l.match(/Error: can.?t encode protobuf\s*(.*)/),
      capture: (m, acc) => {
        const cause = m[1].trim();
        if (cause) acc.cause = cause;
      }},
    {key: 'cantWritePrefs', test: (l) => l.match(/Can.?t write prefs!/)},
    {key: 'failedSaveRetry', test: (l) => l.match(/Failed to save to disk, retrying/)},
    {key: 'critFlash',
      test: (l) => l.match(/Record critical error (1[23]) at/),
      capture: (m, acc) => {
        acc.critCode = Number(m[1]);
      }},
  ],
  qualifies: (seen) =>
    seen.has('cantWritePrefs') || seen.has('failedSaveRetry') || seen.has('critFlash'),
  apply: (seen, acc, s) => {
    s.nodeDbWriteFailures = (s.nodeDbWriteFailures ?? 0) + 1;
    s.nodeDbWriteFailure = {
      cause: acc.cause as string | undefined,
      retried: seen.has('failedSaveRetry'),
      cantWritePrefs: seen.has('cantWritePrefs'),
      critCode: acc.critCode as number | undefined,
    };
  },
};

const SEQUENCE_DEFS: SequenceDef[] = [traceroute];
const CLUSTER_DEFS: ClusterDef[] = [nodeDbWrite];

// ── Engine ──────────────────────────────────────────────────────────────────

function feedSequences(state: MultiLineState, line: string, cont: boolean, s: DeviceSummary): void {
  const survivors: ActiveSequence[] = [];
  for (const act of state.seqs) {
    const last = act.def.steps.length - 1;

    if (seqAtRepeatEnd(act)) {
      const m = act.def.steps[last].test(line, cont);
      if (m) {                       // another continuation line for the repeat step
        act.caps.push(m);
        act.matchedRepeat = true;
        act.gap = 0;
        survivors.push(act);
        continue;
      }
      if (act.matchedRepeat) {       // repeat ended on a non-matching line → complete
        act.def.apply(act.caps, s);
        continue;                    // this line is not consumed; falls through to opening
      }
      // still waiting for the first repeat line
      if (++act.gap > act.def.window) continue;
      survivors.push(act);
      continue;
    }

    // Normal (non-final-repeat) step.
    const m = act.def.steps[act.stepIdx].test(line, cont);
    if (m) {
      act.caps.push(m);
      act.stepIdx++;
      act.gap = 0;
      if (seqComplete(act)) {
        act.def.apply(act.caps, s);
        continue;
      }
      survivors.push(act);
      continue;
    }
    if (++act.gap > act.def.window) continue; // give up; don't wedge
    survivors.push(act);
  }
  state.seqs = survivors;

  // Open new sequences (at most one active per def).
  for (const def of SEQUENCE_DEFS) {
    if (state.seqs.some((a) => a.def === def)) continue;
    const m = def.steps[0].test(line, cont);
    if (!m) continue;
    const act: ActiveSequence = {def, stepIdx: 1, caps: [m], gap: 0, matchedRepeat: false};
    if (seqComplete(act)) act.def.apply(act.caps, s);
    else state.seqs.push(act);
  }
}

function feedClusters(state: MultiLineState, line: string, s: DeviceSummary): void {
  const touched = new Set<ClusterDef>();
  for (const def of CLUSTER_DEFS) {
    let act = state.clusters.find((c) => c.def === def);
    for (const sig of def.signals) {
      const m = sig.test(line);
      if (!m) continue;
      if (!act) {
        act = {def, seen: new Set(), acc: {}, gap: 0};
        state.clusters.push(act);
      }
      act.seen.add(sig.key);
      sig.capture?.(m, act.acc);
      act.gap = 0;
      touched.add(def);
    }
  }
  state.clusters = state.clusters.filter((act) => {
    if (touched.has(act.def)) return true;
    if (++act.gap > act.def.window) {
      if (act.def.qualifies(act.seen)) act.def.apply(act.seen, act.acc, s);
      return false;
    }
    return true;
  });
}

// Feed one preprocessed line into the multi-line layer. Call after the single-line
// matchers so any state they set is already in place.
export function feedMultiLine(line: string, s: DeviceSummary): void {
  if (!s._ml) s._ml = createMultiLineState();
  const state = s._ml;

  // A boot banner ends every in-flight logical event — a partial sequence must
  // not straddle a reboot. (The per-boot summary is already wiped elsewhere; the
  // cumulative summary is not, so this clearing matters there.)
  if (/\bS:B:/.test(line)) {
    state.seqs = [];
    state.clusters = [];
    return;
  }

  const cont = isContinuation(line);
  feedSequences(state, line, cont, s);
  feedClusters(state, line, s);
}

// Finalise anything still pending — call once at end-of-stream (bulk file load).
// Live streaming finalises naturally as later lines arrive.
export function flushMultiLine(s: DeviceSummary): void {
  const state = s._ml;
  if (!state) return;
  for (const act of state.seqs) {
    if (seqComplete(act)) act.def.apply(act.caps, s);
  }
  for (const act of state.clusters) {
    if (act.def.qualifies(act.seen)) act.def.apply(act.seen, act.acc, s);
  }
  state.seqs = [];
  state.clusters = [];
}
