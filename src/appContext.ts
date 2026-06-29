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

// ── Shared DOM refs (populated once by initDom at bootstrap) ──────────────────
export interface Dom {
  // Info panel content + panes
  summaryEl: HTMLElement;
  dataPlotEl: HTMLElement;
  diagnosisEl: HTMLElement;
  interestEl: HTMLElement;
  infoPanelEl: HTMLElement;
  panelSummaryEl: HTMLElement;
  panelDataEl: HTMLElement;
  panelDiagnosisEl: HTMLElement;
  panelInterestEl: HTMLElement;
  workspaceEl: HTMLElement;
  dataDotEl: HTMLElement;
  diagnosisDotEl: HTMLElement;
  interestDotEl: HTMLElement;
  // Filters / search chrome
  moduleBtnsEl: HTMLElement;
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
  // Toolbar toggles
  bootSinceBtn: HTMLButtonElement;
  bootAllBtn: HTMLButtonElement;
  autoscrollBtn: HTMLButtonElement;
  piiButton: HTMLButtonElement;
}

export const dom = {} as Dom;

export function initDom(): void {
  dom.summaryEl = document.getElementById('summaryContent')!;
  dom.dataPlotEl = document.getElementById('dataPlotContent')!;
  dom.diagnosisEl = document.getElementById('diagnosisContent')!;
  dom.interestEl = document.getElementById('interestContent')!;
  dom.infoPanelEl = document.getElementById('info_panel')!;
  dom.panelSummaryEl = document.getElementById('panel_summary')!;
  dom.panelDataEl = document.getElementById('panel_data')!;
  dom.panelDiagnosisEl = document.getElementById('panel_diagnosis')!;
  dom.panelInterestEl = document.getElementById('panel_interest')!;
  dom.workspaceEl = document.querySelector('.workspace')!;
  dom.dataDotEl = document.getElementById('data_dot')!;
  dom.diagnosisDotEl = document.getElementById('diagnosis_dot')!;
  dom.interestDotEl = document.getElementById('interest_dot')!;
  dom.moduleBtnsEl = document.getElementById('module_buttons')!;
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
  dom.bootSinceBtn = document.getElementById('boot_since') as HTMLButtonElement;
  dom.bootAllBtn = document.getElementById('boot_all') as HTMLButtonElement;
  dom.autoscrollBtn = document.getElementById('autoscroll') as HTMLButtonElement;
  dom.piiButton = document.getElementById('pii_toggle') as HTMLButtonElement;
}

export type InfoTab = 'summary' | 'data' | 'diagnosis' | 'interest';

// Toggle which info-panel pane is visible and which tab button is active.
export function switchInfoTab(panel: InfoTab): void {
  dom.panelSummaryEl.hidden = panel !== 'summary';
  dom.panelDataEl.hidden = panel !== 'data';
  dom.panelDiagnosisEl.hidden = panel !== 'diagnosis';
  dom.panelInterestEl.hidden = panel !== 'interest';
  document.querySelectorAll<HTMLButtonElement>('.info-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset['panel'] === panel);
  });
}
