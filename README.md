# Luma · healthcare risk workspace

This repository is the new Luma project. The previous `MY-HealthChain` project was used as a reference and is kept separate.

## Project layout

- `frontend/` — browser app, styles, and entry HTML.
- `backend/server.js` — authenticated document extraction and Gemini chat API.
- `backend/supabase/` — Supabase configuration and database migrations.
- `package.json`, `package-lock.json`, and `vite.config.js` — root-level commands so setup stays straightforward.
- `.env.example` — names of the public browser settings to copy into your local `.env` file.

## Run locally

1. Install Node.js 20 or newer.
2. From the project root, run `npm install`.
3. Copy `.env.example` to `.env` and add the Supabase project URL, publishable/anon key, and `GEMINI_API_KEY`. The Gemini key stays on the backend; never prefix it with `VITE_` or commit `.env`.
4. Apply the SQL migrations in `backend/supabase/migrations/` to your Supabase project, in filename order. You can paste each file into Supabase SQL Editor.
5. Run `npm run dev` and open `http://localhost:3000`. This starts the frontend and the private API on port 3001. If you use `npm run preview` on port 4173, run `npm run start:api` in another terminal.

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

## Document text and AI companion

The upload saves each file in private Supabase Storage and its metadata in `documents`. The backend then extracts PDF and plain text locally; images and scanned PDFs use Gemini OCR. All readable text is split into patient-owned `document_chunks` under row-level security and indexed for full text search. Opening the document page or asking the assistant also processes files uploaded before this feature was added. A failed extraction stays visible with an **Extract text** retry button. Images must be under 10 MB for OCR; other documents may be up to 15 MB.

The patient chat saves conversation history in `chat_messages` and retrieves relevant excerpts from that patient's documents and recent assessments for each question. It can accept PNG, JPEG, and WebP images. The patient sees source document names below grounded answers. Excerpts and attached images are sent to Gemini for the requested answer. The default model is `gemini-3.1-flash-lite`, configurable through `GEMINI_MODEL`. For rate limit or temporary service failures, it retries once with `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`). Quota is controlled by the Gemini account, not by this app.

## Local medical models and federated training

The old project contains three checkpoint **updates**, which are copied locally with `powershell -File scripts/install-local-models.ps1` when `MY-HealthChain` is a sibling folder. Pass `-Source <absolute-path-to-old-backend/ml>` for another layout. The script verifies SHA-256 before and after copying. These copied ML binaries, private site data, and generated checkpoints are Git-ignored; every developer runs the script against their own local copy. The teammate's small QML `.pt` files are already tracked in Git. Never place private patient data in the repository.

The CheXNet update contains a complete 14-output DenseNet-121 state dictionary. The patient model library and chatbot can run it on a PNG, JPEG, or WebP **chest X-ray** after signing in. The library saves each direct result in assessment history. Its scores are experimental, unvalidated in this project, and are not a clinical diagnosis. The copied CT-CLIP and CMR-AI files contain only small adapter/head updates. Their full foundation checkpoints are absent from the old folder, so both are displayed as unavailable rather than running random weights. The teammate's committed cardiovascular, diabetes, and pulmonary QML `.pt` files are also listed in the portal. Their `model_state_dict` references a `qlayer`, normalization, MLP, and skip connection, but the matching TorchLayer circuit and preprocessing code were not committed. They are visible as awaiting runtime code; no QML score is fabricated. The older project's QML code uses a different artifact format and cannot safely load these checkpoints. The generic published-model connector below remains available for future ML/QML services.

Install a compatible Python environment with `torch`, `torchvision`, `numpy`, and `Pillow`, then set `PYTHON_BIN` to that Python executable if it is not on `PATH`. The Node backend launches Python for local inference and training. A GPU is optional but training on CPU can be slow.

The admin lab runs real, single-machine multi-silo FedAvg for the CheXNet classifier. Set `FL_DATA_ROOT` to a private directory, or use `backend/ml/federated/sites/`. Add at least two subfolders (one per site), each with at least four chest X-ray images and a `labels.csv` file. Example:

```text
sites/
  hospital-a/
    labels.csv
    images/xray-001.png
  hospital-b/
    labels.csv
    images/xray-002.png
```

```csv
image,pneumonia
images/xray-001.png,1
images/xray-002.png,0
```

Labels must be explicitly supplied as 0 or 1; the training code never infers them from filenames. Every round starts each site from the same global classifier, trains locally, and averages classifier parameters weighted by the site's training sample count. It holds out 20% of each site's images and reports actual held-out accuracy. Run status and metrics are recorded in Supabase `training_runs`; generated checkpoints stay local. The admin can review a completed run and explicitly activate its hash-verified checkpoint for later local inferences. This is a local federation prototype: site data is read by one machine, there is no remote hospital networking, no differential privacy guarantee, and no clinical validation. Refresh the admin lab to see status changes.

The backend validates the Supabase user token for each request and uses that user's row-level security permissions. It does not need a service-role key. Keep the backend running wherever the frontend is hosted, set `VITE_API_URL` to its public HTTPS origin, and allow the frontend origin through `CORS_ORIGIN`.

### ML and QML inference connector

The agent receives metadata only for published models. It can invoke a model only when that model has an approved `model_versions` record and `MODEL_API_BASE_URL` is configured. Set `MODEL_API_TOKEN` if the inference service needs a bearer token. The backend sends `POST <MODEL_API_BASE_URL>/predict` with JSON:

```json
{
  "model_id": "published-model-uuid",
  "model_slug": "diabetes-risk",
  "model_type": "tabular_classification or qml or image_classification",
  "version_id": "approved-version-uuid",
  "inputs": { "attribute": "value" },
  "image": { "mimeType": "image/png", "data": "base64-encoded-image" }
}
```

`image` is included only for image or mixed modality models. The connector expects JSON output and returns it to Gemini to explain in plain language. Publish model descriptions, `required_attributes`, `input_modality`, and `tool_description` carefully so the agent can choose the right model. Until an inference service and approved version exist, the assistant answers from records and clearly reports that prediction is unavailable.

## Current integration boundary

Connected when Supabase settings and migrations are present: email/password auth, patient signup/reset, OAuth callback, role-aware routing, profile reads, model records, documents, assessment history, admin reporting, model draft metadata, private storage uploads, document extraction, private text retrieval, and Gemini chat when the backend and API key are available.

Not connected yet: full CT-CLIP and CMR-AI inference, QML inference, remote federated clients, model publishing approval workflow, report export, and user invitations. The external inference connector is ready for a published approved model and a configured service endpoint; no prediction values are simulated.

See [`backend/SUPABASE_PLAN.md`](./backend/SUPABASE_PLAN.md) for the schema, access model, and next backend steps.
