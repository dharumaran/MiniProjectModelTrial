import Constants from "expo-constants";
import { Platform } from "react-native";

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, "");
}

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isTunnelHost(host: string) {
  return (
    host.endsWith(".exp.direct") ||
    host.endsWith(".ngrok.io") ||
    host.endsWith(".ngrok-free.app")
  );
}

function isPrivateLanUrl(url: string) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.")
    );
  } catch {
    return false;
  }
}

function getHostUriBaseUrl() {
  const constantsWithExpoGo = Constants as unknown as {
    expoGoConfig?: { debuggerHost?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };
  const hostUri =
    Constants.expoConfig?.hostUri ||
    constantsWithExpoGo.expoGoConfig?.debuggerHost ||
    constantsWithExpoGo.manifest2?.extra?.expoClient?.hostUri;

  if (!hostUri) {
    return null;
  }

  const host = hostUri.split(":")[0];
  if (isLoopbackHost(host) || isTunnelHost(host)) {
    return null;
  }

  return `http://${host}:5000/api`;
}

function getCandidateBaseUrls() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const extraApiUrl = (
    Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined
  )?.apiBaseUrl;
  const hostUriBaseUrl = getHostUriBaseUrl();

  const urls = [
    envUrl,
    hostUriBaseUrl,
    extraApiUrl,
    Platform.OS === "android" ? "http://10.0.2.2:5000/api" : null,
    "http://localhost:5000/api",
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(urls.map(normalizeBaseUrl)));
}

export const API_BASE_URLS = getCandidateBaseUrls();

let lastSuccessfulApiBaseUrl = API_BASE_URLS[0] || "http://localhost:5000/api";

export function getCurrentApiBaseUrl() {
  return lastSuccessfulApiBaseUrl;
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 3500
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      fetch(input, {
        ...init,
        signal: controller.signal,
      }),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out. API URL: ${input}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildNetworkErrorMessage(baseUrls: string[]) {
  const primaryUrl = baseUrls[0] || lastSuccessfulApiBaseUrl;
  const networkHint = isPrivateLanUrl(primaryUrl)
    ? " Make sure the phone and laptop are on the same Wi-Fi and the phone is not using mobile data."
    : "";
  return `Could not reach the backend. Tried: ${baseUrls.join(", ")}.${networkHint}`;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const candidateBaseUrls = [
    lastSuccessfulApiBaseUrl,
    ...API_BASE_URLS.filter((url) => url !== lastSuccessfulApiBaseUrl),
  ];

  let lastNetworkError: Error | null = null;

  for (const baseUrl of candidateBaseUrls) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
        ...init,
      });

      lastSuccessfulApiBaseUrl = baseUrl;

      let data: (T & { message?: string }) | null = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = (await response.json()) as T & { message?: string };
      } else {
        const text = await response.text();
        data = { message: text } as T & { message?: string };
      }

      if (!response.ok) {
        throw new Error(
          data?.message || `Request failed. API base URL: ${baseUrl}`
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        lastNetworkError = error;
        if (
          !/Network request failed/i.test(error.message) &&
          !/Request timed out/i.test(error.message)
        ) {
          throw error;
        }
      } else {
        lastNetworkError = new Error(`Request timed out. API base URL: ${baseUrl}`);
      }
    }
  }

  throw new Error(
    lastNetworkError?.message?.includes("API base URL:")
      ? buildNetworkErrorMessage(candidateBaseUrls)
      : lastNetworkError?.message || buildNetworkErrorMessage(candidateBaseUrls)
  );
}
