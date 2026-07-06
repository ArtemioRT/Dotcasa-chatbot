// ============================================================================
// UTILS GENERALES — texto, URLs, hashes y números
// ============================================================================
import crypto from 'crypto';

export function isValidImageUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}

export function parseUrlList(input) {
  let list = [];
  if (typeof input === 'string') list = input.split(',').map(u => u.trim()).filter(Boolean);
  else if (Array.isArray(input)) list = input.map(u => String(u)).filter(Boolean);
  return list.filter(u => u.startsWith('http://') || u.startsWith('https://'));
}

export function addHeader(headers, name) {
  if (!headers.some(h => h.toLowerCase() === name.toLowerCase())) headers.push(name);
}

export function formatPrecioMap(value) {
  if (!value && value !== 0) return value;
  const raw = String(value).trim();
  const num = parseFloat(raw.replace(/[$\s,]/g, ''));
  if (isNaN(num)) return value;
  return num >= 1_000_000
    ? `${parseFloat((num / 1_000_000).toFixed(1))}M`
    : (num >= 1_000 ? `${parseFloat((num / 1_000).toFixed(1))}K` : `${num}`);
}

export function sanitizeFilename(name) {
  return String(name || 'documento').replace(/[^a-zA-Z0-9._\- ]/g, '_').substring(0, 100) + '.pdf';
}

export function computeContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 24);
}

export function makeDedupName(contentHash, opSignature, ext) {
  return `dedup/${contentHash}_${opSignature}.${ext}`;
}

export function normalizePublicUrl(url) {
  const raw = String(url || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

export function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeComparableText(text) {
  return normalizeSearchText(text)
    .split(' ')
    .filter(Boolean)
    .map(token => {
      if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
      if (token.length > 3 && token.endsWith('s'))  return token.slice(0, -1);
      return token;
    })
    .join(' ');
}

export function parseBubbleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (/^-?\d+,\d+$/.test(raw)) return parseFloat(raw.replace(',', '.'));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
