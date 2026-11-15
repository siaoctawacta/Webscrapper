import "server-only";
import { desc, eq } from "drizzle-orm";
import { audit } from "../audit";
import type { AppUser } from "../auth/session";
import { db } from "../db";
import { invitations, user } from "../db/schema";
import { HttpError, notFound } from "../errors";
import type { InvitationCreateInput } from "./schemas";
import type { InvitationDto } from "./types";
import { env } from "../env";
import { hashToken, newSecretToken } from "../auth/tokens";

type InvitationRow = typeof invitations.$inferSelect;

function toDto(r: InvitationRow, inviter: { id: string; name: string; email: string } | null): InvitationDto {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.acceptedAt ? "accepted" : "pending",
    invitedBy: inviter,
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
  };
}

/** All invitations, newest first. */
export async function listInvitations(): Promise<InvitationDto[]> {
  const rows = await db()
    .select({ inv: invitations, inviterId: user.id, inviterName: user.name, inviterEmail: user.email })
    .from(invitations)
    .leftJoin(user, eq(user.id, invitations.invitedBy))
    .orderBy(desc(invitations.createdAt), invitations.id);
  return rows.map((r) =>
    toDto(r.inv, r.inviterId ? { id: r.inviterId, name: r.inviterName ?? "", email: r.inviterEmail ?? "" } : null),
  );
}

/**
 * Invite an email address. Returns a personal sign-up link carrying a secret token (stored hashed,
 * shown only now). Whoever signs up with that link AND that email is approved with the invited role,
 * even when sign-up is closed. The email alone grants nothing. Emails are stored lower-case.
 */
export async function createInvitation(
  actor: AppUser,
  input: InvitationCreateInput,
  opts: { ip?: string | null } = {},
): Promise<InvitationDto> {
  const email = input.email.trim().toLowerCase();
  return db().transaction(async (tx) => {
    const [existingUser] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (existingUser) throw new HttpError("conflict", "Someone with this email already has an account.");

    const [existing] = await tx.select().from(invitations).where(eq(invitations.email, email)).limit(1);
    if (existing && !existing.acceptedAt) throw new HttpError("conflict", "This email has already been invited.");
    // An accepted invitation whose account was later deleted can be issued again.
    if (existing) await tx.delete(invitations).where(eq(invitations.id, existing.id));

    const token = newSecretToken();
    const [created] = await tx
      .insert(invitations)
      .values({ email, role: input.role, invitedBy: actor.id, tokenHash: hashToken(token) })
      .onConflictDoNothing({ target: invitations.email })
      .returning();
    if (!created) throw new HttpError("conflict", "This email has already been invited.");

    await audit(
      {
        actorId: actor.id,
        action: "admin.invitation.create",
        resourceType: "invitation",
        resourceId: created.id,
        metadata: { email, role: input.role },
        ip: opts.ip,
      },
      tx,
    );
    const inviteUrl = new URL("/sign-up", env().APP_URL);
    inviteUrl.searchParams.set("invite", token);
    inviteUrl.searchParams.set("email", email);
    return { ...toDto(created, { id: actor.id, name: actor.name, email: actor.email }), inviteUrl: inviteUrl.toString() };
  });
}

/** Revoke (delete) an invitation that has not been used yet. */
export async function revokeInvitation(actor: AppUser, id: string, opts: { ip?: string | null } = {}): Promise<void> {
  await db().transaction(async (tx) => {
    const [inv] = await tx.select().from(invitations).where(eq(invitations.id, id)).limit(1).for("update");
    if (!inv) throw notFound("Invitation");
    if (inv.acceptedAt) {
      throw new HttpError("conflict", "This invitation has already been used to create an account, so it can't be revoked.");
    }
    await tx.delete(invitations).where(eq(invitations.id, id));
    await audit(
      {
        actorId: actor.id,
        action: "admin.invitation.revoke",
        resourceType: "invitation",
        resourceId: id,
        metadata: { email: inv.email, role: inv.role },
        ip: opts.ip,
      },
      tx,
    );
  });
}
