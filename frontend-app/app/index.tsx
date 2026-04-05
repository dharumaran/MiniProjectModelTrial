import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { getSession } from "../utils/session";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    const bootstrap = async () => {
      const session = await getSession();
      router.replace(session?.user?.accountNo ? "/unlock" : "/login");
    };

    void bootstrap();
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
});
