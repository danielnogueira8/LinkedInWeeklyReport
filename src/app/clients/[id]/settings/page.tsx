import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { deleteClient } from "@/app/actions";
import { avatarSrc, ClientAvatar } from "@/components/avatar";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/page-header";
import { ConfirmSubmit } from "@/components/report-controls";
import { card, cardHeader, cardTitle } from "@/components/ui";
import { getClient } from "@/lib/data";

// Saving checks new keys with LeadShark and looks up missing photos.
export const maxDuration = 60;

export async function generateMetadata({ params }: PageProps<"/clients/[id]/settings">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const client = await getClient(id);
  return { title: client ? `${client.name} settings` : "Settings" };
}

export default async function ClientSettingsPage({ params }: PageProps<"/clients/[id]/settings">) {
  const { id } = await params;
  await connection();
  const client = await getClient(id);
  if (!client) notFound();
  const joint = client.profiles.length > 1;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: "Clients", href: "/" },
          { label: client.name, href: `/clients/${client.id}` },
          { label: "Settings" },
        ]}
        leading={
          <ClientAvatar
            name={client.name}
            creators={client.profiles.map((profile) => ({ name: profile.name, src: avatarSrc(profile) }))}
            size="lg"
          />
        }
        title="Settings"
        description={client.name}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <section className={card}>
          <div className={cardHeader}>
            <h2 className={cardTitle}>{joint ? "Creators, keys and photos" : "Creator, key and photo"}</h2>
          </div>
          <div className="p-5">
            <div className="max-w-lg">
              <ClientForm
                mode="edit"
                client={{
                  id: client.id,
                  name: client.name,
                  profiles: client.profiles.map((profile) => ({
                    id: profile.id,
                    name: profile.name,
                    linkedinUrl: profile.linkedinUrl,
                    apiKeyLast4: profile.apiKeyLast4,
                    photo: avatarSrc(profile),
                  })),
                }}
              />
            </div>
          </div>
        </section>

        <section className={`${card} p-5`}>
          <h2 className={cardTitle}>Remove client</h2>
          <p className="mb-4 mt-1 text-sm text-zinc-500">
            Deletes the client, their {joint ? "keys" : "key"} and all their reports.
          </p>
          <ConfirmSubmit
            action={deleteClient.bind(null, client.id)}
            label="Delete client"
            confirmMessage={`Delete ${client.name} and all their reports? This can't be undone.`}
          />
        </section>
      </div>
    </>
  );
}
