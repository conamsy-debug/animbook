/**
 * AnimBook mobile — root layout.
 *
 * Wires the deep-link handler and the notification handler. Every screen
 * inherits the dark palette + safe-area provider.
 */
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useEffect } from "react";
import { palette } from "../src/theme";
import { registerNotificationHandler } from "../src/notifications";
import NativeIntent from "./+native-intent";

export default function RootLayout() {
  useEffect(() => {
    void registerNotificationHandler();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={palette.bg} />
      <NativeIntent />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: palette.bg },
          headerTintColor: palette.text,
          headerTitleStyle: { fontFamily: "serif", fontSize: 22 },
          contentStyle: { backgroundColor: palette.bg }
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="read/[slug]"
          options={{ title: "Reading", headerBackTitle: "Library" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}