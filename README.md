# LinkedIn Weekly Report

A mini CRM for the agency. Add a client with their name, LinkedIn profile URL and LeadShark API key. The app then pulls their LinkedIn numbers from LeadShark and builds a weekly performance report you can copy as text or download as a PDF.

```
Performance report · Alex Olim / Plutus Media
Sun 4 Oct to Sun 11 Oct 2026

Impressions: 47,090
Reactions: 194
Comments: 416
Reposts: 9
DMs sent: 251 (198 first DMs + 53 follow-ups)

Top 3 posts:

1. Mon · 35,814 impressions · 122 reactions · 367 comments · 136 DMs
https://www.linkedin.com/posts/...

What worked best
Monday's post (#1) was the clear winner:
- 35,814 impressions, about 5x an average post this week
- 367 comments
- 136 DMs sent so far, and still going.
```

## How it works

- **Clients**: name, LinkedIn profile URL and LeadShark API key. Add two or more creators (each with their own profile and key) to make a **joint report**: totals are combined, a "By creator" breakdown is added, and each top post says who wrote it. Creators, keys and photos can be changed later on the client's **Settings** page, which shows the last four characters of each saved key. A key is checked against LeadShark before it's saved, including that its posts are that creator's (so a key copied from the wrong account is refused), then stored encrypted (AES-256-GCM). Adding a client builds a report for the last 7 days straight away.
- **Weekly reports**: a report always covers the 7 days up to when it's built, so one built on a Sunday runs from last Sunday to now. Every Sunday at 21:00 in `REPORT_TIMEZONE` (Lisbon by default), a Vercel cron builds each client's report, so the Sunday reports run back to back, 21:00 to 21:00. **Generate report** on the client page does the same at any time. Each report belongs to the week ending on the Sunday on or after its last day; building again in the same week moves that week's report on to the new 7 days instead of adding another, and **Refresh numbers** on a report updates it for its own dates. The weekly chart and week-on-week changes take one report per week, the latest built. Reports list newest week first. Reports built before this run midnight to midnight (Monday to Monday): they still open, count for the week ending on their last Sunday, and are never overwritten; one built before its week ended is marked **Partial week**.
- **Why two crons**: Vercel crons run on UTC and Lisbon moves between UTC+0 and UTC+1, so `vercel.json` schedules Sunday 20:00 and 21:00 UTC and the handler only does the work in the run that lands at 21:xx local time. Changing `REPORT_TIMEZONE` to a zone far from UTC means updating those two UTC hours. `GET /api/cron/weekly?force=1` (with the `CRON_SECRET` bearer token) runs it immediately.
- **What's counted**: every post the client published in the period, with its engagement as of when the report was generated. LeadShark reads the creator's whole LinkedIn feed, not just posts made through LeadShark. Reposts are left out, including reposts of a co-creator's posts on a joint report: a post counts for whoever wrote it, which the post's link names. DMs come from the LeadShark automation attached to each post: first DMs (`total_dms_sent`) plus follow-ups (`total_follow_ups_sent`). Top posts are ranked by impressions.
- **Wrong keys**: if a saved key's posts belong to someone else, the report says so in its warnings.
- **What LeadShark returned**: each report keeps, per creator, every post LeadShark sent for the period, whether it was counted and why not (a repost, someone else's post, counted for the co-creator), plus how far back the feed reached. Open it at the bottom of the report and compare it with the creator's LinkedIn activity page.
- **Post dates**: read from the LinkedIn post id itself (the id embeds the publish time), so they're accurate whatever date fields the API returns.
- **Profile photos**: stored in the database (LinkedIn's image links expire) and served from `/avatars/<id>`. The app refreshes each creator's photo about weekly (alongside report builds, or in the background after a page view), retrying every 6 hours while it has none. LeadShark has no REST profile lookup, but every post carries its author's `profile_picture_url`, so the photo comes from the creator's own latest post. When they have none recently, paste the photo's link in Settings: on LinkedIn, open their photo, right-click it and choose Copy image address. Until then, initials show.
- **"What worked best"**: auto-written from the numbers. Edit it on the report page (e.g. "The Bro teardown (#1) was the clear winner:") and the copy text and PDF both pick it up. "Refresh numbers" keeps your edit.
- **PDF**: rendered on the server with `@react-pdf/renderer`, with clickable post links.

### LeadShark endpoints used

Authenticated with the `x-api-key` header against `https://apex.leadshark.io` ([docs](https://apex.leadshark.io/docs/api)):

| Call                                | Used for                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/v1/posts?limit=&cursor=`  | The client's own posts and engagement (impressions, reactions, comments, reposts), and their photo |
| `GET /api/automations?page=&limit=` | DM stats per automation, matched to posts by `automation_id` or post URL                           |

The client's API key must be for **their** LeadShark account. LinkedIn only shows impressions to the post's author.

## Local development

Requires Node 20.9+ and a Postgres database (a [Neon](https://neon.tech) dev branch or a local Postgres).

```bash
cp .env.example .env.local   # then fill in DATABASE_URL and ENCRYPTION_KEY
npm install
npm run db:migrate
npm run dev
```

| Command                                           | What it does                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm test`                                        | Unit tests (report maths and text format, LeadShark parsing, periods, encryption, PDF)                   |
| `npm run lint` / `npm run typecheck`              | ESLint and TypeScript                                                                                    |
| `npm run db:generate`                             | New migration after changing `src/lib/db/schema.ts`                                                      |
| `npm run format`                                  | Prettier                                                                                                 |
| `node scripts/leadshark-probe.mjs <handle>=<key>` | Prints what LeadShark returns for a creator: every post in their feed, paging behaviour, photo endpoints |

## Deploying to Vercel + Neon

1. Import the repo into Vercel.
2. Add the Neon integration (Storage → Neon). It sets `DATABASE_URL`.
3. Add environment variables:
   - `ENCRYPTION_KEY`: `openssl rand -base64 32`. Keep it stable: changing it makes saved API keys unreadable.
   - `CRON_SECRET`: `openssl rand -base64 32`. Vercel sends it to the cron route automatically.
   - `REPORT_TIMEZONE`: `Europe/Lisbon`. Decides when the Sunday 21:00 run happens, where weeks start, which weekday a post lands on and the times shown in the app. Defaults to `Europe/Lisbon`, so it can be left unset.
   - `AGENCY_NAME` (optional): shown in the header and the PDF footer.
4. Deploy. The `vercel-build` script runs migrations before `next build`, and `vercel.json` registers the Sunday crons.

You can deploy before the database exists: the build skips migrations when `DATABASE_URL` isn't set, and pages show a "connect the database" message. Once Neon is connected, redeploy so the tables get created.

> **There's no login.** Anyone with the deployment URL can see clients and reports. Turn on Vercel's Deployment Protection, or add auth before sharing the URL.

## Project layout

```
src/app/                    pages, server actions, PDF route, cron route
src/components/             client components (forms, copy button, editor)
src/lib/leadshark.ts        LeadShark API client and response normalizing
src/lib/linkedin.ts         post id parsing and timestamp decoding
src/lib/period.ts           week maths and date labels (timezone aware)
src/lib/report/             build (aggregation), text, pdf, generate (fetch + save)
src/lib/db/                 Drizzle schema and connection
drizzle/                    SQL migrations
```
