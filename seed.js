/**
 * seed.js — Convierte archivos Excel/CSV de BASES/ a JSON en data/
 * Uso: node seed.js
 * Requiere: npm install xlsx
 */
const XLSX  = require('xlsx');
const fs    = require('fs');
const path  = require('path');

const BASES = path.join(__dirname, 'BASES');
const DATA  = path.join(__dirname, 'data');

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

// ── Definición de fuentes ────────────────────────────────────────────
const FUENTES = [
  {
    tabla:  'DATOS',
    patron: /DETALLADO_AUDITORIA_HOSPITALARIA.*\.(xlsx|xlsm)$/i,
    hoja:   'DATOS',           // si existe esa hoja, si no usa la primera
    desc:   'Auditoría Hospitalaria principal'
  },
  {
    tabla:  'RCV',
    patron: /BD_RCV.*\.xlsx$/i,
    hoja:   null,              // primera hoja
    desc:   'Ruta Cardiovascular'
  },
  {
    tabla:  'AIU',
    patron: /Reporte_AIU.*\.csv$/i,
    hoja:   null,
    desc:   'Autorizaciones Urgencias'
  },
  {
    tabla:  'DNT',
    patron: /Seguimiento.?DNT.*\.xlsx$/i,
    hoja:   'POWEBI',
    desc:   'Seguimiento Desnutrición'
  },
  {
    tabla:  'CYD',
    patron: /cyd.*\.csv$/i,
    hoja:   null,
    desc:   'Crecimiento y Desarrollo'
  },
  {
    tabla:  'ESTANCIA',
    patron: /ESTANCIA.DETALLADA.*\.(xlsx|csv)$/i,
    hoja:   null,
    desc:   'Estancia Detallada'
  },
];

// ── Leer archivo ─────────────────────────────────────────────────────
function leerArchivo(filePath, hojaPreferida) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    const wb = XLSX.readFile(filePath, { type: 'file', raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
  const wb = XLSX.readFile(filePath, { cellDates: true });
  let sheetName = wb.SheetNames[0];
  if (hojaPreferida && wb.SheetNames.includes(hojaPreferida)) {
    sheetName = hojaPreferida;
  }
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ── Buscar archivo en BASES (recursivo 1 nivel) ──────────────────────
function buscarArchivo(patron) {
  const dirs = [BASES, ...fs.readdirSync(BASES)
    .map(f => path.join(BASES, f))
    .filter(f => fs.statSync(f).isDirectory())];

  for (const dir of dirs) {
    try {
      const archivos = fs.readdirSync(dir);
      const match = archivos.find(f => patron.test(f));
      if (match) return path.join(dir, match);
    } catch {}
  }
  return null;
}

// ── Procesar cada fuente ─────────────────────────────────────────────
let total = 0;
for (const fuente of FUENTES) {
  process.stdout.write(`⏳ Buscando ${fuente.desc}... `);
  const archivo = buscarArchivo(fuente.patron);

  if (!archivo) {
    console.log('❌ No encontrado (se omite)');
    continue;
  }

  try {
    const rows = leerArchivo(archivo, fuente.hoja);
    const outPath = path.join(DATA, fuente.tabla + '.json');
    const payload = { rows, fileName: path.basename(archivo), ts: new Date().toISOString() };
    fs.writeFileSync(outPath, JSON.stringify(payload));
    console.log(`✅ ${rows.length.toLocaleString()} registros → data/${fuente.tabla}.json`);
    total++;
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

console.log(`\n✔ Seed completo — ${total} fuentes procesadas.`);
console.log('  Ejecuta "node server.js" para iniciar la app.\n');
