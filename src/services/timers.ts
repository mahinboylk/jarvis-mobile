export interface TimerHandle {
  id: string;
  label: string;
  createdAt: number;
  dueAt: number;
  durationMs: number;
  remainingMs: number;
}

export type TimerFireHandler = (timer: TimerHandle) => void;

/**
 * In-app countdown timers.
 *
 * There is no `expo-notifications` dependency, so a timer fires while the app
 * is alive and announces itself through the normal speech path. Background
 * delivery would require a native module and is intentionally out of scope.
 */
class TimerService {
  private timers = new Map<string, { handle: TimerHandle; timeout: ReturnType<typeof setTimeout> }>();
  private handler: TimerFireHandler | null = null;
  private counter = 0;

  /** Registered by the Jarvis hook so a firing timer can be spoken. */
  setHandler(handler: TimerFireHandler | null): void {
    this.handler = handler;
  }

  setTimer(seconds: number, label?: string): TimerHandle {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('Timer duration must be a positive number of seconds.');
    }
    const clampedSeconds = Math.min(Math.max(seconds, 1), 24 * 60 * 60);
    const durationMs = Math.round(clampedSeconds * 1000);
    const now = Date.now();
    this.counter += 1;
    const id = `timer_${now}_${this.counter}`;

    const handle: TimerHandle = {
      id,
      label: (label || '').trim() || this.describe(clampedSeconds),
      createdAt: now,
      dueAt: now + durationMs,
      durationMs,
      remainingMs: durationMs,
    };

    const timeout = setTimeout(() => {
      this.timers.delete(id);
      const fire = this.handler;
      if (fire) {
        try {
          fire({ ...handle, remainingMs: 0 });
        } catch (e) {
          console.warn('timer handler failed', e);
        }
      }
    }, durationMs);

    this.timers.set(id, { handle, timeout });
    return handle;
  }

  /** Cancel one timer by id, or the oldest when id is omitted. */
  cancel(id?: string): TimerHandle | null {
    if (this.timers.size === 0) return null;
    const targetId = id ?? this.oldestId();
    if (!targetId) return null;
    const entry = this.timers.get(targetId);
    if (!entry) return null;
    clearTimeout(entry.timeout);
    this.timers.delete(targetId);
    return entry.handle;
  }

  cancelAll(): void {
    this.timers.forEach((entry) => clearTimeout(entry.timeout));
    this.timers.clear();
  }

  list(): TimerHandle[] {
    const now = Date.now();
    return Array.from(this.timers.values())
      .map(({ handle }) => ({ ...handle, remainingMs: Math.max(0, handle.dueAt - now) }))
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  get count(): number {
    return this.timers.size;
  }

  private oldestId(): string | null {
    let oldest: TimerHandle | null = null;
    this.timers.forEach(({ handle }) => {
      if (!oldest || handle.createdAt < oldest.createdAt) oldest = handle;
    });
    return oldest ? (oldest as TimerHandle).id : null;
  }

  /** "5 minutes" / "90 seconds" / "1 hour 30 minutes". */
  describe(seconds: number): string {
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const parts: string[] = [];
    if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (secs || parts.length === 0) parts.push(`${secs} second${secs === 1 ? '' : 's'}`);
    return parts.join(' ');
  }
}

export const timerService = new TimerService();

/**
 * Parse a spoken duration into seconds. Accepts `90`, `5 minutes`,
 * `1 hour 30 minutes`, `2h15m`, and `2:30`.
 */
export function parseDuration(text: string): number | null {
  const input = String(text || '').toLowerCase().trim();
  if (!input) return null;

  // clock form  mm:ss or hh:mm:ss
  const clock = input.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const c = clock[3] !== undefined ? Number(clock[3]) : undefined;
    return c === undefined ? a * 60 + b : a * 3600 + b * 60 + c;
  }

  const unitSeconds: Record<string, number> = {
    h: 3600,
    hr: 3600,
    hrs: 3600,
    hour: 3600,
    hours: 3600,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1,
  };

  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const unit = unitSeconds[match[2]];
    if (unit) {
      total += Number(match[1]) * unit;
      matched = true;
    }
  }
  if (matched) return total;

  // bare number → minutes for anything >= 30? No: treat as seconds unless very
  // large, which is the least surprising reading of "set a timer for 300".
  const bare = input.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Number(bare[1]);
  return null;
}
