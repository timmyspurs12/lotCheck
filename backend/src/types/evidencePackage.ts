import { z } from 'zod';
import { comparisonFieldSchema, evidenceRoleSchema, normalizedEvidenceSchema } from '../schemas/domain.js';

export const evidencePackageSchema = z.object({
  schema_version: z.literal(1),
  review_id: z.string().uuid(),
  record_id: z.string().uuid(),
  site: z.object({
    site_id: z.string().min(1).max(100),
    site_name: z.string().min(1).max(240),
    location: z.string().max(240).nullable(),
  }).strict(),
  milestone: z.string().min(1).max(500),
  source_reference: z.string().max(240).nullable(),
  review_version: z.number().int().positive(),
  submission: z.object({ submitted_at: z.string().datetime({ offset: true }) }).strict(),
  policy: z.object({
    version: z.string().min(1).max(100),
    scope: z.literal('DOCUMENTARY_ONLY'),
    acceptance_standard: z.string().max(500),
  }).strict(),
  evidence: z.array(z.object({
    document_id: z.string().uuid(),
    role: evidenceRoleSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mime_type: z.string().max(120),
    size_bytes: z.number().int().positive(),
    normalized_fields: normalizedEvidenceSchema,
  }).strict()).length(2),
  comparisons: z.array(comparisonFieldSchema).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  const roles = value.evidence.map((document) => document.role).sort();
  if (roles[0] !== 'INDEPENDENT_EVIDENCE' || roles[1] !== 'PROJECT_CLOSEOUT') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Package requires exactly one document per evidence role.', path: ['evidence'] });
  }
  for (const document of value.evidence) {
    if (document.sha256 !== document.normalized_fields.source_document_hash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Normalized source hash must match actual document SHA-256.', path: ['evidence'] });
    }
  }
});

export type EvidencePackage = z.infer<typeof evidencePackageSchema>;
