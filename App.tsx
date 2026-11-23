import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { JarvisOrb } from './src/components/JarvisOrb';
import { MicButton } from './src/components/MicButton';
import { TranscriptList } from './src/components/TranscriptList';
import { CHAT_MODEL_BADGE, CHAT_MODEL_OPTIONS, FISH_AUDIO_VOICE_OPTIONS } from './src/config/models';
import { hasFishCredentials, hasGroqCredentials, isProxyMode, loadRuntimeKeys, setRuntimeKey } from './src/config/env';
import { PendingImage, useJarvis } from './src/hooks/useJarvis';
import { fetchFishBalance, listDeviceVoices } from './src/services/fishAudio';
import { pickLibraryImage } from './src/services/imageInput';
import { getAllQuotas, subscribeQuota } from './src/services/quota';
import { selectActiveSession, useChatStore } from './src/state/chatStore';
import { VoiceOption } from './src/types';
import { COLORS, FONTS, ROUNDED, SPACING, TYPOGRAPHY, formatModelBadge } from './src/theme';
import { buildSharePayload } from './src/utils/transcript';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getOrbSize = (width: number, hasTranscript: boolean): number => {
  if (hasTranscript) return 96;
  if (width <= 375) return 128;
  if (width >= 431) return 180;
  return 160;
};

export default function App() {
  // Edge-to-edge: paint the native root view true black so the area behind
  // the transparent system bars never flashes white on cold start / rotation.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(COLORS.canvas).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <JarvisHUD />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function JarvisHUD() {
  const {
    messages,
    state,
    errorMessage,
    toggleRecording,
    sendTextMessage,
    retryTranscription,
    clearMessages,
  } = useJarvis();

  const [inputText, setInputText] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const settings = useChatStore((s) => s.settings);
  const voiceEnabled = settings.voiceEnabled;
  const conciseResponses = settings.conciseResponses;
  const retryInfo = useChatStore((s) => s.retryInfo);
  const setVoiceEnabled = useChatStore((s) => s.setVoiceEnabled);
  const setConciseResponses = useChatStore((s) => s.setConciseResponses);
  const setContinuousMode = useChatStore((s) => s.setContinuousMode);
  const setChatModel = useChatStore((s) => s.setChatModel);
  const setPersona = useChatStore((s) => s.setPersona);
  const updateSpeech = useChatStore((s) => s.updateSpeech);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const audioLevel = useChatStore((s) => s.audioLevel);
  const online = useChatStore((s) => s.online);
  const notice = useChatStore((s) => s.banner);
  const setNotice = useChatStore((s) => s.setBanner);

  // First-run credential check: only shown once the on-device key file has
  // been read, so a saved key never flashes the "add a key" card on launch.
  const [keysReady, setKeysReady] = useState(false);
  const groqKeyDraft = useRef('');
  const fishKeyDraft = useRef('');
  const [keyFormNonce, setKeyFormNonce] = useState(0);
  const hasKeys = isProxyMode() || hasGroqCredentials();

  // Device TTS voices are enumerated once so Settings can offer a real picker.
  const [deviceVoices, setDeviceVoices] = useState<VoiceOption[]>([]);
  useEffect(() => {
    listDeviceVoices().then(setDeviceVoices).catch(() => {});
  }, []);

  // Read saved API keys before deciding whether to show the setup card.
  useEffect(() => {
    let alive = true;
    void loadRuntimeKeys().finally(() => {
      if (alive) setKeysReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const saveKeys = () => {
    setRuntimeKey('groq', groqKeyDraft.current);
    setRuntimeKey('fish', fishKeyDraft.current);
    groqKeyDraft.current = '';
    fishKeyDraft.current = '';
    setKeyFormNonce((n) => n + 1);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Top inset so the header clears the status bar whenever it is
  // transiently revealed (0 while hidden in immersive mode).
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const hasTranscript = messages.length > 0;
  const orbSize = getOrbSize(width, hasTranscript);
  const idleOrbSize = getOrbSize(width, false);
  const availableOrbHeight = Math.max(0, height - insets.top - 260);
  const orbPadding = Math.max(
    SPACING.xs,
    Math.min(SPACING.section, (availableOrbHeight - idleOrbSize * 1.35 - SPACING.section) / 2)
  );
  const setError = useChatStore((s) => s.setError);

  // Active thread, so Settings/header can export it as text (GAP-B4).
  const activeSession = useChatStore(selectActiveSession);
  // Per-provider quota + credit snapshots (GAP-D4).
  const quotas = useSyncExternalStore(subscribeQuota, getAllQuotas);
  // Image staged in the composer but not yet sent (GAP-A6).
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; uri: string } | null>(null);

  // Fish Audio credit is only meaningful when a key (or proxy) exists.
  useEffect(() => {
    if (hasFishCredentials()) fetchFishBalance().catch(() => {});
  }, []);

  // When the keyboard opens, collapse the orb + chips so the transcript
  // keeps its space instead of being squashed to zero height.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Error banner auto-dismisses after ~4s (DESIGN.md), or immediately on tap.
  // A retryable failure keeps its RETRY affordance until the user acts, so the
  // timer is skipped while a retry is pending.
  useEffect(() => {
    if (!errorMessage || retryInfo) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [errorMessage, retryInfo, setError]);

  const handleSendText = () => {
    const text = inputText.trim();
    if (!text && !pendingImage) return;
    const current = useChatStore.getState().state;
    if (
      current === 'thinking' ||
      current === 'transcribing' ||
      current === 'searching'
    ) {
      return;
    }
    const image: PendingImage | undefined = pendingImage ?? undefined;
    setInputText('');
    setPendingImage(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Keyboard.dismiss();
    sendTextMessage(text, image);
  };

  /** Export/share the whole transcript as plain text (GAP-B4). */
  const handleExportTranscript = () => {
    if (!activeSession || activeSession.messages.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Share.share(buildSharePayload(activeSession)).catch(() => {});
  };

  /** Stage an image from the photo library for the next turn (GAP-A6). */
  const handleAttachImage = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    pickLibraryImage()
      .then((picked) => {
        if (picked) setPendingImage(picked);
      })
      .catch((error: Error) =>
        setError(error?.message || 'Could not attach that image, sir.')
      );
  };

  // ── quota formatting (GAP-D4) ─────────────────────────────────────────────

  /**
   * Wall clock for the quota countdown. Reading `Date.now()` during render is
   * impure (and flagged by `react-hooks/purity`), so the clock lives in state:
   * it is stamped when Settings opens, then ticks while the sheet is visible.
   */
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!settingsVisible) return;
    const id = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(id);
  }, [settingsVisible]);

  const formatWindowReset = (resetAt: number | undefined, now: number): string => {
    if (!resetAt || !now) return '';
    const seconds = Math.max(0, Math.round((resetAt - now) / 1000));
    if (seconds === 0) return 'window resets now';
    return seconds < 60 ? `resets in ${seconds}s` : `resets in ${Math.ceil(seconds / 60)}m`;
  };

  const groqQuota = quotas.groq;
  const fishQuota = quotas.fish;

  const groqQuotaText = ((): string => {
    if (!groqQuota) return 'No reading yet — send a message to populate this.';
    if (groqQuota.throttled) {
      return `Rate limited — retrying in ${groqQuota.retryAfterSec ?? 5}s.`;
    }
    const parts: string[] = [];
    if (typeof groqQuota.requestsRemaining === 'number') {
      parts.push(
        typeof groqQuota.requestsLimit === 'number'
          ? `${groqQuota.requestsRemaining}/${groqQuota.requestsLimit} requests left`
          : `${groqQuota.requestsRemaining} requests left`
      );
    }
    if (typeof groqQuota.tokensRemaining === 'number') {
      parts.push(`${groqQuota.tokensRemaining} tokens left`);
    }
    const reset = formatWindowReset(groqQuota.resetAt, nowMs);
    if (reset) parts.push(reset);
    return parts.length > 0 ? parts.join(' · ') : 'Within limits.';
  })();

  const refreshFishCredit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fetchFishBalance().catch(() => {});
  };

  const handleRetry = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    retryTranscription();
  };

  const handleMicPress = () => {
    Keyboard.dismiss();
    toggleRecording();
  };

  const handleClearMessages = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    clearMessages();
    setSettingsVisible(false);
  };

  const handleOpenSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Stamp the quota clock here (an event handler, so it stays render-pure)
    // and refresh the credit balance each time the sheet is opened.
    setNowMs(Date.now());
    if (hasFishCredentials()) fetchFishBalance().catch(() => {});
    setSettingsVisible(true);
  };

  const handleCloseSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSettingsVisible(false);
  };

  return (
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        {/* Immersive fullscreen: both system bars hidden (see app.json
            plugin config for cold-start state). On Android a swipe reveals
            them transiently; they auto-hide. SafeArea insets collapse to 0
            while hidden, so the header/dock claim the full screen. */}
        <StatusBar style="light" hidden />
        <NavigationBar style="light" hidden />

        {/* NOTE: this is react-native-keyboard-controller's
            KeyboardAvoidingView (not React Native's) — it tracks the
            keyboard via WindowInsets, so it keeps working with Android
            edge-to-edge where the stock component fails. */}
        <KeyboardAvoidingView
          style={styles.container}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          {/* Top HUD Header — extends behind the status bar */}
          <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <View style={styles.brandRow}>
              <View>
                <Text style={[styles.brandTitle, !hasTranscript && styles.brandTitleHero]}>JARVIS</Text>
                <Text style={styles.brandSubtitle}>STARK INDUSTRIES</Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>
{formatModelBadge(CHAT_MODEL_BADGE)}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleExportTranscript}
                accessibilityLabel="Share transcript"
                accessibilityHint="Exports this conversation as plain text"
                disabled={!hasTranscript}
                hitSlop={8}
              >
                <Ionicons
                  name="share-outline"
                  size={18}
                  color={hasTranscript ? COLORS.primary : COLORS.bodyFaint}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleOpenSettings}
                accessibilityLabel="Open settings"
                hitSlop={8}
              >
                <Ionicons name="settings-outline" size={18} color={COLORS.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={handleClearMessages}
                accessibilityLabel="Clear conversation"
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Central Holographic Orb — full size on first launch, shrinks
              toward the top once the conversation begins so the transcript
              claims the space (DESIGN.md); hidden while typing */}
          {!keyboardVisible && (
            <View
              style={[
                styles.orbContainer,
                { paddingVertical: orbPadding },
                hasTranscript && styles.orbContainerCompact,
              ]}
            >
              <JarvisOrb state={state} size={orbSize} level={audioLevel} />
            </View>
          )}

          {hasTranscript && (
            <View style={styles.chatSection}>
              <TranscriptList messages={messages} onDelete={removeMessage} />
            </View>
          )}

          {/* Error Banner — sits above the mic button (DESIGN.md); solid,
              auto-dismisses after ~4s, tap to dismiss, optional RETRY link
              when the failure is retryable (e.g. transcription failed) */}
          <View style={styles.bottomDock}>
            {!online && (
              <View style={styles.offlineBanner} accessibilityLiveRegion="polite">
                <Ionicons name="cloud-offline-outline" size={14} color={COLORS.canvas} />
                <Text style={styles.offlineBannerText}>
                  OFFLINE — REPLIES NEED THE NETWORK
                </Text>
              </View>
            )}

            {notice && (
              <TouchableOpacity
                style={styles.noticeBanner}
                onPress={() => setNotice(null)}
                accessibilityRole="button"
                accessibilityLabel="Dismiss notice"
                activeOpacity={0.9}
              >
                <Text style={styles.noticeBannerText}>{notice}</Text>
                <Ionicons name="close" size={14} color={COLORS.bodyMuted} />
              </TouchableOpacity>
            )}

            {/* First-run credential card — shown only until a key exists. */}
            {keysReady && !hasKeys && (
              <View style={styles.setupCard}>
                <Text style={styles.setupTitle}>CONNECT GROQ</Text>
                <Text style={styles.setupBody}>
                  Jarvis needs a Groq API key to think. Paste one below, or add
                  EXPO_PUBLIC_GROQ_API_KEY to your .env and rebuild.
                </Text>
                <TextInput
                  key={`g${keyFormNonce}`}
                  style={styles.setupInput}
                  placeholder="gsk_… Groq key"
                  placeholderTextColor={COLORS.bodyFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  defaultValue=""
                  onChangeText={(value) => {
                    groqKeyDraft.current = value;
                  }}
                  accessibilityLabel="Groq API key"
                />
                <TextInput
                  key={`f${keyFormNonce}`}
                  style={styles.setupInput}
                  placeholder="Fish Audio key (optional)"
                  placeholderTextColor={COLORS.bodyFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  defaultValue=""
                  onChangeText={(value) => {
                    fishKeyDraft.current = value;
                  }}
                  accessibilityLabel="Fish Audio API key"
                />
                <TouchableOpacity
                  style={styles.setupBtn}
                  onPress={saveKeys}
                  accessibilityRole="button"
                  accessibilityLabel="Save API keys"
                >
                  <Text style={styles.setupBtnText}>SAVE &amp; START</Text>
                </TouchableOpacity>
              </View>
            )}

            {errorMessage && (
              <View style={styles.errorBanner}>
                <TouchableOpacity
                  style={styles.errorBannerMsg}
                  onPress={() => setError(null)}
                  activeOpacity={0.9}
                  accessibilityLabel="Dismiss error"
                >
                  <Text style={styles.errorBannerText} numberOfLines={2}>
                    {errorMessage}
                  </Text>
                </TouchableOpacity>
                {retryInfo && (
                  <TouchableOpacity
                    onPress={handleRetry}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Retry transcription"
                  >
                    <Text style={styles.retryLink}>RETRY</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Main Central Mic Button */}
            <MicButton state={state} onPress={handleMicPress} />

            {/* Text Input Fallback Row */}
            <View style={styles.inputRow}>
              {inputFocused && <View style={styles.inputGlow} />}

              {/* Image attachment (GAP-A6) — staged until the send arrow. */}
              <Pressable
                onPress={handleAttachImage}
                accessibilityRole="button"
                accessibilityLabel={
                  pendingImage ? 'Replace the attached image' : 'Attach an image'
                }
                hitSlop={8}
                style={({ pressed }) => [
                  styles.attachBtn,
                  pendingImage && styles.attachBtnActive,
                  { transform: [{ scale: pressed ? 0.92 : 1 }] },
                ]}
              >
                <Ionicons
                  name={pendingImage ? 'image' : 'image-outline'}
                  size={18}
                  color={pendingImage ? COLORS.primary : COLORS.bodyMuted}
                />
              </Pressable>

              <TextInput
                style={styles.textInput}
                placeholder="Type a directive..."
                placeholderTextColor={COLORS.bodyFaint}
                value={inputText}
                onChangeText={setInputText}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onSubmitEditing={handleSendText}
                returnKeyType="send"
              />

              {/* Send arrow appears only once there is something to send
                  (DESIGN.md) — text, a staged image, or both. */}
              {inputText.trim() || pendingImage ? (
                <Pressable
                  onPress={handleSendText}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.sendBtn,
                    { transform: [{ scale: pressed ? 0.92 : 1 }] },
                  ]}
                >
                  <Ionicons name="arrow-up" size={20} color={COLORS.primary} />
                </Pressable>
              ) : null}
            </View>

            {/* Staged-image chip — makes it obvious a picture will go with the
                next directive, and lets it be dropped before sending. */}
            {pendingImage && (
              <View style={styles.pendingImageRow}>
                <Ionicons name="image-outline" size={14} color={COLORS.primary} />
                <Text style={styles.pendingImageText}>IMAGE READY</Text>
                <TouchableOpacity
                  onPress={() => setPendingImage(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove attached image"
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={16} color={COLORS.bodyMuted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>

        <Modal
          visible={settingsVisible}
          transparent
          animationType="fade"
          presentationStyle="overFullScreen"
          onRequestClose={handleCloseSettings}
        >
          <View style={styles.settingsOverlay}>
            <View style={styles.settingsSheet}>
              <View style={styles.settingsHeader}>
                <Text style={styles.settingsTitle}>SYSTEM CONFIGURATION</Text>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={handleCloseSettings}
                  accessibilityLabel="Close settings"
                  hitSlop={8}
                >
                  <Ionicons name="close-outline" size={20} color={COLORS.primary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.settingsContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.settingsGroup}>
                  <Text style={styles.settingsSection}>ASSISTANT</Text>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Voice responses</Text>
                      <Text style={styles.settingsRowDescription}>Speak replies through the active output.</Text>
                    </View>
                    <Switch
                      value={voiceEnabled}
                      onValueChange={setVoiceEnabled}
                      trackColor={{
                        false: COLORS.dividerSoft,
                        true: COLORS.primary,
                      }}
                      thumbColor={voiceEnabled ? COLORS.onPrimary : COLORS.bodyFaint}
                    />
                  </View>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Concise responses</Text>
                      <Text style={styles.settingsRowDescription}>Keep replies to one or two short sentences.</Text>
                    </View>
                    <Switch
                      value={conciseResponses}
                      onValueChange={setConciseResponses}
                      trackColor={{
                        false: COLORS.dividerSoft,
                        true: COLORS.primary,
                      }}
                      thumbColor={conciseResponses ? COLORS.onPrimary : COLORS.bodyFaint}
                    />
                  </View>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Continuous conversation</Text>
                      <Text style={styles.settingsRowDescription}>
                        Re-open the mic automatically after each reply.
                      </Text>
                    </View>
                    <Switch
                      value={settings.continuousMode}
                      onValueChange={setContinuousMode}
                      trackColor={{ false: COLORS.dividerSoft, true: COLORS.primary }}
                      thumbColor={
                        settings.continuousMode ? COLORS.onPrimary : COLORS.bodyFaint
                      }
                    />
                  </View>
                </View>

                <View style={styles.settingsGroup}>
                  <Text style={styles.settingsSection}>MODEL</Text>

                  {CHAT_MODEL_OPTIONS.map((option) => {
                    const selected = settings.chatModel === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.settingsRow, selected && styles.optionRowSelected]}
                        onPress={() => setChatModel(option.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <View style={styles.settingsRowCopy}>
                          <Text style={styles.settingsRowLabel}>{option.label}</Text>
                          <Text style={styles.settingsRowDescription}>{option.note}</Text>
                        </View>
                        {selected && (
                          <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  })}

                  <Text style={styles.fieldLabel}>PERSONA ADDENDUM</Text>
                  <TextInput
                    style={[styles.setupInput, styles.personaInput]}
                    placeholder="e.g. Always answer as a starship computer."
                    placeholderTextColor={COLORS.bodyFaint}
                    multiline
                    defaultValue={settings.persona}
                    onChangeText={setPersona}
                    accessibilityLabel="Extra persona instructions"
                  />
                </View>

                <View style={styles.settingsGroup}>
                  <Text style={styles.settingsSection}>VOICE</Text>

                  <Text style={styles.fieldLabel}>FISH AUDIO VOICE</Text>
                  <View style={styles.chipRow}>
                    {FISH_AUDIO_VOICE_OPTIONS.map((voice) => {
                      const selected = settings.speech.fishVoiceId === voice.id;
                      return (
                        <TouchableOpacity
                          key={voice.id}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => updateSpeech({ fishVoiceId: voice.id })}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {voice.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    style={styles.setupInput}
                    placeholder="…or paste any Fish Audio reference id"
                    placeholderTextColor={COLORS.bodyFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    defaultValue={settings.speech.fishVoiceId}
                    onChangeText={(value) => updateSpeech({ fishVoiceId: value.trim() })}
                    accessibilityLabel="Fish Audio reference id"
                  />

                  <Text style={styles.fieldLabel}>DEVICE VOICE</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, !settings.speech.deviceVoiceId && styles.chipSelected]}
                      onPress={() => updateSpeech({ deviceVoiceId: null })}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.chipText,
                          !settings.speech.deviceVoiceId && styles.chipTextSelected,
                        ]}
                      >
                        System default
                      </Text>
                    </TouchableOpacity>
                    {deviceVoices.map((voice) => {
                      const selected = settings.speech.deviceVoiceId === voice.id;
                      return (
                        <TouchableOpacity
                          key={voice.id}
                          style={[styles.chip, selected && styles.chipSelected]}
                          onPress={() => updateSpeech({ deviceVoiceId: voice.id })}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <Text
                            style={[styles.chipText, selected && styles.chipTextSelected]}
                            numberOfLines={1}
                          >
                            {voice.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Speech rate</Text>
                      <Text style={styles.settingsRowDescription}>
                        {settings.speech.rate.toFixed(2)}×
                      </Text>
                    </View>
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() =>
                          updateSpeech({ rate: clamp(settings.speech.rate - 0.05, 0.5, 2) })
                        }
                        accessibilityLabel="Slower speech"
                        hitSlop={8}
                      >
                        <Ionicons name="remove" size={18} color={COLORS.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() =>
                          updateSpeech({ rate: clamp(settings.speech.rate + 0.05, 0.5, 2) })
                        }
                        accessibilityLabel="Faster speech"
                        hitSlop={8}
                      >
                        <Ionicons name="add" size={18} color={COLORS.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>


                <View style={styles.settingsGroup}>
                  <Text style={styles.settingsSection}>USAGE &amp; QUOTA</Text>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Groq free tier</Text>
                      <Text style={styles.settingsRowDescription}>{groqQuotaText}</Text>
                    </View>
                    <Ionicons
                      name={groqQuota?.throttled ? 'warning-outline' : 'speedometer-outline'}
                      size={18}
                      color={groqQuota?.throttled ? COLORS.listening : COLORS.primary}
                    />
                  </View>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Fish Audio credit</Text>
                      <Text style={styles.settingsRowDescription}>
                        {fishQuota?.credit
                          ? `${fishQuota.credit} available`
                          : 'Not loaded — tap refresh.'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={refreshFishCredit}
                      accessibilityRole="button"
                      accessibilityLabel="Refresh Fish Audio credit balance"
                      hitSlop={8}
                    >
                      <Ionicons name="refresh-outline" size={18} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.settingsRow}
                    onPress={handleExportTranscript}
                    accessibilityRole="button"
                    accessibilityLabel="Share transcript"
                    disabled={!hasTranscript}
                  >
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Export transcript</Text>
                      <Text style={styles.settingsRowDescription}>
                        Share this conversation as plain text.
                      </Text>
                    </View>
                    <Ionicons
                      name="share-outline"
                      size={18}
                      color={hasTranscript ? COLORS.primary : COLORS.bodyFaint}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.settingsGroupLast}>
                  <Text style={styles.settingsSection}>SYSTEM</Text>

                  <View style={styles.settingsRow}>
                    <View style={styles.settingsRowCopy}>
                      <Text style={styles.settingsRowLabel}>Active model</Text>
                      <Text style={styles.settingsRowDescription}>
                        {hasFishCredentials() ? 'Groq + Fish Audio TTS' : 'Groq (device voice)'}
                      </Text>
                    </View>
                    <Text style={styles.settingsModel}>
                      {formatModelBadge(settings.chatModel || CHAT_MODEL_BADGE)}
                    </Text>
                  </View>

                  <Text style={styles.fieldLabel}>API KEYS (STORED ON THIS DEVICE)</Text>
                  <TextInput
                    key={`sg${keyFormNonce}`}
                    style={styles.setupInput}
                    placeholder={hasGroqCredentials() ? 'Groq key saved — enter to replace' : 'gsk_… Groq key'}
                    placeholderTextColor={COLORS.bodyFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    defaultValue=""
                    onChangeText={(value) => {
                      groqKeyDraft.current = value;
                    }}
                    accessibilityLabel="Groq API key"
                  />
                  <TextInput
                    key={`sf${keyFormNonce}`}
                    style={styles.setupInput}
                    placeholder={hasFishCredentials() ? 'Fish key saved — enter to replace' : 'Fish Audio key (optional)'}
                    placeholderTextColor={COLORS.bodyFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    defaultValue=""
                    onChangeText={(value) => {
                      fishKeyDraft.current = value;
                    }}
                    accessibilityLabel="Fish Audio API key"
                  />
                  <TouchableOpacity
                    style={styles.setupBtn}
                    onPress={saveKeys}
                    accessibilityRole="button"
                    accessibilityLabel="Save API keys"
                  >
                    <Text style={styles.setupBtnText}>SAVE KEYS</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.settingsRow}
                    onPress={handleClearMessages}
                    accessibilityLabel="Clear conversation"
                  >
                    <Text style={styles.settingsRowLabel}>Clear conversation</Text>
                    <Ionicons name="trash-outline" size={18} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.canvas,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.dividerSoft,
    backgroundColor: COLORS.canvas,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: {
    ...TYPOGRAPHY.sectionHeading,
    color: COLORS.ink,
    fontFamily: FONTS.display,
  },
  brandTitleHero: {
    ...TYPOGRAPHY.heroDisplay,
  },
  brandSubtitle: {
    ...TYPOGRAPHY.statusLabel,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.mono,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  statusPill: {
    backgroundColor: COLORS.surface2,
    paddingVertical: SPACING.xxs,
    paddingHorizontal: SPACING.sm,
    borderRadius: ROUNDED.pill,
  },
  statusPillText: {
    ...TYPOGRAPHY.statusLabel,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.mono,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    width: '100%',
    backgroundColor: COLORS.listening,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: SPACING.xs,
    borderRadius: ROUNDED.sm,
  },
  offlineBannerText: {
    ...TYPOGRAPHY.finePrint,
    color: COLORS.canvas,
    fontFamily: FONTS.mono,
    letterSpacing: 1,
    fontWeight: '600',
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    width: '100%',
    backgroundColor: COLORS.surfaceTile1,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: SPACING.xs,
    borderRadius: ROUNDED.sm,
  },
  noticeBannerText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.body,
    flex: 1,
  },
  setupCard: {
    width: '100%',
    backgroundColor: COLORS.surface1,
    borderColor: COLORS.primary,
    borderWidth: 1,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    borderRadius: ROUNDED.md,
    gap: SPACING.xs,
  },
  setupTitle: {
    ...TYPOGRAPHY.statusLabel,
    color: COLORS.primaryGlow,
    fontFamily: FONTS.mono,
  },
  setupBody: {
    ...TYPOGRAPHY.caption,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.body,
  },
  setupInput: {
    ...TYPOGRAPHY.inputText,
    color: COLORS.ink,
    fontFamily: FONTS.body,
    backgroundColor: COLORS.surface2,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: ROUNDED.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  setupBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: ROUNDED.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: SPACING.xxs,
  },
  setupBtnText: {
    ...TYPOGRAPHY.buttonLabel,
    color: COLORS.onPrimary,
    fontFamily: FONTS.body,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    width: '100%',
    backgroundColor: COLORS.error,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: SPACING.xs,
    borderRadius: ROUNDED.sm,
  },
  errorBannerMsg: {
    flex: 1,
  },
  errorBannerText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.onPrimary,
    fontFamily: FONTS.body,
  },
  retryLink: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primaryGlow,
    fontFamily: FONTS.body,
  },
  orbContainer: {
    flex: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 0,
  },
  orbContainerCompact: {
    flex: 0,
    minHeight: 128,
    paddingVertical: SPACING.xs,
  },
  chatSection: {
    flex: 1,
    minHeight: 120,
    backgroundColor: COLORS.canvas,
  },
  bottomDock: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: Platform.OS === 'ios' ? SPACING.sm : SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.dividerSoft,
    backgroundColor: COLORS.canvas,
    alignItems: 'center',
  },
  inputRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    borderRadius: ROUNDED.pill,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    width: '100%',
    marginTop: SPACING.xs,
  },
  inputGlow: {
    position: 'absolute',
    top: -4,
    right: -4,
    bottom: -4,
    left: -4,
    borderRadius: ROUNDED.pill,
    borderWidth: 1,
    borderColor: COLORS.primary,
    opacity: 0.35,
  },
  textInput: {
    ...TYPOGRAPHY.inputText,
    flex: 1,
    color: COLORS.ink,
    paddingVertical: 6,
    fontFamily: FONTS.body,
  },
  sendBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: SPACING.xs,
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  settingsSheet: {
    backgroundColor: COLORS.surface1,
    borderTopLeftRadius: ROUNDED.lg,
    borderTopRightRadius: ROUNDED.lg,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    maxHeight: '86%',
    overflow: 'hidden',
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  settingsContent: {
    flex: 1,
  },
  settingsTitle: {
    ...TYPOGRAPHY.sectionHeading,
    color: COLORS.ink,
    fontFamily: FONTS.display,
  },
  settingsSection: {
    ...TYPOGRAPHY.sectionHeading,
    color: COLORS.ink,
    fontFamily: FONTS.display,
    marginBottom: SPACING.sm,
  },
  settingsGroup: {
    marginBottom: SPACING.xl,
  },
  settingsGroupLast: {
    marginBottom: 0,
  },
  settingsRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceTile1,
    borderRadius: ROUNDED.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    marginBottom: SPACING.xs,
  },
  settingsRowCopy: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  settingsRowLabel: {
    ...TYPOGRAPHY.chatText,
    color: COLORS.body,
    fontFamily: FONTS.body,
  },
  settingsRowDescription: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xxs,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.body,
  },
  settingsModel: {
    ...TYPOGRAPHY.finePrint,
    maxWidth: 150,
    color: COLORS.bodyMuted,
    textAlign: 'right',
    fontFamily: FONTS.body,
  },
  optionRowSelected: {
    borderColor: COLORS.primary,
    borderWidth: 1,
  },
  fieldLabel: {
    ...TYPOGRAPHY.finePrint,
    color: COLORS.bodyFaint,
    fontFamily: FONTS.mono,
    letterSpacing: 1.2,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xxs,
  },
  personaInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  chip: {
    backgroundColor: COLORS.surfaceTile1,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: ROUNDED.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    maxWidth: 200,
  },
  chipSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceTile2,
  },
  chipText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.body,
  },
  chipTextSelected: {
    color: COLORS.primaryGlow,
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceTile1,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: ROUNDED.sm,
  },
  attachBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ROUNDED.sm,
    marginRight: SPACING.xxs,
  },
  attachBtnActive: {
    backgroundColor: COLORS.surfaceTile2,
  },
  pendingImageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs,
    alignSelf: 'flex-start',
    marginTop: SPACING.xxs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 5,
    backgroundColor: COLORS.surfaceTile1,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: ROUNDED.pill,
  },
  pendingImageText: {
    ...TYPOGRAPHY.finePrint,
    color: COLORS.primaryGlow,
    fontFamily: FONTS.mono,
    letterSpacing: 1.1,
  },
});
