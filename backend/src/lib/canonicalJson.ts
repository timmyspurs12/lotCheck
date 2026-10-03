import { createHash } from 'node:crypto';

function assertWellFormedUnicode(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Canonical JSON cannot contain an unpaired Unicode surrogate.');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('Canonical JSON cannot contain an unpaired Unicode surrogate.');
    }
  }
}

function normalize(value: unknown, seen: Set<object>): unknown {
  if (typeof value === 'string') { assertWellFormedUnicode(value); return value; }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Canonical JSON cannot contain cyclic references.');
    seen.add(value);
    const result = value.map((item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') throw new TypeError('Canonical JSON cannot contain undefined or executable values.');
      return normalize(item, seen);
    });
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('Canonical JSON cannot contain cyclic references.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Canonical JSON only accepts plain objects.');
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      assertWellFormedUnicode(key);
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') throw new TypeError('Canonical JSON cannot contain undefined or executable values.');
      result[key] = normalize(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
}

export function stableStringify(value: unknown) {
  return JSON.stringify(normalize(value, new Set()));
}

export function sha256Hex(value: Buffer | Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCanonicalJson(value: unknown) {
  const serialized = stableStringify(value);
  return { serialized, sha256: sha256Hex(serialized) };
}
