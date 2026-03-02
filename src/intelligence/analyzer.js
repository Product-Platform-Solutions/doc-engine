const { ask } = require('../groq');
const GITHUB_API = 'https://api.github.com';

async function fetchDoc(path) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.DOCS_REPO_OWNER || 'Product-Platform-Solutions';
  const repo  = process.env.DOCS_REPO_NAME  || 'platform-docs';
  const branch = process.env.DOCS_BRANCH    || 'develop';
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

async function listDocs(dir = 'docs') {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.DOCS_REPO_OWNER || 'Product-Platform-Solutions';
  const repo  = process.env.DOCS_REPO_NAME  || 'platform-docs';
  const branch = process.env.DOCS_BRANCH    || 'develop';
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${dir}?ref=${branch}`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (!res.ok) return [];
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function listAllDocs() {
  const allFiles = [];
  async function walk(path) {
    const items = await listDocs(path);
    for (const item of items) {
      if (item.type === 'file' && item.name.endsWith('.md')) allFiles.push(item.path);
      else if (item.type === 'dir' && !item.name.startsWith('.')) await walk(item.path);
    }
  }
  await walk('docs');
  await walk('blog');
  return allFiles;
}

async function analyzeAndPlanUpdates({ repo, branch, commits, sessionNotes = '' }) {
  console.log(`[analyzer] Analyzing ${commits.length} commits from ${repo}@${branch}...`);
  const commitSummary = commits.map(c => {
    const msg = c.message?.split('\n')[0] ?? '';
    const files = [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].slice(0, 10);
    return `- ${msg}${files.length > 0 ? `\n  Files: ${files.join(', ')}` : ''}`;
  }).join('\n');

  const [roadmap, vision, techStack] = await Promise.all([
    fetchDoc('docs/00-project-overview/roadmap.md'),
    fetchDoc('docs/00-project-overview/vision-and-goals.md'),
    fetchDoc('docs/00-project-overview/tech-stack.md'),
  ]);

  const allDocs = await listAllDocs();
  const docList = allDocs.filter(f => !f.includes('changelog') && !f.includes('dev-journal')).join('\n');

  const systemPrompt = `You are the intelligence layer of an automated documentation system called doc-engine.
Analyze code commits and determine which documentation files need updating.
Return a JSON array only. Each item: {"docPath": "docs/path/file.md", "changeDescription": "specific change needed", "priority": "high|medium|low", "type": "update|create"}
Rules:
- Only suggest genuinely warranted updates
- Be specific about what should change
- Tick roadmap checkboxes when features are completed
- Update architecture/tech-stack when new tools added
- Do NOT suggest updating changelog or journal files
- Maximum 5 updates
- Return ONLY valid JSON array, no other text`;

  const userPrompt = `Repository: ${repo} (branch: ${branch})
Commits:
${commitSummary}
${sessionNotes ? `\nSession context:\n${sessionNotes}\n` : ''}
Current roadmap:
${roadmap?.slice(0, 2000) ?? '(not found)'}
Available documentation files:
${docList}
Return JSON array of needed updates only.`;

  try {
    const response = await ask(systemPrompt, userPrompt, 1024);
    const clean = response.replace(/```json|```/g, '').trim();
    const updates = JSON.parse(clean);
    if (!Array.isArray(updates)) return [];
    console.log(`[analyzer] Identified ${updates.length} doc updates`);
    return updates;
  } catch (err) {
    console.error('[analyzer] Parse failed:', err.message);
    return [];
  }
}

module.exports = { analyzeAndPlanUpdates, fetchDoc, listAllDocs };
