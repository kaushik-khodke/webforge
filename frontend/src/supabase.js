let clientPromise;

export function getSupabaseConfig() {
  const env = import.meta.env || {};
  return {
    url: (env.VITE_SUPABASE_URL || window.LUMA_CONFIG?.supabaseUrl || "").trim(),
    anonKey: (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || window.LUMA_CONFIG?.supabasePublishableKey || window.LUMA_CONFIG?.supabaseAnonKey || "").trim(),
    adminEmail: (env.VITE_ADMIN_EMAIL || window.LUMA_CONFIG?.adminEmail || "ombhurke101@gmail.com").trim().toLowerCase(),
    redirectPath: env.VITE_AUTH_REDIRECT_PATH || window.LUMA_CONFIG?.authRedirectPath || "/dashboard",
  };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export async function getSupabase() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) => createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })).catch(error => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

export function getAuthRedirectUrl() {
  const { redirectPath } = getSupabaseConfig();
  return new URL(redirectPath, window.location.origin).toString();
}

export async function registerPatient(credentials) {
  const client = await getSupabase();
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  if (!response.ok) throw new Error("Could not check account settings. Please try again.");
  const settings = await response.json();
  if (!settings.mailer_autoconfirm) return client.auth.signUp(credentials);

  // Immediate email registration does not use a PKCE email callback. Keep
  // OAuth's main client on PKCE and transfer the new session to that client.
  const { createClient } = await import("@supabase/supabase-js");
  const registration = createClient(url, anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "luma-patient-registration" },
  });
  const result = await registration.auth.signUp(credentials);
  if (result.error || !result.data?.session) return result;
  return client.auth.setSession({
    access_token: result.data.session.access_token,
    refresh_token: result.data.session.refresh_token,
  });
}
