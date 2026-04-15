const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const XLSX    = require('xlsx');
const { syncDrive, getLastSyncInfo, credentialsExist } = require('./drive-sync');

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

// ── Sincronización Google Sheets ──────────────────────────────

let syncInProgress = false;
let syncLog = [];

app.get('/api/drive-status', (req, res) => {
  res.json({
    configured: credentialsExist(),
    inProgress: syncInProgress,
    lastSync: getLastSyncInfo(),
  });
});

app.post('/api/drive-sync', async (req, res) => {
  if (syncInProgress) return res.json({ ok: false, error: 'Sincronización ya en progreso' });
  const force = req.body && req.body.force === true;
  syncInProgress = true;
  syncLog = [];
  try {
    const result = await syncDrive({ force, onProgress: msg => syncLog.push(msg) });
    syncInProgress = false;
    res.json({ ok: true, result, log: syncLog });
  } catch (err) {
    syncInProgress = false;
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/drive-sync-log', (req, res) => {
  res.json({ inProgress: syncInProgress, log: syncLog });
});

// ── Cron diario para Vercel (llamado por Vercel Cron Jobs) ────
// Vercel llama a este endpoint según el schedule en vercel.json
app.get('/api/cron-sync', async (req, res) => {
  // Verificar que viene de Vercel cron (header de seguridad)
  const auth = req.headers['authorization'];
  if (process.env.VERCEL && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (syncInProgress) return res.json({ ok: false, message: 'Ya en progreso' });
  syncInProgress = true;
  try {
    const result = await syncDrive({ force: false });
    syncInProgress = false;
    res.json({ ok: true, synced: result.synced?.length || 0, skipped: result.skipped?.length || 0 });
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

// ── Solo en local: sync al arrancar ──────────────────────────
if (!process.env.VERCEL) {
  setTimeout(async () => {
    console.log('\n🔄 Sincronizando con Google Sheets al inicio...');
    syncInProgress = true;
    try {
      const result = await syncDrive({ force: false });
      if (result.synced?.length > 0) {
        console.log(`✅ ${result.synced[0].rows.toLocaleString()} registros cargados.`);
      } else if (result.skipped?.length > 0) {
        console.log('⏭️  Datos recientes, sin re-descarga.');
      } else if (!result.ok) {
        console.log(`❌ ${result.error}`);
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
