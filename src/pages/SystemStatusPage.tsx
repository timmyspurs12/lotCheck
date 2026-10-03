import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Clock3, Database, FileCog, FlaskConical, RefreshCw, ServerCog, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import type { Health } from '../api/types';
import { ApiErrorState, Button, Card, DecisionDisclaimer, PageHeader, StatusBadge, TimeValue } from '../components/ui';
import { formatLabel } from '../lib/format';

type ServiceData = { status?: string; connected?: boolean; detail?: string | null } | undefined;

function resolveState(service: ServiceData): { label: string; tone: 'green' | 'amber' | 'red' | 'neutral'; icon: 'good' | 'warn' | 'bad' | 'unknown' } {
  if (!service) return { label: 'Not reported', tone: 'neutral', icon: 'unknown' };
  if (typeof service.connected === 'boolean') return service.connected ? { label: 'Connected', tone: 'green', icon: 'good' } : { label: 'Disconnected', tone: 'red', icon: 'bad' };
  const status = service.status?.toUpperCase();
  if (status && ['OK', 'UP', 'HEALTHY', 'OPERATIONAL', 'CONNECTED', 'READY'].includes(status)) return { label: formatLabel(status), tone: 'green', icon: 'good' };
  if (status && ['DEGRADED', 'PENDING', 'INITIALIZING', 'PROCESSING'].includes(status)) return { label: formatLabel(status), tone: 'amber', icon: 'warn' };
  if (status && ['DOWN', 'UNAVAILABLE', 'DISCONNECTED', 'ERROR', 'FAILED'].includes(status)) return { label: formatLabel(status), tone: 'red', icon: 'bad' };
  return status ? { label: formatLabel(status), tone: 'neutral', icon: 'unknown' } : { label: 'Not reported', tone: 'neutral', icon: 'unknown' };
}

function ServiceCard({ title, detail, icon: Icon, data }: { title: string; detail: string; icon: typeof Activity; data: ServiceData }) {
  const state = resolveState(data);
  const StatusIcon = state.icon === 'good' ? CheckCircle2 : state.icon === 'bad' ? ShieldAlert : state.icon === 'warn' ? AlertCircle : CircleDashed;
  return (
    <Card className="service-card">
      <div className="service-card-top"><span className="service-card-icon"><Icon size={17} /></span><StatusBadge label={state.label} tone={state.tone} size="sm" /></div>
      <h2>{title}</h2><p>{detail}</p>
      <div className={`service-detail-state service-state-${state.icon}`}><StatusIcon size={13} /><span>{data?.detail || (data?.status ? `Status supplied: ${formatLabel(data.status)}` : 'No service detail returned by API.')}</span></div>
    </Card>
  );
}

export default function SystemStatusPage() {
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: api.getHealth, retry: 0, refetchInterval: 30_000 });
  const health: Health | undefined = healthQuery.data;
  return (
    <div className="page-content system-status-page">
      <PageHeader eyebrow="NETWORK / SYSTEM STATUS" title="System status" description="Connectivity reported by the LotCheck backend; no contract or consensus state is inferred." actions={<Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void healthQuery.refetch()}>Refresh status</Button>} />
      {healthQuery.isError && <ApiErrorState error={healthQuery.error} retry={() => void healthQuery.refetch()} />}
      <div className="system-status-summary"><span className="system-summary-icon"><Activity size={17} /></span><div><strong>{healthQuery.isError ? 'Status endpoint unavailable' : healthQuery.isLoading ? 'Checking service status…' : health ? 'Backend status response received' : 'Status not reported'}</strong><p>{healthQuery.isError ? 'The backend health response could not be read. Individual services are not assumed to be down or up.' : 'Each status below reflects an explicit field in the current health response.'}</p></div><span className="system-summary-checked"><Clock3 size={13} />{health?.checkedAt ? <TimeValue value={health.checkedAt} empty="Not checked" /> : 'Check time not returned'}</span></div>

      <div className="service-grid">
        <ServiceCard title="Application API" detail="Frontend request service" icon={ServerCog} data={health?.applicationApi} />
        <ServiceCard title="Database" detail="Backend-reported persistence connection" icon={Database} data={health?.database} />
        <ServiceCard title="Document processing" detail="Backend-reported extraction pipeline" icon={FileCog} data={health?.documentProcessing} />
        <ServiceCard title="GenLayer RPC" detail={health?.genlayer?.network ? `Network · ${health.genlayer.network}` : 'Network name not reported'} icon={FlaskConical} data={health?.genlayer} />
      </div>

      <Card className="system-technical-card"><div className="card-section-head"><div><div className="eyebrow">BACKEND-REPORTED REFERENCES</div><h2>Network & consensus</h2><p>Values remain blank until explicitly returned by the health endpoint.</p></div></div><div className="system-technical-grid">
        <div><span>GenLayer network</span><strong>{health?.genlayer?.network || 'Not reported'}</strong></div>
        <div><span>Contract address</span><strong className="technical-break">{health?.genlayer?.contractAddress || 'Not reported'}</strong></div>
        <div><span>Consensus state</span><strong>{health?.genlayer?.consensusState ? formatLabel(health.genlayer.consensusState) : 'Not reported'}</strong></div>
        <div><span>Last successful transaction</span><strong className="technical-break">{health?.genlayer?.lastSuccessfulTransaction || 'Not reported'}</strong></div>
      </div></Card>

      <div className="status-limits-note"><ShieldAlert size={15} /><p>A connected health endpoint does not prove that a specific transaction finalized, that a consensus result is available, or that any environmental conditions meet a standard.</p></div>
      <DecisionDisclaimer compact />
    </div>
  );
}
