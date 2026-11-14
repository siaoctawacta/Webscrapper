import { AppShell } from "@/components/shell/app-shell";
import { pageUser } from "@/server/auth/session";
import { isSampleMode } from "@/server/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await pageUser();
  return (
    <AppShell me={me} sampleMode={isSampleMode()}>
      {children}
    </AppShell>
  );
}
