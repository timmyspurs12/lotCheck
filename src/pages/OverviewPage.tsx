import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Archive, Building2, CircleAlert, FileCheck2, FileSearch, Plus } from 'lucide-react';
import { api } from '../api/client';
import { PageHeader, Button, Card, DecisionBadge, DecisionDisclaimer, EmptyState, ApiErrorState, MetricCard, SectionHeading, StatusBadge, TimeValue } from '../components/ui';
import { WorkflowModel } from '../components/WorkflowModel';
import { reviewStateLabel, reviewStateTone, recordRoute } from '../lib/format';
import type { Site, Review } from '../api/types';

function siteLabel(review: Review, sites?: Site[]) {
  return review.siteName || sites?.find((site) => site.siteId === review.siteId || site.id === review.siteId)?.name || review.siteId || 'Site not identified';
}

function progressState(review: Review) {
  if (review.decision) return <DecisionBadge decision={review.decision} size="sm" />;
  const label = reviewStateLabel(review);
  const tone = reviewStateTone(review.state);
  return <StatusBadge label={label} tone={tone} size="sm" pulse={['SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'].includes(review.state.toUpperCase())} />;
}

export default function OverviewPage() {
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: api.getSites });
  const reviewsQuery = useQuery({ queryKey: ['reviews', 'overview'], queryFn: () => api.getReviews() });
  const sites = sitesQuery.data ?? [];
  const reviews = reviewsQuery.data ?? [];
  const knownSiteStatuses = new Set(['ACTIVE', 'IN_PROGRESS', 'REMEDIATION', 'OPEN', 'CLOSED', 'CLOSED_OUT', 'ARCHIVED', 'PENDING', 'UNDER_REVIEW', 'CANCELLED', 'INACTIVE']);
  const activeSiteStatuses = new Set(['ACTIVE', 'IN_PROGRESS', 'REMEDIATION', 'OPEN']);
  const siteStatusesClassifiable = sites.length === 0 || sites.every((site) => Boolean(site.currentStatus && knownSiteStatuses.has(site.currentStatus.toUpperCase())));
  const activeSiteCount = sitesQuery.isError || !siteStatusesClassifiable ? null : sites.filter((site) => activeSiteStatuses.has((site.currentStatus ?? '').toUpperCase())).length;
  const inProgressCount = useMemo(() => reviews.filter((review) => !review.decision && ['DRAFT', 'UPLOADING', 'PROCESSING', 'READY_FOR_REVIEW', 'SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'].includes(review.state.toUpperCase())).length, [reviews]);
  const disputedCount = reviews.filter((review) => review.decision === 'DISPUTED').length;
  const recordedCount = reviews.filter((review) => Boolean(review.recordId)).length;

  return (
    <div className="page-content overview-page">
      <PageHeader
        eyebrow="LOT CHECK / OPERATIONS"
        title="Evidence Review"
        description="Independent documentary verification of cleanup milestones."
        actions={
          <>
            <Button variant="secondary" icon={<Archive size={15} />} href="/records">View records</Button>
            <Button icon={<Plus size={15} />} href="/reviews/new">Start review</Button>
          </>
        }
      />

      {(sitesQuery.isError || reviewsQuery.isError) && (
        <div className="overview-api-alerts">
          {sitesQuery.isError && <ApiErrorState error={sitesQuery.error} retry={() => void sitesQuery.refetch()} compact />}
          {reviewsQuery.isError && <ApiErrorState error={reviewsQuery.error} retry={() => void reviewsQuery.refetch()} compact />}
        </div>
      )}

      <div className="metric-grid">
        <MetricCard label="ACTIVE SITES" value={activeSiteCount == null ? '—' : activeSiteCount} note={sitesQuery.isError ? 'Live site data unavailable' : activeSiteCount == null ? 'Site status not classifiable' : 'Based on returned site status'} icon={<Building2 size={16} />} loading={sitesQuery.isLoading} />
        <MetricCard label="REVIEWS IN PROGRESS" value={reviewsQuery.isError ? '—' : inProgressCount} note="Known active workflow states only" icon={<FileSearch size={16} />} loading={reviewsQuery.isLoading} />
        <MetricCard label="DISPUTED" value={reviewsQuery.isError ? '—' : disputedCount} note="From returned review outcomes" icon={<CircleAlert size={16} />} loading={reviewsQuery.isLoading} />
        <MetricCard label="RECORDED" value={reviewsQuery.isError ? '—' : recordedCount} note="Records returned by API" icon={<FileCheck2 size={16} />} loading={reviewsQuery.isLoading} />
      </div>

      <div className="overview-main-grid">
        <Card className="review-queue-card" padding="none">
          <div className="card-section-head">
            <SectionHeading title="Review queue" description="Reviews and decisions returned by the connected service." action={<Link className="subtle-link" to="/reviews">All reviews <ArrowRight size={14} /></Link>} />
          </div>
          {reviewsQuery.isError ? null : reviews.length === 0 && !reviewsQuery.isLoading ? (
            <EmptyState
              icon={<FileSearch size={20} />}
              title="No reviews returned"
              description="There are no review records in the connected workspace yet. Start a review to submit a real evidence pair."
              action={<Button size="sm" icon={<Plus size={14} />} href="/reviews/new">Start review</Button>}
            />
          ) : (
            <div className="table-scroll">
              <table className="data-table review-queue-table">
                <thead><tr><th>Site</th><th>Milestone</th><th>Evidence</th><th>Submitted</th><th>Status</th><th aria-label="Open review" /></tr></thead>
                <tbody>
                  {reviews.slice(0, 7).map((review) => {
                    const evidenceCount = review.evidence?.length;
                    const href = review.recordId ? recordRoute(review) : `/reviews/${encodeURIComponent(review.id)}`;
                    return (
                      <tr key={review.id}>
                        <td><Link to={href} className="table-primary-link"><strong>{siteLabel(review, sites)}</strong><small>{review.siteId || 'Site reference not provided'}</small></Link></td>
                        <td>{review.milestone || <span className="muted-value">Not provided</span>}</td>
                        <td>{evidenceCount == null ? <span className="muted-value">Not returned</span> : <span className="evidence-count"><FileCheck2 size={14} />{evidenceCount} {evidenceCount === 1 ? 'document' : 'documents'}</span>}</td>
                        <td><TimeValue value={review.submittedAt} empty="Not submitted" /></td>
                        <td>{progressState(review)}</td>
                        <td><Link to={href} className="row-open-button" aria-label={`Open review ${review.reviewId}`}><ArrowRight size={15} /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="verification-model-card">
          <SectionHeading title="Verification model" description="One review, from claim to recorded status." />
          <WorkflowModel compact />
          <div className="workflow-footnote"><span className="workflow-footnote-dot" />Only the configured documentary question is assessed.</div>
        </Card>
      </div>

      <div className="overview-lower-grid">
        <Card className="scope-card">
          <div className="scope-card-head"><div className="scope-card-icon"><ShieldCheckIcon /></div><div><div className="eyebrow">SCOPE OF DECISION</div><h2>Documentary consistency, not environmental certification.</h2></div></div>
          <p>LotCheck evaluates consistency between submitted documents. An ACCEPT result does not certify environmental safety, sampling methodology, regulatory compliance, or physical site conditions.</p>
          <Link className="scope-link" to="/system">Review system status <ArrowRight size={14} /></Link>
        </Card>
        <Card className="overview-note-card">
          <div className="overview-note-icon"><Archive size={16} /></div>
          <div><strong>Evidence remains inspectable</strong><p>Each review should preserve the exact document references and policy version used for its recorded decision.</p></div>
        </Card>
      </div>
      <DecisionDisclaimer compact />
    </div>
  );
}

function ShieldCheckIcon() {
  return <FileCheck2 size={18} />;
}
