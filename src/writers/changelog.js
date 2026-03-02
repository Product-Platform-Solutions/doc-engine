const { ask } = require('../groq');
const { publishAll } = require('../publishers');


function sanitizeMarkdown(raw) {
  // Strip wrapping code fences
  raw = raw.replace(/^```(?:markdown|md)?\n/, '').replace(/\n```$/, '').trim();
  if (!raw.startsWith('---')) return raw;

  // Split into lines and find where the frontmatter fields end
  const lines = raw.split('\n');
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let insertAt = -1;

  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && lines[i].trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (lines[i].trim() === '---') {
        frontmatterClosed = true;
        break;
      }
      // If we hit a blank line or non-YAML content before closing ---, that's the problem
      if (lines[i].trim() === '' || (!/^[\w-]+:/.test(lines[i]) && !lines[i].startsWith(' ') && !lines[i].startsWith('-'))) {
        insertAt = i;
        break;
      }
    }
  }

  if (!frontmatterClosed && insertAt !== -1) {
    console.warn('[sanitize] Inserting missing frontmatter closer at line', insertAt);
    lines.splice(insertAt, 0, '---');
    return lines.join('\n');
  }

  return raw;
}


async function writeChangelog(payload) {
  const repo = payload.repository?.name ?? payload.repo ?? 'unknown';
  const owner = payload.repository?.owner?.login ?? process.env.GITHUB_ORG ?? 'Product-Platform-Solutions';
  const branch = (payload.ref ?? '').replace('refs/heads/', '') || payload.branch || 'main';
  const pusher = payload.pusher?.name ?? 'unknown';
  const today = new Date().toISOString().slice(0,10);
  const rawCommits = payload.commits ?? [];
  const commitLines = rawCommits.map(c => `- ${c.message?.split('\n')[0] ?? c} (${c.author?.name ?? 'unknown'})`).join('\n');
  if (!commitLines.trim()) { console.log('[changelog] No commits, skipping.'); return null; }
  const systemPrompt = `You are a technical writer. Write a clean developer-friendly changelog entry in Markdown. Format: Docusaurus-compatible with frontmatter. MUST start with --- on line 1 and close with --- before any content. IMPORTANT: tags must be a YAML array e.g. tags: [changelog, repo-name] — never a comma-separated string. Group by type (feat, fix, docs, chore). Be concise.`;
  const userPrompt = `Changelog for ${repo} (branch: ${branch}) on ${today}. Pushed by: ${pusher}.\n\nCommits:\n${commitLines}\n\n1. Frontmatter: title, date, tags: [changelog, ${repo}]\n2. One-sentence summary\n3. Changes grouped by type\nUnder 250 words.`;
  console.log(`[changelog] Writing for ${repo}@${branch}...`);
  const markdown = sanitizeMarkdown(await ask(systemPrompt, userPrompt, 768));
  const path = `docs/changelog/${today}-${repo}.md`;
  const urls = await publishAll({ path, content: markdown, message: `docs(changelog): ${repo} ${branch} on ${today} [doc-engine]` });
  console.log(`[changelog] Published:`, urls);
  return { path, github: urls.github, confluence: urls.confluence, repo, branch, date: today };
}
async function writeReleaseNote(payload) {
  const repo = payload.repository?.name ?? 'unknown';
  const release = payload.release ?? {};
  const tag = release.tag_name ?? 'unknown';
  const body = release.body ?? '';
  const author = release.author?.login ?? 'unknown';
  const today = new Date().toISOString().slice(0,10);
  const systemPrompt = `You are a technical writer. Write a clean release note in Markdown. Format: Docusaurus-compatible with frontmatter. IMPORTANT: tags must be a YAML array e.g. tags: [changelog, repo-name] — never a comma-separated string.`;
  const userPrompt = `Release note for ${repo} version ${tag} on ${today} by ${author}.\n\nRelease notes:\n${body || '(none provided)'}\n\n1. Frontmatter: title, date, tags: [release, ${repo}]\n2. What this release is\n3. What changed\n4. Update instructions\nUnder 300 words.`;
  console.log(`[changelog] Release note for ${repo}@${tag}...`);
  const markdown = await ask(systemPrompt, userPrompt, 768);
  const path = `docs/changelog/${today}-${repo}-${tag}.md`;
  const urls = await publishAll({ path, content: markdown, message: `docs(release): ${repo} ${tag} [doc-engine]` });
  console.log(`[changelog] Released:`, urls);
  return { path, github: urls.github, confluence: urls.confluence, repo, tag, date: today };
}
module.exports = { writeChangelog, writeReleaseNote };
