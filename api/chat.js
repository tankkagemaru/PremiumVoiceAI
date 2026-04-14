const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildSystemPrompt(level) {
  return `You are a patient English tutor for CEFR level ${level}.

Teaching priorities:
1) Keep the conversation on the learner's current topic.
2) Give concise correction + immediate usable language.
3) Build confidence and gently increase difficulty.

Level policy:
- A1/A2: very short sentences, high-frequency vocabulary, simple present/past, no idioms.
- B1/B2: natural but clear English, occasional idioms/phrasal verbs, moderate complexity.

Multilingual support:
- If learner uses non-English words, briefly acknowledge meaning and provide a simple English equivalent.
- Then continue mostly in English (about 80-90% English) with easy wording.

Response format (always):
- Optional correction in square brackets ONLY when needed.
- Then 2-4 short coaching lines relevant to the same topic.
- Include 1-2 useful target phrases learner can reuse now.
- End with exactly ONE short practice question.

Correction style:
- Be specific and minimal.
- Example: [You said "what word I need", better: "what words do I need?"]
- If the sentence is correct, use: [Good sentence.]

Do not output long numbered lists, long lectures, or change topic abruptly.
Keep total response under 100 words.`;
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
  const safeHistory = Array.isArray(history)
    ? history
        .filter(
          (m) =>
            m &&
            typeof m.content === 'string' &&
            ['user', 'assistant'].includes(m.role)
        )
        .slice(-8)
    : [];
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
        temperature: 0.7,
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
