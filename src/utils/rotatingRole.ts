/**
 * The role names of the front page headline: picked at random on load and again on the hour. The mix is deliberate:
 * the roles everyone knows next to ones that are easy to underestimate (Directory Writers, Global Reader and the
 * Partner support roles are marked privileged in the Microsoft Learn permissions reference). The headline cannot break
 * inside the circled word, so the length is measured: 17 characters fit at 375 px, 21 fit from 640 px up.
 */
export const HEADLINE_ROLES = [
  "Global Admin",
  "Security Admin",
  "Exchange Admin",
  "Intune Admin",
  "User Admin",
  "Helpdesk Admin",
  "Password Admin",
  "Application Admin",
  "Cloud App Admin",
  "Directory Writers",
  "Global Reader",
  "Security Reader",
  "Security Operator",
] as const;

/** Longer names, only offered where the headline has room (from 640 px). */
export const WIDE_HEADLINE_ROLES = [
  "Privileged Role Admin",
  "Privileged Auth Admin",
  "Hybrid Identity Admin",
  "Authentication Admin",
  "Partner Tier2 Support",
] as const;

/** The first name is what the static HTML and the first render show. */
export const DEFAULT_HEADLINE_ROLE: string = HEADLINE_ROLES[0];

/** A random name that differs from `previous`; `random` returns a number in [0, 1). */
export function pickRole(roles: readonly string[], previous: string | null, random: () => number = Math.random): string {
  const candidates = roles.filter((role) => role !== previous);
  const pool = candidates.length > 0 ? candidates : roles;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Milliseconds until the next full hour (at least one second, so a timer never fires twice in the same hour). */
export function msUntilNextHour(now: Date): number {
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}
