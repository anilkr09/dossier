# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dossier is a self-hosted, single-user job application tracker: Next.js 16 (App Router) + React 19, Prisma 7 + PostgreSQL 18, Yarn 4, Tailwind 4. `DEVELOPMENT.md` is the detailed developer reference (sign-in, AI providers, job search, job agent, backups, usage ping, image); read the relevant section before changing one of those areas. `README.md` covers installing, `SECURITY.md` the security model, `PRIVACY.md` every outbound request the app makes.

## Commands

Nothing runs on the host: dependencies live in the `app` container's `node_modules` volume. Run yarn through `docker/bin/yarn`, which uses the running `app` container or a one-off one.

```bash
cp .env.example .env && docker compose build   # first time; set DOSSIER_PASSWORD (docker/bin/yarn hash-password) and DOSSIER_SECRET
docker compose up                              # dev server on :3000, source bind-mounted, hot reload

docker/bin/yarn lint
docker/bin/yarn typecheck                      # next typegen, then tsc --noEmit
docker/bin/yarn test                           # all Vitest projects once
docker/bin/yarn test:coverage                  # with the ratcheting thresholds in vitest.config.mts

# One file / one test / one project
docker/bin/yarn vitest run src/lib/status-changes.db.test.ts
docker/bin/yarn vitest run src/lib/dates.test.ts -t "name of the test"
docker/bin/yarn vitest run --project dom      # node | db | dom

# End-to-end (Playwright, against a production build)
docker/bin/yarn build && docker/bin/yarn test:e2e
docker/bin/yarn test:e2e e2e/agent.spec.ts

# Database
docker/bin/yarn prisma migrate dev --name <migration-name> && docker compose restart app   # restart regenerates the client
docker compose up -d studio                    # Prisma Studio on :5555
docker/bin/yarn prisma db seed -- --demo       # sample data (Jane Doe, nine applications)
```

Live tests against real AI providers or job boards are skipped unless `AI_LIVE` / `JOBS_LIVE` is set; `DEVELOPMENT.md` has the exact commands.

## Tests

Three Vitest projects, chosen by file name; put tests next to the code:

- `*.test.ts`: Node (server code, pure logic).
- `*.db.test.ts`: real Postgres, database `dossier_test` (or `TEST_DATABASE_URL`), migrated once per run by `src/test/db-global-setup.ts` and emptied by `resetDatabase()` from `src/test/db.ts`. Files run one at a time; they refuse any database not ending in `_test`. Postgres must be running (`docker compose up`).
- `*.test.tsx`: jsdom + Testing Library (`src/test/setup-dom.ts`).

`server-only` is aliased to an empty module in tests. AI calls are tested with `MockProvider` (`src/lib/ai/providers/mock.ts`) by mocking `getAiProvider` from `@/lib/ai`; outbound HTTP (job sources, Google, provider SDKs) with `stubFetch` from `src/lib/ai/test-http.ts`; job-source answers come from `src/test/job-search-fixtures.ts`. E2E runs its own server on :3100 with a `dossier_e2e` database and fake servers in `e2e/` (`fake-ai.mts` :3999, `fake-jobs.mts` :3998, `fake-google.mts` :3997) reached through the `DOSSIER_*_TEST_BASE_URL` variables. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests with coverage, and e2e; coverage thresholds only go up, so raise them when adding tests.

## Architecture

**Request path.** `src/proxy.ts` runs on every request: an optimistic cookie check that redirects to `/login`, and a per-request CSP nonce. It is not the security check; pages call `verifySession()`, and every mutation goes through one of two helpers that check the session themselves:
- `action(zodSchema, handler)` from `@/lib/action` for Server Actions (the default). Returns `{ ok, data, toast? } | { ok: false, error, fieldErrors? }`; throw `ActionError` for a message the user should see. Client code shows results with `toastResult()` from `@/components/toast`.
- `route()` from `@/lib/route` for route handlers, used only for what an action can't do: files (PDF, export), uploads over 1 MB, progress streams, the MCP endpoint. It also refuses cross-origin requests.

Screens live in `src/app/(app)/<screen>/`: a server `page.tsx` that loads data, a client screen component, and an `actions.ts`. Domain logic belongs in `src/lib`.

**Configuration.** Read `env` from `@/lib/env`, never `process.env`; the server refuses to start with a missing or invalid `DOSSIER_PASSWORD` (must be an `argon2id:` hash) or `DOSSIER_SECRET`. User settings are key-value rows read and written through `src/lib/settings-data.ts`; saved API keys are encrypted with keys derived from `DOSSIER_SECRET` (`src/lib/secrets.ts`).

**Data.** The Prisma client is generated into `src/generated/prisma` (import enums from `@/generated/prisma/enums`); query through the shared `prisma` from `@/lib/prisma`. JSON columns are validated with the zod schemas in `src/lib/application-data.ts` (a schemas-only file; `applications-data.ts`, `profile-data.ts` and `settings-data.ts` are the database loaders). A tailored document (resume, cover letter, email) is a list of **units** `{id, label, text}` whose id prefix says what it is (`experience:`, `paragraph:`, frame units like `sign-off`…; see `unit-text.ts`, `letter-frame.ts`). Change units through `updateDocuments()` in `src/lib/document-units.ts`, which retries on concurrent edits and records a `DocumentVersion`.

**Invariants that span files.**
- Change an application's status only through `setStatus` in `src/lib/status-actions.ts` (or `changeStatus()` on the client, which adds the Undo toast). It also approves a pending agent draft (`awaitingReview`).
- Lists of applications filter on `awaitingReview: false`, so agent drafts stay hidden until approved.
- Adding a table that holds user data means updating the export/import (`src/lib/data-export.ts`, `src/lib/data-import.ts`) and "delete everything" in `src/app/(app)/settings/actions.ts`; profile tables are also listed in `src/lib/profile-data.ts` and `src/lib/profile-import-apply.ts`.
- Any new outbound request belongs in `PRIVACY.md`'s table ("Nothing else is sent").

**Background jobs** (`src/lib/jobs`). In this codebase "job" means a background task; a job ad is a **posting**. Long AI work runs as a job: `defineJob({ type, input, result, run })`, started with `startJob()`, which stores a `Job` row and returns its id at once. An in-process queue runs it (1 at a time on a local model, 3 on hosted). `run()` names its steps with `context.step()`, and the page follows them over SSE (`/api/jobs/[id]/events`, `src/hooks/use-job.ts`). `run()` may be retried with the same input, so it must write idempotently. Job input and result hold personal data and are deleted by `retention.ts`, so nothing that must last belongs there.

**Single instance.** `src/instrumentation.ts` starts in-process timers on boot: recovering interrupted jobs, the job retention sweep, nightly backups, the Gmail inbox check, the job agent's daily run and the startups refresh. Run one app instance.

**AI** (`src/lib/ai`). `createProvider()` in `index.ts` returns an `AIProvider` for the configured backend (Ollama/llama.cpp, LM Studio, OpenAI-compatible, Anthropic, Mistral; Mock in tests); tasks never see which one. Each prompt is a `Task<I, O> = (provider, input, options)` in `src/lib/ai/tasks` that returns `{ data, promptVersion }`; the version is stored next to the result (`extractedWith`, `writtenWith`…). Posting text is treated as untrusted input (`prompt-parts.ts`). Where possible the model only classifies and code decides (e.g. `match-requirements.ts` computes covered/partial/gap from the profile). In strict mode ("Never invent experience", the default) a fact guard flags names and numbers not backed by the profile or posting.

**Other subsystems** (each with a `DEVELOPMENT.md` section where it has one):
- `src/lib/job-search`: Find jobs. One adapter per job source (JSearch, Adzuna, FreeHire, Arbeitsagentur) behind `index.ts` (country check, 30-minute cache, logging). Saved and dismissed postings are in `postings.ts`; kept searches in `posting-searches.ts`.
- `src/lib/agent`: the daily job agent. It scans a saved search, scores new postings (`AgentCandidate`) and drafts applications through `createApplicationFromDocuments()` in `src/lib/application-create.ts`, which New application uses too.
- `src/lib/startups`: Startups. It reads YC job posts (HN Firebase API) and "Ask HN: Who is hiring?" (HN Algolia API), then looks for contact addresses on the companies' own sites, respecting robots.txt.
- `src/lib/google`: Gmail and Calendar over OAuth: sending applications, syncing replies, interview events.
- `src/lib/connector` + `src/app/api/mcp`: the optional MCP server for Claude, with its own OAuth (`/api/oauth`).
- `src/lib/pdf`: PDFs are printed by Playwright's headless Chromium from the `src/app/print` pages.

## Git workflow

- This checkout is the fork `github.com/anilkr09/dossier` (`origin`); `upstream` is `github.com/AienTech/dossier`.
- When asked to commit, commit on `main` and push to `origin main`. Create a separate branch only when explicitly asked to.

## QUESTIONS.md

Whenever the user's message is a question ending with "?", answer it, then add the question and a concise version of the answer to `QUESTIONS.md` (newest first: a `##` heading with the question, the date in italics, then the answer with file references).

## Conventions

- Comments explain *why* and cite the plan item or issue they come from (`E7-2`, `NEW-3`, `#222`); match that style and the existing comment density.
- User-facing text (toasts, `ActionError`, job step names) is plain, complete sentences: "That application no longer exists."
- Wrap server-only modules with `import "server-only"`.
