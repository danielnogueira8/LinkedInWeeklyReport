"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { downloadPhoto, photoColumns, refreshAvatar } from "@/lib/avatars";
import { encrypt, ENCRYPTION_KEY_MISSING, encryptionReady } from "@/lib/crypto";
import { getClient, getReportWithClient } from "@/lib/data";
import { clients, db, profiles, reports, type ClientWithProfiles } from "@/lib/db";
import { LeadSharkError, otherKeyOwner, verifyApiKey } from "@/lib/leadshark";
import { normalizeProfileUrl } from "@/lib/linkedin";
import { lastFullWeek, resolvePeriod, type Period } from "@/lib/period";
import { generateReport } from "@/lib/report/generate";
import { defaultHighlights } from "@/lib/report/text";

// `fields` echoes submitted values back for forms with uncontrolled inputs: React
// resets a form after its action runs, so inputs use these as defaults.
export type FormState = { error?: string; message?: string; fields?: Record<string, string> } | undefined;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function all(formData: FormData, name: string) {
  return formData.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));
}

function describe(err: unknown) {
  if (err instanceof LeadSharkError) {
    if (!err.isAuthError) return err.message;
    return `LeadShark rejected ${err.creator ? `${err.creator}'s` : "this"} API key. Copy it again from LeadShark's settings.`;
  }
  if (err instanceof Error && err.message === ENCRYPTION_KEY_MISSING) return err.message;
  console.error(err);
  return "Something went wrong. Check the server logs for details.";
}

/** "Alex & Sam", "Alex, Sam & Jo" */
function joinNames(names: string[]) {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

type CreatorInput = { id: string; name: string; linkedinUrl: string; apiKey: string; photoLink: string };

/**
 * The client form posts one row per creator (creatorId/creatorName/creatorUrl/creatorKey,
 * plus creatorPhoto when editing, in order). One row is a solo report titled with the
 * creator's name; two or more are a joint report with an optional title.
 */
function readClientForm(formData: FormData, existingIds: Set<string>) {
  const ids = all(formData, "creatorId");
  const names = all(formData, "creatorName");
  const urls = all(formData, "creatorUrl");
  const keys = all(formData, "creatorKey");
  const photoLinks = all(formData, "creatorPhoto");
  const joint = ids.length > 1;
  const fail = (error: string) => ({ ok: false, error }) as const;

  if (ids.length === 0) return fail("Add at least one creator.");
  const creators: CreatorInput[] = [];
  for (const [index, id] of ids.entries()) {
    const label = joint ? `Creator ${index + 1}: ` : "";
    const linkedinUrl = normalizeProfileUrl(urls[index] ?? "");
    const apiKey = keys[index] ?? "";
    if (id && !existingIds.has(id)) return fail("That creator no longer exists. Reload the page and try again.");
    if (!names[index]) return fail(joint ? `${label}add their name.` : "Add the client's name.");
    if (!linkedinUrl) return fail(`${label}use a LinkedIn profile URL, like https://www.linkedin.com/in/alex-olim`);
    if (!apiKey && !id) return fail(`${label}paste their LeadShark API key.`);
    if (creators.some((creator) => creator.linkedinUrl === linkedinUrl)) {
      return fail("The same LinkedIn profile is in there twice.");
    }
    creators.push({ id, name: names[index], linkedinUrl, apiKey, photoLink: photoLinks[index] ?? "" });
  }

  const title = joint
    ? field(formData, "title") || joinNames(creators.map((creator) => creator.name))
    : creators[0].name;
  return { ok: true, title, creators } as const;
}

/**
 * Checks every newly pasted key with LeadShark, including that it reads this creator's
 * own posts. The error names the creator it belongs to.
 */
async function checkKeys(creators: CreatorInput[]): Promise<string | null> {
  if (creators.some((creator) => creator.apiKey) && !encryptionReady()) return ENCRYPTION_KEY_MISSING;
  const results = await Promise.all(
    creators.map(async (creator) => {
      if (!creator.apiKey) return null;
      let message: string | null = null;
      try {
        const other = otherKeyOwner(await verifyApiKey(creator.apiKey), creator);
        if (other) {
          message = `That key is ${other.name || other.handle}'s (linkedin.com/in/${other.handle}), not ${creator.linkedinUrl.replace(/^https:\/\/www\./, "")}. Copy the key from this creator's own LeadShark account, or fix the profile URL if it changed.`;
        }
      } catch (err) {
        message = describe(err);
      }
      return message && creators.length > 1 ? `${creator.name}: ${message}` : message;
    }),
  );
  return results.find(Boolean) ?? null;
}

/** Downloads any pasted photo links, in creator order. The error names whose link didn't work. */
async function fetchPhotos(creators: CreatorInput[]) {
  const photos = await Promise.all(
    creators.map((creator) => (creator.photoLink ? downloadPhoto(creator.photoLink) : null)),
  );
  const broken = creators.findIndex((creator, index) => creator.photoLink && !photos[index]);
  if (broken === -1) return { ok: true, photos } as const;
  const whose = creators.length > 1 ? `${creators[broken].name}: ` : "";
  return {
    ok: false,
    error: `${whose}That photo link didn't load a LinkedIn photo. On their profile, open the photo, right-click it and choose Copy image address.`,
  } as const;
}

function keyColumns(apiKey: string) {
  return { apiKeyEncrypted: encrypt(apiKey), apiKeyLast4: apiKey.slice(-4) };
}

async function tryGenerate(client: ClientWithProfiles, period: Period) {
  try {
    return { report: await generateReport(client, period) };
  } catch (err) {
    return { error: describe(err) };
  }
}

export async function createClient(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readClientForm(formData, new Set());
  if (!input.ok) return { error: input.error };
  const rejected = await checkKeys(input.creators);
  if (rejected) return { error: rejected };

  const client = await db().transaction(async (tx) => {
    const [created] = await tx.insert(clients).values({ name: input.title }).returning();
    const createdProfiles = await tx
      .insert(profiles)
      .values(
        input.creators.map((creator, position) => ({
          clientId: created.id,
          name: creator.name,
          linkedinUrl: creator.linkedinUrl,
          position,
          ...keyColumns(creator.apiKey),
        })),
      )
      .returning();
    return { ...created, profiles: createdProfiles };
  });

  // Start them off with last week's report. A failure here shouldn't block adding the client.
  await tryGenerate(client, lastFullWeek());
  redirect(`/clients/${client.id}`);
}

export async function updateClient(clientId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const existing = await getClient(clientId);
  if (!existing) return { error: "This client no longer exists." };
  const input = readClientForm(formData, new Set(existing.profiles.map((profile) => profile.id)));
  if (!input.ok) return { error: input.error };
  const [rejected, fetched] = await Promise.all([checkKeys(input.creators), fetchPhotos(input.creators)]);
  if (rejected) return { error: rejected };
  if (!fetched.ok) return { error: fetched.error };
  const { photos } = fetched;

  const keptIds = input.creators.map((creator) => creator.id).filter(Boolean);
  await db().transaction(async (tx) => {
    await tx.update(clients).set({ name: input.title, updatedAt: new Date() }).where(eq(clients.id, clientId));
    await tx
      .delete(profiles)
      .where(
        keptIds.length
          ? and(eq(profiles.clientId, clientId), notInArray(profiles.id, keptIds))
          : eq(profiles.clientId, clientId),
      );
    for (const [position, creator] of input.creators.entries()) {
      const values = { name: creator.name, linkedinUrl: creator.linkedinUrl, position };
      const pasted = photos[position] ? photoColumns(photos[position]) : null;
      if (creator.id) {
        const key = creator.apiKey ? keyColumns(creator.apiKey) : {};
        // A different profile means a different photo: clear it so it's looked up again below.
        const moved =
          existing.profiles.find((profile) => profile.id === creator.id)?.linkedinUrl !== creator.linkedinUrl;
        const photo =
          pasted ?? (moved ? { avatar: null, avatarType: null, avatarVersion: null, avatarCheckedAt: null } : {});
        await tx
          .update(profiles)
          .set({ ...values, ...key, ...photo })
          .where(and(eq(profiles.id, creator.id), eq(profiles.clientId, clientId)));
      } else {
        await tx.insert(profiles).values({ clientId, ...values, ...keyColumns(creator.apiKey), ...pasted });
      }
    }
  });

  // Anyone still without a photo gets a LeadShark lookup now, so the answer shows up here.
  const missing = (await getClient(clientId))?.profiles.filter((profile) => !profile.avatarVersion) ?? [];
  const found = await Promise.all(missing.map(refreshAvatar));
  const without = missing.filter((_, index) => !found[index]).map((profile) => profile.name);
  refresh();
  return {
    message: without.length
      ? `Saved. LeadShark didn't return a photo for ${joinNames(without)}. Paste a photo link to add one.`
      : "Saved.",
  };
}

export async function deleteClient(clientId: string) {
  await db().delete(clients).where(eq(clients.id, clientId));
  redirect("/");
}

export async function createReport(clientId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const fields = { period: field(formData, "period") };
  const period = resolvePeriod(fields.period);
  if (!period) return { error: "Pick a period.", fields };
  const client = await getClient(clientId);
  if (!client) return { error: "This client no longer exists." };

  const result = await tryGenerate(client, period);
  if (result.error) return { error: result.error, fields };
  redirect(`/reports/${result.report!.id}`);
}

export async function regenerateReport(reportId: string): Promise<FormState> {
  const report = await getReportWithClient(reportId);
  if (!report) return { error: "This report no longer exists." };

  const result = await tryGenerate(report.client, { start: report.periodStart, end: report.periodEnd });
  if (result.error) return { error: result.error };
  refresh();
  return { message: "Numbers refreshed from LeadShark." };
}

export async function saveHighlights(reportId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const report = await getReportWithClient(reportId);
  if (!report) return { error: "This report no longer exists." };

  // Browsers submit textarea newlines as CRLF.
  const text = field(formData, "highlights").replace(/\r\n?/g, "\n");
  // Saving the generated text unchanged keeps the report on auto mode.
  const override = text && text !== defaultHighlights(report.data) ? text : null;
  await db().update(reports).set({ highlightsOverride: override }).where(eq(reports.id, reportId));
  refresh();
  return { message: "Saved." };
}

export async function resetHighlights(reportId: string) {
  await db().update(reports).set({ highlightsOverride: null }).where(eq(reports.id, reportId));
  refresh();
}

export async function deleteReport(reportId: string) {
  const [deleted] = await db()
    .delete(reports)
    .where(eq(reports.id, reportId))
    .returning({ clientId: reports.clientId });
  redirect(deleted ? `/clients/${deleted.clientId}` : "/");
}
