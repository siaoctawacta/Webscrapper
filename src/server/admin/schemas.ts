/**
 * Request validation for /api/v1/admin/*. Pure module (no DB, no secrets).
 */
import { z } from "zod";
import { MAX_TARGET_COUNT, USER_ROLES } from "@/lib/domain";
import { notFound } from "../errors";

export const MAX_MONTHLY_REQUEST_LIMIT = 100_000_000;
export const AUDIT_PAGE_SIZE = 50;

/** Statuses an admin can set: approve/enable → active, disable → disabled. */
export const ADMIN_SETTABLE_STATUSES = ["active", "disabled"] as const;

export const adminUserPatchSchema = z
  .object({
    status: z.enum(ADMIN_SETTABLE_STATUSES, { error: "Status must be active or disabled" }).optional(),
    role: z.enum(USER_ROLES, { error: "Role must be admin or member" }).optional(),
    maxResultsPerSearch: z
      .number({ error: "Max results per search must be a number" })
      .int({ error: "Max results per search must be a whole number" })
      .min(1, { error: "Max results per search must be at least 1" })
      .max(MAX_TARGET_COUNT, { error: `Max results per search can be at most ${MAX_TARGET_COUNT.toLocaleString("en-US")}` })
      .nullable()
      .optional(),
    monthlyRequestLimit: z
      .number({ error: "Monthly request limit must be a number" })
      .int({ error: "Monthly request limit must be a whole number" })
      .min(0, { error: "Monthly request limit cannot be negative" })
      .max(MAX_MONTHLY_REQUEST_LIMIT, { error: "Monthly request limit is too large" })
      .nullable()
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: "Nothing to update" });

export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;

export const invitationCreateSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .toLowerCase()
    .max(254, { error: "Email is too long" })
    .pipe(z.email({ error: "Enter a valid email address" })),
  role: z.enum(USER_ROLES, { error: "Role must be admin or member" }).default("member"),
});

export type InvitationCreateInput = z.infer<typeof invitationCreateSchema>;

export const AUDIT_ACTION_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i;

export const auditQuerySchema = z.object({
  page: z.coerce
    .number({ error: "page must be a number" })
    .int({ error: "page must be a whole number" })
    .min(1, { error: "page must be at least 1" })
    .max(100_000, { error: "page is too large" })
    .default(1),
  action: z
    .string()
    .trim()
    .max(64, { error: "action filter is too long" })
    .regex(AUDIT_ACTION_PATTERN, { error: "action filter may contain only letters, digits, _ and ." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** User ids are Better Auth text ids. Anything implausible is a 404 (never a 500). */
export function userIdParam(v: string | string[] | undefined): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw notFound("User");
  return v;
}
