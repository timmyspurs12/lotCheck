import { FileSearch } from 'lucide-react';
import type { EvidenceDocument, EvidenceRole } from '../api/types';
import { EvidenceDocumentCard } from './EvidenceDocumentCard';

function RoleEvidencePanel({ role, documents }: { role: EvidenceRole; documents: EvidenceDocument[] }) {
  const project = role === 'PROJECT';
  return (
    <section className={`split-evidence-panel ${project ? 'split-evidence-project' : 'split-evidence-independent'}`}>
      <div className="split-evidence-panel-head">
        <div><span className="split-evidence-kicker">{project ? 'SIDE A' : 'SIDE B'}</span><h3>{project ? 'Project close-out evidence' : 'Independent evidence'}</h3></div>
        <span className={`role-indicator ${project ? 'role-indicator-project' : ''}`} aria-hidden="true" />
      </div>
      {documents.length ? <div className="split-evidence-documents">{documents.map((document) => <EvidenceDocumentCard key={document.id} document={document} compact />)}</div> : (
        <div className="split-evidence-empty"><FileSearch size={15} /><span>{project ? 'No project close-out document returned.' : 'No independent document returned.'}</span></div>
      )}
    </section>
  );
}

export function EvidencePairPanels({ documents }: { documents: EvidenceDocument[] }) {
  const project = documents.filter((document) => document.role === 'PROJECT');
  const independent = documents.filter((document) => document.role === 'INDEPENDENT');
  return (
    <div className="split-evidence-panels">
      <RoleEvidencePanel role="PROJECT" documents={project} />
      <RoleEvidencePanel role="INDEPENDENT" documents={independent} />
    </div>
  );
}
