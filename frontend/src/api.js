import { getSupabase } from "./supabase.js";

const configuredBase = (import.meta.env.VITE_API_URL || "").trim();
const apiHost = ["localhost", "127.0.0.1"].includes(window.location.hostname) ? "127.0.0.1" : window.location.hostname;
const localBase = `${window.location.protocol}//${apiHost}:3001`;
const apiBase = configuredBase.replace(/\/$/, "") || localBase;

export async function apiRequest(path, { method = "GET", body } = {}) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Please sign in again.");
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("The AI service is not running. Start the frontend and backend with npm run dev.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Service returned ${response.status}.`);
  return payload;
}
