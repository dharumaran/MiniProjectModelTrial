import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import {
  deleteFromSecureStore,
  getFromSecureStore,
  saveToSecureStore,
} from "./secureStorage";

const CSV_HEADER =
  "timestamp,user_id,session_id,sensor_type,x,y,z,touch_x,touch_y,page_x,page_y,touch_action\n";
const APP_BANK_DIR = `${FileSystem.documentDirectory ?? ""}Bank`;
const APP_MODEL_PATH = `${APP_BANK_DIR}/Model.csv`;
const SAF_FILE_URI_KEY = "behaviorCsvSafFileUri";
const SAF_BANK_DIR_URI_KEY = "behaviorCsvSafBankDirUri";
const DOWNLOAD_ROOT_URI =
  FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("Download");

let initialized = false;
let publicMirrorSafUri: string | null = null;
let attemptedPublicMirrorInSession = false;
let writeQueue: Promise<void> = Promise.resolve();
let pendingLines: string[] = [];

/**
 * In-memory cache of the app-local CSV content.
 * Avoids re-reading the (growing) file from disk on every flush.
 * Populated once during initialization and kept in sync with writes.
 */
let cachedAppContent: string | null = null;

/**
 * Throttle for the public-mirror full-file sync.
 * Writing the entire file to the SAF URI every second is too expensive;
 * we now only sync every MIRROR_SYNC_INTERVAL_MS milliseconds.
 */
const MIRROR_SYNC_INTERVAL_MS = 30_000;
let lastMirrorSyncTime = 0;

/** Track total rows flushed for diagnostics. */
let totalRowsFlushed = 0;

type CsvRowInput = {
  timestamp: number;
  userId: string;
  sessionId: string;
  sensorType: "accelerometer" | "gyroscope" | "touch";
  x?: number;
  y?: number;
  z?: number;
  touchX?: number;
  touchY?: number;
  pageX?: number;
  pageY?: number;
  touchAction?: string;
};

function formatNumber(value?: number) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(6);
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function isSafUri(path: string) {
  return path.startsWith("content://");
}

async function readCsvIfExists(path: string) {
  try {
    const content = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return content;
  } catch {
    return null;
  }
}

async function ensureHeader(path: string) {
  const existingContent = await readCsvIfExists(path);
  if (existingContent === null) {
    await FileSystem.writeAsStringAsync(path, CSV_HEADER, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return;
  }

  const normalized = existingContent.replace(/\r\n/g, "\n");
  const firstLine = normalized.split(/\n/, 1)[0];

  if (firstLine !== CSV_HEADER.trim()) {
    await FileSystem.writeAsStringAsync(path, `${CSV_HEADER}${normalized}`, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }
}

/**
 * Populate the in-memory cache from disk (one-time, at startup).
 * After this, all appends go through the cache — no more re-reading.
 */
async function loadAppContentCache() {
  if (cachedAppContent !== null) {
    return;
  }

  const content = await readCsvIfExists(APP_MODEL_PATH);
  if (content === null) {
    cachedAppContent = CSV_HEADER;
  } else {
    const normalized = content.replace(/\r\n/g, "\n");
    cachedAppContent = normalized.startsWith(CSV_HEADER)
      ? normalized
      : `${CSV_HEADER}${normalized}`;
  }

  const lineCount = (cachedAppContent.match(/\n/g) || []).length;
  console.log(`[BehaviorCSV] Loaded cache from disk: ${lineCount} lines`);
}

async function appendLinesEnsuringFile(lines: string[]) {
  if (lines.length === 0) {
    return;
  }

  const contentToAppend = `${lines.join("\n")}\n`;

  // Use the in-memory cache — never re-read the file.
  if (cachedAppContent !== null) {
    cachedAppContent += contentToAppend;
    await FileSystem.writeAsStringAsync(APP_MODEL_PATH, cachedAppContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return;
  }

  // First-time fallback if cache wasn't loaded yet.
  const existingContent = await readCsvIfExists(APP_MODEL_PATH);

  if (existingContent === null) {
    cachedAppContent = `${CSV_HEADER}${contentToAppend}`;
  } else {
    const normalized = existingContent.replace(/\r\n/g, "\n");
    const withHeader = normalized.startsWith(CSV_HEADER) ? normalized : `${CSV_HEADER}${normalized}`;
    cachedAppContent = `${withHeader}${contentToAppend}`;
  }

  await FileSystem.writeAsStringAsync(APP_MODEL_PATH, cachedAppContent, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function syncPublicMirrorFromAppFile() {
  if (!publicMirrorSafUri) {
    return;
  }

  // Use the cache if available, otherwise read from disk.
  const content = cachedAppContent ?? (await readCsvIfExists(APP_MODEL_PATH));
  if (content === null) {
    return;
  }

  await FileSystem.writeAsStringAsync(publicMirrorSafUri, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

function isBankDirectoryUri(uri: string) {
  const decoded = decodeURIComponent(uri).toLowerCase();
  return decoded.endsWith("/bank") || decoded.includes("/bank/");
}

function isModelCsvUri(uri: string) {
  const decoded = decodeURIComponent(uri).toLowerCase();
  return decoded.endsWith("/model.csv");
}

async function ensureBankSafDirectory(downloadDirectoryUri: string) {
  if (isBankDirectoryUri(downloadDirectoryUri)) {
    return downloadDirectoryUri;
  }

  const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(
    downloadDirectoryUri
  );
  const existingBank = entries.find((uri) => isBankDirectoryUri(uri));
  if (existingBank) {
    return existingBank;
  }

  return FileSystem.StorageAccessFramework.makeDirectoryAsync(
    downloadDirectoryUri,
    "Bank"
  );
}

async function ensureSafModelCsv(bankDirectoryUri: string) {
  const entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(
    bankDirectoryUri
  );
  const existingFile = entries.find((uri) => isModelCsvUri(uri));
  if (existingFile) {
    return existingFile;
  }

  return FileSystem.StorageAccessFramework.createFileAsync(
    bankDirectoryUri,
    "Model",
    "text/csv"
  );
}

/**
 * Set up the public mirror (Download/Bank/Model.csv) via SAF.
 * This shows a system file-picker dialog, so it must ONLY be called
 * during initialization — NEVER inside the flush path!
 */
async function setupPublicMirror() {
  if (Platform.OS !== "android") {
    return;
  }

  try {
    const storedBankDirUri = await getFromSecureStore(SAF_BANK_DIR_URI_KEY);
    if (storedBankDirUri) {
      const bankInfo = await FileSystem.getInfoAsync(storedBankDirUri);
      if (bankInfo.exists) {
        const modelFileUri = await ensureSafModelCsv(storedBankDirUri);
        publicMirrorSafUri = modelFileUri;
        await saveToSecureStore(SAF_FILE_URI_KEY, modelFileUri);
        await ensureHeader(modelFileUri);
        console.log("[BehaviorCSV] Restored SAF mirror from stored Bank dir");
        return;
      }
      await deleteFromSecureStore(SAF_BANK_DIR_URI_KEY);
    }

    const storedSafFileUri = await getFromSecureStore(SAF_FILE_URI_KEY);
    if (storedSafFileUri) {
      const storedInfo = await FileSystem.getInfoAsync(storedSafFileUri);
      if (storedInfo.exists) {
        publicMirrorSafUri = storedSafFileUri;
        console.log("[BehaviorCSV] Restored SAF mirror from stored file URI");
        return;
      }
      await deleteFromSecureStore(SAF_FILE_URI_KEY);
    }

    // This shows a blocking system dialog — only safe during init, never flush.
    let permission =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
        DOWNLOAD_ROOT_URI
      );
    if (!permission.granted || !permission.directoryUri) {
      permission =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    }
    if (!permission.granted || !permission.directoryUri) {
      console.log("[BehaviorCSV] SAF permission denied, using app-local only");
      return;
    }

    const bankDirectoryUri = await ensureBankSafDirectory(permission.directoryUri);
    const modelFileUri = await ensureSafModelCsv(bankDirectoryUri);
    publicMirrorSafUri = modelFileUri;
    await saveToSecureStore(SAF_BANK_DIR_URI_KEY, bankDirectoryUri);
    await saveToSecureStore(SAF_FILE_URI_KEY, modelFileUri);
    await ensureHeader(modelFileUri);
    console.log("[BehaviorCSV] SAF mirror set up:", modelFileUri);
  } catch (error) {
    console.warn("[BehaviorCSV] SAF setup failed, using app-local only:", error);
  }
}

async function ensureInitialized() {
  if (!initialized) {
    await FileSystem.makeDirectoryAsync(APP_BANK_DIR, { intermediates: true });
    await ensureHeader(APP_MODEL_PATH);
    await loadAppContentCache();
    initialized = true;
    console.log("[BehaviorCSV] Initialized. App path:", APP_MODEL_PATH);
  }

  if (
    Platform.OS === "android" &&
    !publicMirrorSafUri &&
    !attemptedPublicMirrorInSession
  ) {
    attemptedPublicMirrorInSession = true;
    await setupPublicMirror();
  }
}

export async function initBehaviorCsvFile() {
  await ensureInitialized();
  return getBehaviorCsvPath();
}

export async function getBehaviorCsvPath() {
  await ensureInitialized();
  return APP_MODEL_PATH;
}

export async function getPublicBehaviorCsvPath() {
  await ensureInitialized();
  if (publicMirrorSafUri) {
    return publicMirrorSafUri;
  }
  return APP_MODEL_PATH;
}

export async function appendBehaviorCsvRow(row: CsvRowInput) {
  const line = [
    row.timestamp.toString(),
    escapeCsv(row.userId),
    escapeCsv(row.sessionId),
    row.sensorType,
    formatNumber(row.x),
    formatNumber(row.y),
    formatNumber(row.z),
    formatNumber(row.touchX),
    formatNumber(row.touchY),
    formatNumber(row.pageX),
    formatNumber(row.pageY),
    row.touchAction ? escapeCsv(row.touchAction) : "",
  ].join(",");

  pendingLines.push(line);
}

export async function flushBehaviorCsvRows() {
  writeQueue = writeQueue
    .catch(() => {
      // Keep queue alive after transient failures.
    })
    .then(async () => {
      if (pendingLines.length === 0) {
        return;
      }

      const linesToWrite = pendingLines;
      pendingLines = [];

      try {
        await ensureInitialized();
      } catch (initError) {
        console.warn("[BehaviorCSV] Init failed during flush:", initError);
        pendingLines = [...linesToWrite, ...pendingLines];
        return;
      }

      // -----------------------------------------------------------
      // CRITICAL: We NEVER call setupPublicMirror() here.
      // setupPublicMirror() shows a blocking system dialog that
      // would freeze the entire writeQueue and stop all CSV writes.
      // The mirror is set up once during ensureInitialized().
      // -----------------------------------------------------------

      try {
        await appendLinesEnsuringFile(linesToWrite);
        totalRowsFlushed += linesToWrite.length;

        // Log every ~500 rows so we can confirm data is growing.
        if (totalRowsFlushed % 500 < linesToWrite.length) {
          const cacheLines = cachedAppContent
            ? (cachedAppContent.match(/\n/g) || []).length
            : "?";
          console.log(
            `[BehaviorCSV] Flushed ${linesToWrite.length} rows (total: ${totalRowsFlushed}, file lines: ${cacheLines})`
          );
        }

        // Throttle public-mirror sync: only write full file every 30s.
        // If the mirror URI is lost, we DON'T re-call setupPublicMirror.
        const now = Date.now();
        if (publicMirrorSafUri && now - lastMirrorSyncTime >= MIRROR_SYNC_INTERVAL_MS) {
          lastMirrorSyncTime = now;
          try {
            await syncPublicMirrorFromAppFile();
          } catch {
            // Mirror is broken — give up until next app restart.
            console.warn("[BehaviorCSV] Mirror sync failed, disabling mirror");
            publicMirrorSafUri = null;
          }
        }
      } catch (error) {
        console.warn("[BehaviorCSV] Flush error, re-queuing rows:", error);
        pendingLines = [...linesToWrite, ...pendingLines];
        throw error;
      }
    });

  await writeQueue;
}

/**
 * Force an immediate sync of the public mirror, bypassing the throttle.
 * Call this when the app is about to go to background so the user
 * always sees up-to-date data in Download/Bank/Model.csv.
 */
export async function forceSyncPublicMirror() {
  if (!publicMirrorSafUri) {
    return;
  }

  try {
    await syncPublicMirrorFromAppFile();
    lastMirrorSyncTime = Date.now();
    console.log("[BehaviorCSV] Force-synced public mirror on background");
  } catch {
    // Best-effort; the app file is always the source of truth.
  }
}
