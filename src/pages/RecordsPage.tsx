import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Archive, FileSearch, Fingerprint } from 'lucide-react';
import { api } from '../api/client';
import { ApiErrorState, Card, DecisionBadge, DecisionDisclaimer, EmptyState, PageHeader, TimeValue } from '../components/ui';

export default function RecordsPage() {
  const reviewsQuery = useQuery({ queryKey: ['reviews', 'records'], queryFn: () => api.getReviews() });
  const reviews = reviewsQuery.data ?? [];
  const records = reviews.filter((review) => Boolean(review.recordId));

  return (
    <div className="page-content">
      <PageHeader eyebrow="WORKSPACE / RECORDS" title="Verification records" description="Backend-reported review decisions and their inspectable source references." />
      <Card className="list-card" padding="none">
        <div className="list-toolbar"><div className="list-toolbar-copy"><div className="list-toolbar-title">Recorded decisions</div><div className="list-toolbar-subtitle">{reviewsQuery.isError ? 'Review register unavailable' : reviewsQuery.isLoading ? 'Loading records…' : `${records.length} record${records.length === 1 ? '' : 's'} linked from the review register`}</div></div><span className="records-data-note"><Fingerprint size={14} />Only API-returned records</span></div>
        {reviewsQuery.isError ? <ApiErrorState error={reviewsQuery.error} retry={() => void reviewsQuery.refetch()} /> : reviewsQuery.isLoading ? <div className="table-skeleton" role="status" aria-label="Loading records"><div /><div /><div /><div /></div> : records.length === 0 ? (
          <EmptyState icon={<Archive size={20} />} title="No verification records returned" description="The review register contains no record references yet. Decisions are never created in the browser." />
        ) : (
          <div className="table-scroll"><table className="data-table records-table"><thead><tr><th>Record</th><th>Site</th><th>Milestone</th><th>Decision</th><th>Network</th><th>Finalized</th><th aria-label="Open record" /></tr></thead><tbody>
            {records.map((review) => <tr key={review.recordId}>
              <td><Link to={`/record/${encodeURIComponent(review.recordId!)}`} className="table-primary-link"><strong>{review.recordId}</strong><small>{review.reviewId}</small></Link></td>
              <td><span className="cell-strong">{review.siteName || review.siteId || 'Not identified'}</span><small className="table-secondary">{review.siteId || 'Site reference not returned'}</small></td>
              <td>{review.milestone || <span className="muted-value">Not provided</span>}</td>
              <td><DecisionBadge decision={review.decision} size="sm" /></td>
              <td>{review.network || <span className="muted-value">Not returned</span>}</td>
              <td><TimeValue value={review.finalizedAt} empty="Not returned" /></td>
              <td><Link to={`/record/${encodeURIComponent(review.recordId!)}`} className="row-open-button" aria-label={`Open record ${review.recordId}`}><ArrowRight size={15} /></Link></td>
            </tr>)}
          </tbody></table></div>
        )}
      </Card>
      <div className="record-register-note"><FileSearch size={14} /><span>This register is derived from records linked by the API. It is not a blockchain explorer and makes no assumptions about transaction finality.</span></div>
      <DecisionDisclaimer compact />
    </div>
  );
}
