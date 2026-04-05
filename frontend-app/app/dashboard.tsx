import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { apiFetch } from "../utils/api";
import { savePendingTransfer } from "../utils/pendingTransfer";
import { clearSession, getSession, saveSession } from "../utils/session";
import type { Transaction, User } from "../utils/types";

interface ProfileResponse {
  success: boolean;
  user: User;
}

type TabKey = "balance" | "send" | "history" | "profile";
type RecipientType = "upi" | "account" | "mobile";
type NoticeType = "error" | "success" | "info";

const TABS: { key: TabKey; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "send", label: "Send" },
  { key: "history", label: "History" },
  { key: "profile", label: "Profile" },
];

const RECIPIENT_TYPES: { key: RecipientType; label: string }[] = [
  { key: "upi", label: "UPI ID" },
  { key: "account", label: "Account No" },
  { key: "mobile", label: "Mobile" },
];

function maskAccountNumber(accountNo: string) {
  const cleaned = String(accountNo || "").trim();
  if (!cleaned) {
    return "";
  }
  const suffix = cleaned.slice(-4);
  return `XXXX${suffix}`;
}

function maskIfAccountLike(value: string) {
  const cleaned = String(value || "").trim();
  const onlyDigits = cleaned.replace(/\D/g, "");
  if (onlyDigits.length >= 8 && onlyDigits.length <= 18 && cleaned.indexOf("@") === -1) {
    return maskAccountNumber(onlyDigits);
  }
  return cleaned;
}

export default function Dashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("balance");
  const [user, setUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const [notice, setNotice] = useState<{ type: NoticeType; text: string } | null>(
    null
  );

  const [recipientType, setRecipientType] = useState<RecipientType>("upi");
  const [recipientValue, setRecipientValue] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);

  const refreshProfile = useCallback(async () => {
    const session = await getSession();
    if (!session?.user?.accountNo) {
      router.replace("/login");
      return;
    }

    const data = await apiFetch<ProfileResponse>(
      `/auth/profile/${session.user.accountNo}`
    );
    setUser(data.user);
    await saveSession(data.user);
  }, [router]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        await refreshProfile();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to load your account.";
        setNotice({ type: "error", text: message });
      }
    };

    void loadUser();
  }, [refreshProfile]);

  const onRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      await refreshProfile();
      setNotice({ type: "success", text: "Account data refreshed." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to refresh account.";
      setNotice({ type: "error", text: message });
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    await clearSession();
    router.replace("/login");
  };

  const getRecipientPlaceholder = () => {
    if (recipientType === "upi") {
      return "example@upi";
    }
    if (recipientType === "account") {
      return "Recipient account number";
    }
    return "Recipient mobile number";
  };

  const handleTransfer = async () => {
    if (!user?.accountNo) {
      router.replace("/login");
      return;
    }

    if (!recipientValue.trim() || !amount.trim()) {
      setNotice({
        type: "error",
        text: "Recipient and amount are required.",
      });
      return;
    }

    if (recipientType === "mobile" && recipientValue.replace(/\D/g, "").length < 10) {
      setNotice({
        type: "error",
        text: "Enter a valid mobile number.",
      });
      return;
    }

    setIsSubmittingTransfer(true);
    setNotice(null);

    try {
      await savePendingTransfer({
        fromAccount: user.accountNo,
        toIdentifier: recipientValue.trim(),
        recipientType,
        amount: Number(amount),
        description,
        returnRoute: "/dashboard",
      });
      router.push("/transfer-mpin");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to continue to MPIN verification.";
      setNotice({ type: "error", text: message });
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  const renderHistoryItem = ({ item }: { item: Transaction }) => (
    <View style={styles.transactionItem}>
      <View style={styles.transactionHead}>
        <Text style={styles.transactionTitle}>{item.type}</Text>
        <Text
          style={[
            styles.transactionAmount,
            item.type === "Debit" ? styles.debitText : styles.creditText,
          ]}
        >
          Rs. {item.amount.toFixed(2)}
        </Text>
      </View>
      <Text style={styles.transactionMeta}>{item.description || "Transfer"}</Text>
      <Text style={styles.transactionMeta}>
        {new Date(item.date).toLocaleString()}
      </Text>
      <Text style={styles.transactionMeta}>
        {item.mode || "UPI"} {item.counterparty ? `- ${maskIfAccountLike(item.counterparty)}` : ""}
      </Text>
    </View>
  );

  if (!user) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <View>
          <Text style={styles.welcomeText}>Welcome back, {user.name}</Text>
          <Text style={styles.infoText}>{user.bankName}</Text>
        </View>
        <View style={styles.accountChip}>
          <Text style={styles.accountChipLabel}>A/C</Text>
          <Text style={styles.accountChipValue}>{maskAccountNumber(user.accountNo)}</Text>
        </View>
      </View>

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

      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabButton, activeTab === tab.key && styles.tabButtonActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === tab.key && styles.tabButtonTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "history" ? (
        <View style={styles.historyContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <TouchableOpacity style={styles.inlineButton} onPress={() => void onRefresh()}>
              <Text style={styles.inlineButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={user.transactions}
            keyExtractor={(item, index) => `${item.date}-${index}`}
            renderItem={renderHistoryItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
            }
            ListEmptyComponent={
              <Text style={styles.emptyText}>No transactions yet.</Text>
            }
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeTab === "balance" ? (
            <View style={styles.tabBody}>
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Available Balance</Text>
                <Text style={styles.balanceText}>
                  {showBalance ? `Rs. ${user.balance.toFixed(2)}` : "Tap to reveal"}
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => setShowBalance((prev) => !prev)}
                >
                  <Text style={styles.primaryButtonText}>
                    {showBalance ? "Hide Balance" : "Show Balance"}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>UPI Status</Text>
                  <Text style={styles.metricValue}>{user.upiId ? "Linked" : "Not Linked"}</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>Transactions</Text>
                  <Text style={styles.metricValue}>{user.transactions.length}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {activeTab === "send" ? (
            <View style={styles.tabBody}>
              <Text style={styles.sectionTitle}>Send Money</Text>
              <Text style={styles.helperText}>
                Choose recipient type and send quickly with a secure flow.
              </Text>

              <View style={styles.recipientTypeRow}>
                {RECIPIENT_TYPES.map((option) => (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.recipientTypeChip,
                      recipientType === option.key && styles.recipientTypeChipActive,
                    ]}
                    onPress={() => setRecipientType(option.key)}
                  >
                    <Text
                      style={[
                        styles.recipientTypeText,
                        recipientType === option.key && styles.recipientTypeTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.input}
                placeholder={getRecipientPlaceholder()}
                placeholderTextColor="#64748b"
                value={recipientValue}
                onChangeText={setRecipientValue}
                autoCapitalize="none"
                keyboardType={recipientType === "mobile" ? "phone-pad" : "default"}
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
                placeholder="Note (optional)"
                placeholderTextColor="#64748b"
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <TouchableOpacity
                style={[styles.primaryButton, isSubmittingTransfer && styles.buttonDisabled]}
                onPress={() => void handleTransfer()}
                disabled={isSubmittingTransfer}
              >
                <Text style={styles.primaryButtonText}>
                  {isSubmittingTransfer ? "Processing..." : "Send Money"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {activeTab === "profile" ? (
            <View style={styles.tabBody}>
              <Text style={styles.sectionTitle}>Profile Settings</Text>
              <View style={styles.profileGrid}>
                <View style={styles.profileField}>
                  <Text style={styles.profileLabel}>Name</Text>
                  <Text style={styles.profileValue}>{user.name}</Text>
                </View>
                <View style={styles.profileField}>
                  <Text style={styles.profileLabel}>Mobile</Text>
                  <Text style={styles.profileValue}>{user.phone || "Not added"}</Text>
                </View>
                <View style={styles.profileField}>
                  <Text style={styles.profileLabel}>Email</Text>
                  <Text style={styles.profileValue}>{user.email || "Not added"}</Text>
                </View>
                <View style={styles.profileField}>
                  <Text style={styles.profileLabel}>Account</Text>
                  <Text style={styles.profileValue}>{maskAccountNumber(user.accountNo)}</Text>
                </View>
              </View>

              <View style={styles.profileField}>
                <Text style={styles.profileLabel}>UPI ID</Text>
                <Text style={styles.profileValue}>{user.upiId || "Not linked"}</Text>
              </View>

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.push("/setup-upi")}
              >
                <Text style={styles.primaryButtonText}>Change UPI ID</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.logoutButton} onPress={() => void handleLogout()}>
                <Text style={styles.logoutButtonText}>Log Out</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 16,
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
  headerCard: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  welcomeText: {
    fontSize: 19,
    fontWeight: "700",
    color: "#f8fafc",
    marginBottom: 6,
  },
  infoText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  accountChip: {
    backgroundColor: "#0b1728",
    borderColor: "#1d4ed8",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 92,
  },
  accountChipLabel: {
    color: "#93c5fd",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  accountChipValue: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "700",
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
  tabRow: {
    flexDirection: "row",
    marginBottom: 12,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  tabButtonText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  tabButtonTextActive: {
    color: "#ffffff",
  },
  scrollContent: {
    paddingBottom: 20,
  },
  tabBody: {
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  historyContainer: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "700",
  },
  inlineButton: {
    backgroundColor: "#0b1728",
    borderWidth: 1,
    borderColor: "#1d4ed8",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inlineButtonText: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
  },
  helperText: {
    color: "#94a3b8",
    marginTop: 8,
    marginBottom: 12,
    lineHeight: 20,
  },
  balanceCard: {
    backgroundColor: "#1d4ed8",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  balanceLabel: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  balanceText: {
    color: "#ffffff",
    fontSize: 30,
    fontWeight: "800",
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    backgroundColor: "#020617",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    padding: 12,
  },
  metricLabel: {
    color: "#94a3b8",
    fontSize: 12,
    marginBottom: 6,
  },
  metricValue: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
  },
  recipientTypeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  recipientTypeChip: {
    flex: 1,
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  recipientTypeChipActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  recipientTypeText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  recipientTypeTextActive: {
    color: "#ffffff",
  },
  input: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    color: "#f8fafc",
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    fontSize: 15,
  },
  notesInput: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 2,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  transactionItem: {
    backgroundColor: "#020617",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  transactionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  transactionTitle: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: "700",
  },
  debitText: {
    color: "#fca5a5",
  },
  creditText: {
    color: "#86efac",
  },
  transactionMeta: {
    color: "#94a3b8",
    fontSize: 13,
    marginBottom: 2,
  },
  emptyText: {
    color: "#94a3b8",
    textAlign: "center",
    marginTop: 24,
  },
  profileGrid: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  profileField: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  profileLabel: {
    color: "#94a3b8",
    fontSize: 13,
  },
  profileValue: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "600",
    maxWidth: "65%",
    textAlign: "right",
  },
  label: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 8,
  },
  logoutButton: {
    marginTop: 12,
    backgroundColor: "#7f1d1d",
    borderRadius: 12,
    alignItems: "center",
    paddingVertical: 14,
  },
  logoutButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
});

