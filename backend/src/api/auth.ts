import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
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

const DEMO_JWT_ISSUER = 'lotcheck-demo-auth';
const DEMO_JWT_AUDIENCE = 'lotcheck-demo-api';
export const DEMO_SESSION_TTL_SECONDS = 4 * 60 * 60;

export async function createDemoSessionToken(
  passcode: string,
  config: AppConfig,
): Promise<string | null> {
  const expectedPasscode = config.demoAuthPasscode;
  const signingSecret = config.demoAuthSigningSecret;

  if (
    config.nodeEnv !== 'demo' ||
    config.authMode !== 'demo' ||
    !expectedPasscode ||
    !signingSecret
  ) {
    return null;
  }

  const suppliedHash = createHash('sha256').update(passcode, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expectedPasscode, 'utf8').digest();

  if (!timingSafeEqual(suppliedHash, expectedHash)) return null;

  return new SignJWT({ mode: 'demo', roles: [config.oidcRequiredRole] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(DEMO_JWT_ISSUER)
    .setAudience(DEMO_JWT_AUDIENCE)
    .setSubject(`demo:${randomUUID()}`)
    .setIssuedAt()
    .setExpirationTime(`${DEMO_SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(signingSecret));
}

function bearerToken(authorization: string | undefined) {
  return authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
}

export function registerAuthentication(app: FastifyInstance, config: AppConfig) {
  app.decorateRequest('actor', null);

  const jwks =
    config.authMode === 'oidc' && config.oidcJwksUrl
      ? createRemoteJWKSet(new URL(config.oidcJwksUrl))
      : null;

  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.public === true) return;

    /*
     * Public hackathon/demo mode.
     *
     * When AUTH_MODE=disabled and NODE_ENV=demo, every visitor is treated
     * as a reviewer. No passcode, login, or bearer token is required.
     */
    if (config.authMode === 'disabled' && config.nodeEnv !== 'production') {
      request.actor = {
        id: 'public-demo',
        roles: ['reviewer'],
      };
      return;
    }

    const token = bearerToken(request.headers.authorization);

    if (config.authMode === 'demo') {
      if (!token || token.length > 8192 || !config.demoAuthSigningSecret) {
        return reply.code(401).send({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'A valid LotCheck demo session is required.',
        });
      }

      try {
        const { payload } = await jwtVerify(
          token,
          new TextEncoder().encode(config.demoAuthSigningSecret),
          {
            algorithms: ['HS256'],
            issuer: DEMO_JWT_ISSUER,
            audience: DEMO_JWT_AUDIENCE,
            requiredClaims: ['sub', 'iat', 'exp'],
            maxTokenAge: `${DEMO_SESSION_TTL_SECONDS}s`,
          },
        );

        const subject =
          typeof payload.sub === 'string' ? payload.sub.trim() : '';

        if (
          payload.mode !== 'demo' ||
          !subject ||
          subject.length > 255 ||
          /[\u0000-\u001f\u007f]/.test(subject)
        ) {
          return reply.code(401).send({
            code: 'INVALID_DEMO_SESSION',
            message: 'The LotCheck demo session could not be verified.',
          });
        }

        const roles = Array.isArray(payload.roles)
          ? [
              ...new Set(
                payload.roles.filter(
                  (role): role is string => typeof role === 'string',
                ),
              ),
            ].slice(0, 32)
          : [];

        if (!roles.includes(config.oidcRequiredRole)) {
          return reply.code(403).send({
            code: 'REVIEWER_ROLE_REQUIRED',
            message:
              'The demo session does not have the configured LotCheck reviewer role.',
          });
        }

        request.actor = { id: subject, roles };
        return;
      } catch {
        return reply.code(401).send({
          code: 'INVALID_DEMO_SESSION',
          message: 'The LotCheck demo session could not be verified.',
        });
      }
    }

    if (
      !token ||
      token.length > 8192 ||
      !jwks ||
      !config.oidcIssuer ||
      !config.oidcAudience
    ) {
      return reply.code(401).send({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A valid OIDC bearer token is required.',
      });
    }

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.oidcIssuer,
        audience: config.oidcAudience,
        requiredClaims: ['sub'],
      });

      const subject =
        typeof payload.sub === 'string' ? payload.sub.trim() : '';

      if (
        !subject ||
        subject.length > 255 ||
        /[\u0000-\u001f\u007f]/.test(subject)
      ) {
        return reply.code(401).send({
          code: 'INVALID_IDENTITY',
          message:
            'The verified identity token has no usable subject.',
        });
      }

      const rawRoles = payload.roles;
      const rawScopes =
        typeof payload.scope === 'string'
          ? payload.scope.split(/\s+/)
          : [];

      const roles = [
        ...new Set([
          ...(Array.isArray(rawRoles)
            ? rawRoles.filter(
                (role): role is string => typeof role === 'string',
              )
            : []),
          ...rawScopes,
        ]),
      ].slice(0, 32);

      if (!roles.includes(config.oidcRequiredRole)) {
        return reply.code(403).send({
          code: 'REVIEWER_ROLE_REQUIRED',
          message:
            'The verified identity does not have the configured LotCheck reviewer role.',
        });
      }

      request.actor = {
        id: subject,
        email:
          typeof payload.email === 'string'
            ? payload.email.slice(0, 320)
            : undefined,
        roles,
      };
    } catch {
      return reply.code(401).send({
        code: 'INVALID_BEARER_TOKEN',
        message: 'The OIDC bearer token could not be verified.',
      });
    }
  });
}