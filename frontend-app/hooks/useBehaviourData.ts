import { useEffect, useState } from "react";
import { Accelerometer } from "expo-sensors";

// Define the shape of one session data point
interface DataPoint {
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

export default function useBehaviorData() {
  const [session, setSession] = useState<DataPoint[]>([]);

  useEffect(() => {
    const subscription = Accelerometer.addListener((data) => {
      const newPoint: DataPoint = {
        timestamp: Date.now(),
        x: data.x,
        y: data.y,
        z: data.z,
      };

      setSession((prev) =>
        prev.length >= 50 ? [...prev.slice(1), newPoint] : [...prev, newPoint]
      );
    });

    Accelerometer.setUpdateInterval(100); // 10 times per second

    return () => subscription.remove();
  }, []);

  return session;
}
