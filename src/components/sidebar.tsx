"use client";

import { Clock, LayoutGrid, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/avatar";

type Props = { clients: Array<{ id: string; name: string }>; schedule: string };

function navItem(active: boolean) {
  return `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 ${
    active
      ? "bg-white font-medium text-zinc-950 shadow-xs ring-1 ring-zinc-200/80"
      : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900"
  }`;
}

/** Sidebar links. Reads the pathname for the active state, so it renders inside Suspense. */
export function SidebarNav({ clients, schedule }: Props) {
  const pathname = usePathname();
  const activeClient = clients.find((client) => pathname.startsWith(`/clients/${client.id}`));

  return (
    <>
      <nav className="space-y-0.5">
        <Link href="/" className={navItem(pathname === "/")}>
          <LayoutGrid className="text-zinc-400" />
          Clients
          <span className="ml-auto text-xs tabular-nums text-zinc-400">{clients.length}</span>
        </Link>
        <Link href="/clients/new" className={navItem(pathname === "/clients/new")}>
          <Plus className="text-zinc-400" />
          Add client
        </Link>
      </nav>

      {clients.length > 0 ? (
        <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <p className="px-2.5 pb-1.5 text-xs font-medium text-zinc-400">Your clients</p>
          <ul className="space-y-0.5">
            {clients.map((client) => (
              <li key={client.id}>
                <Link href={`/clients/${client.id}`} className={navItem(activeClient?.id === client.id)}>
                  <Avatar name={client.name} size="sm" />
                  <span className="truncate">{client.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <SidebarSchedule schedule={schedule} />
    </>
  );
}

export function SidebarSchedule({ schedule }: { schedule: string }) {
  return (
    <div className="mt-4 rounded-lg border border-zinc-200/80 bg-white p-3 text-xs text-zinc-500">
      <p className="flex items-center gap-1.5 font-medium text-zinc-800">
        <Clock className="size-3.5 text-brand-500" aria-hidden />
        Auto reports
      </p>
      <p className="mt-1">{schedule}, for every client.</p>
    </div>
  );
}
