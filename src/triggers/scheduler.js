const cron = require('node-cron');
const { writeJournal } = require('../writers/journal');
function startScheduler() {
  cron.schedule('55 23 * * *', async () => {
    console.log('[scheduler] Running nightly journal...');
    try { const r = await writeJournal(); if (r) console.log(`[scheduler] Journal: ${r.url}`); }
    catch (err) { console.error('[scheduler] Journal failed:', err.message); }
  });
  console.log('[scheduler] Cron registered: daily journal at 23:55 UTC');
}
module.exports = { startScheduler };
