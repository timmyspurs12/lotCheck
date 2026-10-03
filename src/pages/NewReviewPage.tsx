import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, FilePlus2, Info, LoaderCircle, MapPin } from 'lucide-react';
import { api } from '../api/client';
import type { Site } from '../api/types';
import { ApiErrorState, Button, Card, DecisionDisclaimer, PageHeader } from '../components/ui';
import { WorkflowModel } from '../components/WorkflowModel';
import { ReviewStepper } from '../components/ReviewStepper';

function SiteChoice({ site, selected, onClick }: { site: Site; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`site-choice ${selected ? 'site-choice-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span className="site-choice-icon"><Building2 size={17} /></span>
      <span className="site-choice-copy"><strong>{site.name}</strong><small>{site.siteId}{site.location ? ` · ${site.location}` : ''}</small></span>
      {selected && <span className="site-choice-check" />}
    </button>
  );
}

export default function NewReviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sitesQuery = useQuery({ queryKey: ['sites'], queryFn: api.getSites });
  const [searchParams] = useSearchParams();
  const requestedSiteId = searchParams.get('siteId') ?? '';
  const [selectedSiteId, setSelectedSiteId] = useState(requestedSiteId);
  const [manualSite, setManualSite] = useState({ siteId: requestedSiteId, siteName: '', location: '' });
  const [milestone, setMilestone] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const sites = sitesQuery.data ?? [];
  const selectedSite = useMemo(() => sites.find((site) => site.siteId === selectedSiteId), [sites, selectedSiteId]);
  const siteId = selectedSite?.siteId || manualSite.siteId.trim();
  const mutation = useMutation({
    mutationFn: () => api.createReview({
      siteId,
      ...(selectedSite ? { siteName: selectedSite.name, location: selectedSite.location || undefined } : {
        ...(manualSite.siteName.trim() ? { siteName: manualSite.siteName.trim() } : {}),
        ...(manualSite.location.trim() ? { location: manualSite.location.trim() } : {}),
      }),
      milestone: milestone.trim(),
      ...(sourceReference.trim() ? { sourceReference: sourceReference.trim() } : {}),
    }),
    onSuccess: async (review) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['sites'] }),
      ]);
      navigate(`/reviews/${encodeURIComponent(review.id)}`);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate();
  };

  const chooseSite = (id: string) => {
    setSelectedSiteId(id);
    if (id) setManualSite((current) => ({ ...current, siteId: '' }));
  };

  return (
    <div className="page-content new-review-page">
      <div className="back-link-row"><button type="button" className="back-button" onClick={() => navigate(-1)}><ArrowLeft size={14} />Back</button><span>/</span><span>New review</span></div>
      <PageHeader eyebrow="WORKSPACE / REVIEWS / NEW" title="Start an evidence review" description="Create a review record for a project milestone claim, then attach project and independent documents." />
      <Card className="new-review-stepper-card"><ReviewStepper ariaLabel="Evidence review steps" steps={[
        { label: 'CLAIM', status: 'active' },
        { label: 'EVIDENCE', status: 'pending' },
        { label: 'COMPARISON', status: 'pending' },
        { label: 'GENLAYER REVIEW', status: 'pending' },
        { label: 'RECORD', status: 'pending' },
      ]} /></Card>

      <div className="new-review-layout">
        <div className="new-review-main">
          <form onSubmit={handleSubmit}>
            <Card className="new-review-form-card">
              <div className="form-section-title"><span className="form-section-number">01</span><div><h2>Identify the site</h2><p>Choose a site returned by the API or enter the provided site reference.</p></div></div>
              {sitesQuery.isError && <div className="site-query-warning"><ApiErrorState error={sitesQuery.error} retry={() => void sitesQuery.refetch()} compact /><p>You can enter a site reference manually. Site existence will be validated by the backend when you create the review.</p></div>}
              {sites.length > 0 && (
                <div className="site-choice-grid">{sites.map((site) => <SiteChoice key={site.id} site={site} selected={selectedSiteId === site.siteId} onClick={() => chooseSite(selectedSiteId === site.siteId ? '' : site.siteId)} />)}</div>
              )}
              {sitesQuery.isLoading && <div className="sites-loading-note"><LoaderCircle size={14} className="spin" />Loading site registry…</div>}
              {(!selectedSite || sites.length === 0) && (
                <div className="manual-site-fields">
                  {sites.length > 0 && <div className="manual-site-divider"><span>OR ENTER A REFERENCE</span></div>}
                  <label className="field-label"><span>Site reference <b>*</b></span><input required value={manualSite.siteId} disabled={Boolean(selectedSite)} onChange={(event) => setManualSite({ ...manualSite, siteId: event.target.value })} placeholder="Use the reference supplied for this site" /></label>
                  <div className="field-two-col">
                    <label className="field-label"><span>Site name <em>Optional</em></span><input value={manualSite.siteName} disabled={Boolean(selectedSite) } onChange={(event) => setManualSite({ ...manualSite, siteName: event.target.value })} placeholder="As supplied" /></label>
                    <label className="field-label"><span>Location <em>Optional</em></span><span className="text-input-wrap"><MapPin size={14} /><input value={manualSite.location} disabled={Boolean(selectedSite)} onChange={(event) => setManualSite({ ...manualSite, location: event.target.value })} placeholder="Community or area" /></span></label>
                  </div>
                </div>
              )}
              {selectedSite && <div className="selected-site-confirm"><span className="selected-site-marker"><Building2 size={15} /></span><span><strong>{selectedSite.name}</strong><small>{selectedSite.siteId} · {selectedSite.location || 'Location not provided'}</small></span><button type="button" onClick={() => chooseSite('')}>Change</button></div>}
            </Card>

            <Card className="new-review-form-card">
              <div className="form-section-title"><span className="form-section-number">02</span><div><h2>Describe the milestone claim</h2><p>Record the exact project milestone that the evidence is intended to address.</p></div></div>
              <label className="field-label"><span>Milestone / close-out claim <b>*</b></span><textarea required rows={4} value={milestone} onChange={(event) => setMilestone(event.target.value)} placeholder="Use the project wording for the milestone claim. For example: the stated close-out milestone from the supplied project record." /></label>
              <label className="field-label"><span>Claim source reference <em>Optional</em></span><input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Reference as printed on the source record" /></label>
              <div className="form-info-note"><Info size={14} /><p>LotCheck stores the claim as review context. The claim is not treated as verified until documents are submitted and compared.</p></div>
            </Card>

            {mutation.isError && <ApiErrorState error={mutation.error} retry={() => mutation.mutate()} />}
            <div className="new-review-form-actions"><p>Creating a review does not submit anything to GenLayer. Evidence is added in the next step.</p><Button type="submit" disabled={!siteId || !milestone.trim() || mutation.isPending} icon={mutation.isPending ? <LoaderCircle size={14} className="spin" /> : <ArrowRight size={14} />}>{mutation.isPending ? 'Creating review…' : 'Create review'}</Button></div>
          </form>
        </div>

        <aside className="new-review-aside">
          <Card className="new-review-process-card"><div className="eyebrow">WHAT HAPPENS NEXT</div><h2>A review stays document-led.</h2><p>Start with a milestone claim, attach both evidence roles, compare the returned document fields, then submit for interpretation.</p><WorkflowModel compact /></Card>
          <Card className="new-review-note-card"><div className="new-review-note-icon"><FilePlus2 size={16} /></div><div><strong>Exact sources matter</strong><p>Use the source files supplied by the project and the separate independent reviewer. LotCheck does not create example evidence.</p></div></Card>
        </aside>
      </div>
      <DecisionDisclaimer compact />
    </div>
  );
}
