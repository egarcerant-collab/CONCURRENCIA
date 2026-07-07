// ── GitHub Gist — almacenamiento compartido sin costo ────────
// Formato comprimido: arrays en vez de objetos (ahorra ~60% de tamaño)
// Subir: requiere PAT con scope "gist" | Descargar: URL pública sin auth
(function () {
  const LS_KEY = 'gist_cfg';
  let CFG = { token: '', gistId: '' };

  function _fileName(key) { return `dusakawi_${key}.json`; }
  function _load() {
    try { const r = localStorage.getItem(LS_KEY); if (r) Object.assign(CFG, JSON.parse(r)); } catch(e) {}
  }
  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch(e) {}
  }

  // Columnas para Gist — excluye textos largos y datos de contacto
  const COLS_GIST = [
    'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
    'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso',
    'Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico',
    'Cie10 Egreso','Estancia','Programa Riesgo','Gestacion','Via Parto',
    'Dx Gestante','Control Prenatal','Reingreso','Auditor','Glosas',
    'Valor Total Glosa','Eventos Adversos','Cantidad Evento no calidad',
    'Patologia alto costo','Especialidad','Patologia Alto Costo','IPS Primaria',
  ];

  // Normalizar nombre de columna para comparar sin tildes ni mayúsculas
  function _norm(s) {
    return String(s||'').toLowerCase()
      .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
      .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n').trim();
  }

  // Convertir array de objetos → { headers, data } (formato comprimido)
  function _toArray(rows) {
    if (!rows.length) return { headers: [], data: [] };
    const allKeys = Object.keys(rows[0]);
    const normMap = {};
    allKeys.forEach(k => { normMap[_norm(k)] = k; });
    // Seleccionar solo las columnas de COLS_GIST que existan en los datos
    const headers = COLS_GIST
      .map(c => rows[0][c] !== undefined ? c : normMap[_norm(c)])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i); // dedup
    const data = rows.map(r => headers.map(h => {
      const v = r[h];
      return (v == null || v === '') ? null : v; // null es más corto que ''
    }));
    return { headers, data };
  }

  // Reconstruir array de objetos desde formato comprimido
  function _fromArray(payload) {
    if (payload.rows) return payload; // compatibilidad con formato antiguo
    if (!payload.headers || !payload.data) return payload;
    const rows = payload.data.map(d => {
      const obj = {};
      payload.headers.forEach((h, i) => { obj[h] = d[i] ?? ''; });
      return obj;
    });
    return { ...payload, rows };
  }

  // ── Subir / actualizar datos en el Gist ──────────────────────
  async function gistUpload(key, rows, meta = {}) {
    if (!CFG.token) return { ok: false, errorMsg: 'Sin token configurado' };

    const arr = _toArray(rows);
    const content = JSON.stringify({
      headers:    arr.headers,
      data:       arr.data,
      fileName:   meta.fileName   || key,
      uploadedAt: meta.uploadedAt || new Date().toISOString(),
      count:      rows.length,
    });

    const sizeMB = (content.length / 1024 / 1024).toFixed(2);
    console.info(`[Gist] Tamaño comprimido: ${sizeMB} MB (${rows.length} filas × ${arr.headers.length} cols)`);

    if (content.length > 10 * 1024 * 1024) {
      return { ok: false, errorMsg: `Archivo muy grande (${sizeMB} MB > 10 MB). Contacta al administrador.` };
    }

    const files = { [_fileName(key)]: { content } };
    const reqHeaders = {
      'Authorization': `token ${CFG.token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/vnd.github+json',
    };

    try {
      let res;
      if (CFG.gistId) {
        res = await fetch(`https://api.github.com/gists/${CFG.gistId}`, {
          method: 'PATCH', headers: reqHeaders, body: JSON.stringify({ files }),
        });
      } else {
        res = await fetch('https://api.github.com/gists', {
          method: 'POST', headers: reqHeaders,
          body: JSON.stringify({
            description: 'Dusakawi EPS — Auditoría Hospitalaria',
            public: true, files,
          }),
        });
      }

      if (!res.ok) {
        const err = await res.text();
        let errMsg = `HTTP ${res.status}`;
        try { const j = JSON.parse(err); if (j.message) errMsg = `HTTP ${res.status}: ${j.message}`; } catch(e2) {}
        console.warn('[Gist] Upload error', res.status, err.slice(0, 300));
        return { ok: false, status: res.status, errorMsg: errMsg };
      }

      const gist = await res.json();
      if (!CFG.gistId) {
        CFG.gistId = gist.id;
        _save();
        console.info('[Gist] Nuevo gist creado:', CFG.gistId);
      }
      console.info(`[Gist] ✅ ${key} subido — ${rows.length} filas · ${sizeMB} MB`);
      return { ok: true };
    } catch (e) {
      console.warn('[Gist] Exception:', e.message);
      return { ok: false, status: 0, errorMsg: e.message };
    }
  }

  // ── Descargar datos del Gist ──────────────────────────────────
  async function gistDownload(key) {
    if (!CFG.gistId) return null;
    try {
      const res = await fetch(`https://api.github.com/gists/${CFG.gistId}`, {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      if (!res.ok) { console.warn('[Gist] Download meta error', res.status); return null; }
      const gist = await res.json();
      const file = gist.files[_fileName(key)];
      if (!file) return null;

      const content = file.truncated
        ? await fetch(file.raw_url, { cache: 'no-store' }).then(r => r.text())
        : file.content;

      const raw  = JSON.parse(content);
      const data = _fromArray(raw); // soporta formato antiguo y nuevo
      console.info(`[Gist] ✅ ${key} descargado — ${data.rows?.length || 0} filas`);
      return data;
    } catch (e) {
      console.warn('[Gist] Download exception:', e.message);
      return null;
    }
  }

  // ── Verificar token ───────────────────────────────────────────
  async function gistVerifyToken() {
    if (!CFG.token) return { valid: false, msg: 'Sin token configurado' };
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${CFG.token}`,
          'Accept': 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { valid: false, msg: `HTTP ${res.status} — token inválido o expirado` };
      const scopes  = res.headers.get('x-oauth-scopes') || '';
      const user    = await res.json();
      const hasGist = scopes.split(',').map(s => s.trim()).includes('gist');
      return { valid: true, login: user.login, scopes, hasGist };
    } catch (e) {
      return { valid: false, msg: e.message };
    }
  }

  // ── Configuración ─────────────────────────────────────────────
  function gistSetConfig(cfg) {
    if (cfg.token  !== undefined) CFG.token  = cfg.token;
    if (cfg.gistId !== undefined) CFG.gistId = cfg.gistId;
    _save();
  }
  function gistGetConfig() { return { ...CFG }; }
  function gistIsReady()   { return !!CFG.gistId; }

  _load();
  window.GIST_STORE_API = { gistUpload, gistDownload, gistSetConfig, gistGetConfig, gistIsReady, gistVerifyToken };
})();
