import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/env.js';

export interface DocumentStorage {
  put(reference: string, bytes: Buffer, contentType: string): Promise<void>;
  get(reference: string): Promise<Buffer>;
  delete(reference: string): Promise<void>;
  close?(): Promise<void>;
}

const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const storageReferencePattern = new RegExp(`^${uuidPattern}/${uuidPattern}$`, 'i');

function safeStorageReference(reference: string) {
  if (!storageReferencePattern.test(reference)) throw new Error('Invalid storage reference.');
  return reference;
}

export class LocalDocumentStorage implements DocumentStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(reference: string, bytes: Buffer) {
    const target = join(this.root, safeStorageReference(reference));
    if (!target.startsWith(`${this.root}/`)) throw new Error('Storage path escaped configured root.');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }

  async get(reference: string) {
    return readFile(join(this.root, safeStorageReference(reference)));
  }

  async delete(reference: string) {
    await rm(join(this.root, safeStorageReference(reference)), { force: true });
  }
}

export class S3DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfig) {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: { accessKeyId: config.s3AccessKeyId!, secretAccessKey: config.s3SecretAccessKey! },
    });
  }

  async put(reference: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.s3Bucket,
      Key: safeStorageReference(reference),
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: contentType,
      ServerSideEncryption: this.config.s3ServerSideEncryption,
    }));
  }

  async get(reference: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: safeStorageReference(reference) }));
    if (!result.Body) throw new Error('Stored object body is empty.');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(reference: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.s3Bucket, Key: safeStorageReference(reference) }));
  }

  async close() {
    this.client.destroy();
  }
}

export function createDocumentStorage(config: AppConfig): DocumentStorage {
  return config.storageDriver === 's3' ? new S3DocumentStorage(config) : new LocalDocumentStorage(config.storageDir);
}
