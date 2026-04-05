import React, { useEffect, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import useBehaviorTracker from "../hooks/useBehaviorTracker";
import { savePendingTransfer } from "../utils/pendingTransfer";
import { getSession } from "../utils/session";

export default function Transfer() {
  const router = useRouter();
  const [toUpiId, setToUpiId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { panResponder, isLongPress } = useBehaviorTracker();

  useEffect(() => {
    if (isLongPress) {
      router.replace("/fake-dashboard");
    }
  }, [isLongPress, router]);

  const handleTransfer = async () => {
    if (!toUpiId || !amount) {
      Alert.alert(
        "Missing details",
        "Recipient UPI ID and amount are required."
      );
      return;
    }

    const session = await getSession();
    if (!session?.user) {
      Alert.alert("Session expired", "Please log in again.");
      router.replace("/login");
      return;
    }

    setIsSubmitting(true);

    try {
      await savePendingTransfer({
        fromAccount: session.user.accountNo,
        toIdentifier: toUpiId.trim(),
        recipientType: "upi",
        amount: Number(amount),
        description,
        returnRoute: "/transfer",
      });
      router.push("/transfer-mpin");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to continue to MPIN verification.";
      Alert.alert("Could not continue", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.card}>
        <Text style={styles.title}>Send Money with UPI</Text>
        <Text style={styles.subtitle}>
          Example recipient IDs: name@upi
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Recipient UPI ID"
          placeholderTextColor="#64748b"
          value={toUpiId}
          onChangeText={setToUpiId}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Amount"
          placeholderTextColor="#64748b"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <TextInput
          style={[styles.input, styles.notesInput]}
          placeholder="Note"
          placeholderTextColor="#64748b"
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <TouchableOpacity
          style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
          onPress={() => void handleTransfer()}
          disabled={isSubmitting}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Processing..." : "Pay Now"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.back()}
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
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#0f172a",
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#f8fafc",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
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
    marginBottom: 14,
    fontSize: 15,
  },
  notesInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#16a34a",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 15,
    marginBottom: 12,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 15,
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
});
