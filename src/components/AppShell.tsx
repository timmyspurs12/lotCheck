import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Archive,
  BookOpenCheck,
  Building2,
  ChevronRight,
  CircleHelp,
  FileSearch,
  FileCheck2,
  Fingerprint,
  FlaskConical,
  Menu,
  PanelLeftClose,
  Settings2,
  X,
} from 'lucide-react';
import { api, isApiError } from '../api/client';
import type { Health } from '../api/types';

const primaryNav = [
  { label: 'Overview', to: '/overview', icon: BookOpenCheck },
  { label: 'Sites', to: '/sites', icon: Building2 },
  { label: 'Reviews', to: '/reviews', icon: FileSearch },
  { label: 'Records', to: '/records', icon: Archive },
];

function routeTitle(pathname: string) {
  if (pathname === '/overview' || pathname === '/') return 'Evidence Review';
  if (pathname === '/sites') return 'Sites';
  if (pathname.startsWith('/sites/')) return 'Site detail';
  if (pathname === '/reviews/new') return 'Start review';
  if (pathname === '/reviews') return 'Reviews';
  if (pathname.startsWith('/reviews/')) return 'Review detail';
  if (pathname === '/records') return 'Records';
  if (pathname.startsWith('/record/')) return 'Verification record';
  if (pathname.startsWith('/evidence/')) return 'Evidence document';
  if (pathname === '/system') return 'System status';
  if (pathname === '/settings') return 'Workspace settings';
  return 'LotCheck';
}

function isConnected(health?: Health) {
  const service = health?.genlayer;
  if (!service) return null;
  if (typeof service.connected === 'boolean') return service.connected;
  const status = service.status?.toLowerCase();
  if (status && ['connected', 'operational', 'healthy', 'ok', 'up'].includes(status)) return true;
  if (status && ['disconnected', 'down', 'unavailable', 'error', 'failed'].includes(status)) return false;
  return null;
}

function Sidebar({ onNavigate, networkLabel }: { onNavigate?: () => void; networkLabel: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand-wrap">
        <Link to="/overview" className="brand-lockup" onClick={onNavigate} aria-label="LotCheck overview">
          <span className="brand-mark"><span className="brand-mark-inner" /></span>
          <span className="brand-name">LOT<span>CHECK</span></span>
        </Link>
        <div className="brand-caption">Evidence Review</div>
      </div>

      <nav className="sidebar-nav" aria-label="Primary navigation">
        <div className="nav-section-label">WORKSPACE</div>
        {primaryNav.map(({ label, to, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`} onClick={onNavigate}>
            <Icon size={16} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}

        <div className="nav-divider" />
        <div className="nav-section-label">NETWORK</div>
        <div className="nav-network-row">
          <span className="network-symbol"><FlaskConical size={15} /></span>
          <span>GenLayer</span>
          <span className="nav-network-env">{networkLabel}</span>
        </div>
        <NavLink to="/system" className={({ isActive }) => `nav-link nav-link-sub ${isActive ? 'nav-link-active' : ''}`} onClick={onNavigate}>
          <Activity size={15} strokeWidth={1.8} />
          <span>System status</span>
        </NavLink>

        <div className="nav-divider" />
        <div className="nav-section-label">PREFERENCES</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">LC</span>
          <span className="workspace-switcher-copy"><strong>LotCheck</strong><small>Current workspace</small></span>
          <ChevronRight size={14} className="workspace-chevron" />
        </div>
        <button className="nav-link settings-nav" type="button" onClick={() => { onNavigate?.(); window.dispatchEvent(new Event('lotcheck:open-settings')); }}>
          <Settings2 size={16} strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-mark"><FileCheck2 size={15} /></div>
        <div><strong>Documentary review</strong><span>Not an environmental certification</span></div>
      </div>
    </aside>
  );
}

function SettingsDialog({ health, onClose }: { health?: Health; onClose: () => void }) {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'Same origin · /api';
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const networkName = health?.genlayer?.network?.trim() || undefined;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal settings-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <div><span className="eyebrow">WORKSPACE</span><h2 id="settings-title">Settings</h2></div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close settings"><X size={17} /></button>
        </div>
        <div className="settings-content">
          <div className="settings-row"><div><strong>Environment</strong><span>Application target</span></div><span className="env-pill">TESTNET</span></div>
          <div className="settings-row"><div><strong>GenLayer network</strong><span>Reported by the backend</span></div><span className="muted-value">{networkName ?? 'Not reported'}</span></div>
          <div className="settings-row"><div><strong>API base</strong><span>Configured frontend endpoint</span></div><code>{apiBase}</code></div>
          <div className="settings-row"><div><strong>Reviewer identity</strong><span>Provided by the backend, when available</span></div><span className="muted-value">{health?.reviewer?.displayName ?? 'Not provided'}</span></div>
          <div className="settings-note"><InfoNote />No wallet or identity is assumed by this interface. Reviewer permissions must be supplied and enforced by the connected backend.</div>
        </div>
      </section>
    </div>
  );
}

function InfoNote() {
  return <CircleHelp size={15} />;
}

export default function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: api.getHealth, retry: 0, refetchInterval: 30_000 });
  const title = routeTitle(location.pathname);
  const connected = isConnected(healthQuery.data);
  const connectionLabel = healthQuery.isLoading ? 'Checking connection' : healthQuery.isError ? 'Status unavailable' : connected === true ? 'Connected' : connected === false ? 'Disconnected' : 'Status unreported';
  const healthFailureMessage = isApiError(healthQuery.error)
    ? healthQuery.error.code === 'API_UNAVAILABLE'
      ? 'The API could not be reached. Live records are unavailable.'
      : 'The API health response could not be validated. Live system status is unavailable.'
    : 'The API health endpoint is unavailable. Live system status is unknown.';
  const networkName = healthQuery.data?.genlayer?.network?.trim() || undefined;
  const networkLabel = networkName?.toUpperCase() ?? 'UNREPORTED';
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener('lotcheck:open-settings', open);
    return () => window.removeEventListener('lotcheck:open-settings', open);
  }, []);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className={`sidebar-shell ${mobileOpen ? 'sidebar-shell-open' : ''}`}>
        <Sidebar onNavigate={() => setMobileOpen(false)} networkLabel={networkLabel} />
        <button className="sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><PanelLeftClose size={17} /></button>
      </div>

      <main className="main-column" id="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
            <div className="breadcrumb"><span>LotCheck</span><ChevronRight size={13} /><strong>{title}</strong></div>
          </div>
          <div className="topbar-right">
            <span className="env-pill" title="Configured application environment; network connectivity is reported separately"><span className="env-dot" />TESTNET</span>
            <div className="topbar-connection" title={healthQuery.data?.genlayer?.detail ?? connectionLabel}>
              <span className={`connection-indicator ${connected === true ? 'connection-good' : connected === false ? 'connection-bad' : ''}`} />
              <span className="connection-label">GenLayer</span>
              <span className="connection-value">{connectionLabel}</span>
            </div>
            <button className="reviewer-control" type="button" onClick={() => setSettingsOpen(true)}>
              <span className="reviewer-avatar"><Fingerprint size={16} /></span>
              <span className="reviewer-control-copy"><strong>{healthQuery.data?.reviewer?.displayName ?? 'Reviewer'}</strong><small>{healthQuery.data?.reviewer?.identity ?? 'Identity unavailable'}</small></span>
              <ChevronRight size={14} />
            </button>
          </div>
        </header>
        <div className="network-status-strip" aria-live="polite">
          <span className={`network-status-dot ${connected === true ? 'good' : connected === false ? 'bad' : ''}`} />
          <span>{healthQuery.isError ? healthFailureMessage : connected === true ? `GenLayer ${healthQuery.data?.genlayer?.network ?? 'network'} · ${connectionLabel.toLowerCase()}` : connected === false ? 'GenLayer connection reported unavailable by the backend.' : 'Connection status is not reported by the backend.'}</span>
          {healthQuery.data?.checkedAt && <span className="status-checked">Checked <time>{new Date(healthQuery.data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>}
        </div>
        <Outlet context={{ health: healthQuery.data, healthLoading: healthQuery.isLoading, healthError: healthQuery.error }} />
      </main>
      {settingsOpen && <SettingsDialog health={healthQuery.data} onClose={closeSettings} />}
    </div>
  );
}
