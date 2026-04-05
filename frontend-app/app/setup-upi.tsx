import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { apiFetch } from "../utils/api";
import { getSession, saveSession } from "../utils/session";
import type { User } from "../utils/types";

interface UpdateUpiResponse {
  success: boolean;
  message: string;
  user: User;
}

export default function SetupUpi() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [upiId, setUpiId] = useState("");
  const [mpin, setMpin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{
    type: "error" | "success" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      const session = await getSession();
      if (!session?.user) {
        router.replace("/login");
        return;
      }

      setUser(session.user);
      setUpiId(session.user.upiId || "");
    };

    void loadSession();
  }, [router]);

  const handleSaveUpi = async () => {
    setNotice(null);

    if (!user?.accountNo) {
      router.replace("/login");
      return;
    }

    if (!upiId.trim()) {
      setNotice({ type: "error", text: "Please enter a UPI ID to continue." });
      return;
    }

    if (!/^\d{4}$/.test(mpin.trim())) {
      setNotice({ type: "error", text: "Enter your 4-digit MPIN to update UPI ID." });
      return;
    }

    setIsSaving(true);

    try {
      const data = await apiFetch<UpdateUpiResponse>("/auth/upi", {
        method: "PATCH",
        body: JSON.stringify({
          accountNo: user.accountNo,
          upiId: upiId.trim().toLowerCase(),
          mpin: mpin.trim(),
        }),
      });

      await saveSession(data.user);
      setNotice({ type: "success", text: data.message || "UPI ID updated successfully." });
      setTimeout(() => {
        router.replace("/dashboard");
      }, 900);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save UPI ID.";
      setNotice({ type: "error", text: message });
    } finally {
      setIsSaving(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading account...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Change UPI ID</Text>
        <Text style={styles.subtitle}>
          UPI ID (Optional)
        </Text>
        <Text style={styles.currentUpiText}>
          Current UPI: {user.upiId || "Not linked"}
        </Text>

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

        <TextInput
          style={styles.input}
          placeholder={user.upiId ? user.upiId : "example@upi"}
          placeholderTextColor="#64748b"
          value={upiId}
          onChangeText={setUpiId}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Enter 4-digit MPIN"
          placeholderTextColor="#64748b"
          value={mpin}
          onChangeText={setMpin}
          secureTextEntry
          maxLength={4}
          keyboardType="number-pad"
        />

        <TouchableOpacity
          style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
          onPress={() => void handleSaveUpi()}
          disabled={isSaving}
        >
          <Text style={styles.buttonText}>
            {isSaving ? "Saving..." : "Update UPI ID"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.back()}
          disabled={isSaving}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
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
  loadingContainer: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: "#cbd5e1",
    fontSize: 16,
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
    fontSize: 28,
    fontWeight: "700",
    color: "#f8fafc",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    color: "#cbd5e1",
    textAlign: "center",
    marginBottom: 8,
    fontWeight: "700",
  },
  currentUpiText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 14,
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
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
  input: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    color: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 15,
    marginBottom: 10,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontWeight: "600",
    fontSize: 15,
  },
});
