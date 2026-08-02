/**
 * Lightweight masonry-style packing for the DATA tab's tile grid
 * (#dataPlotContent .dp-charts). Plain CSS can't do what's needed here: multi-
 * column layout only supports "1 column" or "all columns" per tile (no
 * arbitrary 2-of-N spans), and CSS grid can't avoid dead space next to
 * variable-height tiles (row height is set by the tallest cell in that row).
 * So this does a small greedy shortest-column placement instead — same idea
 * as Masonry.js/Packery, small enough not to need a dependency.
 *
 * Deliberately NOT used for the Teleplot tab's tile grid, which shares the
 * `.dp-charts` class name: Teleplot tiles are drag-reorderable and depend on
 * row-major DOM order matching visual order for the drop-target logic, which
 * column-major masonry placement would make confusing.
 */

const GAP = 14;
const MIN_COL_WIDTH = 300;

// Tiles opt into a wider slot via `data-span` ("2", or "full" for the whole row);
// default is 1 column. Read fresh on every layout pass, never cached, so
// enlarging a tile (which just changes the attribute before layoutMasonry
// re-runs) is enough to reflow it wider.
function tileSpan(tile: HTMLElement, columnCount: number): number {
  const raw = tile.dataset['span'];
  if (raw === 'full') return columnCount;
  const n = parseInt(raw ?? '1', 10);
  return Math.min(columnCount, Math.max(1, Number.isFinite(n) ? n : 1));
}

export function layoutMasonry(container: HTMLElement): void {
  const tiles = Array.from(container.children) as HTMLElement[];
  if (tiles.length === 0) {
    container.style.height = '';
    return;
  }

  const containerWidth = container.clientWidth;
  if (containerWidth <= 0) return; // hidden pane (display:none) — nothing to measure yet

  const columnCount = Math.max(1, Math.floor((containerWidth + GAP) / (MIN_COL_WIDTH + GAP)));
  const columnWidth = (containerWidth - GAP * (columnCount - 1)) / columnCount;
  const spans = tiles.map((tile) => tileSpan(tile, columnCount));

  // Pass 1 (writes): assign each tile the width it'll actually render at,
  // still in normal flow — height depends on width (text wrap, table width),
  // so this has to happen before measuring.
  tiles.forEach((tile, i) => {
    tile.style.position = 'static';
    tile.style.width = `${spans[i] * columnWidth + (spans[i] - 1) * GAP}px`;
  });

  // Pass 2 (reads): batched after all the writes above, so the browser isn't
  // forced to interleave a layout recalculation between every tile.
  const heights = tiles.map((tile) => tile.offsetHeight);

  // Pass 3 (writes): greedy shortest-column-run placement in DOM order.
  const colHeights = new Array(columnCount).fill(0);
  tiles.forEach((tile, i) => {
    const span = spans[i];
    let bestStart = 0;
    let bestHeight = Infinity;
    for (let start = 0; start <= columnCount - span; start++) {
      let h = 0;
      for (let c = start; c < start + span; c++) h = Math.max(h, colHeights[c]);
      if (h < bestHeight) {
        bestHeight = h;
        bestStart = start;
      }
    }
    tile.style.position = 'absolute';
    tile.style.left = `${bestStart * (columnWidth + GAP)}px`;
    tile.style.top = `${bestHeight}px`;
    const newHeight = bestHeight + heights[i] + GAP;
    for (let c = bestStart; c < bestStart + span; c++) colHeights[c] = newHeight;
  });

  container.style.height = `${Math.max(...colHeights) - GAP}px`;
}
