import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleDashed, Clock3, FileCheck2, GitCompareArrows, Info, ShieldAlert, UploadCloud } from 'lucide-react';
import { api } from '../api/client';
import type { AuditEvent, Review } from '../api/types';
import { EvidenceComparison } from '../components/EvidenceComparison';
import { EvidenceDocumentCard } from '../components/EvidenceDocumentCard';
import { EvidencePairPanels } from '../components/EvidencePairPanels';
import { EvidenceUploader } from '../components/EvidenceUploader';
import { ReviewStepper } from '../components/ReviewStepper';
import { TransactionLifecycle } from '../components/TransactionLifecycle';
import { ApiErrorState, Button, Card, CopyValue, DecisionBadge, DecisionDisclaimer, EmptyState, LoadingPanel, PageHeader, StatusBadge, TimeValue } from '../components/ui';
import { formatLabel, reviewStateLabel, reviewStateTone } from '../lib/format';

function liveStatus(state: string) {
  return ['PROCESSING', 'SUBMITTING', 'SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'].includes(state.toUpperCase());
}

function TimelineEvent({ event, last }: { event: AuditEvent; last: boolean }) {
  const status = event.status.toUpperCase();
  const failed = ['FAILED', 'ERROR', 'REJECTED'].includes(status);
  const complete = ['COMPLETE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'RECORDED', 'FINALIZED'].includes(status);
  return (
    <li className={`timeline-event ${last ? 'timeline-event-last' : ''}`}>
      <span className={`timeline-marker ${failed ? 'timeline-marker-failed' : complete ? 'timeline-marker-complete' : ''}`}>{failed ? <ShieldAlert size={12} /> : complete ? <Check size={12} /> : <span />}</span>
      <div className="timeline-event-content">
        <div className="timeline-event-title-row"><strong>{event.label}</strong><StatusBadge label={formatLabel(event.status)} tone={failed ? 'red' : complete ? 'green' : 'neutral'} size="sm" /></div>
        {event.detail && <p>{event.detail}</p>}
        <div className="timeline-event-meta"><TimeValue value={event.timestamp} empty="Time not returned" />{event.actor && <span>By {event.actor}</span>}{event.reference && <code>{event.reference}</code>}</div>
      </div>
    </li>
  );
}

function DecisionPanel({ review }: { review: Review }) {
  if (review.decision) {
    return (
      <div className={`decision-panel decision-panel-${review.decision.toLowerCase()}`}>
        <div className="decision-panel-top"><span className="decision-panel-icon"><FileCheck2 size={17} /></span><span>BACKEND-RECORDED OUTCOME</span></div>
        <DecisionBadge decision={review.decision} />
        <h3>Documentary consistency: {review.decision}</h3>
        <p className="decision-standard-summary">This outcome is limited to documentary consistency. The stated basis below is shown as returned by the backend.</p>
        <div className="decision-explanation-block"><strong>Decision explanation · backend</strong><p>{review.decisionExplanation || 'No decision explanation was returned by the API.'}</p></div>
        <div className="decision-panel-note"><strong>What this decision does not mean</strong><ul><li>Not a safety certification</li><li>Not a physical inspection</li><li>Not proof of sampling integrity</li><li>Not regulatory certification</li></ul></div>
        <div className="decision-finalized-row"><span>Finalized</span><TimeValue value={review.finalizedAt} empty="Timestamp not returned" /></div>
        {review.recordId && <Link className="record-open-link" to={`/record/${encodeURIComponent(review.recordId)}`}>Open verification record <ArrowRight size={14} /></Link>}
      </div>
    );
  }

  const pending = ['SUBMITTING', 'SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'].includes(review.state.toUpperCase());
  const processing = ['PROCESSING', 'UPLOADING'].includes(review.state.toUpperCase());
  return (
    <div className={`decision-pending-panel ${pending ? 'decision-pending-live' : ''}`}>
      <span className="pending-icon">{pending ? <CircleDashed size={18} /> : processing ? <Clock3 size={18} /> : <FileCheck2 size={18} />}</span>
      <div className="eyebrow">{pending ? 'OUTCOME PENDING' : processing ? 'DOCUMENTS PROCESSING' : 'NO DECISION RECORDED'}</div>
      <h3>{pending ? review.state.toUpperCase() === 'CONSENSUS_PENDING' ? 'Consensus is pending.' : 'No final outcome has been reported.' : processing ? 'Evidence processing is in progress.' : 'This review has no recorded decision.'}</h3>
      <p>{pending ? 'The interface will not infer a result while consensus is pending. The review state will refresh from the backend.' : processing ? 'Review status will update when the API returns a new state.' : 'A decision will appear here only when returned by the connected service.'}</p>
      <StatusBadge label={reviewStateLabel(review)} tone={reviewStateTone(review.state)} pulse={pending || processing} size="sm" />
    </div>
  );
}

export default function ReviewDetailPage() {
  const { reviewId = '' } = useParams();
  const queryClient = useQueryClient();
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const reviewQuery = useQuery({
    queryKey: ['review', reviewId],
    queryFn: () => api.getReview(reviewId),
    enabled: Boolean(reviewId),
    refetchInterval: (query) => {
      const review = query.state.data;
      return review && liveStatus(review.state) ? 7_000 : false;
    },
  });
  const review = reviewQuery.data;
  const evidence = review?.evidence ?? [];
  const hasProject = evidence.some((document) => document.role === 'PROJECT');
  const hasIndependent = evidence.some((document) => document.role === 'INDEPENDENT');
  const hasPair = hasProject && hasIndependent;
  const state = review?.state.toUpperCase() ?? '';
  const editable = ['DRAFT', 'READY_FOR_REVIEW'].includes(state) && !review?.decision;
  const compareMutation = useMutation({
    mutationFn: () => api.compareReview(reviewId),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['review', reviewId], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['sites'] }),
      ]);
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => api.submitReview(reviewId),
    onSuccess: async (updated) => {
      setConfirmSubmit(false);
      queryClient.setQueryData(['review', reviewId], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['sites'] }),
      ]);
    },
  });

  useEffect(() => {
    setConfirmSubmit(false);
    compareMutation.reset();
    submitMutation.reset();
    // Reset the destructive-action confirmation when switching between review ids.
  }, [reviewId]);

  if (reviewQuery.isLoading) return <div className="page-content"><LoadingPanel label="Loading review from the API…" /></div>;
  if (reviewQuery.isError || !review) return <div className="page-content"><PageHeader eyebrow="WORKSPACE / REVIEWS" title="Review detail" description="Review data is loaded from the connected service." /><ApiErrorState error={reviewQuery.error ?? new Error('Review not found in the API response.')} retry={() => void reviewQuery.refetch()} /></div>;

  const canCompare = hasPair && editable && !compareMutation.isPending;
  const canSubmit = Boolean(review.comparison) && hasPair && editable && !submitMutation.isPending;

  return (
    <div className="page-content review-detail-page">
      <div className="back-link-row"><Link to="/reviews"><ArrowLeft size={14} />All reviews</Link><span>/</span><span>{review.reviewId}</span></div>
      <PageHeader
        eyebrow={`REVIEW / ${review.reviewId}`}
        title={review.milestone || 'Milestone review'}
        description={`${review.siteName || review.siteId || 'Site reference not provided'}${review.location ? ` · ${review.location}` : ''}`}
        actions={<StatusBadge label={reviewStateLabel(review)} tone={reviewStateTone(review.state)} pulse={liveStatus(review.state)} />}
      />

      {(review.errorCode || review.errorMessage) && <div className="review-backend-error" role="alert"><ShieldAlert size={16} /><div><strong>{review.errorCode || 'Review processing error'}</strong><p>{review.errorMessage || 'The backend reported a processing error without further detail.'}</p></div></div>}

      <div className="review-detail-layout">
        <div className="review-detail-main">
          <Card className="review-process-card">
            <div className="review-process-head"><div><div className="eyebrow">REVIEW WORKFLOW</div><h2>Evidence, comparison, decision</h2></div><div className="review-created"><span>Created</span><TimeValue value={review.createdAt} empty="Not returned" /></div></div>
            <ReviewStepper steps={[
              { label: 'CLAIM', status: review.milestone ? 'complete' : editable ? 'active' : 'pending' },
              { label: 'EVIDENCE', status: hasPair ? 'complete' : editable ? 'active' : 'pending' },
              { label: 'COMPARISON', status: review.comparison ? 'complete' : hasPair && editable ? 'active' : 'pending' },
              { label: 'GENLAYER REVIEW', status: review.decision ? 'complete' : liveStatus(review.state) ? 'active' : 'pending' },
              { label: 'RECORD', status: review.recordId ? 'complete' : review.decision ? 'active' : 'pending' },
            ]} />
          </Card>

          <Card className="review-evidence-card">
            <div className="card-section-head"><div className="review-section-head"><div><div className="eyebrow">SOURCE DOCUMENTS</div><h2>Evidence pair</h2><p>Submitted close-out and independent supporting evidence.</p></div><span className="evidence-total-pill">{review.evidence ? `${review.evidence.length} ${review.evidence.length === 1 ? 'document' : 'documents'}` : 'Count not returned'}</span></div></div>
            {evidence.length === 0 ? <EmptyState icon={<UploadCloud size={20} />} title="No evidence returned" description="This review has no evidence documents in the API response yet." /> : (
              <div className="evidence-document-list">{evidence.map((document) => <EvidenceDocumentCard key={document.id} document={document} />)}</div>
            )}
            <div className="evidence-roles-summary"><span className={hasProject ? 'role-check role-check-ready' : 'role-check'}><span>{hasProject ? <Check size={11} /> : <span />}</span>Project evidence</span><span className={hasIndependent ? 'role-check role-check-ready' : 'role-check'}><span>{hasIndependent ? <Check size={11} /> : <span />}</span>Independent evidence</span></div>
            {!hasPair && editable && <div className="pair-requirement"><CircleDashed size={14} />Both a project document and an independent document must be present before a comparison can be requested.</div>}
            {editable && <div className="evidence-upload-wrap"><div className="evidence-upload-title"><strong>Add evidence</strong><span>Upload a real source document to this review.</span></div><EvidenceUploader reviewId={review.id} onUploaded={() => void reviewQuery.refetch()} /></div>}
          </Card>

          <Card className="comparison-card">
            <div className="card-section-head"><div className="review-section-head"><div><div className="eyebrow">FIELD-LEVEL REVIEW</div><h2>Document comparison</h2><p>Values and match labels are displayed only when returned by the backend.</p></div></div></div>
            <EvidencePairPanels documents={evidence} />
            {review.comparison && <EvidenceComparison comparison={review.comparison} />}
            {!review.comparison && <div className="comparison-not-run"><div className="comparison-not-run-icon"><GitCompareArrows size={17} /></div><div><strong>Comparison not yet returned</strong><p>Run a comparison after both evidence roles have been supplied.</p></div></div>}
            {compareMutation.isError && <ApiErrorState error={compareMutation.error} retry={() => compareMutation.mutate()} compact />}
            <div className="comparison-actions">
              <div><span className="action-note">{!hasPair ? 'Evidence pair incomplete' : !editable ? 'Review is not editable' : review.comparison ? 'Re-run using current submitted documents' : 'Uses evidence currently attached to this review'}</span></div>
              <Button variant="secondary" disabled={!canCompare} onClick={() => compareMutation.mutate()} icon={<GitCompareArrows size={14} />}>{compareMutation.isPending ? 'Comparing…' : review.comparison ? 'Run comparison again' : 'Compare documents'}</Button>
            </div>
          </Card>

          <Card className="audit-card">
            <div className="card-section-head"><div><div className="eyebrow">AUDIT TRAIL</div><h2>Review events</h2><p>Event data and timestamps as supplied by the API.</p></div></div>
            {review.events?.length ? <ol className="timeline-list">{review.events.map((event, index) => <TimelineEvent key={event.id} event={event} last={index === review.events!.length - 1} />)}</ol> : <div className="audit-empty"><Clock3 size={15} /><span>No audit events were returned for this review.</span></div>}
          </Card>
        </div>

        <aside className="review-detail-aside">
          <Card className="decision-card" padding="none">
            <div className="decision-card-head"><span className="eyebrow">DECISION STATUS</span><span className="decision-card-icon"><FileCheck2 size={16} /></span></div>
            <DecisionPanel review={review} />
            {review.comparison && !review.decision && (
              <div className="submit-review-zone">
                {submitMutation.isError && <ApiErrorState error={submitMutation.error} retry={() => submitMutation.mutate()} compact />}
                {confirmSubmit ? (
                  <div className="submit-confirm" role="group" aria-label="Confirm submission for interpretation"><strong>Submit this review?</strong><p>The current evidence comparison will be sent to the configured GenLayer interpretation flow. The result may be pending or undetermined.</p><div><Button variant="quiet" size="sm" onClick={() => setConfirmSubmit(false)}>Cancel</Button><Button size="sm" disabled={!canSubmit} onClick={() => submitMutation.mutate()}>{submitMutation.isPending ? 'Submitting…' : 'Confirm submission'}</Button></div></div>
                ) : (
                  <Button className="submit-review-button" disabled={!canSubmit} onClick={() => setConfirmSubmit(true)} icon={<ArrowRight size={14} />}>{submitMutation.isPending ? 'Submitting…' : 'Submit for interpretation'}</Button>
                )}
                {!hasPair && <span className="submit-hint">Add both evidence roles before submission.</span>}
              </div>
            )}
            {review.recordId && <div className="record-reference-row"><span>Record reference</span><Link to={`/record/${encodeURIComponent(review.recordId)}`}>{review.recordId}<ChevronRight size={13} /></Link></div>}
          </Card>

          <Card className="review-meta-card">
            <div className="eyebrow">REVIEW REFERENCES</div>
            <div className="detail-meta-list">
              <div><span>Review ID</span><CopyValue value={review.reviewId} label="Copy review ID" /></div>
              <div><span>Site reference</span><CopyValue value={review.siteId} label="Copy site ID" /></div>
              <div><span>Policy version</span><CopyValue value={review.policyVersion} label="Copy policy version" /></div>
              <div><span>Consensus state</span>{review.consensusState ? <StatusBadge label={formatLabel(review.consensusState)} tone={review.consensusState.toUpperCase().includes('PENDING') ? 'blue' : 'neutral'} size="sm" /> : <span className="muted-value">Not returned</span>}</div>
              <div><span>Created time</span><TimeValue value={review.createdAt} empty="Not returned" /></div>
            </div>
          </Card>
          <TransactionLifecycle review={review} />

          <div className="aside-scope-note"><Info size={15} /><p>LotCheck judges documentary consistency only. It does not determine site safety or regulatory compliance.</p></div>
        </aside>
      </div>
      <DecisionDisclaimer compact />
    </div>
  );
}
