"use client";

import { useActionState, useState } from "react";
import { createReport, regenerateReport, resetHighlights, saveHighlights } from "@/app/actions";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { button, input, label } from "@/components/ui";
import type { PeriodOption } from "@/lib/period";

export function CopyButton({ text, label: buttonLabel = "Copy text" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={copy} className={button.primary}>
      {copied ? "Copied" : buttonLabel}
    </button>
  );
}

export function GenerateReportForm({
  clientId,
  options,
  defaultValue,
}: {
  clientId: string;
  options: PeriodOption[];
  defaultValue: string;
}) {
  const [state, formAction] = useActionState(createReport.bind(null, clientId), undefined);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="period" className="sr-only">
          Period
        </label>
        <select
          id="period"
          name="period"
          defaultValue={state?.fields?.period ?? defaultValue}
          className={`${input} sm:max-w-sm`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SubmitButton pendingLabel="Pulling from LeadShark…">Generate report</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function RegenerateButton({ reportId }: { reportId: string }) {
  const [state, formAction] = useActionState(regenerateReport.bind(null, reportId), undefined);
  return (
    <form action={formAction} className="contents">
      <SubmitButton variant="secondary" pendingLabel="Refreshing…">
        Refresh numbers
      </SubmitButton>
      {state?.error ? <FormMessage state={state} /> : null}
    </form>
  );
}

export function HighlightsEditor({
  reportId,
  highlights,
  edited,
}: {
  reportId: string;
  highlights: string;
  edited: boolean;
}) {
  const [state, formAction] = useActionState(saveHighlights.bind(null, reportId), undefined);

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="highlights" className={label}>
            What worked best
          </label>
          <span className="text-xs text-zinc-500">{edited ? "Edited by you" : "Auto-written"}</span>
        </div>
        <textarea
          // Remount when the saved text changes (e.g. after a reset) so the field shows it.
          key={highlights}
          id="highlights"
          name="highlights"
          rows={7}
          defaultValue={highlights}
          className={`${input} font-mono text-[13px] leading-relaxed`}
        />
        <p className="text-xs text-zinc-500">
          Lines starting with &quot;- &quot; become bullets in the PDF. Name the winning post the way your client would,
          e.g. &quot;The Bro teardown (#1) was the clear winner:&quot;.
        </p>
        <div className="flex items-center gap-2">
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
      {edited ? (
        <form action={resetHighlights.bind(null, reportId)}>
          <SubmitButton variant="ghost" pendingLabel="Resetting…">
            Reset to auto-written text
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

export function ConfirmSubmit({
  action,
  label: buttonLabel,
  confirmMessage,
}: {
  action: () => Promise<void>;
  label: string;
  confirmMessage: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <SubmitButton variant="danger" pendingLabel="Deleting…">
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}
