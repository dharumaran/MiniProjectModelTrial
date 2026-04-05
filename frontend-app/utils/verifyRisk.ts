import { apiFetch } from "./api";
import type { SessionEvent } from "../hooks/useBehaviorTracker";

export interface RiskResponse {
  riskScore: number;
  level: "low" | "medium" | "high";
}

export async function verifyRisk(session: SessionEvent[]) {
  return apiFetch<RiskResponse>("/verify-session", {
    method: "POST",
    body: JSON.stringify({ session }),
  });
}
