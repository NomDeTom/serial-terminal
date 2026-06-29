/**
 * Diagnosis info-panel: renders root-cause findings for the active session and
 * toggles the "alerts" dot. The analysis itself lives in diagnosis.ts; this is
 * just the panel binding.
 */
import {dom, active} from './appContext';
import {renderDiagnosis} from './diagnosis';
import type {Session} from './logView';

export function refreshDiagnosis(s: Session): void {
  if (!dom.diagnosisEl || s !== active) return;
  const html = renderDiagnosis(s.showAllBoots ? s.cumulative : s.summary);
  dom.diagnosisEl.innerHTML = html;
  const hasAlerts =
    html.includes('diag-diag') || html.includes('diag-crit') || html.includes('diag-warn');
  dom.diagnosisDotEl?.classList.toggle('visible', hasAlerts);
}
