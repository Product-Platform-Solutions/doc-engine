const { publishToConfluence } = require('./confluence');
const { listAllDocs, fetchDoc } = require('../intelligence/analyzer');

function pathToSection(filePath) {
  if (filePath.startsWith('blog/')) return 'Dev Journal';
  if (filePath.includes('changelog')) return 'Changelogs';
  if (filePath.includes('incidents')) return 'Incidents';
  if (filePath.includes('00-project-overview')) return 'Project Overview';
  if (filePath.includes('01-getting-started')) return 'Getting Started';
  if (filePath.includes('02-development-journal')) return 'Development Journal';
  if (filePath.includes('03-features')) return 'Features';
  if (filePath.includes('04-issues-and-resolutions')) return 'Issues & Resolutions';
  if (filePath.includes('05-architecture-decisions')) return 'Architecture';
  if (filePath.includes('06-api-reference')) return 'API Reference';
  if (filePath.includes('07-runbooks')) return 'Runbooks';
  if (filePath.includes('08-release-notes')) return 'Release Notes';
  if (filePath.includes('09-ecosystem')) return 'Ecosystem';
  if (filePath.includes('10-session-logs')) return 'Session Logs';
  return 'Documentation';
}

function extractPageTitle(content, filePath) {
  const fmMatch = content?.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/);
  if (fmMatch) return fmMatch[1].trim().replace(/^["']|["']$/g, '');
  const h1Match = content?.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return filePath.split('/').pop().replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function syncFile(filePath) {
  const content = await fetchDoc(filePath);
  if (!content) { console.warn(`[confluence-sync] Could not fetch ${filePath}`); return null; }
  const section = pathToSection(filePath);
  const pageTitle = extractPageTitle(content, filePath);
  try {
    const url = await publishToConfluence({ content, section, pageTitle });
    return { filePath, pageTitle, section, url };
  } catch (err) {
    console.error(`[confluence-sync] Failed ${filePath}: ${err.message}`);
    return null;
  }
}

function getChangedFiles(payload) {
  const files = new Set();
  for (const commit of payload.commits ?? []) {
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      if (f.endsWith('.md')) files.add(f);
    }
  }
  return [...files];
}

async function incrementalSync(payload) {
  const changedFiles = getChangedFiles(payload);
  if (changedFiles.length === 0) { console.log('[confluence-sync] No markdown files changed'); return []; }
  console.log(`[confluence-sync] Incremental sync: ${changedFiles.length} files`);
  const results = [];
  for (const filePath of changedFiles) {
    if (filePath.includes('changelog/') || filePath.includes('incidents/')) continue;
    console.log(`[confluence-sync] Syncing ${filePath}...`);
    const result = await syncFile(filePath);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[confluence-sync] Done: ${results.length} synced`);
  return results;
}

async function fullSync() {
  console.log('[confluence-sync] Starting FULL sync...');
  const allFiles = await listAllDocs();
  console.log(`[confluence-sync] ${allFiles.length} files to sync`);
  const results = { success: [], failed: [] };
  for (const filePath of allFiles) {
    console.log(`[confluence-sync] Syncing ${filePath}...`);
    const result = await syncFile(filePath);
    if (result) results.success.push(result);
    else results.failed.push(filePath);
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`[confluence-sync] Complete: ${results.success.length} ok, ${results.failed.length} failed`);
  return results;
}

module.exports = { fullSync, incrementalSync, syncFile };

// Override syncFile for blog posts — use blog post API instead of regular pages
const { publishBlogPost } = require('./confluence');
const _origSyncFile = syncFile;

async function syncBlogFile(filePath, content) {
  const pageTitle = extractPageTitle(content, filePath);
  // Extract date from filename e.g. 2026-03-02-dev-journal.md
  const dateMatch = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  const postingDay = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
  try {
    const url = await publishBlogPost({ content, pageTitle, postingDay });
    return { filePath, pageTitle, url };
  } catch (err) {
    console.error(`[confluence-sync] Blog post sync failed ${filePath}: ${err.message}`);
    return null;
  }
}

module.exports = { fullSync, incrementalSync, syncFile };
