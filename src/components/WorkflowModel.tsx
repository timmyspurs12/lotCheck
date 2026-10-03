import { ArrowDown, FileCheck2, FileText, GitCompareArrows, Layers3 } from 'lucide-react';

const stages = [
  { title: 'Project milestone claim', caption: 'Recorded as review context', icon: FileText },
  { title: 'Evidence pair', caption: 'Project close-out + independent sources', icon: FileCheck2 },
  { title: 'Document comparison', caption: 'Compare fields returned by the service', icon: GitCompareArrows },
  { title: 'GenLayer interpretation', caption: 'Submitted for the configured review', icon: Layers3 },
  { title: 'Recorded outcome', caption: 'ACCEPT · DISPUTED · INSUFFICIENT', icon: FileCheck2 },
];

export function WorkflowModel({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`workflow-model ${compact ? 'workflow-model-compact' : ''}`} aria-label="LotCheck evidence review sequence">
      {stages.map(({ title, caption, icon: Icon }, index) => (
        <div className="workflow-stage-wrap" key={title}>
          <div className="workflow-stage">
            <span className="workflow-stage-index">0{index + 1}</span>
            <span className="workflow-stage-icon"><Icon size={15} strokeWidth={1.8} /></span>
            <span className="workflow-stage-copy"><strong>{title}</strong><small>{caption}</small></span>
          </div>
          {index < stages.length - 1 && <span className="workflow-connector" aria-hidden="true"><span /><ArrowDown size={13} /></span>}
        </div>
      ))}
    </div>
  );
}
