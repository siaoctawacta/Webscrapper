import type { Metadata } from "next";
import { AuditLogPanel } from "@/components/admin/audit-log-panel";
import { auditQuerySchema, listAuditLog } from "@/server/admin";
import { pageAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Audit log · Admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  await pageAdmin();
  const sp = await searchParams;
  const parsed = auditQuerySchema.safeParse({ page: first(sp.page), action: first(sp.action) });
  const query = parsed.success ? parsed.data : { page: 1 };
  const initialData = await listAuditLog(query);
  return <AuditLogPanel initialData={initialData} initialAction={query.action ?? null} />;
}
