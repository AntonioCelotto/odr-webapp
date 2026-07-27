import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !serviceRoleKey || !authorization) {
    return json({ error: "Richiesta non autorizzata." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (
    userError
    || !userData.user
    || userData.user.app_metadata?.role !== "admin"
  ) {
    return json({ error: "Accesso riservato agli amministratori." }, 403);
  }

  const { role, module, canView } = await request.json();
  const allowedRoles = ["admin", "distributor", "agent", "center", "patient"];
  const allowedModules = [
    "dashboard",
    "codes",
    "promotions",
    "network",
    "wordpress",
    "reports",
    "users",
    "permissions",
  ];
  if (
    !allowedRoles.includes(role)
    || !allowedModules.includes(module)
    || typeof canView !== "boolean"
    || role === "admin"
  ) {
    return json({ error: "Permesso non valido." }, 400);
  }

  const { error } = await admin
    .from("role_permissions")
    .update({ can_view: canView, updated_at: new Date().toISOString() })
    .eq("role", role)
    .eq("module", module);

  return error ? json({ error: error.message }, 500) : json({ success: true });
});
