import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { apiFetch } from "../utils/api";
import { clearSession, getSession, saveSession } from "../utils/session";
import type { User } from "../utils/types";

interface LoginResponse {
  success: boolean;
  message: string;
  user: User;
}

type NoticeType = "error" | "success" | "info";

export default function Login() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [mpin, setMpin] = useState("");
  const [hasSavedAccount, setHasSavedAccount] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [notice, setNotice] = useState<{ type: NoticeType; text: string } | null>(
    null
  );

  useEffect(() => {
    const loadSession = async () => {
      const session = await getSession();
      const savedIdentifier = session?.user?.phone || session?.user?.accountNo || "";
      setHasSavedAccount(Boolean(savedIdentifier));
      setIdentifier(savedIdentifier);
    };

    void loadSession();
  }, []);

  const handleLogin = async () => {
    const value = identifier.trim();
    if (!value) {
      setNotice({
        type: "error",
        text: "Enter account number or phone number to continue.",
      });
      return;
    }
    if (!/^\d{4}$/.test(mpin.trim())) {
      setNotice({
        type: "error",
        text: "Enter your 4-digit MPIN.",
      });
      return;
    }

    setIsAuthenticating(true);
    setNotice(null);

    try {
      const data = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: value, mpin: mpin.trim() }),
      });

      await saveSession(data.user);
      setNotice({ type: "success", text: "Login successful." });
      router.replace("/dashboard");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to sign in right now.";
      setNotice({ type: "error", text: message });
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleUseAnotherAccount = async () => {
    await clearSession();
    setIdentifier("");
    setMpin("");
    setHasSavedAccount(false);
    setNotice({
      type: "info",
      text: "Saved account cleared. Use signup to register another user.",
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Bank</Text>
        <Text style={styles.subtitle}>
          Login with account number or phone number and your MPIN.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Account number or phone number"
          placeholderTextColor="#64748b"
          value={identifier}
          onChangeText={setIdentifier}
          keyboardType="default"
        />
        <TextInput
          style={styles.input}
          placeholder="Enter 4-digit MPIN"
          placeholderTextColor="#64748b"
          value={mpin}
          onChangeText={setMpin}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />

        {notice ? (
          <View
            style={[
              styles.noticeBox,
              notice.type === "error"
                ? styles.noticeError
                : notice.type === "success"
                  ? styles.noticeSuccess
                  : styles.noticeInfo,
            ]}
          >
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, isAuthenticating && styles.buttonDisabled]}
          onPress={() => void handleLogin()}
          disabled={isAuthenticating}
        >
          <Text style={styles.buttonText}>
            {isAuthenticating ? "Signing in..." : "Login with MPIN"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => void handleUseAnotherAccount()}
        >
          <Text style={styles.secondaryButtonText}>
            {hasSavedAccount ? "Clear Saved Account" : "Reset Login"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => router.replace("/signup")}
        >
          <Text style={styles.linkButtonText}>New user? Go to Sign Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    padding: 28,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  title: {
    fontSize: 30,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 22,
  },
  input: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    color: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    marginBottom: 14,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  noticeInfo: {
    backgroundColor: "#0b1728",
    borderColor: "#1d4ed8",
  },
  noticeError: {
    backgroundColor: "#2a1111",
    borderColor: "#7f1d1d",
  },
  noticeSuccess: {
    backgroundColor: "#082217",
    borderColor: "#166534",
  },
  noticeText: {
    color: "#e2e8f0",
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 14,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 10,
  },
  linkButton: {
    alignItems: "center",
    paddingVertical: 6,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "600",
  },
  linkButtonText: {
    color: "#60a5fa",
    fontSize: 14,
    fontWeight: "600",
  },
});
