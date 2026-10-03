import type { Decision, Review } from '../api/types';

export function formatLabel(value?: string | null) {
  if (!value) return 'Not available';
  return value.toLowerCase().split(/[_\s]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function reviewStateLabel(review: Pick<Review, 'state'>) {
  const state = review.state.toUpperCase();
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    UPLOADING: 'Uploading evidence',
    PROCESSING: 'Processing documents',
    READY_FOR_REVIEW: 'Ready for comparison',
    SUBMITTING: 'Submitting to GenLayer',
    SUBMITTED: 'Submitted',
    CONSENSUS_PENDING: 'Consensus pending',
    FINALIZING: 'Finalizing',
    FINALIZED: 'Finalized',
    RECORDED: 'Recorded',
    FAILED: 'Failed',
    UNKNOWN: 'Status unreported',
  };
  return labels[state] ?? formatLabel(state);
}

export function decisionTone(decision?: Decision | null): 'green' | 'red' | 'amber' | 'neutral' {
  if (decision === 'ACCEPT') return 'green';
  if (decision === 'DISPUTED') return 'red';
  if (decision === 'INSUFFICIENT') return 'amber';
  return 'neutral';
}

export function reviewStateTone(state: string): 'green' | 'red' | 'amber' | 'blue' | 'neutral' {
  const upper = state.toUpperCase();
  if (upper === 'FAILED') return 'red';
  if (upper === 'RECORDED' || upper === 'FINALIZED') return 'green';
  if (upper.includes('PENDING') || upper === 'SUBMITTED' || upper === 'FINALIZING') return 'blue';
  if (upper === 'SUBMITTING' || upper === 'PROCESSING' || upper === 'UPLOADING') return 'amber';
  return 'neutral';
}

export function formatDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatBytes(size?: number | null) {
  if (size == null || !Number.isFinite(size)) return 'Not provided';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortenedHash(hash?: string | null) {
  if (!hash) return null;
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 9)}…${hash.slice(-6)}`;
}

export function recordRoute(review: Review) {
  if (review.recordId) return `/record/${encodeURIComponent(review.recordId)}`;
  return `/reviews/${encodeURIComponent(review.id)}`;
}
