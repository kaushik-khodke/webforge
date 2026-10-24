# Supabase foundation

The initial migration is in `supabase/migrations/202610240001_initial_schema.sql`. The profile repair migration is `supabase/migrations/202610240002_repair_missing_profiles.sql`. Apply both in order to the hosted Supabase project; the second migration also backfills existing Auth users without changing existing roles.

## Tables

| Table | Purpose | Access |
| --- | --- | --- |
| `profiles` | Auth-linked profile and portal role | Users read their own profile and can update only `full_name`; admins can read all profiles. Roles are not writable from the client. |
| `health_models` | Model catalog, outcome, description and publication state | Patients read published models; admins manage model records. |
| `model_versions` | Version, private artifact path and validation metrics | Patients see versions of published models; admins manage versions. |
| `documents` | Patient file metadata and processing state | Patients manage their own records; admins can read metadata. |
| `assessments` | Model version, input snapshot, result and state | Patients can submit/read their own assessments; admins can read all. Prediction writes should move to a trusted service before real inference is enabled. |
| `training_runs` | Dataset reference, settings, metrics and status | Admin only. A trusted training worker should own job creation and updates. |
| `audit_events` | Actor, event, status and metadata | Admin can read; admin clients can append events attributed to themselves. Move important audit writes to a trusted server. |

New Supabase Auth accounts receive a `profiles` row with `role='patient'` from a database trigger. The repair migration backfills users created before the trigger and allows an authenticated account to create only its own missing patient profile. It does not change an existing role. Promote the designated admin profile using Supabase's dashboard/SQL editor after creating its Auth account. A user cannot grant themselves admin from the browser.

## Private Storage buckets

- `patient-documents`: private, 15 MiB limit; object path begins with the user's Auth UUID.
- `model-artifacts`: private, 250 MiB limit; admin-only through the current client policies.
- `training-datasets`: private, 1 GiB limit; admin-only through the current client policies.

Client uploads validate file types and sizes for usability. Add server-side file validation, malware scanning, signed URL handling and retention rules before processing real health records. The frontend currently stores documents and metadata but does not parse them.

## Setup sequence

1. Create the Supabase project and configure email/password plus Google/GitHub providers.
2. Apply the initial SQL migration.
3. Add local URL and anon/publishable key to `.env`; keep service-role secrets on a server only.
4. Add `http://localhost:3000/dashboard` and the production `/dashboard` URL to Supabase's allowed redirect URLs. Provider consoles should return to `https://<project-ref>.supabase.co/auth/v1/callback`.
5. Create the admin Auth user and promote its profile from the Supabase SQL editor/dashboard.
6. Confirm a patient signup stays `patient`, cannot read another patient's document or assessment, and cannot access admin routes/data.
7. Add trusted server services for assessment inference, training jobs, federated aggregation, QML inference, and agent tools. Do not load executable model artifacts or service-role secrets in the browser.

## Model pipeline next

The old project is a reference for model artifacts and pipeline behavior only. Before moving model weights or code, inspect artifact formats, licenses, input/output contracts, preprocessing, expected dependencies, and whether weights can be safely served. Connect a server-side adapter to versioned model records after that review. Keep patient attributes and assessment results behind explicit authorization and do not expose raw datasets or model files to public clients.
