import { test } from 'node:test';
import assert from 'node:assert/strict';

// Cada import con query distinta evalúa config.js de nuevo con el env actual.
let n = 0;
async function loadConfig(vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await import(`../src/shared/config.js?t=${++n}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('GCS_BUCKET_NAME ignora espacios alrededor', async () => {
  const cfg = await loadConfig({ GCS_BUCKET_NAME: ' dotcasa-chatbot\n' });
  assert.equal(cfg.GCS_BUCKET_NAME, 'dotcasa-chatbot');
});

test('variable con solo espacios usa el valor por defecto', async () => {
  const cfg = await loadConfig({ GCS_BUCKET_NAME: '   ', CHAT_LOG_PREFIX: ' ' });
  assert.equal(cfg.GCS_BUCKET_NAME, 'dotcasa-fotos-prod');
  assert.equal(cfg.CHAT_LOG_PREFIX, 'chat-logs');
});

test('flags y modos también se recortan', async () => {
  const cfg = await loadConfig({ BUBBLE_M2_MAX: 'true ', CHAT_LOG_MODE: ' off' });
  assert.equal(cfg.BUBBLE_M2_MAX, true);
  assert.equal(cfg.CHAT_LOG_MODE, 'off');
});
