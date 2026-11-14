import type { Metadata } from "next";
import { UsagePanel } from "@/components/admin/usage-panel";
import { usageByUserMonth } from "@/server/admin";
import { pageAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Usage · Admin" };

export default async function AdminUsagePage() {
  await pageAdmin();
  return <UsagePanel initialData={await usageByUserMonth({ months: 6 })} />;
}
