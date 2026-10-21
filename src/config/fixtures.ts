/**
 * Fixture routes under src/app/dev (files named `page.fixture.tsx`) exist only in a build with this flag: `next.config.ts`
 * adds the `fixture.tsx` page extension then, and `AppProviders` renders them without sign-in.
 */
export const FIXTURES_ENABLED = process.env.NEXT_PUBLIC_FIXTURES === "1";
export const FIXTURE_PATH_PREFIX = "/dev/";
