import { CalendarClock, ChartColumn, KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/page-header";
import { card } from "@/components/ui";
import { weeklyRunLabel } from "@/lib/period";

export const metadata: Metadata = { title: "Add client" };

// Adding a client checks the key and builds their first report in a Server Action here.
export const maxDuration = 60;

export default function NewClientPage() {
  const steps = [
    { icon: KeyRound, title: "Key check", text: "The API key is tested against LeadShark before anything is saved." },
    {
      icon: ShieldCheck,
      title: "Stored encrypted",
      text: "Keys are encrypted at rest and only ever shown as the last 4 characters.",
    },
    {
      icon: ChartColumn,
      title: "First report",
      text: "Last week's report builds straight away, so there's something to send.",
    },
    { icon: CalendarClock, title: "Then every week", text: `New reports build on ${weeklyRunLabel()}.` },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Clients", href: "/" }, { label: "Add client" }]}
        title="Add a client"
        description="All you need is their name, LinkedIn profile and LeadShark API key."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`${card} p-6`}>
          <ClientForm mode="create" />
        </section>
        <aside className="space-y-5 px-1 lg:pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">What happens next</p>
          <ol className="space-y-5">
            {steps.map((step) => (
              <li key={step.title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-brand-600 shadow-xs ring-1 ring-zinc-200/80">
                  <step.icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium text-zinc-900">{step.title}</span>
                  <span className="block text-sm text-zinc-500">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </>
  );
}
