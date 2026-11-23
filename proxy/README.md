# Jarvis Proxy Server

A tiny key-holding proxy so release builds never embed API keys in the bundle.

## Why

`EXPO_PUBLIC_*` variables are inlined at build time and extractable from any
IPA/APK. Setting `EXPO_PUBLIC_JARVIS_PROXY_URL` routes all Groq and Fish Audio
calls through this server instead — the app sends no `Authorization` header,
and the proxy injects the real keys.

## Quick start

The server has **zero dependencies** — it is Node's built-in `http` module plus
`fetch()`. There is nothing to install:

```bash
GROQ_API_KEY=gsk_... FISH_AUDIO_API_KEY=sk-... node proxy/server.mjs
```

The server listens on `HOST`/`PORT` (defaults `0.0.0.0:8787`).

## Endpoints

| Method | Path | Forwards to |
|--------|------|-------------|
| POST | `/groq/chat/completions` | `https://api.groq.com/openai/v1/chat/completions` |
| POST | `/groq/audio/transcriptions` | `https://api.groq.com/openai/v1/audio/transcriptions` |
| POST | `/fish/tts` | `https://api.fish.audio/v1/tts` |
| GET | `/fish/wallet/self/api-credit` | `https://api.fish.audio/wallet/self/api-credit` |
| GET | `/health` | Local liveness probe (no upstream call) |

Everything else is a `404` and never reaches the network.

## Security model

Two rules make this safe to expose, and both are enforced in `server.mjs`:

1. **Route allow-list.** Only the table above is proxied. There is deliberately
   no catch-all `/:provider/*` route — otherwise the proxy would be an open
   relay, which is worse than shipping the key.
2. **Client key wins.** A user who pasted their own key in-app keeps using it:
   the proxy forwards their `Authorization` header verbatim and only
   substitutes the server key when the client sent none. Shared-key and
   per-user-key deployments therefore coexist.

The `GET /` and `GET /health` probes report whether each key is *configured*,
never its value.

> [!WARNING]
> The proxy holds billing-capable keys. Rate limit it at the edge
> (Cloudflare/WAF) and use HTTPS — a release build will not talk to a plain
> HTTP origin, and requests carry audio clips and bearer tokens.

## Deploy

Any Node.js host works (Railway, Fly.io, a $5 VPS). Set the env vars and
point `EXPO_PUBLIC_JARVIS_PROXY_URL` at the deployed URL.

Streaming is passed through as a raw body pipe, so the SSE token stream that
drives sentence-by-sentence TTS is never buffered or delayed.
