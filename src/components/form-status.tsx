"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";
import { button } from "@/components/ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: keyof typeof button;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${button[variant]} ${className}`}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }
  if (state?.message) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-good">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }
  return null;
}
