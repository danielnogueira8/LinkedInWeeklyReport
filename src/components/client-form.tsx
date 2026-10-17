"use client";

import { Plus, UserPlus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { createClient, updateClient } from "@/app/actions";
import { FormMessage, SubmitButton } from "@/components/form-status";
import { input, label } from "@/components/ui";

type SavedProfile = { id: string; name: string; linkedinUrl: string; apiKeyLast4: string };

type Props = { mode: "create" } | { mode: "edit"; client: { id: string; name: string; profiles: SavedProfile[] } };

type Row = { key: string; id: string; name: string; linkedinUrl: string; apiKey: string; apiKeyLast4?: string };

let nextKey = 0;
const blankRow = (): Row => ({ key: `new-${nextKey++}`, id: "", name: "", linkedinUrl: "", apiKey: "" });

/** "Alex & Sam", "Alex, Sam & Jo" */
function joinNames(names: string[]) {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

function savedRows(client: { name: string; profiles: SavedProfile[] }): Row[] {
  return client.profiles.map((profile) => ({
    key: profile.id,
    id: profile.id,
    // A solo client's single name field is the report title.
    name: client.profiles.length > 1 ? profile.name : client.name,
    linkedinUrl: profile.linkedinUrl,
    apiKey: "",
    apiKeyLast4: profile.apiKeyLast4,
  }));
}

const savedTitle = (client: { name: string; profiles: SavedProfile[] }) =>
  client.profiles.length > 1 ? client.name : "";

// Inputs are controlled, so what was typed survives a failed submit.
export function ClientForm(props: Props) {
  const client = props.mode === "edit" ? props.client : null;
  const [state, formAction] = useActionState(client ? updateClient.bind(null, client.id) : createClient, undefined);
  const [rows, setRows] = useState<Row[]>(() => (client ? savedRows(client) : [blankRow()]));
  const [title, setTitle] = useState(() => (client ? savedTitle(client) : ""));
  const joint = rows.length > 1;

  // After a save the page re-renders with the stored creators (new ids, new key endings):
  // reset the rows to match, keeping the form mounted so its "Saved." message stays.
  const saved = client ? JSON.stringify([client.name, client.profiles]) : "";
  const [synced, setSynced] = useState(saved);
  if (client && saved !== synced) {
    setSynced(saved);
    setRows(savedRows(client));
    setTitle(savedTitle(client));
  }

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-3">
        {rows.map((row, index) => {
          const id = (name: string) => `creator-${row.key}-${name}`;
          const fields = (
            <div className="space-y-4">
              <input type="hidden" name="creatorId" value={row.id} />
              <div>
                <label htmlFor={id("name")} className={label}>
                  {joint ? "Creator name" : "Name"}
                </label>
                <input
                  id={id("name")}
                  name="creatorName"
                  required
                  value={row.name}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  placeholder={joint ? "Sam Lee" : "Alex Olim / Plutus Media"}
                  className={input}
                />
              </div>
              <div>
                <label htmlFor={id("url")} className={label}>
                  LinkedIn profile URL
                </label>
                <input
                  id={id("url")}
                  name="creatorUrl"
                  required
                  value={row.linkedinUrl}
                  onChange={(event) => update(row.key, { linkedinUrl: event.target.value })}
                  placeholder="https://www.linkedin.com/in/alex-olim"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor={id("key")} className={label}>
                  LeadShark API key
                </label>
                <input
                  id={id("key")}
                  name="creatorKey"
                  type="password"
                  autoComplete="off"
                  required={!row.apiKeyLast4}
                  value={row.apiKey}
                  onChange={(event) => update(row.key, { apiKey: event.target.value })}
                  placeholder={
                    row.apiKeyLast4 ? `Leave blank to keep the key ending in ${row.apiKeyLast4}` : "Paste the key"
                  }
                  className={input}
                />
                {!row.apiKeyLast4 && !joint ? (
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Use the key from your client&apos;s own LeadShark account (Dashboard → Settings).
                  </p>
                ) : null}
              </div>
            </div>
          );

          if (!joint) return <div key={row.key}>{fields}</div>;
          return (
            <fieldset key={row.key} className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Creator {index + 1}
                </legend>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900"
                >
                  <X className="size-3.5" aria-hidden />
                  Remove
                </button>
              </div>
              {fields}
            </fieldset>
          );
        })}

        <button
          type="button"
          onClick={() => setRows((current) => [...current, blankRow()])}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-left transition-colors hover:border-brand-500 hover:bg-brand-50/40"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <UserPlus className="size-4" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-medium text-zinc-900">Add another creator</span>
            <span className="block text-xs text-zinc-500">
              Combine two or more LinkedIn profiles into one joint report.
            </span>
          </span>
        </button>
      </div>

      {joint ? (
        <div>
          <label htmlFor="title" className={label}>
            Report title <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={joinNames(rows.map((row) => row.name).filter(Boolean)) || "Alex Olim & Sam Lee"}
            className={input}
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Shown at the top of the report and PDF. Leave it blank to use the creators&apos; names.
          </p>
        </div>
      ) : null}

      <FormMessage state={state} />
      <SubmitButton pendingLabel={client ? "Saving…" : "Checking keys and building last week's report…"}>
        {client ? null : <Plus aria-hidden />}
        {client ? "Save changes" : joint ? "Add joint client" : "Add client"}
      </SubmitButton>
    </form>
  );
}
