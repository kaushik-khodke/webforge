// Supabase intentionally uses the same error for an unknown email and a wrong
// password. Registration must therefore remain subject to Auth's uniqueness
// checks; never treat a failed login as permission to replace an account.
export async function signInOrCreatePatient(auth, { email, password, role, adminEmail, redirectTo }, register = credentials => auth.signUp(credentials)) {
  if (role === "admin" && email !== adminEmail) {
    throw new Error("Use the configured workspace administrator email.");
  }

  const login = await auth.signInWithPassword({ email, password });
  if (!login.error) {
    if (!login.data?.session?.user) throw new Error("Sign-in did not return a session. Please try again.");
    return { session: login.data.session, requiresConfirmation: false };
  }

  // Provider failures, rate limits, and unconfirmed accounts must not trigger
  // registration. Admin identities can never be created through this form.
  if (role !== "patient" || email === adminEmail || login.error.code !== "invalid_credentials") {
    throw login.error;
  }
  if (password.length < 8) {
    throw new Error("Could not sign in. New accounts need at least 8 password characters. If you already have an account, check your password or use Forgot password.");
  }

  const signup = await register({ email, password, options: { emailRedirectTo: redirectTo } });
  if (signup.error) {
    if (["user_already_exists", "email_exists"].includes(signup.error.code) || /already registered|already exists/i.test(signup.error.message || "")) {
      throw login.error;
    }
    throw signup.error;
  }
  // With confirmation enabled Supabase can return an obfuscated existing user.
  if (!signup.data?.session && signup.data?.user?.identities?.length === 0) throw login.error;
  if (!signup.data?.user) throw new Error("Could not create your account. Please try again.");
  return { session: signup.data.session, requiresConfirmation: !signup.data.session };
}
