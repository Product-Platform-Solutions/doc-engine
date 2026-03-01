const GITHUB_API = 'https://api.github.com';
async function publishDoc({ path, content, message }) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.DOCS_REPO_OWNER || 'Product-Platform-Solutions';
  const repo  = process.env.DOCS_REPO_NAME  || 'platform-docs';
  const branch = process.env.DOCS_BRANCH    || 'main';
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const apiPath = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  let sha;
  const existing = await fetch(`${apiPath}?ref=${branch}`, { headers });
  if (existing.ok) { const data = await existing.json(); sha = data.sha; }
  const body = {
    message, branch,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(apiPath, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.text(); throw new Error(`GitHub API error ${res.status}: ${err}`); }
  const result = await res.json();
  return result.content?.html_url ?? `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
}
module.exports = { publishDoc };
