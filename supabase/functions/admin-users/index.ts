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
      .select("id,email,full_name,phone,role,requested_role,requested_parent_entity_id,approval_status,wordpress_user_id,created_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);

    const { data: wordpressAccounts, error: wordpressError } = await admin
      .from("wordpress_accounts")
      .select("wordpress_user_id,email,full_name,mapped_role,connected_profile_id")
      .order("full_name", { ascending: true });
    const { data: adminMembers, error: adminError } = await admin
      .from("admin_members")
      .select("profile_id,level");
    const parentIds = [...new Set((users || [])
      .map((user) => user.requested_parent_entity_id)
      .filter(Boolean))];
    const { data: requestedParents, error: parentsError } = parentIds.length
      ? await admin.from("network_entities").select("id,name").in("id", parentIds)
      : { data: [], error: null };
    return wordpressError
      ? json({ error: wordpressError.message }, 500)
      : adminError
      ? json({ error: adminError.message }, 500)
      : parentsError
      ? json({ error: parentsError.message }, 500)
      : json({ users, wordpressAccounts, adminMembers, requestedParents, canManageAdmins });
  }

  if (request.method !== "POST") {
    return json({ error: "Metodo non supportato." }, 405);
  }

  const { userId, action, role: requestedNewRole } = await request.json();
  const allowedActions = ["approve", "reject", "promote_admin", "remove_admin", "change_role", "delete_user"];
  if (typeof userId !== "string" || !allowedActions.includes(action)) {
    return json({ error: "Dati non validi." }, 400);
  }
  if (["promote_admin", "remove_admin", "change_role", "delete_user"].includes(action) && !canManageAdmins) {
    return json({ error: "Solo il titolare può cambiare ruoli o eliminare account." }, 403);
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("requested_role,requested_parent_entity_id,email,full_name,phone,role")
    .eq("id", userId)
    .single();
  if (profileError || !profile) {
    return json({ error: "Profilo non trovato." }, 404);
  }

  const { data: targetMembership } = await admin
    .from("admin_members")
    .select("level")
    .eq("profile_id", userId)
    .maybeSingle();
  if (targetMembership?.level === "owner" && ["change_role", "delete_user", "remove_admin"].includes(action)) {
    return json({ error: "Il titolare principale non può essere modificato o eliminato." }, 400);
  }

  if (action === "delete_user") {
    await admin
      .from("wordpress_accounts")
      .update({ connected_profile_id: null, updated_at: new Date().toISOString() })
      .eq("connected_profile_id", userId);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    return deleteError
      ? json({ error: deleteError.message }, 500)
      : json({ success: true });
  }

  if (action === "change_role") {
    const allowedRoles = ["patient", "center", "agent", "distributor"];
    if (!allowedRoles.includes(requestedNewRole)) {
      return json({ error: "Ruolo non valido." }, 400);
    }
    let networkEntityId = null;
    if (["center", "agent", "distributor"].includes(requestedNewRole)) {
      const { data: networkEntity } = await admin
        .from("network_entities")
        .select("id")
        .eq("type", requestedNewRole)
        .ilike("email", profile.email)
        .maybeSingle();
      networkEntityId = networkEntity?.id || null;
    }
    const { error: roleError } = await admin
      .from("profiles")
      .update({
        role: requestedNewRole,
        requested_role: requestedNewRole,
        approval_status: "approved",
        network_entity_id: networkEntityId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (roleError) return json({ error: roleError.message }, 500);

    await admin.from("admin_members").delete().eq("profile_id", userId);
    await admin
      .from("wordpress_accounts")
      .update({ mapped_role: requestedNewRole, updated_at: new Date().toISOString() })
      .eq("connected_profile_id", userId);
    await admin
      .from("wordpress_accounts")
      .update({ mapped_role: requestedNewRole, updated_at: new Date().toISOString() })
      .ilike("email", profile.email);
    const { error: authRoleError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role: requestedNewRole },
    });
    return authRoleError
      ? json({ error: authRoleError.message }, 500)
      : json({ success: true });
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
  let networkEntityId = null;
  if (approved && ["distributor", "agent", "center"].includes(role)) {
    let { data: networkEntity } = await admin
      .from("network_entities")
      .select("id")
      .eq("type", role)
      .ilike("email", profile.email)
      .maybeSingle();
    if (!networkEntity && role === "center" && profile.requested_parent_entity_id) {
      const { data: parent } = await admin.from("network_entities")
        .select("id,type,is_primary_center")
        .eq("id", profile.requested_parent_entity_id)
        .eq("active", true)
        .maybeSingle();
      if (parent?.type === "center" && parent.is_primary_center) {
        const created = await admin.from("network_entities").insert({
          type: "center",
          name: profile.full_name || profile.email,
          email: profile.email,
          phone: profile.phone || null,
          parent_id: parent.id,
          active: true,
          import_source: "Registrazione con codice convenzione",
        }).select("id").single();
        if (created.error) return json({ error: created.error.message }, 500);
        networkEntity = created.data;
      }
    }
    networkEntityId = networkEntity?.id || null;
  }
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      role,
      approval_status: approved ? "approved" : "rejected",
      wordpress_user_id: approved ? wordpressAccount?.wordpress_user_id || null : null,
      network_entity_id: approved ? networkEntityId : null,
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
