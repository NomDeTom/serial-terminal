/**
 * Shared application state: the live "active session" pointer and the one-time
 * DOM element lookup. Feature modules (logView, statsView, diagnosisView,
 * serialSource, fileSource, viewController) read `active` / `dom` from here so no
 * module has to import another just to reach shared chrome. This module imports
 * only the `Session` *type* (erased at compile time), so it never participates in
 * a runtime import cycle.
 */
import type {Session} from './logView';

// ── Active session (live bindings; importers see reassignments) ───────────────
export let serialSession: Session;
export let fileSession: Session;
export let active: Session;

export function initSessions(serial: Session, file: Session): void {
  serialSession = serial;
  fileSession = file;
  active = serial;
}

export function setActive(s: Session): void {
  active = s;
}

// Hook registered by serialSource so the view controller can refresh the port bar
// on view changes without importing serialSource (which depends on the view
// controller). Default is a no-op until serialSource registers its implementation.
// eslint-disable-next-line @typescript-eslint/no-empty-function
export let updatePortBar: () => void = () => {};
export function setUpdatePortBar(fn: () => void): void {
  updatePortBar = fn;
}

// Hook registered by interactiveSerial so the view controller can turn off
// interactive mode when switching to the File view (which has no live port to
// write to) without importing interactiveSerial (which depends on switchView).
// eslint-disable-next-line @typescript-eslint/no-empty-function
export let onViewSwitched: (kind: 'serial' | 'file') => void = () => {};
export function setOnViewSwitched(fn: (kind: 'serial' | 'file') => void): void {
  onViewSwitched = fn;
}

// ── Shared DOM refs (populated once by initDom at bootstrap) ──────────────────
export interface Dom {
  // Info panel content + panes
  summaryEl: HTMLElement;
  dataPlotEl: HTMLElement;
  diagnosisEl: HTMLElement;
  interestEl: HTMLElement;
  teleplotEl: HTMLElement;
  infoPanelEl: HTMLElement;
  panelSummaryEl: HTMLElement;
  panelDataEl: HTMLElement;
  panelDiagnosisEl: HTMLElement;
  panelInterestEl: HTMLElement;
  panelTeleplotEl: HTMLElement;
  workspaceEl: HTMLElement;
  dataDotEl: HTMLElement;
  diagnosisDotEl: HTMLElement;
  interestDotEl: HTMLElement;
  teleplotDotEl: HTMLElement;
  // Filters / search chrome
  moduleBtnsEl: HTMLElement;
  moduleOverflowEl: HTMLElement;
  moduleOverflowToggleBtn: HTMLButtonElement;
  logSearchInput: HTMLInputElement;
  searchFilterBtn: HTMLButtonElement;
  highlightLinesBtn: HTMLButtonElement;
  searchCountEl: HTMLElement;
  // Serial controls
  portChipsEl: HTMLElement;
  statusDot: HTMLElement;
  portSelector: HTMLSelectElement;
  connectButton: HTMLButtonElement;
  baudRateSelector: HTMLSelectElement;
  customBaudRateInput: HTMLInputElement;
  dataBitsSelector: HTMLSelectElement;
  paritySelector: HTMLSelectElement;
  stopBitsSelector: HTMLSelectElement;
  flowControlCheckbox: HTMLInputElement;
  reconnectCheckbox: HTMLInputElement;
  grabNextCheckbox: HTMLInputElement;
  // File controls
  fileNameEl: HTMLElement;
  fileProgressEl: HTMLElement;
  fileProgressFillEl: HTMLElement;
  fileProgressPctEl: HTMLElement;
  // Interactive serial controls
  interactiveToggleBtn: HTMLButtonElement;
  interactiveControlsEl: HTMLElement;
  interactiveStyleTypeBtn: HTMLButtonElement;
  interactiveStyleEntryBtn: HTMLButtonElement;
  interactiveTypeHintEl: HTMLElement;
  interactiveEntryRowEl: HTMLElement;
  interactiveInputEl: HTMLInputElement;
  interactiveNewlineCheckbox: HTMLInputElement;
  interactiveSendBtn: HTMLButtonElement;
  // Mobile layout: sheet triggers + backdrop (see mobileLayout.ts)
  creditsBtn: HTMLButtonElement;
  sheetSetupBtn: HTMLButtonElement;
  sheetActionsBtn: HTMLButtonElement;
  sheetBackdropEl: HTMLElement;
  // Toolbar toggles
  bootSinceBtn: HTMLButtonElement;
  bootAllBtn: HTMLButtonElement;
  autoscrollBtn: HTMLButtonElement;
  staticScrollBtn: HTMLButtonElement;
  piiButton: HTMLButtonElement;
  teleplotHideDataBtn: HTMLButtonElement;
}

export const dom = {} as Dom;

export function initDom(): void {
  dom.summaryEl = document.getElementById('summaryContent')!;
  dom.dataPlotEl = document.getElementById('dataPlotContent')!;
  dom.diagnosisEl = document.getElementById('diagnosisContent')!;
  dom.interestEl = document.getElementById('interestContent')!;
  dom.teleplotEl = document.getElementById('teleplotContent')!;
  dom.infoPanelEl = document.getElementById('info_panel')!;
  dom.panelSummaryEl = document.getElementById('panel_summary')!;
  dom.panelDataEl = document.getElementById('panel_data')!;
  dom.panelDiagnosisEl = document.getElementById('panel_diagnosis')!;
  dom.panelInterestEl = document.getElementById('panel_interest')!;
  dom.panelTeleplotEl = document.getElementById('panel_teleplot')!;
  dom.workspaceEl = document.querySelector('.workspace')!;
  dom.dataDotEl = document.getElementById('data_dot')!;
  dom.diagnosisDotEl = document.getElementById('diagnosis_dot')!;
  dom.interestDotEl = document.getElementById('interest_dot')!;
  dom.teleplotDotEl = document.getElementById('teleplot_dot')!;
  dom.moduleBtnsEl = document.getElementById('module_buttons')!;
  dom.moduleOverflowEl = document.getElementById('module_overflow')!;
  dom.moduleOverflowToggleBtn = document.getElementById('module_overflow_toggle') as HTMLButtonElement;
  dom.logSearchInput = document.getElementById('log_search') as HTMLInputElement;
  dom.searchFilterBtn = document.getElementById('search_filter') as HTMLButtonElement;
  dom.highlightLinesBtn = document.getElementById('highlight_lines') as HTMLButtonElement;
  dom.searchCountEl = document.getElementById('search_count') as HTMLElement;
  dom.portChipsEl = document.getElementById('port_chips')!;
  dom.statusDot = document.getElementById('statusDot')!;
  dom.portSelector = document.getElementById('ports') as HTMLSelectElement;
  dom.connectButton = document.getElementById('connect') as HTMLButtonElement;
  dom.baudRateSelector = document.getElementById('baudrate') as HTMLSelectElement;
  dom.customBaudRateInput = document.getElementById('custom_baudrate') as HTMLInputElement;
  dom.dataBitsSelector = document.getElementById('databits') as HTMLSelectElement;
  dom.paritySelector = document.getElementById('parity') as HTMLSelectElement;
  dom.stopBitsSelector = document.getElementById('stopbits') as HTMLSelectElement;
  dom.flowControlCheckbox = document.getElementById('rtscts') as HTMLInputElement;
  dom.reconnectCheckbox = document.getElementById('reconnect') as HTMLInputElement;
  dom.grabNextCheckbox = document.getElementById('grab_next') as HTMLInputElement;
  dom.fileNameEl = document.getElementById('file_name')!;
  dom.fileProgressEl = document.getElementById('file_progress')!;
  dom.fileProgressFillEl = document.getElementById('file_progress_fill')!;
  dom.fileProgressPctEl = document.getElementById('file_progress_pct')!;
  dom.interactiveToggleBtn = document.getElementById('interactive_toggle') as HTMLButtonElement;
  dom.interactiveControlsEl = document.getElementById('interactive_controls')!;
  dom.interactiveStyleTypeBtn = document.getElementById('interactive_style_type') as HTMLButtonElement;
  dom.interactiveStyleEntryBtn = document.getElementById('interactive_style_entry') as HTMLButtonElement;
  dom.interactiveTypeHintEl = document.getElementById('interactive_type_hint')!;
  dom.interactiveEntryRowEl = document.getElementById('interactive_entry_row')!;
  dom.interactiveInputEl = document.getElementById('interactive_input') as HTMLInputElement;
  dom.interactiveNewlineCheckbox = document.getElementById('interactive_newline') as HTMLInputElement;
  dom.interactiveSendBtn = document.getElementById('interactive_send') as HTMLButtonElement;
  dom.creditsBtn = document.getElementById('credits_btn') as HTMLButtonElement;
  dom.sheetSetupBtn = document.getElementById('sheet_setup_btn') as HTMLButtonElement;
  dom.sheetActionsBtn = document.getElementById('sheet_actions_btn') as HTMLButtonElement;
  dom.sheetBackdropEl = document.getElementById('sheet_backdrop')!;
  dom.bootSinceBtn = document.getElementById('boot_since') as HTMLButtonElement;
  dom.bootAllBtn = document.getElementById('boot_all') as HTMLButtonElement;
  dom.autoscrollBtn = document.getElementById('autoscroll') as HTMLButtonElement;
  dom.staticScrollBtn = document.getElementById('static_scroll') as HTMLButtonElement;
  dom.piiButton = document.getElementById('pii_toggle') as HTMLButtonElement;
  dom.teleplotHideDataBtn = document.getElementById('teleplot_hide_data') as HTMLButtonElement;
}

// 'log' only means anything on mobile (see the mobile-tabbar markup and the
// `body.mobile-pane-log` CSS in index.html) — it has no matching pane inside
// #info_panel, it just means "show the terminal instead of the info panel".
export type InfoTab = 'log' | 'summary' | 'data' | 'diagnosis' | 'interest' | 'teleplot';

// Toggle which info-panel pane is visible and which tab button is active.
export function switchInfoTab(panel: InfoTab): void {
  dom.panelSummaryEl.hidden = panel !== 'summary';
  dom.panelDataEl.hidden = panel !== 'data';
  dom.panelDiagnosisEl.hidden = panel !== 'diagnosis';
  dom.panelInterestEl.hidden = panel !== 'interest';
  dom.panelTeleplotEl.hidden = panel !== 'teleplot';
  document.querySelectorAll<HTMLButtonElement>('.info-tab, .mobile-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['panel'] === panel);
  });
  document.body.classList.toggle('mobile-pane-log', panel === 'log');
}

// Mobile: below this width, or on a touch-primary device below a slightly
// wider width, .term-wrap and #info_panel stop sharing the screen side by
// side (there isn't room) and become full-screen tabs instead — see the
// media query in index.html, which must stay in sync with this query string.
// `(pointer: coarse)` keeps a narrow mouse-driven desktop window (e.g.
// snapped to half a monitor) from being treated the same as a phone.
const mobileLayoutQuery = window.matchMedia(
    '(max-width: 720px), (pointer: coarse) and (max-width: 900px)',
);
export function isMobileLayout(): boolean {
  return mobileLayoutQuery.matches;
}

// Fires on rotation, window resize across the breakpoint, and devtools device
// emulation — mobileLayout.ts uses it to relocate controls in/out of sheets.
export function onMobileLayoutChange(fn: (mobile: boolean) => void): void {
  mobileLayoutQuery.addEventListener('change', (e) => fn(e.matches));
}
