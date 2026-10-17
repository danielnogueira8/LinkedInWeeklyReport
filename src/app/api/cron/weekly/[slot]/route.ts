// The two Sunday cron entries in vercel.json (/20 and /21, their UTC hours) need distinct
// paths; both run the same handler, which checks the local clock itself.
export { GET } from "../route";

export const maxDuration = 300;
