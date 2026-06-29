/**
 * Thin coordinator that refreshes the three data-driven info panes together.
 * Exists so the log-view core and the data sources can refresh the panels for a
 * session without importing statsView and diagnosisView individually (and to keep
 * the refresh ordering in one place). Each underlying refresher no-ops unless the
 * session is the active one.
 */
import {refreshSummary, refreshDataPlot} from './statsView';
import {refreshDiagnosis} from './diagnosisView';
import type {Session} from './logView';

export function refreshPanels(s: Session): void {
  refreshSummary(s);
  refreshDiagnosis(s);
  refreshDataPlot(s);
}
