#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
//  CONVERTOR INFORME 4505 — Dusakawi EPS
//  Resolución 4505 MINSALUD Colombia — Formato pipe-delimited
//
//  USOS:
//    node convertir_4505.js archivo.txt
//    node convertir_4505.js archivo.txt --solo-local
//    node convertir_4505.js archivo.txt --drive-token ya29.XXXXX
//    DRIVE_ACCESS_TOKEN=ya29.XXX node convertir_4505.js archivo.txt
//
//  OBTENER TOKEN DE DRIVE (válido 1 hora):
//    1. Ir a https://developers.google.com/oauthplayground
//    2. Buscar "Drive API v3" → scope: .../auth/drive.file
//    3. Autorizar con tu cuenta Google
//    4. Copiar el "Access token"
// ══════════════════════════════════════════════════════════════════
'use strict';
const fs   = require('fs');
const path = require('path');

// ── Credenciales Supabase (proyecto Dusakawi) ─────────────────────
const SUPA_URL    = 'https://sstuwlwukjokhjbtelig.supabase.co';
const SUPA_KEY    = 'sb_publishable_kF5Vvgn0HYk7vo-JpPLFjA_BdfmobDK';
const SUPA_BUCKET = 'indicadores';
const MAX_CHUNK   = 5000;   // filas por chunk Supabase (~15 MB)

// ── Carpeta de Drive destino ──────────────────────────────────────
const DRIVE_FOLDER_ID = '1GvJuv9M4tssWIKwI9gA5TyUqFLigLIQc';

// ══════════════════════════════════════════════════════════════════
//  MAPA DE COLUMNAS — Res. 4505 MINSALUD (119 campos, índice 0–118)
// ══════════════════════════════════════════════════════════════════
const COLS = [
  /* 0  */ 'tipo_registro',           // Siempre "2" (registro detalle)
  /* 1  */ 'id_interno',              // ID consecutivo en el sistema fuente
  /* 2  */ 'codigo_ips',              // Código habilitación IPS (12 dígitos)
  /* 3  */ 'tipo_documento',          // CC TI RC CE PA MS AS
  /* 4  */ 'numero_documento',
  /* 5  */ 'primer_apellido',
  /* 6  */ 'segundo_apellido',
  /* 7  */ 'primer_nombre',
  /* 8  */ 'segundo_nombre',
  /* 9  */ 'fecha_nacimiento',        // YYYY-MM-DD
  /* 10 */ 'sexo',                    // F / M
  /* 11 */ 'clasificacion_poblacional', // 1=General 2=Beneficiario 5=Vinculado 6=Gestante/Especial
  /* 12 */ 'codigo_municipio',        // DIVIPOLA 4-5 dígitos (9999=sin municipio)
  /* 13 */ 'actividades_periodo',     // Cantidad de actividades registradas
  /* 14 */ 'ind_riesgo_cv',           // Estado riesgo cardiovascular
  /* 15 */ 'ind_riesgo_dm',           // Estado riesgo diabetes
  /* 16 */ 'ind_riesgo_renal',        // Estado riesgo renal
  /* 17 */ 'ind_condicion_especial',  // Estado condición especial
  /* 18 */ 'tipo_afiliacion',         // 1=Contributivo 2=Subsidiado 21=Sin info
  /* 19 */ 'cod_dpto_ips',            // Departamento IPS (98=La Guajira)
  /* 20 */ 'ind_crecimiento',         // Detección temprana crecimiento y desarrollo <10a
  /* 21 */ 'ind_joven',               // Detección temprana joven 10-29a
  /* 22 */ 'ind_adulto_mayor',        // Control adulto mayor
  /* 23 */ 'ind_embarazo',            // Detección temprana alteraciones embarazo
  /* 24 */ 'ind_planificacion',       // Planificación familiar
  /* 25 */ 'ind_cancer_cuello',       // Cáncer de cuello uterino
  /* 26 */ 'ind_cancer_seno',         // Cáncer de seno
  /* 27 */ 'ind_cancer_prostata',     // Cáncer de próstata
  /* 28 */ 'ind_agudeza_visual',      // Agudeza visual en menores
  /* 29 */ 'fecha_peso',
  /* 30 */ 'peso_kg',
  /* 31 */ 'fecha_talla',
  /* 32 */ 'talla_cm',
  /* 33 */ 'fecha_imc',
  /* 34 */ 'imc',
  /* 35 */ 'ind_vacunacion',          // Coberturas vacunación
  /* 36 */ 'ind_hta',                 // Hipertensión arterial
  /* 37 */ 'ind_dm2',                 // Diabetes mellitus tipo 2
  /* 38 */ 'ind_epoc',                // EPOC
  /* 39 */ 'ind_salud_mental',
  /* 40 */ 'ind_salud_oral',
  /* 41 */ 'ind_tamiz_neonatal',
  /* 42 */ 'ind_vih',
  /* 43 */ 'ind_tb',
  /* 44 */ 'ind_lepra',
  /* 45 */ 'ind_chagas',
  /* 46 */ 'ind_malaria',
  /* 47 */ 'ind_leishmaniasis',
  /* 48 */ 'ind_ets',
  /* 49 */ 'fecha_control_1',
  /* 50 */ 'fecha_control_2',
  /* 51 */ 'fecha_control_3',
  /* 52 */ 'fecha_control_4',
  /* 53 */ 'fecha_control_5',
  /* 54 */ 'num_controles',
  /* 55 */ 'fecha_ultimo_control',
  /* 56 */ 'fecha_ingreso_programa',
  /* 57 */ 'ind_riesgo_nutricional',
  /* 58 */ 'fecha_valoracion_nutricional',
  /* 59 */ 'ind_lactancia',
  /* 60 */ 'ind_micronutrientes',
  /* 61 */ 'ind_desparasitacion',
  /* 62 */ 'fecha_gine_1',
  /* 63 */ 'fecha_gine_2',
  /* 64 */ 'fecha_gine_3',
  /* 65 */ 'fecha_gine_4',
  /* 66 */ 'fecha_gine_5',
  /* 67 */ 'fecha_gine_6',
  /* 68 */ 'fecha_gine_7',
  /* 69 */ 'fecha_gine_8',
  /* 70 */ 'ind_colposcopia',
  /* 71 */ 'ind_biopsia_cuello',
  /* 72 */ 'fecha_citologia',
  /* 73 */ 'fecha_proxima_citologia',
  /* 74 */ 'ind_mamografia',
  /* 75 */ 'fecha_mamografia',
  /* 76 */ 'fecha_ecografia_mamaria',
  /* 77 */ 'ind_biopsia_seno',
  /* 78 */ 'fecha_psa_1',
  /* 79 */ 'resultado_psa_1',
  /* 80 */ 'fecha_psa_2',
  /* 81 */ 'resultado_psa_2',
  /* 82 */ 'fecha_psa_3',
  /* 83 */ 'resultado_psa_3',
  /* 84 */ 'fecha_biopsia_prostata',
  /* 85 */ 'ind_ekg',
  /* 86 */ 'ind_fondo_ojo',
  /* 87 */ 'fecha_fondo_ojo',
  /* 88 */ 'ind_microalbuminuria',
  /* 89 */ 'ind_creatinina',
  /* 90 */ 'ind_tft',
  /* 91 */ 'fecha_lab_metabolico',
  /* 92 */ 'colesterol_total',
  /* 93 */ 'fecha_colesterol',
  /* 94 */ 'hdl',
  /* 95 */ 'ldl',
  /* 96 */ 'fecha_lipidos',
  /* 97 */ 'trigliceridos',
  /* 98 */ 'glucemia_ayunas',
  /* 99 */ 'fecha_glucemia',
  /* 100*/ 'fecha_hba1c',
  /* 101*/ 'resultado_hba1c',
  /* 102*/ 'ind_hba1c',
  /* 103*/ 'fecha_ultimo_lab',
  /* 104*/ 'valor_ultimo_lab',
  /* 105*/ 'fecha_hemograma',
  /* 106*/ 'fecha_perfil_lipidico',
  /* 107*/ 'ind_espirometria',
  /* 108*/ 'fecha_espirometria',
  /* 109*/ 'ind_rx_torax',
  /* 110*/ 'fecha_rx_torax',
  /* 111*/ 'fecha_ultimo_egreso',
  /* 112*/ 'fecha_proxima_cita',
  /* 113*/ 'prioridad',               // 1=Urgente 2=Prioritaria 3=Normal 4=Seguimiento
  /* 114*/ 'estado_indicador',        // 0=NoCumple 1=Cumple 3=EnProceso 4=NoAplica 5=Parcial
  /* 115*/ 'pendiente_actividad',
  /* 116*/ 'actividad_complementaria',
  /* 117*/ 'resultado_global',
  /* 118*/ 'fecha_proximo_control',
];

// ── Fechas "vacías" del sistema SISPRO/MINSALUD ───────────────────
const FECHAS_NULAS = new Set(['1800-01-01','1845-01-01','1845-01-02','0','']);

// Campos que son fechas (detectados por nombre)
function esFecha(nombre) {
  return nombre.startsWith('fecha') || nombre.endsWith('_fecha');
}

function parsearCampo(nombre, raw) {
  const v = (raw ?? '').trim();
  if (v === '' || v === 'NONE') return null;
  if (esFecha(nombre)) return FECHAS_NULAS.has(v) ? null : v;
  const n = Number(v);
  return isNaN(n) ? v : n;
}

// ── Etiquetas legibles ────────────────────────────────────────────
const TIPO_DOC_DESC = {
  CC:'Cédula Ciudadanía', RC:'Registro Civil', TI:'Tarjeta Identidad',
  CE:'Cédula Extranjería', PA:'Pasaporte', MS:'Menor Sin ID', AS:'Adulto Sin ID',
  CN:'Certificado Nacimiento', PE:'Permiso Especial',
};
const ESTADO_IND_DESC = {
  0:'No cumple', 1:'Cumple', 2:'Parcialmente cumple', 3:'En proceso',
  4:'No aplica', 5:'Con resultado', 6:'Programado', 20:'Remitido',
  21:'Sin programar', 98:'Sin información', 99:'No determinado',
  998:'No aplica (esp)', 999:'Sin dato',
};

// ── Parsear una línea → objeto ────────────────────────────────────
function parsearLinea(linea) {
  if (!linea) return null;
  const campos = linea.split('|');
  if (campos.length < 15 || campos[0].trim() !== '2') return null;

  const r = {};
  COLS.forEach((col, i) => { r[col] = parsearCampo(col, campos[i]); });

  // Campos enriquecidos
  r.tipo_documento_desc = TIPO_DOC_DESC[r.tipo_documento] || r.tipo_documento;
  r.sexo_desc = r.sexo === 'F' ? 'Femenino' : r.sexo === 'M' ? 'Masculino' : r.sexo;
  r.estado_indicador_desc = ESTADO_IND_DESC[r.estado_indicador] ?? String(r.estado_indicador ?? '');

  const ap2 = r.segundo_apellido ? ` ${r.segundo_apellido}` : '';
  const n2  = r.segundo_nombre   ? ` ${r.segundo_nombre}`   : '';
  r.nombre_completo = `${r.primer_apellido || ''}${ap2}, ${r.primer_nombre || ''}${n2}`.trim();

  if (r.fecha_nacimiento) {
    const nac  = new Date(r.fecha_nacimiento);
    const hoy  = new Date();
    const edad = hoy.getFullYear() - nac.getFullYear()
      - (hoy < new Date(hoy.getFullYear(), nac.getMonth(), nac.getDate()) ? 1 : 0);
    r.edad = isNaN(edad) ? null : edad;
  }

  return r;
}

// ══════════════════════════════════════════════════════════════════
//  SUPABASE — upload en chunks
// ══════════════════════════════════════════════════════════════════
async function supaChunk(clave, rows, meta) {
  const body = JSON.stringify({ rows, ...meta, uploadedAt: new Date().toISOString() });
  const mb   = (body.length / 1048576).toFixed(1);
  process.stdout.write(`  [Supabase] ${clave} (${rows.length} filas, ${mb} MB)... `);
  try {
    const r = await fetch(`${SUPA_URL}/storage/v1/object/${SUPA_BUCKET}/${clave}.json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPA_KEY}`, apikey: SUPA_KEY,
                 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body,
      signal: AbortSignal.timeout(90000),
    });
    if (r.ok) { console.log('✅'); return true; }
    const e = await r.text();
    console.log(`❌ HTTP ${r.status}: ${e.slice(0, 120)}`);
    return false;
  } catch (e) { console.log(`❌ ${e.message}`); return false; }
}

async function subirSupabase(nombre, rows, nomArchivo) {
  const nChunks = Math.ceil(rows.length / MAX_CHUNK);
  console.log(`\n── Supabase Storage (${nChunks} chunk${nChunks>1?'s':''}) ─────────────────`);
  let ok = 0;
  for (let i = 0; i < nChunks; i++) {
    const slice = rows.slice(i * MAX_CHUNK, (i+1) * MAX_CHUNK);
    const clave = nChunks > 1 ? `${nombre}_p${String(i+1).padStart(2,'0')}` : nombre;
    const exito = await supaChunk(clave, slice, {
      fileName: nomArchivo, source: 'R4505',
      chunk: i+1, totalChunks: nChunks, totalRegistros: rows.length,
    });
    if (exito) ok++;
  }
  // Índice con preview si hay varios chunks
  if (nChunks > 1) {
    await supaChunk(`${nombre}_idx`, rows.slice(0, 200), {
      fileName: nomArchivo, source: 'R4505_indice',
      totalChunks: nChunks, totalRegistros: rows.length, claveBase: nombre,
    });
  }
  console.log(`  Resultado: ${ok}/${nChunks} chunks exitosos`);
  return ok === nChunks;
}

// ══════════════════════════════════════════════════════════════════
//  GOOGLE DRIVE — upload multipart (OAuth token)
// ══════════════════════════════════════════════════════════════════
async function subirDrive(rutaJson, nombre, token) {
  console.log(`\n── Google Drive ────────────────────────────────────`);

  if (!token) {
    console.log('  ⚠️  No se proporcionó token OAuth.\n');
    console.log('  Para subir automáticamente a Drive:');
    console.log('  1. Ve a https://developers.google.com/oauthplayground');
    console.log('  2. Selecciona "Drive API v3" → scope: .../auth/drive.file');
    console.log('  3. Autoriza con tu cuenta Google → copia el Access Token');
    console.log('  4. Ejecuta:');
    console.log(`     node convertir_4505.js "${rutaJson.replace('.json','.txt')}" --drive-token ya29.TU_TOKEN`);
    console.log('\n  Alternativa rápida: arrastra el archivo JSON a la carpeta de Drive:');
    console.log(`  https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`);
    return null;
  }

  const contenido = fs.readFileSync(rutaJson, 'utf8');
  const boundary  = 'dusak_boundary_4505';
  const meta      = JSON.stringify({ name: nombre, parents: [DRIVE_FOLDER_ID], mimeType: 'application/json' });
  const body      = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${contenido}\r\n--${boundary}--`;

  const mb = (Buffer.byteLength(body) / 1048576).toFixed(1);
  process.stdout.write(`  Subiendo ${nombre} (${mb} MB) a Drive... `);
  try {
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`,
                 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
      signal: AbortSignal.timeout(300000),
    });
    if (r.ok) {
      const d = await r.json();
      const link = `https://drive.google.com/file/d/${d.id}/view`;
      console.log(`✅\n  Enlace: ${link}`);
      return d;
    }
    const e = await r.text();
    console.log(`❌ HTTP ${r.status}: ${e.slice(0, 200)}`);

    if (r.status === 401) {
      console.log('\n  Token expirado o inválido. Genera uno nuevo en:');
      console.log('  https://developers.google.com/oauthplayground');
    }
    return null;
  } catch (e) { console.log(`❌ ${e.message}`); return null; }
}

// ══════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════
async function main() {
  const argv = process.argv.slice(2);

  // Parsear flags
  const soloLocal   = argv.includes('--solo-local');
  const sinDrive    = argv.includes('--sin-drive');
  const tokenIdx    = argv.indexOf('--drive-token');
  const driveToken  = tokenIdx >= 0 ? argv[tokenIdx + 1]
                    : process.env.DRIVE_ACCESS_TOKEN || null;

  // Primer arg que no sea flag
  const skip = new Set(tokenIdx >= 0 ? [argv[tokenIdx + 1]] : []);
  const archivoTxt = argv.find(a => !a.startsWith('--') && !skip.has(a));

  if (!archivoTxt) {
    console.log('Uso: node convertir_4505.js <archivo.txt> [opciones]');
    console.log('  --solo-local       No subir a ninguna nube');
    console.log('  --sin-drive        Subir Supabase pero no Drive');
    console.log('  --drive-token TOK  Token OAuth de Google Drive');
    console.log('\nVariable de entorno alternativa: DRIVE_ACCESS_TOKEN=ya29.xxx');
    process.exit(1);
  }

  if (!fs.existsSync(archivoTxt)) {
    console.error(`❌ Archivo no encontrado: ${archivoTxt}`); process.exit(1);
  }

  // ── Encabezado ────────────────────────────────────────────────
  const nombreBase  = path.basename(archivoTxt, path.extname(archivoTxt));
  const dirSalida   = path.dirname(archivoTxt);
  const archivoJson = path.join(dirSalida, `${nombreBase}.json`);

  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   CONVERTOR INFORME 4505 — Dusakawi EPS            ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`Entrada : ${archivoTxt}`);
  console.log(`Salida  : ${archivoJson}`);
  console.log('');

  // ── Parseo ────────────────────────────────────────────────────
  console.log('── Parseando archivo ───────────────────────────────');
  const texto    = fs.readFileSync(archivoTxt, 'utf-8');
  const lineas   = texto.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`  Líneas en archivo : ${lineas.length.toLocaleString('es-CO')}`);

  const registros = [];
  let omitidos    = 0;
  for (let i = 0; i < lineas.length; i++) {
    const r = parsearLinea(lineas[i]);
    if (r) registros.push(r); else omitidos++;
  }

  if (!registros.length) {
    console.error('❌ No se encontraron registros tipo 2.'); process.exit(1);
  }

  console.log(`  Registros válidos : ${registros.length.toLocaleString('es-CO')}`);
  if (omitidos) console.log(`  Omitidos          : ${omitidos} (encabezado/vacíos)`);

  // ── Estadísticas ─────────────────────────────────────────────
  const conteo = (arr, campo) => arr.reduce((a, r) => {
    const k = String(r[campo] ?? '?'); a[k] = (a[k]||0)+1; return a;
  }, {});
  const sexo    = conteo(registros, 'sexo_desc');
  const estados = conteo(registros, 'estado_indicador_desc');
  const ips     = conteo(registros, 'codigo_ips');
  const topIps  = Object.entries(ips).sort((a,b)=>b[1]-a[1]).slice(0,5);

  console.log('');
  console.log('── Resumen ─────────────────────────────────────────');
  console.log(`  Sexo: ${Object.entries(sexo).map(([k,v])=>`${k}: ${v.toLocaleString('es-CO')}`).join(' | ')}`);
  console.log(`  Estado indicador: ${Object.entries(estados).slice(0,5).map(([k,v])=>`${k}:${v}`).join(', ')}`);
  console.log(`  Top IPS (${Object.keys(ips).length} distintas):`);
  topIps.forEach(([cod,n]) => console.log(`    ${cod}: ${n.toLocaleString('es-CO')} afiliados`));

  // ── Guardar JSON local ────────────────────────────────────────
  console.log('');
  console.log('── Guardando JSON ──────────────────────────────────');
  const payload = {
    metadata: {
      fuente:          path.basename(archivoTxt),
      convertidoEn:    new Date().toISOString(),
      totalRegistros:  registros.length,
      totalColumnas:   COLS.length,
      version:         '2.0',
      carpetaDrive:    `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`,
    },
    data: registros,
  };

  fs.writeFileSync(archivoJson, JSON.stringify(payload));
  const mb = (fs.statSync(archivoJson).size / 1048576).toFixed(1);
  console.log(`  ✅ ${path.basename(archivoJson)} (${mb} MB)`);

  if (soloLocal) {
    console.log('\n  [--solo-local] Proceso terminado sin subida a la nube.');
    return resumen(archivoJson, registros.length, null, null);
  }

  // ── Supabase ──────────────────────────────────────────────────
  const tablaKey  = `R4505_${nombreBase.replace(/[^a-zA-Z0-9]/g,'_').replace(/_+/g,'_')}`;
  const supaOk    = await subirSupabase(tablaKey, registros, path.basename(archivoTxt));

  // ── Google Drive ──────────────────────────────────────────────
  let driveResult = null;
  if (!sinDrive) {
    const nombreDrive = `${nombreBase}_${new Date().toISOString().slice(0,10)}.json`;
    driveResult = await subirDrive(archivoJson, nombreDrive, driveToken);
  }

  resumen(archivoJson, registros.length, supaOk, driveResult);
}

function resumen(jsonPath, total, supaOk, driveData) {
  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   RESULTADO FINAL                                  ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`  Registros : ${total.toLocaleString('es-CO')}`);
  console.log(`  JSON local: ${jsonPath}`);
  if (supaOk !== null) console.log(`  Supabase  : ${supaOk ? '✅ Subido' : '⚠️  Parcial (revisar logs)'}`);
  if (driveData)       console.log(`  Drive     : ✅ https://drive.google.com/file/d/${driveData.id}/view`);
  else if (supaOk === null && driveData === null)
    console.log(`  Nube      : Omitida (--solo-local)`);
  console.log('');
}

main().catch(e => { console.error('\n❌ Error fatal:', e.message); process.exit(1); });
