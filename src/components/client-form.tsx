"use client";

import { Plus } from "lucide-react";
import { useActionState } from "react";
import { createClient, updateClient } from "@/app/actions";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { input, label } from "@/components/ui";

type Props =
  | { mode: "create" }
  | { mode: "edit"; client: { id: string; name: string; linkedinUrl: string; apiKeyLast4: string } };

export function ClientForm(props: Props) {
  const action = props.mode === "create" ? createClient : updateClient.bind(null, props.client.id);
  const [state, formAction] = useActionState(action, undefined);
  const client = props.mode === "edit" ? props.client : null;
  const values = state?.fields;

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="name" className={label}>
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={values?.name ?? client?.name}
          placeholder="Alex Olim / Plutus Media"
          className={input}
        />
      </div>
      <div>
        <label htmlFor="linkedinUrl" className={label}>
          LinkedIn profile URL
        </label>
        <input
          id="linkedinUrl"
          name="linkedinUrl"
          required
          defaultValue={values?.linkedinUrl ?? client?.linkedinUrl}
          placeholder="https://www.linkedin.com/in/alex-olim"
          className={input}
        />
      </div>
      <div>
        <label htmlFor="apiKey" className={label}>
          LeadShark API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          required={!client}
          defaultValue={values?.apiKey}
          placeholder={client ? `Leave blank to keep the key ending in ${client.apiKeyLast4}` : "Paste the key"}
          className={input}
        />
        {!client ? (
          <p className="mt-1.5 text-xs text-zinc-500">
            Use the key from your client&apos;s own LeadShark account (Dashboard → Settings).
          </p>
        ) : null}
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel={client ? "Saving…" : "Checking key and building last week's report…"}>
        {client ? null : <Plus aria-hidden />}
        {client ? "Save changes" : "Add client"}
      </SubmitButton>
    </form>
  );
}
