const { ask } = require('../groq');
const { publishAll } = require('../publishers');
const { fetchDoc } = require('../intelligence/analyzer');

async function syncRoadmap({ commits = [], sessionNotes = '', repo = '' }) {
  console.log('[roadmap] Syncing roadmap checkboxes...');
  const currentRoadmap = await fetchDoc('docs/00-project-overview/roadmap.md');
  if (!currentRoadmap) { console.warn('[roadmap] Not found, skipping'); return null; }

  const uncheckedItems = (currentRoadmap.match(/- \[ \] .+/g) ?? []).slice(0, 30);
  if (uncheckedItems.length === 0) { console.log('[roadmap] No unchecked items'); return null; }

  const commitSummary = commits.map(c => `- ${c.message?.split('\n')[0] ?? ''}`).join('\n');

  const systemPrompt = `You maintain a project roadmap markdown file.
Given recent development activity, tick completed items by changing "- [ ]" to "- [x]".
Return the COMPLETE updated roadmap markdown.
Only tick items clearly completed by the evidence. Be conservative.
Return only raw markdown, no code fences.`;

  const userPrompt = `Current roadmap:
${currentRoadmap}

Recent commits in ${repo}:
${commitSummary || '(none)'}
${sessionNotes ? `\nSession notes:\n${sessionNotes}` : ''}

Unchecked items:
${uncheckedItems.join('\n')}

Return complete updated roadmap with appropriate items ticked.`;

  const updatedRoadmap = await ask(systemPrompt, userPrompt, 3000);
  const cleanResponse = updatedRoadmap.replace(/```markdown?|```/g, '').trim();
  if (cleanResponse === currentRoadmap.trim()) { console.log('[roadmap] No changes needed'); return null; }

  const beforeCount = (currentRoadmap.match(/- \[x\]/gi) ?? []).length;
  const afterCount = (cleanResponse.match(/- \[x\]/gi) ?? []).length;
  const newlyTicked = afterCount - beforeCount;
  if (newlyTicked <= 0) { console.log('[roadmap] No new items ticked'); return null; }

  console.log(`[roadmap] Ticking ${newlyTicked} items...`);
  const urls = await publishAll({
    path: 'docs/00-project-overview/roadmap.md',
    content: cleanResponse,
    message: `docs(roadmap): tick ${newlyTicked} completed item(s) [doc-engine]`,
    type: 'doc',
    pageTitle: 'Roadmap',
  });
  console.log('[roadmap] Synced:', urls);
  return { ticked: newlyTicked, urls };
}

module.exports = { syncRoadmap };
