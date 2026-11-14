import "server-only";
import type { MeResponse } from "@/lib/api-types";
import type { AppUser } from "../auth/session";
import { env, isSampleMode } from "../env";
import { availableProviders } from "../providers/registry";
import { billableRequestsThisMonth } from "../usage";
import { getUserSearchLimits } from "./quotas";

export type { MeResponse } from "@/lib/api-types";

/** GET /api/v1/me */
export async function getMe(user: AppUser): Promise<MeResponse> {
  const [limits, usedThisMonth] = await Promise.all([getUserSearchLimits(user.id), billableRequestsThisMonth(user.id)]);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    limits: {
      maxResultsPerSearch: limits.maxResultsPerSearch,
      monthlyRequestLimit: limits.monthlyRequestLimit,
      usedThisMonth,
      maxConcurrentJobs: limits.maxConcurrentJobs,
    },
    sampleMode: isSampleMode(),
    aiAvailable: Boolean(env().AI_GATEWAY_API_KEY),
    providers: availableProviders(),
  };
}
