export interface Transaction {
  date: string;
  amount: number;
  description: string;
  type: "Credit" | "Debit";
  mode?: string;
  counterparty?: string;
  upiId?: string;
}

export interface User {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  accountNo: string;
  upiId: string;
  bankName: string;
  balance: number;
  transactions: Transaction[];
}

export interface AuthSession {
  user: User;
}
