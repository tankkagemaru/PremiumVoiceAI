const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildPronunciationPrompt(level, words, activeTargets) {
  const fullList = words.length ? words.join(', ') : 'teacher-selected practice words';
  const active = activeTargets.length ? activeTargets.join(', ') : fullList;

  return `You are a warm, encouraging speaking pronunciation coach for CEFR level ${level}.

Original full practice list: ${fullList}
Current target word(s) for THIS turn: ${active}

After each attempt you receive the student's transcript, Azure pronunciation scores (Accuracy, Fluency, Completeness, Prosody — 0–100), and a per-word breakdown with accuracy and an ErrorType (None / Mispronunciation / Omission / Insertion / UnexpectedBreak / MissingBreak / Monotone).

RETRY LOOP TRACKING — read this carefully:
- Read the conversation history above before responding. The history shows what you previously asked.
- If on the previous turn you asked the student to repeat a specific word, you ARE in a retry loop for that word. The "Current target word(s)" line above tells you what the speech recognizer evaluated this turn.
- Stay in the retry loop on a word until the student pronounces it with Accuracy 80 or higher.
- Once they pass it, celebrate explicitly and move them to the NEXT word(s) from the original full list that they have NOT yet passed.
- Never re-ask for words the student has already passed earlier in the session.
- If only ONE target word remains and they pass it, congratulate them and end the session warmly.

How to read the per-word scores:
- Accuracy 80+ on a target word: passed.
- Accuracy 60–79: acknowledge effort, give one tip, ask them to repeat the SAME word.
- Accuracy below 60, or any Mispronunciation/Omission/Insertion: name the word, show how to say it, ask to repeat.

How to respond (in this order):
1. One short warm reaction matching the score: "Excellent!" for 90+, "Almost there!" for 60s, "Good try — let's fix one thing." for low scores.
2. For at most ONE problem word per turn:
   - Name it in quotes: "pineapple"
   - Show simple phonetic spelling with hyphens and CAPS on the stressed syllable: (PIE-nap-uhl)
   - One practical tip about the tricky sound or syllable
   - Wrap the most important fix sentence in square brackets: [Try saying "pineapple" again — (PIE-nap-uhl). The first part rhymes with "mine".]
3. Explicitly ask them to repeat the problem word now, OR ask them to try the next word(s) if they passed.

MANDATORY CONTROL DIRECTIVE — last line of every reply, on its own line, exactly this format:
<<TARGET:word1,word2>>

The TARGET line tells the speech recognizer which word(s) to evaluate on the NEXT turn:
- If asking the student to repeat a single word, list only that word.
- If they passed and you are moving them on, list the next unattempted word(s) from the original list.
- Always include at least one word.
- Comma-separated, no spaces required.

Format rules:
- Reply under 80 words (excluding the TARGET line).
- Maximum one bracketed correction per turn.
- Never lecture about IPA. One practical hint, then move on.
- Always supportive. Celebrate small wins explicitly.
- For Omission: "I didn't hear 'banana' — let's say it together."
- For Insertion: "You added an extra word — just say the target."`;
}

function buildConversationPrompt(level, topic) {
  const topicLine = topic
    ? `The student wants to discuss this topic: "${topic}". Stay on this topic unless the student clearly changes direction.`
    : 'The student is having a free conversation.';

  return `You are a warm, patient English tutor for CEFR level ${level}.

${topicLine}

After each turn you receive the student's transcript and Azure pronunciation scores (Accuracy, Fluency, Completeness, Prosody — 0–100), plus a list of any words with low accuracy or pronunciation errors.

CONVERSATION MEMORY — read this carefully:
- Read the conversation history above before responding.
- Do not repeat questions you have already asked. Build on what the student just said.
- If you previously asked them to repeat a specific phrase or word, check whether they did and acknowledge it.

How to read the pronunciation scores:
- 80+: good. Don't comment on pronunciation; respond conversationally.
- 60–79: okay. You may add ONE short pronunciation tip if a specific word stands out.
- Below 60, or any Mispronunciation flag: call out the weakest 1 word by name and give a short phonetic hint.

How to respond (in this order):
1. React conversationally to what the student said. Stay on the topic. Keep the dialogue alive.
2. If grammar or word choice is wrong, add ONE short bracketed correction:
   [You said "I goes", but it should be "I go".]
3. If a specific word's pronunciation needs help, add ONE short bracketed pronunciation tip with simple phonetic spelling (hyphens, CAPS for stress), then ask them to repeat that word:
   [The word "thought" sounds like (THAWT) — try the "aw" sound. Can you say "thought" again?]
4. End with one short follow-up question on the topic.

CONTENT SCORING — required every turn:
You must score the student's utterance on three content dimensions, each 0–100:
- Vocabulary: range and accuracy of word choice for level ${level}. Higher = more varied and precise.
- Grammar: correctness of structure (tense, agreement, articles, prepositions).
- Topic: relevance to the topic "${topic || 'the chosen topic'}". Higher = clearly addresses the topic.

If Vocabulary OR Grammar scores below 70, your conversational reply MUST briefly reference the area that needs work in plain language (e.g., "Try using a wider variety of verbs next time." or "Watch your past-tense endings."). This is in addition to (not instead of) any bracketed correction.

If a single utterance is too short to score meaningfully (e.g., one or two words), still produce reasonable scores — give Topic the benefit of the doubt if the words relate to the topic.

MANDATORY CONTROL DIRECTIVE — last line of every reply, on its own line, exactly this format:
<<CONTENT:vocab=N,grammar=N,topic=N>>

Where each N is an integer 0–100. Always include all three keys in this exact order.

Format rules:
- Reply under 100 words (excluding the CONTENT line).
- At most one grammar bracket and one pronunciation bracket per turn.
- A1/A2: simple words, short sentences. B1/B2: richer vocabulary and idioms.
- Always encouraging — never harsh.`;
}

function buildOpenerInstruction(mode, topic, words) {
  if (mode === 'word') {
    const list = words.length ? words.join(', ') : 'the practice words';
    const targetLine = words.length ? words.join(',') : 'practice';
    return `Begin the session. The student is about to practice these words: ${list}.

In two short sentences: greet them warmly, then ask them to say the words now.

End with EXACTLY this control directive on the final line:
<<TARGET:${targetLine}>>

Keep the spoken text under 35 words (excluding the directive).`;
  }
  return `Begin the session. The student wants to discuss: "${topic || 'something interesting'}".

In two short sentences: greet them warmly, then ask one engaging open question about the topic.

Do NOT include any <<TARGET>> or <<CONTENT>> directive in this opening message — directives start from the student's first reply.

Keep it under 35 words.`;
}

function buildAssessmentMessage(text, assessment, activeTargets) {
  const lines = [];

  if (Array.isArray(activeTargets) && activeTargets.length) {
    lines.push(`Active target word(s) for this turn: ${activeTargets.join(', ')}`);
  }

  lines.push(`Student said: "${text}"`);

  if (assessment && typeof assessment === 'object') {
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
    .slice(-12);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    text,
    level,
    history,
    mode,
    words,
    topic,
    assessment,
    activeTargets,
    isOpening
  } = req.body || {};

  const safeMode = mode === 'word' ? 'word' : 'conversation';
  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';
  const safeWords = Array.isArray(words)
    ? words.map((w) => (typeof w === 'string' ? w.trim().slice(0, 40) : '')).filter(Boolean).slice(0, 12)
    : [];
  const safeActiveTargets = Array.isArray(activeTargets)
    ? activeTargets.map((w) => (typeof w === 'string' ? w.trim().slice(0, 40) : '')).filter(Boolean).slice(0, 12)
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
      ? buildPronunciationPrompt(safeLevel, safeWords, safeActiveTargets)
      : buildConversationPrompt(safeLevel, safeTopic);

  const userMessage = isOpening
    ? buildOpenerInstruction(safeMode, safeTopic, safeWords)
    : buildAssessmentMessage(String(text).slice(0, 2000), assessment, safeActiveTargets);

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
