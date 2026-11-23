---
version: alpha
name: Jarvis-voice-assistant-design
description: A dark, sci-fi HUD interface built around a single glowing presence — the Jarvis orb. Near-black canvases let one electric cyan-blue accent do all the signaling (listening, thinking, speaking), with soft glow standing in for the shadows a light UI would use. Chrome stays minimal and monospaced-technical so the orb and the conversation stay the focus — no decorative gradients, no card shadows, only the one signature glow beneath the orb and behind active elements.

colors:
  primary: "#2997ff"
  primary-glow: "#5fb8ff"
  primary-dim: "#1c6fb8"
  listening: "#30e3ca"
  thinking: "#c084fc"
  speaking: "#2997ff"
  error: "#ff5c5c"
  ink: "#ffffff"
  body: "#e6e6ea"
  body-muted: "#9a9aa5"
  body-faint: "#6b6b76"
  divider-soft: "#232329"
  hairline: "#2c2c33"
  canvas: "#000000"
  surface-1: "#0a0a0f"
  surface-2: "#111116"
  surface-tile-1: "#17171d"
  surface-tile-2: "#1c1c23"
  bubble-user: "#1c6fb8"
  bubble-assistant: "#17171d"
  on-primary: "#ffffff"
  on-dark: "#ffffff"

typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.24px
  section-heading:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.15px
  status-label:
    fontFamily: "SF Mono, Menlo, monospace"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 1.2px
  chat-text:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.2px
  chat-text-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.2px
  timestamp:
    fontFamily: "SF Mono, Menlo, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0.4px
  input-text:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
  button-label:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.0
    letterSpacing: -0.2px
  caption:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0
  fine-print:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0

rounded:
  none: 0px
  xs: 6px
  sm: 10px
  md: 14px
  lg: 20px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  jarvis-orb-idle:
    backgroundColor: "{colors.surface-tile-1}"
    glowColor: "{colors.primary-dim}"
    glowOpacity: 0.25
    size: 160px
  jarvis-orb-listening:
    backgroundColor: "{colors.surface-tile-1}"
    glowColor: "{colors.listening}"
    glowOpacity: 0.55
    size: 160px
    animation: pulse-fast
  jarvis-orb-thinking:
    backgroundColor: "{colors.surface-tile-1}"
    glowColor: "{colors.thinking}"
    glowOpacity: 0.5
    size: 160px
    animation: rotate-shimmer
  jarvis-orb-speaking:
    backgroundColor: "{colors.surface-tile-1}"
    glowColor: "{colors.speaking}"
    glowOpacity: 0.6
    size: 160px
    animation: pulse-waveform
  mic-button:
    backgroundColor: "{colors.primary}"
    iconColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: 72px
  mic-button-active:
    backgroundColor: "{colors.listening}"
    iconColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    size: 72px
    animation: ring-pulse
  chat-bubble-assistant:
    backgroundColor: "{colors.bubble-assistant}"
    textColor: "{colors.body}"
    typography: "{typography.chat-text}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  chat-bubble-user:
    backgroundColor: "{colors.bubble-user}"
    textColor: "{colors.on-primary}"
    typography: "{typography.chat-text}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.body-muted}"
    typography: "{typography.status-label}"
    rounded: "{rounded.pill}"
    padding: 4px 12px
  text-input-fallback:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.input-text}"
    rounded: "{rounded.pill}"
    padding: 12px 18px
    border: "1px solid {colors.hairline}"
  settings-row:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.body}"
    typography: "{typography.chat-text}"
    rounded: "{rounded.sm}"
    padding: 14px 16px
  toggle-switch-on:
    backgroundColor: "{colors.primary}"
    thumbColor: "{colors.on-primary}"
  toggle-switch-off:
    backgroundColor: "{colors.divider-soft}"
    thumbColor: "{colors.body-faint}"
  error-banner:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: 10px 14px
  retry-link:
    backgroundColor: transparent
    textColor: "{colors.primary-glow}"
    typography: "{typography.caption}"

## Color Usage

### Surfaces
- **Canvas** (`{colors.canvas}` — #000000): The base background of the whole app. Pure black, not near-black — this is a phone screen in a dark room, not a print page.
- **Surface 1 / 2** (`{colors.surface-1}`, `{colors.surface-2}`): Elevated panels — the settings screen background, the text-input bar, status badges. One step up from canvas, still reads as "dark."
- **Surface Tile 1 / 2** (`{colors.surface-tile-1}`, `{colors.surface-tile-2}`): The orb's resting fill and assistant chat bubbles. Tile-2 is used where a tile sits directly against tile-1 and needs the faintest separation.
- **Bubble User** (`{colors.bubble-user}`): The only place `{colors.primary-dim}` shows as a fill rather than an accent — the user's own chat turns read as "their" color, distinct from Jarvis's neutral dark bubble.

### Accent (State Colors)
The single interactive/brand accent is **Electric Blue** (`{colors.primary}` — #2997ff), used for the idle mic button, primary buttons, and links. Three **state colors** exist specifically for the orb and mic button and appear nowhere else in the UI:
- **Listening** (`{colors.listening}` — #30e3ca, cyan-green): the orb/mic glow while recording.
- **Thinking** (`{colors.thinking}` — #c084fc, violet): the orb glow while waiting on the LLM.
- **Speaking** (`{colors.speaking}` — same as primary, #2997ff): the orb glow while TTS audio plays.
This is the app's one deliberate exception to "single accent color" — the orb is allowed to shift hue because the color *is* the status indicator, replacing a text label.

### Text
- **Ink** (`{colors.ink}` — #ffffff): Headlines, the app title, primary settings labels.
- **Body** (`{colors.body}` — #e6e6ea): Default chat text — off-white, not pure white, so long conversations don't glare.
- **Body Muted** (`{colors.body-muted}` — #9a9aa5): Timestamps, status badges, secondary settings copy.
- **Body Faint** (`{colors.body-faint}` — #6b6b76): Disabled states, placeholder text in the input bar.

### Hairlines & Borders
- **Divider Soft** (`{colors.divider-soft}` — #232329): Row separators in settings.
- **Hairline** (`{colors.hairline}` — #2c2c33): The 1px border on the text-input fallback bar — barely visible, just enough to separate it from canvas.

### Glow, Not Gradient
**No decorative gradients.** All depth comes from a soft colored **glow** (a blurred, semi-transparent halo behind the orb and active buttons) rather than gradients or drop shadows. This is the dark-theme equivalent of Apple's single product-shadow rule: exactly one visual "effect" token, reused everywhere, meaningfully tied to state rather than decoration.

## Typography

### Font Family
- **Display**: `SF Pro Display, system-ui, -apple-system, sans-serif` — app title, section headings.
- **Body / Chat**: `SF Pro Text, system-ui, -apple-system, sans-serif` — conversation text, inputs, buttons.
- **Status / Mono**: `SF Mono, Menlo, monospace` — status labels ("LISTENING", "THINKING…", model name badge) and timestamps. The monospace face is what gives the HUD/sci-fi read; reserve it for machine-status text only, never for conversation content.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.hero-display}` | 34px | 600 | 1.1 | -0.24px | App title / "Jarvis" wordmark on first launch |
| `{typography.section-heading}` | 22px | 600 | 1.2 | -0.15px | Settings section headers |
| `{typography.status-label}` | 13px | 500 | 1.3 | 1.2px | Orb state text ("LISTENING", "THINKING") — wide tracking, uppercase, monospace |
| `{typography.chat-text}` | 16px | 400 | 1.4 | -0.2px | Default chat bubble copy |
| `{typography.chat-text-strong}` | 16px | 600 | 1.4 | -0.2px | Emphasized inline text in a response |
| `{typography.timestamp}` | 11px | 400 | 1.3 | 0.4px | Small monospace timestamp under a chat turn |
| `{typography.input-text}` | 16px | 400 | 1.3 | 0 | Text-input fallback field |
| `{typography.button-label}` | 16px | 600 | 1.0 | -0.2px | Button labels |
| `{typography.caption}` | 13px | 400 | 1.35 | 0 | Settings row descriptions, error banner text |
| `{typography.fine-print}` | 11px | 400 | 1.3 | 0 | Model-name footnote, legal/attribution text |

### Principles
- **Status text is always monospace, uppercase, and wide-tracked.** `{typography.status-label}` is the one place letter-spacing goes positive (1.2px) instead of negative — it should read like a HUD readout, not like prose.
- **Conversation text stays warm and readable.** Chat bubbles use 16px/1.4 with slightly negative tracking — comfortable reading rhythm, not display-tight.
- **Negative tracking only above 16px.** Anything at caption size or below (13px, 11px) uses 0 or slightly positive spacing — small monospace text tightened further becomes illegible.
- **No weight 300.** Unlike a marketing site, this is a utility app read in short bursts (often mid-motion, one-handed) — the weight ladder stays 400 / 500 (mono status only) / 600 for reliable legibility at small phone sizes.

### Note on Font Substitutes
- Use `system-ui, -apple-system, BlinkMacSystemFont` as the primary stack; on iOS this resolves to real SF Pro at no bundle-size cost.
- On Android (no SF Pro), fall back to **Inter** for display/body and **JetBrains Mono** or **Roboto Mono** for the status/timestamp face — pick one Android mono font and use it everywhere `{typography.status-label}`/`{typography.timestamp}` appear, so the HUD read stays consistent cross-platform.
- Load fonts via `expo-font` at app boot; show a brief splash rather than a flash of fallback font on the hero title.

## Layout

### Spacing System
- **Base unit:** 8px, matching RN's default layout grid.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 64px.
- **Orb screen:** the orb is vertically centered with at least `{spacing.section}` (64px) of clear air above and below it before the transcript list or mic button intrude.
- **Chat bubble gap:** `{spacing.sm}` (12px) between turns; `{spacing.md}` (16px) between a user turn and the assistant turn that follows it, so replies read as a distinct "beat."
- **Safe areas:** all screens respect `useSafeAreaInsets()` — the mic button and input bar never sit under the home indicator or a punch-hole camera.

### Grid & Container
- **Single-column, full-width** on all screens — this is a phone app, not a responsive multi-column layout. Content max-width is the device width minus `{spacing.md}` (16px) horizontal margins.
- **Orb screen structure (top → bottom):** status badge → orb → status label → transcript list (scrollable, flexes to fill remaining space) → text-input fallback / mic button row, pinned above the safe-area bottom inset.
- **Settings screen:** single scrollable column of `{component.settings-row}` items, `{spacing.lg}` (24px) top padding, grouped under `{typography.section-heading}` headers with `{spacing.xl}` (32px) between groups.

### Whitespace Philosophy
The orb needs room to feel like a presence, not an icon — never let the transcript list creep within `{spacing.xxl}` (48px) of it while idle. When the transcript is empty (first launch), the orb sits alone at true vertical center; once conversation starts, the orb shrinks/moves toward the top and the transcript claims the space, so the layout itself reinforces "the conversation has begun."

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Chat bubbles, canvas, settings rows |
| Soft hairline | 1px `{colors.hairline}` border | Text-input fallback bar |
| Glow | Colored radial glow, blur ~40–60px, opacity 0.25–0.6 depending on state | Orb (all states), active mic button, focused input |
| Elevated flat | Slight lightness step (`{colors.surface-1}` → `{colors.surface-2}`) | Modal sheets (settings), floating error banner |

**Shadow philosophy.** This is a dark UI, so conventional black drop-shadows are nearly invisible and read as muddy — they're not used anywhere. Depth instead comes from (a) **glow** (a colored, blurred halo — the dark-theme equivalent of Apple's product-shadow, but tied to app *state* rather than to a static object) and (b) **surface-lightness steps** between stacked panels. Exactly one shadow-like effect exists in this system — glow — same rule as Apple's "one shadow," inverted for a dark canvas.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed backgrounds only |
| `{rounded.xs}` | 6px | Inline chips (model-name badge corners, if squared variant used) |
| `{rounded.sm}` | 10px | Settings rows, error banner |
| `{rounded.md}` | 14px | Chat bubbles |
| `{rounded.lg}` | 20px | Settings modal sheet top corners |
| `{rounded.pill}` | 9999px | Text-input bar, status badge — anything read as "live/active" |
| `{rounded.full}` | 9999px / 50% | The orb itself, the mic button |

### Iconography & Orb Geometry
- **Orb:** a perfect circle, 160px at rest on the main screen (scales to ~96px once it migrates toward the top after the first exchange). Built as layered concentric circles/rings in RN (`react-native-svg` or pure `View`s with `borderRadius: 9999`) so the glow can be animated independently of the fill via `react-native-reanimated`.
- **Mic button:** circular, 72px, sits centered below the transcript list; icon (mic glyph) centered, `{colors.on-primary}` on idle, inverts to dark icon on `{colors.listening}` fill when active for contrast.
- **Chat bubbles:** rounded rectangle, asymmetric tail corner (bottom-right sharp for user, bottom-left sharp for assistant) at `{rounded.md}` (14px) — a light directional cue without adding a literal speech-bubble tail graphic.
- **No skeuomorphic detail.** No literal "AI face," no faux-metallic bezel — the orb communicates entirely through color, glow, and motion, keeping it abstract and calm rather than gimmicky.

## Components

### The Orb (Core Element)

**`jarvis-orb-idle`** — Resting state. Fill `{colors.surface-tile-1}`, glow color `{colors.primary-dim}` at 25% opacity, no motion or a very slow (4s) breathing scale (98%→100%). This is what the user sees on launch and between exchanges.

**`jarvis-orb-listening`** — Fill unchanged, glow shifts to `{colors.listening}` at 55% opacity, animation `pulse-fast` (a ring that expands and fades outward roughly in time with detected audio amplitude, if amplitude data is available from `expo-av`; otherwise a steady ~600ms pulse).

**`jarvis-orb-thinking`** — Glow shifts to `{colors.thinking}`, animation `rotate-shimmer` — a soft light sweep rotating around the ring, communicating "working" without implying speed.

**`jarvis-orb-speaking`** — Glow shifts to `{colors.speaking}`, animation `pulse-waveform` — glow intensity modulates loosely with the TTS audio's playback (or a canned rhythmic pulse if amplitude isn't exposed), so the orb visually "talks."

### Controls

**`mic-button`** — Idle state, `{colors.primary}` fill, white mic icon, `{rounded.full}`, 72px. Press state: `transform: scale(0.92)` plus a brief haptic tick (`expo-haptics`).

**`mic-button-active`** — While recording: fill becomes `{colors.listening}`, icon inverts to near-black for contrast, and a thin expanding ring (`ring-pulse`) echoes outward from the button edge, mirroring the orb's listening glow so the two feel like one system.

**`text-input-fallback`** — Pill-shaped input bar, `{colors.surface-2}` fill, 1px `{colors.hairline}` border, placeholder in `{colors.body-faint}`. Sits beside or replaces the mic button when the user opts to type; a small send-arrow icon in `{colors.primary}` appears once text is entered.

### Chat

**`chat-bubble-assistant`** — Left-aligned, `{colors.bubble-assistant}` fill, `{colors.body}` text in `{typography.chat-text}`, `{rounded.md}`, sharp bottom-left corner. A `{typography.timestamp}` in `{colors.body-faint}` sits beneath, left-aligned.

**`chat-bubble-user`** — Right-aligned, `{colors.bubble-user}` fill, `{colors.on-primary}` text, same radius rule mirrored (sharp bottom-right corner).

**`status-badge`** — Small pill, `{colors.surface-2}` fill, `{colors.body-muted}` text in `{typography.status-label}` (uppercase, monospace, wide-tracked), shown at the top of the orb screen displaying the active model name (e.g. "LLAMA-3.3-70B") — reassurance/debug info for the user, not decoration.

### Settings & Feedback

**`settings-row`** — Full-width row, `{colors.surface-tile-1}` fill, `{typography.chat-text}` label left-aligned, an optional `{component.toggle-switch-on/off}` or chevron right-aligned. `{rounded.sm}` corners only where a row is visually grouped as a standalone card; otherwise flat with `{colors.divider-soft}` 1px separators between rows in a list.

**`toggle-switch-on` / `toggle-switch-off`** — Standard RN `Switch` retint: track `{colors.primary}` when on / `{colors.divider-soft}` when off, thumb always `{colors.on-primary}` (on) or `{colors.body-faint}` (off).

**`error-banner`** — Appears above the mic button on failure (e.g. Fish Audio TTS request failed and the app fell back to on-device speech). `{colors.error}` fill, `{colors.on-primary}` text in `{typography.caption}`, `{rounded.sm}`, auto-dismisses after ~4s or on tap. Pairs with an inline `{component.retry-link}` when the failure is retryable (e.g. transcription failed).

## Do's and Don'ts

### Do
- Let the orb's glow color be the *only* place hue changes with app state (idle → dim blue, listening → cyan-green, thinking → violet, speaking → blue). Everywhere else, `{colors.primary}` is the one accent.
- Keep canvas true black (`{colors.canvas}` #000000) — it's what makes the glow states read as genuinely luminous rather than just "a lighter gray box."
- Use `{typography.status-label}` (monospace, uppercase, wide-tracked) for every machine-status string; never render "Listening…" in the normal chat font.
- Animate state transitions on the orb with `react-native-reanimated` — glow and scale should ease, never snap, so the assistant feels alive rather than switch-like.
- Respect safe-area insets on every screen; the mic button and input bar are the most-touched elements and must never sit under a notch/home-indicator.
- Use `transform: scale(0.92-0.95)` plus a light haptic as the universal press feedback for the mic button and primary CTAs.

### Don't
- Don't add a second "brand" color beyond `{colors.primary}` — the three state colors exist only on the orb/mic system, never on unrelated UI (buttons, links, badges stay blue).
- Don't use drop shadows anywhere — on this dark canvas they read as murky, not premium. Glow replaces shadow entirely.
- Don't render conversational text in the monospace face — mono is reserved for status/timestamp only, or the HUD feel collapses into "everything is a terminal."
- Don't let the orb sit static during `thinking`/`listening`/`speaking` — a state with no motion reads as "frozen/broken," not "idle."
- Don't stack more than one glow radius per element — a single soft halo per state, not concentric multi-color glows (reads as gimmicky rather than calm).
- Don't use pure white (`{colors.ink}`) for body chat text — it's reserved for headlines/titles; chat copy uses `{colors.body}` (#e6e6ea) to reduce glare in dark-room use.

## Responsive Behavior

### Device Classes
Since this ships through Expo Go as a phone-first app, "responsive" means device-size classes rather than web breakpoints:

| Class | Width | Key Changes |
|---|---|---|
| Small phone (e.g. SE-class) | ≤ 375pt | Orb shrinks to 128px at rest; status badge and orb stack tighter (`{spacing.md}` gap instead of `{spacing.lg}`) |
| Standard phone | 376–430pt | Default sizing as specified above (160px orb, 72px mic button) |
| Large phone / phablet | 431–480pt | Orb can grow slightly (up to 180px) if vertical space allows; otherwise unchanged |
| Tablet (iPad via Expo Go) | ≥ 600pt | Content column caps at ~480pt centered; orb and transcript don't stretch full-width, avoiding an overly sparse layout |

### Touch Targets
- Minimum 44 × 44pt for every tappable element (RN/iOS HIG baseline).
- `{component.mic-button}` at 72px comfortably exceeds this — it's the most-pressed element and deliberately oversized.
- Settings row chevrons/toggles maintain at least 44pt tall tap area even though the visual switch is smaller.

### Orientation
- **Portrait-only** is recommended for v1 (lock via `app.config.ts` `orientation: "portrait"`) — the orb-centric layout doesn't have a meaningful landscape composition yet; revisit only if a future iPad-optimized layout is scoped.

### Motion & Reduced Motion
- All orb/glow animations should check `AccessibilityInfo.isReduceMotionEnabled()` and fall back to a simple opacity-only state change (no scale/rotation) when the user has reduce-motion enabled system-wide.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key directly (`{component.jarvis-orb-listening}`, `{component.chat-bubble-user}`).
2. State variants of the orb/mic (`-idle`, `-listening`, `-thinking`, `-speaking`) live as separate entries in `components:` — never conditionally recolor a single entry inline.
3. Use `{token.refs}` everywhere — never inline hex, especially for the three state colors, since they're the most likely thing to get tuned during testing.
4. Glow is the one "effect" token — if a new component seems to need a shadow, ask whether it should use glow instead, or nothing.
5. Status/timestamp text stays monospace and wide-tracked; chat content stays SF Pro Text at 16px. That boundary is unbreakable.
6. When in doubt about emphasis: change the orb's glow color/animation before adding new chrome — state should live in the orb first, secondary UI second.

## Known Gaps

- Amplitude-reactive glow (`pulse-fast` syncing to actual mic input level, `pulse-waveform` syncing to actual TTS output level) is specified as the ideal but a fixed-timing pulse is an acceptable v1 fallback if real-time amplitude data proves impractical from `expo-av`.
- Dark-mode-only: no light theme is specified. If a light theme is ever requested, it needs its own pass — this system doesn't attempt to be theme-agnostic (canvas-as-true-black is load-bearing for the glow effect).
- Landscape/tablet-optimized layout is out of scope for v1 (see Orientation above).
- Settings screen content is only loosely specified (toggle voice, verbosity, clear history, active model) per the build prompt; exact copy/ordering wasn't defined and is left to implementation.
- Error states beyond the TTS-fallback and transcription-retry cases (e.g. network offline entirely) aren't designed yet.
