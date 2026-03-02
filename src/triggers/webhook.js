const express = require('express');
const crypto  = require('crypto');
const { writeChangelog, writeReleaseNote } = require('../writers/changelog');
const { analyzeAndPlanUpdates }            = require('../intelligence/analyzer');
const { updateDoc }                        = require('../writers/doc-updater');
const { syncRoadmap }                      = require('../writers/roadmap-sync');
const { incrementalSync }                  = require('../publishers/confluence-sync');

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
  const event   = req.headers['x-github-event'];
  const payload = req.body;
  const repo    = payload.repository?.name ?? 'unknown';
  const branch  = (payload.ref ?? '').replace('refs/heads/', '');
  console.log(`[webhook] ${event} from ${repo}@${branch}`);
  res.json({ received: true, event, repo });

  setImmediate(async () => {
    try {
      if (event === 'push') {
        const commitMsg   = payload.head_commit?.message ?? '';
        const committer   = payload.head_commit?.author?.name ?? payload.pusher?.name ?? '';
        const isDocEngine = commitMsg.includes('[doc-engine]') || committer === 'github-actions[bot]';
        if (isDocEngine) { console.log('[webhook] Skipping doc-engine commit — loop prevention'); return; }
        if (!['main', 'master', 'develop'].includes(branch)) { console.log(`[webhook] Branch '${branch}' not tracked`); return; }
        const commits = payload.commits ?? [];
        await Promise.allSettled([
          writeChangelog(payload).catch(e => console.error('[webhook] Changelog failed:', e.message)),
          runIntelligencePipeline({ repo, branch, commits, payload }),
        ]);
      } else if (event === 'release' && payload.action === 'published') {
        await writeReleaseNote(payload);
      } else if (event === 'ping') {
        console.log(`[webhook] Ping from ${repo} ✓`);
      }
    } catch (err) {
      console.error(`[webhook] Error processing ${event}:`, err.message);
    }
  });
});

async function runIntelligencePipeline({ repo, branch, commits, payload }) {
  console.log('[intelligence] Starting pipeline...');
  try {
    const updates = await analyzeAndPlanUpdates({ repo, branch, commits });
    if (updates.length > 0) {
      console.log(`[intelligence] Applying ${updates.length} doc updates...`);
      const chunks = [];
      for (let i = 0; i < updates.length; i += 3) chunks.push(updates.slice(i, i + 3));
      for (const chunk of chunks) {
        await Promise.allSettled(chunk.map(update =>
          updateDoc({ docPath: update.docPath, changeDesc: update.changeDescription,
            context: `Triggered by commits to ${repo}: ${commits.map(c => c.message?.split('\n')[0]).join(', ')}` })
          .catch(e => console.error(`[intelligence] Doc update failed ${update.docPath}:`, e.message))
        ));
      }
    }
    await syncRoadmap({ commits, repo }).catch(e => console.error('[intelligence] Roadmap sync failed:', e.message));
    const confluenceEnabled = !!(process.env.CONFLUENCE_BASE_URL && process.env.CONFLUENCE_EMAIL && process.env.CONFLUENCE_API_TOKEN);
    if (confluenceEnabled) await incrementalSync(payload).catch(e => console.error('[intelligence] Confluence sync failed:', e.message));
    console.log('[intelligence] Pipeline complete');
  } catch (err) {
    console.error('[intelligence] Pipeline error:', err.message);
  }
}

module.exports = router;
