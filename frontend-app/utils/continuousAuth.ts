import { deleteFromSecureStore, getJsonFromSecureStore, saveJsonToSecureStore } from "./secureStorage";

const REAUTH_KEY = "continuousReauth";

type ReauthRecord = {
  at: number;
};

export async function markContinuousReauthenticated() {
  await saveJsonToSecureStore<ReauthRecord>(REAUTH_KEY, { at: Date.now() });
}

export async function getContinuousReauthRecord() {
  return getJsonFromSecureStore<ReauthRecord>(REAUTH_KEY);
}

export async function clearContinuousReauthRecord() {
  await deleteFromSecureStore(REAUTH_KEY);
}
