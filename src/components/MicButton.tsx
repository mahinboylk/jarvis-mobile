import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { AssistantState } from '../types';
import { COLORS, FONTS, SPACING, TYPOGRAPHY } from '../theme';

interface MicButtonProps {
  state: AssistantState;
  onPress: () => void;
}

export const MicButton: React.FC<MicButtonProps> = ({ state, onPress }) => {
  const pulse = useSharedValue(1);
  // Live subscription to the OS preference (GAP-F3), not a one-shot read.
  const reduceMotion = useReduceMotion();
  const isListening = state === 'listening';
  const isProcessing =
    state === 'transcribing' || state === 'thinking' || state === 'searching';
  const isSpeaking = state === 'speaking';
  // While Jarvis is busy the button becomes the STOP control (barge-in), so it
  // must never be disabled — that would strand the user mid-reply.
  const isBusy = isListening || isProcessing || isSpeaking;

  useEffect(() => {
    cancelAnimation(pulse);

    if (!isListening || reduceMotion) {
      pulse.value = 1;
      return;
    }

    pulse.value = withRepeat(
      withSequence(
        withTiming(1.22, {
          duration: 400,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(1, {
          duration: 400,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1,
      true
    );

    return () => cancelAnimation(pulse);
  }, [isListening, reduceMotion, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: isListening ? 0.55 + 0.2 * (pulse.value - 1) : 0,
    transform: [{ scale: pulse.value }],
  }));

  const getButtonColor = () => {
    if (isListening) return COLORS.listening;
    if (isSpeaking) return COLORS.speaking;
    if (isProcessing) return COLORS.thinking;
    return COLORS.primary;
  };

  const buttonColor = getButtonColor();
  const iconColor = isListening ? COLORS.canvas : COLORS.onPrimary;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  const getAccessibilityLabel = () => {
    if (isListening) return 'Stop recording';
    if (isSpeaking) return 'Interrupt Jarvis';
    if (isProcessing) return 'Stop Jarvis';
    return 'Talk to Jarvis';
  };

  const getHint = () => {
    if (isListening) return 'TAP TO FINISH';
    if (isSpeaking) return 'TAP TO INTERRUPT';
    if (isProcessing) return 'TAP TO STOP';
    return 'TAP TO TALK';
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.pulseRing,
          { borderColor: buttonColor },
          ringStyle,
        ]}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={getAccessibilityLabel()}
        accessibilityHint={getHint()}
        onPress={handlePress}
        disabled={false}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: isProcessing ? COLORS.thinking : buttonColor,
            opacity: pressed ? 0.92 : 1,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          },
        ]}
      >
        {isProcessing ? (
          // STOP glyph — the press cancels the in-flight turn.
          <Ionicons name="stop" size={28} color={COLORS.onPrimary} />
        ) : isSpeaking ? (
          <Ionicons name="megaphone-outline" size={28} color={iconColor} />
        ) : (
          <Ionicons
            name={isListening ? 'stop' : 'mic'}
            size={28}
            color={iconColor}
          />
        )}
      </Pressable>

      <Text
        style={styles.hintText}
        accessible
        accessibilityLiveRegion="polite"
      >
        {getHint()}
      </Text>
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {isBusy ? getAccessibilityLabel() : ''}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingVertical: SPACING.xs,
  },
  pulseRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    opacity: 0,
  },
  button: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    ...TYPOGRAPHY.statusLabel,
    marginTop: SPACING.xs,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.mono,
  },
  /** Visually hidden live region — keeps screen readers informed quietly. */
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
