import { CircleDashed, Fingerprint, Network, ShieldAlert } from 'lucide-react';
import type { Review } from '../api/types';
import { formatLabel } from '../lib/format';
import { CopyValue, ExternalLink, StepState, TimeValue } from './ui';

const postSubmissionStates = ['SUBMITTED', 'CONSENSUS_PENDING', 'FINALIZING', 'FINALIZED', 'RECORDED'];
const finalizedStates = ['FINALIZED', 'RECORDED'];
const resolvedConsensusStates = ['ACCEPTED', 'COMPLETED', 'FINALIZED', 'SUCCEEDED', 'SUCCESS', 'RESOLVED'];

export function TransactionLifecycle({ review }: { review: Review }) {
  const state = review.state.toUpperCase();
  const consensus = review.consensusState?.toUpperCase();
  const submitted = Boolean(review.submittedAt) || postSubmissionStates.includes(state);
  const finalized = Boolean(review.finalizedAt) || finalizedStates.includes(state);
  const consensusResolved = Boolean(consensus && resolvedConsensusStates.includes(consensus)) || finalized;
  const consensusPending = state === 'CONSENSUS_PENDING' || Boolean(consensus?.includes('PENDING'));
  const transactionReferenceAvailable = Boolean(review.transactionHash || review.transactionUrl);
  const code = review.errorCode?.toUpperCase() ?? '';
  const failureIndex = code.includes('DOCUMENT_PROCESSING_FAILED') || code.includes('INVALID_EVIDENCE_PAIR') ? 0
    : code.includes('GENLAYER_SUBMISSION_FAILED') ? 1
      : code.includes('GENLAYER_TIMEOUT') ? 2
        : code.includes('TRANSACTION_REVERTED') ? 3
          : code.includes('RECORD_NOT_FOUND') ? 4
            : -1;
  const stageStatus = (index: number, complete: boolean, active = false): 'complete' | 'active' | 'pending' | 'failed' => {
    if (state === 'FAILED' && failureIndex === index) return 'failed';
    if (complete) return 'complete';
    if (state === 'FAILED') return 'pending';
    return active ? 'active' : 'pending';
  };
  const steps = [
    { label: 'PREPARING', status: stageStatus(0, submitted, !submitted && state !== 'FAILED') },
    { label: 'SUBMITTED', status: stageStatus(1, submitted, false) },
    { label: 'CONSENSUS', status: stageStatus(2, consensusResolved, consensusPending) },
    { label: 'FINALIZED', status: stageStatus(3, finalized, state === 'FINALIZING') },
    { label: 'RECORDED', status: stageStatus(4, Boolean(review.recordId) || state === 'RECORDED') },
  ];

  return (
    <section className="transaction-lifecycle" aria-labelledby="transaction-lifecycle-title">
      <div className="transaction-lifecycle-head"><span className="transaction-lifecycle-icon"><Network size={15} /></span><div><div className="eyebrow">GENLAYER REVIEW</div><h3 id="transaction-lifecycle-title">Transaction lifecycle</h3></div><span className="transaction-state-label">{formatLabel(review.state)}</span></div>
      <ol className="lifecycle-steps">
        {steps.map(({ label, status }, index) => (
          <li key={label} className={`lifecycle-step lifecycle-step-${status}`}>
            <span className="lifecycle-step-line" aria-hidden="true">{index < steps.length - 1 && <span />}</span>
            <span className="lifecycle-step-mark"><StepState state={status} /></span>
            <span className="lifecycle-step-label">{label}</span>
          </li>
        ))}
      </ol>
      <div className={`network-confirmation-note ${submitted && !transactionReferenceAvailable ? 'network-confirmation-awaiting' : ''}`}>
        {submitted && !transactionReferenceAvailable ? <CircleDashed size={14} /> : state === 'FAILED' ? <ShieldAlert size={14} /> : <Fingerprint size={14} />}
        <span>{submitted && !transactionReferenceAvailable ? 'Awaiting network confirmation.' : state === 'FAILED' ? 'The backend reported a failure. No final decision is inferred.' : transactionReferenceAvailable ? 'Transaction reference returned by the backend.' : 'No transaction reference returned for this review.'}</span>
      </div>
      {review.transactionUrl && <div className="transaction-explorer-link"><ExternalLink href={review.transactionUrl}>View transaction</ExternalLink></div>}
      <div className="transaction-lifecycle-meta">
        <div><span>Network</span><strong>{review.network || 'Not returned'}</strong></div>
        <div><span>Contract address</span><CopyValue value={review.contractAddress} label="Copy contract address" /></div>
        <div><span>Policy version</span><CopyValue value={review.policyVersion} label="Copy policy version" /></div>
        <div><span>Transaction hash</span><CopyValue value={review.transactionHash} label="Copy transaction hash" /></div>
        <div><span>Submitted</span><TimeValue value={review.submittedAt} empty="Not returned" /></div>
        <div><span>Finalized</span><TimeValue value={review.finalizedAt} empty="Not returned" /></div>
      </div>
    </section>
  );
}
