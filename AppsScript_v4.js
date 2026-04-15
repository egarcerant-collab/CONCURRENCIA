// ============================================================
//  Auditoria Hospitalaria - Descarga Automatica v4
//  SIN necesidad de Drive API Avanzado — usa solo UrlFetchApp
// ============================================================

var USUARIO         = "1067815531";
var CLAVE           = "Wanoseshas2015@";
var CARPETA_ID      = "1FbFnzGyAqkH6SewCuyHL77Xwl-4Z3xEU";
var TARGET_SHEET_ID = "1BvYBlquNuIbRyvDE-Ej5KbHv9zyVCaa2";
var BASE_URL        = "http://asdempleados.dusakawiepsi.com:8080/sie_dusakawi";
var FECHA_INICIO    = "2026/01/01";

// ============================================================
//  FUNCION PRINCIPAL
// ============================================================
function descargarAuditoriaHospitalaria() {
  var hoy = Utilities.formatDate(new Date(), "America/Bogota", "yyyy/MM/dd");
  var nombreArchivo = "DETALLADO_AUDITORIA_HOSPITALARIA_" +
                      Utilities.formatDate(new Date(), "America/Bogota", "yyyyMMdd") + ".xlsx";

  Logger.log("=== INICIO: " + FECHA_INICIO + " al " + hoy + " ===");

  var headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-CO,es;q=0.9"
  };

  // PASO 1: Login page
  Logger.log("[1/6] Cargando login...");
  var r1 = UrlFetchApp.fetch(BASE_URL + "/login.xhtml", {
    muteHttpExceptions: true, followRedirects: true, headers: headers
  });
  var cookies = getCookies("", r1.getAllHeaders());
  var vs = getViewState(r1.getContentText());
  if (!vs) { Logger.log("ERROR: ViewState no encontrado en login"); return; }

  // PASO 2: Login
  Logger.log("[2/6] Haciendo login...");
  var ano = Utilities.formatDate(new Date(), "America/Bogota", "yyyy");
  var loginBody = buildBody({
    "j_idt19": "j_idt19",
    "j_idt19:j_idt24": USUARIO,
    "j_idt19:j_idt28": CLAVE,
    "j_idt19:j_idt32": ano,
    "j_idt19:j_idt37": "",
    "javax.faces.ViewState": vs
  });
  var r2 = UrlFetchApp.fetch(BASE_URL + "/login.xhtml", {
    method: "post", payload: loginBody,
    contentType: "application/x-www-form-urlencoded",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {"Cookie": cookies, "Referer": BASE_URL + "/login.xhtml"})
  });
  cookies = getCookies(cookies, r2.getAllHeaders());

  // PASO 3: Cargar pagina auditoria
  Logger.log("[3/6] Cargando pagina de auditoria...");
  var audUrl = BASE_URL + "/pages/audit/auditoria_hospitalaria/auditoria_hospitalaria.xhtml";
  var r3 = UrlFetchApp.fetch(audUrl, {
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {"Cookie": cookies})
  });
  cookies = getCookies(cookies, r3.getAllHeaders());
  vs = getViewState(r3.getContentText());
  if (!vs) { Logger.log("ERROR: ViewState no encontrado en auditoria"); return; }

  // PASO 4: AJAX exportacion
  Logger.log("[4/6] Activando panel de exportacion...");
  var ajaxBody = buildBody({
    "javax.faces.partial.ajax": "true",
    "javax.faces.source": "j_idt158",
    "javax.faces.partial.execute": "@all",
    "javax.faces.partial.render": "@all",
    "j_idt158": "j_idt158",
    "formMtto": "formMtto",
    "j_idt107_focus": "", "j_idt107_input": "1",
    "txtNumeroIdentificacionQ": "",
    "fechaInicioQ_input": FECHA_INICIO,
    "fechaFinQ_input": hoy,
    "ips_input": "", "ips_hinput": "",
    "cmbEstadoSeguimiento_focus": "",
    "cmbEstadoSeguimiento_input": "-1",
    "javax.faces.ViewState": vs
  });
  var r4 = UrlFetchApp.fetch(audUrl, {
    method: "post", payload: ajaxBody,
    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {
      "Cookie": cookies, "Faces-Request": "partial/ajax",
      "X-Requested-With": "XMLHttpRequest", "Referer": audUrl
    })
  });
  cookies = getCookies(cookies, r4.getAllHeaders());
  var vsNuevo = getViewState(r4.getContentText()) || vs;

  // PASO 5: Descargar XLSX
  Logger.log("[5/6] Descargando XLSX...");
  var exportBody = buildBody({
    "formMtto": "formMtto",
    "txtDepartamentoReporte_input": "", "txtDepartamentoReporte_hinput": "",
    "j_idt1443_input": "", "j_idt1443_hinput": "",
    "municipioDepRes_input": "", "municipioDepRes_hinput": "",
    "txtFechaAutorizaInicio_input": FECHA_INICIO,
    "txtFechaAutorizaFin_input": hoy,
    "cmbSwReingreso_focus": "", "cmbSwReingreso_input": "1",
    "j_idt1460": "", "j_idt1466": "j_idt1466",
    "javax.faces.ViewState": vsNuevo
  });
  var r5 = UrlFetchApp.fetch(audUrl, {
    method: "post", payload: exportBody,
    contentType: "application/x-www-form-urlencoded",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {"Cookie": cookies, "Referer": audUrl})
  });
  var codigoHttp = r5.getResponseCode();
  var blob = r5.getBlob();
  var tamano = blob.getBytes().length;
  Logger.log("HTTP " + codigoHttp + " | " + tamano + " bytes");

  if (codigoHttp !== 200 || tamano < 10000) {
    Logger.log("ERROR: " + r5.getContentText().substring(0, 300));
    return;
  }

  // Guardar en Drive
  var carpeta = DriveApp.getFolderById(CARPETA_ID);
  var existentes = carpeta.getFilesByName(nombreArchivo);
  while (existentes.hasNext()) existentes.next().setTrashed(true);
  blob.setName(nombreArchivo).setContentType(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  carpeta.createFile(blob);
  Logger.log("Drive OK: " + nombreArchivo);

  // PASO 6: Subir XLSX y convertir a Google Sheet via Drive API v3 REST
  Logger.log("[6/6] Actualizando Google Sheet...");
  try {
    actualizarGoogleSheetV3(blob, TARGET_SHEET_ID);
    Logger.log("=== EXITO TOTAL ===");
  } catch(e) {
    Logger.log("ERROR Sheet: " + e.message);
  }
}

// ============================================================
//  PASO 6: Convierte XLSX → Google Sheet usando REST (sin Advanced Service)
// ============================================================
function actualizarGoogleSheetV3(blob, sheetId) {
  var token = ScriptApp.getOAuthToken();

  // Subir XLSX y convertirlo a Google Sheets automáticamente
  var boundary = "BOUNDARY_" + Date.now();
  var metadataStr = JSON.stringify({
    name: "TEMP_AUDITORIA_" + Date.now(),
    mimeType: "application/vnd.google-apps.spreadsheet"
  });

  // Construir cuerpo multipart
  var partMeta = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadataStr + "\r\n";
  var partFile = "--" + boundary + "\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n";
  var closing  = "\r\n--" + boundary + "--";

  var body = Utilities.newBlob(partMeta).getBytes()
    .concat(Utilities.newBlob(partFile).getBytes())
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(closing).getBytes());

  var uploadResp = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      contentType: "multipart/related; boundary=" + boundary,
      payload: body,
      headers: { "Authorization": "Bearer " + token },
      muteHttpExceptions: true
    }
  );

  var tempFile = JSON.parse(uploadResp.getContentText());
  if (!tempFile.id) throw new Error("Upload fallido: " + uploadResp.getContentText().slice(0, 200));
  Logger.log("Temporal creado: " + tempFile.id);

  // Leer datos del temporal
  var tempSS = SpreadsheetApp.openById(tempFile.id);
  var data = tempSS.getSheets()[0].getDataRange().getValues();
  Logger.log("Filas leidas: " + data.length);

  // Escribir al Sheet destino
  var targetSS = SpreadsheetApp.openById(sheetId);
  var sheets = targetSS.getSheets();
  var targetSheet = sheets[0];
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === "DATOS" || sheets[i].getName() === "POWEBI") {
      targetSheet = sheets[i]; break;
    }
  }
  targetSheet.clearContents();
  if (data.length > 0) {
    targetSheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  }
  Logger.log("Sheet escrito: " + data.length + " filas en hoja '" + targetSheet.getName() + "'");

  // Borrar temporal
  UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + tempFile.id, {
    method: "DELETE",
    headers: { "Authorization": "Bearer " + token },
    muteHttpExceptions: true
  });
  Logger.log("Temporal eliminado OK");
}

// ============================================================
//  TRIGGER DIARIO (ejecutar UNA sola vez)
// ============================================================
function configurarTriggerDiario() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("descargarAuditoriaHospitalaria")
    .timeBased().everyDays(1).atHour(7).create();
  Logger.log("Trigger: cada dia a las 7 AM");
}

// ============================================================
//  AUXILIARES
// ============================================================
function buildBody(obj) {
  return Object.keys(obj).map(function(k) {
    return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k] || "");
  }).join("&");
}
function getCookies(actual, headers) {
  var mapa = {};
  if (actual) actual.split(";").forEach(function(c) {
    var p = c.trim().split("="); if (p.length >= 2) mapa[p[0].trim()] = p.slice(1).join("=");
  });
  var sc = headers["Set-Cookie"] || headers["set-cookie"];
  if (sc) {
    (Array.isArray(sc) ? sc : [sc]).forEach(function(l) {
      var kv = l.split(";")[0].trim().split("=");
      if (kv.length >= 2) mapa[kv[0].trim()] = kv.slice(1).join("=");
    });
  }
  return Object.keys(mapa).map(function(k) { return k + "=" + mapa[k]; }).join("; ");
}
function getViewState(html) {
  var m = html.match(/<update id="javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/);
  if (m) return m[1];
  m = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  if (m) return m[1].replace(/&amp;/g,"&").replace(/&#58;/g,":").replace(/&#43;/g,"+");
  m = html.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  if (m) return m[1].replace(/&amp;/g,"&").replace(/&#58;/g,":").replace(/&#43;/g,"+");
  return null;
}
