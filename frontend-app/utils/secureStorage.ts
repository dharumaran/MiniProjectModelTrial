import * as SecureStore from "expo-secure-store";

export async function saveToSecureStore(key: string, value: string) {
  await SecureStore.setItemAsync(key, value);
}

export async function getFromSecureStore(key: string) {
  return SecureStore.getItemAsync(key);
}

export async function deleteFromSecureStore(key: string) {
  await SecureStore.deleteItemAsync(key);
}

export async function saveJsonToSecureStore<T>(key: string, value: T) {
  let serialized = JSON.stringify(value);

  // SecureStore has practical payload limits (~2048 bytes on some devices).
  if (key === "authSession" && serialized.length > 1900) {
    const session = value as unknown as {
      user?: {
        id?: string;
        name?: string;
        phone?: string;
        accountNo?: string;
        upiId?: string;
        bankName?: string;
        balance?: number;
      };
    };

    serialized = JSON.stringify({
      user: {
        id: session.user?.id,
        name: session.user?.name || "",
        phone: session.user?.phone || "",
        accountNo: session.user?.accountNo || "",
        upiId: session.user?.upiId || "",
        bankName: session.user?.bankName || "",
        balance: session.user?.balance || 0,
        transactions: [],
      },
    });
  }

  await saveToSecureStore(key, serialized);
}

export async function getJsonFromSecureStore<T>(key: string) {
  const value = await getFromSecureStore(key);
  return value ? (JSON.parse(value) as T) : null;
}
