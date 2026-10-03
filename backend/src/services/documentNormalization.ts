import { fileTypeFromBuffer } from 'file-type';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import { normalizedEvidenceSchema } from '../schemas/domain.js';
import type { NormalizedEvidence } from '../types/domain.js';

export const supportedMimeTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/json',
] as const;

export class DocumentProcessingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'DocumentProcessingError';
  }
}

export type NormalizationResult = {
  mimeType: typeof supportedMimeTypes[number];
  normalized: NormalizedEvidence;
  fields: Array<{ key: string; label: string; value: string | null; extractionStatus: string }>;
};

const fieldPatterns: Array<{ key: Exclude<keyof NormalizedEvidence, 'source_document_hash'>; label: string; aliases: string[] }> = [
  { key: 'site_id', label: 'Site ID', aliases: ['site id', 'site code', 'site reference', 'site identifier'] },
  { key: 'site_name', label: 'Site name', aliases: ['site name', 'project site'] },
  { key: 'milestone', label: 'Milestone', aliases: ['milestone', 'project milestone', 'close-out milestone', 'closeout milestone'] },
  { key: 'location', label: 'Location', aliases: ['location', 'community', 'local government area', 'lga'] },
  { key: 'report_reference', label: 'Report reference', aliases: ['report reference', 'report number', 'report no', 'document reference'] },
  { key: 'report_date', label: 'Report date', aliases: ['report date', 'document date', 'inspection date'] },
  { key: 'issuer', label: 'Issuer', aliases: ['issuer', 'prepared by', 'issued by', 'laboratory', 'monitor organization'] },
  { key: 'finding_reference', label: 'Finding reference', aliases: ['finding reference', 'sample reference', 'sample id', 'sample code'] },
  { key: 'reported_findings', label: 'Reported findings', aliases: ['reported findings', 'findings', 'observations', 'conclusion', 'results'] },
];

function sanitizeExtractedText(value: string, maxChars: number) {
  const safe = value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n');
  if (safe.length > maxChars) throw new DocumentProcessingError('DOCUMENT_TEXT_LIMIT_EXCEEDED', 'The extracted text exceeds the configured processing limit.');
  return safe;
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractLabeledValues(text: string) {
  const values = new Map<string, string>();
  const aliasMap = new Map<string, string>();
  for (const field of fieldPatterns) for (const alias of field.aliases) aliasMap.set(normalizeLabel(alias), field.key);
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([^:#=]{2,80})\s*[:=#-]\s*(.*?)\s*$/);
    if (!match) continue;
    const key = aliasMap.get(normalizeLabel(match[1]));
    const value = cleanField(match[2]);
    if (key && value && !values.has(key)) values.set(key, value);
  }
  return values;
}

function cleanField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 5000) : null;
}

function findJsonValue(source: Record<string, unknown>, aliases: string[]): string | null {
  const wanted = new Set(aliases.map(normalizeLabel));
  for (const [key, value] of Object.entries(source)) {
    if (wanted.has(normalizeLabel(key))) {
      if (typeof value === 'string') return cleanField(value);
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    }
  }
  return null;
}

function extractJsonValues(parsed: unknown) {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map<string, string>();
  const record = parsed as Record<string, unknown>;
  const candidates = [record, ...Object.values(record).filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))];
  const values = new Map<string, string>();
  for (const field of fieldPatterns) {
    const aliases = [...field.aliases, field.key];
    for (const candidate of candidates) {
      const value = findJsonValue(candidate, aliases);
      if (value) { values.set(field.key, value); break; }
    }
  }
  return values;
}

function buildNormalized(values: Map<string, string>, sha256: string): NormalizationResult['normalized'] {
  const object: Record<string, string | null> = { source_document_hash: sha256 };
  for (const field of fieldPatterns) object[field.key] = values.get(field.key) ?? null;
  return normalizedEvidenceSchema.parse(object);
}

function buildFields(normalized: NormalizedEvidence) {
  return fieldPatterns.map((field) => ({
    key: field.key,
    label: field.label,
    value: normalized[field.key],
    extractionStatus: normalized[field.key] == null ? 'NOT_EXTRACTED' : 'EXTRACTED_LABEL_PATTERN',
  }));
}

export function failedNormalization(sha256: string, mimeType: typeof supportedMimeTypes[number]): NormalizationResult {
  const normalized = buildNormalized(new Map(), sha256);
  return { mimeType, normalized, fields: buildFields(normalized) };
}

function inspectZipEntries(bytes: Buffer, maxExpandedBytes: number) {
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The Word document archive is malformed.');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  const directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount > 2000 || directoryOffset + directorySize > eocd) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The Word document archive exceeds safe structural limits.');
  const names: string[] = [];
  let offset = directoryOffset;
  let expandedTotal = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The Word document archive directory is malformed.');
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const end = offset + 46 + fileNameLength + extraLength + commentLength;
    if (end > bytes.length || end > directoryOffset + directorySize) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The Word document archive directory is truncated.');
    if ((flags & 0x1) !== 0 || ![0, 8].includes(compressionMethod)) throw new DocumentProcessingError('UNSAFE_DOCUMENT_FEATURE', 'Encrypted or unsupported-compression Word archives are not accepted.');
    expandedTotal += expandedSize;
    if (expandedTotal > maxExpandedBytes || (compressedSize === 0 && expandedSize > 0) || (compressedSize > 0 && expandedSize / compressedSize > 200)) {
      throw new DocumentProcessingError('DOCUMENT_ARCHIVE_LIMIT_EXCEEDED', 'The Word document archive exceeds safe expanded-size or compression-ratio limits.');
    }
    names.push(bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8'));
    offset = end;
  }
  return names;
}

function assertTextBytes(bytes: Buffer) {
  if (bytes.includes(0)) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The uploaded file contains binary data and cannot be read as text.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The uploaded text file is not valid UTF-8.');
  }
}

async function detectSupportedMime(bytes: Buffer, declaredMime: string): Promise<typeof supportedMimeTypes[number]> {
  const normalizedDeclared = declaredMime.toLowerCase().split(';')[0].trim();
  const detected = await fileTypeFromBuffer(bytes);
  if (detected?.mime === 'application/pdf') {
    if (normalizedDeclared === 'application/pdf') return 'application/pdf';
    throw new DocumentProcessingError('UNSUPPORTED_OR_MISMATCHED_MIME', 'The PDF file does not match the declared MIME type.');
  }
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (isZip && normalizedDeclared !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    throw new DocumentProcessingError('UNSUPPORTED_OR_MISMATCHED_MIME', 'The ZIP-based file does not match a supported declared document type.');
  }
  if (detected && !isZip) throw new DocumentProcessingError('UNSUPPORTED_OR_MISMATCHED_MIME', 'The detected binary file type is not supported or does not match the declared MIME type.');
  if (isZip && normalizedDeclared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const entries = inspectZipEntries(bytes, 30 * 1024 * 1024);
    if (entries.some((entry) => /(^|\/)vbaProject\.bin$/i.test(entry))) throw new DocumentProcessingError('UNSAFE_DOCUMENT_FEATURE', 'Macro-enabled Word documents are not accepted.');
    if (entries.includes('word/document.xml') && entries.includes('[Content_Types].xml')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The uploaded ZIP archive is not a supported Word document.');
  }
  if (['text/plain', 'text/csv', 'application/json'].includes(normalizedDeclared)) {
    assertTextBytes(bytes);
    return normalizedDeclared as 'text/plain' | 'text/csv' | 'application/json';
  }
  throw new DocumentProcessingError('UNSUPPORTED_OR_MISMATCHED_MIME', `The uploaded file type is not supported or does not match the declared MIME type. Supported: ${supportedMimeTypes.join(', ')}.`);
}

async function extractText(bytes: Buffer, mimeType: typeof supportedMimeTypes[number], maxChars: number): Promise<{ text: string; json: unknown | null }> {
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return { text: sanitizeExtractedText(assertTextBytes(bytes), maxChars), json: null };
  if (mimeType === 'application/json') {
    let parsed: unknown;
    try { parsed = JSON.parse(assertTextBytes(bytes)); }
    catch { throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'The JSON document is malformed.'); }
    return { text: sanitizeExtractedText(JSON.stringify(parsed), maxChars), json: parsed };
  }
  if (mimeType === 'application/pdf') {
    const parser = new PDFParse({ data: bytes });
    try {
      const info = await parser.getInfo();
      if (info.total > 300) throw new DocumentProcessingError('DOCUMENT_PAGE_LIMIT_EXCEEDED', 'The PDF exceeds the 300-page processing limit.');
      const result = await parser.getText();
      const text = sanitizeExtractedText(result.text, maxChars);
      if (!text.trim()) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'No extractable text was found in the PDF. Scanned-image OCR is not enabled.');
      return { text, json: null };
    } catch (error) {
      if (error instanceof DocumentProcessingError) throw error;
      throw new DocumentProcessingError('DOCUMENT_PROCESSING_FAILED', 'The PDF could not be parsed by the configured text extractor.');
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = sanitizeExtractedText(result.value, maxChars);
    if (!text.trim()) throw new DocumentProcessingError('UNREADABLE_DOCUMENT', 'No extractable text was found in the Word document.');
    return { text, json: null };
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    throw new DocumentProcessingError('DOCUMENT_PROCESSING_FAILED', 'The Word document could not be parsed by the configured text extractor.');
  }
}

export async function normalizeDocument(bytes: Buffer, declaredMime: string, sha256: string, maxChars: number): Promise<NormalizationResult> {
  if (!bytes.byteLength) throw new DocumentProcessingError('EMPTY_DOCUMENT', 'The uploaded document is empty.');
  const mimeType = await detectSupportedMime(bytes, declaredMime || 'application/octet-stream');
  const extracted = await extractText(bytes, mimeType, maxChars);
  const values = extracted.json !== null ? extractJsonValues(extracted.json) : extractLabeledValues(extracted.text);
  const normalized = buildNormalized(values, sha256);
  return { mimeType, normalized, fields: buildFields(normalized) };
}
