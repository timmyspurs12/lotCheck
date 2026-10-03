import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, Check, CircleDashed, Clock3, FileCheck2, FileSearch, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import type { AuditEvent, EvidenceDocument, Review } from '../api/types';
import { ApiErrorState, Button, Card, CopyValue, DecisionBadge, DecisionDisclaimer, EmptyState, LoadingPanel, PageHeader, StatusBadge, TimeValue } from '../components/ui';
import { formatLabel, reviewStateLabel, reviewStateTone } from '../lib/format';

type TimelinePoint = {
  label: string;
  detail?: string;
  timestamp?: string | null;
  actor?: string | null;
  reference?: string | null;
  status: 'reported' | 'pending' | 'processing' | 'failed' | 'not-reported';
};

function SiteStatus({ status }: { status?: string | null }) {
  if (!status) return <StatusBadge label="Status not reported" tone="neutral" size="sm" />;
  const value = status.toUpperCase();
  const tone = ['ACTIVE', 'IN_PROGRESS', 'OPEN'].includes(value) ? 'green' : ['PENDING', 'UNDER_REVIEW'].includes(value) ? 'amber' : ['CLOSED', 'CLOSED_OUT', 'ARCHIVED'].includes(value) ? 'blue' : 'neutral';
  return <StatusBadge label={formatLabel(status)} tone={tone} size="sm" />;
}

function timestampValue(value?: string | null) {
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newestDocument(documents: EvidenceDocument[]) {
  return [...documents].sort((a, b) => timestampValue(b.uploadedAt) - timestampValue(a.uploadedAt))[0];
}

function findEvent(events: AuditEvent[], expression: RegExp) {
  return events.find((event) => expression.test(event.label));
}

function siteTimeline(review?: Review) {
  if (!review) return [];
  const events = review.events ?? [];
  const projectDocs = review.evidence?.filter((document) => document.role === 'PROJECT') ?? [];
  const independentDocs = review.evidence?.filter((document) => document.role === 'INDEPENDENT') ?? [];
  const projectDoc = newestDocument(projectDocs);
  const independentDoc = newestDocument(independentDocs);
  const claimEvent = findEvent(events, /(claim|milestone).*(submit|file)|submit.*(claim|milestone)/i);
  const projectEvent = findEvent(events, /(project|close.?out).*(upload|evidence|document)/i);
  const independentEvent = findEvent(events, /(independent|monitor|laboratory|lab).*(upload|evidence|document)/i);
  const normalizeEvent = findEvent(events, /(normaliz|compar)/i);
  const genlayerEvent = findEvent(events, /(genlayer|consensus|interpret|submit)/i);
  const recordEvent = findEvent(events, /(decision|finaliz|record)/i);
  const genlayerSubmitted = Boolean(review.submittedAt) || ['SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING', 'FINALIZED', 'RECORDED'].includes(review.state.toUpperCase());
  const isProcessing = ['UPLOADING', 'PROCESSING'].includes(review.state.toUpperCase());
  const recorded = Boolean(review.recordId) || (Boolean(review.decision) && ['FINALIZED', 'RECORDED'].includes(review.state.toUpperCase()));
  const countDetail = (count: number) => `${count} ${count === 1 ? 'document' : 'documents'} returned`;

  return [
    { label: 'Claim submitted', detail: claimEvent?.detail || (claimEvent ? claimEvent.status : undefined), timestamp: claimEvent?.timestamp, actor: claimEvent?.actor, reference: claimEvent?.reference, status: claimEvent ? 'reported' as const : 'not-reported' as const },
    { label: 'Close-out evidence uploaded', detail: projectDocs.length ? countDetail(projectDocs.length) : review.evidence ? 'No project-role document returned' : 'Evidence list not returned', timestamp: projectDoc?.uploadedAt || projectEvent?.timestamp, actor: projectDoc?.uploadedBy || projectEvent?.actor, reference: projectEvent?.reference || projectDoc?.id, status: projectDocs.length ? 'reported' as const : review.evidence ? 'pending' as const : 'not-reported' as const },
    { label: 'Independent evidence uploaded', detail: independentDocs.length ? countDetail(independentDocs.length) : review.evidence ? 'No independent-role document returned' : 'Evidence list not returned', timestamp: independentDoc?.uploadedAt || independentEvent?.timestamp, actor: independentDoc?.uploadedBy || independentEvent?.actor, reference: independentEvent?.reference || independentDoc?.id, status: independentDocs.length ? 'reported' as const : review.evidence ? 'pending' as const : 'not-reported' as const },
    { label: 'Evidence normalized', detail: review.comparison ? `${review.comparison.fields.length} comparison fields returned` : isProcessing ? reviewStateLabel(review) : 'No comparison data returned', timestamp: review.comparison?.comparedAt || normalizeEvent?.timestamp, actor: normalizeEvent?.actor, reference: normalizeEvent?.reference, status: review.comparison ? 'reported' as const : isProcessing ? 'processing' as const : 'not-reported' as const },
    { label: 'GenLayer review', detail: genlayerSubmitted ? review.consensusState ? formatLabel(review.consensusState) : reviewStateLabel(review) : 'Submission not reported', timestamp: review.submittedAt || genlayerEvent?.timestamp, actor: genlayerEvent?.actor, reference: review.transactionHash || genlayerEvent?.reference, status: genlayerSubmitted ? review.state === 'FAILED' ? 'failed' as const : 'reported' as const : 'pending' as const },
    { label: 'Decision recorded', detail: recorded ? review.decision ? `Documentary consistency: ${review.decision}` : `Record ${review.recordId}` : 'No record reference returned', timestamp: review.finalizedAt || recordEvent?.timestamp, actor: recordEvent?.actor, reference: review.recordId || recordEvent?.reference, status: recorded ? 'reported' as const : review.state === 'FAILED' ? 'failed' as const : 'pending' as const },
  ] satisfies TimelinePoint[];
}

function SiteReviewTimeline({ review, loading, error, retry }: { review?: Review; loading: boolean; error?: unknown; retry: () => void }) {
  if (loading) return <div className="table-skeleton site-timeline-loading" role="status" aria-label="Loading review timeline"><div /><div /><div /></div>;
  if (error) return <ApiErrorState error={error} retry={retry} compact />;
  if (!review) return <EmptyState icon={<Clock3 size={19} />} title="No review timeline returned" description="A site workflow timeline will appear when the API returns a review for this site." />;
  const points = siteTimeline(review);
  return (
    <ol className="site-evidence-timeline">
      {points.map((point, index) => (
        <li className={`site-timeline-step site-timeline-${point.status}`} key={point.label}>
          <span className="site-timeline-marker">{point.status === 'reported' ? <Check size={12} /> : point.status === 'failed' ? <ShieldAlert size={12} /> : point.status === 'processing' ? <CircleDashed size={12} /> : String(index + 1).padStart(2, '0')}</span>
          <div className="site-timeline-body">
            <div className="site-timeline-title-row"><strong>{point.label}</strong><StatusBadge label={point.status === 'reported' ? 'Reported' : point.status === 'processing' ? 'Processing' : point.status === 'failed' ? 'Failed' : point.status === 'pending' ? 'Pending' : 'Not reported'} tone={point.status === 'reported' ? 'green' : point.status === 'failed' ? 'red' : point.status === 'processing' ? 'amber' : 'neutral'} size="sm" /></div>
            <p>{point.detail || 'No detail returned by the API.'}</p>
            <div className="site-timeline-meta"><TimeValue value={point.timestamp} empty="Time not returned" />{point.actor && <span>By {point.actor}</span>}{point.reference && <code>{point.reference}</code>}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ReviewRow({ review }: { review: Review }) {
  return (
    <tr>
      <td><Link to={`/reviews/${encodeURIComponent(review.id)}`} className="table-primary-link"><strong>{review.reviewId}</strong><small>{review.recordId ? `Record ${review.recordId}` : 'Review reference'}</small></Link></td>
      <td>{review.milestone || <span className="muted-value">Not provided</span>}</td>
      <td><StatusBadge label={reviewStateLabel(review)} tone={reviewStateTone(review.state)} size="sm" pulse={['SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'].includes(review.state.toUpperCase())} /></td>
      <td><DecisionBadge decision={review.decision} size="sm" /></td>
      <td><TimeValue value={review.updatedAt || review.createdAt} empty="Not reported" /></td>
      <td><Link to={`/reviews/${encodeURIComponent(review.id)}`} className="row-open-button" aria-label={`Open review ${review.reviewId}`}><ArrowRight size={15} /></Link></td>
    </tr>
  );
}

export default function SiteDetailPage() {
  const { siteId = '' } = useParams();
  const siteQuery = useQuery({ queryKey: ['site', siteId], queryFn: () => api.getSite(siteId), enabled: Boolean(siteId) });
  const reviewsQuery = useQuery({ queryKey: ['reviews', 'site', siteId], queryFn: () => api.getReviews({ siteId }), enabled: Boolean(siteId) });
  const site = siteQuery.data;
  const siteReviews = reviewsQuery.data ?? [];
  const latestReview = useMemo(() => [...siteReviews].sort((a, b) => timestampValue(b.updatedAt || b.finalizedAt || b.createdAt) - timestampValue(a.updatedAt || a.finalizedAt || a.createdAt))[0], [siteReviews]);
  const latestDecisionReview = useMemo(() => siteReviews.filter((review) => Boolean(review.decision)).sort((a, b) => timestampValue(b.finalizedAt || b.updatedAt || b.createdAt) - timestampValue(a.finalizedAt || a.updatedAt || a.createdAt))[0], [siteReviews]);

  if (siteQuery.isLoading) return <div className="page-content"><LoadingPanel label="Loading site record…" /></div>;
  if (siteQuery.isError || !site) return <div className="page-content"><div className="back-link-row"><Link to="/sites"><ArrowLeft size={14} />All sites</Link></div><PageHeader eyebrow="WORKSPACE / SITES" title="Site detail" /><ApiErrorState error={siteQuery.error ?? new Error('Site not found in the API response.')} retry={() => void siteQuery.refetch()} /></div>;

  const projectCount = site.projectEvidenceCount;
  const independentCount = site.independentEvidenceCount;
  const totalEvidence = projectCount != null && independentCount != null ? projectCount + independentCount : null;

  return (
    <div className="page-content site-detail-page">
      <div className="back-link-row"><Link to="/sites"><ArrowLeft size={14} />All sites</Link><span>/</span><span>{site.siteId}</span></div>
      <PageHeader
        eyebrow={`SITE / ${site.siteId}`}
        title={site.name}
        description={site.location || 'Location not returned by the connected service.'}
        actions={<div className="site-detail-actions">{latestDecisionReview?.decision && <div className="site-decision-stack"><span>LATEST RECORDED OUTCOME</span><DecisionBadge decision={latestDecisionReview.decision} size="sm" /></div>}<Button icon={<FileSearch size={15} />} href={`/reviews/new?siteId=${encodeURIComponent(site.siteId)}`}>Start review</Button></div>}
      />

      <div className="site-detail-summary-grid">
        <Card className="site-identity-card"><div className="site-identity-icon"><Building2 size={19} /></div><div className="eyebrow">SITE ID</div><div className="site-id-display"><CopyValue value={site.siteId} label="Copy site ID" /><span className="site-id-label">Site reference</span></div><div className="site-identity-meta"><span><MapPin size={13} />{site.location || 'Location not provided'}</span><SiteStatus status={site.currentStatus} /></div></Card>
        <Card className="site-summary-stat"><div className="eyebrow">MILESTONE</div><div className="site-milestone-value">{latestReview?.milestone || site.milestone || 'Not returned'}</div><div className="site-summary-caption">As returned by the site/review API</div><div className="site-summary-subline"><FileCheck2 size={13} />{latestReview ? <Link to={`/reviews/${encodeURIComponent(latestReview.id)}`}>Review {latestReview.reviewId}</Link> : 'No review reference returned'}</div></Card>
        <Card className="site-summary-stat"><div className="eyebrow">EVIDENCE SETS</div><div className="site-summary-number">{totalEvidence == null ? '—' : `${projectCount}+${independentCount}`}</div><div className="site-summary-caption">{totalEvidence == null ? 'Both role counts not returned' : `${totalEvidence} documents counted by API`}</div><div className="site-summary-subline"><span className="pair-dot pair-project" />Project <b>{projectCount == null ? '—' : projectCount}</b><span className="pair-dot pair-independent" />Independent <b>{independentCount == null ? '—' : independentCount}</b></div></Card>
        <Card className="site-summary-stat site-summary-reviews"><div className="eyebrow">LATEST DECISION</div>{reviewsQuery.isError ? <><div className="site-latest-decision"><span className="muted-value">Unavailable</span></div><div className="site-summary-caption">Review response could not be loaded</div></> : reviewsQuery.isLoading ? <><div className="site-latest-decision"><span className="muted-value">Loading…</span></div><div className="site-summary-caption">Checking review records</div></> : latestDecisionReview?.decision ? <><div className="site-latest-decision"><DecisionBadge decision={latestDecisionReview.decision} /></div><div className="site-summary-caption">Documentary consistency · not site clearance</div></> : <><div className="site-latest-decision"><DecisionBadge /></div><div className="site-summary-caption">No decision returned in this site’s review register</div></>}<div className="site-summary-subline"><Clock3 size={13} /><TimeValue value={latestDecisionReview?.finalizedAt} empty={reviewsQuery.isLoading ? 'Loading decision time…' : 'Decision time not returned'} /></div></Card>
      </div>

      <Card className="site-metadata-card"><div className="card-section-head"><div><div className="eyebrow">REVIEW METADATA</div><h2>Site and decision references</h2><p>Values are taken from the site and latest review responses; missing fields remain unreported.</p></div></div><div className="site-metadata-grid">
        <div><span>Site ID</span><CopyValue value={site.siteId} label="Copy site ID" /></div>
        <div><span>Milestone</span><strong>{latestReview?.milestone || site.milestone || 'Not returned'}</strong></div>
        <div><span>Review ID</span>{latestReview ? <Link to={`/reviews/${encodeURIComponent(latestReview.id)}`} className="reference-link">{latestReview.reviewId}<ArrowRight size={12} /></Link> : <span className="muted-value">Not returned</span>}</div>
        <div><span>Decision recorded</span><TimeValue value={latestDecisionReview?.finalizedAt} empty={reviewsQuery.isLoading ? 'Loading…' : 'Not returned'} /></div>
        <div><span>GenLayer network</span><strong>{latestReview?.network || 'Not returned'}</strong></div>
        <div><span>Current site status</span><SiteStatus status={site.currentStatus} /></div>
      </div></Card>

      <Card className="site-timeline-card"><div className="card-section-head"><div><div className="eyebrow">EVIDENCE TIMELINE</div><h2>{latestReview ? `Latest review · ${latestReview.reviewId}` : 'Review workflow events'}</h2><p>Timeline steps are marked only when supported by API events or returned review fields.</p></div>{latestReview && <Link className="subtle-link" to={`/reviews/${encodeURIComponent(latestReview.id)}`}>Open review <ArrowRight size={13} /></Link>}</div><SiteReviewTimeline review={latestReview} loading={reviewsQuery.isLoading} error={reviewsQuery.error} retry={() => void reviewsQuery.refetch()} /></Card>

      <Card className="list-card site-review-history" padding="none">
        <div className="card-section-head"><div className="section-heading"><div><h2>Review history</h2><p>Reviews associated with this site reference.</p></div><Link className="subtle-link" to={`/reviews?siteId=${encodeURIComponent(site.siteId)}`}>All reviews <ArrowRight size={14} /></Link></div></div>
        {reviewsQuery.isError ? <ApiErrorState error={reviewsQuery.error} retry={() => void reviewsQuery.refetch()} /> : reviewsQuery.isLoading ? <div className="table-skeleton" role="status" aria-label="Loading site reviews"><div /><div /><div /><div /></div> : siteReviews.length ? (
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Review</th><th>Milestone</th><th>Workflow state</th><th>Decision</th><th>Updated</th><th aria-label="Open review" /></tr></thead><tbody>{siteReviews.map((review) => <ReviewRow review={review} key={review.id} />)}</tbody></table></div>
        ) : <EmptyState icon={<FileSearch size={20} />} title="No reviews returned" description="The API has not returned review records for this site." action={<Button size="sm" icon={<FileSearch size={14} />} href={`/reviews/new?siteId=${encodeURIComponent(site.siteId)}`}>Start site review</Button>} />}
      </Card>
      <div className="site-detail-footer-note"><span>Evidence counts</span>{projectCount == null || independentCount == null ? 'The service did not return both role-specific counts.' : `The API reports ${projectCount} project and ${independentCount} independent document${totalEvidence === 1 ? '' : 's'} for this site.`}</div>
      <DecisionDisclaimer compact />
    </div>
  );
}
