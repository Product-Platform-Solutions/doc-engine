const express = require('express');
const crypto = require('crypto');
const { writeChangelog, writeReleaseNote } = require('../writers/changelog');
const router = express.Router();
function verifySignature(req) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody ?? JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
router.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
router.post('/github', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: 'Invalid signature' });
  const event = req.headers['x-github-event'];
  const payload = req.body;
  const repo = payload.repository?.name ?? 'unknown';
  console.log(`[webhook] ${event} from ${repo}`);
  res.json({ received: true, event, repo });
  setImmediate(async () => {
    try {
      if (event === 'push') {
        const branch = (payload.ref ?? '').replace('refs/heads/', '');
        const commitMsg = (payload.head_commit?.message ?? '');
      const committer = (payload.head_commit?.author?.name ?? payload.pusher?.name ?? '');
      if (commitMsg.includes('[doc-engine]') || committer === 'github-actions[bot]') {
        console.log('[webhook] Skipping doc-engine commit — loop prevention');
        return;
      }
      if (['main', 'master', 'develop'].includes(branch)) await writeChangelog(payload);
      } else if (event === 'release' && payload.action === 'published') {
        await writeReleaseNote(payload);
      } else if (event === 'ping') {
        console.log(`[webhook] Ping from ${repo} ✓`);
      }
    } catch (err) { console.error(`[webhook] Error processing ${event}:`, err.message); }
  });
});
module.exports = router;
