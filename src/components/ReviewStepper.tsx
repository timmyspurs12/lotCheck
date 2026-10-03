import { Check } from 'lucide-react';

export type ReviewStepStatus = 'complete' | 'active' | 'pending';
export type ReviewStep = { label: string; status: ReviewStepStatus };

export function ReviewStepper({ steps, ariaLabel = 'Review workflow progress' }: { steps: ReviewStep[]; ariaLabel?: string }) {
  return (
    <ol className="review-progress-track" aria-label={ariaLabel}>
      {steps.map((step, index) => (
        <li className={`review-progress-step ${step.status === 'complete' ? 'review-progress-done' : ''} ${step.status === 'active' ? 'review-progress-active' : ''}`} key={`${step.label}-${index}`} aria-current={step.status === 'active' ? 'step' : undefined}>
          <span className="review-progress-number">{step.status === 'complete' ? <Check size={12} /> : `0${index + 1}`}</span><span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
