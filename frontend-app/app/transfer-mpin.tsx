import React, { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { apiFetch } from "../utils/api";
import { clearPendingTransfer, getPendingTransfer } from "../utils/pendingTransfer";
import { getSession, saveSession } from "../utils/session";
import useBehaviorTracker from "../hooks/useBehaviorTracker";
import type { User } from "../utils/types";

interface TransferResponse {
  success: boolean;
  message: string;
  sender: {
    accountNo: string;
    balance: number;
    transactions: User["transactions"];
  };
}

export default function TransferMpin() {
  const router = useRouter();
  const [mpin, setMpin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    type: "error" | "success" | "info";
    text: string;
  } | null>(null);
  const { panResponder, events } = useBehaviorTracker();

  const handleSubmit = async () => {
    setNotice(null);

    if (!/^\d{4}$/.test(mpin.trim())) {
      setNotice({ type: "error", text: "Enter your 4-digit MPIN." });
      return;
    }

    setIsSubmitting(true);

    try {
      // Check behavioral risk
      if (events.length > 0) {
        const sessionData = events.map(event => ({
          accelX: event.X,
          accelY: event.Y,
          touchPressure: event.Pressure,
          duration: event.Duration,
        }));
        const riskResponse = await apiFetch<{ score: number; risk: string }>("/predict", {
          method: "POST",
          body: JSON.stringify({ session: sessionData }),
        });
        if (riskResponse.score < 0.40) {
          Alert.alert("Security Alert", "Suspicious activity detected. Confidence score too low.");
          setIsSubmitting(false);
          return;
        }
      }

      const session = await getSession();
      const pendingTransfer = await getPendingTransfer();

      if (!session?.user?.accountNo) {
        setNotice({ type: "error", text: "Session expired. Please log in again." });
        router.replace("/login");
        return;
      }

      if (!pendingTransfer) {
        setNotice({
          type: "error",
          text: "Transfer details are missing. Please enter details again.",
        });
        router.replace("/dashboard");
        return;
      }

      const data = await apiFetch<TransferResponse>("/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromAccount: pendingTransfer.fromAccount,
          toIdentifier: pendingTransfer.toIdentifier,
          recipientType: pendingTransfer.recipientType,
          amount: pendingTransfer.amount,
          description: pendingTransfer.description || "",
          mpin: mpin.trim(),
        }),
      });

      await saveSession({
        ...session.user,
        balance: data.sender.balance,
        transactions: data.sender.transactions,
      });
      await clearPendingTransfer();

      setNotice({ type: "success", text: data.message || "Transfer successful." });
      setTimeout(() => {
        router.replace("/dashboard");
      }, 1000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transfer could not be completed.";
      setNotice({ type: "error", text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.card}>
        <Text style={styles.title}>Enter MPIN</Text>
        <Text style={styles.subtitle}>
          For your security, confirm this transaction with your 4-digit MPIN.
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
          placeholder="4-digit MPIN"
          placeholderTextColor="#64748b"
          value={mpin}
          onChangeText={setMpin}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={4}
        />

        <TouchableOpacity
          style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
          onPress={() => void handleSubmit()}
          disabled={isSubmitting}
        >
          <Text style={styles.primaryButtonText}>
            {isSubmitting ? "Verifying..." : "Confirm Transaction"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#0f172a",
    padding: 20,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 22,
  },
  title: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    color: "#94a3b8",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 18,
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
    fontSize: 16,
    textAlign: "center",
    letterSpacing: 4,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
    marginBottom: 10,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontWeight: "600",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
