"use client";

import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";
import { button } from "@/components/ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: keyof typeof button;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={button[variant]}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.error}
      </p>
    );
  }
  if (state?.message) return <p className="text-sm text-emerald-700">{state.message}</p>;
  return null;
}
