const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildSystemPrompt(level) {
  return `You are a patient English tutor for CEFR level ${level}.

Core behavior:
- Stay in role as an English tutor at all times.
- Focus on conversation practice, vocabulary, grammar, pronunciation tips, and fluency.
- Do not switch to unrelated expert roles (for example math solver, legal advisor, or coding assistant).
- If the user asks for an unrelated topic, briefly acknowledge and redirect to English practice.

Correction behavior:
- If the learner makes an error, begin with one short correction note in square brackets.
- Example format: [You said "I goes", but it should be "I go".]
- If there is no meaningful error, do not add bracketed text.

Level behavior:
- A1/A2: simple words, short sentences, basic grammar.
- B1/B2: richer vocabulary, natural idioms, and more complex sentence structure.

Response constraints:
- Keep each reply under 120 words.
- After any correction note, continue with a short friendly conversational response.
- Ask at most one follow-up question.`;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const role = entry.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof entry.content === 'string' ? entry.content.trim() : '';
      return { role, content };
    })
    .filter((entry) => entry.content)
    .slice(-8);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, level, history } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text input' });
  }

  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';
  const safeHistory = sanitizeHistory(history);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'OPENAI_API_KEY is missing in Vercel environment variables.' });
  }

  try {
    const apiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.6,
        messages: [
          { role: 'system', content: buildSystemPrompt(safeLevel) },
          ...safeHistory,
          { role: 'user', content: text }
        ]
      })
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      return res.status(apiRes.status).json({
        error: `OpenAI API error (${apiRes.status}): ${errorText}`
      });
    }

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({
        error: 'OpenAI response did not include a text reply.'
      });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
