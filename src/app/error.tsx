"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { button } from "@/components/ui";

// Production hides server error messages, so point at the usual suspects instead.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-amber-50 text-amber-600">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-zinc-900">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-600">
        If you just deployed, check that the database is connected (<code>DATABASE_URL</code>) and{" "}
        <code>ENCRYPTION_KEY</code> is set in Vercel, then redeploy so the tables get created.
      </p>
      {digest ? (
        <p className="mt-3 text-xs text-zinc-400">Error id {digest} (search for it in the Vercel logs)</p>
      ) : null}
      <button type="button" onClick={retry} className={`${button.secondary} mt-6`}>
        <RotateCcw aria-hidden />
        Try again
      </button>
    </div>
  );
}
