const express = require('express');
const { writeJournal }        = require('../writers/journal');
const { writeChangelog }      = require('../writers/changelog');
const { writeIncidentReport } = require('../writers/incident-report');
const { updateDoc }           = require('../writers/doc-updater');

const router = express.Router();
router.use(express.json());

function auth(req, res, next) {
  const key = process.env.DOC_ENGINE_API_KEY;
  if (!key) return next();
  const provided = req.headers['x-api-key'] ?? req.query.key;
  if (provided !== key) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

// ─── Health ────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'doc-engine',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Journal ───────────────────────────────────────────────────────────────

router.post('/journal', auth, async (req, res) => {
  try {
    const date = req.body?.date ? new Date(req.body.date) : new Date();
    const docUpdates = req.body?.doc_updates ?? [];
    const sessionNotes = req.body?.session_notes ?? '';
    const result = await writeJournal(date, docUpdates, sessionNotes);
    if (!result) return res.json({ status: 'skipped', reason: 'No activity found' });
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('[manual] Journal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Changelog ─────────────────────────────────────────────────────────────

router.post('/changelog', auth, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.repository?.name && !payload.repo) {
      return res.status(400).json({ error: 'Missing repo name' });
    }
    if (payload.repo && !payload.repository) {
      payload.repository = { name: payload.repo, owner: { login: process.env.GITHUB_ORG ?? 'Product-Platform-Solutions' } };
      payload.ref = `refs/heads/${payload.branch ?? 'main'}`;
    }
    const result = await writeChangelog(payload);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('[manual] Changelog error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Incident ──────────────────────────────────────────────────────────────

router.post('/incident', auth, async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.service || !payload.pattern) {
      return res.status(400).json({ error: 'Missing service or pattern' });
    }
    const result = await writeIncidentReport(payload);
    res.json({ status: 'ok', ...result });
  } catch (err) {
    console.error('[manual] Incident error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Doc Update ────────────────────────────────────────────────────────────
// Update a specific documentation file AND optionally record it in today's journal.
//
// Body:
// {
//   "doc_path": "docs/00-project-overview/vision.md",
//   "change_desc": "Add doc-engine to the platform products table",
//   "new_content": "...",   // optional — if omitted Groq generates the update
//   "context": "...",       // optional extra context for Groq
//   "add_to_journal": true  // optional — also write/update today's journal entry
// }

router.post('/doc', auth, async (req, res) => {
  try {
    const { doc_path, change_desc, new_content, context, add_to_journal = true } = req.body;

    if (!doc_path || !change_desc) {
      return res.status(400).json({ error: 'Missing doc_path or change_desc' });
    }

    // Update the doc
    const docResult = await updateDoc({
      docPath: doc_path,
      changeDesc: change_desc,
      newContent: new_content,
      context,
    });

    let journalResult = null;

    // Optionally fold into today's journal
    if (add_to_journal) {
      journalResult = await writeJournal(new Date(), [docResult]);
    }

    res.json({
      status: 'ok',
      doc: docResult,
      journal: journalResult,
    });
  } catch (err) {
    console.error('[manual] Doc update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
