/**
 * Rules for admin changes to a user account. Pure (no DB) so they can be unit-tested; the caller
 * loads the facts inside a locked transaction and applies the plan.
 */
import type { UserRole, UserStatus } from "@/lib/domain";
import type { ErrorCode } from "../errors";
import type { AdminUserPatch } from "./schemas";

export type UserFacts = {
  id: string;
  role: UserRole;
  status: UserStatus;
  maxResultsPerSearch: number | null;
  monthlyRequestLimit: number | null;
};

export type UserChangeField = "role" | "status" | "maxResultsPerSearch" | "monthlyRequestLimit";

export type UserChangePlan =
  | {
      ok: true;
      /** Only fields whose value actually changes. */
      before: Partial<Pick<UserFacts, UserChangeField>>;
      after: Partial<Pick<UserFacts, UserChangeField>>;
      userUpdate: Partial<Pick<UserFacts, "role" | "status">>;
      limitsUpdate: Partial<Pick<UserFacts, "maxResultsPerSearch" | "monthlyRequestLimit">>;
      /** Disabling signs the user out everywhere. */
      revokeSessions: boolean;
    }
  | { ok: false; code: ErrorCode; message: string; reason: "self_change" | "last_admin" };

export const SELF_CHANGE_MESSAGE = "You can't change your own role or status. Ask another administrator to do it.";
export const LAST_ADMIN_MESSAGE =
  "LeadFinder needs at least one active administrator. Make someone else an admin before changing this account.";

export function planUserChange(input: {
  actorId: string;
  target: UserFacts;
  patch: AdminUserPatch;
  /** Active admins other than the target. */
  otherActiveAdmins: number;
}): UserChangePlan {
  const { actorId, target, patch, otherActiveAdmins } = input;
  const before: Partial<Pick<UserFacts, UserChangeField>> = {};
  const after: Partial<Pick<UserFacts, UserChangeField>> = {};
  const userUpdate: Partial<Pick<UserFacts, "role" | "status">> = {};
  const limitsUpdate: Partial<Pick<UserFacts, "maxResultsPerSearch" | "monthlyRequestLimit">> = {};

  if (patch.role !== undefined && patch.role !== target.role) {
    before.role = target.role;
    after.role = userUpdate.role = patch.role;
  }
  if (patch.status !== undefined && patch.status !== target.status) {
    before.status = target.status;
    after.status = userUpdate.status = patch.status;
  }
  for (const k of ["maxResultsPerSearch", "monthlyRequestLimit"] as const) {
    const v = patch[k];
    if (v !== undefined && v !== target[k]) {
      before[k] = target[k];
      after[k] = limitsUpdate[k] = v;
    }
  }

  const changesAccess = userUpdate.role !== undefined || userUpdate.status !== undefined;
  if (changesAccess && actorId === target.id) {
    return { ok: false, code: "forbidden", message: SELF_CHANGE_MESSAGE, reason: "self_change" };
  }

  const isActiveAdmin = target.role === "admin" && target.status === "active";
  const newRole = userUpdate.role ?? target.role;
  const newStatus = userUpdate.status ?? target.status;
  const staysActiveAdmin = newRole === "admin" && newStatus === "active";
  if (isActiveAdmin && !staysActiveAdmin && otherActiveAdmins < 1) {
    return { ok: false, code: "conflict", message: LAST_ADMIN_MESSAGE, reason: "last_admin" };
  }

  return {
    ok: true,
    before,
    after,
    userUpdate,
    limitsUpdate,
    revokeSessions: userUpdate.status === "disabled",
  };
}
