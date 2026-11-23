import { Platform, TextStyle } from 'react-native';
import { AssistantState } from './types';

/**
 * Design tokens extracted verbatim from DESIGN.md.
 *
 * The palette is deliberately tiny: a true-black canvas lets a single electric
 * cyan-blue accent carry every piece of state signalling, and glow stands in
 * for the shadows a light UI would use. Never inline a hex value — always
 * reference a token here so tuning stays a one-line change.
 */

export const COLORS = {
  primary: '#2997ff',
  primaryGlow: '#5fb8ff',
  primaryDim: '#1c6fb8',

  listening: '#30e3ca',
  thinking: '#c084fc',
  speaking: '#2997ff',

  error: '#ff5c5c',

  ink: '#ffffff',
  body: '#e6e6ea',
  bodyMuted: '#9a9aa5',
  bodyFaint: '#6b6b76',

  dividerSoft: '#232329',
  hairline: '#2c2c33',

  canvas: '#000000',
  surface1: '#0a0a0f',
  surface2: '#111116',
  surfaceTile1: '#17171d',
  surfaceTile2: '#1c1c23',

  bubbleUser: '#1c6fb8',
  bubbleAssistant: '#17171d',

  onPrimary: '#ffffff',
  onDark: '#ffffff',

  /** Scrim behind modal sheets — not in DESIGN.md, kept translucent. */
  overlay: 'rgba(0, 0, 0, 0.72)',
} as const;

/**
 * Platform font stacks. No custom font files are bundled, so these resolve to
 * the native system faces — SF on iOS, Roboto on Android, which is exactly
 * what DESIGN.md specifies ("SF Pro Display, system-ui, -apple-system").
 */
export const FONTS = {
  display: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }) as string,
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string,
} as const;

const t = (style: TextStyle): TextStyle => style;

export const TYPOGRAPHY = {
  heroDisplay: t({
    fontSize: 34,
    lineHeight: 37,
    fontWeight: '600',
    letterSpacing: -0.24,
  }),
  sectionHeading: t({
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '600',
    letterSpacing: -0.15,
  }),
  /** Monospaced, wide-tracked HUD label. Status text only — never chat copy. */
  statusLabel: t({
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
    letterSpacing: 1.2,
  }),
  chatText: t({
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: -0.2,
  }),
  chatTextStrong: t({
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.2,
  }),
  timestamp: t({
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '400',
    letterSpacing: 0.4,
  }),
  inputText: t({
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400',
    letterSpacing: 0,
  }),
  buttonLabel: t({
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  }),
  caption: t({
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    letterSpacing: 0,
  }),
  finePrint: t({
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '400',
    letterSpacing: 0,
  }),
} as const;

export const ROUNDED = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  pill: 9999,
  full: 9999,
} as const;

export const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  section: 64,
} as const;

export interface OrbStateStyle {
  glow: string;
  glowOpacity: number;
}

/**
 * One halo colour per assistant state. `searching` is a transient sub-state of
 * `thinking` but gets its own hue so the UI can honestly say "I am looking
 * something up" instead of a generic spinner.
 */
export const ORB_STATE_STYLE: Record<AssistantState, OrbStateStyle> = {
  idle: { glow: COLORS.primaryDim, glowOpacity: 0.25 },
  listening: { glow: COLORS.listening, glowOpacity: 0.55 },
  transcribing: { glow: COLORS.listening, glowOpacity: 0.55 },
  thinking: { glow: COLORS.thinking, glowOpacity: 0.5 },
  searching: { glow: COLORS.primaryGlow, glowOpacity: 0.6 },
  speaking: { glow: COLORS.speaking, glowOpacity: 0.6 },
  error: { glow: COLORS.error, glowOpacity: 0.6 },
};

/**
 * Render a provider model id as a compact HUD badge:
 * `llama-3.3-70b-versatile` → `LLAMA 3.3 70B VERSATILE`.
 */
export function formatModelBadge(modelId: string): string {
  const raw = (modelId || '').trim();
  if (!raw) return 'NO MODEL';
  const name = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}
