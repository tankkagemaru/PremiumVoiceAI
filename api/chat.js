const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function buildSystemPrompt(level) {
  return `You are a patient English tutor. Your goal is to have a natural conversation at ${level}.

If the user is A1/A2: Use simple present/past, common vocabulary, and short sentences.

If the user is B1/B2: Use complex structures and idiomatic expressions.

Always wrap corrections in square brackets, e.g., '[You said "I goes", but it should be "I go".]' Then continue the conversation.

Also provide a short conversational response after the correction note (or no correction if none needed).
Keep response under 120 words.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, level } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text input' });
  }

  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';

  try {
    const apiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.7,
        messages: [
          { role: 'system', content: buildSystemPrompt(safeLevel) },
          { role: 'user', content: text }
        ]
      })
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      return res.status(apiRes.status).json({ error: errorText });
    }

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
