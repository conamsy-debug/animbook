/**
 * AnimBook mobile notifications.
 *
 * Local-only schedule — no remote push tokens. The Reader uses local
 * notifications to nudge the reader at a daily cadence ("your AnimBook
 * is waiting") and to log a DREAM drift event when the runtime thinks
 * the reader fell asleep.
 *
 * On web the entire module short-circuits silently — `expo-notifications`
 * is iOS / Android only.
 */
import { Platform } from "react-native";

type ScheduleArgs = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  triggerSeconds: number;
  identifier?: string;
};

interface NotificationsModule {
  setNotificationHandler(handler: {
    handleNotification: () => { shouldShowAlert: boolean; shouldShowBanner: boolean; shouldShowList: boolean; shouldPlaySound: boolean; shouldSetBadge: boolean };
  }): void;
  getPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  requestPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  scheduleNotificationAsync(args: {
    identifier?: string;
    content: { title: string; body: string; data?: Record<string, unknown> };
    trigger: { type: "timeInterval" | "daily"; seconds?: number; hour?: number; minute?: number; repeats?: boolean };
  }): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
  cancelAllScheduledNotificationsAsync(): Promise<void>;
  getAllScheduledNotificationsAsync(): Promise<unknown[]>;
}

let cached: NotificationsModule | null = null;
let resolved = false;

function load(): NotificationsModule | null {
  if (resolved) return cached;
  resolved = true;
  if (Platform.OS === "web") return null;
  try {
    // require lazily so the web bundle stays free of native code.
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function notificationsAvailable(): boolean {
  return load() !== null;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const mod = load();
  if (!mod) return false;
  const current = await mod.getPermissionsAsync();
  if (current.granted) return true;
  const next = await mod.requestPermissionsAsync();
  return next.granted;
}

export async function registerNotificationHandler(): Promise<void> {
  const mod = load();
  if (!mod) return;
  mod.setNotificationHandler({
    handleNotification: () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false
    })
  });
}

export async function scheduleLocal({ title, body, data, triggerSeconds, identifier }: ScheduleArgs): Promise<string | null> {
  const mod = load();
  if (!mod) return null;
  const content: { title: string; body: string; data?: Record<string, unknown> } = { title, body };
  if (data) content.data = data;
  const args: {
    identifier?: string;
    content: { title: string; body: string; data?: Record<string, unknown> };
    trigger: { type: "timeInterval"; seconds: number; repeats: false };
  } = {
    content,
    trigger: { type: "timeInterval", seconds: Math.max(1, triggerSeconds), repeats: false }
  };
  if (identifier) args.identifier = identifier;
  return mod.scheduleNotificationAsync(args);
}

export async function cancelScheduled(identifier: string): Promise<void> {
  const mod = load();
  if (!mod) return;
  await mod.cancelScheduledNotificationAsync(identifier);
}

export async function cancelAll(): Promise<void> {
  const mod = load();
  if (!mod) return;
  await mod.cancelAllScheduledNotificationsAsync();
}

export async function listScheduled(): Promise<unknown[]> {
  const mod = load();
  if (!mod) return [];
  return mod.getAllScheduledNotificationsAsync();
}

const DAILY_REMINDER_ID = "animbook.daily.reminder";

export async function scheduleDailyReadingReminder(): Promise<string | null> {
  // 24 hours from now — local time, repeats once. The Reader re-schedules
  // when the user opens the app so the cadence stays roughly daily.
  return scheduleLocal({
    identifier: DAILY_REMINDER_ID,
    title: "Your AnimBook is waiting",
    body: "Flip a page. The world comes back.",
    triggerSeconds: 60 * 60 * 24,
    data: { type: "daily_reminder" }
  });
}

export async function scheduleDreamDriftLog(bookTitle: string): Promise<string | null> {
  return scheduleLocal({
    identifier: `dream.drift.${Date.now()}`,
    title: "DREAM drift · logged",
    body: `You drifted through ${bookTitle}. The Reader saved the session.`,
    triggerSeconds: 5,
    data: { type: "dream_drift_log" }
  });
}