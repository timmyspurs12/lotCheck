import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Clock3, FileText, FileWarning, Fingerprint } from 'lucide-react';
import type { EvidenceDocument } from '../api/types';
import { CopyValue, ExternalLink, StatusBadge, TimeValue } from './ui';
import { formatBytes, formatLabel } from '../lib/format';

function sourceHost(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function EvidenceDocumentCard({ document, compact = false }: { document: EvidenceDocument; compact?: boolean }) {
  const title = document.title || document.filename || document.id;
  const status = document.processingStatus?.toUpperCase();
  const processed = status === 'PROCESSED' || status === 'COMPLETE' || status === 'READY';
  const failed = status === 'FAILED' || status === 'ERROR';
  return (
    <article className={`evidence-document-card ${compact ? 'evidence-document-card-compact' : ''}`}>
      <div className="document-icon"><FileText size={18} strokeWidth={1.8} /></div>
      <div className="document-main">
        <div className="document-title-row">
          <Link to={`/evidence/${encodeURIComponent(document.id)}`} className="document-title">{title}<ArrowUpRight size={13} /></Link>
          <StatusBadge label={document.role === 'PROJECT' ? 'Project' : 'Independent'} tone={document.role === 'PROJECT' ? 'blue' : 'green'} size="sm" />
        </div>
        <div className="document-meta-line">
          {document.type && <span>{formatLabel(document.type)}</span>}
          {document.issuer && <span>Issuer: {document.issuer}</span>}
          {document.referenceNumber && <span>Ref. {document.referenceNumber}</span>}
          {document.date && <span>Document date <TimeValue value={document.date} /></span>}
          {document.sizeBytes != null && <span>{formatBytes(document.sizeBytes)}</span>}
          {document.sourceUrl && <ExternalLink href={document.sourceUrl}>Source · {sourceHost(document.sourceUrl)}</ExternalLink>}
        </div>
        <div className="document-provenance-row">
          <span><Clock3 size={12} />Uploaded <TimeValue value={document.uploadedAt} empty="time not returned" /></span>
          {document.uploadedBy && <span><Fingerprint size={12} />{document.uploadedBy}</span>}
          {document.sha256 && <span className="document-hash"><span><Fingerprint size={12} />SHA-256</span><CopyValue value={document.sha256} label="Copy SHA-256" /></span>}
        </div>
      </div>
      {!compact && (
        <div className="document-processing-state">
          {failed ? <StatusBadge label={formatLabel(status)} tone="red" size="sm" /> : processed ? <StatusBadge label={formatLabel(status)} tone="green" size="sm" /> : document.processingStatus ? <StatusBadge label={formatLabel(status)} tone="amber" size="sm" pulse /> : <span className="muted-value">Processing status not returned</span>}
        </div>
      )}
      {compact && (failed ? <FileWarning size={15} className="document-status-icon document-status-failed" /> : processed ? <CheckCircle2 size={15} className="document-status-icon document-status-ready" /> : null)}
    </article>
  );
}
