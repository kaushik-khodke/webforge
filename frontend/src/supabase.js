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
