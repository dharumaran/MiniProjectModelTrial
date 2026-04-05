import {
  deleteFromSecureStore,
  getFromSecureStore,
  saveToSecureStore,
} from "./secureStorage";

function getPinKey(accountNo: string) {
  const normalizedAccount = String(accountNo || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "");
  const safeAccount = normalizedAccount || "unknown";
  return `authMpin${safeAccount}`;
}

export async function saveMpin(accountNo: string, pin: string) {
  await saveToSecureStore(getPinKey(accountNo), pin);
}

export async function getMpin(accountNo: string) {
  return getFromSecureStore(getPinKey(accountNo));
}

export async function verifyMpin(accountNo: string, inputPin: string) {
  const savedPin = await getMpin(accountNo);
  return Boolean(savedPin) && savedPin === String(inputPin || "").trim();
}

export async function clearMpin(accountNo: string) {
  await deleteFromSecureStore(getPinKey(accountNo));
}
