import { Tabs } from "expo-router";
import { Platform, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { palette, fonts } from "../../src/theme";
import { hapticSelection } from "../../src/haptics";

function TabBarIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: focused ? palette.gold : "transparent",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: focused ? 0 : 1,
        borderColor: palette.border
      }}
    >
      <Text
        style={{
          color: focused ? palette.bg : palette.textMuted,
          fontSize: 16,
          fontFamily: fonts.mono,
          fontWeight: "600"
        }}
      >
        {glyph}
      </Text>
    </View>
  );
}

function BlurredTabBarBackground() {
  if (Platform.OS === "web") {
    return <View style={{ flex: 1, backgroundColor: "rgba(13, 27, 46, 0.92)" }} />;
  }
  return <BlurView intensity={80} tint="dark" style={{ flex: 1 }} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          void hapticSelection();
        }
      }}
      screenOptions={{
        tabBarActiveTintColor: palette.gold,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          position: "absolute",
          borderTopColor: palette.border,
          borderTopWidth: 1,
          paddingTop: 6,
          height: 70,
          backgroundColor: "transparent",
          elevation: 0
        },
        tabBarBackground: () => <BlurredTabBarBackground />,
        tabBarLabelStyle: {
          fontFamily: fonts.mono,
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: "uppercase"
        },
        headerStyle: { backgroundColor: palette.bg },
        headerTintColor: palette.text,
        headerTitleStyle: { fontFamily: "serif", fontSize: 22 }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Library",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="L" focused={focused} />
        }}
      />
      <Tabs.Screen
        name="worlds"
        options={{
          title: "Worlds",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="W" focused={focused} />
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: "Memory",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="M" focused={focused} />
        }}
      />
      <Tabs.Screen
        name="dream"
        options={{
          title: "Dream",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="D" focused={focused} />
        }}
      />
      <Tabs.Screen
        name="companion"
        options={{
          title: "Companion",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="C" focused={focused} />
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabBarIcon glyph="P" focused={focused} />
        }}
      />
    </Tabs>
  );
}