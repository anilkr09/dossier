# Questions

Questions asked about this codebase and its setup, with their answers. Newest at the bottom.

## What does "Unable to find image 'ghcr.io/aientech/dossier:latest' locally" mean?

_2026-10-30_

Not an error. `docker run` prints it when the image isn't on the machine yet, then pulls it from the registry before running. The published image is about 1.7 GB.

## Are we building the image or downloading it?

_2026-10-30_

At first, downloading: `ghcr.io/aientech/dossier` is prebuilt by upstream and only amd64, so it runs under emulation on Apple Silicon. Now it's built from this fork's `Dockerfile` (`production` target) as `dossier:local`, a native arm64 image:

```bash
docker buildx build --load --target production -t dossier:local .
```

The `Dockerfile` uses `RUN --mount`, so it needs BuildKit (`docker buildx`); the legacy builder can't build it.

## Where does Dossier fetch startup job listings from?

_2026-10-30_

Two free public Hacker News APIs, no key needed, called from `src/lib/startups/refresh.ts` on **Refresh** and once a day while the Startups screen is in use:

| Source | Fetches from | What it reads |
|---|---|---|
| YC (`src/lib/startups/sources/yc.ts`) | `https://hacker-news.firebaseio.com/v0` (HN's official API) | YC companies' job posts on HN ("Acme (YC W24) Is Hiring…"); company and batch come from the title |
| HN (`src/lib/startups/sources/hn.ts`) | `https://hn.algolia.com/api/v1/…` (HN's Algolia search) | The monthly "Ask HN: Who is hiring?" threads; keeps only posts local to the profile's city or country, or remote without a place restriction |

After that, for the 12 best-scoring new matches it reads the company's own site (`robots.txt` first, then a few public pages) to find addresses to apply to (`lookUpStartup` in `src/lib/startups/store.ts`). It identifies itself as `Dossier`, so sites can opt out in `robots.txt`. Tests point all of this at a fake server with `DOSSIER_JOBS_TEST_BASE_URL` (`testAddress` in `src/lib/startups/http.ts`).

## How does "Reading the posting…" on New application work?

_2026-10-30_

It's the `read-posting` background job (`src/lib/jobs/read-posting.ts`). It makes up to two AI calls and saves nothing.

1. `startReadingPosting` (`src/app/(app)/new/actions.ts`) stores a QUEUED `Job` row and returns its id immediately.
2. The page follows it over SSE (`/api/jobs/<id>/events`, `src/hooks/use-job.ts`); progress lives in the `Job` table, so a reload picks it up again.
3. The in-process queue (`src/lib/jobs/runner.ts`) runs it, one job at a time on a local model, three on a hosted one.

| Step on screen | What runs |
|---|---|
| Reading the posting | Loads the AI provider, writing settings and profile; no AI call |
| Picking out the role, company and requirements | `extractPosting` (`src/lib/ai/tasks/extract-posting.ts`): title, company, role, location, work mode, salary, deadline, language, whether references are asked for, and typed requirements (years / language / skill / other). Asks once more if a small model returns no title, company or role |
| Comparing it with your profile | `matchRequirements` (`src/lib/ai/tasks/match-requirements.ts`): the model only says which profile skill or language each requirement is about; code decides covered / partial / gap. "N years" requirements are computed from experience dates with no AI call |

"This can take a little longer on a local model" is always shown while the job runs. The result waits in the job row for the review screen; the next job (`writeDocumentsJob`) writes the documents, and only `createApplication` saves the Application.

## Do we still have the architecture review report?

_2026-10-31_

No. The `/improve-codebase-architecture` run on 2026-10-30 wrote it to the macOS temp folder (`$TMPDIR/architecture-review-20261030-201837.html`, under `/var/folders/…/T/`) so it wouldn't land in the repo, and macOS clears that folder, so the file is gone. Its seven candidates were: make the status change module the only way in (top recommendation; the Gmail send path skips the "approve a pending agent draft" rule), one Document module for units, trimmed parts and versions, one home for unit kinds, application creation, one setup for background jobs and one posting-scoring path, one description per profile section, and shared fetch / HTML-to-text code. It was recreated, unchanged, at `docs/architecture-review.html`.
