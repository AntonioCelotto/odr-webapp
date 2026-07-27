import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const types = ["distributor", "agent", "center"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !serviceRoleKey || !authorization) return json({ error: "Richiesta non autorizzata." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Sessione non valida." }, 401);

  const { data: profile } = await admin.from("profiles")
    .select("id,role,approval_status,network_entity_id").eq("id", userData.user.id).maybeSingle();
  if (!profile || profile.approval_status !== "approved") return json({ error: "Profilo non autorizzato." }, 403);

  if (request.method === "GET") {
    const { data: allEntities, error } = await admin.from("network_entities")
      .select("id,type,name,email,phone,area,parent_id,external_code,active,created_at").order("type").order("name");
    if (error) return json({ error: error.message }, 500);
    let entities = allEntities || [];
    if (profile.role !== "admin") {
      const visible = new Set<string>();
      if (profile.network_entity_id) visible.add(profile.network_entity_id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const entity of entities) {
          if (entity.parent_id && visible.has(entity.parent_id) && !visible.has(entity.id)) {
            visible.add(entity.id);
            changed = true;
          }
        }
      }
      entities = entities.filter((entity) => visible.has(entity.id));
    }
    let accounts: unknown[] = [];
    if (profile.role === "admin") {
      const { data, error: accountsError } = await admin.from("profiles")
        .select("id,email,full_name,role,network_entity_id").in("role", types)
        .eq("approval_status", "approved").order("full_name");
      if (accountsError) return json({ error: accountsError.message }, 500);
      accounts = data || [];
    }
    return json({ entities, accounts, canManage: profile.role === "admin" });
  }

  if (request.method !== "POST") return json({ error: "Metodo non supportato." }, 405);
  if (profile.role !== "admin") return json({ error: "Operazione riservata agli amministratori." }, 403);
  const body = await request.json();

  if (body.action === "toggle") {
    if (typeof body.id !== "string" || typeof body.active !== "boolean") return json({ error: "Dati non validi." }, 400);
    const { error } = await admin.from("network_entities")
      .update({ active: body.active, updated_at: new Date().toISOString() }).eq("id", body.id);
    return error ? json({ error: error.message }, 500) : json({ success: true });
  }

  if (body.action === "save") {
    const type = clean(body.type, 30);
    const name = clean(body.name);
    const parentId = clean(body.parentId, 80) || null;
    if (!types.includes(type) || !name) return json({ error: "Tipo e nome sono obbligatori." }, 400);
    if (type === "distributor" && parentId) return json({ error: "Un distributore non può avere un collegamento superiore." }, 400);
    if (type !== "distributor" && !parentId) return json({ error: "Seleziona il collegamento della rete." }, 400);
    if (parentId) {
      const { data: parent } = await admin.from("network_entities").select("id,type").eq("id", parentId).maybeSingle();
      const valid = type === "agent" ? parent?.type === "distributor" : parent?.type === "agent";
      if (!valid) return json({ error: "Collegamento gerarchico non valido." }, 400);
    }
    const values = {
      type, name,
      email: clean(body.email) || null,
      phone: clean(body.phone, 60) || null,
      area: clean(body.area, 120) || null,
      parent_id: parentId,
      external_code: clean(body.externalCode, 100) || null,
      active: body.active !== false,
      import_source: clean(body.importSource, 120) || null,
      updated_at: new Date().toISOString(),
    };
    let entityId = clean(body.id, 80);
    if (entityId) {
      const { error } = await admin.from("network_entities").update(values).eq("id", entityId);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { data, error } = await admin.from("network_entities").insert(values).select("id").single();
      if (error) return json({ error: error.message }, 500);
      entityId = data.id;
    }
    const accountId = clean(body.accountId, 80) || null;
    await admin.from("profiles").update({ network_entity_id: null, updated_at: new Date().toISOString() })
      .eq("network_entity_id", entityId);
    if (accountId) {
      const { data: account } = await admin.from("profiles").select("role").eq("id", accountId).maybeSingle();
      if (account?.role !== type) return json({ error: "Il ruolo dell’account non corrisponde al tipo di rete." }, 400);
      const { error } = await admin.from("profiles")
        .update({ network_entity_id: entityId, updated_at: new Date().toISOString() }).eq("id", accountId);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ success: true, id: entityId });
  }

  if (body.action === "import") {
    if (!Array.isArray(body.rows) || body.rows.length > 500) return json({ error: "Import non valido o troppo grande." }, 400);
    let imported = 0;
    const nameToId = new Map<string, string>();
    const { data: existing } = await admin.from("network_entities").select("id,name");
    for (const entity of existing || []) nameToId.set(entity.name.toLowerCase(), entity.id);
    const ordered = [...body.rows].sort((a, b) => types.indexOf(clean(a.type, 30)) - types.indexOf(clean(b.type, 30)));
    for (const raw of ordered) {
      const type = clean(raw.type, 30);
      const name = clean(raw.name);
      if (!types.includes(type) || !name) continue;
      const parentId = type === "distributor" ? null : nameToId.get(clean(raw.parentName).toLowerCase()) || null;
      if (type !== "distributor" && !parentId) continue;
      const values = {
        type, name,
        email: clean(raw.email) || null,
        phone: clean(raw.phone, 60) || null,
        area: clean(raw.area, 120) || null,
        parent_id: parentId,
        external_code: clean(raw.externalCode, 100) || null,
        active: raw.active !== false,
        import_source: clean(body.fileName, 120) || "CSV",
        updated_at: new Date().toISOString(),
      };
      const knownId = nameToId.get(name.toLowerCase());
      const result = knownId
        ? await admin.from("network_entities").update(values).eq("id", knownId).select("id").single()
        : await admin.from("network_entities").insert(values).select("id").single();
      if (!result.error && result.data) {
        nameToId.set(name.toLowerCase(), result.data.id);
        imported += 1;
      }
    }
    return json({ success: true, imported });
  }
  return json({ error: "Azione non valida." }, 400);
});
