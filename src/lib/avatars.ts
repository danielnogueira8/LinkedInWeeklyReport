import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db, profiles, type Profile } from "@/lib/db";
import { findProfilePicture } from "@/lib/leadshark";

// LinkedIn photo links expire after a few weeks, so the image itself is stored and
// refreshed about weekly (each lookup reads a page of the creator's posts from LeadShark).
// A lookup that found nothing is tried again sooner.
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_BYTES = 3 * 1024 * 1024;

export type Photo = { bytes: Buffer; type: string };

export function avatarIsStale(profile: Pick<Profile, "avatarCheckedAt" | "avatarVersion">, now = Date.now()) {
  if (!profile.avatarCheckedAt) return true;
  return now - profile.avatarCheckedAt.getTime() > (profile.avatarVersion ? REFRESH_AFTER_MS : RETRY_AFTER_MS);
}

/** Downloads a LinkedIn photo. Anything else (or anything that isn't an image) gives null. */
export async function downloadPhoto(link: string): Promise<Photo | null> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  // Locally, and against a mock LeadShark, any http(s) image will do.
  const testing = process.env.NODE_ENV !== "production" || Boolean(process.env.LEADSHARK_API_URL);
  const linkedin = url.protocol === "https:" && /(^|\.)licdn\.com$/i.test(url.hostname);
  if (!linkedin && !(testing && /^https?:$/.test(url.protocol))) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? { bytes, type } : null;
  } catch {
    return null;
  }
}

/** The profile columns that store a photo. */
export function photoColumns(photo: Photo, now = new Date()) {
  return { avatar: photo.bytes, avatarType: photo.type, avatarVersion: now, avatarCheckedAt: now };
}

/**
 * Looks the creator up on LeadShark and stores their photo. Returns whether it found one.
 * Never throws; photos are optional.
 */
export async function refreshAvatar(profile: Pick<Profile, "id" | "name" | "linkedinUrl" | "apiKeyEncrypted">) {
  const now = new Date();
  try {
    const url = await findProfilePicture(decrypt(profile.apiKeyEncrypted), profile.linkedinUrl);
    const photo = url ? await downloadPhoto(url) : null;
    await db()
      .update(profiles)
      .set(photo ? photoColumns(photo, now) : { avatarCheckedAt: now })
      .where(eq(profiles.id, profile.id));
    return Boolean(photo);
  } catch (err) {
    console.warn(`Couldn't refresh the profile photo for ${profile.name}`, err);
    return false;
  }
}

export async function refreshStaleAvatars(list: Profile[]) {
  await Promise.all(list.filter((profile) => avatarIsStale(profile)).map(refreshAvatar));
}

/** Fills in missing or week-old photos for any client, a few at a time. Runs after page responses. */
export async function refreshAvatarsInBackground() {
  try {
    const now = Date.now();
    const stale = or(
      isNull(profiles.avatarCheckedAt),
      and(isNotNull(profiles.avatarVersion), lt(profiles.avatarCheckedAt, new Date(now - REFRESH_AFTER_MS))),
      and(isNull(profiles.avatarVersion), lt(profiles.avatarCheckedAt, new Date(now - RETRY_AFTER_MS))),
    );
    // Claim the rows first (stamping the check time) so overlapping requests don't look up the same creator twice.
    const claimed = await db()
      .update(profiles)
      .set({ avatarCheckedAt: new Date(now) })
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
