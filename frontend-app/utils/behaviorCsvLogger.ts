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
let rowsSinceMirrorRetry = 0;

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

async function ensureHeader(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(path, CSV_HEADER, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return;
  }

  const content = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const normalized = content.replace(/\r\n/g, "\n");
  const firstLine = normalized.split(/\n/, 1)[0];

  if (firstLine !== CSV_HEADER.trim()) {
    await FileSystem.writeAsStringAsync(path, `${CSV_HEADER}${normalized}`, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  }
}

async function appendLineEnsuringFile(path: string, line: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(path, `${CSV_HEADER}${line}\n`, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return;
  }

  await ensureHeader(path);
  await FileSystem.writeAsStringAsync(path, `${line}\n`, {
    encoding: FileSystem.EncodingType.UTF8,
    append: true,
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
        return;
      }
      await deleteFromSecureStore(SAF_BANK_DIR_URI_KEY);
    }

    const storedSafFileUri = await getFromSecureStore(SAF_FILE_URI_KEY);
    if (storedSafFileUri) {
      const storedInfo = await FileSystem.getInfoAsync(storedSafFileUri);
      if (storedInfo.exists) {
        publicMirrorSafUri = storedSafFileUri;
        return;
      }
      await deleteFromSecureStore(SAF_FILE_URI_KEY);
    }

    let permission =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
        DOWNLOAD_ROOT_URI
      );
    if (!permission.granted || !permission.directoryUri) {
      permission =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    }
    if (!permission.granted || !permission.directoryUri) {
      return;
    }

    const bankDirectoryUri = await ensureBankSafDirectory(permission.directoryUri);
    const modelFileUri = await ensureSafModelCsv(bankDirectoryUri);
    publicMirrorSafUri = modelFileUri;
    await saveToSecureStore(SAF_BANK_DIR_URI_KEY, bankDirectoryUri);
    await saveToSecureStore(SAF_FILE_URI_KEY, modelFileUri);
    await ensureHeader(modelFileUri);
  } catch {
    // Local app storage remains the fallback.
  }
}

async function ensurePublicMirrorReady() {
  if (!publicMirrorSafUri) {
    return;
  }

  try {
    const info = await FileSystem.getInfoAsync(publicMirrorSafUri);
    if (info.exists) {
      await ensureHeader(publicMirrorSafUri);
      return;
    }
  } catch {
    // Fall back to local app path when SAF access fails.
  }

  publicMirrorSafUri = null;
  await deleteFromSecureStore(SAF_BANK_DIR_URI_KEY);
  await deleteFromSecureStore(SAF_FILE_URI_KEY);
  await setupPublicMirror();
}

async function maybeRetryPublicMirrorSetup() {
  if (Platform.OS !== "android" || publicMirrorSafUri) {
    return;
  }

  rowsSinceMirrorRetry += 1;
  if (rowsSinceMirrorRetry < 25) {
    return;
  }

  rowsSinceMirrorRetry = 0;
  await setupPublicMirror();
}

async function ensureInitialized() {
  if (!initialized) {
    await FileSystem.makeDirectoryAsync(APP_BANK_DIR, { intermediates: true });
    await ensureHeader(APP_MODEL_PATH);
    initialized = true;
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
  if (publicMirrorSafUri) {
    return publicMirrorSafUri;
  }
  return APP_MODEL_PATH;
}

export async function appendBehaviorCsvRow(row: CsvRowInput) {
  writeQueue = writeQueue
    .catch(() => {
      // Keep queue alive after transient failures.
    })
    .then(async () => {
    await ensureInitialized();
    try {
      await ensurePublicMirrorReady();
    } catch {
      publicMirrorSafUri = null;
      attemptedPublicMirrorInSession = false;
    }
    await maybeRetryPublicMirrorSetup();

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

    await appendLineEnsuringFile(APP_MODEL_PATH, line);

    if (publicMirrorSafUri) {
      try {
        await appendLineEnsuringFile(publicMirrorSafUri, line);
      } catch {
        publicMirrorSafUri = null;
        attemptedPublicMirrorInSession = false;
        await deleteFromSecureStore(SAF_BANK_DIR_URI_KEY);
        await deleteFromSecureStore(SAF_FILE_URI_KEY);
      }
    }
    });

  await writeQueue;
}
