const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, voice } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'OPENAI_API_KEY is missing in Vercel environment variables.' });
  }

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text input' });
  }

  const safeVoice = typeof voice === 'string' && voice.trim() ? voice : 'alloy';

  try {
    const apiRes = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: safeVoice,
        input: text,
        format: 'mp3'
      })
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      return res.status(apiRes.status).json({
        error: `OpenAI TTS API error (${apiRes.status}): ${errorText}`
      });
    }

    const bytes = await apiRes.arrayBuffer();
    const buffer = Buffer.from(bytes);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
