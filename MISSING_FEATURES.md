# MISSING_FEATURES.md — J.A.R.V.I.S. Mobile Gap Inventory & Roadmap

> Status: audit of `master` @ `a45a709` + working tree
> Scope: everything specified-but-unbuilt, plus capabilities a production
> voice assistant is expected to have but the current implementation lacks.
> This document is descriptive only — it changes no code.

## How to read this

- **GAP-<area><n>** — a discrete missing capability, traced to the exact
  file:line where it *would* live or where its absence is provable.
- **Impact** — `blocks-ship` · `high` · `medium` · `polish`
- **Roadmap phases (P1–P6)** at the bottom sequence the gaps into shippable
  slices. Every `GAP-*` id is referenced at least once from a phase checklist.

---

## 1. Baseline — what *is* implemented

A single-session, tap-to-talk, voice-first loop:

```
tap mic → expo-audio AudioStream PCM capture (16 kHz mono)
        → WAV encode → Groq Whisper (whisper-large-v3) STT
        → Groq chat (qwen/qwen3.8-27b) + live clock + ONE web_search tool round
        → Fish Audio TTS, sentence-pipelined (s2.1-pro-free)
        → expo-audio playback → idle
```

Supporting surface that already works:

| Area | Present |
|---|---|
| Barge-in | Tapping mic during speech halts playback and starts recording |
| TTS fallback | Non-200 from Fish Audio → `expo-speech` (`en-GB`), with a soft banner |
| Transcription retry | Failed Whisper call keeps the clip and exposes `RETRY` in the banner |
| Text fallback | Pill input bar with send-arrow affordance |
| Settings sheet | Voice responses toggle, concise-responses toggle, static model badge, clear history |
| HUD | Animated orb (5 state colors), mic button (4 states), transcript with smart auto-follow |
| Cache hygiene | WAV + MP3 clips deleted after consumption; prefetched TTS discarded on barge-in |
| Reduced motion | Respected (read once at mount) in orb + mic |
| Design tokens | `src/theme.ts` mirrors DESIGN.md; no inline state/accent hex |

---

## 2. Gap inventory

### A. Assistant capabilities

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-A1 | **No cancel during `transcribing` or `thinking`.** Mic is `disabled` while processing and `toggleRecording` only branches on `speaking` / `listening` / `idle` / `error`. A slow reply cannot be abandoned. | `MicButton.tsx:114`, `useJarvis.ts:212-229` | high |
| GAP-A2 | **No streaming completion.** The full answer is awaited before a single audio byte plays, because the payload omits `stream` and parses with `response.json()`. | `groq.ts:257-264`, `groq.ts:291` | high |
| GAP-A3 | **One tool only.** Every other function name resolves to `Unknown tool: ${name}`. No weather, timers/alarms, calculator, calendar, or device actions. | `groq.ts:24-41`, `groq.ts:222-223` | high |
| GAP-A4 | **No wake word / hands-free / continuous mode.** 100% tap-gated; no ambient listener exists anywhere. | `useJarvis.ts` (whole file) | medium |
| GAP-A5 | **No `searching` state.** Tool use is visually indistinguishable from plain thinking. | `types/index.ts:1-7` | polish |
| GAP-A6 | **No multi-modal input** (image → chat). | no image-picker dependency | medium |

### B. Conversation & data

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-B1 | **No persistence.** Messages and both settings reset on every cold start — no `persist` middleware, no AsyncStorage/SecureStore. | `chatStore.ts:24-71`; zero storage hits repo-wide | high |
| GAP-B2 | **No per-message actions.** No copy, share, delete-one, replay-this-line, or regenerate. | `ChatBubble.tsx:14-42` (display-only) | high |
| GAP-B3 | **No sessions/history.** Single unbounded `messages` array; no titles, no switching, no clearing-one. | `chatStore.ts:25` | medium |
| GAP-B4 | **No export/share transcript.** `Share`/`Clipboard` unused. | — | medium |
| GAP-B5 | **No history management.** No cap and no summarization; only `history.slice(-8)` reaches the model, so older turns are dropped from context but retained in memory. | `groq.ts:131` | medium |

### C. Audio & voice fidelity

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-C1 | **No amplitude-reactive orb.** DESIGN.md specifies `pulse-fast` synced to mic level and `pulse-waveform` synced to TTS level; both are hardcoded-duration pulses today. No level data reaches the UI at all. (Feasible: PCM buffers already exist in `pcmChunks`; `expo-audio` also exposes `RecorderStatus.metering` / `isMeteringEnabled`.) | `JarvisOrb.tsx:44-102`, `audio.ts:129` (`startRecording()` takes no callback), `chatStore.ts` (no `audioLevel`), `DESIGN.md:391` | high |
| GAP-C2 | **No interruption/ducking policy.** `interruptionMode` is never set, so other apps' audio keeps playing at full volume underneath Jarvis. | `audio.ts:95-98` vs `Audio.types.d.ts:539` | high |
| GAP-C3 | **No background audio / lock-screen controls.** `shouldPlayInBackground` never set. | `audio.ts:95-98` | medium |
| GAP-C4 | **No VAD, auto-stop, or minimum clip length.** Requires a second tap; accidental double-taps produce unusable sub-second clips. | `useJarvis.ts:139-169` | high |
| GAP-C5 | **Silent/empty capture gives no feedback.** Snaps silently to idle with no "I didn't catch that". | `useJarvis.ts:145-148`, `useJarvis.ts:155-158` | high |
| GAP-C6 | **No TTS clip cache.** Repeated phrases (e.g. "Yes, sir.") re-hit the paid Fish Audio API every time. | `fishAudio.ts:203-207` | medium |
| GAP-C7 | **Voice unpickable in UI.** Fish voice ID comes from env; device voice is hardcoded `en-GB` / pitch 0.95 / rate 1.05. | `fishAudio.ts:218-220`, `env.ts:20` | medium |
| GAP-C8 | **English-only.** ASR forced to `language: 'en'`; system prompt is English; no locale-aware device voice. | `groq.ts:89`, `models.ts:7-17` | medium |
| GAP-C9 | **No offline/on-device STT fallback.** If Groq is unreachable, voice input is dead — only *TTS* degrades gracefully. | `groq.ts:76-115` | high |
| GAP-C10 | **No completion cue** (haptic or tone when a reply lands while the screen is unwatched). | — | polish |

### D. Settings

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-D1 | **"Active model" is a static label, not a picker** — yet README advertises configuring the active model. | `App.tsx:350-356` vs `README.md:115` | medium |
| GAP-D2 | **No API-key entry/status screen.** Missing keys surface only as a mid-conversation error; there is no onboarding path. | `env.ts`, settings sheet in `App.tsx:286-370` | high |
| GAP-D3 | **No persona / system-prompt customization.** Verbosity has exactly one "concise" switch. | `models.ts:7-17` | medium |
| GAP-D4 | **No quota/credit transparency** (Fish Audio balance, Groq rate-limit state). | — | polish |

### E. Resilience & error handling

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-E1 | **No connectivity detection.** DESIGN.md lists this as an undesigned known gap. | `DESIGN.md:395`; no NetInfo | high |
| GAP-E2 | **No 429/rate-limit backoff or queue.** Groq free tier is 30 RPM; any non-2xx throws straight through. | `groq.ts:283-289` | high |
| GAP-E3 | **Retry exists for transcription only.** A failed completion has no RETRY affordance — the user must retype or re-speak. | `chatStore.ts:4` (`RetryAction = { type: 'transcribe'; audioUri }`) | high |
| GAP-E4 | **No escape hatch when mic permission is permanently denied.** No `Linking.openSettings()` path. | `audio.ts:113-122` | high |

### F. Platform & accessibility

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-F1 | **Voice input dead on web** (throws by design; `AudioStream.web` returns `{stream: null}`). | `audio.ts:132-134`, `AudioStream.web.js` | medium |
| GAP-F2 | **No screen-reader announcements.** New replies, errors, and state changes are never announced; no live regions. | zero `announceForAccessibility` hits | high |
| GAP-F3 | **Reduce-motion is read once and never re-subscribed** — toggling the OS setting mid-session is ignored. | `JarvisOrb.tsx:28-30`, `MicButton.tsx:36-38` | medium |
| GAP-F4 | **No splash screen.** `assets/splash-icon.png` ships unused; no `expo-splash-screen` dep. | `app.json` (no `splash` key) | medium |

### G. Release & engineering hygiene

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-G1 | **Not shippable outside Expo Go.** No `ios.bundleIdentifier`, no `android.package`, no `scheme`, no `eas.json`. | `app.json:10-27`; `eas.json` absent | blocks-ship |
| GAP-G2 | **No tests, lint, or CI.** No `test`/`lint`/`typecheck` scripts; no ESLint/Prettier/Jest config; no `.github`. | `package.json:31-36`; all config `Test-Path` checks `False` | blocks-ship |
| GAP-G3 | **API keys are compiled into the client bundle.** `EXPO_PUBLIC_*` values are extractable from the IPA/APK; there is no proxy and no per-user key model. | `env.ts:17-21`, `.env.example` | blocks-ship |
| GAP-G4 | **No OTA update channel.** | `package.json` (no `expo-updates`) | medium |
| GAP-G5 | **Doc drift.** README claims a configurable model (GAP-D1) and its project tree omits `src/theme.ts` + `src/services/webSearch.ts`. | `README.md:87-106, 115` | polish |

### H. Minor / code-health

| ID | Gap | Evidence | Impact |
|---|---|---|---|
| GAP-H1 | `useChatStore()` destructured wholesale → hook re-renders on **any** store write. Use selectors. | `useJarvis.ts:8-19` | polish |
| GAP-H2 | `webSearch` returns bare snippets with no titles/URLs → answers have no attribution. | `webSearch.ts:18, 76-114` | polish |
| GAP-H3 | `error` state has no dedicated recovery affordance in the orb/mic beyond the banner. | `App.tsx:224-247` | polish |

---

## 3. Roadmap

### P1 — Day-one friction (small, self-contained)
- [x] **GAP-A1** Make the mic a *stop* control during `transcribing`/`thinking`; plumb an `AbortController` from `groqService` outward (one already exists internally at `groq.ts:141`).
- [x] **GAP-C5** Silent/empty capture → "I didn't hear anything, sir." instead of a silent idle.
- [x] **GAP-C4(partial)** Enforce a ~400 ms minimum clip length.
- [x] **GAP-E3** Add a `{ type: 'chat'; prompt }` retry variant, reusing the existing banner RETRY link.
- [x] **GAP-E4** Permission-permanently-denied banner with an `Open Settings` action (`Linking.openSettings()`).
- [x] **GAP-D2** First-run key check: if `groqApiKey` / `fishAudioApiKey` are empty, show a blocking "Add API keys" card instead of failing mid-conversation.

### P2 — Persistence & conversation
- [x] **GAP-B1** Persist messages + settings (rehydrate on launch, survive Fast Refresh).
- [x] **GAP-B2** Long-press a bubble → copy / replay / delete.
- [ ] **GAP-E2** 429-aware jittered backoff plus a small serialized request queue.
- [x] **GAP-E1** Connectivity detection with an offline banner.
- [ ] **GAP-B5** Introduce an explicit context budget (cap + rolling summary).

### P3 — Voice fidelity (closes the DESIGN.md promises)
- [x] **GAP-C1** PCM-derived RMS from `audio.ts` → `onLevel` → `chatStore.audioLevel` → amplitude-reactive orb (`pulse-fast` listening, `pulse-waveform` speaking). Closes DESIGN.md `Known Gaps` item 1.
- [x] **GAP-C2** `interruptionMode: 'duckOthers'`.
- [ ] **GAP-C10** Completion haptic.
- [x] **GAP-C7** Device-voice + Fish-voice pickers in settings.
- [ ] **GAP-B4** Share/export transcript.
- [x] **GAP-C3** Background audio + lock-screen controls (`shouldPlayInBackground`).

### P4 — Capability depth
- [x] **GAP-A2** Streaming completion with sentence-boundary TTS flush (cuts time-to-first-audio from ~full completion to ~first sentence).
- [x] **GAP-A3** Tools: `get_current_time`, `set_timer`, `calculate`, `get_weather`.
- [x] **GAP-A5** `searching` orb state.
- [x] **GAP-C6** TTS clip cache keyed by `voiceId + text`.
- [x] **GAP-D1/D3** Model picker + persona/verbosity controls.
- [x] **GAP-C8** Locale-aware ASR + device voice.
- [ ] **GAP-A6** Multi-modal input (image → chat).
- [x] **GAP-B3** Conversation sessions/history with titles and switching.
- [ ] **GAP-C9** Offline/on-device STT fallback — may require a dev build, so evaluate against the Expo Go constraint first.

### P5 — Ship-readiness
- [ ] **GAP-G1** `eas.json`, `ios.bundleIdentifier`, `android.package`, `scheme`.
- [ ] **GAP-G3** Move keys behind a server proxy (or per-user keys) so nothing secret ships in the bundle.
- [ ] **GAP-G2** Promote the headless mocked harness into `tests/` + `npm test` / `lint` / `typecheck` + CI workflow.
- [ ] **GAP-F4** Splash screen config.
- [ ] **GAP-F2/F3** Accessibility pass: live regions + `reduceMotionChanged` subscription.
- [ ] **GAP-A4** Evaluate wake-word/hands-free mode.
- [ ] **GAP-D4** Quota/credit transparency (Fish Audio balance, Groq rate-limit state).
- [ ] **GAP-F1** Evaluate web parity for voice input, or state text-only web support explicitly in README.
- [ ] **GAP-G4/G5** OTA updates; sync README + DESIGN.md with reality.

### P6 — Code health
- [x] **GAP-H1** Replace the wholesale `useChatStore()` destructure in `useJarvis` with selectors.
- [x] **GAP-H2** Return titles/URLs from `webSearch` so answers can be attributed.
- [x] **GAP-H3** Give the `error` state a first-class recovery affordance in the orb/mic, not just the banner.

---

## 4. Deliberate tradeoffs (not gaps)

These are **intentional** and should not be "fixed" without a product decision:

- **No light theme** — canvas-as-true-black is load-bearing for the glow effect (`DESIGN.md:392`).
- **Portrait-only** — no meaningful landscape composition yet (`DESIGN.md:375`).
- **No markdown/code rendering in bubbles** — the system prompt forbids markdown because the output is spoken (`models.ts:13`).
- **Fixed-timing orb pulse** — accepted v1 fallback for amplitude reactivity (`DESIGN.md:391`); GAP-C1 supersedes it.
- **`interruptionMode` unset** is a real gap, but changing it alters interaction with music apps — treat as a product call.

---

## 5. Verification checklist (run before closing any phase)

```powershell
npx tsc --noEmit                       # type safety
npx expo export --platform android     # Android bundle
npx expo export --platform ios         # iOS bundle
npx expo-doctor                        # config/dependency drift
```

Plus, once GAP-G2 lands: `npm test` (headless mocked suite covering audio
lifecycles, Fish Audio + fallback, web search, Groq ASR/LLM tool loop, store
transitions, and the full record→transcribe→chat→speak→idle pipeline).

