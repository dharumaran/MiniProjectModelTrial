const os = require("os");

const baseExpoConfig = {
  name: "frontend-app",
  slug: "frontend-app",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "frontendapp",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    edgeToEdgeEnabled: true,
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-local-authentication",
    "expo-secure-store",
    "expo-font",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:5000/api",
  },
};

function getLanIpAddress() {
  const interfaces = os.networkInterfaces();

  for (const networkInterface of Object.values(interfaces)) {
    for (const details of networkInterface || []) {
      if (
        details &&
        details.family === "IPv4" &&
        !details.internal &&
        !details.address.startsWith("169.254.")
      ) {
        return details.address;
      }
    }
  }

  return null;
}

module.exports = () => {
  const detectedLanIp = getLanIpAddress();
  const detectedApiBaseUrl = detectedLanIp
    ? `http://${detectedLanIp}:5000/api`
    : undefined;

  return {
    ...baseExpoConfig,
    extra: {
      ...baseExpoConfig.extra,
      apiBaseUrl:
        detectedApiBaseUrl ||
        process.env.EXPO_PUBLIC_API_BASE_URL ||
        baseExpoConfig.extra?.apiBaseUrl,
    },
  };
};
