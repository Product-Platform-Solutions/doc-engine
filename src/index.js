require('./env');
const express = require('express');
const { startScheduler } = require('./triggers/scheduler');
const app = express();
const PORT = process.env.PORT ?? 3002;
app.use(express.json());
app.use('/webhook', require('./triggers/webhook'));
app.use('/trigger', require('./triggers/manual'));
app.get('/', (_req, res) => res.json({
  service: 'doc-engine', version: '1.0.0',
  endpoints: {
    health:    'GET  /trigger/health',
    journal:   'POST /trigger/journal',
    changelog: 'POST /trigger/changelog',
    incident:  'POST /trigger/incident',
    webhook:   'POST /webhook/github',
  }
}));
app.listen(PORT, () => {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║          doc-engine  v1.0.0           ║');
  console.log('╚═══════════════════════════════════════╝\n');
  console.log(`Listening on port ${PORT}`);
  console.log('Triggers: webhook | manual API | cron scheduler\n');
  startScheduler();
});
process.on('uncaughtException', err => console.error('[doc-engine] Uncaught:', err.message));
process.on('unhandledRejection', reason => console.error('[doc-engine] Rejection:', reason));
