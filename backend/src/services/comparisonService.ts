import { comparisonFieldSchema } from '../schemas/domain.js';
import type { ComparisonField, EvidenceDocument, PrecheckResult } from '../types/domain.js';

type SiteIdentity = { siteCode: string; name: string; location: string | null };
type ReviewIdentity = { reviewId: string; siteCode: string; milestone: string };

function normalizedText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(normalizedText(value).split(' ').filter(Boolean));
}

function similarity(left: string | null | undefined, right: string | null | undefined) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function compareExactOrText(left: string | null | undefined, right: string | null | undefined): ComparisonField['match'] {
  const a = normalizedText(left);
  const b = normalizedText(right);
  if (!a || !b) return 'MISSING';
  if (a === b) return 'EXACT_MATCH';
  if (a.includes(b) || b.includes(a) || similarity(a, b) >= 0.75) return 'PARTIAL_MATCH';
  return 'CONFLICT';
}

function identityFor(document: EvidenceDocument, site: SiteIdentity): 'MATCH' | 'CONFLICT' | 'UNRESOLVED' {
  const normalized = document.normalizedEvidence;
  const documentSiteId = normalizedText(normalized.site_id);
  const targetSiteId = normalizedText(site.siteCode);
  if (documentSiteId) return documentSiteId === targetSiteId ? 'MATCH' : 'CONFLICT';
  const name = normalizedText(normalized.site_name);
  const location = normalizedText(normalized.location);
  const expectedName = normalizedText(site.name);
  const expectedLocation = normalizedText(site.location);
  if (name && location && expectedName && expectedLocation) {
    return name === expectedName && location === expectedLocation ? 'MATCH' : 'CONFLICT';
  }
  return 'UNRESOLVED';
}

function outcomeForReason(reasonCode: string): 'DISPUTED' | 'INSUFFICIENT' {
  return ['SITE_IDENTITY_CONFLICT', 'MILESTONE_CONFLICT'].includes(reasonCode) ? 'DISPUTED' : 'INSUFFICIENT';
}

function precheckFailure(reasonCode: PrecheckResult['reasonCode'] & string, detail: string): PrecheckResult {
  return { eligible: false, decision: outcomeForReason(reasonCode), reasonCode: reasonCode as PrecheckResult['reasonCode'], detail };
}

export function validateEvidencePair(review: ReviewIdentity, site: SiteIdentity, documents: EvidenceDocument[]): PrecheckResult {
  const project = documents.filter((document) => document.role === 'PROJECT_CLOSEOUT');
  const independent = documents.filter((document) => document.role === 'INDEPENDENT_EVIDENCE');
  if (project.length === 0) return precheckFailure('MISSING_PROJECT_DOCUMENT', 'A project close-out document is required.');
  if (independent.length === 0) return precheckFailure('MISSING_INDEPENDENT_DOCUMENT', 'An independent evidence document is required.');
  if (project.length !== 1 || independent.length !== 1 || documents.length !== 2) return precheckFailure('INSUFFICIENT_EVIDENCE_FIELDS', 'The review must contain exactly one document in each evidence role.');
  const pair = [project[0]!, independent[0]!];
  if (pair.some((document) => document.processingStatus !== 'READY' || !/^[a-f0-9]{64}$/.test(document.sha256))) {
    return precheckFailure('DOCUMENT_PROCESSING_FAILED', 'Both documents must be processed successfully and have server-calculated SHA-256 fingerprints.');
  }
  if (pair[0]!.sha256 === pair[1]!.sha256) {
    return precheckFailure('DUPLICATE_DOCUMENT_HASH', 'The project and independent roles contain identical file bytes; the same file cannot serve as independent corroboration.');
  }

  const identities = pair.map((document) => identityFor(document, site));
  if (identities.includes('CONFLICT')) return precheckFailure('SITE_IDENTITY_CONFLICT', 'A document contains an explicit site identity that conflicts with the registered site reference.');
  if (identities.includes('UNRESOLVED')) return precheckFailure('SITE_IDENTITY_UNRESOLVED', 'Both documents must identify the registered site by site code or by matching site name and location.');

  const expectedMilestone = normalizedText(review.milestone);
  if (!expectedMilestone) return precheckFailure('MILESTONE_UNRESOLVED', 'The review has no milestone claim to compare.');
  const milestoneValues = pair.map((document) => document.normalizedEvidence.milestone);
  if (milestoneValues.some((value) => !normalizedText(value))) return precheckFailure('MILESTONE_UNRESOLVED', 'Both documents must identify the intended milestone.');
  for (const value of milestoneValues) {
    const overlap = similarity(value, review.milestone);
    if (overlap < 0.25) return precheckFailure('MILESTONE_CONFLICT', 'A document states a materially different milestone from the review claim.');
    if (overlap < 0.6) return precheckFailure('MILESTONE_UNRESOLVED', 'Milestone wording is too ambiguous for a deterministic identity check.');
  }

  const usableFields = pair.map((document) => {
    const evidence = document.normalizedEvidence;
    return Boolean(evidence.site_id || (evidence.site_name && evidence.location)) && Boolean(evidence.milestone);
  });
  if (usableFields.some((usable) => !usable)) return precheckFailure('INSUFFICIENT_EVIDENCE_FIELDS', 'The normalized evidence does not contain enough site and milestone identity fields.');
  return { eligible: true, detail: 'Deterministic checks passed; GenLayer interpretation is still required for a documentary outcome.' };
}

function oppositeFindingSignals(left: string, right: string) {
  const positivePatterns = [
    /\bexceed(?:s|ed|ing)?\s+(?:the\s+)?(?:target|limit|threshold)\b/i,
    /\babove\s+(?:the\s+)?(?:target|limit|threshold)\b/i,
    /\bcontamination\s+(?:was\s+)?detected\b/i,
    /\b(?:failed|non[- ]compliant)\b/i,
  ];
  const negativePatterns = [
    /\bwithin\s+(?:the\s+)?(?:target|limit|threshold)\b/i,
    /\bbelow\s+(?:the\s+)?(?:target|limit|threshold)\b/i,
    /\bnot\s+detected\b/i,
    /\b(?:passed|compliant)\b/i,
  ];
  const hasPositive = (value: string) => positivePatterns.some((pattern) => pattern.test(value));
  const hasNegative = (value: string) => negativePatterns.some((pattern) => pattern.test(value));
  return (hasPositive(left) && hasNegative(right)) || (hasNegative(left) && hasPositive(right));
}

function field(key: string, label: string, left: string | null, right: string | null, match: ComparisonField['match'], whyItMatters: string | null): ComparisonField {
  return comparisonFieldSchema.parse({ key, label, projectValue: left, independentValue: right, match, whyItMatters });
}

export function compareDocuments(project: EvidenceDocument | null, independent: EvidenceDocument | null): ComparisonField[] {
  const p = project?.normalizedEvidence;
  const i = independent?.normalizedEvidence;
  const output: ComparisonField[] = [];
  const add = (key: string, label: string, left: string | null, right: string | null, why: string, match = compareExactOrText(left, right)) => {
    output.push(field(key, label, left, right, match, why));
  };

  add('SITE_ID', 'Site ID', p?.site_id ?? null, i?.site_id ?? null, 'Site identity is a review boundary; names and locations are retained separately when a site code is absent.');
  add('SITE_NAME', 'Site name', p?.site_name ?? null, i?.site_name ?? null, 'Site names are compared as extracted labels and are not substituted for a registered site code.');
  add('MILESTONE', 'Milestone', p?.milestone ?? null, i?.milestone ?? null, 'The milestone text is compared as supplied; the configured contract may assess its documentary relevance.');
  add('LOCATION', 'Location', p?.location ?? null, i?.location ?? null, 'Location is a documentary identity field, not an assessment of physical conditions.');
  add('REPORT_REFERENCE', 'Report reference', p?.report_reference ?? null, i?.report_reference ?? null, 'References from different source documents may identify different records and are not treated as conflicts by themselves.', p?.report_reference && i?.report_reference ? 'NOT_COMPARABLE' : 'MISSING');
  add('REPORT_DATE', 'Report date', p?.report_date ?? null, i?.report_date ?? null, 'Report dates can differ by document purpose; date differences are not a close-out finding.', p?.report_date && i?.report_date ? 'NOT_COMPARABLE' : 'MISSING');
  add('FINDING_REFERENCE', 'Finding reference', p?.finding_reference ?? null, i?.finding_reference ?? null, 'A differing extracted finding or sample reference can be material and is sent to the contract for interpretation.');
  let findingsMatch: ComparisonField['match'] = compareExactOrText(p?.reported_findings, i?.reported_findings);
  if (p?.reported_findings && i?.reported_findings && oppositeFindingSignals(p.reported_findings, i.reported_findings)) findingsMatch = 'CONFLICT';
  else if (p?.reported_findings && i?.reported_findings && findingsMatch === 'CONFLICT') findingsMatch = 'PARTIAL_MATCH';
  add('REPORTED_FINDINGS', 'Reported findings', p?.reported_findings ?? null, i?.reported_findings ?? null, 'Findings are compared as extracted; only explicit language signals are marked as deterministic conflicts.', findingsMatch);
  add('SOURCE_DOCUMENT_HASH', 'SHA-256 fingerprint', project?.sha256 ?? null, independent?.sha256 ?? null, 'Hashes are calculated from actual upload bytes; identical fingerprints are rejected as duplicate source files.', project?.sha256 && independent?.sha256 ? (project.sha256 === independent.sha256 ? 'EXACT_MATCH' : 'NOT_COMPARABLE') : 'MISSING');
  return output;
}
