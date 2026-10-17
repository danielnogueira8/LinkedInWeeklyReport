import { eq } from "drizzle-orm";
import { isUuid } from "@/lib/data";
import { db, profiles } from "@/lib/db";

// Serves a creator's stored LinkedIn photo. The URL carries ?v=<avatarVersion>, so it can be cached forever.
export async function GET(_request: Request, ctx: RouteContext<"/avatars/[profileId]">) {
  const { profileId } = await ctx.params;
  if (!isUuid(profileId)) return new Response("Not found", { status: 404 });

  const [row] = await db()
    .select({ avatar: profiles.avatar, avatarType: profiles.avatarType })
    .from(profiles)
    .where(eq(profiles.id, profileId));
  if (!row?.avatar) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(row.avatar), {
    headers: {
      "Content-Type": row.avatarType ?? "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
