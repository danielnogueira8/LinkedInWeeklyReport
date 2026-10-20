"use client";

import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { saveIcp } from "@/app/actions";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { button, label, textarea } from "@/components/ui";

type Progress = {
  done: boolean;
  posts: number;
  postsRead: number;
  comments: number;
  people: number;
  scored: number;
  icp: boolean;
};

const count = (value: number) => value.toLocaleString("en-US");

function describe(progress: Progress) {
  const reading = progress.postsRead < progress.posts;
  if (reading) {
    return `Reading comments: ${count(progress.postsRead)} of ${count(progress.posts)} posts done, ${count(progress.comments)} comments so far…`;
  }
  if (progress.icp && progress.scored < progress.people) {
    return `Scoring people: ${count(progress.scored)} of ${count(progress.people)} done…`;
  }
  return `Up to date: ${count(progress.comments)} comments from ${count(progress.people)} people.`;
}

/**
 * Pulls comments and scores commenters for the view, round after round (each round is one
 * request of a few minutes) until it's done, refreshing the list as it goes.
 */
export function SyncCommenters({ clientId, view }: { clientId: string; view: "week" | "all" }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  async function run() {
    setRunning(true);
    setStatus({ text: "Starting…" });
    try {
      for (;;) {
        const res = await fetch(`/clients/${clientId}/commenters/sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ view }),
        });
        const body = (await res.json().catch(() => null)) as (Progress & { error?: string }) | null;
        if (!res.ok || !body) {
          setStatus({ text: body?.error ?? "The sync stopped. Click again to carry on.", error: true });
          break;
        }
        setStatus({ text: body.done ? describe(body) : `${describe(body)} Keep this page open.` });
        router.refresh();
        if (body.done) break;
      }
    } catch {
      setStatus({ text: "Lost the connection. Click again to carry on where it stopped.", error: true });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button type="button" onClick={run} disabled={running} className={button.primary}>
        {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {running ? "Syncing…" : view === "week" ? "Sync last 7 days" : "Sync all time"}
      </button>
      {status ? (
        <p
          role={status.error ? "alert" : "status"}
          className={`flex max-w-sm items-start gap-1.5 text-right text-xs ${status.error ? "text-red-600" : "text-zinc-500"}`}
        >
          {status.error ? <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> : null}
          {status.text}
        </p>
      ) : null}
    </div>
  );
}

export function IcpForm({ clientId, icp, maxLength }: { clientId: string; icp: string; maxLength: number }) {
  const [state, formAction] = useActionState(saveIcp.bind(null, clientId), undefined);
  const [value, setValue] = useState(icp);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="icp" className={label}>
          Ideal customer
        </label>
        <textarea
          id="icp"
          name="icp"
          rows={2}
          maxLength={maxLength}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Founders of mobile apps who need to market them and want to do it with UGC"
          className={textarea}
        />
        <p className="mt-1.5 flex justify-between gap-3 text-xs text-zinc-500">
          <span>
            One sentence. LeadShark reads each commenter&apos;s name and headline against it: fit, adjacent or not, and
            a match %.
          </span>
          <span className="shrink-0 tabular-nums">
            {value.length}/{maxLength}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
