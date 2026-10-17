"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { encrypt, ENCRYPTION_KEY_MISSING, encryptionReady } from "@/lib/crypto";
import { getClient, getReportWithClient } from "@/lib/data";
import { clients, db, reports, type Client } from "@/lib/db";
import { LeadSharkError, verifyApiKey } from "@/lib/leadshark";
import { normalizeProfileUrl } from "@/lib/linkedin";
import { lastFullWeek, resolvePeriod, type Period } from "@/lib/period";
import { generateReport } from "@/lib/report/generate";
import { defaultHighlights } from "@/lib/report/text";

// `fields` echoes the submitted values back: React resets a form after its
// action runs, so inputs use these as defaults to survive a failed submit.
export type FormState = { error?: string; message?: string; fields?: Record<string, string> } | undefined;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function describe(err: unknown) {
  if (err instanceof LeadSharkError) {
    return err.isAuthError ? "LeadShark rejected this API key. Copy it again from LeadShark's settings." : err.message;
  }
  if (err instanceof Error && err.message === ENCRYPTION_KEY_MISSING) return err.message;
  console.error(err);
  return "Something went wrong. Check the server logs for details.";
}

function readClientForm(formData: FormData, { requireKey }: { requireKey: boolean }) {
  const fields = {
    name: field(formData, "name"),
    linkedinUrl: field(formData, "linkedinUrl"),
    apiKey: field(formData, "apiKey"),
  };
  const linkedinUrl = normalizeProfileUrl(fields.linkedinUrl);
  const invalid = (error: string) => ({ ok: false, state: { error, fields } }) as const;

  if (!fields.name) return invalid("Add the client's name.");
  if (!linkedinUrl) return invalid("Use a LinkedIn profile URL, like https://www.linkedin.com/in/alex-olim");
  if (requireKey && !fields.apiKey) return invalid("Paste the client's LeadShark API key.");
  return { ok: true, name: fields.name, linkedinUrl, apiKey: fields.apiKey, fields } as const;
}

async function checkKey(apiKey: string, fields: Record<string, string>): Promise<FormState> {
  if (!encryptionReady()) return { error: ENCRYPTION_KEY_MISSING, fields };
  try {
    await verifyApiKey(apiKey);
  } catch (err) {
    return { error: describe(err), fields: { ...fields, apiKey: "" } };
  }
}

function keyColumns(apiKey: string) {
  return { apiKeyEncrypted: encrypt(apiKey), apiKeyLast4: apiKey.slice(-4) };
}

async function tryGenerate(client: Client, period: Period) {
  try {
    return { report: await generateReport(client, period) };
  } catch (err) {
    return { error: describe(err) };
  }
}

export async function createClient(_prev: FormState, formData: FormData): Promise<FormState> {
  const input = readClientForm(formData, { requireKey: true });
  if (!input.ok) return input.state;
  const rejected = await checkKey(input.apiKey, input.fields);
  if (rejected) return rejected;

  const [client] = await db()
    .insert(clients)
    .values({ name: input.name, linkedinUrl: input.linkedinUrl, ...keyColumns(input.apiKey) })
    .returning();

  // Start them off with last week's report. A failure here shouldn't block adding the client.
  await tryGenerate(client, lastFullWeek());
  redirect(`/clients/${client.id}`);
}

export async function updateClient(clientId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const input = readClientForm(formData, { requireKey: false });
  if (!input.ok) return input.state;
  if (input.apiKey) {
    const rejected = await checkKey(input.apiKey, input.fields);
    if (rejected) return rejected;
  }

  await db()
    .update(clients)
    .set({
      name: input.name,
      linkedinUrl: input.linkedinUrl,
      ...(input.apiKey ? keyColumns(input.apiKey) : {}),
      updatedAt: new Date(),
    })
    .where(eq(clients.id, clientId));
  refresh();
  return { message: "Saved." };
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
