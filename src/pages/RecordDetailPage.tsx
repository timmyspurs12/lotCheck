import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, FileCheck2, Fingerprint, GitCompareArrows, Link2 } from 'lucide-react';
import { api } from '../api/client';
import type { EvidenceDocument, VerificationRecord } from '../api/types';
import { EvidenceComparison } from '../components/EvidenceComparison';
import { EvidenceDocumentCard } from '../components/EvidenceDocumentCard';
import { ApiErrorState, Card, CopyAction, CopyValue, DecisionBadge, DecisionDisclaimer, EmptyState, ExternalLink, LoadingPanel, PageHeader, TimeValue } from '../components/ui';
import { formatDateTime } from '../lib/format';

function FingerprintPanel({ title, documents }: { title: string; documents: EvidenceDocument[] }) {
  return (
    <section className="record-fingerprint-panel">
      <div className="record-fingerprint-head"><span className="fingerprint-mark"><Fingerprint size={15} /></span><div><div className="eyebrow">{title}</div><h3>{documents.length ? `${documents.length} ${documents.length === 1 ? 'document' : 'documents'}` : 'No document returned'}</h3></div></div>
      {documents.length ? <div className="record-fingerprint-list">{documents.map((document) => <div className="record-fingerprint-row" key={document.id}><span><strong>{document.title || document.filename || document.id}</strong><small>{document.id}</small></span><div><span>SHA-256</span><CopyValue value={document.sha256} label="Copy SHA-256" /></div></div>)}</div> : <p className="record-fingerprint-empty">This evidence role is not present in the record response.</p>}
    </section>
  );
}

function DecisionSummary({ record }: { record: VerificationRecord }) {
  return (
    <Card className={`record-decision-card record-decision-${record.decision.toLowerCase()}`}>
      <div className="record-summary-icon"><FileCheck2 size={17} /></div><div className="eyebrow">BACKEND-RECORDED OUTCOME</div><DecisionBadge decision={record.decision} />
      <h2>Documentary consistency: {record.decision}</h2><p className="decision-standard-summary">This outcome is limited to documentary consistency. The stated basis below is shown as returned by the backend.</p>
      <div className="decision-explanation-block"><strong>Decision explanation · backend</strong><p>{record.explanation || 'No decision explanation was returned with this record.'}</p></div>
      <div className="record-scope-callout"><strong>What this decision does not mean</strong><ul><li>Not a safety certification</li><li>Not a physical inspection</li><li>Not proof of sampling integrity</li><li>Not regulatory certification</li></ul></div>
    </Card>
  );
}

function VerifyActions({ record }: { record: VerificationRecord }) {
  return (
    <div className="record-verify-actions">
      <div><div className="eyebrow">VERIFY INDEPENDENTLY</div><p>Use backend-returned references. No explorer URL is constructed locally.</p></div>
      <div className="record-verify-buttons">
        {record.transactionUrl ? <ExternalLink href={record.transactionUrl}>View transaction</ExternalLink> : <button type="button" className="button button-secondary button-sm" disabled title="The backend did not return a transaction explorer URL">View transaction</button>}
        <CopyAction value={record.transactionHash} label="Copy transaction" />
        <CopyAction value={record.recordId} label="Copy record ID" />
      </div>
    </div>
  );
}

export default function RecordDetailPage() {
  const { recordId = '' } = useParams();
  const recordQuery = useQuery({ queryKey: ['record', recordId], queryFn: () => api.getRecord(recordId), enabled: Boolean(recordId) });
  const record = recordQuery.data;

  if (recordQuery.isLoading) return <div className="page-content"><LoadingPanel label="Loading verification record…" /></div>;
  if (recordQuery.isError || !record) return <div className="page-content"><div className="back-link-row"><Link to="/records"><ArrowLeft size={14} />All records</Link></div><PageHeader eyebrow="WORKSPACE / RECORDS" title="Verification record" /><ApiErrorState error={recordQuery.error ?? new Error('Record not found in the API response.')} retry={() => void recordQuery.refetch()} /></div>;

  const documents = record.evidence ?? [];
  const projectDocuments = documents.filter((document) => document.role === 'PROJECT');
  const independentDocuments = documents.filter((document) => document.role === 'INDEPENDENT');

  return (
    <div className="page-content record-detail-page">
      <div className="back-link-row"><Link to="/records"><ArrowLeft size={14} />All records</Link><span>/</span><span>{record.recordId}</span></div>
      <PageHeader eyebrow="VERIFICATION RECORD" title="Verification record" description={`${record.recordId} · ${record.siteName || record.siteId || 'Site reference not returned'} · ${formatDateTime(record.finalizedAt) || 'Finalization time not returned'}`} actions={<DecisionBadge decision={record.decision} />} />

      <div className="record-summary-grid">
        <DecisionSummary record={record} />
        <Card className="record-reference-card"><div className="eyebrow">VERIFICATION RECORD REFERENCES</div><div className="record-reference-list">
          <div><span>Record ID</span><CopyValue value={record.recordId} label="Copy record ID" /></div>
          <div><span>Review ID</span>{record.reviewId ? <Link to={`/reviews/${encodeURIComponent(record.reviewId)}`} className="reference-link">{record.reviewId}<ArrowRight size={13} /></Link> : <span className="muted-value">Not returned</span>}</div>
          <div><span>Site</span>{record.siteId ? <Link to={`/sites/${encodeURIComponent(record.siteId)}`} className="reference-link">{record.siteId}<ArrowUpRight size={12} /></Link> : <span className="muted-value">Not returned</span>}</div>
          <div><span>Milestone</span><strong>{record.milestone || 'Not returned'}</strong></div>
          <div><span>Network</span><strong>{record.network || 'Not returned'}</strong></div>
          <div><span>Contract address</span><CopyValue value={record.contractAddress} label="Copy contract address" /></div>
          <div><span>Transaction</span><CopyValue value={record.transactionHash} label="Copy transaction hash" /></div>
          <div><span>Policy version</span><CopyValue value={record.policyVersion} label="Copy policy version" /></div>
          <div><span>Finalized</span><TimeValue value={record.finalizedAt} empty="Not returned" /></div>
        </div></Card>
      </div>

      <Card className="record-fingerprints-card"><div className="card-section-head"><div><div className="eyebrow">DOCUMENT FINGERPRINTS</div><h2>Evidence package references</h2><p>Hashes are copied from the record response; LotCheck does not calculate or substitute them here.</p></div></div><div className="record-fingerprint-grid"><FingerprintPanel title="PROJECT DOCUMENT" documents={projectDocuments} /><FingerprintPanel title="INDEPENDENT DOCUMENT" documents={independentDocuments} /></div><div className="record-policy-line"><span>Review policy version</span>{record.policyVersion ? <CopyValue value={record.policyVersion} label="Copy policy version" /> : <span className="muted-value">Not returned</span>}</div></Card>

      <Card className="record-source-card"><div className="card-section-head"><div><div className="eyebrow">SOURCE DOCUMENTS</div><h2>Evidence preserved with this record</h2><p>Files, provenance, and identifiers are shown only when returned by the connected service.</p></div><span className="evidence-total-pill">{record.evidence ? `${record.evidence.length} ${record.evidence.length === 1 ? 'document' : 'documents'}` : 'Count not returned'}</span></div>
        {documents.length ? <div className="evidence-document-list">{documents.map((document) => <EvidenceDocumentCard key={document.id} document={document} />)}</div> : <EmptyState icon={<FileCheck2 size={20} />} title="No evidence documents returned" description="The record response does not include linked source documents." />}
      </Card>

      <Card className="record-comparison-card"><div className="card-section-head"><div><div className="eyebrow">DECISION BASIS</div><h2>Field-level comparison</h2><p>Preserved comparison values and status, if provided in the record.</p></div><span className="record-card-icon"><GitCompareArrows size={16} /></span></div><EvidenceComparison comparison={record.comparison} /></Card>

      <Card className="record-audit-card"><div className="card-section-head"><div><div className="eyebrow">RECORD EVENTS</div><h2>Audit references</h2><p>Only events included in the backend record are displayed.</p></div></div>
        {record.events?.length ? <div className="record-event-list">{record.events.map((event) => <div className="record-event-row" key={event.id}><span className="record-event-mark"><Link2 size={13} /></span><div><strong>{event.label}</strong><p>{event.detail || 'No event detail returned.'}</p><div className="record-event-meta"><TimeValue value={event.timestamp} empty="Timestamp not returned" />{event.actor && <span>{event.actor}</span>}{event.reference && <code>{event.reference}</code>}</div></div><span className="record-event-state">{event.status}</span></div>)}</div> : <div className="audit-empty"><Fingerprint size={15} /><span>No audit events were included in this record response.</span></div>}
      </Card>
      <VerifyActions record={record} />
      <DecisionDisclaimer compact />
    </div>
  );
}
