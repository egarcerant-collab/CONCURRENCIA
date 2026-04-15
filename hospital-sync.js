// ============================================================
//  hospital-sync.js — Descarga XLSX directo del hospital
//  Sin Google Apps Script, sin Google Sheets
//  Hospital: http://asdempleados.dusakawiepsi.com:8080/sie_dusakawi
// ============================================================
'use strict';

const http  = require('http');
const https = require('https');
const XLSX  = require('xlsx');
const path  = require('path');
const fs    = require('fs');

const USUARIO      = '1067815531';
const CLAVE        = 'Wanoseshas2015@';
const BASE_URL     = 'http://asdempleados.dusakawiepsi.com:8080/sie_dusakawi';
const FECHA_INICIO = '2026/01/01';
const DATA_DIR     = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const META_FILE    = () => path.join(DATA_DIR, '_hospital_sync_meta.json');

const SUPA_HOST = 'sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY  = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';

const COLS_DATOS = [
  'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
  'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso',
  'Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico',
  'Cie10 Egreso','Estancia','Programa Riesgo','Gestacion','Via Parto',
  'Dx Gestante','Control Prenatal','Reingreso','Auditor','Glosas',
  'Valor Total Glosa','Eventos Adversos','Cantidad Evento no calidad',
  'Observación Seguimiento','Patologia alto costo','Especialidad',
  'Patologia Alto Costo','IPS Primaria'
];

// ── HTTP helper con soporte de redirects ──────────────────────
function httpFetch(url, opts = {}, depth = 8) {
  return new Promise((resolve, reject) => {
    if (depth <= 0) return reject(new Error('Demasiadas redirecciones'));
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const proto   = isHttps ? https : http;
    const body    = opts.body ? Buffer.from(opts.body, 'utf8') : null;

    const reqOpts = {
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     u.pathname + u.search,
      method:   opts.method || 'GET',
      headers:  {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9',
        ...opts.headers,
        ...(body ? { 'Content-Length': String(body.length) } : {}),
      },
    };

    const req = proto.request(reqOpts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : `${u.protocol}//${u.host}${loc}`;
        const nextMethod = (res.statusCode === 303 || (opts.method === 'POST' && [301, 302].includes(res.statusCode))) ? 'GET' : opts.method;
        const nextOpts = { ...opts, method: nextMethod || 'GET' };
        if (nextMethod === 'GET') delete nextOpts.body;
        return httpFetch(next, nextOpts, depth - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers:    res.headers,
        buffer:     Buffer.concat(chunks),
        text()      { return this.buffer.toString('utf8'); },
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Timeout (90s)')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Helpers JSF ───────────────────────────────────────────────
function buildBody(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v || '')}`)
    .join('&');
}

function parseCookies(existing, headers) {
  const map = {};
  if (existing) existing.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k && k.trim()) map[k.trim()] = v.join('=');
  });
  const sc = headers['set-cookie'];
  if (sc) (Array.isArray(sc) ? sc : [sc]).forEach(line => {
    const [kv] = line.split(';');
    const [k, ...v] = kv.trim().split('=');
    if (k && k.trim()) map[k.trim()] = v.join('=');
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

function extractViewState(html) {
  let m = html.match(/<update id="javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/);
  if (m) return m[1];
  m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  if (m) return m[1].replace(/&amp;/g, '&').replace(/&#58;/g, ':').replace(/&#43;/g, '+');
  m = html.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  if (m) return m[1].replace(/&amp;/g, '&').replace(/&#58;/g, ':').replace(/&#43;/g, '+');
  return null;
}

// ── Supabase Storage upload ───────────────────────────────────
function uploadSupabase(jsonStr) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(jsonStr, 'utf8');
    const req = https.request({
      hostname: SUPA_HOST,
      path:     '/storage/v1/object/indicadores/DATOS.json',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${SUPA_KEY}`,
        'apikey':        SUPA_KEY,
        'Content-Type':  'application/json',
        'Content-Length': buf.length,
        'x-upsert':      'true',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`Supabase ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Supabase timeout')); });
    req.write(buf);
    req.end();
  });
}

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────────
async function syncHospital(options = {}) {
  const { force = false, onProgress = null } = options;
  const log = msg => { console.log(`[Hospital] ${msg}`); if (onProgress) onProgress(msg); };
  const result = { ok: true, timestamp: new Date().toISOString() };

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Verificar caché reciente
    if (!force) {
      try {
        const meta = JSON.parse(fs.readFileSync(META_FILE(), 'utf8'));
        const diffMin = (Date.now() - new Date(meta.downloadedAt).getTime()) / 60000;
        if (diffMin < 60) {
          log(`Datos recientes (hace ${Math.round(diffMin)} min). Usa "Forzar" para re-descargar.`);
          result.skipped = true;
          result.rows = meta.rows || 0;
          return result;
        }
      } catch {}
    }

    // Fecha actual en zona horaria Colombia
    const bogota = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const hoy = `${bogota.getFullYear()}/${String(bogota.getMonth()+1).padStart(2,'0')}/${String(bogota.getDate()).padStart(2,'0')}`;
    const ano = String(bogota.getFullYear());
    log(`Período: ${FECHA_INICIO} → ${hoy}`);

    // ── PASO 1: Login page ──────────────────────────────────────
    log('[1/5] Cargando login...');
    const r1 = await httpFetch(BASE_URL + '/login.xhtml');
    let cookies = parseCookies('', r1.headers);
    let vs = extractViewState(r1.text());
    if (!vs) throw new Error('ViewState no encontrado en login');

    // ── PASO 2: Login POST ──────────────────────────────────────
    log('[2/5] Iniciando sesión...');
    const r2 = await httpFetch(BASE_URL + '/login.xhtml', {
      method: 'POST',
      headers: { 'Cookie': cookies, 'Referer': BASE_URL + '/login.xhtml', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildBody({ 'j_idt19': 'j_idt19', 'j_idt19:j_idt24': USUARIO, 'j_idt19:j_idt28': CLAVE, 'j_idt19:j_idt32': ano, 'j_idt19:j_idt37': '', 'javax.faces.ViewState': vs }),
    });
    cookies = parseCookies(cookies, r2.headers);
    log(`Login: HTTP ${r2.statusCode}`);

    // ── PASO 3: Página auditoría ────────────────────────────────
    log('[3/5] Cargando auditoría hospitalaria...');
    const audUrl = BASE_URL + '/pages/audit/auditoria_hospitalaria/auditoria_hospitalaria.xhtml';
    const r3 = await httpFetch(audUrl, { headers: { 'Cookie': cookies } });
    cookies = parseCookies(cookies, r3.headers);
    vs = extractViewState(r3.text());
    if (!vs) throw new Error('ViewState no encontrado en auditoría');

    // ── PASO 4: AJAX exportación ────────────────────────────────
    log('[4/5] Activando panel de exportación...');
    const r4 = await httpFetch(audUrl, {
      method: 'POST',
      headers: { 'Cookie': cookies, 'Referer': audUrl, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' },
      body: buildBody({
        'javax.faces.partial.ajax': 'true', 'javax.faces.source': 'j_idt158',
        'javax.faces.partial.execute': '@all', 'javax.faces.partial.render': '@all',
        'j_idt158': 'j_idt158', 'formMtto': 'formMtto',
        'j_idt107_focus': '', 'j_idt107_input': '1', 'txtNumeroIdentificacionQ': '',
        'fechaInicioQ_input': FECHA_INICIO, 'fechaFinQ_input': hoy,
        'ips_input': '', 'ips_hinput': '', 'cmbEstadoSeguimiento_focus': '', 'cmbEstadoSeguimiento_input': '-1',
        'javax.faces.ViewState': vs,
      }),
    });
    cookies = parseCookies(cookies, r4.headers);
    const ajaxText = r4.text();
    const vsNew = extractViewState(ajaxText) || vs;
    log('AJAX OK — ' + ajaxText.length + ' bytes');
    // Buscar IDs de botones en respuesta (para diagnóstico)
    const btns = ajaxText.match(/name="(j_idt\d+)"[^>]*(type="submit"|class="[^"]*btn[^"]*")/g);
    if (btns) log('Botones detectados: ' + btns.slice(0,5).join(' | '));

    // ── PASO 5: Descargar XLSX ──────────────────────────────────
    log('[5/5] Descargando XLSX...');
    const r5 = await httpFetch(audUrl, {
      method: 'POST',
      headers: { 'Cookie': cookies, 'Referer': audUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildBody({
        'formMtto': 'formMtto',
        'txtDepartamentoReporte_input': '', 'txtDepartamentoReporte_hinput': '',
        'j_idt1443_input': '', 'j_idt1443_hinput': '',
        'municipioDepRes_input': '', 'municipioDepRes_hinput': '',
        'txtFechaAutorizaInicio_input': FECHA_INICIO, 'txtFechaAutorizaFin_input': hoy,
        'cmbSwReingreso_focus': '', 'cmbSwReingreso_input': '1',
        'j_idt1460': '', 'j_idt1466': 'j_idt1466',
        'javax.faces.ViewState': vsNew,
      }),
    });

    const buf = r5.buffer;
    const isXlsx = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4B; // PK = ZIP
    log(`HTTP ${r5.statusCode} | ${buf.length} bytes | XLSX válido: ${isXlsx}`);

    if (!isXlsx) {
      log('El hospital devolvió HTML en lugar de XLSX. Primeros 500 chars:');
      log(buf.slice(0, 500).toString('utf8'));
      throw new Error(`El hospital no devolvió un archivo Excel válido (${buf.length} bytes de HTML). Los IDs del formulario de exportación son incorrectos — ver log para diagnóstico.`);
    }

    // ── Parsear XLSX ─────────────────────────────────────────────
    log('Parseando XLSX...');
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.includes('POWEBI')) sheetName = 'POWEBI';
    else if (wb.SheetNames.includes('DATOS')) sheetName = 'DATOS';
    log(`Hoja: "${sheetName}" — disponibles: ${wb.SheetNames.join(', ')}`);
    let rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    log(`Filas parseadas: ${rows.length.toLocaleString('es-CO')}`);
    if (!rows.length) throw new Error('El XLSX no tiene filas de datos');

    // Filtrar columnas esenciales
    const reales = Object.keys(rows[0]);
    const normMap = {};
    reales.forEach(r => { normMap[r.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()] = r; });
    const usar = COLS_DATOS.filter(c => rows[0][c] !== undefined || normMap[c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()]);
    if (usar.length > 0) {
      rows = rows.map(r => { const o = {}; usar.forEach(c => { o[c] = r[c] ?? ''; }); return o; });
    }

    const payload = {
      rows,
      fileName:   'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx',
      uploadedAt: new Date().toISOString(),
      source:     'hospital-direct',
    };
    const payloadStr = JSON.stringify(payload);

    // Guardar en /tmp
    fs.writeFileSync(path.join(DATA_DIR, 'DATOS.json'), payloadStr);
    log(`/tmp/DATOS.json guardado — ${rows.length} filas`);

    // Subir a Supabase
    let supaOk = false;
    try {
      await uploadSupabase(payloadStr);
      supaOk = true;
      log(`✅ Supabase OK — ${rows.length} filas`);
    } catch(e) {
      log(`⚠️ Supabase error (no crítico): ${e.message}`);
    }

    // Guardar meta
    fs.writeFileSync(META_FILE(), JSON.stringify({ downloadedAt: new Date().toISOString(), rows: rows.length, supabase: supaOk }));
    result.rows = rows.length;
    result.supabase = supaOk;
    log(`=== ✅ ÉXITO — ${rows.length} registros actualizados ===`);

  } catch(e) {
    result.ok = false;
    result.error = e.message;
    log(`❌ ${e.message}`);
  }

  return result;
}

function getLastSyncInfo() {
  try { return JSON.parse(fs.readFileSync(META_FILE(), 'utf8')); } catch { return null; }
}

module.exports = { syncHospital, getLastSyncInfo };
