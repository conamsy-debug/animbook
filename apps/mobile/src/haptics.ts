/**
 * AnimBook mobile haptics.
 *
 * Thin wrapper around expo-haptics. Every call falls through silently on
 * web / unsupported surfaces — the UI never breaks. The Reader uses a
 * 'medium' impact on every page flip; tabs use a 'selection' tap;
 * Companion mode-changes use 'success'.
 */
import * as Haptics from "expo-haptics";

export async function hapticFlip(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    // ignore — no native haptics on web
  }
}

export async function hapticLight(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // ignore
  }
}

export async function hapticSelection(): Promise<void> {
  try {
    await Haptics.selectionAsync();
  } catch {
    // ignore
  }
}

export async function hapticSuccess(): Promise<void> {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // ignore
  }
}

export async function hapticDream(): Promise<void> {
  // DREAM is gentle — a soft tactile confirmation the ambient track kicked in.
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  } catch {
    // ignore
  }
}