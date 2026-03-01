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
  // Check dev-journal files for Day N in title
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
  // Strip wrapping code fences if Groq added them
  raw = raw.replace(/^```(?:markdown|md)?\n/, '').replace(/\n```$/, '').trim();
  if (!raw.startsWith('---')) {
    console.warn('[journal] Missing frontmatter opener');
    return raw;
  }
  // Ensure frontmatter is closed
  const second = raw.indexOf('---', 3);
  if (second === -1) {
    console.warn('[journal] Missing frontmatter closer — fixing');
    const firstBlank = raw.indexOf('\n\n');
    return raw.slice(0, firstBlank) + '\n---' + raw.slice(firstBlank);
  }
  return raw;
}

/**
 * Write a journal blog post.
 *
 * @param {Date}   date         - Date for the journal (defaults to today)
 * @param {Array}  docUpdates   - Doc files updated today [{path, summary}]
 * @param {string} sessionNotes - Raw notes / conversation summary from the session.
 *                                When provided, this is the PRIMARY source.
 *                                GitHub activity becomes supplementary context only.
 */
async function writeJournal(date, docUpdates = [], sessionNotes = '') {
  const today = date ?? new Date();
  const dateStr = today.toISOString().slice(0, 10);

  console.log(`[journal] Fetching day number and activity for ${dateStr}...`);
  const [dayNumber, repoData] = await Promise.all([
    fetchNextDayNumber(),
    Promise.all(REPOS.map(fetchTodayEvents)),
  ]);

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

  const systemPrompt = `You are a technical writer for an open source platform project called Product Platform Solutions, built by Ananga M Chatterjee.

You write daily dev journal blog posts that are published on the project's Docusaurus site.

Here are two example posts to match exactly in style and format:

EXAMPLE 1:
---
slug: session-1-foundation
title: "Day 1: Building the Foundation"
authors: [ananga]
tags: [github, keycloak, setup]
---

Started from absolute zero. The goal: build an enterprise-grade IAM platform using only open source tools at zero cost.

<!-- truncate -->

## What We Did

Started from absolute zero. The goal: build an enterprise-grade IAM platform using only open source tools at zero cost.

### Accomplished
- Created GitHub organization
- Deployed Keycloak 23.0 with PostgreSQL backend
- Verified SSO login working

### Key Decisions
- Chose Keycloak over Authentik — more complete enterprise feature set
- Used Docker Compose over bare metal — reproducible, portable

### Issues Encountered
- Gitpod ran out of OCU credits mid-session
- Migrated to GitHub Codespaces

### Next Session
- MFA in Keycloak
- SCIM provisioning

EXAMPLE 2:
---
slug: session-3-auto-tracker
title: "Day 3: Building the Auto-Tracker"
authors: [ananga]
tags: [auto-tracker, groq, github-actions, automation]
---

Built a complete automated ticket tracking system from scratch.

<!-- truncate -->

## What We Did

Built a complete automated ticket tracking system from scratch.

### Accomplished
- Built GitHub Actions tracker workflow
- Integrated Groq for AI enrichment
- Set up PM2 for process management

### Issues Encountered
- Groq model deprecated — updated to current version
- GitHub Actions SSL cert issue — fixed with -k flag

### Next Session
- MFA in Keycloak
- LDAP federation

CRITICAL FORMAT RULES:
- Start with --- on line 1
- frontmatter must close with --- on its own line before any content
- tags MUST be a YAML array: tags: [tag1, tag2]
- Only use tags from: github, keycloak, setup, aws, traefik, https, react, auto-tracker, n8n, groq, github-actions, automation, doc-engine, journal, iam-platform, ai-debug-agent, platform-docs, incident, mfa, scim, ldap
- authors must be exactly: authors: [ananga]
- slug format: dev-journal-YYYY-MM-DD
- One short summary sentence before <!-- truncate -->
- <!-- truncate --> must appear after the summary sentence
- Sections: What We Did, Accomplished, Key Decisions, Issues Encountered, Documentation Updates (if any), Next Session
- Skip sections that have nothing to add
- Write in first person, specific and honest — not marketing speak
- Keep under 600 words`;

  const userPrompt = `Write the Day ${dayNumber} journal post for ${dateStr}.

${sessionNotes ? `SESSION NOTES (primary source — this is what actually happened, write the journal based on this):\n${sessionNotes}` : ''}

${activitySummary ? `GITHUB ACTIVITY (supplementary context):\n${activitySummary}` : ''}
${docUpdatesSection}

Use the session notes as the primary narrative. GitHub activity is just supporting data.
Make it read like a real engineering session recap — specific about what broke, what was fixed, and why decisions were made.`;

  console.log('[journal] Calling Groq...');
  const raw = await ask(systemPrompt, userPrompt, 1500);
  const markdown = sanitizeMarkdown(raw);

  const path = `blog/${dateStr}-dev-journal.md`;
  const urls = await publishAll({
    path,
    content: markdown,
    message: `blog(journal): day ${dayNumber} dev journal ${dateStr} [doc-engine]`, type: 'journal',
  });

  console.log('[journal] Published:', urls);
  return { path, github: urls.github, confluence: urls.confluence, date: dateStr, dayNumber };
}

module.exports = { writeJournal };
