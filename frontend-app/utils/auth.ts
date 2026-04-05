import * as LocalAuthentication from "expo-local-authentication";

export async function canUseBiometrics() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  return {
    hasHardware,
    isEnrolled,
    isAvailable: hasHardware && isEnrolled,
  };
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  const biometricStatus = await canUseBiometrics();

  if (!biometricStatus.isAvailable) {
    return false;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Authenticate to access your bank account",
    fallbackLabel: "Use device passcode",
    disableDeviceFallback: false,
    cancelLabel: "Cancel",
  });

  return result.success;
}
