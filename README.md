# LinkedIn Weekly Report

A mini CRM for the agency. Add a client with their name, LinkedIn profile URL and LeadShark API key. The app then pulls their LinkedIn numbers from LeadShark and builds a weekly performance report you can copy as text or download as a PDF.

```
Performance report · Alex Olim / Plutus Media
Mon 5 Oct to Mon 12 Oct 2026

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

- **Clients**: name, LinkedIn profile URL and LeadShark API key. The key is checked against LeadShark before it's saved, then stored encrypted (AES-256-GCM). Adding a client builds last week's report straight away.
- **Weekly reports**: a Vercel cron runs every Monday at 07:00 UTC and builds last week's report (Monday to Monday) for every client. You can also generate any of the last 8 weeks, this week so far, or a rolling 7 days from the client page.
- **What's counted**: every post the client published in the period, with its engagement as of when the report was generated. DMs come from the LeadShark automation attached to each post: first DMs (`total_dms_sent`) plus follow-ups (`total_follow_ups_sent`). Top posts are ranked by impressions.
- **Post dates**: read from the LinkedIn post id itself (the id embeds the publish time), so they're accurate whatever date fields the API returns.
- **"What worked best"**: auto-written from the numbers. Edit it on the report page (e.g. "The Bro teardown (#1) was the clear winner:") and the copy text and PDF both pick it up. "Refresh numbers" keeps your edit.
- **PDF**: rendered on the server with `@react-pdf/renderer`, with clickable post links.

### LeadShark endpoints used

Authenticated with the `x-api-key` header against `https://apex.leadshark.io` ([docs](https://apex.leadshark.io/docs/api)):

| Call                                | Used for                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/v1/posts?limit=&cursor=`  | The client's own posts and engagement (impressions, reactions, comments, reposts) |
| `GET /api/automations?page=&limit=` | DM stats per automation, matched to posts by `automation_id` or post URL          |

The client's API key must be for **their** LeadShark account. LinkedIn only shows impressions to the post's author.

## Local development

Requires Node 20.9+ and a Postgres database (a [Neon](https://neon.tech) dev branch or a local Postgres).

```bash
cp .env.example .env.local   # then fill in DATABASE_URL and ENCRYPTION_KEY
npm install
npm run db:migrate
npm run dev
```

| Command                              | What it does                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm test`                           | Unit tests (report maths and text format, LeadShark parsing, periods, encryption, PDF) |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript                                                                  |
| `npm run db:generate`                | New migration after changing `src/lib/db/schema.ts`                                    |
| `npm run format`                     | Prettier                                                                               |

## Deploying to Vercel + Neon

1. Import the repo into Vercel.
2. Add the Neon integration (Storage → Neon). It sets `DATABASE_URL`.
3. Add environment variables:
   - `ENCRYPTION_KEY`: `openssl rand -base64 32`. Keep it stable: changing it makes saved API keys unreadable.
   - `CRON_SECRET`: `openssl rand -base64 32`. Vercel sends it to the cron route automatically.
   - `REPORT_TIMEZONE`: e.g. `Europe/London`. Decides where weeks start and which weekday a post lands on. Defaults to UTC.
   - `AGENCY_NAME` (optional): shown in the header and the PDF footer.
4. Deploy. The `vercel-build` script runs migrations before `next build`, and `vercel.json` registers the Monday cron.

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
