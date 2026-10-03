import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { Actor } from '../types/domain.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function registerAuthentication(app: FastifyInstance, config: AppConfig) {
  app.decorateRequest('actor', null);
  const jwks = config.authMode === 'oidc' && config.oidcJwksUrl
    ? createRemoteJWKSet(new URL(config.oidcJwksUrl))
    : null;

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.public === true) return;
    if (config.authMode === 'disabled' && config.nodeEnv !== 'production') {
      request.actor = { id: 'local-development', roles: ['reviewer'] };
      return;
    }
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token || token.length > 8192 || !jwks || !config.oidcIssuer || !config.oidcAudience) {
      return reply.code(401).send({ code: 'AUTHENTICATION_REQUIRED', message: 'A valid OIDC bearer token is required.' });
    }
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuer,
        audience: config.oidcAudience,
        requiredClaims: ['sub'],
      });
      const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!subject || subject.length > 255 || /[\u0000-\u001f\u007f]/.test(subject)) {
        return reply.code(401).send({ code: 'INVALID_IDENTITY', message: 'The verified identity token has no usable subject.' });
      }
      const rawRoles = payload.roles;
      const rawScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
      const roles = [...new Set([
        ...(Array.isArray(rawRoles) ? rawRoles.filter((role): role is string => typeof role === 'string') : []),
        ...rawScopes,
      ])].slice(0, 32);
      if (!roles.includes(config.oidcRequiredRole)) {
        return reply.code(403).send({ code: 'REVIEWER_ROLE_REQUIRED', message: 'The verified identity does not have the configured LotCheck reviewer role.' });
      }
      request.actor = {
        id: subject,
        email: typeof payload.email === 'string' ? payload.email.slice(0, 320) : undefined,
        roles,
      };
    } catch {
      return reply.code(401).send({ code: 'INVALID_BEARER_TOKEN', message: 'The OIDC bearer token could not be verified.' });
    }
  });
}
