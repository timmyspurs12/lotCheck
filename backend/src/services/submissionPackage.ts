import { randomUUID } from 'node:crypto';
import { hashCanonicalJson } from '../lib/canonicalJson.js';
import { evidencePackageSchema, type EvidencePackage } from '../types/evidencePackage.js';
import type { EvidenceDocument, ReviewReadModel } from '../types/domain.js';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export function buildEvidencePackage(review: ReviewReadModel, documents: EvidenceDocument[], config: Pick<AppConfig, 'maxPackageBytes'>, submittedAt = new Date().toISOString()) {
  const project = documents.find((document) => document.role === 'PROJECT_CLOSEOUT');
  const independent = documents.find((document) => document.role === 'INDEPENDENT_EVIDENCE');
  if (!project || !independent) throw new AppError(422, 'EVIDENCE_PAIR_REQUIRED', 'Exactly one project close-out document and one independent evidence document are required.');
  const payload: EvidencePackage = evidencePackageSchema.parse({
    schema_version: 1,
    review_id: review.id,
    record_id: randomUUID(),
    site: {
      site_id: review.siteId,
      site_name: review.siteName ?? review.siteId,
      location: review.location,
    },
    milestone: review.milestone,
    source_reference: review.sourceReference,
    review_version: review.version,
    submission: { submitted_at: submittedAt },
    policy: {
      version: review.policyVersion,
      scope: 'DOCUMENTARY_ONLY',
      acceptance_standard: 'ACCEPT may be returned only when the two distinct, identified source records appear sufficiently consistent on the documentary fields and comparisons under this policy. This is not a safety, remediation-quality, sampling, laboratory-validity, contamination-absence, or regulatory-compliance certification.',
    },
    evidence: [project, independent].map((document) => ({
      document_id: document.id,
      role: document.role,
      sha256: document.sha256,
      mime_type: document.mimeType,
      size_bytes: document.size,
      normalized_fields: document.normalizedEvidence,
    })),
    comparisons: review.comparison?.fields ?? [],
  });
  const result = hashCanonicalJson(payload);
  if (Buffer.byteLength(result.serialized, 'utf8') > config.maxPackageBytes) {
    throw new AppError(413, 'EVIDENCE_PACKAGE_TOO_LARGE', 'The canonical evidence package exceeds the configured maximum size.');
  }
  return { package: payload, packageJson: result.serialized, packageHash: result.sha256 };
}
