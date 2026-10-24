# Luma · healthcare risk workspace

This repository is the new Luma project. The previous `MY-HealthChain` project was used as a reference and is kept separate.

## Project layout

- `frontend/` — browser app, styles, and entry HTML.
- `backend/supabase/` — Supabase configuration and database migrations.
- `package.json`, `package-lock.json`, and `vite.config.js` — root-level commands so setup stays straightforward.
- `.env.example` — names of the public browser settings to copy into your local `.env` file.

## Run locally

1. Install Node.js 20 or newer.
2. From the project root, run `npm install`.
3. Copy `.env.example` to `.env` and add the Supabase project URL and publishable/anon key. Never put a service-role key or database password in frontend environment variables.
4. Apply the SQL migrations in `backend/supabase/migrations/` to your Supabase project, in filename order. You can paste each file into Supabase SQL Editor.
5. Run `npm run dev` and open `http://localhost:3000`.

Friends can follow these steps after cloning the repository. The committed lock file keeps dependency versions consistent. `.env` and generated files are ignored by Git.

## Supabase Auth and OAuth

- Patients use one form: existing accounts sign in; a new email creates a patient account automatically. New accounts need a password of at least 8 characters. An existing account with a wrong password still fails login; its password is never replaced. Admin accounts cannot be created through this form.
- In Supabase Authentication → Sign In / Providers, enable the Email provider. Under User Signups, turn off Confirm email for immediate registration and login. Disabling the Email provider disables email login altogether. If confirmation is enabled later, the form asks new users to check their email before signing in.
- Google and GitHub buttons use Supabase OAuth; enable each provider in the dashboard before using it. Google already creates an account on the first successful OAuth sign-in.
- Email confirmation controls whether email/password accounts must confirm an email. It does not create `public.profiles` rows. The initial migration adds a trigger for new accounts; the profile-repair migration backfills older Auth users and adds a self-repair function for accounts missing a profile.
- In Supabase Auth URL settings, allow `http://localhost:3000/dashboard` and the deployed site's `/dashboard` callback. Configure each provider's callback as `https://<project-ref>.supabase.co/auth/v1/callback` in the provider console. Production hosting must route `/dashboard` to the frontend `index.html` (SPA fallback).
- Set up the admin account in Supabase Auth with the configured admin email, then promote its profile from Supabase SQL Editor. The browser never grants admin privileges.

```sql
update public.profiles
set role = 'admin'
where lower(email) = 'ombhurke101@gmail.com';
```

The app's profile repair always creates a `patient` role and preserves an existing profile role. Admin promotion remains a separate trusted setup step.

Run `npm test` for authentication flow checks and `npm run build` to compile the frontend. After changing code, restart the development server, or rebuild before running the preview server.

## Current integration boundary

Connected when Supabase settings and migrations are present: email/password auth, patient signup/reset, OAuth callback, role-aware routing, profile reads, database reads for model records, documents, assessment history, admin reporting, model draft metadata, and private storage uploads.

Not connected yet: prediction execution, QML inference, federated training, ML training jobs, dataset parsing, AI agent conversations, assessment creation from model results, model publishing workflow, report export, and user invitations. These pages show empty/unavailable states rather than simulated results. Document uploads store files privately with metadata; they do not parse or analyze the files yet.

See [`backend/SUPABASE_PLAN.md`](./backend/SUPABASE_PLAN.md) for the schema, access model, and next backend steps.
