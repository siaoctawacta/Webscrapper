import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/ui/misc";
import { pageAdmin } from "@/server/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await pageAdmin();
  return (
    <div className="grid gap-6">
      <PageHeader title="Admin" description="Approve people, manage access and limits, and review usage and activity." />
      <AdminNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
