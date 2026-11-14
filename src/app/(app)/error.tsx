"use client";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Something went wrong"
      description={error.digest ? `Please try again. If it keeps happening, share this reference with your admin: ${error.digest}` : "Please try again."}
      action={
        <Button variant="outline" onClick={reset}>
          <RotateCcw /> Try again
        </Button>
      }
    />
  );
}
