import { z } from 'zod';

export const decisionSchema = z.enum(['ACCEPT', 'DISPUTED', 'INSUFFICIENT']);
export const evidenceRoleSchema = z.enum(['PROJECT_CLOSEOUT', 'INDEPENDENT_EVIDENCE']);
export const reviewStateSchema = z.enum([
  'DRAFT',
  'EVIDENCE_READY',
  'COMPARISON_READY',
  'SUBMITTING',
  'SUBMITTED',
  'CONSENSUS_PENDING',
  'FINALIZING',
  'FINALIZED',
  'FAILED',
]);
export const comparisonMatchSchema = z.enum(['EXACT_MATCH', 'PARTIAL_MATCH', 'CONFLICT', 'MISSING', 'NOT_COMPARABLE']);

export const normalizedEvidenceSchema = z.object({
  site_id: z.string().nullable(),
  site_name: z.string().nullable(),
  milestone: z.string().nullable(),
  location: z.string().nullable(),
  report_reference: z.string().nullable(),
  report_date: z.string().nullable(),
  issuer: z.string().nullable(),
  finding_reference: z.string().nullable(),
  reported_findings: z.string().nullable(),
  source_document_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const comparisonFieldSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(140),
  projectValue: z.string().nullable(),
  independentValue: z.string().nullable(),
  match: comparisonMatchSchema,
  whyItMatters: z.string().nullable(),
}).strict();

export const genLayerModelResultSchema = z.object({
  decision: decisionSchema,
  reason_code: z.enum([
    'DOCUMENTARY_CONSISTENT',
    'MATERIAL_CONTRADICTION',
    'SITE_IDENTITY_CONFLICT',
    'MILESTONE_CONFLICT',
    'INSUFFICIENT_EVIDENCE_FIELDS',
  ]),
  material_conflicts: z.array(z.enum(['SITE_ID', 'SITE_NAME', 'MILESTONE', 'LOCATION', 'REPORT_REFERENCE', 'FINDING_REFERENCE', 'REPORTED_FINDINGS'])).max(12),
}).strict().superRefine((value, ctx) => {
  const conflicts = value.material_conflicts.length;
  if (new Set(value.material_conflicts).size !== conflicts) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Material conflict codes must be unique.' });
  if (value.decision === 'ACCEPT' && (value.reason_code !== 'DOCUMENTARY_CONSISTENT' || conflicts > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ACCEPT requires documentary consistency and no material conflicts.' });
  if (value.decision === 'DISPUTED' && (!['MATERIAL_CONTRADICTION','SITE_IDENTITY_CONFLICT','MILESTONE_CONFLICT'].includes(value.reason_code) || conflicts === 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DISPUTED requires a conflict reason and at least one material conflict.' });
  if (value.decision === 'INSUFFICIENT' && value.reason_code !== 'INSUFFICIENT_EVIDENCE_FIELDS') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INSUFFICIENT requires the configured insufficient-evidence reason.' });
  if (value.decision === 'DISPUTED' && value.reason_code === 'SITE_IDENTITY_CONFLICT' && !value.material_conflicts.some((key) => ['SITE_ID', 'SITE_NAME', 'LOCATION'].includes(key))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SITE_IDENTITY_CONFLICT must identify a site identity field.' });
  if (value.decision === 'DISPUTED' && value.reason_code === 'MILESTONE_CONFLICT' && !value.material_conflicts.includes('MILESTONE')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MILESTONE_CONFLICT must identify the milestone field.' });
});

export const precheckReasonSchema = z.enum([
  'MISSING_PROJECT_DOCUMENT',
  'MISSING_INDEPENDENT_DOCUMENT',
  'DOCUMENT_PROCESSING_FAILED',
  'SITE_IDENTITY_UNRESOLVED',
  'SITE_IDENTITY_CONFLICT',
  'MILESTONE_UNRESOLVED',
  'MILESTONE_CONFLICT',
  'INSUFFICIENT_EVIDENCE_FIELDS',
  'DUPLICATE_DOCUMENT_HASH',
]);

export const onchainRecordSchema = z.object({
  record_id: z.string().uuid(),
  review_id: z.string().uuid(),
  site_id: z.string().min(1).max(100),
  milestone: z.string().min(1).max(500),
  evidence_package_hash: z.string().regex(/^[a-f0-9]{64}$/),
  project_document_hash: z.string().regex(/^[a-f0-9]{64}$/),
  independent_document_hash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: decisionSchema,
  reason_code: z.enum(['DOCUMENTARY_CONSISTENT','MATERIAL_CONTRADICTION','SITE_IDENTITY_CONFLICT','MILESTONE_CONFLICT','INSUFFICIENT_EVIDENCE_FIELDS']),
  summary: z.string().min(1).max(500),
  material_conflicts: z.array(z.enum(['SITE_ID', 'SITE_NAME', 'MILESTONE', 'LOCATION', 'REPORT_REFERENCE', 'FINDING_REFERENCE', 'REPORTED_FINDINGS'])).max(12),
  evidence_references: z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(2),
  policy_version: z.string().min(1).max(100),
  timestamp: z.string().datetime({ offset: true }),
  decision_source: z.literal('GENLAYER_INTERPRETATION'),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.material_conflicts).size !== value.material_conflicts.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Material conflict codes must be unique.' });
  if (value.decision === 'ACCEPT' && (value.reason_code !== 'DOCUMENTARY_CONSISTENT' || value.material_conflicts.length > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ACCEPT must have no material conflicts.' });
  if (value.decision === 'DISPUTED' && (!['MATERIAL_CONTRADICTION','SITE_IDENTITY_CONFLICT','MILESTONE_CONFLICT'].includes(value.reason_code) || value.material_conflicts.length === 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DISPUTED must reference a material documentary conflict.' });
  if (value.decision === 'INSUFFICIENT' && value.reason_code !== 'INSUFFICIENT_EVIDENCE_FIELDS') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'INSUFFICIENT must use the configured insufficient-evidence reason.' });
  if (value.decision === 'DISPUTED' && value.reason_code === 'SITE_IDENTITY_CONFLICT' && !value.material_conflicts.some((key) => ['SITE_ID', 'SITE_NAME', 'LOCATION'].includes(key))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SITE_IDENTITY_CONFLICT must identify a site identity field.' });
  if (value.decision === 'DISPUTED' && value.reason_code === 'MILESTONE_CONFLICT' && !value.material_conflicts.includes('MILESTONE')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MILESTONE_CONFLICT must identify the milestone field.' });
});

export const precheckResultSchema = z.object({
  eligible: z.boolean(),
  decision: z.enum(['DISPUTED', 'INSUFFICIENT']).optional(),
  reasonCode: precheckReasonSchema.optional(),
  detail: z.string().max(500),
}).strict();
