import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const roles = ["admin", "distributor", "agent", "center", "patient"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanCode(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
  if (userError || !userData.user) return json({ error: "Sessione non valida." }, 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("id,role,approval_status")
    .eq("id", userData.user.id)
    .single();
  if (!profile || profile.approval_status !== "approved") {
    return json({ error: "Profilo non autorizzato." }, 403);
  }
  const isAdmin = profile.role === "admin";
  const url = new URL(request.url);

  if (request.method === "GET" && url.searchParams.get("view") === "active") {
    const { data } = await admin
      .from("code_validations")
      .select("code,created_at,validation_code_id,validation_codes(label,hospital,discount_label,woo_coupon,active,starts_at,ends_at,audience_role)")
      .eq("patient_id", profile.id)
      .eq("valid", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const code = data?.validation_codes as Record<string, unknown> | null;
    const now = Date.now();
    const usable = code
      && code.active
      && (!code.starts_at || Date.parse(String(code.starts_at)) <= now)
      && (!code.ends_at || Date.parse(String(code.ends_at)) >= now)
      && (!code.audience_role || code.audience_role === profile.role || profile.role === "admin");
    return json({ activeCode: usable ? { code: data?.code, ...code } : null });
  }

  if (request.method === "GET") {
    if (!isAdmin) return json({ codes: [] });
    const { data: codes, error } = await admin
      .from("validation_codes")
      .select("id,code,label,hospital,discount_label,woo_coupon,starts_at,ends_at,active,max_uses,current_uses,audience_role,created_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    const { data: validations } = await admin
      .from("code_validations")
      .select("id,code,valid,failure_reason,created_at,patient_id,profiles!code_validations_patient_id_fkey(full_name,email)")
      .order("created_at", { ascending: false })
      .limit(100);
    return json({ codes, validations: validations || [] });
  }

  if (request.method !== "POST") return json({ error: "Metodo non supportato." }, 405);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "validate") {
    const code = cleanCode(body.code);
    if (!code) return json({ error: "Inserisci un codice valido." }, 400);
    const { data: validationCode } = await admin
      .from("validation_codes")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    const now = Date.now();
    let failure = "";
    if (!validationCode) failure = "Codice inesistente";
    else if (!validationCode.active) failure = "Codice non attivo";
    else if (validationCode.starts_at && Date.parse(validationCode.starts_at) > now) failure = "Codice non ancora attivo";
    else if (validationCode.ends_at && Date.parse(validationCode.ends_at) < now) failure = "Codice scaduto";
    else if (validationCode.max_uses !== null && validationCode.current_uses >= validationCode.max_uses) failure = "Limite utilizzi raggiunto";
    else if (validationCode.audience_role && validationCode.audience_role !== profile.role && !isAdmin) failure = "Codice non disponibile per questo profilo";

    await admin.from("code_validations").insert({
      validation_code_id: validationCode?.id || null,
      patient_id: profile.id,
      code,
      valid: !failure,
      failure_reason: failure || null,
    });
    if (failure) return json({ error: failure }, 400);

    const { error: updateError } = await admin
      .from("validation_codes")
      .update({ current_uses: validationCode.current_uses + 1, updated_at: new Date().toISOString() })
      .eq("id", validationCode.id)
      .eq("current_uses", validationCode.current_uses);
    if (updateError) return json({ error: "Codice già utilizzato contemporaneamente. Riprova." }, 409);
    return json({
      valid: true,
      activeCode: {
        code,
        label: validationCode.label,
        hospital: validationCode.hospital,
        discount_label: validationCode.discount_label,
        woo_coupon: validationCode.woo_coupon,
      },
    });
  }

  if (!isAdmin) return json({ error: "Accesso riservato agli amministratori." }, 403);

  if (action === "save") {
    const code = cleanCode(body.code);
    const label = String(body.label || "").trim().slice(0, 160);
    const coupon = String(body.wooCoupon || "").trim().slice(0, 100);
    if (!code || !label || !coupon) return json({ error: "Codice, descrizione e coupon sono obbligatori." }, 400);
    const audienceRole = roles.includes(body.audienceRole) ? body.audienceRole : null;
    const row = {
      code,
      label,
      hospital: String(body.hospital || "").trim().slice(0, 160) || null,
      discount_label: String(body.discountLabel || "").trim().slice(0, 160) || null,
      woo_coupon: coupon,
      starts_at: body.startsAt || null,
      ends_at: body.endsAt || null,
      max_uses: body.maxUses ? Math.max(1, Number(body.maxUses)) : null,
      audience_role: audienceRole,
      active: body.active !== false,
      created_by: profile.id,
      updated_at: new Date().toISOString(),
    };
    const query = body.id
      ? admin.from("validation_codes").update(row).eq("id", body.id)
      : admin.from("validation_codes").insert(row);
    const { error } = await query;
    return error ? json({ error: error.message }, 400) : json({ success: true });
  }

  if (action === "toggle") {
    const { error } = await admin
      .from("validation_codes")
      .update({ active: Boolean(body.active), updated_at: new Date().toISOString() })
      .eq("id", body.id);
    return error ? json({ error: error.message }, 400) : json({ success: true });
  }

  return json({ error: "Azione non valida." }, 400);
});
