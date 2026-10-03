import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { inTransaction } from '../lib/db.js';
import { AppError, conflict } from '../lib/errors.js';
import type { AppConfig } from '../config/env.js';
import type { Actor, EvidenceDocument, EvidenceRole } from '../types/domain.js';
import { getReviewModel } from '../repositories/reviewRepository.js';
import { appendAuditEvent } from '../repositories/auditRepository.js';
import { sha256Hex } from '../lib/canonicalJson.js';
import { createDocumentStorage, type DocumentStorage } from './documentStorage.js';
import { DocumentProcessingError, failedNormalization, normalizeDocument, supportedMimeTypes } from './documentNormalization.js';

export type UploadDocumentInput = {
  reviewId: string;
  role: EvidenceRole;
  filename: string;
  declaredMime: string;
  bytes: Buffer;
  sourceUrl?: string;
  actor: Actor;
};

const roleLabel: Record<EvidenceRole, string> = {
  PROJECT_CLOSEOUT: 'Project close-out evidence',
  INDEPENDENT_EVIDENCE: 'Independent evidence',
};

function safeFilename(filename: string) {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return clean || 'uploaded-document';
}

export function assertEvidenceMutable(status: string, submittedAt: Date | string | null) {
  if (submittedAt || !['DRAFT', 'EVIDENCE_READY'].includes(status)) {
    throw conflict('EVIDENCE_LOCKED', 'Submitted evidence is immutable. Create a new review version before changing evidence.');
  }
}

export class DocumentService {
  private readonly storage: DocumentStorage;

  constructor(private readonly db: Pool, private readonly config: AppConfig, storage?: DocumentStorage) {
    this.storage = storage ?? createDocumentStorage(config);
  }

  async upload(input: UploadDocumentInput): Promise<EvidenceDocument> {
    if (!input.bytes.byteLength) throw new AppError(400, 'EMPTY_DOCUMENT', 'The uploaded document is empty.');
    if (input.bytes.byteLength > this.config.maxUploadBytes) throw new AppError(413, 'UPLOAD_TOO_LARGE', `The uploaded document exceeds the ${this.config.maxUploadBytes}-byte limit.`);
    const sha256 = sha256Hex(input.bytes);
    const declaredMime = input.declaredMime.toLowerCase().split(';')[0].trim();
    if (!supportedMimeTypes.includes(declaredMime as typeof supportedMimeTypes[number])) {
      throw new AppError(415, 'UNSUPPORTED_MIME', `The declared MIME type is not supported. Supported: ${supportedMimeTypes.join(', ')}.`);
    }

    let normalized;
    let processingStatus: 'READY' | 'FAILED' = 'READY';
    let processingErrorCode: string | null = null;
    let processingError: string | null = null;
    try {
      normalized = await normalizeDocument(input.bytes, declaredMime, sha256, this.config.maxExtractedTextChars);
    } catch (error) {
      if (!(error instanceof DocumentProcessingError)) throw new AppError(422, 'DOCUMENT_PROCESSING_FAILED', 'The configured document processor failed unexpectedly.');
      if (error.code === 'UNSUPPORTED_OR_MISMATCHED_MIME' || error.code === 'UNSAFE_DOCUMENT_FEATURE') {
        throw new AppError(415, error.code, error.message);
      }
      if (error.code === 'EMPTY_DOCUMENT') throw new AppError(400, error.code, error.message);
      processingStatus = 'FAILED';
      processingErrorCode = error.code;
      processingError = error.message.slice(0, 1000);
      normalized = failedNormalization(sha256, declaredMime as typeof supportedMimeTypes[number]);
    }

    const documentId = randomUUID();
    const storageReference = `${input.reviewId}/${documentId}`;
    const filename = safeFilename(input.filename);
    try {
      await this.storage.put(storageReference, input.bytes, normalized.mimeType);
    } catch {
      throw new AppError(503, 'DOCUMENT_STORAGE_FAILED', 'Private document storage failed; no document metadata was committed.');
    }

    try {
      await inTransaction(this.db, async (client) => {
        const reviewResult = await client.query<{ status: string; submitted_at: Date | null }>(
          'SELECT status, submitted_at FROM reviews WHERE id=$1::uuid FOR UPDATE', [input.reviewId],
        );
        if (!reviewResult.rowCount) throw new AppError(404, 'REVIEW_NOT_FOUND', 'The requested review does not exist.');
        const review = reviewResult.rows[0]!;
        assertEvidenceMutable(review.status, review.submitted_at);
        const existingRole = await client.query('SELECT 1 FROM documents WHERE review_id=$1::uuid AND role=$2', [input.reviewId, input.role]);
        if (existingRole.rowCount) throw conflict('EVIDENCE_ROLE_ALREADY_PRESENT', 'This review already contains a document for the selected evidence role. Create a new review version to replace it.');
        await client.query('DELETE FROM comparisons WHERE review_id=$1::uuid', [input.reviewId]);
        await client.query('UPDATE reviews SET precheck_result=NULL WHERE id=$1::uuid', [input.reviewId]);
        await client.query(
          `INSERT INTO documents
           (id, review_id, role, filename, mime_type, size, sha256, source, uploaded_by, processing_status, processing_error_code, processing_error, storage_reference)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [documentId, input.reviewId, input.role, filename, normalized.mimeType, input.bytes.byteLength, sha256, input.sourceUrl ?? null, input.actor.id, processingStatus, processingErrorCode, processingError, storageReference],
        );
        for (const [key, value] of Object.entries(normalized.normalized)) {
          const extractedField = normalized.fields.find((field) => field.key === key);
          const extractionSource = key === 'source_document_hash' ? 'SERVER_HASH' : (extractedField?.extractionStatus ?? 'NOT_EXTRACTED');
          await client.query(
            `INSERT INTO evidence_fields (id, document_id, field_name, field_value, extraction_source)
             VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), documentId, key, value, extractionSource],
          );
        }
        await appendAuditEvent(client, input.reviewId, 'EVIDENCE_UPLOADED', input.actor.id, {
          role: input.role,
          roleLabel: roleLabel[input.role],
          documentId,
          sha256,
          sizeBytes: input.bytes.byteLength,
          processingStatus,
          detail: processingStatus === 'READY' ? 'Original upload stored privately; extracted labels were normalized without executing the document.' : `Original upload stored privately with processing failure ${processingErrorCode}. The failed document cannot satisfy submission readiness.`,
        });
        if (processingStatus === 'FAILED') {
          await appendAuditEvent(client, input.reviewId, 'DOCUMENT_PROCESSING_FAILED', input.actor.id, {
            roleLabel: roleLabel[input.role],
            documentId,
            status: 'FAILED',
            detail: `${processingErrorCode}: ${processingError}`,
          });
        }
        const pair = await client.query<{ ready: boolean }>(
          `SELECT count(DISTINCT role) = 2 AS ready
           FROM documents WHERE review_id=$1::uuid AND processing_status='READY'`, [input.reviewId],
        );
        await client.query(
          `UPDATE reviews SET status = CASE WHEN status='DRAFT' AND $2::boolean THEN 'EVIDENCE_READY' ELSE status END
           WHERE id=$1::uuid`,
          [input.reviewId, pair.rows[0]?.ready === true],
        );
      });
    } catch (error) {
      await this.storage.delete(storageReference).catch(() => undefined);
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505') {
        throw conflict('EVIDENCE_ROLE_ALREADY_PRESENT', 'This review already contains a document for the selected evidence role.');
      }
      throw error;
    }

    const review = await getReviewModel(this.db, input.reviewId, this.config);
    const stored = review?.evidence?.find((document) => document.id === documentId);
    if (!stored) throw new Error('Document row was committed but could not be reloaded from persistent storage.');
    return stored;
  }

  async list(reviewId: string) {
    const review = await getReviewModel(this.db, reviewId, this.config);
    return review?.evidence ?? [];
  }

  async getContent(documentId: string) {
    const result = await this.db.query<{ storage_reference: string; mime_type: string; filename: string; processing_status: string }>(
      'SELECT storage_reference, mime_type, filename, processing_status FROM documents WHERE id=$1::uuid', [documentId],
    );
    if (!result.rowCount) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'The requested document does not exist.');
    const row = result.rows[0]!;
    if (row.processing_status !== 'READY' && row.processing_status !== 'FAILED') throw new Error('Persisted document has an invalid processing state.');
    const bytes = await this.storage.get(row.storage_reference);
    return { bytes, mimeType: row.mime_type, filename: row.filename };
  }

  async close() { await this.storage.close?.(); }
}
