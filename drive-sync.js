// ============================================================
// SINCRONIZACIÓN — GOOGLE SHEETS (sin API key, sin credenciales)
// Archivo: DETALLADO_AUDITORIA_HOSPITALARIA
// URL: https://docs.google.com/spreadsheets/d/1BvYBlquNuIbRyvDE-Ej5KbHv9zyVCaa2
// El archivo debe ser público ("Cualquiera con el enlace puede ver")
// ============================================================
const https    = require('https');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const XLSX     = require('xlsx');

const SHEET_ID       = '1BvYBlquNuIbRyvDE-Ej5KbHv9zyVCaa2';  // ← Sheet que actualiza el Apps Script diariamente
// En Vercel el filesystem es solo lectura excepto /tmp
const DATA_DIR       = process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data');
const LAST_SYNC_FILE = path.join(DATA_DIR, '_drive_last_sync.json');
const SYNC_META_FILE = path.join(DATA_DIR, '_drive_sync_meta.json');

// URL directa de descarga como XLSX (no requiere autenticación si es público)
// El Sheet debe estar configurado como "Cualquiera con el enlace puede ver"
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;

// ── HTTP GET con soporte de redirecciones ──────────────────
function fetchBuffer(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      // Seguir redirecciones (Google Drive redirige varias veces)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Demasiadas redirecciones'));
        return fetchBuffer(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar archivo`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Timeout: el archivo tardó demasiado')); });
  });
}

// ── Sincronización principal ───────────────────────────────
async function syncDrive(options = {}) {
  const { force = false, onProgress = null } = options;

  const log = msg => {
    console.log(`[Sync] ${msg}`);
    if (onProgress) onProgress(msg);
  };

  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    synced: [],
    skipped: [],
    errors: [],
  };

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Ver si ya hay datos recientes (menos de 1 hora) y no es forzado
    if (!force) {
      try {
        const meta = JSON.parse(fs.readFileSync(SYNC_META_FILE, 'utf8'));
        const diff = (Date.now() - new Date(meta.downloadedAt).getTime()) / 60000;
        if (diff < 60) {
          log(`Datos recientes (hace ${Math.round(diff)} min). Usa "Forzar" para re-descargar.`);
          result.skipped.push({ name: 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx', reason: `Descargado hace ${Math.round(diff)} minutos` });
          return result;
        }
      } catch {}
    }

    log('Conectando con Google Sheets...');
    log(`URL: ${EXPORT_URL}`);

    const buffer = await fetchBuffer(EXPORT_URL);
    log(`Archivo descargado: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Parsear XLSX
    log('Procesando datos...');
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

    // Buscar la hoja correcta
    let sheetName = wb.SheetNames[0];
    if (wb.SheetNames.includes('POWEBI')) sheetName = 'POWEBI';
    else if (wb.SheetNames.includes('DATOS')) sheetName = 'DATOS';
    log(`Hoja usada: "${sheetName}" (disponibles: ${wb.SheetNames.join(', ')})`);

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    log(`Filas procesadas: ${rows.length.toLocaleString('es-CO')}`);

    if (!rows.length) throw new Error('El archivo descargado no tiene datos');

    // Guardar en data/DATOS.json
    const fileName = 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx';
    const payload = {
      rows,
      fileName,
      uploadedAt: new Date().toISOString(),
      source: 'google-sheets',
      sheetId: SHEET_ID,
    };
    fs.writeFileSync(path.join(DATA_DIR, 'DATOS.json'), JSON.stringify(payload));

    // Guardar meta de último sync
    fs.writeFileSync(SYNC_META_FILE, JSON.stringify({
      downloadedAt: new Date().toISOString(),
      rows: rows.length,
      sheetId: SHEET_ID,
      fileName,
    }));

    result.synced.push({ name: fileName, table: 'DATOS', rows: rows.length });
    log(`✅ DATOS actualizado — ${rows.length.toLocaleString('es-CO')} registros guardados.`);

  } catch (err) {
    result.ok = false;
    result.error = err.message;
    log(`❌ Error: ${err.message}`);
    result.errors.push({ name: 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx', error: err.message });
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LAST_SYNC_FILE, JSON.stringify(result, null, 2));
  return result;
}

function getLastSyncInfo() {
  try { return JSON.parse(fs.readFileSync(LAST_SYNC_FILE, 'utf8')); } catch { return null; }
}

// Siempre configurado (no necesita credenciales)
function credentialsExist() { return true; }

module.exports = { syncDrive, getLastSyncInfo, credentialsExist };
