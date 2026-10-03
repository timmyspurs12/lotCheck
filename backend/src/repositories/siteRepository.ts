import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../types/domain.js';
import { conflict, notFound } from '../lib/errors.js';

export type SiteRow = {
  id: string;
  site_code: string;
  name: string;
  location: string | null;
  current_status: string | null;
  created_at: Date | string;
  milestone: string | null;
  evidence_state: string | null;
  project_evidence_count: number | string | null;
  independent_evidence_count: number | string | null;
  last_review_at: Date | string | null;
};

export type SiteView = {
  id: string;
  siteId: string;
  name: string;
  location: string | null;
  milestone: string | null;
  evidenceState: string | null;
  projectEvidenceCount: number;
  independentEvidenceCount: number;
  lastReviewAt: string | null;
  currentStatus: string | null;
  createdAt: string;
};

const siteSummarySql = `
  WITH latest AS (
    SELECT DISTINCT ON (site_id) id, site_id, milestone, status, created_at
    FROM reviews
    ORDER BY site_id, created_at DESC, id DESC
  ), evidence_counts AS (
    SELECT d.review_id,
      count(*) FILTER (WHERE d.role = 'PROJECT_CLOSEOUT' AND d.processing_status = 'READY') AS project_count,
      count(*) FILTER (WHERE d.role = 'INDEPENDENT_EVIDENCE' AND d.processing_status = 'READY') AS independent_count
    FROM documents d
    GROUP BY d.review_id
  )
  SELECT s.id, s.site_code, s.name, s.location, s.current_status, s.created_at,
    l.milestone, l.created_at AS last_review_at,
    COALESCE(ec.project_count, 0) AS project_evidence_count,
    COALESCE(ec.independent_count, 0) AS independent_evidence_count,
    CASE
      WHEN l.id IS NULL THEN NULL
      WHEN COALESCE(ec.project_count, 0) = 1 AND COALESCE(ec.independent_count, 0) = 1 THEN 'PAIR_PRESENT'
      WHEN COALESCE(ec.project_count, 0) > 0 OR COALESCE(ec.independent_count, 0) > 0 THEN 'PARTIAL_PAIR'
      ELSE 'NO_EVIDENCE'
    END AS evidence_state
  FROM sites s
  LEFT JOIN latest l ON l.site_id = s.id
  LEFT JOIN evidence_counts ec ON ec.review_id = l.id
`;

function asCount(value: number | string | null) { return value == null ? 0 : Number(value); }
function iso(value: Date | string | null) { return value == null ? null : new Date(value).toISOString(); }

export function mapSite(row: SiteRow): SiteView {
  return {
    id: row.id,
    siteId: row.site_code,
    name: row.name,
    location: row.location,
    milestone: row.milestone,
    evidenceState: row.evidence_state,
    projectEvidenceCount: asCount(row.project_evidence_count),
    independentEvidenceCount: asCount(row.independent_evidence_count),
    lastReviewAt: iso(row.last_review_at),
    currentStatus: row.current_status,
    createdAt: iso(row.created_at)!,
  };
}

export async function listSites(db: Pool) {
  const result = await db.query<SiteRow>(`${siteSummarySql} ORDER BY s.created_at DESC, s.id`);
  return result.rows.map(mapSite);
}

export async function getSite(db: Pool | PoolClient, idOrCode: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idOrCode);
  const query = isUuid
    ? `${siteSummarySql} WHERE s.id = $1::uuid OR s.site_code = $2`
    : `${siteSummarySql} WHERE s.site_code = $1`;
  const result = await db.query<SiteRow>(query, isUuid ? [idOrCode, idOrCode] : [idOrCode]);
  if (!result.rowCount) throw notFound('The requested site does not exist in the persisted site registry.');
  return mapSite(result.rows[0]!);
}

export async function createSite(
  db: Pool,
  input: { siteCode: string; name: string; location?: string | null },
  actor: Actor,
  source: 'API' | 'REVIEWER_SUPPLIED' = 'API',
) {
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO sites (id, site_code, name, location, created_by, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, input.siteCode, input.name, input.location ?? null, actor.id, source],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('SITE_CODE_EXISTS', 'A site with this site code is already registered.');
    throw error;
  }
  return getSite(db, id);
}

export async function getSiteByCodeOrIdForReview(db: Pool | PoolClient, siteId: string) {
  const result = await db.query<{ id: string; site_code: string; name: string; location: string | null }>(
    `SELECT id, site_code, name, location FROM sites WHERE site_code = $1 OR id = $2::uuid LIMIT 1`,
    [siteId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId) ? siteId : '00000000-0000-0000-0000-000000000000'],
  );
  return result.rows[0] ?? null;
}

export async function createOrGetReviewerSite(
  db: PoolClient,
  input: { siteId: string; siteName?: string; location?: string },
  actor: Actor,
) {
  const existing = await getSiteByCodeOrIdForReview(db, input.siteId);
  if (existing) return existing;
  const site = {
    id: randomUUID(),
    siteCode: input.siteId,
    name: input.siteName?.trim() || input.siteId,
    location: input.location?.trim() || null,
  };
  await db.query(
    `INSERT INTO sites (id, site_code, name, location, created_by, source)
     VALUES ($1, $2, $3, $4, $5, 'REVIEWER_SUPPLIED')
     ON CONFLICT (site_code) DO NOTHING`,
    [site.id, site.siteCode, site.name, site.location, actor.id],
  );
  const resolved = await getSiteByCodeOrIdForReview(db, input.siteId);
  if (!resolved) throw new Error('Site registration failed without a persisted site row.');
  return resolved;
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}
