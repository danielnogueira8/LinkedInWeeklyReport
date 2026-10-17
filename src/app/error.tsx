"use client";

import { button } from "@/components/ui";

// Production hides server error messages, so point at the usual suspects instead.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-zinc-600">
        If you just deployed, check that the database is connected (<code>DATABASE_URL</code>) and{" "}
        <code>ENCRYPTION_KEY</code> is set in Vercel, then redeploy so the tables get created.
      </p>
      {digest ? <p className="text-xs text-zinc-400">Error id {digest} (search for it in the Vercel logs)</p> : null}
      <button type="button" onClick={retry} className={button.secondary}>
        Try again
      </button>
    </div>
  );
}
