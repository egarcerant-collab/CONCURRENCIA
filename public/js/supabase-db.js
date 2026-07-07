// ── Supabase Storage — Persistencia en la nube ──────────────
const SUPA_URL = 'https://sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';
const BUCKET   = 'indicadores';
const MAX_JSON_MB = 20;
const SUPA_TIMEOUT_MS = 12000; // 12 s máximo para cada descarga

// ── Google Sheets — respaldo cuando Supabase no responde ─────
const GSHEETS_ID  = '1Uoj-zA7Q3TC7_1TcPJ6EzzcKB1XXpWni';
const GSHEETS_PUB = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSI7sQ7ra8c3NoggDYwVZi7eKeS62ImJcOyiRbSDAnvZNtO-61mCsyrtGTtgG_Ow/pub?gid=1292237722&single=true&output=csv';

const COLS_ESENCIALES = {
  DATOS: [
    'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
    'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso',
    'Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico',
    'Cie10 Egreso','Estancia','Programa Riesgo','Gestacion','Via Parto',
    'Dx Gestante','Control Prenatal','Reingreso','Auditor','Glosas',
    'Valor Total Glosa','Eventos Adversos','Cantidad Evento no calidad',
    'Observación Seguimiento','Patologia alto costo','Especialidad',
    'Patologia Alto Costo','IPS Primaria',
    'Dirección','Direccion','Teléfonos','Telefonos','Teléfono','Telefono','Celular'
  ]
};

function normCol(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
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
    usar.forEach(([alias, real]) => { o[alias] = r[real] ?? ''; });
    return o;
  });
}

// ── Subida DIRECTA a Supabase Storage vía fetch ──────────────
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
        signal: AbortSignal.timeout(30000),
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
  const ok = await supaUploadDirect(table, rows, fileName, meta);
  if (ok) return true;
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

// ── Descargar desde Supabase Storage (con timeout para no colgar) ──
async function supaDownload(table) {
  const bust = `?t=${Date.now()}`;
  try {
    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${BUCKET}/${table}.json${bust}`,
      {
        headers: { 'Authorization': `Bearer ${SUPA_KEY}`, 'apikey': SUPA_KEY },
        cache: 'no-store',
        signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
      }
    );
    if (res.ok) {
      const parsed = await res.json();
      console.log(`[Supabase] ✅ ${table} — ${parsed.rows?.length||0} filas · ${new Date().toLocaleTimeString('es-CO')}`);
      return parsed;
    }
    const errTxt = await res.text().catch(()=>'');
    console.warn(`[Supabase] ${table} → HTTP ${res.status}: ${errTxt.slice(0,150)}`);
  } catch(e) {
    console.warn(`[Supabase] ${table} → excepción:`, e.message);
  }
  // Fallback: SDK de Supabase (segunda vía)
  const client = getClient();
  if (!client) return null;
  try {
    const { data, error } = await client.storage.from(BUCKET).download(`${table}.json`);
    if (error) { console.warn(`[Supabase SDK] ${table} → error:`, error.message); return null; }
    if (!data)  return null;
    const parsed = JSON.parse(await data.text());
    console.log(`[Supabase SDK] ✅ ${table} — ${parsed.rows?.length||0} filas`);
    return parsed;
  } catch(e) {
    console.warn(`[Supabase SDK] ${table} → excepción:`, e.message);
    return null;
  }
}

// ── Google Sheets — descarga CSV como respaldo ────────────────
// Requiere que la hoja esté publicada: Archivo > Compartir > Publicar en la web → CSV
async function gSheetsDownload(sheetId) {
  const id = sheetId || GSHEETS_ID;
  // Intentar vía gviz (funciona con hojas publicadas en la web)
  const urls = [
    GSHEETS_PUB,
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { console.warn('[GSheets] HTTP', res.status, url); continue; }
      const csv = await res.text();
      if (!csv || csv.length < 100) continue;
      if (!window.XLSX) { console.warn('[GSheets] SheetJS no disponible'); return null; }
      const wb = window.XLSX.read(csv, { type: 'string' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) continue;
      console.log(`[GSheets] ✅ ${rows.length} filas cargadas desde Google Sheets`);
      return { rows, fileName: 'Google Sheets (respaldo)', uploadedAt: new Date().toISOString(), source: 'gsheets' };
    } catch(e) {
      console.warn('[GSheets] Error con', url, '→', e.message);
    }
  }
  return null;
}

async function supaCheck() {
  try {
    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${BUCKET}/DATOS.json`,
      {
        method: 'HEAD',
        headers: { 'Authorization': `Bearer ${SUPA_KEY}`, 'apikey': SUPA_KEY },
        signal: AbortSignal.timeout(5000),
      }
    );
    return res.status !== 401 && res.status !== 403;
  } catch(e) { return false; }
}

// ── Escribir filas en Google Sheets via Apps Script Web App ──
// Usa text/plain + no-cors: el browser envía la petición pero no puede leer la respuesta
async function gSheetsWrite(scriptUrl, rows) {
  if (!scriptUrl) { console.warn('[GSheets Write] URL no configurada'); return false; }
  try {
    const slim = filtrarColumnas('DATOS', rows);
    const payload = JSON.stringify({ rows: slim, updatedAt: new Date().toISOString(), count: slim.length });
    await fetch(scriptUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    });
    console.info(`[GSheets Write] ✅ ${slim.length} filas enviadas a Google Sheets`);
    return true;
  } catch(e) {
    console.warn('[GSheets Write] Error:', e.message);
    return false;
  }
}

window.SUPA_DB = { supaUpload, supaUploadDirect, supaDownload, supaCheck, gSheetsDownload, gSheetsWrite };
