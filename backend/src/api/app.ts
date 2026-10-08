import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '../lib/errors.js';
import { registerAuthentication } from './auth.js';
import { registerRoutes, type RouteDependencies } from './routes.js';

export async function buildApiApp(deps: RouteDependencies) {
  const app = Fastify({
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'req.body.passcode'],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1024 * 1024,
    trustProxy: false,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(header) ? header : randomUUID();
    },
  });

  const origins = deps.config.corsOrigins.length
    ? deps.config.corsOrigins
    : deps.config.nodeEnv === 'development' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : [];
  await app.register(cors, { origin: origins.length ? origins : false, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Accept', 'Authorization', 'Content-Type'], credentials: false, maxAge: 600 });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', ban: 0 });
  registerAuthentication(app, deps.config);
  await registerRoutes(app, deps);

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'The requested API route does not exist.' }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) });
    }
    const errorObject = typeof error === 'object' && error !== null ? error as { statusCode?: unknown; name?: unknown } : {};
    const statusCode = typeof errorObject.statusCode === 'number' ? errorObject.statusCode : 500;
    if (statusCode === 413) return reply.code(413).send({ code: 'REQUEST_TOO_LARGE', message: 'The request exceeds the configured size limit.' });
    if (statusCode === 429) return reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many requests; retry after the rate-limit window.' });
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ code: 'INVALID_REQUEST', message: statusCode === 415 ? 'The request content type is not supported.' : 'The request could not be processed.' });
    }
    request.log.error({ requestId: request.id, errorName: typeof errorObject.name === 'string' ? errorObject.name : 'UnknownError', errorCode: 'INTERNAL_ERROR' }, 'LotCheck API request failed');
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'An unexpected backend error occurred.' });
  });

  return app;
}
