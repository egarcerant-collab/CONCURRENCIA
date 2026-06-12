// Firebase Storage — almacenamiento compartido sin cuota de egress en free tier
// Configurar con APP.firebaseConfig({bucket, apiKey}) desde el panel Admin
(function () {
  const CFG = { bucket: '', apiKey: '' };

  // ── REST API de Firebase Storage (sin SDK) ────────────────────────────────
  function baseUrl(key) {
    const path = encodeURIComponent(`datasets/${key}.json`);
    return `https://firebasestorage.googleapis.com/v0/b/${CFG.bucket}/o/${path}`;
  }

  async function fbUpload(key, rows, meta = {}) {
    if (!CFG.bucket) { console.warn('[Firebase] bucket no configurado'); return false; }
    try {
      const payload = JSON.stringify({
        rows,
        fileName:   meta.fileName   || key,
        uploadedAt: meta.uploadedAt || new Date().toISOString(),
        count:      rows.length,
      });
      // Multipart upload: POST al endpoint de upload
      const url = `https://firebasestorage.googleapis.com/v0/b/${CFG.bucket}/o?uploadType=media&name=${encodeURIComponent('datasets/'+key+'.json')}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    payload,
      });
      if (!res.ok) {
        const err = await res.text();
        console.warn(`[Firebase] upload ${key} falló:`, res.status, err);
        return false;
      }
      console.info(`[Firebase] ${key}: ${rows.length} filas subidas`);
      return true;
    } catch (e) { console.warn('[Firebase] upload error:', e); return false; }
  }

  async function fbDownload(key) {
    if (!CFG.bucket) return null;
    try {
      const res = await fetch(baseUrl(key) + '?alt=media', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { console.warn('[Firebase] download error:', e); return null; }
  }

  async function fbDelete(key) {
    if (!CFG.bucket) return false;
    try {
      const res = await fetch(baseUrl(key), { method: 'DELETE' });
      return res.ok;
    } catch (e) { return false; }
  }

  // Lista archivos en datasets/
  async function fbList() {
    if (!CFG.bucket) return [];
    try {
      const url = `https://firebasestorage.googleapis.com/v0/b/${CFG.bucket}/o?prefix=datasets%2F`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.items || []).map(item => ({
        key:  item.name.replace('datasets/', '').replace('.json', ''),
        name: item.name,
        size: item.size,
      }));
    } catch (e) { return []; }
  }

  // Configura el bucket (llamado desde admin con los datos del proyecto Firebase)
  function fbSetConfig(cfg) {
    if (cfg.bucket) CFG.bucket = cfg.bucket;
    if (cfg.apiKey) CFG.apiKey = cfg.apiKey;
    try { localStorage.setItem('fb_cfg', JSON.stringify(CFG)); } catch(e) {}
    console.info('[Firebase] configurado →', CFG.bucket);
  }

  // Restaura config guardada en localStorage
  function fbInit() {
    try {
      const raw = localStorage.getItem('fb_cfg');
      if (raw) { const c = JSON.parse(raw); if (c.bucket) Object.assign(CFG, c); }
    } catch(e) {}
  }

  fbInit();

  window.FB_STORE_API = { fbUpload, fbDownload, fbDelete, fbList, fbSetConfig, getConfig: () => ({...CFG}) };
})();
