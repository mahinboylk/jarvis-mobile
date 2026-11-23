import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { COLORS, FONTS, ORB_STATE_STYLE, SPACING, TYPOGRAPHY } from '../theme';
import { announce } from '../utils/a11y';

interface JarvisOrbProps {
  state: AssistantState;
  size?: number;
  /** Live mic RMS (0..1) — drives the amplitude-reactive core while listening. */
  level?: number;
}

export const JarvisOrb: React.FC<JarvisOrbProps> = ({ state, size = 160, level = 0 }) => {
  const pulse = useSharedValue(1);
  const ripple = useSharedValue(1);
  const rotation = useSharedValue(0);
  // Live subscription — flipping the OS setting mid-session stops the motion.
  const reduceMotion = useReduceMotion();
  const { glow: themeColor, glowOpacity } =
    ORB_STATE_STYLE[state] ?? ORB_STATE_STYLE.idle;

  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(ripple);
    cancelAnimation(rotation);

    if (reduceMotion) {
      pulse.value = 1;
      ripple.value = 1;
      rotation.value = 0;
      return;
    }

    let pulseDuration = 4000;
    let maxScale = 1.02;
    let minScale = 1;

    if (state === 'listening' || state === 'transcribing') {
      pulseDuration = 600;
      maxScale = 1.18;
    } else if (state === 'thinking') {
      pulseDuration = 1200;
      maxScale = 1.12;
    } else if (state === 'speaking') {
      pulseDuration = 600;
      maxScale = 1.22;
    } else if (state === 'idle') {
      // Slow 4s breathing between 98% and 100% (DESIGN.md idle orb).
      minScale = 0.98;
    }

    const halfDuration = pulseDuration / 2;
    pulse.value = withRepeat(
      withSequence(
        withTiming(maxScale, {
          duration: halfDuration,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(minScale, {
          duration: halfDuration,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1,
      true
    );

    if (state !== 'idle') {
      ripple.value = withRepeat(
        withSequence(
          withTiming(1.35, {
            duration: pulseDuration / 2,
            easing: Easing.out(Easing.ease),
          }),
          withTiming(1, { duration: 120 })
        ),
        -1,
        false
      );

      rotation.value = withRepeat(
        withTiming(1, {
          duration: state === 'thinking' ? 3000 : 1800,
          easing: Easing.linear,
        }),
        -1,
        false
      );
    } else {
      ripple.value = 1;
      rotation.value = 0;
    }

    return () => {
      cancelAnimation(pulse);
      cancelAnimation(ripple);
      cancelAnimation(rotation);
    };
  }, [state, reduceMotion, pulse, ripple, rotation]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity * (0.85 + 0.15 * pulse.value),
    transform: [{ scale: ripple.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 360}deg` }],
  }));

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const getStatusBar = () => {
    switch (state) {
      case 'listening':
        return 'LISTENING';
      case 'transcribing':
        return 'TRANSCRIBING';
      case 'searching':
        return 'SEARCHING';
      case 'thinking':
        return 'THINKING';
      case 'speaking':
        return 'SPEAKING';
      case 'error':
        return 'ERROR';
      case 'idle':
      default:
        return 'STANDBY';
    }
  };

  const getStatusLabel = getStatusBar;

  // Screen-reader users get the same state signal sighted users read from the
  // glow. Announced once per transition, never per animation frame.
  const announcedRef = useRef<string>('');
  useEffect(() => {
    const label = getStatusBar();
    if (announcedRef.current === label) return;
    announcedRef.current = label;
    announce(`Jarvis: ${label.toLowerCase()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Amplitude-reactive core (DESIGN.md `pulse-fast`): the dot swells with the
  // user's actual voice instead of a fixed-timing pulse.
  const clampedLevel = Math.min(1, Math.max(0, state === 'listening' ? level : 0));
  const dotSize = size * 0.38;
  const dotScale = 1 + clampedLevel * 0.9;

  const haloSize = size * 1.35;
  const ringSize = size * 1.14;

  return (
    <View style={styles.container}>
      <View style={[styles.orbWrapper, { width: size, height: size }]}>
        <Animated.View
          style={[
            styles.halo,
            {
              width: haloSize,
              height: haloSize,
              borderRadius: haloSize / 2,
              borderColor: themeColor,
            },
            haloStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.ring,
            {
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderColor: themeColor,
            },
            ringStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.core,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: themeColor,
            },
            coreStyle,
          ]}
        >
          <View
            style={[
              styles.coreDot,
              {
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: themeColor,
                transform: [{ scale: dotScale }],
              },
            ]}
          />
        </Animated.View>
      </View>

      {/* Orb state readout: static muted HUD text — hue lives only in the
          glow (and the mic button), never in the label itself. The live region
          keeps screen readers in step with the announced transition above. */}
      <Text style={styles.statusText} accessibilityLiveRegion="polite" accessible>
        {getStatusLabel()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
  },
  orbWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  halo: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.25,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 0.55,
  },
  core: {
    backgroundColor: COLORS.surfaceTile1,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreDot: {
    opacity: 0.78,
  },
  statusText: {
    ...TYPOGRAPHY.statusLabel,
    marginTop: SPACING.xs,
    color: COLORS.bodyMuted,
    fontFamily: FONTS.mono,
  },
});
