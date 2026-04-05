import React, { useRef } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { recordTouchSnapshot } from "../hooks/useBehaviorCsvCapture";

export default function GestureWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPressTimeout = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  };

  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={(evt) => {
        clearLongPressTimeout();
        longPressTimeout.current = setTimeout(() => {
          router.replace("/fake-dashboard");
        }, 4000);
        recordTouchSnapshot({
          action: "start",
          touchX: evt.nativeEvent.locationX,
          touchY: evt.nativeEvent.locationY,
          pageX: evt.nativeEvent.pageX,
          pageY: evt.nativeEvent.pageY,
        });
      }}
      onTouchMove={(evt) => {
        recordTouchSnapshot({
          action: "move",
          touchX: evt.nativeEvent.locationX,
          touchY: evt.nativeEvent.locationY,
          pageX: evt.nativeEvent.pageX,
          pageY: evt.nativeEvent.pageY,
        });
      }}
      onTouchEnd={(evt) => {
        clearLongPressTimeout();
        recordTouchSnapshot({
          action: "end",
          touchX: evt.nativeEvent.locationX,
          touchY: evt.nativeEvent.locationY,
          pageX: evt.nativeEvent.pageX,
          pageY: evt.nativeEvent.pageY,
        });
      }}
    >
      {children}
    </View>
  );
}
