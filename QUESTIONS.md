# Questions

Questions asked about this codebase, with their answers, newest first.

## How does the "Reading the posting…" flow work?

*2026-10-30*

It's the `read-posting` background job on **New application**: up to two AI calls, nothing saved.

1. `startReadingPosting` (`src/app/(app)/new/actions.ts`) stores a `Job` row and returns its id at once.
2. The page follows the job's steps over SSE (`/api/jobs/[id]/events`, `src/hooks/use-job.ts`). Progress lives in the `Job` table, so a reload picks it up again.
3. The in-process queue (`src/lib/jobs/runner.ts`) runs it, one job at a time on a local model and up to 3 on a hosted one.
4. `readPostingJob` (`src/lib/jobs/read-posting.ts`) names three steps:

| Step | What runs |
|---|---|
| Reading the posting | Loads the AI provider, writing settings and profile. No AI call. |
| Picking out the role, company and requirements | `extractPosting` (`src/lib/ai/tasks/extract-posting.ts`): title, company, role, location, mode, salary, deadline, language, asks-for-references, and typed requirements (years / language / skill / other). Asks once more if a small model returns no title, company or role. |
| Comparing it with your profile | `matchRequirements` (`match-requirements.ts`): the model only names which profile skill or language each requirement is about; code decides covered / partial / gap. "N+ years" is computed from experience dates without AI. |

"This can take a little longer on a local model" always shows while a job runs. The result waits in the job row; `writeDocumentsJob` then writes the documents, and only `createApplication` saves the Application.
