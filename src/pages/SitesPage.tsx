import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, FileSearch, Plus, Search } from 'lucide-react';
import { api } from '../api/client';
import { ApiErrorState, Button, Card, EmptyState, PageHeader, StatusBadge, TimeValue } from '../components/ui';
import { formatLabel } from '../lib/format';

function siteTone(status?: string | null): 'green' | 'amber' | 'blue' | 'neutral' {
  const value = status?.toUpperCase();
  if (value === 'ACTIVE' || value === 'IN_PROGRESS' || value === 'OPEN') return 'green';
  if (value === 'PENDING' || value === 'UNDER_REVIEW') return 'amber';
  if (value === 'CLOSED' || value === 'CLOSED_OUT' || value === 'ARCHIVED') return 'blue';
  return 'neutral';
}

export default function SitesPage() {
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: api.getSites });
  const [search, setSearch] = useState('');
  const sites = sitesQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sites;
    return sites.filter((site) => [site.name, site.siteId, site.location, site.milestone, site.evidenceState, site.currentStatus]
      .some((value) => value?.toLowerCase().includes(needle)));
  }, [sites, search]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="WORKSPACE / SITES"
        title="Sites"
        description="Project locations and the evidence reviews associated with each site."
        actions={<Button icon={<Plus size={15} />} href="/reviews/new">Start review</Button>}
      />

      <Card className="list-card" padding="none">
        <div className="list-toolbar">
          <div className="list-toolbar-copy"><div className="list-toolbar-title">Site registry</div><div className="list-toolbar-subtitle">{sitesQuery.isError ? 'Live site data unavailable' : sitesQuery.isLoading ? 'Loading from the connected service…' : `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} returned by API`}</div></div>
          <label className="search-field"><Search size={15} /><span className="sr-only">Search sites</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sites" /></label>
        </div>

        {sitesQuery.isError ? <ApiErrorState error={sitesQuery.error} retry={() => void sitesQuery.refetch()} /> : sitesQuery.isLoading ? (
          <div className="table-skeleton" role="status" aria-label="Loading sites"><div /><div /><div /><div /><div /></div>
        ) : sites.length === 0 ? (
          <EmptyState icon={<Building2 size={20} />} title="No sites returned" description="The connected service has not returned any site records. No example sites are shown." action={<Button size="sm" icon={<FileSearch size={14} />} href="/reviews/new">Start a review</Button>} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="No matching sites" description="Try another site name, reference, location, or status." />
        ) : (
          <div className="table-scroll">
            <table className="data-table sites-table">
              <thead><tr><th>Site ID</th><th>Site name</th><th>Location</th><th>Milestone</th><th>Evidence state</th><th>Evidence pair</th><th>Last review</th><th>Current status</th><th aria-label="Open site" /></tr></thead>
              <tbody>
                {filtered.map((site) => {
                  const projectCount = site.projectEvidenceCount;
                  const independentCount = site.independentEvidenceCount;
                  return (
                    <tr key={site.id}>
                      <td><Link to={`/sites/${encodeURIComponent(site.siteId)}`} className="table-code-link">{site.siteId}</Link></td>
                      <td><Link to={`/sites/${encodeURIComponent(site.siteId)}`} className="table-primary-link"><strong>{site.name}</strong></Link></td>
                      <td>{site.location || <span className="muted-value">Not provided</span>}</td>
                      <td>{site.milestone || <span className="muted-value">Not provided</span>}</td>
                      <td>{site.evidenceState ? <StatusBadge label={formatLabel(site.evidenceState)} tone={siteTone(site.evidenceState)} size="sm" /> : <span className="muted-value">Not reported</span>}</td>
                      <td><div className="pair-counts"><span><i className="pair-dot pair-project" />Project <b>{projectCount == null ? '—' : projectCount}</b></span><span><i className="pair-dot pair-independent" />Independent <b>{independentCount == null ? '—' : independentCount}</b></span></div></td>
                      <td><TimeValue value={site.lastReviewAt} empty="No review date" /></td>
                      <td>{site.currentStatus ? <StatusBadge label={formatLabel(site.currentStatus)} tone={siteTone(site.currentStatus)} size="sm" /> : <span className="muted-value">Not reported</span>}</td>
                      <td><Link to={`/sites/${encodeURIComponent(site.siteId)}`} className="row-open-button" aria-label={`Open site ${site.siteId}`}><ArrowRight size={15} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="list-footer-note"><span className="info-dot">i</span> Site status and evidence counts are displayed only when returned by the API.</div>
    </div>
  );
}
