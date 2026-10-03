import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type Queryable = Pool | PoolClient;

export async function appendAuditEvent(
  db: Queryable,
  reviewId: string,
  eventType: string,
  actor: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO audit_events (id, review_id, event_type, actor, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [randomUUID(), reviewId, eventType, actor, JSON.stringify(metadata)],
  );
}
