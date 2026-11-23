import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChatMessage } from '../types';
import { COLORS, FONTS, ROUNDED, SPACING, TYPOGRAPHY } from '../theme';
import { formatSingleMessage } from '../utils/transcript';

interface ChatBubbleProps {
  message: ChatMessage;
  /** True when the previous turn was a user message and this one is the
   *  assistant's reply — the one gap that opens up to 16px (DESIGN.md). */
  beat?: boolean;
  first?: boolean;
  /** Long-press "Delete" handler supplied by the transcript. */
  onDelete?: (id: string) => void;
}

/** Blinking insertion caret shown while tokens are still arriving. */
const StreamingCaret: React.FC = () => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);
  return <Text style={[styles.caret, !visible && styles.caretHidden]}>▍</Text>;
};

const hostOf = (url: string): string => {
  // No `new URL()` — Hermes' URL support is partial across RN versions.
  const host = url.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  return host.replace(/^www\./, '') || url;
};

export const ChatBubble: React.FC<ChatBubbleProps> = React.memo(function ChatBubble({
  message,
  beat,
  first,
  onDelete,
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const timeStr = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const streaming = !!message.streaming;
  const sources = message.sources ?? [];

  const handleLongPress = () => {
    const actions: {
      text: string;
      style?: 'default' | 'cancel' | 'destructive';
      onPress?: () => void;
    }[] = [
      {
        text: 'Copy',
        onPress: () => {
          Share.share({ message: formatSingleMessage(message) }).catch(() => {});
        },
      },
    ];
    if (onDelete) {
      actions.push({
        text: 'Delete',
        style: 'destructive',
        onPress: () => onDelete(message.id),
      });
    }
    actions.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(isUser ? 'Your message' : 'J.A.R.V.I.S.', message.content, actions);
  };

  return (
    <View
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
        // 12px between turns; 16px when a user turn is followed by the
        // assistant reply that answers it.
        { marginTop: first ? 0 : beat ? SPACING.md : SPACING.sm },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onLongPress={handleLongPress}
        delayLongPress={320}
        accessibilityHint="Long press for copy and delete"
      >
        <View
          style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}
          // Screen readers are told when a reply lands (GAP-F2). Combined with
          // the explicit announce() in useJarvis this covers both the
          // "already mounted" and "freshly mounted" cases.
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          accessibilityLabel={`${isUser ? 'You' : 'J.A.R.V.I.S.'} said: ${message.content}`}
        >
          {/* Thumbnail for a turn that carried an image (GAP-A6). */}
          {message.imageUri ? (
            <Image
              source={{ uri: message.imageUri }}
              style={styles.attachment}
              resizeMode="cover"
              accessibilityLabel="Attached image"
            />
          ) : null}
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {message.content}
            {streaming && !isUser ? <StreamingCaret /> : null}
          </Text>
        </View>
        <Text style={[styles.timeText, isUser && styles.userTimeText]}>{timeStr}</Text>
      </TouchableOpacity>

      {/* Attribution for replies that leaned on live web results. */}
      {!isUser && sources.length > 0 && (
        <View style={styles.sources}>
          <Text style={styles.sourcesLabel}>SOURCES</Text>
          <View style={styles.sourceChips}>
            {sources.slice(0, 4).map((source) => (
              <TouchableOpacity
                key={source.url}
                style={styles.sourceChip}
                onPress={() => Linking.openURL(source.url).catch(() => {})}
                accessibilityRole="link"
                accessibilityLabel={`Open source ${source.title || hostOf(source.url)}`}
              >
                <Text style={styles.sourceChipText} numberOfLines={1}>
                  {source.title || hostOf(source.url)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 0,
    maxWidth: '86%',
  },
  userContainer: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  bubble: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: ROUNDED.md,
  },
  attachment: {
    width: 180,
    height: 140,
    borderRadius: ROUNDED.sm,
    marginBottom: SPACING.xxs,
    backgroundColor: COLORS.surfaceTile2,
  },
  assistantBubble: {
    backgroundColor: COLORS.bubbleAssistant,
    borderBottomLeftRadius: ROUNDED.none,
  },
  userBubble: {
    backgroundColor: COLORS.bubbleUser,
    borderBottomRightRadius: ROUNDED.none,
  },
  messageText: {
    ...TYPOGRAPHY.chatText,
    color: COLORS.body,
    fontFamily: FONTS.body,
  },
  userMessageText: {
    color: COLORS.onPrimary,
  },
  timeText: {
    ...TYPOGRAPHY.timestamp,
    marginTop: SPACING.xxs,
    color: COLORS.bodyFaint,
    fontFamily: FONTS.mono,
  },
  userTimeText: {
    textAlign: 'right',
  },
  caret: {
    ...TYPOGRAPHY.chatText,
    color: COLORS.primaryGlow,
    fontWeight: '700',
  },
  caretHidden: {
    opacity: 0,
  },
  sources: {
    marginTop: SPACING.xs,
    maxWidth: '100%',
  },
  sourcesLabel: {
    ...TYPOGRAPHY.finePrint,
    color: COLORS.bodyFaint,
    fontFamily: FONTS.mono,
    letterSpacing: 1.2,
    marginBottom: SPACING.xxs,
  },
  sourceChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xxs,
  },
  sourceChip: {
    backgroundColor: COLORS.surfaceTile1,
    borderColor: COLORS.hairline,
    borderWidth: 1,
    borderRadius: ROUNDED.pill,
    paddingVertical: 3,
    paddingHorizontal: 10,
    maxWidth: 190,
  },
  sourceChipText: {
    ...TYPOGRAPHY.finePrint,
    color: COLORS.primaryGlow,
    fontFamily: FONTS.mono,
  },
});
