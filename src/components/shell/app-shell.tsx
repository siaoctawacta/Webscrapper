"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Dialog as D } from "radix-ui";
import {
  FolderHeart,
  History,
  LayoutTemplate,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Sparkles,
} from "lucide-react";
import type { MeDto } from "@/lib/api-types";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; admin?: boolean };

export const NAV: NavItem[] = [
  { href: "/search", label: "New search", icon: Search },
  { href: "/searches", label: "Searches", icon: History },
  { href: "/collections", label: "Collections", icon: FolderHeart },
  { href: "/concepts", label: "Homepage concepts", icon: LayoutTemplate },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: ShieldCheck, admin: true },
];

function Brand() {
  return (
    <Link href="/search" className="flex items-center gap-2 px-2 text-[15px] font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Sparkles className="size-3.5" />
      </span>
      LeadFinder
    </Link>
  );
}

function NavLinks({ me, onNavigate }: { me: MeDto; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-0.5">
      {NAV.filter((n) => !n.admin || me.role === "admin").map((n) => {
        const active = pathname === n.href || (n.href !== "/search" && pathname.startsWith(n.href + "/")) || (n.href === "/searches" && pathname.startsWith("/searches"));
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-4" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ me }: { me: MeDto }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const initials = (me.name || me.email).split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30">
        <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-soft-foreground">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{me.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{me.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings /> Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ me, sampleMode, children }: { me: MeDto; sampleMode: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-border bg-subtle px-3 py-4 lg:flex">
        <Brand />
        <NavLinks me={me} />
        <div className="mt-auto grid gap-3">
          {sampleMode && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning-soft-foreground">
              <span className="font-semibold">Sample data mode.</span> Results are generated, not real businesses. Add a Google Maps key to search real data.
            </div>
          )}
          <UserMenu me={me} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="rounded-md p-1.5 hover:bg-muted" aria-label="Open menu">
              <Menu className="size-5" />
            </D.Trigger>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
              <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 bg-background px-3 py-4 shadow-xl outline-none">
                <D.Title className="sr-only">Navigation</D.Title>
                <Brand />
                <NavLinks me={me} onNavigate={() => setOpen(false)} />
                <div className="mt-auto"><UserMenu me={me} /></div>
              </D.Content>
            </D.Portal>
          </D.Root>
          <Brand />
          {sampleMode && <span className="ml-auto rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-soft-foreground">Sample data</span>}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
