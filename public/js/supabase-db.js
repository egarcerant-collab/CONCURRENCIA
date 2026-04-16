// ── Supabase Storage — Persistencia en la nube ──────────────
// Proyecto: concurencia-dsk
const SUPA_URL = 'https://sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';
const BUCKET   = 'indicadores';
const MAX_JSON_MB = 20;

// Columnas esenciales por fuente (reduce tamaño hasta 60%)
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
  // Mapear columnas normalizadas → nombre real en el dato
  const reales = Object.keys(rows[0]);
  const normMap = {};
  reales.forEach(k => { normMap[normCol(k)] = k; });
  // Para cada columna deseada, buscar su nombre real (con o sin tilde)
  const usar = [];
  cols.forEach(c => {
    const real = rows[0][c] !== undefined ? c : normMap[normCol(c)];
    if (real !== undefined) usar.push([c, real]);
  });
  return rows.map(r => {
    const o = {};
    usar.forEach(([alias, real]) => { o[real] = r[real]; });
    return o;
  });
}

let _client = null;
function getClient() {
  if (!_client && window.supabase) {
    _client = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  }
  return _client;
}

// Subir fuente a Supabase Storage (guarda solo columnas esenciales)
// meta: objeto opcional con { source, tipoReporte, ... } para etiquetar el origen
async function supaUpload(table, rows, fileName, meta = {}) {
  const client = getClient();
  if (!client) return false;
  try {
    const rowsFiltrados = filtrarColumnas(table, rows);
    const payload = JSON.stringify({
      rows: rowsFiltrados,
      fileName,
      uploadedAt: new Date().toISOString(),
      ...meta,
    });
    const mb = payload.length / 1024 / 1024;
    if (mb > MAX_JSON_MB) {
      console.warn(`[Supabase] ${table} demasiado grande (${mb.toFixed(1)} MB)`);
      return false;
    }
    console.log(`[Supabase] ${table}: ${rows.length} filas, ${mb.toFixed(2)} MB → subiendo...`);
    const blob = new Blob([payload], { type: 'application/json' });
    const { error } = await client.storage
      .from(BUCKET)
      .upload(`${table}.json`, blob, { upsert: true, contentType: 'application/json' });
    if (error) { console.warn('[Supabase] upload error:', error.message); return false; }
    console.log(`[Supabase] ✅ ${table} guardado (${(payload.length/1024).toFixed(0)} KB)`);
    return true;
  } catch(e) { console.warn('[Supabase] upload exception:', e); return false; }
}

// Descargar fuente desde Supabase Storage
async function supaDownload(table) {
  const client = getClient();
  if (!client) return null;
  try {
    const { data, error } = await client.storage
      .from(BUCKET)
      .download(`${table}.json`);
    if (error || !data) return null;
    const text = await data.text();
    const parsed = JSON.parse(text);
    console.log(`[Supabase] ✅ ${table} restaurado (${parsed.rows?.length||0} filas)`);
    return parsed;
  } catch(e) { return null; }
}

// Verificar si Supabase está disponible
async function supaCheck() {
  const client = getClient();
  if (!client) return false;
  try {
    const { error } = await client.storage.from(BUCKET).list('', { limit: 1 });
    return !error;
  } catch(e) { return false; }
}

window.SUPA_DB = { supaUpload, supaDownload, supaCheck };
