const fs = require('fs');
const path = require('path');
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('[env] Loaded .env');
} else {
  console.warn('[env] No .env file found');
}
const required = ['GROQ_API_KEY', 'GITHUB_TOKEN'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('[env] Missing required vars:', missing.join(', '));
  process.exit(1);
}
