import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { apiFetch } from "../utils/api";
import { saveSession } from "../utils/session";
import type { User } from "../utils/types";

interface SignupResponse {
  success: boolean;
  message: string;
  user: User;
}

export default function Signup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("VigilAuth Bank");
  const [mpin, setMpin] = useState("");
  const [confirmMpin, setConfirmMpin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const handleSignup = async () => {
    if (!name || !accountNo) {
      setNotice({
        type: "error",
        text: "Name and account number are required.",
      });
      return;
    }
    if (!/^\d{4}$/.test(mpin.trim())) {
      setNotice({
        type: "error",
        text: "MPIN must be exactly 4 digits.",
      });
      return;
    }
    if (mpin.trim() !== confirmMpin.trim()) {
      setNotice({
        type: "error",
        text: "MPIN and confirm MPIN do not match.",
      });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);

    try {
      const data = await apiFetch<SignupResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name,
          accountNo,
          email,
          phone,
          bankName,
          mpin: mpin.trim(),
        }),
      });

      await saveSession(data.user);
      setNotice({
        type: "success",
        text: "Account created successfully. You can add UPI later in Profile.",
      });
      setTimeout(() => {
        router.replace("/dashboard");
      }, 600);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to complete signup.";
      setNotice({ type: "error", text: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Create Your Bank Profile</Text>
        <Text style={styles.subtitle}>
          Register now.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor="#64748b"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Account number"
          placeholderTextColor="#64748b"
          value={accountNo}
          onChangeText={setAccountNo}
          keyboardType="number-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Phone number"
          placeholderTextColor="#64748b"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TextInput
          style={styles.input}
          placeholder="Bank name"
          placeholderTextColor="#64748b"
          value={bankName}
          onChangeText={setBankName}
        />
        <TextInput
          style={styles.input}
          placeholder="Set 4-digit MPIN"
          placeholderTextColor="#64748b"
          value={mpin}
          onChangeText={setMpin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />
        <TextInput
          style={styles.input}
          placeholder="Confirm MPIN"
          placeholderTextColor="#64748b"
          value={confirmMpin}
          onChangeText={setConfirmMpin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />

        {notice ? (
          <View
            style={[
              styles.noticeBox,
              notice.type === "error" ? styles.noticeError : styles.noticeSuccess,
            ]}
          >
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
          onPress={() => void handleSignup()}
          disabled={isSubmitting}
        >
          <Text style={styles.buttonText}>
            {isSubmitting ? "Creating account..." : "Sign Up"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace("/login")}
        >
          <Text style={styles.secondaryButtonText}>Already registered</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
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
    fontSize: 28,
    fontWeight: "700",
    color: "#f8fafc",
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#94a3b8",
    textAlign: "center",
    marginBottom: 22,
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
    marginTop: 6,
    marginBottom: 12,
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: 12,
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
    fontSize: 15,
    fontWeight: "600",
  },
  noticeBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
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
});
