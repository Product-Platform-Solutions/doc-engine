const { ask } = require('../groq');
const { publishAll } = require('../publishers');

const GITHUB_API = 'https://api.github.com';
const REPOS = ['iam-platform','auto-tracker','ai-debug-agent','platform-docs','doc-engine'];
const ORG = process.env.GITHUB_ORG || 'Product-Platform-Solutions';

async function fetchNextDayNumber() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.DOCS_REPO_OWNER || 'Product-Platform-Solutions';
  const repo  = process.env.DOCS_REPO_NAME  || 'platform-docs';
  const branch = process.env.DOCS_BRANCH    || 'develop';
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/blog?ref=${branch}`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } }
  );
  if (!res.ok) return 1;
  const files = await res.json();
  let max = 0;
  for (const f of files) {
    const m = f.name.match(/session-(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1]));
  }
  const journalFiles = files.filter(f => f.name.includes('dev-journal'));
  for (const f of journalFiles) {
    const r = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/blog/${f.name}?ref=${branch}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } }
    );
    if (!r.ok) continue;
    const data = await r.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const titleMatch = content.match(/title:\s*["']?Day (\d+):/i);
    if (titleMatch) max = Math.max(max, parseInt(titleMatch[1]));
  }
  return max + 1;
}

async function fetchTodayEvents(repo) {
  const token = process.env.GITHUB_TOKEN;
  const since = new Date(); since.setHours(0,0,0,0);
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };
  const commitsRes = await fetch(`${GITHUB_API}/repos/${ORG}/${repo}/commits?since=${since.toISOString()}&per_page=20`, { headers });
  const commits = commitsRes.ok ? await commitsRes.json() : [];
  const issuesRes = await fetch(`${GITHUB_API}/repos/${ORG}/${repo}/issues?since=${since.toISOString()}&state=all&per_page=20`, { headers });
  const issues = issuesRes.ok ? await issuesRes.json() : [];
  return {
    repo,
    commits: Array.isArray(commits) ? commits : [],
    issues: Array.isArray(issues) ? issues : [],
  };
}

function buildActivitySummary(repoData) {
  const lines = [];
  for (const { repo, commits, issues } of repoData) {
    if (commits.length === 0 && issues.length === 0) continue;
    lines.push(`### ${repo}`);
    if (commits.length > 0) {
      lines.push('Commits:');
      for (const c of commits.slice(0, 10))
        lines.push(`- ${c.commit?.message?.split('\n')[0] ?? 'no message'} (${c.commit?.author?.name ?? 'unknown'})`);
    }
    if (issues.length > 0) {
      lines.push('Issues:');
      for (const i of issues.slice(0, 10))
        lines.push(`- [#${i.number}] ${i.title} — ${i.state}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function sanitizeMarkdown(raw) {
  raw = raw.replace(/^```(?:markdown|md)?\n/, '').replace(/\n```$/, '').trim();
  if (!raw.startsWith('---')) return raw;
  const lines = raw.split('\n');
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let insertAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && lines[i].trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (lines[i].trim() === '---') { frontmatterClosed = true; break; }
      if (lines[i].trim() === '' || (!/^[\w-]+:/.test(lines[i]) && !lines[i].startsWith(' ') && !lines[i].startsWith('-'))) {
        insertAt = i; break;
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

async function writeJournal(date, docUpdates = [], sessionNotes = '', dayNumberOverride = null) {
  const today = date ?? new Date();
  const dateStr = today.toISOString().slice(0, 10);

  console.log(`[journal] Fetching day number and activity for ${dateStr}...`);
  let [dayNumber, repoData] = await Promise.all([
    fetchNextDayNumber(),
    Promise.all(REPOS.map(fetchTodayEvents)),
  ]);

  if (dayNumberOverride) dayNumber = dayNumberOverride;
  console.log(`[journal] Day number: ${dayNumber}`);
  const activitySummary = buildActivitySummary(repoData);
  const hasContent = sessionNotes.trim() || activitySummary.trim() || docUpdates.length > 0;

  if (!hasContent) {
    console.log('[journal] No content for today, skipping.');
    return null;
  }

  const docUpdatesSection = docUpdates.length > 0
    ? `\nDoc updates made today:\n${docUpdates.map(d => `- ${d.path}: ${d.summary}`).join('\n')}`
    : '';

  const systemPrompt = `You are writing a dev journal for an open source platform project called Product Platform Solutions, built by Ananga M Chatterjee — a solo platform engineer.

This journal is published publicly on the project's docs site. It should read like a senior engineer reflecting on their day — honest, specific, narrative. Think of it as a combination of a war story and a technical log. People reading this should feel like they were in the room.

TONE AND STYLE:
- Write in first person, past tense
- Conversational but technically precise
- Tell the story of what happened — not a summary of outcomes
- Include the messy details: what you tried that didn't work, what confused you, the moment something clicked
- Name specific tools, commands, error messages, API endpoints where relevant
- Explain the reasoning behind decisions — not just what was decided but why
- If something was frustrating, say so. If something was surprisingly elegant, say so.
- Do NOT use corporate speak. Never write "leveraged" or "utilized" or "streamlined"

STRUCTURE:
- Start with a strong opening paragraph that sets the scene for the day — what was the main challenge or goal?
- Then tell the story chronologically — what happened first, what that led to, what broke, how it got fixed
- Use ## headers sparingly, only when genuinely shifting to a different topic
- End with a short paragraph on what's next and any open questions
- Aim for 800-1200 words — enough to tell the story properly, not padded

CRITICAL FORMAT RULES:
- Start with --- on line 1
- Frontmatter fields MUST include: slug, title, authors, tags, date
- slug format: dev-journal-YYYY-MM-DD
- date format: YYYY-MM-DD (e.g. date: 2026-03-17)
- title MUST include the day number and a punchy description of the main challenge
  Good examples: "Day 12: Wrestling with Atlassian Auth", "Day 7: The Infinite Loop That Ate the Server"
  Bad examples: "Dev Journal 2026-03-17", "Day 12: Enhancing the Doc Engine"
- authors must be exactly: authors: [ananga]
- tags MUST be a YAML array using only: github, keycloak, setup, aws, traefik, https, react, auto-tracker, n8n, groq, github-actions, automation, doc-engine, journal, iam-platform, ai-debug-agent, platform-docs, incident, mfa, scim, ldap, confluence, docusaurus, docker, nginx, pm2, oauth, cloudflare, atlassian
- Frontmatter MUST close with --- on its own line
- IMMEDIATELY after the closing ---, write ONE punchy hook sentence (1-2 sentences max) that teases the main story
- Then on the very next line write exactly: <!-- truncate -->
- The full journal narrative (800-1200 words) comes AFTER <!-- truncate -->
- NEVER put <!-- truncate --> at the bottom or anywhere except right after the hook sentence

WHAT MAKES A GREAT JOURNAL ENTRY:
- Specific error messages and how they were diagnosed
- The actual commands that were run
- The moment where something unexpected happened and how you responded
- Decisions with tradeoffs explained — not just what was chosen
- Honest reflection on what took longer than expected and why
- Real timestamps or sequence of events when relevant`;

  const userPrompt = `Write the Day ${dayNumber} journal post for ${dateStr}.

${sessionNotes ? `SESSION NOTES — this is what actually happened today. Write the journal as if you lived through this:\n\n${sessionNotes}` : ''}

${activitySummary ? `GITHUB ACTIVITY (use as supporting detail, not the main story):\n${activitySummary}` : ''}
${docUpdatesSection}

Write a full narrative journal entry of 800-1200 words. Tell the story of the day — the struggles, the debugging, the decisions, the wins. Make it read like a human wrote it after a long day of engineering work.`;

  console.log('[journal] Calling Groq...');
  const raw = await ask(systemPrompt, userPrompt, 3000);
  const markdown = sanitizeMarkdown(raw);

  const path = `blog/${dateStr}-dev-journal.md`;
  const urls = await publishAll({
    path,
    content: markdown,
    message: `blog(journal): day ${dayNumber} dev journal ${dateStr} [doc-engine]`,
    type: 'journal',
  });

  console.log('[journal] Published:', urls);
  return { path, github: urls.github, confluence: urls.confluence, date: dateStr, dayNumber };
}

module.exports = { writeJournal };
