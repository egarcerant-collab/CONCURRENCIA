// ── Supabase Storage — Persistencia en la nube ──────────────
const SUPA_URL = 'https://sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';
const BUCKET   = 'indicadores';
const MAX_JSON_MB = 20;

const COLS_ESENCIALES = {
  DATOS: [
    'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
    'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso',
    'Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico',
    'Cie10 Egreso','Estancia','Programa Riesgo','Gestacion','Via Parto',
    'Dx Gestante','Control Prenatal','Reingreso','Auditor','Glosas',
    'Valor Total Glosa','Eventos Adversos','Cantidad Evento no calidad',
    'Observación Seguimiento','Patologia alto costo','Especialidad',
    'Patologia Alto Costo','IPS Primaria'
  ]
};

function normCol(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

function filtrarColumnas(table, rows) {
  const cols = COLS_ESENCIALES[table];
  if (!cols || !rows.length) return rows;
  const reales = Object.keys(rows[0]);
  const normMap = {};
  reales.forEach(k => { normMap[normCol(k)] = k; });
  const usar = [];
  cols.forEach(c => {
    const real = rows[0][c] !== undefined ? c : normMap[normCol(c)];
    if (real !== undefined) usar.push([c, real]);
  });
  return rows.map(r => {
    const o = {};
    usar.forEach(([alias, real]) => { o[alias] = r[real] ?? r[real] ?? ''; });
    return o;
  });
}

// ── Subida DIRECTA a Supabase Storage vía fetch ──────────────
// Igual al método del servidor — NO pasa por Vercel, sin límite de 4.5MB
async function supaUploadDirect(table, rows, fileName, meta = {}) {
  try {
    const rowsFiltrados = filtrarColumnas(table, rows);
    const payload = JSON.stringify({
      rows: rowsFiltrados,
      fileName,
      uploadedAt: new Date().toISOString(),
      ...meta,
    });
    const mb = payload.length / 1024 / 1024;
    console.log(`[Supabase Direct] ${table}: ${rows.length} filas, ${mb.toFixed(2)} MB`);

    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${BUCKET}/${table}.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPA_KEY}`,
          'apikey':        SUPA_KEY,
          'Content-Type':  'application/json',
          'x-upsert':      'true',
        },
        body: payload,
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`[Supabase Direct] Error ${res.status}: ${txt.slice(0,200)}`);
      return false;
    }
    console.log(`[Supabase Direct] ✅ ${table} guardado (${mb.toFixed(2)} MB)`);
    return true;
  } catch(e) {
    console.warn('[Supabase Direct] Exception:', e.message);
    return false;
  }
}

// ── Subida vía SDK (fallback) ─────────────────────────────────
let _client = null;
function getClient() {
  if (!_client && window.supabase) {
    _client = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  }
  return _client;
}

async function supaUpload(table, rows, fileName, meta = {}) {
  // Intentar primero con fetch directo (más confiable)
  const ok = await supaUploadDirect(table, rows, fileName, meta);
  if (ok) return true;
  // Fallback: SDK de Supabase
  const client = getClient();
  if (!client) return false;
  try {
    const rowsFiltrados = filtrarColumnas(table, rows);
    const payload = JSON.stringify({ rows: rowsFiltrados, fileName,
      uploadedAt: new Date().toISOString(), ...meta });
    const mb = payload.length / 1024 / 1024;
    if (mb > MAX_JSON_MB) return false;
    const blob = new Blob([payload], { type: 'application/json' });
    const { error } = await client.storage
      .from(BUCKET)
      .upload(`${table}.json`, blob, { upsert: true, contentType: 'application/json' });
    if (error) { console.warn('[Supabase SDK] error:', error.message); return false; }
    return true;
  } catch(e) { console.warn('[Supabase SDK] exception:', e); return false; }
}

// ── Descargar desde Supabase Storage ─────────────────────────
async function supaDownload(table) {
  // Intentar con fetch directo primero
  try {
    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${BUCKET}/${table}.json`,
      { headers: { 'Authorization': `Bearer ${SUPA_KEY}`, 'apikey': SUPA_KEY } }
    );
    if (res.ok) {
      const parsed = await res.json();
      console.log(`[Supabase Direct] ✅ ${table} restaurado (${parsed.rows?.length||0} filas)`);
      return parsed;
    }
  } catch(e) {}
  // Fallback: SDK
  const client = getClient();
  if (!client) return null;
  try {
    const { data, error } = await client.storage.from(BUCKET).download(`${table}.json`);
    if (error || !data) return null;
    const parsed = JSON.parse(await data.text());
    console.log(`[Supabase SDK] ✅ ${table} restaurado (${parsed.rows?.length||0} filas)`);
    return parsed;
  } catch(e) { return null; }
}

async function supaCheck() {
  try {
    const res = await fetch(`${SUPA_URL}/storage/v1/bucket/${BUCKET}`,
      { headers: { 'Authorization': `Bearer ${SUPA_KEY}`, 'apikey': SUPA_KEY } });
    return res.ok;
  } catch(e) { return false; }
}

window.SUPA_DB = { supaUpload, supaUploadDirect, supaDownload, supaCheck };
