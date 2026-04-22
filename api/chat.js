const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildConversationPrompt(level, speechMeta) {
  const hasConfidence = typeof speechMeta?.confidence === 'number';
  const confidenceText = hasConfidence ? speechMeta.confidence.toFixed(2) : 'unknown';
  const lowConfidence = hasConfidence && speechMeta.confidence < 0.72;

  return `You are a patient English tutor for CEFR level ${level}.

Core behavior:
- Stay in role as an English tutor at all times.
- Focus on conversation practice, vocabulary, grammar, pronunciation tips, and fluency.
- Do not switch to unrelated expert roles (for example math solver, legal advisor, or coding assistant).
- If the user asks for an unrelated topic, briefly acknowledge and redirect to English practice.
- If the learner uses words from their native language (for example Chinese, Arabic, etc.), detect it and help gently:
  1) briefly explain or translate that word/phrase,
  2) give a natural English equivalent,
  3) continue the ESL conversation.

Correction behavior:
- If the learner makes an error, begin with one short correction note in square brackets.
- Example format: [You said "I goes", but it should be "I go".]
- If there is no meaningful error, do not add bracketed text.
- You only receive text transcripts (not raw audio), so infer probable pronunciation issues from likely transcript mistakes and learner spelling patterns.
- If pronunciation seems wrong, provide a short mouth/stress hint and ask for one retry.

Speech signal:
- Browser speech-recognition confidence: ${confidenceText}.
- ${lowConfidence ? 'Confidence is low. Be more proactive in verification and ask for a repeat once.' : 'Use normal verification behavior.'}

Level behavior:
- A1/A2: simple words, short sentences, basic grammar.
- B1/B2: richer vocabulary, natural idioms, and more complex sentence structure.

Response constraints:
- Keep each reply under 120 words.
- After any correction note, continue with a short friendly conversational response.
- Ask at most one follow-up question.`;
}

function buildWordTutorPrompt(level, words, speechMeta) {
  const normalizedWords = words.length ? words.join(', ') : 'teacher-selected simple practice words';
  const hasConfidence = typeof speechMeta?.confidence === 'number';
  const confidenceText = hasConfidence ? speechMeta.confidence.toFixed(2) : 'unknown';
  const lowConfidence = hasConfidence && speechMeta.confidence < 0.72;

  return `You are a focused speaking pronunciation coach for CEFR level ${level}.

Mode behavior:
- This is "Word Speaking Tutor" mode, not free conversation mode.
- Keep the learner focused on saying and repeating target words correctly.
- Current target words: ${normalizedWords}.
- In each turn, give 1-3 word targets max.
- Ask the learner to repeat or say each word in a short sentence.
- Provide short pronunciation help using plain text syllable hints when useful.
- You only receive text transcripts (not raw audio), so infer likely pronunciation errors from transcript substitutions and spelling-like outputs.
- Include stress markers or syllable breaks for difficult words where helpful.

Speech signal:
- Browser speech-recognition confidence: ${confidenceText}.
- ${lowConfidence ? 'Confidence is low. Ask for one immediate retry and tighten correction checks.' : 'Use standard correction checks.'}

Correction behavior:
- If the learner made any mistake, begin with one short correction note in square brackets.
- Example format: [You said "libary", but try "library" (LIE-brair-ee).]
- If no meaningful error, do not add bracketed text.

Response constraints:
- Keep each reply under 90 words.
- Be concise, motivating, and practical.
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

  const { text, level, history, mode, words, speechMeta } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text input' });
  }

  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';
  const safeMode = mode === 'word' ? 'word' : 'conversation';
  const safeWords = Array.isArray(words)
    ? words
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const safeHistory = sanitizeHistory(history);
  const safeSpeechMeta =
    speechMeta && typeof speechMeta === 'object' && typeof speechMeta.confidence === 'number'
      ? { confidence: Math.min(1, Math.max(0, speechMeta.confidence)) }
      : {};
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
          {
            role: 'system',
            content:
              safeMode === 'word'
                ? buildWordTutorPrompt(safeLevel, safeWords, safeSpeechMeta)
                : buildConversationPrompt(safeLevel, safeSpeechMeta)
          },
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
