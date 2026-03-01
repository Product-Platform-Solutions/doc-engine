const { ask } = require('../groq');
const { publishAll } = require('../publishers');
async function writeIncidentReport(payload) {
  const { service='unknown', severity='unknown', pattern='unknown', raw_log='', analysis='', timestamp=new Date().toISOString() } = payload;
  const date = new Date(timestamp);
  const dateStr = date.toISOString().slice(0,10);
  const timeStr = date.toISOString().slice(11,19);
  const systemPrompt = `You are an SRE writing a blameless post-incident report in Markdown. Format: Docusaurus-compatible with frontmatter. IMPORTANT: tags must be a YAML array e.g. tags: [incident, service-name] — never a comma-separated string. Be factual and useful for future on-call engineers.`;
  const userPrompt = `Incident on ${dateStr} at ${timeStr} UTC.\nService: ${service}\nSeverity: ${severity}\nPattern: ${pattern}\n\nLog:\n\`\`\`\n${raw_log.slice(0,800)}\n\`\`\`\n\nAnalysis:\n${analysis}\n\nSections: Summary, Impact, Timeline, Root Cause, Resolution, Action Items. Under 400 words.`;
  console.log(`[incident] Writing report for ${service}/${pattern}...`);
  const markdown = await ask(systemPrompt, userPrompt, 1024);
  const slug = pattern.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
  const path = `docs/incidents/${dateStr}-${service}-${slug}.md`;
  const urls = await publishAll({ path, content: markdown, message: `docs(incident): ${service} ${pattern} on ${dateStr} [doc-engine]` });
  console.log(`[incident] Published: ${url}`);
  return { path, url, service, severity, pattern, date: dateStr };
}
module.exports = { writeIncidentReport };
