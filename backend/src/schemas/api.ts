import { z } from 'zod';
import { precheckResultSchema } from './domain.js';

function wellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(value);
}

const text = (max: number, min = 0) => z.string().trim().min(min).max(max).refine(wellFormedUnicode, 'Text contains unsupported control or Unicode characters.');
const siteCode = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dots, underscores, or hyphens.');
const safeSourceUrl = z.string().trim().url().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Source URL must be an HTTP or HTTPS URL without embedded credentials.');

export const createSiteSchema = z.object({
  siteCode,
  name: text(240, 1),
  location: text(240).nullable().optional(),
}).strict();

export const createReviewSchema = z.object({
  siteId: siteCode,
  milestone: text(500, 1),
  sourceReference: text(240).optional(),
  // Accepted for compatibility with the current form; the API resolves and stores site metadata from persistence.
  siteName: text(240).optional(),
  location: text(240).optional(),
  supersedesReviewId: z.string().uuid().optional(),
}).strict();

const submittedRoleSchema = z.enum(['PROJECT_CLOSEOUT', 'INDEPENDENT_EVIDENCE', 'PROJECT', 'INDEPENDENT']).transform((role) => {
  if (role === 'PROJECT') return 'PROJECT_CLOSEOUT' as const;
  if (role === 'INDEPENDENT') return 'INDEPENDENT_EVIDENCE' as const;
  return role;
});

export const uploadMetadataSchema = z.object({
  role: submittedRoleSchema,
  sourceUrl: safeSourceUrl.optional(),
}).strict();

export const listReviewsQuerySchema = z.object({
  status: z.enum(['DRAFT','READY_FOR_REVIEW','EVIDENCE_READY','COMPARISON_READY','SUBMITTING','SUBMITTED','CONSENSUS_PENDING','FINALIZING','FINALIZED','FAILED']).optional(),
  site_id: siteCode.optional(),
  siteId: siteCode.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const submitRequestSchema = z.object({}).strict();
export const precheckApiSchema = precheckResultSchema;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
