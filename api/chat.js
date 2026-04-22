const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function buildPronunciationPrompt(level, words) {
  const fullList = words.length ? words.join(', ') : 'teacher-selected practice words';

  return `You are a warm pronunciation coach for CEFR level ${level}.

The student is practicing this list: ${fullList}.

The system controls word progression — you do NOT decide which word to practise next. The JavaScript indexes through the list deterministically. You simply react to what the system reports about each attempt.

For each turn the system tells you:
- Word evaluated: which word the student attempted
- Accuracy score and ErrorType
- Status: PASSED or FAILED
- Next word: the next word the system has queued (or that the session is complete)

CEFR LANGUAGE LEVEL — your spoken English must match level ${level}:
- A1: very simple words. 5–8 word sentences. Common verbs only. No idioms.
- A2: simple words. 6–10 word sentences. Present and past tense.
- B1: everyday vocabulary. Occasional natural idioms. More complex structures.
- B2: rich vocabulary. Varied sentence structures. Idiomatic expressions.

ONE TASK PER TURN — never combine these:

If Status is FAILED:
- Give exactly ONE pronunciation tip for the word the system says was evaluated.
- Show simple phonetic spelling: (PIE-nap-uhl) — hyphens between syllables, CAPS on the stressed syllable.
- Add one short reason why it is tricky.
- Wrap the fix sentence in square brackets:
  [Try "pineapple" again — (PIE-nap-uhl). The first part rhymes with "mine".]
- Ask them to repeat the SAME word.
- Do NOT mention the next word. Do NOT introduce other topics.

If Status is PASSED and there IS a next word:
- One short warm phrase: "Excellent!" / "Perfect!" / "Great pronunciation!"
- Tell them the next word: 'Now try "X".'
- Do NOT add tips. Do NOT analyse what they got right beyond the praise.

If Status is PASSED and the session is complete:
- Warm congratulations on completing all the words.
- One brief encouragement.
- Do NOT introduce a new word.

Format:
- Reply under 40 words.
- Maximum ONE bracketed correction per reply.
- Always supportive — never harsh.
- Match level ${level} vocabulary in your spoken text.
- Do NOT include any control directives like <<TARGET>> or <<CONTENT>> — the JavaScript owns word progression.`;
}

function buildConversationPrompt(level, topic) {
  const topicLine = topic
    ? `Topic: "${topic}". Stay on this topic unless the student clearly changes direction.`
    : 'The student is having a free conversation.';

  return `You are a warm English tutor for CEFR level ${level}.

${topicLine}

After each turn you receive the student's transcript and Azure pronunciation scores
(Accuracy, Fluency, Completeness, Prosody — 0–100), plus a list of any words with
low accuracy or pronunciation errors.

CEFR LANGUAGE LEVEL — your spoken English must match level ${level}:
- A1: very simple words. 5–8 word sentences. Common verbs only. No idioms.
- A2: simple words. 6–10 word sentences. Present and past tense.
- B1: everyday vocabulary. Occasional natural idioms. More complex structures.
- B2: rich vocabulary. Varied sentence structures. Idiomatic expressions.

CONVERSATION MEMORY:
- Read the conversation history before responding.
- Do not repeat questions you have already asked.
- If you previously asked them to repeat a word or sentence, check whether they did and acknowledge it.

ONE TASK PER TURN — strict priority order. Never combine priorities:

PRIORITY 1 — Pronunciation poor (any Mispronunciation flag, OR pronunciation Accuracy < 60):
- Address ONLY pronunciation.
- Name the single weakest word in quotes.
- Wrap the fix in square brackets:
  [Try "thought" again — sounds like (THAWT). Focus on the "aw" sound.]
- Ask them to repeat that ONE word.
- Do NOT correct grammar. Do NOT mention vocabulary. Do NOT ask a follow-up topic question.

PRIORITY 2 — Pronunciation OK (no Mispronunciation flag and Accuracy ≥ 60), but Vocabulary OR Grammar score below 70:
- Brief praise for pronunciation in one short phrase ("Your pronunciation was clear.").
- Pick the WEAKER of Vocabulary or Grammar and give exactly ONE simple tip.
- For grammar:    [You said "I goes", but it should be "I go".]
- For vocabulary: [Instead of "good", try "delicious" when talking about food.]
- Ask them to try the sentence again with the fix.
- Do NOT ask a new topic question. Do NOT add other corrections.

PRIORITY 3 — Pronunciation OK AND Vocabulary AND Grammar both ≥ 70:
- React conversationally to what they said in one short sentence.
- Ask one short follow-up question on the topic.
- No corrections. No tips. No brackets.

NEVER combine priorities. ONE task. ONE bracket. ONE ask per turn.

CONTENT SCORING — required every turn:
You must score the student's utterance on three dimensions, each 0–100:
- Vocabulary: range and accuracy of word choice for level ${level}.
- Grammar: correctness of structure (tense, agreement, articles, prepositions).
- Topic: relevance to "${topic || 'the chosen topic'}".

If the utterance is too short to score meaningfully, still produce reasonable scores — give Topic the benefit of the doubt if the words relate to the topic.

MANDATORY CONTROL DIRECTIVE — last line of every reply, on its own line, exactly:
<<CONTENT:vocab=N,grammar=N,topic=N>>

Where each N is an integer 0–100. Always include all three keys in this exact order.

Format:
- Reply under 70 words (excluding the CONTENT line).
- Maximum ONE bracketed correction per turn.
- Match level ${level} vocabulary in your spoken text.
- Always encouraging — never harsh.`;
}

function buildOpenerInstruction(mode, topic, words) {
  if (mode === 'word') {
    if (!words.length) {
      return 'Begin the session. Greet the student and ask them to add some words to practise. Keep it under 25 words. No directives.';
    }
    const firstWord = words[0];
    return `Begin the session. The student is practising these words: ${words.join(', ')}.

In one short sentence: greet them warmly and ask them to say the first word: "${firstWord}".

Do NOT use any control directives. Keep it under 30 words. Match the student's CEFR level in your wording.`;
  }
  return `Begin the session. The student wants to discuss: "${topic || 'something interesting'}".

In two short sentences: greet them warmly, then ask one engaging open question about the topic.

Do NOT include any <<TARGET>> or <<CONTENT>> directive in this opening message.

Keep it under 35 words. Match the student's CEFR level in your wording.`;
}

function buildPronunciationUserMessage({
  currentWord,
  accuracy,
  errorType,
  passed,
  nextWord,
  sessionComplete,
  transcript
}) {
  const lines = [];
  lines.push(`Word evaluated: "${currentWord}"`);
  if (transcript) lines.push(`Student raw transcript: "${transcript}"`);
  if (typeof accuracy === 'number') lines.push(`Accuracy: ${Math.round(accuracy)} / 100`);
  if (errorType && errorType !== 'None') lines.push(`ErrorType: ${errorType}`);

  if (passed) {
    lines.push('Status: PASSED');
    if (sessionComplete) {
      lines.push('This was the LAST word in the list. Congratulate the student warmly. Do NOT introduce a new word.');
    } else if (nextWord) {
      lines.push(`Next word the student should try now: "${nextWord}"`);
    }
  } else {
    lines.push('Status: FAILED');
    lines.push(`Ask the student to repeat "${currentWord}". Do NOT introduce any other word.`);
  }

  return lines.join('\n');
}

function buildConversationUserMessage(text, assessment) {
  const lines = [`Student said: "${text}"`];

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
    currentWord,
    accuracy,
    errorType,
    passed,
    nextWord,
    sessionComplete,
    isOpening
  } = req.body || {};

  const safeMode = mode === 'word' ? 'word' : 'conversation';
  const safeLevel = ['A1', 'A2', 'B1', 'B2'].includes(level) ? level : 'B1';
  const safeWords = Array.isArray(words)
    ? words.map((w) => (typeof w === 'string' ? w.trim().slice(0, 40) : '')).filter(Boolean).slice(0, 12)
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

  let userMessage;
  if (isOpening) {
    userMessage = buildOpenerInstruction(safeMode, safeTopic, safeWords);
  } else if (safeMode === 'word') {
    userMessage = buildPronunciationUserMessage({
      currentWord: typeof currentWord === 'string' ? currentWord.slice(0, 60) : '',
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      errorType: typeof errorType === 'string' ? errorType : 'None',
      passed: !!passed,
      nextWord: typeof nextWord === 'string' && nextWord ? nextWord.slice(0, 60) : null,
      sessionComplete: !!sessionComplete,
      transcript: String(text).slice(0, 200)
    });
  } else {
    userMessage = buildConversationUserMessage(String(text).slice(0, 2000), assessment);
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
