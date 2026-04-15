// ============================================================
//  Auditoria Hospitalaria - Descarga Automatica v5
//  SIN Google Sheets — XLSX va directo a Vercel → Supabase
// ============================================================

var USUARIO      = "1067815531";
var CLAVE        = "Wanoseshas2015@";
var CARPETA_ID   = "1FbFnzGyAqkH6SewCuyHL77Xwl-4Z3xEU";
var BASE_URL     = "http://asdempleados.dusakawiepsi.com:8080/sie_dusakawi";
var VERCEL_URL   = "https://concurrenciadsk.vercel.app/api/upload-from-script";
var FECHA_INICIO = "2026/01/01";

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

  // PASO 1: Cargar login
  Logger.log("[1/5] Cargando login...");
  var r1 = UrlFetchApp.fetch(BASE_URL + "/login.xhtml", {
    muteHttpExceptions: true, followRedirects: true, headers: headers
  });
  var cookies = getCookies("", r1.getAllHeaders());
  var vs = getViewState(r1.getContentText());
  if (!vs) { Logger.log("ERROR: ViewState no encontrado en login"); return; }

  // PASO 2: Login
  Logger.log("[2/5] Haciendo login...");
  var ano = Utilities.formatDate(new Date(), "America/Bogota", "yyyy");
  var r2 = UrlFetchApp.fetch(BASE_URL + "/login.xhtml", {
    method: "post",
    payload: buildBody({
      "j_idt19": "j_idt19",
      "j_idt19:j_idt24": USUARIO,
      "j_idt19:j_idt28": CLAVE,
      "j_idt19:j_idt32": ano,
      "j_idt19:j_idt37": "",
      "javax.faces.ViewState": vs
    }),
    contentType: "application/x-www-form-urlencoded",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {
      "Cookie": cookies, "Referer": BASE_URL + "/login.xhtml"
    })
  });
  cookies = getCookies(cookies, r2.getAllHeaders());
  Logger.log("Login HTTP: " + r2.getResponseCode());

  // PASO 3: Cargar página de auditoría
  Logger.log("[3/5] Cargando página de auditoría...");
  var audUrl = BASE_URL + "/pages/audit/auditoria_hospitalaria/auditoria_hospitalaria.xhtml";
  var r3 = UrlFetchApp.fetch(audUrl, {
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, { "Cookie": cookies })
  });
  cookies = getCookies(cookies, r3.getAllHeaders());
  vs = getViewState(r3.getContentText());
  if (!vs) { Logger.log("ERROR: ViewState no encontrado en auditoría"); return; }

  // PASO 4: AJAX — activar panel de exportación
  Logger.log("[4/5] Activando panel de exportación...");
  var r4 = UrlFetchApp.fetch(audUrl, {
    method: "post",
    payload: buildBody({
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
    }),
    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, {
      "Cookie": cookies,
      "Faces-Request": "partial/ajax",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": audUrl
    })
  });
  cookies = getCookies(cookies, r4.getAllHeaders());
  var vsNuevo = getViewState(r4.getContentText()) || vs;

  // LOG del AJAX para identificar IDs del botón de exportar
  var ajaxText = r4.getContentText();
  Logger.log("=== AJAX RESPUESTA (primeros 2000 chars) ===");
  Logger.log(ajaxText.substring(0, 2000));
  Logger.log("===========================================");

  // Buscar el ID del botón de exportar en el HTML
  var exportBtnMatch = ajaxText.match(/name="(j_idt\d+)"[^>]*type="submit"/g);
  if (exportBtnMatch) Logger.log("Botones encontrados: " + exportBtnMatch.join(" | "));

  // PASO 5: Descargar XLSX
  Logger.log("[5/5] Descargando XLSX...");
  var r5 = UrlFetchApp.fetch(audUrl, {
    method: "post",
    payload: buildBody({
      "formMtto": "formMtto",
      "txtDepartamentoReporte_input": "",
      "txtDepartamentoReporte_hinput": "",
      "j_idt1443_input": "",
      "j_idt1443_hinput": "",
      "municipioDepRes_input": "",
      "municipioDepRes_hinput": "",
      "txtFechaAutorizaInicio_input": FECHA_INICIO,
      "txtFechaAutorizaFin_input": hoy,
      "cmbSwReingreso_focus": "",
      "cmbSwReingreso_input": "1",
      "j_idt1460": "",
      "j_idt1466": "j_idt1466",
      "javax.faces.ViewState": vsNuevo
    }),
    contentType: "application/x-www-form-urlencoded",
    muteHttpExceptions: true, followRedirects: true,
    headers: Object.assign({}, headers, { "Cookie": cookies, "Referer": audUrl })
  });

  var codigoHttp = r5.getResponseCode();
  var blob = r5.getBlob();
  var tamano = blob.getBytes().length;
  var bytes = blob.getBytes();

  // Validar que es XLSX real (empieza con PK = cabecera ZIP)
  var isXlsx = tamano > 4 && bytes[0] == 80 && bytes[1] == 75;
  Logger.log("HTTP " + codigoHttp + " | " + tamano + " bytes | XLSX válido: " + isXlsx);

  if (!isXlsx) {
    Logger.log("❌ ERROR: El hospital devolvió HTML en vez de XLSX");
    Logger.log("Primeros 500 chars de la respuesta:");
    Logger.log(r5.getContentText().substring(0, 500));
    Logger.log("→ Revisar IDs de formulario en paso 5");
    return;
  }

  // Guardar copia de backup en Drive
  var carpeta = DriveApp.getFolderById(CARPETA_ID);
  var existentes = carpeta.getFilesByName(nombreArchivo);
  while (existentes.hasNext()) existentes.next().setTrashed(true);
  blob.setName(nombreArchivo)
    .setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  carpeta.createFile(blob);
  Logger.log("✅ Drive backup: " + nombreArchivo);

  // Enviar XLSX directo a Vercel (sin pasar por Google Sheets)
  Logger.log("Enviando a Vercel → Supabase...");
  var respVercel = UrlFetchApp.fetch(VERCEL_URL, {
    method: "POST",
    contentType: "application/octet-stream",
    payload: blob.getBytes(),
    muteHttpExceptions: true,
    headers: { "X-Source": "apps-script-v5" }
  });

  var vercelCode = respVercel.getResponseCode();
  var vercelBody = respVercel.getContentText();
  Logger.log("Vercel HTTP " + vercelCode + ": " + vercelBody);

  if (vercelCode === 200) {
    Logger.log("=== ✅ ÉXITO TOTAL — datos en Vercel y Supabase ===");
  } else {
    Logger.log("❌ Error Vercel: " + vercelBody);
  }
}

// ============================================================
//  TRIGGER DIARIO (ejecutar UNA sola vez para configurar)
// ============================================================
function configurarTriggerDiario() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("descargarAuditoriaHospitalaria")
    .timeBased().everyDays(1).atHour(7).create();
  Logger.log("Trigger configurado: cada día a las 7 AM");
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
    var p = c.trim().split("=");
    if (p.length >= 2) mapa[p[0].trim()] = p.slice(1).join("=");
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
  if (m) return m[1].replace(/&amp;/g, "&").replace(/&#58;/g, ":").replace(/&#43;/g, "+");
  m = html.match(/value="([^"]+)"[^>]*name="javax\.faces\.ViewState"/);
  if (m) return m[1].replace(/&amp;/g, "&").replace(/&#58;/g, ":").replace(/&#43;/g, "+");
  return null;
}
