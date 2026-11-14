// CONTRACT STUB — implemented by the "exports" module agent. Keep this export signature.
import "server-only";

/** Delete export files past expires_at and mark those exports "expired". Returns how many were purged. */
export async function purgeExpiredExports(_now: Date = new Date()): Promise<number> {
  return 0;
}
