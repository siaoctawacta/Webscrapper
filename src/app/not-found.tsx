import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold tracking-tight">This page doesn’t exist</h1>
      <Link href="/search" className="text-sm text-accent hover:underline">Back to search</Link>
    </div>
  );
}
