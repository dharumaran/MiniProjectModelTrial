import {
  deleteFromSecureStore,
  getJsonFromSecureStore,
  saveJsonToSecureStore,
} from "./secureStorage";

export type RecipientType = "upi" | "account" | "mobile";

export interface PendingTransferPayload {
  fromAccount: string;
  toIdentifier: string;
  recipientType: RecipientType;
  amount: number;
  description?: string;
  returnRoute?: "/dashboard" | "/transfer";
}

const PENDING_TRANSFER_KEY = "pendingTransfer";

export async function savePendingTransfer(payload: PendingTransferPayload) {
  await saveJsonToSecureStore<PendingTransferPayload>(PENDING_TRANSFER_KEY, payload);
}

export async function getPendingTransfer() {
  return getJsonFromSecureStore<PendingTransferPayload>(PENDING_TRANSFER_KEY);
}

export async function clearPendingTransfer() {
  await deleteFromSecureStore(PENDING_TRANSFER_KEY);
}
