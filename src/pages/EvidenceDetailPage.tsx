import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, FileText, Fingerprint, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { ApiErrorState, Card, CopyValue, DecisionDisclaimer, EmptyState, ExternalLink, isSafeResourceUrl, LoadingPanel, PageHeader, StatusBadge, TimeValue } from '../components/ui';
import { formatBytes, formatLabel } from '../lib/format';

function sourceUrlLabel(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function EvidenceDetailPage() {
  const { evidenceId = '' } = useParams();
  const query = useQuery({ queryKey: ['document', evidenceId], queryFn: () => api.getDocument(evidenceId), enabled: Boolean(evidenceId) });
  const document = query.data;
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => setPreviewError(false), [document?.id]);
  if (query.isLoading) return <div className="page-content"><LoadingPanel label="Loading evidence provenance…" /></div>;
  if (query.isError || !document) return <div className="page-content"><div className="back-link-row"><Link to="/reviews"><ArrowLeft size={14} />Reviews</Link></div><PageHeader eyebrow="SOURCE DOCUMENT" title="Evidence detail" /><ApiErrorState error={query.error ?? new Error('Evidence document not found in the API response.')} retry={() => void query.refetch()} /></div>;

  const title = document.title || document.filename || document.id;
  const processing = document.processingStatus?.toUpperCase();
  const failed = processing === 'FAILED' || processing === 'ERROR';
  const processed = ['PROCESSED', 'COMPLETE', 'READY'].includes(processing || '');
  const previewUrl = document.contentUrl && isSafeResourceUrl(document.contentUrl) ? document.contentUrl : null;
  const filename = (document.filename || '').toLowerCase();
  const isPdf = document.type?.toLowerCase().includes('pdf') || filename.endsWith('.pdf');
  const isImage = document.type?.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/.test(filename);

  return (
    <div className="page-content evidence-detail-page">
      <div className="back-link-row">{document.reviewId ? <Link to={`/reviews/${encodeURIComponent(document.reviewId)}`}><ArrowLeft size={14} />Review {document.reviewId}</Link> : <Link to="/reviews"><ArrowLeft size={14} />All reviews</Link>}<span>/</span><span>Evidence</span></div>
      <PageHeader eyebrow="EVIDENCE / DOCUMENT PROVENANCE" title={title} description={document.filename || document.id} actions={<StatusBadge label={document.role === 'PROJECT' ? 'Project evidence' : 'Independent evidence'} tone={document.role === 'PROJECT' ? 'blue' : 'green'} />} />

      <div className="evidence-detail-layout">
        <div className="evidence-detail-main">
          <Card className="document-overview-card"><div className="document-overview-icon"><FileText size={20} /></div><div className="document-overview-copy"><div className="eyebrow">DOCUMENT STATUS</div><h2>{failed ? 'Processing reported an error' : processed ? 'Document processed' : document.processingStatus ? formatLabel(document.processingStatus) : 'Processing status not returned'}</h2><p>{failed ? 'The backend reported a processing failure for this evidence item. Refer to the source and related review details.' : 'File extraction state is displayed only as supplied by the connected API.'}</p></div>{failed ? <ShieldAlert size={18} className="document-overview-alert" /> : processed ? <CheckCircle2 size={18} className="document-overview-check" /> : <Clock3 size={18} className="document-overview-wait" />}</Card>

          <Card className="document-preview-card" padding="none">
            <div className="document-preview-toolbar"><div><div className="eyebrow">DOCUMENT VIEWER</div><strong>{document.filename || document.title || document.id}</strong></div>{document.contentUrl && <ExternalLink href={document.contentUrl}>Open stored file</ExternalLink>}</div>
            <div className="document-preview-viewport">
              {previewUrl && !previewError && isImage ? <img src={previewUrl} alt={`Stored document preview: ${title}`} referrerPolicy="no-referrer" onError={() => setPreviewError(true)} />
                : previewUrl && !previewError && isPdf ? <iframe src={previewUrl} title={`PDF preview: ${title}`} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" onError={() => setPreviewError(true)} />
                  : <div className="document-preview-placeholder"><span className="document-preview-placeholder-icon"><FileText size={24} /></span><strong>{previewError ? 'Preview could not be loaded' : previewUrl ? 'Inline preview unavailable for this file type' : 'File preview not available'}</strong><p>{previewError ? 'The stored file could not be loaded in this viewer. Use the source link if one was returned.' : previewUrl ? 'The API returned a file reference that cannot be previewed inline here.' : 'A safe content URL was not returned by the API. No sample or substitute document is shown.'}</p></div>}
            </div>
            <div className="document-preview-footnote">Preview content, when available, is the stored source file. It is not a new verification or environmental finding.</div>
          </Card>

          <Card className="extracted-fields-card"><div className="card-section-head"><div><div className="eyebrow">EXTRACTED CONTENT</div><h2>Document fields</h2><p>Text extraction as returned by the API; no additional interpretation is made on this screen.</p></div><span className="record-card-icon"><Fingerprint size={16} /></span></div>
            {document.fields?.length ? <div className="extracted-field-list">{document.fields.map((field, index) => <div className="extracted-field-row" key={`${field.key}-${index}`}><div><strong>{field.label}</strong><small>{field.key}</small></div><div className="extracted-field-value">{field.value?.trim() ? field.value : <span className="muted-value">Value not extracted</span>}{field.extractionStatus && <StatusBadge label={formatLabel(field.extractionStatus)} tone={field.extractionStatus.toUpperCase().includes('FAIL') ? 'red' : 'neutral'} size="sm" />}</div></div>)}</div> : <EmptyState icon={<FileText size={20} />} title="No extracted fields returned" description="Extracted values are not available in this document response. LotCheck will not infer them from the file name or metadata." />}
          </Card>

          <Card className="provenance-card"><div className="card-section-head"><div><div className="eyebrow">SOURCE & PROVENANCE</div><h2>Document origin</h2><p>Identifiers and source links provided by the backend.</p></div></div>
            <div className="provenance-list">
              <div><span>Issuer</span><span>{document.issuer || <i>Not provided</i>}</span></div>
              <div><span>Document date</span><TimeValue value={document.date} empty="Not provided" /></div>
              <div><span>Reference number</span><CopyValue value={document.referenceNumber} label="Copy reference number" /></div>
              <div><span>File name</span><span>{document.filename || 'Not returned'}</span></div>
              <div><span>Document type</span><span>{document.type || 'Not returned'}</span></div>
              <div><span>Size</span><span>{formatBytes(document.sizeBytes)}</span></div>
              <div><span>Uploaded at</span><TimeValue value={document.uploadedAt} empty="Not returned" /></div>
              <div><span>Uploaded by</span><span>{document.uploadedBy || 'Not returned'}</span></div>
              <div><span>Source record</span><span>{document.source || 'Not returned'}</span></div>
              <div><span>SHA-256</span><CopyValue value={document.sha256} label="Copy SHA-256" /></div>
            </div>
          </Card>
        </div>

        <aside className="evidence-detail-aside">
          <Card className="document-identity-card"><div className="document-identity-top"><span className="document-identity-icon"><FileText size={18} /></span><span className="eyebrow">EVIDENCE ID</span></div><CopyValue value={document.id} label="Copy evidence ID" /><div className="document-identity-role"><span className={`role-indicator ${document.role === 'PROJECT' ? 'role-indicator-project' : ''}`} />{document.role === 'PROJECT' ? 'Project-submitted document' : 'Independent-submitted document'}</div>
            <div className="document-identity-meta"><div><span>Site</span>{document.siteId ? <Link to={`/sites/${encodeURIComponent(document.siteId)}`}>{document.siteId}<ArrowUpRight size={12} /></Link> : <i>Not linked</i>}</div><div><span>Review</span>{document.reviewId ? <Link to={`/reviews/${encodeURIComponent(document.reviewId)}`}>{document.reviewId}<ArrowUpRight size={12} /></Link> : <i>Not linked</i>}</div></div>
          </Card>
          {(document.contentUrl || document.sourceUrl) && <Card className="document-links-card"><div className="eyebrow">AVAILABLE LINKS</div><div className="document-link-list">{document.contentUrl && <ExternalLink href={document.contentUrl}>Open stored file</ExternalLink>}{document.sourceUrl && <ExternalLink href={document.sourceUrl}>Source · {sourceUrlLabel(document.sourceUrl)}</ExternalLink>}</div><p>Links are supplied by the API and may require backend authorization.</p></Card>}
          <div className="aside-scope-note"><MapPin size={15} /><p>Document provenance does not establish that a sample was collected correctly or that a site is safe.</p></div>
        </aside>
      </div>
      <DecisionDisclaimer compact />
    </div>
  );
}
