const { ask } = require('../groq');
const { publishAll } = require('../publishers');

const GITHUB_API = 'https://api.github.com';

/**
 * Fetch the current content of a doc from platform-docs.
 */
async function fetchCurrentDoc(docPath) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.DOCS_REPO_OWNER || 'Product-Platform-Solutions';
  const repo  = process.env.DOCS_REPO_NAME  || 'platform-docs';
  const branch = process.env.DOCS_BRANCH    || 'develop';

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${docPath}?ref=${branch}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      }
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

/**
 * Update a specific documentation file with new information.
 *
 * @param {object} opts
 * @param {string} opts.docPath     - Path in platform-docs e.g. "docs/00-project-overview/vision.md"
 * @param {string} opts.changeDesc  - Human description of what changed e.g. "Add doc-engine to vision table"
 * @param {string} opts.newContent  - Optional: full replacement content. If not provided, Groq generates it.
 * @param {string} opts.context     - Optional: extra context to help Groq make the right changes
 */
async function updateDoc({ docPath, changeDesc, newContent, context = '' }) {
  console.log(`[doc-updater] Updating ${docPath}...`);

  let finalContent = newContent;

  if (!finalContent) {
    const currentContent = await fetchCurrentDoc(docPath);

    const systemPrompt = `You are a technical writer maintaining documentation for an open source platform project.
You will be given the current content of a documentation file and a description of what needs to change.
Return ONLY the complete updated markdown file — no explanations, no code fences, just the raw markdown.
Preserve the existing frontmatter, structure, and style. Make only the changes described.`;

    const userPrompt = `Current doc (${docPath}):
${currentContent || '(file does not exist yet — create it from scratch)'}

Change required:
${changeDesc}

${context ? `Additional context:\n${context}` : ''}

Return the complete updated markdown file.`;

    console.log('[doc-updater] Calling Groq to update doc...');
    finalContent = await ask(systemPrompt, userPrompt, 2048);
  }

  const urls = await publishAll({
    path: docPath,
    content: finalContent,
    message: `docs: ${changeDesc} [doc-engine]`,
  });

  console.log(`[doc-updater] Published: ${url}`);
  return {
    path: docPath,
    url,
    summary: changeDesc,
  };
}

module.exports = { updateDoc };
