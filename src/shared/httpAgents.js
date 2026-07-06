// ============================================================================
// AGENTES HTTP — keep-alive compartido para axios
// ============================================================================
import http from 'http';
import https from 'https';
import { IS_PROD } from './config.js';

export const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 25
});

export const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 25,
  rejectUnauthorized: IS_PROD
});
