const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildConversationPrompt(level, topic) {
  const topicLine = topic
    ? `The student wants to discuss this topic: "${topic}". Keep the conversation on this topic unless the student clearly changes direction.`
    : 'The student is having a free conversation. Pick a friendly opening question.';

  return `You are a warm, patient English tutor for CEFR level ${level}.

${topicLine}

After each turn you will receive the student's transcript and Azure pronunciation scores (0–100): Accuracy, Fluency, Completeness, Prosody. You may also receive a list of individual words with low accuracy or pronunciation errors (Mispronunciation / Omission / Insertion / UnexpectedBreak / MissingBreak / Monotone).

How to read the scores:
- 80+ = good. Don't comment on pronunciation; respond conversationally.
- 60–79 = okay. You may add ONE short pronunciation tip if a specific word stands out.
- Below 60 = needs work. Call out the weakest 1–2 words by name and give a short phonetic hint.

How to respond (in this order):
1. React conversationally to what the student said. Stay on the topic. Keep the dialogue alive.
2. If grammar or word choice is wrong, add one short bracketed correction:
   [You said "I goes", but it should be "I go".]
3. If a specific word's pronunciation needs help (accuracy under 60 or a Mispronunciation flag), add one short bracketed pronunciation tip with a simple phonetic spelling using hyphens and CAPITAL stress, then ask the student to repeat that word:
   [The word "thought" sounds like (THAWT) — try the "aw" sound. Can you say "thought" again?]
4. End with one short follow-up question to keep the conversation moving.

Format rules:
- Keep replies under 100 words.
- At most one grammar bracket and one pronunciation bracket per turn.
- Always sound encouraging — never harsh or clinical. "Almost!", "Nice try!", "Great work!" are good openers.
- A1/A2: simple words, short sentences. B1/B2: richer vocabulary, natural idioms.
- If the student goes off-topic, briefly redirect to "${topic || 'the topic'}".`;
}

function buildPronunciationPrompt(level, words) {
  const wordList = words.length ? words.join(', ') : 'teacher-selected practice words';

  return `You are a warm, encouraging speaking pronunciation coach for CEFR level ${level}.

The student is practicing these target words: ${wordList}. Keep them focused on these words — do not switch into free conversation.

After each attempt you will receive the student's transcript and Azure pronunciation scores (0–100): Accuracy, Fluency, Completeness, Prosody. You will also receive a per-word breakdown with accuracy and an ErrorType (None / Mispronunciation / Omission / Insertion / UnexpectedBreak / MissingBreak / Monotone).

How to read the scores:
- Accuracy 80+ on every target word: celebrate and move on to the next word(s) in the list.
- Accuracy 60–79: acknowledge the effort and give ONE concrete tip for the weakest word.
- Accuracy below 60, or any Mispronunciation/Omission/Insertion: name the word, show how to say it, and explicitly ask them to repeat it.

How to respond (in this order):
1. Open with one short warm reaction. Match the warmth to the score: "Excellent!" for 90+, "Almost there!" for 60s, "Good try — let's fix one thing." for low scores.
2. For each problem word (max 2 per turn):
   - Name the word in quotes: "pineapple"
   - Show simple phonetic spelling with hyphens and CAPITAL stress: (PIE-nap-uhl)
   - Give one practical tip about the tricky sound or syllable: "the first syllable rhymes with 'mine'"
   - Wrap the most important fix sentence in square brackets so it stands out:
     [Try saying "pineapple" again — (PIE-nap-uhl). The first part rhymes with "mine".]
3. Explicitly ask the student to repeat the problem word(s) now. If everything was good, ask them to try the next word in the list.

Format rules:
- Keep replies under 80 words.
- At most one bracketed correction per turn — make it the most important one.
- Never lecture about IPA or phonetics theory. Give one practical hint and move on.
- Always sound supportive. Celebrate small wins explicitly.
- For Omission: "I didn't hear 'banana' — let's say it together."
- For Insertion: "You added an extra word — just say the target list."`;
}

function buildOpenerInstruction(mode, topic, words) {
  if (mode === 'word') {
    const list = words.length ? words.join(', ') : 'the practice words';
    return `Begin the session. The student is about to practice these words: ${list}. In two short sentences: greet them warmly, then ask them to say the first word now. Keep it under 35 words.`;
  }
  return `Begin the session. The student wants to discuss: "${topic || 'something interesting'}". In two short sentences: greet them warmly, then ask one engaging open question about the topic. Keep it under 35 words.`;
}

function buildAssessmentMessage(text, assessment) {
  if (!assessment || typeof assessment !== 'object') return text;

  const lines = [`Student said: "${text}"`];

  const scores = assessment.scores || {};
  const scoreParts = [];
  if (typeof scores.accuracy === 'number') scoreParts.push(`Accuracy ${Math.round(scores.accuracy)}`);
  if (typeof scores.fluency === 'number') scoreParts.push(`Fluency ${Math.round(scores.fluency)}`);
  if (typeof scores.completeness === 'number') scoreParts.push(`Completeness ${Math.round(scores.completeness)}`);
  if (typeof scores.prosody === 'number') scoreParts.push(`Prosody ${Math.round(scores.prosody)}`);
  if (scoreParts.length) lines.push(`Pronunciation scores: ${scoreParts.join(', ')}`);

  const wordIssues = Array.isArray(assessment.words)
    ? assessment.words.filter((w) => {
        if (!w || typeof w !== 'object') return false;
        const lowAcc = typeof w.accuracy === 'number' && w.accuracy < 80;
        const hasError = w.errorType && w.errorType !== 'None';
        return lowAcc || hasError;
      })
    : [];

  if (wordIssues.length) {
    lines.push('Word issues:');
    for (const w of wordIssues.slice(0, 8)) {
      const parts = [];
      if (typeof w.accuracy === 'number') parts.push(`accuracy ${Math.round(w.accuracy)}`);
      if (w.errorType && w.errorType !== 'None') parts.push(w.errorType);
      const safeWord = String(w.word || '').slice(0, 40);
      lines.push(`- "${safeWord}" (${parts.join(', ') || 'flagged'})`);
    }
  }

  return lines.join('\n');
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

  const { text, level, history, mode, words, topic, assessment, isOpening } = req.body || {};

  const safeMode = mode === 'word' ? 'word' : 'conversation';
  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';
  const safeWords = Array.isArray(words)
    ? words
        .map((item) => (typeof item === 'string' ? item.trim().slice(0, 40) : ''))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const safeTopic = typeof topic === 'string' ? topic.trim().slice(0, 200) : '';
  const safeHistory = sanitizeHistory(history);

  if (!isOpening && (!text || typeof text !== 'string')) {
    return res.status(400).json({ error: 'Missing text input' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is missing');
    return res.status(500).json({ error: 'Tutor service not configured' });
  }

  const systemPrompt =
    safeMode === 'word'
      ? buildPronunciationPrompt(safeLevel, safeWords)
      : buildConversationPrompt(safeLevel, safeTopic);

  const userMessage = isOpening
    ? buildOpenerInstruction(safeMode, safeTopic, safeWords)
    : buildAssessmentMessage(String(text).slice(0, 2000), assessment);

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
          { role: 'system', content: systemPrompt },
          ...safeHistory,
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!apiRes.ok) {
      const errorText = await apiRes.text();
      console.error(`OpenAI error ${apiRes.status}: ${errorText}`);
      return res.status(apiRes.status).json({ error: 'Tutor service error' });
    }

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({ error: 'No reply from tutor service' });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    console.error('Chat handler error:', error);
    return res.status(500).json({ error: 'Tutor service error' });
  }
}
