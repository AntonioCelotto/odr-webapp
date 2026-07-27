import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  const { data: membership } = await admin
    .from("admin_members")
    .select("level")
    .eq("profile_id", userData.user.id)
    .maybeSingle();
  const canManageAdmins = membership?.level === "owner";

  if (request.method === "GET") {
    const { data: users, error } = await admin
      .from("profiles")
      .select("id,email,full_name,phone,role,requested_role,approval_status,wordpress_user_id,created_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);

    const { data: wordpressAccounts, error: wordpressError } = await admin
      .from("wordpress_accounts")
      .select("wordpress_user_id,email,full_name,mapped_role,connected_profile_id")
      .order("full_name", { ascending: true });
    const { data: adminMembers, error: adminError } = await admin
      .from("admin_members")
      .select("profile_id,level");
    return wordpressError
      ? json({ error: wordpressError.message }, 500)
      : adminError
      ? json({ error: adminError.message }, 500)
      : json({ users, wordpressAccounts, adminMembers, canManageAdmins });
  }

  if (request.method !== "POST") {
    return json({ error: "Metodo non supportato." }, 405);
  }

  const { userId, action } = await request.json();
  const allowedActions = ["approve", "reject", "promote_admin", "remove_admin"];
  if (typeof userId !== "string" || !allowedActions.includes(action)) {
    return json({ error: "Dati non validi." }, 400);
  }
  if (["promote_admin", "remove_admin"].includes(action) && !canManageAdmins) {
    return json({ error: "Solo il titolare può gestire gli amministratori." }, 403);
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("requested_role,email,role")
    .eq("id", userId)
    .single();
  if (profileError || !profile) {
    return json({ error: "Profilo non trovato." }, 404);
  }

  if (action === "promote_admin") {
    const { error: promoteError } = await admin
      .from("profiles")
      .update({
        role: "admin",
        approval_status: "approved",
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (promoteError) return json({ error: promoteError.message }, 500);

    const { error: memberError } = await admin
      .from("admin_members")
      .upsert({
        profile_id: userId,
        level: "admin",
        updated_at: new Date().toISOString(),
      });
    if (memberError) return json({ error: memberError.message }, 500);

    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role: "admin" },
    });
    return authError
      ? json({ error: authError.message }, 500)
      : json({ success: true });
  }

  if (action === "remove_admin") {
    const { data: targetMembership } = await admin
      .from("admin_members")
      .select("level")
      .eq("profile_id", userId)
      .maybeSingle();
    if (targetMembership?.level === "owner") {
      return json({ error: "Il titolare principale non può essere rimosso." }, 400);
    }

    const fallbackRole = profile.requested_role === "admin"
      ? "patient"
      : profile.requested_role;
    const { error: removeError } = await admin
      .from("profiles")
      .update({ role: fallbackRole, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (removeError) return json({ error: removeError.message }, 500);

    await admin.from("admin_members").delete().eq("profile_id", userId);
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role: fallbackRole },
    });
    return authError
      ? json({ error: authError.message }, 500)
      : json({ success: true });
  }

  const { data: wordpressAccount } = await admin
    .from("wordpress_accounts")
    .select("wordpress_user_id,mapped_role")
    .ilike("email", profile.email)
    .maybeSingle();

  const approved = action === "approve";
  const role = approved
    ? (wordpressAccount?.mapped_role || profile.requested_role)
    : "patient";
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      role,
      approval_status: approved ? "approved" : "rejected",
      wordpress_user_id: approved ? wordpressAccount?.wordpress_user_id || null : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (updateError) return json({ error: updateError.message }, 500);

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { role },
  });
  if (authError) return json({ error: authError.message }, 500);

  if (wordpressAccount) {
    await admin
      .from("wordpress_accounts")
      .update({
        connected_profile_id: approved ? userId : null,
        updated_at: new Date().toISOString(),
      })
      .eq("wordpress_user_id", wordpressAccount.wordpress_user_id);
  }

  return json({ success: true });
});
