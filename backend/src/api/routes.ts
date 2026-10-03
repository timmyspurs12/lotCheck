import type { FastifyInstance, FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import type { Database } from '../lib/db.js';
import { AppError, validationError } from '../lib/errors.js';
import { createSiteSchema, createReviewSchema, listReviewsQuerySchema, uploadMetadataSchema, submitRequestSchema } from '../schemas/api.js';
import { mapDocument, mapRecord, mapReview, mapStatus } from './serializers.js';
import type { ReviewService } from '../services/reviewService.js';
import type { DocumentService } from '../services/documentService.js';
import type { GenLayerAdapter } from '../services/genlayerAdapter.js';
import type { Actor } from '../types/domain.js';
import { getDocumentById } from '../repositories/reviewRepository.js';

const emptyObjectSchema = z.object({}).strict();
const uuidParams = z.object({ id: z.string().uuid() }).strict();
const reviewParams = z.object({ reviewId: z.string().uuid() }).strict();
const siteParams = z.object({ siteId: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/) }).strict();

export type RouteDependencies = {
  config: AppConfig;
  db: Database;
  reviews: ReviewService;
  documents: DocumentService;
  genlayer: GenLayerAdapter;
};

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    throw validationError(`${label} validation failed.`, details);
  }
  return result.data;
}

function validateEmptyQuery(request: FastifyRequest) { parse(emptyObjectSchema, request.query, 'Query'); }
function validateEmptyBody(request: FastifyRequest) { if (request.body !== undefined) parse(emptyObjectSchema, request.body, 'Request body'); }

function actorFor(request: FastifyRequest): Actor {
  if (!request.actor) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A verified reviewer identity is required.');
  return request.actor;
}

async function readMultipart(request: FastifyRequest, maxBytes: number) {
  const parts = request.parts({ limits: { files: 1, fields: 2, parts: 3, fileSize: maxBytes, fieldNameSize: 80, fieldSize: 2048, headerPairs: 50 } });
  let file: { filename: string; mimeType: string; bytes: Buffer } | null = null;
  let role: string | undefined;
  let sourceUrl: string | undefined;
  const fieldNames = new Set<string>();
  for await (const part of parts) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || file) throw new AppError(400, 'INVALID_MULTIPART', 'Exactly one file field named "file" is accepted.');
      const bytes = await part.toBuffer();
      if (part.file.truncated || bytes.byteLength > maxBytes) throw new AppError(413, 'UPLOAD_TOO_LARGE', `The uploaded file exceeds the ${maxBytes}-byte limit.`);
      file = { filename: part.filename, mimeType: part.mimetype, bytes };
    } else {
      if (fieldNames.has(part.fieldname)) throw new AppError(400, 'INVALID_MULTIPART', `Multipart field "${part.fieldname}" was supplied more than once.`);
      fieldNames.add(part.fieldname);
      if (part.fieldname === 'role') role = String(part.value);
      else if (part.fieldname === 'sourceUrl') sourceUrl = String(part.value);
      else throw new AppError(400, 'INVALID_MULTIPART', `Multipart field "${part.fieldname}" is not supported.`);
    }
  }
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'A document file is required.');
  const metadata = parse(uploadMetadataSchema, { role, sourceUrl }, 'Evidence metadata');
  return { file, metadata };
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDependencies) {
  await app.register(multipart, {
    limits: { files: 1, fields: 2, parts: 3, fileSize: deps.config.maxUploadBytes, fieldNameSize: 80, fieldSize: 2048, headerPairs: 50 },
    throwFileSizeLimit: true,
  });

  app.get('/api/health', { config: { public: true } }, async (request) => {
    validateEmptyQuery(request);
    const checkedAt = new Date().toISOString();
    let database: { status: string; connected: boolean; detail: string | null };
    let lastTransaction: { transaction_hash: string; consensus_state: string | null } | null = null;
    try {
      await deps.db.query('SELECT 1');
      database = { status: 'CONNECTED', connected: true, detail: 'PostgreSQL responded to the backend health check.' };
      const result = await deps.db.query<{ transaction_hash: string; consensus_state: string | null }>(
        `SELECT transaction_hash, consensus_state FROM decisions ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => null);
      lastTransaction = result?.rows[0] ?? null;
    } catch {
      database = { status: 'DISCONNECTED', connected: false, detail: 'PostgreSQL did not respond to the health check.' };
    }
    const genlayer = await deps.genlayer.health();
    return {
      applicationApi: { status: 'OK', connected: true, detail: 'LotCheck backend health handler responded.' },
      database,
      documentProcessing: { status: 'READY', connected: true, detail: 'PDF, DOCX, UTF-8 text, CSV and JSON label extraction are configured; uploaded files are treated as data and are never executed.' },
      genlayer: {
        ...genlayer,
        lastSuccessfulTransaction: lastTransaction?.transaction_hash ?? null,
        consensusState: lastTransaction?.consensus_state ?? null,
      },
      checkedAt,
    };
  });

  app.get('/api/sites', async (request) => {
    validateEmptyQuery(request);
    return { sites: await deps.reviews.listSites() };
  });
  app.post('/api/sites', async (request, reply) => {
    validateEmptyQuery(request);
    const input = parse(createSiteSchema, request.body, 'Site');
    const site = await deps.reviews.createSite(input, actorFor(request));
    return reply.code(201).send({ site });
  });
  app.get('/api/sites/:siteId', async (request) => {
    validateEmptyQuery(request);
    const { siteId } = parse(siteParams, request.params, 'Site identifier');
    const site = await deps.reviews.getSite(siteId);
    return { site };
  });

  app.get('/api/reviews', async (request) => {
    const query = parse(listReviewsQuerySchema, request.query, 'Review query');
    const reviews = await deps.reviews.listReviews({
      status: query.status,
      siteId: query.site_id ?? query.siteId,
      search: query.search,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    return { reviews: reviews.map(mapReview) };
  });
  app.post('/api/reviews', async (request, reply) => {
    validateEmptyQuery(request);
    const input = parse(createReviewSchema, request.body, 'Review');
    const review = await deps.reviews.createReview(input, actorFor(request));
    return reply.code(201).send({ review: mapReview(review) });
  });
  app.get('/api/reviews/:reviewId', async (request) => {
    validateEmptyQuery(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    const review = await deps.reviews.getReview(reviewId);
    if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'The requested review does not exist.');
    return { review: mapReview(review) };
  });
  app.get('/api/reviews/:reviewId/evidence', async (request) => {
    validateEmptyQuery(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    const evidence = await deps.documents.list(reviewId);
    const review = await deps.reviews.getReview(reviewId);
    return { evidence: evidence.map((document) => mapDocument(document, review?.siteId)) };
  });
  app.post('/api/reviews/:reviewId/evidence', { bodyLimit: deps.config.maxUploadBytes + 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    validateEmptyQuery(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    const { file, metadata } = await readMultipart(request, deps.config.maxUploadBytes);
    const document = await deps.documents.upload({
      reviewId,
      role: metadata.role,
      filename: file.filename,
      declaredMime: file.mimeType,
      bytes: file.bytes,
      sourceUrl: metadata.sourceUrl,
      actor: actorFor(request),
    });
    const review = await deps.reviews.getReview(reviewId);
    return reply.code(201).send({ document: mapDocument(document, review?.siteId) });
  });
  app.post('/api/reviews/:reviewId/compare', async (request) => {
    validateEmptyQuery(request);
    validateEmptyBody(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    const review = await deps.reviews.compare(reviewId, actorFor(request));
    return { review: mapReview(review) };
  });
  app.post('/api/reviews/:reviewId/submit', async (request) => {
    validateEmptyQuery(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    if (request.body !== undefined) parse(submitRequestSchema, request.body, 'Submission');
    const review = await deps.reviews.submit(reviewId, actorFor(request));
    return { review: mapReview(review) };
  });
  app.get('/api/reviews/:reviewId/status', async (request) => {
    validateEmptyQuery(request);
    const { reviewId } = parse(reviewParams, request.params, 'Review identifier');
    const result = await deps.reviews.status(reviewId);
    return { review: mapStatus(result.review, result.statusRefresh) };
  });

  app.get('/api/records/:id', async (request) => {
    validateEmptyQuery(request);
    const { id } = parse(uuidParams, request.params, 'Record identifier');
    const review = await deps.reviews.getRecord(id);
    return { record: mapRecord(review) };
  });
  app.get('/api/documents/:id', async (request) => {
    validateEmptyQuery(request);
    const { id } = parse(uuidParams, request.params, 'Document identifier');
    const result = await getDocumentById(deps.db, id);
    const contentUrl = deps.config.authMode === 'disabled' ? `/api/documents/${result.document.id}/content` : null;
    return { document: { ...mapDocument(result.document, result.siteId, contentUrl), source: result.document.source, reviewId: result.document.reviewId, siteId: result.siteId } };
  });
  app.get('/api/documents/:id/content', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    validateEmptyQuery(request);
    const { id } = parse(uuidParams, request.params, 'Document identifier');
    actorFor(request);
    const content = await deps.documents.getContent(id);
    const fallbackName = content.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'evidence-document';
    const encodedName = encodeURIComponent(content.filename).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, no-store')
      .send(content.bytes);
  });
}
