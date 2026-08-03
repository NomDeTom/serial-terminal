/**
 * Mobile layout: below the breakpoint the desktop's four stacked control bars
 * (toolbar / mode-bar / port-bar / filter-bar) wrap into ~450px of chrome —
 * more than half a phone screen — and the footer's link list overlaps the
 * workspace. So on mobile the bars are *relocated* rather than restyled in
 * place: the connection controls move into a "Connection" bottom sheet, the
 * filters and log actions into a "Filters & actions" sheet, and search (the
 * one high-frequency control) into a permanent slim bar under the tabs.
 *
 * Relocation moves the real elements, so there is exactly one copy of every
 * control and every listener bound elsewhere keeps working — no duplicated
 * markup to keep in sync. Each element leaves a comment node behind marking
 * its desktop position, so crossing back over the breakpoint restores the
 * original DOM order exactly.
 */
import {dom, active, isMobileLayout, onMobileLayoutChange} from './appContext';

interface Relocatable {
  el: HTMLElement;
  anchor: Comment;        // invisible placeholder marking the desktop position
  targetId: string;       // mobile host container
}

const relocatables: Relocatable[] = [];
let relocatedToMobile = false;

// Registration order is append order within each target container.
function register(el: HTMLElement | null, targetId: string): void {
  if (!el?.parentNode) return;
  const anchor = document.createComment(`relocate:${targetId}`);
  el.parentNode.insertBefore(anchor, el);
  relocatables.push({el, anchor, targetId});
}

function applyLayout(mobile: boolean): void {
  if (mobile === relocatedToMobile) return;
  for (const r of relocatables) {
    if (mobile) {
      document.getElementById(r.targetId)?.appendChild(r.el);
    } else {
      r.anchor.parentNode?.insertBefore(r.el, r.anchor);
    }
  }
  relocatedToMobile = mobile;
  if (!mobile) closeSheets();
  // Chrome height changed, so the terminal's available rows did too.
  active.fit.fit();
}

// ── Bottom sheets ─────────────────────────────────────────────────────────────

function closeSheets(): void {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
  dom.sheetBackdropEl.classList.remove('active');
}

function openSheet(id: string): void {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  const alreadyOpen = sheet.classList.contains('open');
  closeSheets();
  if (alreadyOpen) return;   // tapping the same trigger again closes it
  sheet.classList.add('open');
  dom.sheetBackdropEl.classList.add('active');
}

export function initMobileLayout(): void {
  // Setup sheet: whichever source controls the active view shows — serial port
  // picker / connect / baud / reconnect / polyfill switcher, or the file picker —
  // plus the remembered-ports strip.
  register(document.querySelector<HTMLElement>('.mode-bar'), 'sheet_setup_body');
  register(document.getElementById('port_bar'), 'sheet_setup_body');
  // Actions sheet: level/module filters, PII, autoscroll/static-scroll/bottom,
  // save/clear, and credits (dropped from the app bar for space).
  register(document.querySelector<HTMLElement>('.filter-bar'), 'sheet_actions_body');
  register(dom.creditsBtn, 'sheet_actions_body');
  // Always-visible slim bar under the pane tabs.
  register(document.getElementById('search_group'), 'mobile_search_bar');
  register(dom.interactiveToggleBtn, 'mobile_search_bar');

  dom.sheetSetupBtn.addEventListener('click', () => openSheet('sheet_setup'));
  dom.sheetActionsBtn.addEventListener('click', () => openSheet('sheet_actions'));
  dom.sheetBackdropEl.addEventListener('click', closeSheets);
  document.querySelectorAll('[data-sheet-close]').forEach((btn) => {
    btn.addEventListener('click', closeSheets);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheets();
  });

  applyLayout(isMobileLayout());
  onMobileLayoutChange(applyLayout);
}
