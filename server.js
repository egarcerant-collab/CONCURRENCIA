const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const XLSX    = require('xlsx');
const multer  = require('multer');
const { syncDrive, getLastSyncInfo: getDriveSyncInfo, credentialsExist } = require('./drive-sync');
const { syncHospital, getLastSyncInfo: getHospitalSyncInfo } = require('./hospital-sync');

// ── Supabase Storage (mismas credenciales que el frontend) ────
const SUPA_HOST = 'sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY  = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';
const COLS_DATOS = ['IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion','Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso','Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico','Cie10 Egreso','Estancia','Programa Riesgo','Gestacion','Via Parto','Dx Gestante','Control Prenatal','Reingreso','Auditor','Glosas','Valor Total Glosa','Eventos Adversos','Cantidad Evento no calidad','Observación Seguimiento','Patologia alto costo','Especialidad','Patologia Alto Costo','IPS Primaria'];

function uploadToSupabase(jsonStr) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(jsonStr, 'utf8');
    const req = https.request({
      hostname: SUPA_HOST,
      path: '/storage/v1/object/indicadores/DATOS.json',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPA_KEY}`,
        'apikey': SUPA_KEY,
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
        'x-upsert': 'true'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`Supabase ${res.statusCode}: ${data.slice(0,200)}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Supabase timeout')); });
    req.write(buf);
    req.end();
  });
}

const app     = express();
const PORT    = process.env.PORT || 3002;
const DATA_DIR = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API de datos ──────────────────────────────────────────────

app.post('/api/data/:table', (req, res) => {
  try {
    const tableName = req.params.table.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const payload = req.body;
    payload.uploadedAt = new Date().toISOString();
    fs.writeFileSync(path.join(DATA_DIR, `${tableName}.json`), JSON.stringify(payload));
    res.json({ success: true, rows: payload.rows ? payload.rows.length : 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Guardar Detallado en Supabase (recibe JSON desde el browser) ──
// Se llama desde el botón "Guardar en Supabase" del dashboard
app.post('/api/save-detallado', async (req, res) => {
  try {
    const { rows, fileName, tipoReporte = 1, source = 'manual-upload' } = req.body || {};
    if (!rows || !rows.length) {
      return res.status(400).json({ ok: false, error: 'No hay filas para guardar' });
    }
    const payload = {
      rows,
      fileName: fileName || 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx',
      tipoReporte,
      source,
      uploadedAt: new Date().toISOString(),
    };
    const payloadStr = JSON.stringify(payload);
    // Guardar en /tmp
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'DATOS.json'), payloadStr);
    // Subir a Supabase
    await uploadToSupabase(payloadStr);
    console.log(`[save-detallado] ✅ ${rows.length} filas guardadas en Supabase`);
    res.json({ ok: true, rows: rows.length, uploadedAt: payload.uploadedAt });
  } catch(e) {
    console.error('[save-detallado]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/data/:table', (req, res) => {
  const filePath = path.join(DATA_DIR, `${req.params.table}.json`);
  if (!fs.existsSync(filePath)) return res.json(null);
  try {
    res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (e) { res.json(null); }
});

app.get('/api/tables', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const tables = files.map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        return { name: f.replace('.json',''), rows: d.rows ? d.rows.length : 0, uploadedAt: d.uploadedAt };
      } catch { return { name: f.replace('.json',''), rows: 0 }; }
    });
    res.json(tables);
  } catch (e) { res.json([]); }
});

app.delete('/api/data/:table', (req, res) => {
  const filePath = path.join(DATA_DIR, `${req.params.table}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

// ── Sincronización HOSPITAL (sin Google) ──────────────────────
let syncInProgress = false;
let syncLog = [];

app.get('/api/drive-status', (req, res) => {
  res.json({
    configured: true,
    inProgress: syncInProgress,
    lastSync: getHospitalSyncInfo() || getDriveSyncInfo(),
  });
});

// Endpoint principal — descarga directo del hospital → Supabase
app.post('/api/drive-sync', async (req, res) => {
  if (syncInProgress) return res.json({ ok: false, error: 'Sincronización ya en progreso' });
  const force = req.body && req.body.force === true;
  syncInProgress = true;
  syncLog = [];
  try {
    const result = await syncHospital({ force, onProgress: msg => syncLog.push(msg) });
    syncInProgress = false;
    if (result.ok && !result.skipped) {
      res.json({ ok: true, result: { synced: [{ name: 'DATOS', rows: result.rows }] }, log: syncLog });
    } else if (result.skipped) {
      res.json({ ok: true, result: { skipped: [{ name: 'DATOS', reason: 'Datos recientes' }] }, log: syncLog });
    } else {
      res.json({ ok: false, error: result.error, log: syncLog });
    }
  } catch (err) {
    syncInProgress = false;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/drive-sync-log', (req, res) => {
  res.json({ inProgress: syncInProgress, log: syncLog });
});

// Cron diario Vercel — descarga automática del hospital a las 7 AM Colombia
app.get('/api/hospital-sync', async (req, res) => {
  if (syncInProgress) return res.json({ ok: false, message: 'Ya en progreso' });
  syncInProgress = true;
  syncLog = [];
  try {
    const result = await syncHospital({ force: false, onProgress: msg => syncLog.push(msg) });
    syncInProgress = false;
    res.json({ ok: result.ok, rows: result.rows || 0, skipped: !!result.skipped, error: result.error, log: syncLog });
  } catch (err) {
    syncInProgress = false;
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Recibir XLSX directo desde Apps Script → Supabase ─────────
// Apps Script llama POST /api/upload-from-script con el binario XLSX
app.post('/api/upload-from-script', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  try {
    const buffer = req.body;
    if (!buffer || buffer.length < 1000) {
      return res.status(400).json({ ok: false, error: `Datos insuficientes: ${buffer?.length || 0} bytes` });
    }
    // Validar magic bytes XLSX (PK = cabecera ZIP)
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
      const preview = buffer.slice(0, 300).toString('utf8');
      return res.status(400).json({ ok: false, error: 'No es XLSX válido — el servidor del hospital devolvió HTML en vez de Excel. Revisa los IDs del formulario de exportación.', preview });
    }
    // Parsear XLSX
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.includes('POWEBI')) sheetName = 'POWEBI';
    else if (wb.SheetNames.includes('DATOS')) sheetName = 'DATOS';
    const ws = wb.Sheets[sheetName];
    let rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return res.status(400).json({ ok: false, error: 'El XLSX no tiene filas de datos' });

    // Filtrar solo columnas esenciales (igual que supabase-db.js)
    if (rows.length > 0) {
      const reales = Object.keys(rows[0]);
      const normR = reales.map(r => r.toLowerCase().trim());
      const usar = COLS_DATOS.filter(c => {
        return rows[0][c] !== undefined || normR.includes(c.toLowerCase().trim());
      });
      if (usar.length > 0) {
        rows = rows.map(r => {
          const o = {};
          usar.forEach(c => { o[c] = r[c] ?? ''; });
          return o;
        });
      }
    }

    const payload = {
      rows,
      fileName: 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx',
      uploadedAt: new Date().toISOString(),
      source: 'apps-script-direct',
    };
    const payloadStr = JSON.stringify(payload);

    // 1. Guardar en /tmp (acceso inmediato)
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'DATOS.json'), payloadStr);
    console.log(`[upload-from-script] ${rows.length} filas guardadas en /tmp`);

    // 2. Subir a Supabase Storage (persistencia entre cold starts)
    let supaOk = false, supaError = null;
    try {
      await uploadToSupabase(payloadStr);
      supaOk = true;
      console.log(`[upload-from-script] Supabase OK — ${rows.length} filas`);
    } catch(e) {
      supaError = e.message;
      console.error('[upload-from-script] Supabase error:', e.message);
    }

    res.json({ ok: true, rows: rows.length, sheet: sheetName, supabase: supaOk, supaError, uploadedAt: payload.uploadedAt });
  } catch(e) {
    console.error('[upload-from-script]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Subida manual de Excel Detallado desde el navegador ──────
// Acepta multipart/form-data con campo "file" → XLSX
// Guarda con source='manual-upload', tipoReporte=1 → el auto-sync no sobreescribe
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.post('/api/upload-detallado', upload.single('file'), async (req, res) => {
  try {
    const buffer = req.file ? req.file.buffer : req.body;
    if (!buffer || buffer.length < 1000) {
      return res.status(400).json({ ok: false, error: `Archivo insuficiente: ${buffer?.length || 0} bytes` });
    }
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
      return res.status(400).json({ ok: false, error: 'No es un archivo XLSX válido (cabecera incorrecta)' });
    }

    // Parsear XLSX
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.includes('DATOS'))   sheetName = 'DATOS';
    if (wb.SheetNames.includes('POWEBI'))  sheetName = 'POWEBI';
    const ws = wb.Sheets[sheetName];
    let rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return res.status(400).json({ ok: false, error: 'El archivo no tiene filas de datos' });

    // Normalizar columnas (soporta tildes/acentos)
    function normCol(s) { return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
    const reales = Object.keys(rows[0]);
    const normMap = {};
    reales.forEach(r => { normMap[normCol(r)] = r; });
    const usar = COLS_DATOS.filter(c => rows[0][c] !== undefined || normMap[normCol(c)] !== undefined);
    if (usar.length > 0) {
      rows = rows.map(r => {
        const o = {};
        usar.forEach(c => { o[c] = r[c] ?? r[normMap[normCol(c)]] ?? ''; });
        return o;
      });
    }

    const uploadedAt = new Date().toISOString();
    const fileName   = req.file ? req.file.originalname : 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx';
    const payload = {
      rows,
      fileName,
      uploadedAt,
      source:      'manual-upload',   // ← marca que NO debe ser sobreescrito por auto-sync
      tipoReporte: 1,                  // ← Detallado Auditoria Hospitalaria
    };
    const payloadStr = JSON.stringify(payload);

    // Guardar en /tmp
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'DATOS.json'), payloadStr);
    console.log(`[upload-detallado] ${rows.length} filas guardadas localmente`);

    // Subir a Supabase
    let supaOk = false, supaError = null;
    try {
      await uploadToSupabase(payloadStr);
      supaOk = true;
      console.log(`[upload-detallado] Supabase OK — ${rows.length} filas (tipo=1 manual)`);
    } catch(e) {
      supaError = e.message;
      console.error('[upload-detallado] Supabase error:', e.message);
    }

    res.json({
      ok: true,
      rows: rows.length,
      sheet: sheetName,
      fileName,
      uploadedAt,
      supabase: supaOk,
      supaError,
      message: `✅ ${rows.length.toLocaleString('es-CO')} registros Detallado guardados correctamente`,
    });
  } catch(e) {
    console.error('[upload-detallado]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Solo en local: sync al arrancar ──────────────────────────
if (!process.env.VERCEL) {
  setTimeout(async () => {
    console.log('\n🔄 Sincronizando con hospital al inicio...');
    syncInProgress = true;
    try {
      const result = await syncHospital({ force: false });
      if (result.ok && !result.skipped) {
        console.log(`✅ ${(result.rows||0).toLocaleString()} registros cargados del hospital.`);
      } else if (result.skipped) {
        console.log('⏭️  Datos recientes, sin re-descarga.');
      } else {
        console.log(`⚠️  ${result.error}`);
      }
    } catch (err) { console.error('❌ Error:', err.message); }
    syncInProgress = false;
  }, 3000);
}

// ── Arrancar servidor ─────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ Servidor corriendo en: http://localhost:${PORT}`);
    console.log(`📁 Datos: ${DATA_DIR}\n`);
  });
}

module.exports = app;
