import { useRef, useState } from "react";
import { GestureResponderEvent, PanResponder } from "react-native";

export interface SessionEvent {
  X: number;
  Y: number;
  Pressure: number;
  Duration: number;
  Orientation: number;
  Size: number;
}

type TouchWithRadius = {
  locationX: number;
  locationY: number;
  force?: number;
  radiusX?: number;
};

export default function useBehaviorTracker() {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [isLongPress, setIsLongPress] = useState(false);

  const startTime = useRef<number | null>(null);
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPressTimeout = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      setIsLongPress(false);
      startTime.current = Date.now();
      longPressTimeout.current = setTimeout(() => {
        setIsLongPress(true);
      }, 3000);
    },
    onPanResponderMove: (evt: GestureResponderEvent) => {
      const touch = evt.nativeEvent as TouchWithRadius;
      const duration = Date.now() - (startTime.current ?? Date.now());

      setEvents((prev) => [
        ...prev.slice(-49),
        {
          X: touch.locationX,
          Y: touch.locationY,
          Pressure: touch.force || 0.5,
          Duration: duration,
          Orientation: 0,
          Size: touch.radiusX || 0.5,
        },
      ]);
    },
    onPanResponderRelease: clearLongPressTimeout,
    onPanResponderTerminate: clearLongPressTimeout,
  });

  return { panResponder, events, isLongPress };
}
