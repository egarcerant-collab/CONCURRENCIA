// ── GitHub Gist — almacenamiento compartido sin costo ────────
// Subir: requiere un PAT (Personal Access Token) con scope "gist"
// Descargar: URL pública sin autenticación (gist público)
// Límite: 10 MB por archivo (más que suficiente para DETALLADO slim)
(function () {
  const LS_KEY = 'gist_cfg'; // { token, gistId }
  let CFG = { token: '', gistId: '' };

  function _fileName(key) { return `dusakawi_${key}.json`; }

  function _load() {
    try { const r = localStorage.getItem(LS_KEY); if (r) Object.assign(CFG, JSON.parse(r)); } catch(e) {}
  }
  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch(e) {}
  }

  // ── Subir / actualizar datos en el Gist ──────────────────────
  async function gistUpload(key, rows, meta = {}) {
    if (!CFG.token) { console.warn('[Gist] token no configurado'); return false; }
    const content = JSON.stringify({
      rows,
      fileName:   meta.fileName   || key,
      uploadedAt: meta.uploadedAt || new Date().toISOString(),
      count:      rows.length,
    });
    const sizeMB = (content.length / 1024 / 1024).toFixed(1);
    if (content.length > 10 * 1024 * 1024) {
      console.warn(`[Gist] Archivo demasiado grande (${sizeMB} MB > 10 MB)`);
      return false;
    }

    const files = { [_fileName(key)]: { content } };
    const headers = {
      'Authorization': `token ${CFG.token}`,
      'Content-Type':  'application/json',
      'Accept':        'application/vnd.github+json',
    };

    try {
      let res, gist;
      if (CFG.gistId) {
        // Actualizar gist existente
        res = await fetch(`https://api.github.com/gists/${CFG.gistId}`, {
          method: 'PATCH', headers, body: JSON.stringify({ files }),
        });
      } else {
        // Crear nuevo gist
        res = await fetch('https://api.github.com/gists', {
          method: 'POST', headers,
          body: JSON.stringify({
            description: 'Dusakawi EPS — Auditoría Hospitalaria',
            public: true, files,
          }),
        });
      }

      if (!res.ok) {
        const err = await res.text();
        console.warn('[Gist] Upload error', res.status, err.slice(0, 200));
        return false;
      }

      gist = await res.json();
      if (!CFG.gistId) {
        CFG.gistId = gist.id;
        _save();
        console.info('[Gist] Nuevo gist creado:', CFG.gistId);
      }
      console.info(`[Gist] ✅ ${key} subido — ${rows.length} filas · ${sizeMB} MB`);
      return true;
    } catch (e) {
      console.warn('[Gist] Exception:', e.message);
      return false;
    }
  }

  // ── Descargar datos del Gist (sin auth — URL pública) ────────
  async function gistDownload(key) {
    if (!CFG.gistId) return null;
    try {
      // Obtener metadatos del gist para encontrar la raw_url del archivo
      const res = await fetch(`https://api.github.com/gists/${CFG.gistId}`, {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      if (!res.ok) { console.warn('[Gist] Download meta error', res.status); return null; }
      const gist = await res.json();
      const file = gist.files[_fileName(key)];
      if (!file) return null;

      // Si el contenido está truncado, usar raw_url
      const content = file.truncated
        ? await fetch(file.raw_url, { cache: 'no-store' }).then(r => r.text())
        : file.content;

      const data = JSON.parse(content);
      console.info(`[Gist] ✅ ${key} descargado — ${data.rows?.length || 0} filas`);
      return data;
    } catch (e) {
      console.warn('[Gist] Download exception:', e.message);
      return null;
    }
  }

  // ── Configuración ─────────────────────────────────────────────
  function gistSetConfig(cfg) {
    if (cfg.token  !== undefined) CFG.token  = cfg.token;
    if (cfg.gistId !== undefined) CFG.gistId = cfg.gistId;
    _save();
  }
  function gistGetConfig() { return { ...CFG }; }
  function gistIsReady() { return !!CFG.gistId; } // listo para descarga sin token

  _load();
  window.GIST_STORE_API = { gistUpload, gistDownload, gistSetConfig, gistGetConfig, gistIsReady };
})();
