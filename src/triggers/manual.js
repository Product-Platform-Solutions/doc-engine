const express = require('express');
const { writeJournal }          = require('../writers/journal');
const { writeChangelog }        = require('../writers/changelog');
const { writeIncident }         = require('../writers/incident-report');
const { updateDoc }             = require('../writers/doc-updater');
const { syncRoadmap }           = require('../writers/roadmap-sync');
const { fullSync }              = require('../publishers/confluence-sync');
const { analyzeAndPlanUpdates } = require('../intelligence/analyzer');

const router = express.Router();

function auth(req, res, next) {
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'];
  if (key !== process.env.DOC_ENGINE_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

router.use(auth);

router.get('/health', (req, res) => res.json({ status: 'ok', service: 'doc-engine', version: '2.0.0', timestamp: new Date().toISOString() }));

router.post('/journal', async (req, res) => {
  try {
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const sessionNotes = req.body?.session_notes ?? '';
    const result = await writeJournal(date, [], sessionNotes);
    if (!result) return res.json({ status: 'skipped', reason: 'No activity found' });
    res.json({ status: 'ok', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/changelog', async (req, res) => {
  try {
    const result = await writeChangelog(req.body ?? {});
    if (!result) return res.json({ status: 'skipped', reason: 'No commits found' });
    res.json({ status: 'ok', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/incident', async (req, res) => {
  try {
    const result = await writeIncident(req.body);
    res.json({ status: 'ok', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/doc', async (req, res) => {
  try {
    const { docPath, changeDesc, context } = req.body ?? {};
    if (!docPath || !changeDesc) return res.status(400).json({ error: 'docPath and changeDesc required' });
    const result = await updateDoc({ docPath, changeDesc, context });
    res.json({ status: 'ok', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/roadmap', async (req, res) => {
  try {
    const { sessionNotes, commits, repo } = req.body ?? {};
    const result = await syncRoadmap({ sessionNotes: sessionNotes ?? '', commits: commits ?? [], repo: repo ?? '' });
    if (!result) return res.json({ status: 'skipped', reason: 'No changes needed' });
    res.json({ status: 'ok', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sync', async (req, res) => {
  res.json({ status: 'started', message: 'Full Confluence sync running in background — may take several minutes' });
  setImmediate(async () => {
    try {
      const result = await fullSync();
      console.log(`[manual] Full sync complete: ${result.success.length} ok, ${result.failed.length} failed`);
    } catch (err) { console.error('[manual] Full sync error:', err.message); }
  });
});

router.post('/analyze', async (req, res) => {
  try {
    const { repo, branch, commits, sessionNotes } = req.body ?? {};
    if (!commits?.length) return res.status(400).json({ error: 'commits array required' });
    const updates = await analyzeAndPlanUpdates({ repo: repo ?? '', branch: branch ?? 'develop', commits, sessionNotes });
    res.json({ status: 'ok', updates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
