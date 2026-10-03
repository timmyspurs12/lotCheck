import { ArrowUpRight, GitCompareArrows, Minus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EvidenceComparison, ComparisonField } from '../api/types';
import { formatDateTime } from '../lib/format';
import { StatusBadge } from './ui';

function matchPresentation(match?: ComparisonField['match']) {
  if (match === 'MATCH') return { label: 'Match', tone: 'green' as const };
  if (match === 'CONFLICT') return { label: 'Conflict', tone: 'red' as const };
  if (match === 'NOT_COMPARABLE') return { label: 'Not comparable', tone: 'amber' as const };
  if (match === 'NOT_EXTRACTED') return { label: 'Not extracted', tone: 'neutral' as const };
  return { label: 'Not assessed', tone: 'neutral' as const };
}

function valueOrEmpty(value?: string | null) {
  return value?.trim() ? value : null;
}

function FieldAssessment({ field, project, independent, label, tone }: {
  field: ComparisonField;
  project: string | null;
  independent: string | null;
  label: string;
  tone: 'green' | 'red' | 'amber' | 'neutral';
}) {
  const hasDetails = field.match === 'CONFLICT' || Boolean(field.whyItMatters);
  return (
    <div className="field-assessment">
      <StatusBadge label={label} tone={tone} size="sm" />
      {hasDetails && (
        <details className={`comparison-disclosure ${field.match === 'CONFLICT' ? 'comparison-disclosure-conflict' : ''}`}>
          <summary>{field.match === 'CONFLICT' ? 'Why this matters' : 'Review context'}</summary>
          <div className="comparison-disclosure-content">
            {field.whyItMatters ? <p>{field.whyItMatters}</p> : <p>No conflict explanation was returned. The reported values are shown below.</p>}
            {field.match === 'CONFLICT' && (
              <div className="conflict-values">
                <div><span>Project evidence</span><strong>{project || 'Value not returned'}</strong></div>
                <div><span>Independent evidence</span><strong>{independent || 'Value not returned'}</strong></div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function EvidenceComparison({ comparison }: { comparison: EvidenceComparison | null | undefined }) {
  if (!comparison) {
    return (
      <div className="comparison-empty">
        <span className="comparison-empty-icon"><GitCompareArrows size={17} /></span>
        <div><strong>No comparison returned</strong><p>A field-by-field comparison is not available for this review yet.</p></div>
      </div>
    );
  }
  if (!comparison.fields.length) {
    return (
      <div className="comparison-empty">
        <span className="comparison-empty-icon"><GitCompareArrows size={17} /></span>
        <div><strong>No comparable fields returned</strong><p>The API returned a comparison without field-level results. LotCheck will not infer matches from the source documents.</p></div>
      </div>
    );
  }
  return (
    <div className="comparison-block">
      <div className="comparison-columns-labels">
        <span>PROJECT DOCUMENT{comparison.projectDocumentId && <Link className="comparison-source-link" to={`/evidence/${encodeURIComponent(comparison.projectDocumentId)}`}>{comparison.projectDocumentId}<ArrowUpRight size={11} /></Link>}</span>
        <span>INDEPENDENT DOCUMENT{comparison.independentDocumentId && <Link className="comparison-source-link" to={`/evidence/${encodeURIComponent(comparison.independentDocumentId)}`}>{comparison.independentDocumentId}<ArrowUpRight size={11} /></Link>}</span>
      </div>
      <div className="comparison-table-wrap">
        <table className="comparison-table">
          <thead><tr><th>Field</th><th>Project-submitted value</th><th>Independently-submitted value</th><th>Comparison</th></tr></thead>
          <tbody>
            {comparison.fields.map((field, index) => {
              const result = matchPresentation(field.match);
              const project = valueOrEmpty(field.projectValue);
              const independent = valueOrEmpty(field.independentValue);
              const missingValue = field.match === 'NOT_EXTRACTED' ? 'Not extracted' : 'Value not returned';
              return (
                <tr key={`${field.key}-${index}`}>
                  <th scope="row"><span>{field.label}</span>{field.key !== field.label && <small>{field.key}</small>}</th>
                  <td>{project ? <span className="comparison-value">{project}</span> : <span className="comparison-missing"><Minus size={13} />{missingValue}</span>}</td>
                  <td>{independent ? <span className="comparison-value">{independent}</span> : <span className="comparison-missing"><Minus size={13} />{missingValue}</span>}</td>
                  <td><FieldAssessment field={field} project={project} independent={independent} label={result.label} tone={result.tone} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="comparison-footline">
        <span>{comparison.policyVersion ? <>Policy <strong>{comparison.policyVersion}</strong></> : 'Policy version not returned'}</span>
        <span>{comparison.comparedAt ? <>Compared <strong>{formatDateTime(comparison.comparedAt)}</strong></> : 'Comparison time not returned'}</span>
      </div>
      <p className="comparison-limit"><X size={12} />A document match is not confirmation that a sample, site condition, or cleanup outcome is independently verified.</p>
    </div>
  );
}
