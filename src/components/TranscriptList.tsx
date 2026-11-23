import React, { useEffect, useRef } from 'react';
import {
  FlatList,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';
import { ChatMessage } from '../types';
import { SPACING } from '../theme';
import { ChatBubble } from './ChatBubble';

interface TranscriptListProps {
  messages: ChatMessage[];
  /** Long-press delete on a bubble; omitted means deletion is disabled. */
  onDelete?: (id: string) => void;
}

/** How close to the end still counts as "parked at the bottom". */
const BOTTOM_THRESHOLD = 48;

export const TranscriptList: React.FC<TranscriptListProps> = ({ messages, onDelete }) => {
  const flatListRef = useRef<FlatList>(null);
  // Auto-follow only while the user is parked at the bottom; otherwise every
  // new message would yank them away from the history they are reading.
  // Deliberately updated from end-of-gesture events only, so layout growth
  // cannot flip the flag underneath us.
  const atBottomRef = useRef(true);

  const scrollToEnd = (animated = true) => {
    flatListRef.current?.scrollToEnd({ animated });
  };

  const trackScrollPosition = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - contentOffset.y - layoutMeasurement.height;
    atBottomRef.current = distanceFromEnd <= BOTTOM_THRESHOLD;
  };

  // When the keyboard opens, the layout shrinks — re-pin to the latest
  // message so the input doesn't cover the conversation tail.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      if (atBottomRef.current) scrollToEnd(true);
    });
    return () => show.remove();
  }, []);

  // New messages pin to the bottom; the user's own turn always follows.
  useEffect(() => {
    if (messages.length === 0) return;
    if (messages[messages.length - 1].role === 'user') atBottomRef.current = true;
    if (atBottomRef.current) scrollToEnd(true);
  }, [messages]);

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ChatBubble
            message={item}
            onDelete={onDelete}
            beat={
              index > 0 &&
              messages[index - 1].role === 'user' &&
              item.role === 'assistant'
            }
            first={index === 0}
          />
        )}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        onScrollEndDrag={trackScrollPosition}
        onMomentumScrollEnd={trackScrollPosition}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        initialNumToRender={10}
        windowSize={11}
        onContentSizeChange={() => {
          if (atBottomRef.current) flatListRef.current?.scrollToEnd({ animated: true });
        }}
        onLayout={() => {
          atBottomRef.current = true;
          flatListRef.current?.scrollToEnd({ animated: false });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  contentContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
});
