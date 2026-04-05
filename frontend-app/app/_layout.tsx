import { Slot } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import GestureWrapper from "../components/GestureWrapper";
import useBehaviorCsvCapture from "../hooks/useBehaviorCsvCapture";

export default function Layout() {
  useBehaviorCsvCapture();

  return (
    <GestureWrapper>
      <SafeAreaView style={{ flex: 1 }}>
        <Slot />
      </SafeAreaView>
    </GestureWrapper>
  );
}
