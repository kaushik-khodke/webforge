import test from "node:test";
import assert from "node:assert/strict";
import { signInOrCreatePatient } from "../src/auth.js";

const credentials = { email: "patient@example.com", password: "valid-password", role: "patient", adminEmail: "admin@example.com", redirectTo: "http://localhost:3000/dashboard" };
const session = { user: { id: "patient-id" } };
const invalid = { code: "invalid_credentials", message: "Invalid login credentials" };
const denied = { data: { user: null, session: null }, error: invalid };
const forbidSignup = () => assert.fail("This outcome must not attempt account creation");

test("existing patient signs in without attempting registration, including a legacy short password", async () => {
  const auth = { signInWithPassword: async () => ({ data: { session }, error: null }) };
  assert.equal((await signInOrCreatePatient(auth, { ...credentials, password: "short" }, forbidSignup)).session, session);
});

test("new email creates an account through the same form and receives its authenticated session", async () => {
  const result = await signInOrCreatePatient({ signInWithPassword: async () => denied }, credentials, async request => {
    assert.deepEqual(request, { email: credentials.email, password: credentials.password, options: { emailRedirectTo: credentials.redirectTo } });
    return { data: { user: session.user, session }, error: null };
  });
  assert.equal(result.session, session);
  assert.equal(result.requiresConfirmation, false);
});

test("an existing email with a wrong password remains a failed login", async () => {
  await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => denied }, credentials,
    async () => ({ data: {}, error: { code: "user_already_exists", message: "User already registered" } })), error => error === invalid);
});

test("an obfuscated existing-user signup response is not accepted as a successful login", async () => {
  await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => denied }, credentials,
    async () => ({ data: { session: null, user: { identities: [] } }, error: null })), error => error === invalid);
});

test("a newly registered account awaiting confirmation is not treated as authenticated", async () => {
  const result = await signInOrCreatePatient({ signInWithPassword: async () => denied }, credentials,
    async () => ({ data: { session: null, user: { identities: [{ id: "identity" }] } }, error: null }));
  assert.equal(result.session, null);
  assert.equal(result.requiresConfirmation, true);
});

test("provider errors, rate limits, network failures and unconfirmed emails never trigger registration", async () => {
  for (const code of ["email_provider_disabled", "over_request_rate_limit", "email_not_confirmed", "unexpected_failure"]) {
    const error = { code, message: "Sign-in failed" };
    await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => ({ data: {}, error }) }, credentials, forbidSignup), value => value === error);
  }
  await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => { throw new Error("Network unavailable"); } }, credentials, forbidSignup), /Network unavailable/);
});

test("admin failures and the reserved admin email never register an account", async () => {
  const auth = { signInWithPassword: async () => denied };
  for (const role of ["patient", "admin"]) {
    await assert.rejects(signInOrCreatePatient(auth, { ...credentials, role, email: credentials.adminEmail }, forbidSignup), error => error === invalid);
  }
  await assert.rejects(signInOrCreatePatient(auth, { ...credentials, role: "admin" }, forbidSignup), /administrator email/);
});

test("an unsuccessful login with a short password cannot create a new account", async () => {
  await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => denied }, { ...credentials, password: "short" }, forbidSignup), /at least 8/);
});

test("signup rate limits remain visible instead of claiming account creation succeeded", async () => {
  const error = { code: "over_request_rate_limit", message: "Please wait" };
  await assert.rejects(signInOrCreatePatient({ signInWithPassword: async () => denied }, credentials,
    async () => ({ data: {}, error })), value => value === error);
});
