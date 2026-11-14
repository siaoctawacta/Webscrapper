import type { UserRole, UserStatus } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";

const STATUS: Record<UserStatus, { label: string; variant: "warning" | "success" | "danger" }> = {
  pending: { label: "Pending", variant: "warning" },
  active: { label: "Active", variant: "success" },
  disabled: { label: "Disabled", variant: "danger" },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function UserRoleBadge({ role }: { role: UserRole }) {
  return role === "admin" ? <Badge variant="accent">Admin</Badge> : <Badge variant="outline">Member</Badge>;
}
