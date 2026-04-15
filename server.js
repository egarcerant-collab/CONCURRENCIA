const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { syncDrive, getLastSyncInfo, credentialsExist } = require('./drive-sync');

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
