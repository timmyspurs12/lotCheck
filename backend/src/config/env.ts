import { resolve } from 'node:path';
import { z } from 'zod';

const optionalString = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().optional());
const networkSchema = z.enum(['testnetAsimov', 'testnetBradbury', 'studionet', 'localnet']);

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: optionalString,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DB_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DB_AUTO_MIGRATE: z.enum(['true', 'false']).default('false'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./storage/private'),
  S3_BUCKET: optionalString,
  S3_REGION: optionalString,
  S3_ENDPOINT: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  S3_SERVER_SIDE_ENCRYPTION: z.enum(['AES256', 'aws:kms']).optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(10 * 1024 * 1024),
  MAX_EXTRACTED_TEXT_CHARS: z.coerce.number().int().min(1000).max(100_000).default(30_000),
  MAX_PACKAGE_BYTES: z.coerce.number().int().min(10_000).max(200_000).default(80_000),
  POLICY_VERSION: z.string().trim().min(1).max(100).default('lotcheck-document-review-v1'),
  AUTH_MODE: z.enum(['disabled', 'oidc']).default('disabled'),
  OIDC_ISSUER: optionalString,
  OIDC_AUDIENCE: optionalString,
  OIDC_JWKS_URL: optionalString,
  OIDC_REQUIRED_ROLE: z.string().trim().min(1).max(100).default('lotcheck:reviewer'),
  CORS_ORIGINS: z.string().default(''),
  GENLAYER_MODE: z.enum(['disabled', 'live']).default('disabled'),
  GENLAYER_NETWORK: networkSchema.default('testnetAsimov'),
  GENLAYER_RPC: optionalString,
  GENLAYER_CONTRACT_ADDRESS: optionalString,
  GENLAYER_PRIVATE_KEY: optionalString,
  GENLAYER_EXPLORER_URL: optionalString,
  GENLAYER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
  GENLAYER_JOB_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(3000),
  GENLAYER_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
  GENLAYER_MAX_ROTATIONS: z.coerce.number().int().min(0).max(10).default(3),
}).strict();

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  dbPoolMax: number;
  dbSsl: 'disable' | 'require' | 'verify-full';
  dbAutoMigrate: boolean;
  storageDriver: 'local' | 's3';
  storageDir: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
  s3ServerSideEncryption?: 'AES256' | 'aws:kms';
  maxUploadBytes: number;
  maxExtractedTextChars: number;
  maxPackageBytes: number;
  policyVersion: string;
  authMode: 'disabled' | 'oidc';
  oidcIssuer?: string;
  oidcAudience?: string;
  oidcJwksUrl?: string;
  oidcRequiredRole: string;
  corsOrigins: string[];
  genlayerMode: 'disabled' | 'live';
  genlayerNetwork: z.infer<typeof networkSchema>;
  genlayerRpc?: string;
  genlayerContractAddress?: `0x${string}`;
  genlayerPrivateKey?: `0x${string}`;
  genlayerExplorerUrl?: string;
  genlayerPollIntervalMs: number;
  genlayerJobIntervalMs: number;
  genlayerJobMaxAttempts: number;
  genlayerMaxRotations: number;
};

export function loadConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const allowedKeys = new Set(Object.keys(rawConfigSchema.shape));
  const selected = Object.fromEntries(Object.entries(input).filter(([key]) => allowedKeys.has(key)));
  const parsed = rawConfigSchema.safeParse(selected);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid backend configuration: ${issues}`);
  }
  const raw = parsed.data;
  const failures: string[] = [];
  if (!raw.DATABASE_URL) failures.push('DATABASE_URL is required.');
  if (raw.GENLAYER_MODE === 'live') {
    if (!raw.GENLAYER_CONTRACT_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(raw.GENLAYER_CONTRACT_ADDRESS)) failures.push('GENLAYER_CONTRACT_ADDRESS must be a deployed 20-byte address when GENLAYER_MODE=live.');
    if (!raw.GENLAYER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(raw.GENLAYER_PRIVATE_KEY)) failures.push('GENLAYER_PRIVATE_KEY must be a 32-byte hex key when GENLAYER_MODE=live.');
  }
  if (raw.AUTH_MODE === 'oidc') {
    if (!raw.OIDC_ISSUER || !raw.OIDC_AUDIENCE || !raw.OIDC_JWKS_URL) failures.push('OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URL are required when AUTH_MODE=oidc.');
    if (raw.OIDC_JWKS_URL && !isHttpsUrl(raw.OIDC_JWKS_URL)) failures.push('OIDC_JWKS_URL must use HTTPS.');
  }
  if (raw.DATABASE_URL && !/^postgres(?:ql)?:\/\//.test(raw.DATABASE_URL)) failures.push('DATABASE_URL must be a PostgreSQL connection URL.');
  if (raw.GENLAYER_EXPLORER_URL) {
    try {
      const explorer = new URL(raw.GENLAYER_EXPLORER_URL);
      if (!['http:', 'https:'].includes(explorer.protocol) || explorer.username || explorer.password || explorer.search || explorer.hash) failures.push('GENLAYER_EXPLORER_URL must be an HTTP(S) base URL without credentials, query, or fragment.');
      if (raw.NODE_ENV === 'production' && explorer.protocol !== 'https:') failures.push('GENLAYER_EXPLORER_URL must use HTTPS in production.');
    } catch { failures.push('GENLAYER_EXPLORER_URL must be a valid URL.'); }
  }
  if (raw.GENLAYER_RPC) {
    try {
      const rpc = new URL(raw.GENLAYER_RPC);
      if (raw.NODE_ENV === 'production' && rpc.protocol !== 'https:') failures.push('GENLAYER_RPC must use HTTPS in production.');
      if (!['http:', 'https:'].includes(rpc.protocol)) failures.push('GENLAYER_RPC must use HTTP or HTTPS.');
    } catch { failures.push('GENLAYER_RPC must be a valid URL.'); }
  }
  if (raw.NODE_ENV === 'production') {
    if (raw.AUTH_MODE !== 'oidc') failures.push('Production requires AUTH_MODE=oidc.');
    if (raw.OIDC_ISSUER && !isHttpsUrl(raw.OIDC_ISSUER)) failures.push('OIDC_ISSUER must use HTTPS in production.');
    if (raw.GENLAYER_MODE !== 'live') failures.push('Production requires GENLAYER_MODE=live; disabled/mock decisions are not supported.');
    if (!raw.GENLAYER_RPC) failures.push('Production requires an explicit GENLAYER_RPC endpoint.');
    if (raw.GENLAYER_NETWORK === 'localnet' || raw.GENLAYER_NETWORK === 'studionet') failures.push('Production must use a configured GenLayer testnet, not localnet or studionet.');
    if (raw.STORAGE_DRIVER !== 's3') failures.push('Production requires STORAGE_DRIVER=s3 with private object storage.');
    if (!raw.S3_BUCKET || !raw.S3_REGION || !raw.S3_ACCESS_KEY_ID || !raw.S3_SECRET_ACCESS_KEY) failures.push('Production S3 storage requires bucket, region, access key, and secret key configuration.');
    if (!raw.S3_SERVER_SIDE_ENCRYPTION) failures.push('Production S3 storage requires server-side encryption (AES256 or aws:kms).');
    if (raw.S3_ENDPOINT && !isHttpsUrl(raw.S3_ENDPOINT)) failures.push('S3_ENDPOINT must use HTTPS in production.');
  }
  if (raw.STORAGE_DRIVER === 's3' && (!raw.S3_BUCKET || !raw.S3_REGION || !raw.S3_ACCESS_KEY_ID || !raw.S3_SECRET_ACCESS_KEY)) failures.push('S3 storage requires S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.');
  if (failures.length) throw new Error(`Invalid backend configuration: ${failures.join(' ')}`);

  const corsOrigins = raw.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || (raw.NODE_ENV === 'production' && url.protocol !== 'https:')) failures.push(`CORS_ORIGINS contains an invalid or insecure origin: ${origin}`);
    } catch {
      failures.push(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }
  if (failures.length) throw new Error(`Invalid backend configuration: ${failures.join(' ')}`);

  return {
    nodeEnv: raw.NODE_ENV,
    host: raw.HOST,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL!,
    dbPoolMax: raw.DB_POOL_MAX,
    dbSsl: raw.DB_SSL,
    dbAutoMigrate: raw.DB_AUTO_MIGRATE === 'true',
    storageDriver: raw.STORAGE_DRIVER,
    storageDir: resolve(raw.STORAGE_DIR),
    s3Bucket: raw.S3_BUCKET,
    s3Region: raw.S3_REGION,
    s3Endpoint: raw.S3_ENDPOINT,
    s3AccessKeyId: raw.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: raw.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: raw.S3_FORCE_PATH_STYLE === 'true',
    s3ServerSideEncryption: raw.S3_SERVER_SIDE_ENCRYPTION,
    maxUploadBytes: raw.MAX_UPLOAD_BYTES,
    maxExtractedTextChars: raw.MAX_EXTRACTED_TEXT_CHARS,
    maxPackageBytes: raw.MAX_PACKAGE_BYTES,
    policyVersion: raw.POLICY_VERSION,
    authMode: raw.AUTH_MODE,
    oidcIssuer: raw.OIDC_ISSUER,
    oidcAudience: raw.OIDC_AUDIENCE,
    oidcJwksUrl: raw.OIDC_JWKS_URL,
    oidcRequiredRole: raw.OIDC_REQUIRED_ROLE,
    corsOrigins,
    genlayerMode: raw.GENLAYER_MODE,
    genlayerNetwork: raw.GENLAYER_NETWORK,
    genlayerRpc: raw.GENLAYER_RPC,
    genlayerContractAddress: raw.GENLAYER_CONTRACT_ADDRESS as `0x${string}` | undefined,
    genlayerPrivateKey: raw.GENLAYER_PRIVATE_KEY as `0x${string}` | undefined,
    genlayerExplorerUrl: raw.GENLAYER_EXPLORER_URL,
    genlayerPollIntervalMs: raw.GENLAYER_POLL_INTERVAL_MS,
    genlayerJobIntervalMs: raw.GENLAYER_JOB_INTERVAL_MS,
    genlayerJobMaxAttempts: raw.GENLAYER_JOB_MAX_ATTEMPTS,
    genlayerMaxRotations: raw.GENLAYER_MAX_ROTATIONS,
  };
}

function isHttpsUrl(value: string) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
