// ============================================================
//  AppsScript v6 — Web App para recibir datos desde el dashboard
//  Recibe filas JSON del browser y las escribe en Google Sheets
//
//  CONFIGURACIÓN:
//  1. Abre la hoja: https://docs.google.com/spreadsheets/d/1Uoj-zA7Q3TC7_1TcPJ6EzzcKB1XXpWni
//  2. Extensiones → Apps Script
//  3. Reemplaza el contenido con este archivo
//  4. Clic en "Implementar" → "Nueva implementación"
//     - Tipo: Aplicación web
//     - Ejecutar como: Yo
//     - Quién tiene acceso: Cualquiera
//  5. Copia la URL generada y pégala en el panel Admin del dashboard
// ============================================================

var SHEET_ID  = '1Uoj-zA7Q3TC7_1TcPJ6EzzcKB1XXpWni';
var SHEET_TAB = 0; // índice de la hoja (0 = primera)

// ── Web App: recibe POST con filas JSON ───────────────────────
function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : (e.parameter ? e.parameter.data : '');
    if (!raw) return jsonResp({ error: 'Sin datos' });

    var data = JSON.parse(raw);
    if (!data.rows || !data.rows.length) return jsonResp({ error: 'Sin filas' });

    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[SHEET_TAB];

    // Limpiar hoja existente
    sheet.clearContents();

    // Encabezados desde la primera fila
    var headers = Object.keys(data.rows[0]);
    sheet.appendRow(headers);

    // Escribir en lotes de 1000 para evitar timeout
    var values = data.rows.map(function(row) {
      return headers.map(function(h) {
        var v = row[h];
        return (v == null || v === undefined) ? '' : String(v);
      });
    });

    var CHUNK = 1000;
    for (var i = 0; i < values.length; i += CHUNK) {
      var chunk = values.slice(i, i + CHUNK);
      sheet.getRange(i + 2, 1, chunk.length, headers.length).setValues(chunk);
    }

    Logger.log('✅ Hoja actualizada: ' + data.rows.length + ' registros · ' + new Date());
    return jsonResp({ ok: true, count: data.rows.length, updatedAt: new Date().toISOString() });

  } catch (err) {
    Logger.log('❌ Error doPost: ' + err.message);
    return jsonResp({ error: err.message });
  }
}

// ── GET: verificar que el web app está activo ─────────────────
function doGet(e) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheets()[SHEET_TAB];
  var rows  = Math.max(0, sheet.getLastRow() - 1); // restar encabezado
  return jsonResp({ ok: true, rows: rows, updatedAt: sheet.getLastUpdated ? sheet.getLastUpdated().toISOString() : '' });
}

// ── Auxiliar ──────────────────────────────────────────────────
function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Trigger diario opcional (mantiene la hoja actualizada) ────
// Ejecutar una vez para configurar:
function configurarTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoActualizar').timeBased().everyDays(1).atHour(8).create();
  Logger.log('Trigger diario configurado a las 8 AM');
}

// Si quieres que el script también descargue del SIE automáticamente:
// Copia la función descargarAuditoriaHospitalaria() de AppsScript_v5.js
// y llámala desde aquí:
function autoActualizar() {
  // descargarAuditoriaHospitalaria(); // descomentar si quieres auto-descarga del SIE
  Logger.log('Auto-actualización ejecutada: ' + new Date());
}
