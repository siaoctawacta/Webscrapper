import type { Metadata } from "next";
import { UsersPanel } from "@/components/admin/users-panel";
import { listUsers } from "@/server/admin";
import { pageAdmin } from "@/server/auth/session";

export const metadata: Metadata = { title: "Users · Admin" };

export default async function AdminUsersPage() {
  const me = await pageAdmin();
  const initialData = await listUsers();
  return <UsersPanel meId={me.id} initialData={initialData} />;
}
