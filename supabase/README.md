# Supabase — database & migrations

The **same** cloud Supabase project backs local dev and production (per the
project constitution). There is no local Postgres. All schema changes are SQL
migration files in [`migrations/`](./migrations), applied with the Supabase CLI.

The CLI ships as a workspace dev dependency — run it via `pnpm supabase …` (or
`npx supabase …`) from the repo root.

## One-time setup

```bash
# 1. Log in to the Supabase CLI (opens a browser)
pnpm supabase login

# 2. Link this repo to the cloud project (grab <project-ref> from the
#    dashboard URL: app.supabase.com/project/<project-ref>).
#    You'll be prompted for the database password.
pnpm supabase link --project-ref <project-ref>
```

The linked ref is stored in `supabase/.temp/` (gitignored), so linking is a
per-machine step.

## Applying migrations

```bash
# Push all pending migrations to the linked cloud project.
pnpm supabase db push
```

Migrations run in filename order (`0001_…`, `0002_…`, …). Each file is applied
once; the CLI tracks applied migrations in the cloud project's
`supabase_migrations.schema_migrations` table.

### Adding a new migration

```bash
pnpm supabase migration new <name>   # creates migrations/<timestamp>_<name>.sql
# ...write SQL, then:
pnpm supabase db push
```

Keep migrations **forward-only and idempotent-friendly**; never edit a migration
that has already been pushed — add a new one.

## Migration map

| File | Contents |
| --- | --- |
| `0001_extensions.sql` | `pgcrypto`, `vector` (in the `extensions` schema) |
| `0002_types_and_helpers.sql` | all enum types, `set_updated_at()`, `i18n_complete()` |
| `0003_users_profile.sql` | `users_profile` |
| `0004_syllabus_nodes.sql` | `syllabus_nodes` (self-referencing syllabus tree) |
| `0005_questions.sql` | `questions` (+ publish-gate generated column & trigger) |
| `0006_tests.sql` | `tests`, `test_questions` |
| `0007_attempts.sql` | `attempts`, `attempt_answers` |
| `0008_answer_submissions_evaluations.sql` | `answer_submissions`, `evaluations` |
| `0009_current_affairs.sql` | `current_affairs_items` |
| `0010_srs.sql` | `srs_cards`, `srs_reviews` (FSRS) |
| `0011_study_plans_doubts.sql` | `study_plans`, `doubt_threads`, `doubt_messages` |
| `0012_embeddings_events.sql` | `embeddings` (pgvector + HNSW), `events` |
| `0013_dev_permissive_rls.sql` | **RLS on + wide-open dev policies — replaced in Session 15** |
| `0014_seed_dev_user.sql` | fixed-uuid dev user seed |

## Conventions

### Bilingual content (`_i18n`)

Every human-facing string column is **JSONB** shaped `{"hi": "...", "en": "..."}`
and named with a **`_i18n` suffix** (`title_i18n`, `stem_i18n`, `summary_i18n`, …).
Hindi and English are equal-first; `hi` is the default locale. There are **no**
paired `*_hi` / `*_en` columns.

Nested/rich content keeps i18n at the leaf, e.g. MCQ options:

```json
[{ "key": "A", "text_i18n": { "hi": "…", "en": "…" } }]
```

### Publish gate

A row is publishable only when its core bilingual content has **both** a
non-blank `hi` and a non-blank `en`. This is encoded by the immutable helper
`public.i18n_complete(jsonb)`:

- `questions.publish_gate_ok` is a **STORED generated column** = `i18n_complete(stem_i18n)`.
- A `BEFORE INSERT/UPDATE` trigger raises if `is_published = true` while the gate
  is false, so you cannot publish a half-translated question.

### RLS

RLS is **enabled on all tables**. During the pre-auth phase the only policies are
the wide-open dev policies in `0013_dev_permissive_rls.sql`
(`using (true) / with check (true)` for `anon` + `authenticated`). These are
replaced with strict per-user `auth.uid()` policies in the Auth phase (Session 15).

### Dev user

Until auth exists, the API acts as the seeded dev user
(`00000000-0000-4000-8000-000000000001`). Set `DEV_USER_ID` in `apps/api/.env` to
this value.

## Verifying the schema

After `db push`, confirm every table exists using the service-role key:

```bash
pnpm --filter api exec tsx scripts/verify-schema.ts   # (see apps/api/scripts)
```

The script connects with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from
`apps/api/.env` and selects `count` from each expected table.
