// ============================================================================
// IMAGE UTILS — descarga, detección, transparencia y streaming a GCS
// ============================================================================
import axios from 'axios';
import sharp from 'sharp';
import { Transform } from 'stream';
import { gcsBucket, GCS_BUCKET_NAME, DOWNLOAD_TIMEOUT, MAX_RETRIES, RETRY_DELAY_BASE } from './config.js';
import { httpAgent, httpsAgent } from './httpAgents.js';
import { isValidImageUrl } from './utils.js';
import { imageLimit } from './limits.js';

export function detectFileType(buffer) {
  const hex = buffer.toString('hex', 0, 24);
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (hex.startsWith('89504e47')) return 'png';
  if (hex.startsWith('52494646') && hex.includes('57454250')) return 'webp';
  if (hex.includes('66747970') && (hex.includes('686569') || hex.includes('686576') || hex.includes('6d6966'))) {
    return 'heif';
  }
  return 'unknown';
}

export async function hasTransparency(buffer) {
  try {
    const { hasAlpha } = await sharp(buffer).metadata();
    return hasAlpha === true;
  } catch { return false; }
}

export async function gcsFileExists(filename) {
  try {
    const [exists] = await gcsBucket.file(filename).exists();
    return exists ? `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${filename}` : null;
  } catch { return null; }
}

export async function downloadImage(url, retries = MAX_RETRIES) {
  if (!isValidImageUrl(url)) throw new Error(`Invalid URL: ${url}`);
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        httpAgent, httpsAgent
      });
      return Buffer.from(res.data);
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, RETRY_DELAY_BASE * attempt));
    }
  }
  throw new Error(`Download failed: ${lastError.message}`);
}

export function streamPipelineToGCS(filename, contentType, sharpPipeline, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const attemptUpload = () => {
      attempt++;
      let bytes = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) { bytes += chunk.length; cb(null, chunk); }
      });
      const file = gcsBucket.file(filename);
      const gcsStream = file.createWriteStream({
        metadata: { contentType, cacheControl: 'public, max-age=31536000' },
        resumable: false
      });

      const cleanup = () => {
        sharpPipeline.removeAllListeners('error'); counter.removeAllListeners('error');
        gcsStream.removeAllListeners('error'); gcsStream.removeAllListeners('finish');
      };

      const onError = (err) => {
        cleanup();
        try { gcsStream.destroy(); } catch {}
        if (attempt < retries) setTimeout(attemptUpload, RETRY_DELAY_BASE * attempt);
        else reject(err);
      };

      sharpPipeline.once('error', onError); counter.once('error', onError); gcsStream.once('error', onError);
      gcsStream.once('finish', () => {
        cleanup();
        resolve({ url: `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${filename}`, bytes });
      });
      sharpPipeline.pipe(counter).pipe(gcsStream);
    };
    attemptUpload();
  });
}

export async function processAllLimited(urlList, processor) {
  return Promise.all(urlList.map((url, idx) => imageLimit(() => processor(url, idx))));
}
