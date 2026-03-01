const { publishDoc }          = require('./github');
const { publishToConfluence } = require('./confluence');

const CONFLUENCE_SECTIONS = {
  journal:   'Dev Journal',
  changelog: 'Changelogs',
  incident:  'Incidents',
  doc:       'Documentation',
};

async function publishAll({ path, content, message, type = 'doc', pageTitle }) {
  const results = {};
  try {
    results.github = await publishDoc({ path, content, message });
    console.log(`[publisher] GitHub: ${results.github}`);
  } catch (err) {
    console.error(`[publisher] GitHub failed: ${err.message}`);
    results.github = null;
  }
  const confluenceEnabled = !!(process.env.CONFLUENCE_BASE_URL && process.env.CONFLUENCE_EMAIL && process.env.CONFLUENCE_API_TOKEN);
  if (confluenceEnabled) {
    try {
      const section = CONFLUENCE_SECTIONS[type] ?? 'Documentation';
      results.confluence = await publishToConfluence({ content, section, pageTitle });
    } catch (err) {
      console.error(`[publisher] Confluence failed: ${err.message}`);
      results.confluence = null;
    }
  } else {
    console.log('[publisher] Confluence not configured — skipping');
    results.confluence = null;
  }
  return results;
}

module.exports = { publishAll };
