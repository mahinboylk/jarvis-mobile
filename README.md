# J.A.R.V.I.S. Mobile Voice Assistant (React Native + Expo Go)

> *A mobile voice-first AI assistant inspired by Iron Man's J.A.R.V.I.S., built with React Native and Expo Go.*

![System](https://img.shields.io/badge/System-ONLINE-00f0ff?style=flat-square)
![Expo](https://img.shields.io/badge/Expo%20Go-100%25%20Compatible-00ff88?style=flat-square)
![Groq](https://img.shields.io/badge/LLM-Groq%20Qwen-f55036?style=flat-square)
![TTS](https://img.shields.io/badge/TTS-Fish%20Audio%20%2B%20Expo%20Speech-7b2cbf?style=flat-square)

---

## ⚡ Core Voice Loop

```
[ Mic Press / Tap ]
       ↓
[ expo-audio PCM capture → 16 kHz mono WAV (barge-in halts playback first) ]
       ↓
[ Groq Whisper STT (whisper-large-v3) ]
       ↓
[ Groq Chat Completion (chat model from src/config/models.ts + Jarvis persona,
  live clock, optional web_search tool) ]
       ↓
[ Fish Audio TTS, sentence-by-sentence pipelining (automatic expo-speech fallback) ]
       ↓
[ Audio Playback (expo-audio) + Animated Orb Glow ]
       ↓
[ Return to Standby ]
```

*Supports **Barge-in**: Tapping the mic at any point during Jarvis's speech immediately halts playback and begins recording your new directive.*

---

## 📱 How to Run with Expo Go

### 1. Prerequisites
Install the free **Expo Go** app on your mobile device:
- [Expo Go for iOS (App Store)](https://apps.apple.com/app/expo-go/id982107779)
- [Expo Go for Android (Google Play)](https://play.google.com/store/apps/details?id=host.exp.exponent)

### 2. Launch the Development Server
Open PowerShell / Terminal in this directory:
```powershell
npx expo start
```

### 3. Connect Your Device
- **Android**: Scan the QR code displayed in the terminal using the Expo Go app.
- **iOS**: Scan the QR code using your device's default Camera app and tap the Expo Go banner.
- **Web**: Press `w` in the terminal to preview in your desktop browser.

---

## 🔑 Environment Variables & API Setup

Configuration is managed via `.env` (which is gitignored):

```env
# Groq API Key (for Whisper STT and LLM completions)
EXPO_PUBLIC_GROQ_API_KEY=your_groq_api_key

# Fish Audio API Key & Voice/Model ID (for custom cloned voice TTS)
EXPO_PUBLIC_FISH_AUDIO_API_KEY=your_fish_audio_api_key
EXPO_PUBLIC_FISH_AUDIO_MODEL_ID=your_fish_audio_model_id

# OPTIONAL — route every provider call through proxy/server.mjs instead
# EXPO_PUBLIC_JARVIS_PROXY_URL=http://localhost:8787
```

A template with blank placeholders is provided in [`.env.example`](.env.example).

> [!IMPORTANT]
> **Model IDs** live in [`src/config/models.ts`](src/config/models.ts) (chat / ASR / TTS + the voice ID). Verify them against [console.groq.com/docs/models](https://console.groq.com/docs/models) and the Fish Audio developer console before shipping — the free-tier model names change over time.

> [!NOTE]
> **Graceful TTS Fallback**: If Fish Audio returns non-200 (such as HTTP 402 for depleted developer API balance or rate limits), Jarvis automatically falls back to `expo-speech` (on-device British TTS). The assistant always vocalizes responses audibly. Once credits are added in the Fish Audio Developer Console, the custom cloned voice activates seamlessly!

---

## 📂 Project Structure

```
jarvis-mobile/
├── App.tsx                     # Main HUD screen, Settings sheet, SafeAreaView, keyboard avoidance
├── index.ts                    # expo registerRootComponent entry point
├── app.json                    # Expo config: scheme, splash, bundle IDs, mic permission
├── eas.json                    # EAS build profiles (development / preview / production)
├── eslint.config.js            # Flat ESLint config (eslint-config-expo)
├── tsconfig.json               # strict + node types for the test suite
├── .env                        # Local API credentials (gitignored)
├── .env.example                # Template with empty placeholders
├── package.json                # test / lint / typecheck scripts
├── .github/workflows/ci.yml    # CI: lint → typecheck → test
├── proxy/
│   ├── README.md               # Why the bundle must not ship your keys
│   └── server.mjs              # Zero-dep allow-listed Groq/Fish relay + SSE streaming
├── tests/                      # node:test suite, run by `npm test`
│   ├── async.test.ts           # delay / withTimeout / retryWithBackoff
│   ├── queue.test.ts           # SerializedQueue ordering, abort, pause gate
│   ├── context.test.ts         # context budget + rolling digest (B5)
│   ├── transcript.test.ts      # share/export formatting (B4)
│   ├── calculator.test.ts      # expression parser + refusal behaviour
│   └── timers.test.ts          # duration parsing, clamps, fire/cancel
└── src/
    ├── theme.ts                # Design tokens mirroring DESIGN.md (no inline hex)
    ├── config/
    │   ├── env.ts              # Environment accessors + isProxyMode()
    │   └── models.ts           # Chat/ASR/TTS IDs, personas, tool definitions
    ├── types/
    │   └── index.ts            # Message, session, state, audio, quota interfaces
    ├── state/
    │   └── chatStore.ts        # Zustand store: messages, sessions, settings, persistence
    ├── services/
    │   ├── audio.ts            # expo-audio PCM capture + playback, VAD auto-stop, barge-in
    │   ├── groq.ts             # Whisper ASR, chat completion, tool loop, request queue
    │   ├── fishAudio.ts        # Fish Audio TTS + wallet balance + expo-speech fallback
    │   ├── ttsCache.ts         # On-device MP3 clip cache
    │   ├── webSearch.ts        # Web search tool with titles/URLs
    │   ├── weather.ts          # Weather tool (Open-Meteo, keyless)
    │   ├── calculator.ts       # Hand-written expression parser (no eval)
    │   ├── timers.ts           # In-app countdown timers
    │   ├── quota.ts            # Per-provider rate-limit / credit snapshots
    │   ├── connectivity.ts     # Online/offline detection
    │   ├── imageInput.ts       # Library picker + size guard for image input
    │   ├── webSpeech.ts        # Browser SpeechRecognition for web builds
    │   └── storage.ts          # AsyncStorage persistence helpers
    ├── hooks/
    │   ├── useJarvis.ts        # Master hook orchestrating the conversational loop
    │   └── useReduceMotion.ts  # Live Reduce Motion subscription
    ├── utils/
    │   ├── async.ts            # delay / withTimeout / retryWithBackoff
    │   ├── queue.ts            # SerializedQueue with abort + rate-limit gate
    │   ├── context.ts          # Context budget + rolling digest
    │   ├── transcript.ts       # Transcript formatting for share/copy
    │   └── a11y.ts             # Screen-reader announcements
    └── components/
        ├── JarvisOrb.tsx       # Animated multi-state HUD orb
        ├── MicButton.tsx       # Tactile mic toggle / press-to-talk button
        ├── ChatBubble.tsx      # Cybernetic HUD bubbles (long-press actions, live region)
        └── TranscriptList.tsx  # Auto-scrolling conversation history
```

---

## 🧪 Development

```powershell
npm run lint        # ESLint (flat config, eslint-config-expo)
npm run typecheck   # tsc --noEmit
npm test            # node:test suite via tsx
```

All three run in CI on every push and pull request (`.github/workflows/ci.yml`).

> Only pure modules are unit-tested: anything that imports `react-native` uses
> Flow-typed syntax that esbuild cannot parse outside Metro, so those paths are
> covered by the mocked harness in `DESIGN.md` and by manual QA.

---

## 🌐 API keys & the proxy

`EXPO_PUBLIC_*` values are **compiled into the bundle** and are recoverable from
any IPA/APK. For a personal build that is an accepted tradeoff; for anything
shared, run the relay in [`proxy/`](proxy/README.md):

```powershell
$env:EXPO_PUBLIC_JARVIS_PROXY_URL = "http://localhost:8787"
npm run start
```

Unset `EXPO_PUBLIC_JARVIS_PROXY_URL` to go direct again. The proxy keeps the real
keys on your machine and only exposes four allow-listed routes; the app then
sends no `Authorization` header at all, so nothing sensitive reaches the client.

---

## 💬 Features & Interactions

1. **Voice Input**: Tap the central cyan microphone to begin speaking. Tap again
   when done — or let silence detection stop it for you.
2. **Image Input**: Attach a picture from the library; the chat model is
   vision-capable, so you can ask about what you sent.
3. **Text Fallback**: In a quiet environment, use the bottom input bar to type.
   On the web build this is paired with in-browser speech recognition.
4. **Barge-In**: Tap the mic while Jarvis is talking to interrupt him.
5. **Sessions**: Conversations are titled, switchable, and cleared individually.
6. **Settings**: voice responses, concise replies, continuous conversation,
   active model, speech rate, Fish voice, **usage & quota** (Groq request/token
   budget, Fish Audio credit), export transcript, clear conversation.
7. **Export**: the header share button (and the Settings row) sends the active
   thread to the system share sheet as plain text with sources.
