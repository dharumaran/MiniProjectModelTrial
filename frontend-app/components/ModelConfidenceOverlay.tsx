import React, { useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  getModelConfidenceSnapshot,
  subscribeToModelConfidence,
} from "../utils/modelConfidenceStore";

function formatConfidenceScore(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  const normalized = Math.max(0, Math.min(1, value));
  const percentage = normalized * 100;
  return `${percentage.toFixed(1)}%`;
}

function getOverallConfidence(svm1: number | null, svm2: number | null) {
  if (svm1 === null && svm2 === null) {
    return null;
  }
  if (svm1 === null) {
    return svm2;
  }
  if (svm2 === null) {
    return svm1;
  }
  return (svm1 + svm2) / 2;
}

function getStatusLabel(
  status: "idle" | "collecting" | "checking" | "ready"
) {
  if (status === "checking") {
    return "Checking";
  }

  if (status === "collecting") {
    return "Collecting";
  }

  if (status === "ready") {
    return "Live";
  }

  return "Idle";
}

export default function ModelConfidenceOverlay() {
  const snapshot = useSyncExternalStore(
    subscribeToModelConfidence,
    getModelConfidenceSnapshot,
    getModelConfidenceSnapshot
  );
  const overall = getOverallConfidence(snapshot.svm1_score, snapshot.svm2_score);

  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.title}>Model counter</Text>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status</Text>
        <Text style={styles.statusValue}>{getStatusLabel(snapshot.status)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Window</Text>
        <Text style={styles.value}>{snapshot.sampleCount}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Total</Text>
        <Text style={styles.value}>{snapshot.totalSamples}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Seq conf</Text>
        <Text style={styles.value}>{formatConfidenceScore(snapshot.svm1_score)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Stat conf</Text>
        <Text style={styles.value}>{formatConfidenceScore(snapshot.svm2_score)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>LSTM conf</Text>
        <Text style={styles.value}>
          {snapshot.lstm_used === false
            ? "0.0%"
            : formatConfidenceScore(snapshot.lstm_score)}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Overall</Text>
        <Text style={styles.value}>{formatConfidenceScore(overall)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Risk</Text>
        <Text style={styles.value}>{snapshot.risk ?? "--"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 50,
    minWidth: 136,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "rgba(2, 6, 23, 0.94)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
    letterSpacing: 0.6,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  statusLabel: {
    color: "#94a3b8",
    fontSize: 12,
    marginRight: 10,
  },
  statusValue: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    marginRight: 10,
  },
  value: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
});
