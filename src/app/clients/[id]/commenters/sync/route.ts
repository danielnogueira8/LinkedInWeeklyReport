import { parseView } from "@/lib/commenters/list";
import { syncCommenters } from "@/lib/commenters/sync";
import { getClient } from "@/lib/data";
import { LeadSharkError } from "@/lib/leadshark";

// One round of pulling comments and scoring commenters. The page calls it again until it
// reports done: a creator's whole history can take several rounds.
export const maxDuration = 300;

// Stop starting new work well inside maxDuration (a scoring call can take up to 90s).
const BUDGET_MS = 240_000;

export async function POST(request: Request, ctx: RouteContext<"/clients/[id]/commenters/sync">) {
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return Response.json({ error: "This client no longer exists." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);
  const view = parseView(typeof body === "object" && body !== null ? (body as { view?: unknown }).view : null);

  try {
    return Response.json(await syncCommenters(client, view, Date.now() + BUDGET_MS));
  } catch (err) {
    if (err instanceof LeadSharkError) {
      const whose = client.profiles.length > 1 ? " for one of the creators" : "";
      return Response.json(
        { error: err.isAuthError ? `LeadShark rejected the API key${whose}.` : err.message },
        { status: 502 },
      );
    }
    console.error("Commenter sync failed", err);
    return Response.json({ error: "Something went wrong. Check the server logs for details." }, { status: 500 });
  }
}
