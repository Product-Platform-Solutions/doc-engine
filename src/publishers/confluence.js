const CONFLUENCE_API = (baseUrl) => `${baseUrl}/wiki/rest/api`;

function markdownToConfluence(markdown) {
  let content = markdown.replace(/^---[\s\S]*?---\n/, '').trim();
  content = content.replace(/<!-- truncate -->/g, '');
  content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
    `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${lang || 'text'}</ac:parameter><ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body></ac:structured-macro>`
  );
  content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
  content = content.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  content = content.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  content = content.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');
  const lines = content.split('\n');
  const result = [];
  let inList = false;
  for (const line of lines) {
    const listMatch = line.match(/^[-*] (.+)/);
    if (listMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${listMatch[1]}</li>`);
    } else {
      if (inList) { result.push('</ul>'); inList = false; }
      if (line.trim() === '') result.push('<p> </p>');
      else if (!line.startsWith('<')) result.push(`<p>${line}</p>`);
      else result.push(line);
    }
  }
  if (inList) result.push('</ul>');
  return result.join('\n');
}

function extractTitle(markdown) {
  const match = markdown.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/);
  return match ? match[1].trim() : 'Untitled';
}

async function findPage(baseUrl, auth, spaceKey, title) {
  const res = await fetch(
    `${CONFLUENCE_API(baseUrl)}/content?spaceKey=${spaceKey}&title=${encodeURIComponent(title)}&expand=version`,
    { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0] ?? null;
}

async function getOrCreateSection(baseUrl, auth, spaceKey, sectionTitle) {
  const existing = await findPage(baseUrl, auth, spaceKey, sectionTitle);
  if (existing) return existing.id;
  const res = await fetch(`${CONFLUENCE_API(baseUrl)}/content`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      type: 'page', title: sectionTitle,
      space: { key: spaceKey },
      body: { storage: { value: '<p>Auto-generated section by doc-engine.</p>', representation: 'storage' } },
    }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Failed to create section "${sectionTitle}": ${err}`); }
  const data = await res.json();
  return data.id;
}

async function publishToConfluence({ content, section, pageTitle }) {
  const baseUrl  = process.env.CONFLUENCE_BASE_URL;
  const email    = process.env.CONFLUENCE_EMAIL;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY || 'PPS';
  if (!baseUrl || !email || !apiToken) {
    console.warn('[confluence] Missing config — skipping');
    return null;
  }
  const auth  = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const title = pageTitle ?? extractTitle(content);
  const body  = markdownToConfluence(content);
  const parentId = await getOrCreateSection(baseUrl, auth, spaceKey, section);
  const existing = await findPage(baseUrl, auth, spaceKey, title);
  if (existing) {
    const newVersion = (existing.version?.number ?? 1) + 1;
    const res = await fetch(`${CONFLUENCE_API(baseUrl)}/content/${existing.id}`, {
      method: 'PUT',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        type: 'page', title, version: { number: newVersion },
        ancestors: [{ id: parentId }],
        body: { storage: { value: body, representation: 'storage' } },
      }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Confluence update failed: ${err}`); }
    const data = await res.json();
    const url = `${baseUrl}/wiki${data._links?.webui ?? ''}`;
    console.log(`[confluence] Updated: ${url}`);
    return url;
  } else {
    const res = await fetch(`${CONFLUENCE_API(baseUrl)}/content`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        type: 'page', title, space: { key: spaceKey },
        ancestors: [{ id: parentId }],
        body: { storage: { value: body, representation: 'storage' } },
      }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Confluence create failed: ${err}`); }
    const data = await res.json();
    const url = `${baseUrl}/wiki${data._links?.webui ?? ''}`;
    console.log(`[confluence] Created: ${url}`);
    return url;
  }
}

module.exports = { publishToConfluence };
