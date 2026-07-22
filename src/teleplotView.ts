/**
 * "Teleplot" info-panel: charts for lines in the Teleplot serial protocol
 * (https://github.com/nesnes/teleplot), separate from the Meshtastic-specific
 * Data tab. Parsing lives in teleplot.ts; this module wires it to the active
 * session and the panel DOM, following the same recompute-on-refresh pattern
 * as statsView.ts's refreshDataPlot (only re-parses when the panel is open).
 */
import {dom, active} from './appContext';
import {parseTeleplot, renderTeleplotPanel} from './teleplot';
import type {Session} from './logView';

let suppressZero = false;
// Series names pinned to a 2x tile size by clicking their chart. Module-level
// (like suppressZero above), not per-session — mirrors dataAutoRange/
// dataFixedRange in statsView.ts.
const enlarged = new Set<string>();

function renderControls(lineCount: number): string {
  const z = suppressZero ? ' checked' : '';
  return '<div class="dp-controls">' +
    `<label><input type="checkbox" id="tp_suppress_zero"${z}>suppress zero series</label>` +
    `<span class="tp-count">${lineCount} line${lineCount === 1 ? '' : 's'}</span>` +
    '</div>';
}

export function refreshTeleplot(s: Session): void {
  if (!dom.teleplotEl || s !== active) return;
  // Parsing is O(n) over lineHistory — only run when the panel is open.
  if (!dom.panelTeleplotEl || dom.panelTeleplotEl.hidden) return;
  const data = parseTeleplot(s.lineHistory);
  if (data.lineCount === 0) {
    dom.teleplotEl.innerHTML = renderTeleplotPanel(data, {suppressZero, large: false, enlarged});
    dom.teleplotDotEl?.classList.remove('visible');
    return;
  }
  const large = dom.workspaceEl.classList.contains('analysis');
  const chartsHtml = renderTeleplotPanel(data, {suppressZero, large, enlarged});
  dom.teleplotEl.innerHTML = renderControls(data.lineCount) + chartsHtml;
  dom.teleplotDotEl?.classList.add('visible');
}

export function initTeleplotControls(): void {
  dom.teleplotEl.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'tp_suppress_zero') {
      suppressZero = (t as HTMLInputElement).checked;
      refreshTeleplot(active);
    }
  });
  // Click a chart tile to pin it (or a click-selected set of them) at 2x size.
  dom.teleplotEl.addEventListener('click', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tp-plot');
    if (!tile) return;
    const key = tile.dataset['key'];
    if (!key) return;
    if (enlarged.has(key)) enlarged.delete(key); else enlarged.add(key);
    refreshTeleplot(active);
  });
}
