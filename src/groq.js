const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
async function ask(systemPrompt, userPrompt, maxTokens = 2048) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Groq error ${res.status}: ${err}`); }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}
module.exports = { ask };
