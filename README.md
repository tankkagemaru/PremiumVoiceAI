# 🎙️ PremiumVoiceAI — Voice English Tutor

A browser-based English language tutor that gives learners **live, AI-driven conversation practice** and **word-level pronunciation assessment**. Powered by Azure Cognitive Services Speech SDK for pronunciation scoring, an LLM backend for conversational feedback, and a neural TTS backend for natural tutor voices.

🔗 **Live Demo:** [premium-voice-ai.vercel.app](https://premium-voice-ai.vercel.app)

---

## ✨ Features

### 🗣️ Two Practice Modes

- **Speaking (Conversation)** — Pick a topic (e.g. *"holidays in Malaysia"*, *"my dream job"*) and hold a real spoken dialogue with an AI tutor. The tutor replies, corrects your grammar inline, and keeps the conversation flowing at your CEFR level.
- **Pronunciation Practice** — Enter a list of target words and drill each one in sequence. The app scores every attempt and advances only when you hit the pass threshold.

### 📊 Rich Pronunciation Feedback

Every spoken utterance is scored on four dimensions using Azure Speech's pronunciation assessment:

- 🎯 **Accuracy** — how correctly each phoneme is produced
- 🌊 **Fluency** — smoothness and pacing
- ✅ **Completeness** — whether you said every word
- 🎵 **Prosody** — intonation, stress, and rhythm

Results are rendered as circular score rings and horizontal bars, and your transcript is colour-coded word-by-word to highlight mispronunciations, omissions, insertions, and prosody issues.

### 📚 Content Scoring (Conversation Mode)

In Speaking mode, the tutor also rates the *substance* of what you said:

- 📖 **Vocabulary**
- ✏️ **Grammar**
- 💬 **Topic relevance**

### 🎚️ CEFR Level Support

Sessions adapt to learner level: **A1**, **A2**, **B1**, or **B2**. Built-in topic and word suggestions are tailored to each level (e.g. `apple, banana, orange` at A1 vs. `entrepreneur, hierarchy, miscellaneous` at B2).

### 🔊 Natural Tutor Voice

Tutor replies are spoken aloud using a neural TTS voice (randomly selected per session from `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`). An animated equaliser pulses while the tutor speaks. Voice output can be toggled on/off at any time.

### 🧠 Conversation Memory

The last 12 turns of the dialogue are kept in context so the tutor can reference what you said earlier in the session.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (index.html)                                       │
│  ├─ Tailwind UI                                             │
│  ├─ Azure Speech SDK (mic → transcript + pron. scores)      │
│  └─ Renders dashboards, colour-coded transcripts            │
└──────────┬──────────────────────────────────────────────────┘
           │ POST /api/*
┌──────────▼──────────────────────────────────────────────────┐
│  Serverless API (Vercel)                                    │
│  ├─ /api/azure-token  → short-lived Azure Speech token      │
│  ├─ /api/chat         → LLM tutor reply + content scores    │
│  └─ /api/tts          → synthesised audio (mp3/wav blob)    │
└─────────────────────────────────────────────────────────────┘
```

**Why a token proxy?** The Azure Speech subscription key never ships to the browser. The `/api/azure-token` endpoint exchanges it server-side for a short-lived (~10 min) authorisation token that the frontend uses to initialise the SDK.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- An **Azure Cognitive Services Speech** resource (subscription key + region)
- An LLM provider API key (the `/api/chat` endpoint) — e.g. OpenAI, Azure OpenAI, Anthropic, etc., depending on your implementation
- A TTS provider (the `/api/tts` endpoint) — voice IDs suggest an OpenAI-compatible TTS is used
- A [Vercel](https://vercel.com) account for deployment (recommended — the project is structured for Vercel serverless)

### 1. Clone the repository

```bash
git clone https://github.com/tankkagemaru/PremiumVoiceAI.git
cd PremiumVoiceAI
```

### 2. Configure environment variables

Create a `.env.local` file (or set these in your Vercel project settings):

```env
# Azure Speech
AZURE_SPEECH_KEY=your-azure-speech-subscription-key
AZURE_SPEECH_REGION=your-azure-region   # e.g. eastus, southeastasia

# LLM provider (used by /api/chat)
OPENAI_API_KEY=sk-...                   # or equivalent for your provider

# TTS provider (used by /api/tts)
# Often the same key as the LLM provider if using OpenAI
```

> ⚠️ Exact variable names depend on the implementation in `/api`. Check the source of each handler and adjust accordingly.

### 3. Run locally

Using the Vercel CLI (recommended, so the `/api` handlers work locally):

```bash
npm install -g vercel
vercel dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser and allow microphone access.

### 4. Deploy

```bash
vercel deploy
```

Or connect the repo to Vercel via the dashboard and set your environment variables there.

---

## 🎯 How to Use

1. **Pick a mode** — *Speaking* or *Pronunciation Practice*.
2. **Choose your CEFR level** (A1 → B2).
3. **Enter a topic** (Speaking mode) or **a comma-separated word list** (Pronunciation mode). Not sure what to try? Hit the 🎲 **Suggest** button for a level-appropriate prompt.
4. **Press "Start Session →"** — the tutor greets you.
5. **Click ⏺️ Record**, speak, then click **Stop** (or let silence end the turn).
6. Review the colour-coded transcript and score dashboards, read/listen to the tutor's reply, and keep going.
7. Click **New Session** to start over with different settings.

### Transcript colour legend

| Colour | Meaning |
|---|---|
| 🟡 Yellow + wavy underline | Mispronunciation |
| ⚫ Grey + strike-through | Omission (word skipped) |
| 🟣 Purple + italic | Insertion (extra word) |
| 🟠 Orange | Accuracy 60–80 |
| 🟨 Amber | Accuracy < 60 |
| 🔵 Blue | Prosody issue (unexpected break, missing break, monotone) |

---

## 🎙️ Speech Rules

All rules the app applies to spoken input and tutor output — recognition, scoring, and voice.

### Recognition (Azure Speech SDK)

| Setting | Value |
|---|---|
| Recognition language | `en-US` |
| Audio source | Default microphone (browser) |
| Grading system | `HundredMark` (0–100) |
| Granularity | `Phoneme` — every phoneme in every word is scored |
| Prosody assessment | **Enabled** (intonation, stress, rhythm) |
| Miscue detection | Enabled **only** in Pronunciation mode when a reference word is set |
| Auth | Short-lived token from `/api/azure-token`, auto-refreshed ~30s before expiry (token lifetime ~10 min) |

### Pronunciation mode — pass rule

You advance to the next target word **only when all of these are true**:

- Error type is `None` (no Mispronunciation, Omission, or Insertion)
- Accuracy score **≥ 80 / 100**
- The target word was actually detected in the transcript

If you fail, the tutor gives feedback and you retry the same word. When you've cleared every word in the list, the session is marked complete and the **Record** button is disabled until you start a new session.

### Conversation mode — scoring dimensions

Each user turn is scored on **two** independent dashboards:

1. **Pronunciation** (from Azure, client-side): Accuracy, Fluency, Completeness, Prosody.
2. **Content** (from the LLM, backend): Vocabulary, Grammar, Topic relevance — each 0–100.

Content scores are delivered inline using the directive format below.

### Tutor reply format rules

The `/api/chat` backend must emit replies that follow two in-band conventions the frontend parses:

- **Inline corrections** in square brackets: `[better phrasing here]`. The frontend extracts every `[...]` into a dedicated *Correction Note* block and removes them from the main reply before display and TTS.
- **Content scores** (Conversation mode only) via a single `<<CONTENT: ...>>` directive, e.g.:

  ```
  <<CONTENT: vocab=85, grammar=70, topic=90>>
  ```

  Keys accepted: `vocab` / `vocabulary`, `grammar`, `topic`. The directive is stripped from the visible reply and its values populate the content score dashboard attached to the most recent user message.
- Any stray `<<TARGET: ...>>` directive is silently stripped — **word progression is owned by the frontend, not the LLM.**

### Tutor voice (TTS) rules

- One of ten voices is picked **at random per session** and used for every tutor turn in that session: `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`, `shimmer`.
- Before synthesis, any `[...]` correction fragments are stripped so the tutor speaks only the natural reply, not the bracketed edits.
- Starting a new TTS playback cancels any in-flight audio (no overlapping voices).
- TTS can be toggled off via the **Voice On / Voice Off** button — recognition and scoring still work silently.
- The red voice ring pulses and the equaliser bars animate only while audio is actively playing.

### Conversation history rules

- The last **12 turns** (user + assistant) are kept in memory and resent to `/api/chat` on every request.
- Older turns are dropped from the front of the queue — there is no persistence across sessions or page reloads.
- Clicking **New Session** clears history, resets the word index, and re-randomises the tutor voice.

### Session-start rule

When you press **Start Session →**, the frontend calls `/api/chat` with `isOpening: true` and no history. The LLM must return a level-appropriate greeting that introduces the topic (Conversation) or the first target word (Pronunciation). This opener is **not** scored — content directives are ignored on the opening turn.

---

## 📁 Project Structure

```
PremiumVoiceAI/
├── .github/
│   └── workflows/          # CI/CD workflows
├── api/                    # Vercel serverless functions
│   ├── azure-token.js      # Issues short-lived Azure Speech tokens
│   ├── chat.js             # LLM tutor endpoint
│   └── tts.js              # Text-to-speech endpoint
├── index.html              # Single-page frontend (Tailwind + vanilla JS)
└── README.md
```

*(Exact filenames inside `api/` may vary — the three endpoints called by the frontend are `/api/azure-token`, `/api/chat`, and `/api/tts`.)*

---

## 🔧 Tech Stack

- **Frontend:** Vanilla JavaScript, [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- **Speech recognition + pronunciation scoring:** [Microsoft Cognitive Services Speech SDK](https://learn.microsoft.com/azure/ai-services/speech-service/) (browser bundle)
- **Conversational AI:** LLM via `/api/chat` (provider-agnostic)
- **Text-to-speech:** Neural TTS via `/api/tts`
- **Hosting:** [Vercel](https://vercel.com) (static frontend + serverless functions)

---

## 🔒 Security Notes

- **Never expose your Azure Speech key in the frontend.** The `/api/azure-token` endpoint is the only correct way to authorise the browser SDK.
- Authorisation tokens are cached client-side and refreshed ~30 seconds before the 10-minute expiry.
- All LLM and TTS traffic is proxied through your serverless functions — your API keys stay on the server.

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue first to discuss any major changes.

---

## 📄 License

No license file is currently included in the repository. Please contact the repository owner before using this code in production or redistributing it.

---

## 🙏 Acknowledgements

- [Microsoft Cognitive Services Speech SDK](https://github.com/Azure-Samples/cognitive-services-speech-sdk) for world-class pronunciation assessment
- [Tailwind CSS](https://tailwindcss.com/) for the UI
- [Vercel](https://vercel.com) for zero-config hosting

---

> *Built as a proof-of-concept widget for voice-driven ESL learning.*
