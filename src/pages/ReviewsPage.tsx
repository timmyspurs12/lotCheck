import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileSearch, Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import { ApiErrorState, Button, Card, DecisionBadge, EmptyState, PageHeader, TimeValue } from '../components/ui';
import { reviewStateLabel } from '../lib/format';
import type { Review } from '../api/types';

const activeWorkflowStates = ['DRAFT', 'UPLOADING', 'PROCESSING', 'READY_FOR_REVIEW', 'SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING'];
const decisionFilters = [
  { value: 'ALL', label: 'All' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ACCEPT', label: 'ACCEPT' },
  { value: 'DISPUTED', label: 'DISPUTED' },
  { value: 'INSUFFICIENT', label: 'INSUFFICIENT' },
];

function matchesSearch(review: Review, query: string) {
  const value = query.trim().toLowerCase();
  if (!value) return true;
  const details = [review.reviewId, review.siteId, review.siteName, review.milestone, review.state, review.decision, review.recordId];
  const evidence = review.evidence?.flatMap((document) => [document.sha256, document.filename, document.id]) ?? [];
  return [...details, ...evidence].some((entry) => entry?.toLowerCase().includes(value));
}

function passesFilter(review: Review, filter: string) {
  if (filter === 'ALL') return true;
  if (filter === 'IN_PROGRESS') return !review.decision && activeWorkflowStates.includes(review.state.toUpperCase());
  return review.decision === filter;
}

function evidenceSets(review: Review) {
  if (!review.evidence) return null;
  const project = review.evidence.filter((document) => document.role === 'PROJECT').length;
  const independent = review.evidence.filter((document) => document.role === 'INDEPENDENT').length;
  return `${project} project · ${independent} independent`;
}

export default function ReviewsPage() {
  const [searchParams] = useSearchParams();
  const siteFilter = searchParams.get('siteId') ?? '';
  const reviewsQuery = useQuery({ queryKey: ['reviews', 'list', siteFilter], queryFn: () => api.getReviews({ siteId: siteFilter || undefined }) });
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const reviews = reviewsQuery.data ?? [];
  const filtered = useMemo(() => reviews.filter((review) => passesFilter(review, statusFilter) && matchesSearch(review, search)), [reviews, statusFilter, search]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="WORKSPACE / REVIEWS"
        title="Reviews"
        description={siteFilter ? `Documentary comparisons and decisions for site ${siteFilter}.` : 'Review site ID, milestone evidence, comparison, and recorded outcome.'}
        actions={<Button icon={<Plus size={15} />} href="/reviews/new">Start review</Button>}
      />

      <Card className="list-card" padding="none">
        <div className="list-toolbar review-list-toolbar">
          <div className="list-toolbar-copy"><div className="list-toolbar-title">Review register</div><div className="list-toolbar-subtitle">{reviewsQuery.isError ? 'Live review data unavailable' : reviewsQuery.isLoading ? 'Loading from the connected service…' : `${filtered.length} of ${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}</div></div>
          <div className="list-toolbar-filters">
            <label className="select-field"><span className="sr-only">Filter reviews</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{decisionFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="search-field"><Search size={15} /><span className="sr-only">Search site ID, review ID, or document hash</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID or document hash" /></label>
          </div>
        </div>

        {reviewsQuery.isError ? <ApiErrorState error={reviewsQuery.error} retry={() => void reviewsQuery.refetch()} /> : reviewsQuery.isLoading ? (
          <div className="table-skeleton" role="status" aria-label="Loading reviews"><div /><div /><div /><div /><div /></div>
        ) : reviews.length === 0 ? (
          <EmptyState icon={<FileSearch size={20} />} title="No reviews returned" description="No review records were found in the connected workspace. LotCheck does not create sample review results." action={<Button size="sm" icon={<Plus size={14} />} href="/reviews/new">Start review</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="No matching reviews" description="Adjust the decision filter or search by site ID, review ID, or document hash." />
        ) : (
          <div className="table-scroll">
            <table className="data-table reviews-table">
              <thead><tr><th>Review ID</th><th>Site</th><th>Milestone</th><th>Evidence sets</th><th>Decision</th><th>Submitted</th><th>Finalized</th><th>Record</th><th aria-label="Open review" /></tr></thead>
              <tbody>
                {filtered.map((review) => {
                  const sets = evidenceSets(review);
                  return (
                    <tr key={review.id}>
                      <td><Link to={`/reviews/${encodeURIComponent(review.id)}`} className="table-primary-link"><strong>{review.reviewId}</strong><small>{reviewStateLabel(review)}</small></Link></td>
                      <td><Link to={`/sites/${encodeURIComponent(review.siteId)}`} className="table-primary-link"><strong>{review.siteName || review.siteId}</strong><small>{review.siteId}</small></Link></td>
                      <td>{review.milestone || <span className="muted-value">Not provided</span>}</td>
                      <td>{sets ?? <span className="muted-value">Not returned</span>}</td>
                      <td><DecisionBadge decision={review.decision} size="sm" /></td>
                      <td><TimeValue value={review.submittedAt} empty="Not submitted" /></td>
                      <td><TimeValue value={review.finalizedAt} empty="Not finalized" /></td>
                      <td>{review.recordId ? <Link to={`/record/${encodeURIComponent(review.recordId)}`} className="table-code-link">{review.recordId}</Link> : <span className="muted-value">Not recorded</span>}</td>
                      <td><Link to={`/reviews/${encodeURIComponent(review.id)}`} className="row-open-button" aria-label={`Open review ${review.reviewId}`}><ArrowRight size={15} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="list-footer-note"><span className="info-dot">i</span> Decision labels are backend-recorded documentary outcomes, not environmental safety or compliance determinations.</div>
    </div>
  );
}
