import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db, profiles, type Profile } from "@/lib/db";
import { findProfilePicture } from "@/lib/leadshark";

// LinkedIn photo links expire after a few weeks, so the image itself is stored and
// refreshed about weekly (each lookup is a real profile view on the creator's account).
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;

export function avatarIsStale(profile: Pick<Profile, "avatarCheckedAt">, now = Date.now()) {
  return !profile.avatarCheckedAt || now - profile.avatarCheckedAt.getTime() > REFRESH_AFTER_MS;
}

async function download(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  const parsed = new URL(url);
  // Plain http only for local testing against a mock LeadShark.
  const allowHttp = process.env.NODE_ENV !== "production" || Boolean(process.env.LEADSHARK_API_URL);
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) return null;
  const res = await fetch(parsed, { signal: AbortSignal.timeout(15_000) });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length > 0 && bytes.length <= MAX_BYTES ? { bytes, type } : null;
}

/** Looks the creator up on LeadShark and stores their photo. Never throws; photos are optional. */
export async function refreshAvatar(profile: Pick<Profile, "id" | "name" | "linkedinUrl" | "apiKeyEncrypted">) {
  const now = new Date();
  try {
    const url = await findProfilePicture(decrypt(profile.apiKeyEncrypted), profile.linkedinUrl);
    const image = url ? await download(url) : null;
    await db()
      .update(profiles)
      .set(
        image
          ? { avatar: image.bytes, avatarType: image.type, avatarVersion: now, avatarCheckedAt: now }
          : { avatarCheckedAt: now },
      )
      .where(eq(profiles.id, profile.id));
  } catch (err) {
    console.warn(`Couldn't refresh the profile photo for ${profile.name}`, err);
  }
}

export async function refreshStaleAvatars(list: Profile[]) {
  await Promise.all(list.filter((profile) => avatarIsStale(profile)).map(refreshAvatar));
}

/** Fills in missing or week-old photos for any client, a few at a time. Runs after page responses. */
export async function refreshAvatarsInBackground() {
  try {
    const stale = or(
      isNull(profiles.avatarCheckedAt),
      lt(profiles.avatarCheckedAt, new Date(Date.now() - REFRESH_AFTER_MS)),
    );
    // Claim the rows first (stamping the check time) so overlapping requests don't look up the same creator twice.
    const claimed = await db()
      .update(profiles)
      .set({ avatarCheckedAt: new Date() })
      .where(and(stale, inArray(profiles.id, db().select({ id: profiles.id }).from(profiles).where(stale).limit(10))))
      .returning({
        id: profiles.id,
        name: profiles.name,
        linkedinUrl: profiles.linkedinUrl,
        apiKeyEncrypted: profiles.apiKeyEncrypted,
      });
    await Promise.all(claimed.map(refreshAvatar));
  } catch (err) {
    console.warn("Background photo refresh failed", err);
  }
}
