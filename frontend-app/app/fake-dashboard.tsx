import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
} from "react-native";

// Main App component for the fake bank glitch screen
export default function FakeDashboard() {
  // State to manage the glitch effect intensity or specific glitch elements
  const [glitchActive, setGlitchActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState(
    "Processing your request..."
  );

  // Animated values for glitch effects
  const glitchOpacity = useState(new Animated.Value(0))[0];
  const glitchTranslateX = useState(new Animated.Value(0))[0];
  const glitchTranslateY = useState(new Animated.Value(0))[0];
  const pulseOpacity = useState(new Animated.Value(1))[0];

  // Function to start the glitch animation
  const startGlitchAnimation = useCallback(() => {
    // Opacity animation for the main glitch overlay
    Animated.timing(glitchOpacity, {
      toValue: 0.2, // Higher opacity when active
      duration: 100,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();

    // Random translation for a subtle shift effect
    Animated.loop(
      Animated.sequence([
        Animated.timing(glitchTranslateX, {
          toValue: 2,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(glitchTranslateY, {
          toValue: -2,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(glitchTranslateX, {
          toValue: -1,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(glitchTranslateY, {
          toValue: 1,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(glitchTranslateX, {
          toValue: 0,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(glitchTranslateY, {
          toValue: 0,
          duration: 50,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
      { iterations: -1 } // Loop indefinitely
    ).start();

    // Pulse animation for the status indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.5,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [glitchOpacity, glitchTranslateX, glitchTranslateY, pulseOpacity]);

  // Function to stop glitch animations
  const stopGlitchAnimation = useCallback(() => {
    Animated.timing(glitchOpacity, {
      toValue: 0,
      duration: 300,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
    glitchTranslateX.stopAnimation();
    glitchTranslateY.stopAnimation();
    pulseOpacity.stopAnimation();
  }, [glitchOpacity, glitchTranslateX, glitchTranslateY, pulseOpacity]);

  // Effect to simulate intermittent glitches and update error messages
  useEffect(() => {
    // Set an initial timeout to activate the glitch after a short delay
    const initialGlitchTimeout = setTimeout(() => {
      setGlitchActive(true);
      setErrorMessage(
        "System integrity compromised. Transaction rollback initiated..."
      );
      startGlitchAnimation();
    }, 1000); // Glitch starts after 1 second

    // Interval to randomly toggle glitch effects and update messages
    const glitchInterval = setInterval(() => {
      setGlitchActive((prev) => {
        const newState = !prev;
        if (newState) {
          startGlitchAnimation();
        } else {
          stopGlitchAnimation();
        }
        return newState;
      });
      const messages = [
        "ERROR: Transaction data stream corrupted.",
        "Connection lost during confirmation. Retrying...",
        "Payment gateway unreachable. Attempting re-authorization...",
        "Transaction failed. Irrecoverable error code: 0xDEADBEEF",
        "Secure channel negotiation failed. Reverting changes...",
        "Critical system error. Transaction suspended.",
        "Invalid session token. Operation cancelled.",
        "Pending transaction review. Do not close application.",
      ];
      // Update error message with a random one from the list
      setErrorMessage(messages[Math.floor(Math.random() * messages.length)]);
    }, 1500 + Math.random() * 1000); // Random interval between 1.5s and 2.5s

    // Cleanup function to clear timeouts and intervals when component unmounts
    return () => {
      clearTimeout(initialGlitchTimeout);
      clearInterval(glitchInterval);
      stopGlitchAnimation(); // Ensure animations are stopped on unmount
    };
  }, [startGlitchAnimation, stopGlitchAnimation]);

  // Helper function to generate a random string for distorted text
  const generateDistortedText = (length: number) => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{};':\"\\|,.<>/?";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  return (
    // Main container for the app, covering the full screen
    <View style={styles.container}>
      {/* Glitch overlay elements - these will flicker and move */}
      <Animated.View
        style={[
          styles.glitchOverlay,
          {
            opacity: glitchOpacity,
            transform: [
              { translateX: glitchTranslateX },
              { translateY: glitchTranslateY },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.glitchOverlayRed,
          {
            opacity: glitchOpacity,
            transform: [
              { translateX: glitchTranslateX },
              { translateY: glitchTranslateY },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.glitchOverlayBlue,
          {
            opacity: glitchOpacity,
            transform: [
              { translateX: glitchTranslateX },
              { translateY: glitchTranslateY },
            ],
          },
        ]}
      />

      {/* Main content area, centered and styled to look like a banking app */}
      <View style={styles.contentContainer}>
        {/* Header section */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {glitchActive ? generateDistortedText(8) : "VigilAuth Bank"}
          </Text>
          <View style={styles.statusSection}>
            <Text
              style={[
                styles.statusText,
                glitchActive ? styles.statusTextError : styles.statusTextOnline,
              ]}
            >
              {glitchActive ? "ERROR" : "ONLINE"}
            </Text>
            <Animated.View
              style={[
                styles.statusBar,
                glitchActive ? styles.statusBarError : styles.statusBarOnline,
                { opacity: pulseOpacity },
              ]}
            />
          </View>
        </View>

        {/* Focus on the interrupted action */}
        <View style={styles.interruptedActionSection}>
          <Text style={styles.interruptedActionLabel}>
            {glitchActive
              ? generateDistortedText(20)
              : "Attempting to transfer funds to:"}
          </Text>
          <Text
            style={[
              styles.interruptedActionRecipient,
              glitchActive && styles.glitchText,
            ]}
          >
            {glitchActive
              ? generateDistortedText(15)
              : "Jane Doe (Account XXXX-1234)"}
          </Text>
          <Text
            style={[
              styles.interruptedActionAmount,
              glitchActive && styles.glitchText,
            ]}
          >
            {glitchActive
              ? `AMOUNT: $${generateDistortedText(3)}.XX`
              : "AMOUNT: $500.00"}
          </Text>
          <Text style={styles.interruptedActionStatus}>
            {glitchActive ? "STATUS: [CORRUPTED]" : "STATUS: Initiating..."}
          </Text>
        </View>

        {/* Action buttons (now glitched) */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              glitchActive ? styles.buttonGlitched : styles.buttonBlue,
            ]}
            disabled={glitchActive} // Disable interaction when glitched
          >
            <Text style={styles.buttonText}>
              {glitchActive ? generateDistortedText(7) : "CANCEL"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              glitchActive ? styles.buttonGlitched : styles.buttonGreen,
            ]}
            disabled={glitchActive} // Disable interaction when glitched
          >
            <Text style={styles.buttonText}>
              {glitchActive ? generateDistortedText(9) : "CONFIRM"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Glitch message / Error indicator */}
        <Animated.View
          style={[
            styles.errorMessageOverlay,
            { opacity: glitchActive ? 1 : 0 },
          ]}
        >
          <View style={styles.errorMessageContent}>
            <Text style={styles.errorMessageTitle}>
              [CRITICAL SYSTEM FAILURE]
            </Text>
            <Text style={styles.errorMessageText}>{errorMessage}</Text>
            <Text style={styles.errorMessageInstruction}>
              Do not close the application. Your transaction is being secured.
            </Text>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

// StyleSheet for React Native components
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a202c", // bg-gray-900
    alignItems: "center",
    justifyContent: "center",
    padding: 16, // p-4
    overflow: "hidden",
  },
  glitchOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "black",
    opacity: 0.1, // opacity-10
    zIndex: 10,
  },
  glitchOverlayRed: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ef4444", // bg-red-500
    opacity: 0.05, // opacity-5
    zIndex: 10,
  },
  glitchOverlayBlue: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#3b82f6", // bg-blue-500
    opacity: 0.05, // opacity-5
    zIndex: 10,
  },
  contentContainer: {
    position: "relative",
    zIndex: 20,
    width: "100%",
    maxWidth: 448, // max-w-md (approx 448px)
    backgroundColor: "#2d3748", // bg-gray-800
    borderRadius: 16, // rounded-2xl
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8, // Android shadow
    padding: 24, // p-6
    borderWidth: 2,
    borderColor: "#4a5568", // border-gray-700
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24, // mb-6
    borderBottomWidth: 1,
    borderBottomColor: "#4a5568", // border-gray-700
    paddingBottom: 16, // pb-4
  },
  headerTitle: {
    fontSize: 24, // text-2xl
    fontWeight: "bold",
    color: "#a0aec0", // text-gray-500
  },
  statusSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8, // space-x-2
  },
  statusText: {
    fontSize: 14, // text-sm
  },
  statusTextError: {
    color: "#ef4444", // text-red-500
  },
  statusTextOnline: {
    color: "#22c55e", // text-green-500
  },
  statusBar: {
    width: 12, // w-3
    height: 12, // h-3
    borderRadius: 6, // rounded-full
  },
  statusBarError: {
    backgroundColor: "#ef4444", // bg-red-500
  },
  statusBarOnline: {
    backgroundColor: "#22c55e", // bg-green-500
  },
  interruptedActionSection: {
    marginBottom: 32, // mb-8
    alignItems: "center", // text-center
  },
  interruptedActionLabel: {
    fontSize: 14, // text-sm
    color: "#a0aec0", // text-gray-400
    marginBottom: 8, // mb-2
  },
  interruptedActionRecipient: {
    fontSize: 30, // text-3xl
    fontWeight: "800", // font-extrabold
    color: "white",
  },
  interruptedActionAmount: {
    fontSize: 20, // text-xl
    fontWeight: "bold",
    marginTop: 16, // mt-4
    color: "white",
  },
  interruptedActionStatus: {
    fontSize: 14, // text-sm
    color: "#a0aec0", // text-gray-500
    marginTop: 8, // mt-2
  },
  glitchText: {
    color: "#ef4444", // text-red-400
    // For React Native, a direct CSS keyframe animation like glitch-text is not possible.
    // We're simulating it with color change and general glitch effect.
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 16, // gap-4
    marginBottom: 32, // mb-8
  },
  button: {
    flex: 1, // grid-cols-2
    padding: 16, // p-4
    borderRadius: 8, // rounded-lg
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 18, // text-lg
    fontWeight: "bold",
    color: "white",
  },
  buttonBlue: {
    backgroundColor: "#2563eb", // bg-blue-600
  },
  buttonGreen: {
    backgroundColor: "#16a34a", // bg-green-600
  },
  buttonGlitched: {
    backgroundColor: "#7f1d1d", // bg-red-900
    color: "#f87171", // text-red-400
    opacity: 0.6, // opacity-60
  },
  errorMessageOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(26, 32, 44, 0.9)", // bg-gray-900 with opacity-90
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
  },
  errorMessageContent: {
    textAlign: "center",
    padding: 16, // p-4
  },
  errorMessageTitle: {
    color: "#ef4444", // text-red-500
    fontSize: 20, // text-xl
    fontWeight: "bold",
    marginBottom: 8, // mb-2
    // Pulse effect is handled by Animated.View on the status bar, not here directly
  },
  errorMessageText: {
    color: "#d1d5db", // text-gray-300
    fontSize: 18, // text-lg
    fontFamily: "monospace", // font-mono
  },
  errorMessageInstruction: {
    color: "#a0aec0", // text-gray-500
    fontSize: 14, // text-sm
    marginTop: 16, // mt-4
  },
});
