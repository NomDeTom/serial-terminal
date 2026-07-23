/**
 * "Teleplot" info-panel: charts for lines in the Teleplot serial protocol
 * (https://github.com/nesnes/teleplot), separate from the Meshtastic-specific
 * Data tab. Parsing lives in teleplot.ts; this module wires it to the active
 * session and the panel DOM, following the same recompute-on-refresh pattern
 * as statsView.ts's refreshDataPlot (only re-parses when the panel is open).
 */
import {dom, active} from './appContext';
import {parseTeleplot, renderTeleplotPanel, TeleplotSortMode} from './teleplot';
import type {Session} from './logView';

let suppressZero = false;
// Series names pinned to a 2x tile size by clicking their chart, and the tile
// arrangement state. All module-level (not per-session), like suppressZero
// above — mirrors dataAutoRange/dataFixedRange in statsView.ts.
const enlarged = new Set<string>();
let sortMode: TeleplotSortMode = 'type';
let manualOrder: string[] = [];

const SORT_LABELS: Array<{mode: TeleplotSortMode; label: string; title: string}> = [
  {mode: 'type', label: 'Type', title: 'Group by variable type (numeric / xy / text)'},
  {mode: 'alpha', label: 'A–Z', title: 'Sort alphabetically by name'},
  {mode: 'order', label: 'Order', title: 'Manual order — drag tiles to rearrange'},
];

function renderControls(lineCount: number): string {
  const z = suppressZero ? ' checked' : '';
  const sortBtns = SORT_LABELS.map(({mode, label, title}) =>
    `<button class="tp-sort-btn${mode === sortMode ? ' active' : ''}" data-sort="${mode}" title="${title}">${label}</button>`,
  ).join('');
  return '<div class="dp-controls">' +
    `<label><input type="checkbox" id="tp_suppress_zero"${z}>suppress zero series</label>` +
    `<span class="tp-sort" role="group" aria-label="Arrange tiles">${sortBtns}</span>` +
    `<span class="tp-count">${lineCount} line${lineCount === 1 ? '' : 's'}</span>` +
    '</div>';
}

export function refreshTeleplot(s: Session): void {
  if (!dom.teleplotEl || s !== active) return;
  // Parsing is O(n) over lineHistory — only run when the panel is open.
  if (!dom.panelTeleplotEl || dom.panelTeleplotEl.hidden) return;
  const data = parseTeleplot(s.lineHistory);
  if (data.lineCount === 0) {
    dom.teleplotEl.innerHTML = renderTeleplotPanel(data, {suppressZero, large: false, enlarged, sortMode, manualOrder});
    dom.teleplotDotEl?.classList.remove('visible');
    return;
  }
  const large = dom.workspaceEl.classList.contains('analysis');
  const chartsHtml = renderTeleplotPanel(data, {suppressZero, large, enlarged, sortMode, manualOrder});
  dom.teleplotEl.innerHTML = renderControls(data.lineCount) + chartsHtml;
  dom.teleplotDotEl?.classList.add('visible');
}

// Reads the tile order currently on screen (i.e. whatever sortMode last
// produced), so a drag "snapshots" that as the new manual baseline and only
// the dragged tile's position actually moves relative to it.
function currentTileOrder(): string[] {
  const keys: string[] = [];
  dom.teleplotEl.querySelectorAll<HTMLElement>('.tp-tile[data-key]').forEach((el) => {
    keys.push(el.dataset['key']!);
  });
  return keys;
}

// Returns `order` with `key` removed and reinserted immediately before
// `beforeKey` (or at the end when `beforeKey` is null / not found).
function moveKey(order: string[], key: string, beforeKey: string | null): string[] {
  const without = order.filter((k) => k !== key);
  const idx = beforeKey === null ? -1 : without.indexOf(beforeKey);
  if (idx === -1) {
    without.push(key);
  } else {
    without.splice(idx, 0, key);
  }
  return without;
}

let dragKey: string | null = null;

export function initTeleplotControls(): void {
  dom.teleplotEl.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'tp_suppress_zero') {
      suppressZero = (t as HTMLInputElement).checked;
      refreshTeleplot(active);
    }
  });

  dom.teleplotEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const sortBtn = target.closest<HTMLElement>('.tp-sort-btn');
    if (sortBtn) {
      const mode = sortBtn.dataset['sort'] as TeleplotSortMode | undefined;
      if (mode) {
        sortMode = mode;
        refreshTeleplot(active);
      }
      return;
    }

    // Click a chart tile (not a text tile) to pin it at 2x size.
    const tile = target.closest<HTMLElement>('.tp-plot');
    if (!tile) return;
    const key = tile.dataset['key'];
    if (!key) return;
    if (enlarged.has(key)) enlarged.delete(key); else enlarged.add(key);
    refreshTeleplot(active);
  });

  // Drag-to-reorder: any tile (numeric / xy / text) can be dragged; dropping
  // it onto another tile inserts it immediately before that tile. A drop
  // always switches to "Order" mode, since that's the only mode a manual
  // position means anything in.
  dom.teleplotEl.addEventListener('dragstart', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tp-tile');
    if (!tile) return;
    dragKey = tile.dataset['key'] ?? null;
    tile.classList.add('tp-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragKey ?? '');
    }
  });

  dom.teleplotEl.addEventListener('dragover', (e) => {
    if (!dragKey || !(e.target as HTMLElement).closest('.dp-charts')) return;
    e.preventDefault(); // required to allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dom.teleplotEl.querySelectorAll('.tp-drop-target').forEach((el) => el.classList.remove('tp-drop-target'));
    // Hovering empty space below the last tile (not over a specific tile)
    // means "move to the end" — no target to highlight.
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tp-tile');
    if (tile && tile.dataset['key'] !== dragKey) tile.classList.add('tp-drop-target');
  });

  dom.teleplotEl.addEventListener('drop', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.tp-tile');
    const targetKey = tile && tile.dataset['key'] !== dragKey ? tile.dataset['key'] ?? null : null;
    manualOrder = moveKey(currentTileOrder(), dragKey, targetKey);
    sortMode = 'order';
    refreshTeleplot(active);
  });

  dom.teleplotEl.addEventListener('dragend', () => {
    dragKey = null;
    dom.teleplotEl.querySelectorAll('.tp-dragging, .tp-drop-target').forEach((el) => {
      el.classList.remove('tp-dragging', 'tp-drop-target');
    });
  });
}
