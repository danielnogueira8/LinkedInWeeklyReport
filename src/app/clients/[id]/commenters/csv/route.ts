import { commentersCsv, listCommenters, parseView } from "@/lib/commenters/list";
import { getClient } from "@/lib/data";
import { localDate, reportTimezone } from "@/lib/period";

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-");
}

/** Every commenter in the view, best first, as a spreadsheet. */
export async function GET(request: Request, ctx: RouteContext<"/clients/[id]/commenters/csv">) {
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) return new Response("Client not found", { status: 404 });
  const view = parseView(new URL(request.url).searchParams.get("view"));

  const { commenters } = await listCommenters(client, view);
  const timezone = reportTimezone();
  const span = view === "week" ? "last-7-days" : "all-time";
  const filename = `commenters-${slug(client.name) || "client"}-${span}-${localDate(new Date(), timezone)}.csv`;
  return new Response(commentersCsv(commenters, timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
