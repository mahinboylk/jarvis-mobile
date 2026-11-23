import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Live subscription to the OS "Reduce Motion" setting (GAP-F3).
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a one-shot promise, so reading
 * it in a mount effect freezes the value for the lifetime of the component and
 * ignores a user who flips the setting mid-session. This hook re-reads on every
 * `reduceMotionChanged` event so the orb and mic animations stop the moment the
 * accessibility preference changes.
 *
 * @param fallback Value to use before the async query resolves (mount default).
 */
export function useReduceMotion(fallback = false): boolean {
  const [reduceMotion, setReduceMotion] = useState(fallback);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(!!enabled);
      })
      .catch(() => {
        /* Platform without an a11y service — keep the fallback. */
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(!!enabled)
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export default useReduceMotion;
