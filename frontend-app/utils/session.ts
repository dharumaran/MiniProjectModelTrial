import {
  deleteFromSecureStore,
  getJsonFromSecureStore,
  saveJsonToSecureStore,
} from "./secureStorage";
import type { AuthSession, User } from "./types";

const SESSION_KEY = "authSession";

function toSessionUser(user: User): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    accountNo: user.accountNo,
    upiId: user.upiId,
    bankName: user.bankName,
    balance: user.balance,
    // Keep session payload minimal to stay below SecureStore size limits.
    transactions: [],
  };
}

export async function saveSession(user: User) {
  await saveJsonToSecureStore<AuthSession>(SESSION_KEY, {
    user: toSessionUser(user),
  });
}

export async function getSession() {
  return getJsonFromSecureStore<AuthSession>(SESSION_KEY);
}

export async function clearSession() {
  await deleteFromSecureStore(SESSION_KEY);
}
