import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clipboard,
  Clock3,
  FileSearch,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  CircleDashed,
} from 'lucide-react';
import type { Decision } from '../api/types';
import { isApiError } from '../api/client';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-heading-copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  onClick,
  type = 'button',
  className = '',
  href,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
  href?: string;
}) {
  const classes = `button button-${variant} button-${size} ${className}`.trim();
  if (href) {
    if (disabled) return <span className={classes} aria-disabled="true">{icon}{children}</span>;
    return <Link className={classes} to={href}>{icon}{children}</Link>;
  }
  return (
    <button className={classes} type={type} disabled={disabled} onClick={onClick}>
      {icon}{children}
    </button>
  );
}

export function Card({ children, className = '', padding = 'md' }: { children: ReactNode; className?: string; padding?: 'sm' | 'md' | 'none' }) {
  return <section className={`card card-${padding} ${className}`.trim()}>{children}</section>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function DecisionBadge({ decision, size = 'md' }: { decision?: Decision | null; size?: 'sm' | 'md' }) {
  if (!decision) return <StatusBadge label="No decision" tone="neutral" size={size} />;
  const icon = decision === 'ACCEPT' ? <Check size={12} /> : decision === 'DISPUTED' ? <ShieldAlert size={12} /> : <CircleDashed size={12} />;
  return <span className={`status-badge decision-${decision.toLowerCase()} status-${size}`}>{icon}{decision}</span>;
}

export function StatusBadge({ label, tone = 'neutral', size = 'md', pulse = false }: { label: string; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue'; size?: 'sm' | 'md'; pulse?: boolean }) {
  return (
    <span className={`status-badge tone-${tone} status-${size}`}>
      <span className={`status-dot ${pulse ? 'status-dot-pulse' : ''}`} />
      {label}
    </span>
  );
}

export function DecisionDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`decision-disclaimer ${compact ? 'decision-disclaimer-compact' : ''}`} role="note">
      <Info size={15} aria-hidden="true" />
      <p>
        <strong>Scope of decision.</strong> LotCheck evaluates consistency between submitted documents. An ACCEPT result does not certify environmental safety, sampling methodology, regulatory compliance, or physical site conditions.
      </p>
    </div>
  );
}

export function MetricCard({ label, value, note, icon, loading = false }: { label: string; value: string | number; note?: string; icon: ReactNode; loading?: boolean }) {
  return (
    <div className="metric-card">
      <div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div>
      <div className={`metric-value ${loading ? 'skeleton-text' : ''}`}>{loading ? ' ' : value}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <FileSearch size={20} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function ApiErrorState({ error, retry, compact = false }: { error: unknown; retry?: () => void; compact?: boolean }) {
  const apiError = isApiError(error) ? error : null;
  const code = apiError?.code;
  const guidance: Record<string, { message: string; next: string }> = {
    INVALID_API_RESPONSE: { message: 'The service returned data LotCheck could not safely display.', next: 'Check the backend response contract. No decision data was displayed.' },
    API_UNAVAILABLE: { message: 'The LotCheck API could not be reached.', next: 'Check the backend service and API base URL, then retry.' },
    DOCUMENT_PROCESSING_FAILED: { message: 'Document processing failed for this evidence item.', next: 'Check the source file and processing details, then re-upload only if the backend indicates it is safe to do so.' },
    GENLAYER_SUBMISSION_FAILED: { message: 'The interpretation request was not confirmed as submitted.', next: 'Check system status and review status before retrying to avoid a duplicate submission.' },
    GENLAYER_TIMEOUT: { message: 'GenLayer did not return a confirmed outcome before the timeout.', next: 'Refresh review status or system status before taking another action.' },
    TRANSACTION_REVERTED: { message: 'The transaction was reported as reverted; no recorded outcome is confirmed.', next: 'Keep the evidence attached and check the review status before resubmitting.' },
    RECORD_NOT_FOUND: { message: 'The requested verification record was not found by the backend.', next: 'Confirm the record reference from the originating review.' },
    INVALID_EVIDENCE_PAIR: { message: 'The evidence pair does not meet the backend comparison requirements.', next: 'Check that project close-out and independent evidence are assigned to the correct roles.' },
  };
  const knownGuidance = code ? guidance[code.toUpperCase()] : undefined;
  const friendly = knownGuidance?.message ?? apiError?.message ?? 'The request could not be completed.';

  return (
    <div className={`api-error-state ${compact ? 'api-error-compact' : ''}`} role="alert">
      <div className="api-error-icon"><AlertCircle size={17} /></div>
      <div className="api-error-copy">
        <strong>{code ?? 'REQUEST_FAILED'}</strong>
        <p>{friendly}</p>
        {knownGuidance && <small className="api-error-next">Next: {knownGuidance.next}</small>}
        {knownGuidance && apiError?.message && apiError.message !== knownGuidance.message && code?.toUpperCase() !== 'API_UNAVAILABLE' && <small className="api-error-backend-detail">Backend detail: {apiError.message}</small>}
        {apiError?.endpoint && <code>{apiError.endpoint}</code>}
      </div>
      {retry && <button type="button" className="icon-button error-retry" onClick={retry} aria-label="Retry request"><RefreshCw size={15} /></button>}
    </div>
  );
}

export function LoadingPanel({ label = 'Loading record…' }: { label?: string }) {
  return (
    <div className="loading-panel" role="status">
      <LoaderCircle className="spin" size={17} />
      <span>{label}</span>
    </div>
  );
}

export function CopyValue({ value, label = 'Copy' }: { value: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted-value">Not available</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button className="copy-value" type="button" onClick={copy} aria-label={`${label}: ${value}`}>
      <span>{value}</span>
      {copied ? <Check size={13} /> : <Clipboard size={13} />}
      <span className="sr-only">{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function CopyAction({ value, label }: { value: string | null | undefined; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return <button type="button" className="button button-secondary button-sm" disabled={!value} onClick={() => void handleCopy()}>{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? 'Copied' : label}</button>;
}

export function TimeValue({ value, empty = 'Not recorded' }: { value?: string | null; empty?: string }) {
  if (!value) return <span className="muted-value">{empty}</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>{value}</span>;
  return <time dateTime={value} title={date.toLocaleString()}>{date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</time>;
}

export function EvidenceScopeLabel({ children = 'DOCUMENTARY REVIEW' }: { children?: ReactNode }) {
  return <span className="scope-label"><Clock3 size={12} />{children}</span>;
}

export function isSafeResourceUrl(href: string) {
  try {
    const protocol = new URL(href, window.location.origin).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  if (!isSafeResourceUrl(href)) return <span className="external-link external-link-disabled" aria-label="Unsafe or invalid URL">{children}<span>Link unavailable</span></span>;
  return <a className="external-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} /></a>;
}

export function InlineFailure({ title, message }: { title: string; message: string }) {
  return <div className="inline-failure"><ShieldAlert size={15} /><div><strong>{title}</strong><span>{message}</span></div></div>;
}

export function ErrorAction({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="text-action" onClick={onClick}><RefreshCw size={13} />{label}</button>;
}

export function StepState({ state }: { state: 'complete' | 'active' | 'pending' | 'failed' }) {
  if (state === 'complete') return <span className="step-state step-complete"><Check size={12} />Complete</span>;
  if (state === 'active') return <span className="step-state step-active"><LoaderCircle size={12} className="spin" />In progress</span>;
  if (state === 'failed') return <span className="step-state step-failed"><AlertCircle size={12} />Failed</span>;
  return <span className="step-state step-pending"><CircleDashed size={12} />Pending</span>;
}
