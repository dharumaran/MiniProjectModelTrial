import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { authenticateWithBiometrics, canUseBiometrics } from "../utils/auth";
import { apiFetch } from "../utils/api";
import { clearSession, getSession, saveSession } from "../utils/session";
import type { User } from "../utils/types";

function maskAccountNumber(accountNo: string) {
  const cleaned = String(accountNo || "").trim();
  if (!cleaned) {
    return "";
  }
  return `XXXX${cleaned.slice(-4)}`;
}

type NoticeType = "error" | "info";
interface LoginResponse {
  success: boolean;
  message: string;
  user: User;
}

export default function Unlock() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [pin, setPin] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [notice, setNotice] = useState<{ type: NoticeType; text: string } | null>(
    null
  );

  useEffect(() => {
    const bootstrap = async () => {
      const session = await getSession();
      if (!session?.user?.accountNo) {
        router.replace("/login");
        return;
      }
      setUser(session.user);
    };

    void bootstrap();
  }, [router]);

  const handleUnlockWithFingerprint = async () => {
    const status = await canUseBiometrics();
    if (!status.isAvailable) {
      setNotice({
        type: "error",
        text: "Fingerprint/biometric is unavailable on this device.",
      });
      return;
    }

    setIsUnlocking(true);
    const success = await authenticateWithBiometrics();
    setIsUnlocking(false);

    if (!success) {
      setNotice({ type: "error", text: "Fingerprint verification failed." });
      return;
    }

    router.replace("/dashboard");
  };

  const handleUnlockWithMpin = async () => {
    if (!user?.accountNo) {
      router.replace("/login");
      return;
    }
    if (!/^\d{4}$/.test(pin.trim())) {
      setNotice({ type: "error", text: "Enter your 4-digit MPIN." });
      return;
    }

    setIsUnlocking(true);
    try {
      const data = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: user.accountNo,
          mpin: pin.trim(),
        }),
      });
      await saveSession(data.user);
      router.replace("/dashboard");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to unlock with MPIN.";
      setNotice({ type: "error", text: message || "Incorrect MPIN." });
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleUseAnotherAccount = async () => {
    await clearSession();
    router.replace("/login");
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.subtitle}>Loading secure session...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.userName}>{user.name}</Text>
        <Text style={styles.subtitle}>Account {maskAccountNumber(user.accountNo)}</Text>

        <TextInput
          style={styles.input}
          placeholder="Enter 4-digit MPIN"
          placeholderTextColor="#64748b"
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          maxLength={4}
          secureTextEntry
        />

        {notice ? (
          <View style={[styles.noticeBox, notice.type === "error" ? styles.noticeError : styles.noticeInfo]}>
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, isUnlocking && styles.buttonDisabled]}
          onPress={() => void handleUnlockWithMpin()}
          disabled={isUnlocking}
        >
          <Text style={styles.buttonText}>
            {isUnlocking ? "Unlocking..." : "Unlock with MPIN"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, isUnlocking && styles.buttonDisabled]}
          onPress={() => void handleUnlockWithFingerprint()}
          disabled={isUnlocking}
        >
          <Text style={styles.buttonText}>
            {isUnlocking ? "Unlocking..." : "Unlock with Fingerprint"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={() => void handleUseAnotherAccount()}>
          <Text style={styles.linkButtonText}>Use another account</Text>
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
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  userName: {
    color: "#dbeafe",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  subtitle: {
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 20,
    fontSize: 14,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  noticeError: {
    backgroundColor: "#2a1111",
    borderColor: "#7f1d1d",
  },
  noticeInfo: {
    backgroundColor: "#0b1728",
    borderColor: "#1d4ed8",
  },
  noticeText: {
    color: "#e2e8f0",
    fontSize: 13,
    lineHeight: 18,
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
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: 3,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
    marginBottom: 10,
  },
  secondaryButton: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
  },
  linkButton: {
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  linkButtonText: {
    color: "#93c5fd",
    fontSize: 13,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
