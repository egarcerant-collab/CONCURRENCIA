// ============================================================
// APP — Indicadores Riesgo — Multi-fuente
// Fuentes: DETALLADO (principal), RCV, AIU, DNT, CYD, ESTANCIA
// ============================================================
const APP = (() => {
  let state = {
    rows: [],         // DETALLADO_AUDITORIA (fuente principal)
    rcvRows: [],      // BD_RCV — ruta cardiovascular
    aiuRows: [],      // Reporte_AIU — autorizaciones urgencias
    dntRows: [],      // Seguimiento DNT — desnutrición SIVIGILA
    cydRows: [],      // cyd.csv — crecimiento y desarrollo 0-5
    estanciaRows: [], // ESTANCIA DETALLADA — estancia por servicio
    meta: { ips:[], anios:[], meses:[] },
    filters: { ips:'todos', anio:'todos', mes:'todos', departamento:'todos', municipio:'todos' },
    auditoresMap: {},
    activeTab: 'datos',
    fileNames: {},
    uploadedAt: {},   // fecha de última sincronización por fuente
    tipoReporte: null, // 1=Detallado, 3=Registros Abiertos, null=desconocido
    source: null,      // 'manual-upload' | 'hospital-direct' | null
    glosasUnlocked: false
  };

  const MESES_ES = { '01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre' };

  const SOURCES = [
    { key:'detallado', label:'DETALLADO Auditoría Hospitalaria', hint:'DETALLADO_AUDITORIA_HOSPITALARIA.macros.xlsm', icon:'🏥', color:'#1a4f7a', required:true },
    { key:'rcv',       label:'Ruta Cardiovascular (RCV)',        hint:'BD_RCV_EN_MES_DE_MARZO...xlsx',              icon:'❤️', color:'#c0392b', required:false },
    { key:'aiu',       label:'Autorizaciones Urgencias (AIU)',   hint:'Reporte_AIU_2024.csv',                       icon:'🚑', color:'#e67e22', required:false },
    { key:'dnt',       label:'Seguimiento Desnutrición (DNT)',   hint:'Seguimiento DNT.xlsx',                       icon:'🍽️', color:'#8e44ad', required:false },
    { key:'cyd',       label:'Crecimiento y Desarrollo (CyD)',   hint:'cyd.csv',                                    icon:'👶', color:'#27ae60', required:false },
    { key:'estancia',  label:'Estancia Detallada',               hint:'ESTANCIA DETALLADA ROSARIO PUMAREJO.xlsx',   icon:'🛏️', color:'#2980b9', required:false },
  ];

  // ── UI helpers ──────────────────────────────────────────
  function toast(msg, type='info') {
    const el = document.getElementById('toast');
    el.innerHTML = msg; el.className = 'show ' + type;
    clearTimeout(el._t); el._t = setTimeout(() => el.className='', 3500);
  }
  function fmt(n,d=1){ return isNaN(n)?'0':Number(n).toFixed(d); }
  function fmtN(n){ return Number(n||0).toLocaleString('es-CO'); }
  function fmtM(n){ return '$'+Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:0}); }
  function semColor(v, meta, higher=true){ if(!meta) return 'blue'; return higher ? (v>=meta?'green':v>=meta*.8?'orange':'red') : (v<=meta?'green':v<=meta*1.2?'orange':'red'); }
  function noData(msg='Carga la base de datos principal primero'){ return `<div class="no-data"><div class="nd-icon">📂</div><p>${msg}</p></div>`; }

  function kpi(label, val, unit='', sub='', color='blue', icon='📊', info='') {
    const isNum = typeof val === 'number';
    const display = isNum ? fmt(val) : val;
    const bar = (unit==='%'||unit==='x1000') && isNum ? `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${Math.min(val,100)}%;background:${color==='green'?'#27ae60':color==='red'?'#e74c3c':color==='orange'?'#f39c12':'#1a4f7a'}"></div></div>` : '';
    const infoBtn = info ? `<div class="kpi-info-btn" title="${info.replace(/"/g,"'")}">ⓘ
      <div class="kpi-tooltip">${info}</div>
    </div>` : '';
    return `<div class="kpi-card ${color}">
      ${infoBtn}
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${display}<small style="font-size:13px;font-weight:400"> ${unit}</small></div>
      ${sub?`<div class="kpi-sub">${sub}</div>`:''}${bar}
    </div>`;
  }

  function buildTable(rows, cols, max=200) {
    if(!rows||!rows.length) return '<p style="padding:16px;color:#aaa">Sin registros</p>';
    const headers = cols || Object.keys(rows[0]).filter(k => k && k!=='');
    const show = rows.slice(0,max);
    return `<div class="table-scroll"><table>
      <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${show.map(r=>`<tr>${headers.map(h=>`<td>${r[h]??''}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>${rows.length>max?`<p style="padding:8px 16px;font-size:11px;color:#888">Mostrando ${max} de ${fmtN(rows.length)} registros</p>`:''}</div>`;
  }

  // ── EXPORTAR A EXCEL ─────────────────────────────────────
  let _exportRows = [], _exportName = '';

  function exportExcel(rows, sheetName, cols) {
    if (!rows || !rows.length) { toast('Sin datos para exportar','error'); return; }
    const data = cols ? rows.map(r => { const o={}; cols.forEach(c=>o[c]=r[c]??''); return o; }) : rows;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0,31));
    const fecha = new Date().toISOString().slice(0,10);
    XLSX.writeFile(wb, `${sheetName}_${fecha}.xlsx`);
    toast(`✅ Exportado: ${sheetName}_${fecha}.xlsx`,'success');
  }

  function openExportModal(rows, name) {
    if (!rows || !rows.length) { toast('Sin datos para exportar','error'); return; }
    _exportRows = rows; _exportName = name;
    const cols = Object.keys(rows[0]).filter(k => k && k !== '');
    const list = document.getElementById('export-col-list');
    list.innerHTML = cols.map(c => `
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px 0;font-weight:600">
        <input type="checkbox" class="exp-col-chk" value="${c.replace(/"/g,'&quot;')}" checked
          onchange="APP.updateColCount()" style="accent-color:#1a4f7a;width:15px;height:15px">
        <span>${c}</span>
      </label>`).join('');
    document.getElementById('export-col-count').textContent = `${cols.length} de ${cols.length} columnas`;
    document.getElementById('export-modal').style.display = 'flex';
  }

  function exportBtn(label='Exportar') {
    return `<button class="btn btn-secondary btn-sm" onclick="APP.exportTab()" style="margin-left:auto">⬇️ ${label}</button>`;
  }

  // ── FILTROS ──────────────────────────────────────────────
  function filterBar() {
    if (!state.rows.length) return '';
    const { ips, anios, departamentos=[], municipios=[] } = state.meta;
    // Si hay filtro de departamento activo, filtrar municipios a los de ese depto
    let munFiltrados = municipios;
    if (state.filters.departamento && state.filters.departamento !== 'todos') {
      const depNorm = CALCS.normStr(state.filters.departamento);
      munFiltrados = [...new Set(state.rows
        .filter(r => CALCS.normStr(CALCS.get(r,'Departamento')||CALCS.get(r,'DEPARTAMENTO')||'').includes(depNorm))
        .map(r => CALCS.get(r,'Municipio')||CALCS.get(r,'MUNICIPIO')||CALCS.get(r,'municipio')||'')
        .filter(Boolean)
      )].sort();
    }
    const count = CALCS.applyFilters(state.rows, state.filters).length;
    return `<div class="filter-bar">
      ${departamentos.length ? `
      <label>🗺️ Dpto:</label>
      <select onchange="APP.setFilterDpto(this.value)">
        <option value="todos">Todos los Dptos.</option>
        ${departamentos.map(d=>`<option value="${d}" ${state.filters.departamento===d?'selected':''}>${d}</option>`).join('')}
      </select>` : ''}
      ${municipios.length ? `
      <label>📍 Municipio:</label>
      <select onchange="APP.setFilter('municipio',this.value)">
        <option value="todos">Todos</option>
        ${munFiltrados.map(m=>`<option value="${m}" ${state.filters.municipio===m?'selected':''}>${m}</option>`).join('')}
      </select>` : ''}
      <label>🏥 IPS:</label>
      <select onchange="APP.setFilter('ips',this.value)">
        <option value="todos">Todas las IPS</option>
        ${ips.map(i=>`<option value="${i}" ${state.filters.ips===i?'selected':''}>${i}</option>`).join('')}
      </select>
      <label>📅 Año:</label>
      <select onchange="APP.setFilter('anio',this.value)">
        <option value="todos">Todos</option>
        ${anios.map(a=>`<option value="${a}" ${state.filters.anio===a?'selected':''}>${a}</option>`).join('')}
      </select>
      <label>Mes:</label>
      <select onchange="APP.setFilter('mes',this.value)">
        <option value="todos">Todos</option>
        ${Object.entries(MESES_ES).map(([k,v])=>`<option value="${k}" ${state.filters.mes===k?'selected':''}>${v}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="APP.resetFilters()">↺ Limpiar</button>
      <span style="font-size:11px;color:#888">${fmtN(count)} registros</span>
      <button class="btn btn-secondary btn-sm" onclick="APP.exportTab()" style="margin-left:8px;background:#27ae60;color:#fff;border-color:#27ae60">⬇️ Exportar Excel</button>
    </div>`;
  }

  function ipsTable(porIps, label='Pacientes') {
    const entries = Object.entries(porIps).sort((a,b)=>b[1]-a[1]).slice(0,30);
    if(!entries.length) return '';
    return `<div class="table-scroll"><table>
      <thead><tr><th>IPS / Prestador</th><th>${label}</th><th>% del total</th></tr></thead>
      <tbody>${entries.map(([k,v])=>{
        const n = typeof v==='number'?v:v.coincidencias||v.total||0;
        const tot = Object.values(porIps).reduce((a,x)=>a+(typeof x==='number'?x:x.total||0),0);
        return `<tr><td>${k}</td><td><b>${fmtN(n)}</b></td><td>${fmt(CALCS.divide(n,tot))}%</td></tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  // ── NAVEGACIÓN ───────────────────────────────────────────
  function navigate(tab) {
    state.activeTab = tab;
    document.querySelectorAll('#sidebar nav a').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+tab));
    const titles = {
      dashboard:'📊 Dashboard General', hospitalizacion:'🏥 Hospitalización',
      uci:'🫀 UCI — Cuidados Intensivos', mortalidad:'⚕️ Mortalidad',
      cesarea:'👶 Cesáreas', desnutricion:'🍽️ Desnutrición (DNT)',
      enfermedades:'🦟 EISP — Enfermedades de Interés en Salud Pública', edaira:'💊 EDA / IRA',
      saludmental:'🧠 Salud Mental', rcv:'❤️ Ruta Cardiovascular (RCV)',
      riamp:'🤱 RIAMP — Materno Perinatal', glosas:'📋 Glosas',
      concurrencias:'🔄 Concurrencias / Casos Abiertos',
      reingreso:'🔁 Reingresos', eventos:'⚠️ Eventos Adversos',
      aiu:'🚑 Autorizaciones Urgencias (AIU)',
      cyd:'🌱 Crecimiento y Desarrollo (CyD)',
      estancia:'🛏️ Estancia Detallada',
      ubicacion:'📍 Usuarios Internados — Estancias Activas',
      rn:'👶 Cohorte Recién Nacido — Res. 117/2026',
      datos:'⚙️ Cargar Datos'
    };
    document.getElementById('topbar-title').textContent = titles[tab]||'Dashboard';
    render();
  }

  function render() {
    const tab = state.activeTab;
    const m = { dashboard, hospitalizacion, uci, mortalidad, cesarea, desnutricion,
                enfermedades, edaira, saludmental, rcv, riamp, glosas, concurrencias,
                reingreso, eventos, aiu, cyd, estancia, ubicacion, rn, datos };
    if (m[tab]) m[tab]();
  }

  // ── CARGA DE ARCHIVOS ────────────────────────────────────
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l=>l.trim());
    const sep = lines[0].includes(';') ? ';' : ',';
    const cols = lines[0].split(sep).map(c=>c.trim().replace(/^"|"$/g,''));
    const rows = lines.slice(1).map(line=>{
      const vals = line.split(sep).map(v=>v.trim().replace(/^"|"$/g,''));
      const row={}; cols.forEach((c,i)=>row[c]=vals[i]||''); return row;
    });
    return {rows,cols};
  }

  function readFile(file, callback) {
    const reader = new FileReader();
    const ext = file.name.split('.').pop().toLowerCase();
    reader.onload = e => {
      try {
        let rows, cols;
        if (ext === 'csv') {
          ({rows,cols} = parseCSV(e.target.result));
        } else {
          const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array', cellDates:true});
          // Para DNT: usar hoja POWEBI si existe, sino primera hoja
          let sheetName = wb.SheetNames[0];
          if (wb.SheetNames.includes('POWEBI')) sheetName = 'POWEBI';
          else if (wb.SheetNames.includes('DATOS')) sheetName = 'DATOS';
          const ws = wb.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(ws, {defval:''});
          cols = rows.length ? Object.keys(rows[0]) : [];
        }
        callback(null, rows, cols);
      } catch(err) { callback(err); }
    };
    if (ext==='csv') reader.readAsText(file,'UTF-8'); else reader.readAsArrayBuffer(file);
  }

  // Columnas esenciales para el dashboard (reduce payload a ~1.5MB)
  const COLS_ESENCIALES_DETALLADO = [
    'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
    'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso','Estado',
    'Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico','Cie10 Egreso',
    'Estancia','Programa Riesgo','Gestacion','Via Parto','Dx Gestante',
    'Control Prenatal','Reingreso','Auditor','Glosas','Valor Total Glosa',
    'Eventos Adversos','Cantidad Evento no calidad','Observación Seguimiento',
    'Patologia alto costo','Especialidad','IPS Primaria'
  ];

  function filtrarEsenciales(rows) {
    if (!rows.length) return rows;
    const reales = Object.keys(rows[0]);
    const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    const normMap = {}; reales.forEach(k => { normMap[norm(k)] = k; });
    const usar = [];
    COLS_ESENCIALES_DETALLADO.forEach(c => {
      const real = rows[0][c] !== undefined ? c : normMap[norm(c)];
      if (real !== undefined) usar.push([c, real]);
    });
    return rows.map(r => {
      const o = {};
      usar.forEach(([alias, real]) => { o[alias] = r[real] ?? ''; });
      return o;
    });
  }

  // Upload principal (DETALLADO)
  // Flujo: browser lee XLSX → intenta subir directo a Supabase → fallback servidor
  function handleUpload(input) {
    const file = input.files[0]; if (!file) return;
    const lbl = document.getElementById('lbl-upload-topbar');
    const span = lbl ? lbl.querySelector('span') : null;
    const setSpan = t => { if (span) span.textContent = t; };
    setSpan('⏳ Leyendo…');
    toast('⏳ Leyendo archivo…','info');

    readFile(file, async (err, rows) => {
      if (err) { toast('❌ '+err.message,'error'); setSpan('📤 Subir Detallado'); return; }

      // 1. Mostrar en pantalla inmediatamente
      state.rows = rows;
      state.meta = CALCS.extractMeta(rows);
      state.fileNames.detallado = file.name;
      state.tipoReporte = 1;
      state.source = 'manual-upload';
      state.uploadedAt.detallado = new Date().toISOString();
      updateStatusBar();
      navigate('dashboard');
      toast(`⏳ ${fmtN(rows.length)} registros leídos. Guardando en Supabase…`,'info');
      setSpan('⏳ Guardando…');

      // 2. Guardar en Supabase — intenta directo desde el browser primero
      let supaOk = false;
      if (window.SUPA_DB) {
        supaOk = await window.SUPA_DB.supaUpload('DATOS', rows, file.name,
          { source: 'manual-upload', tipoReporte: 1 });
      }

      // 3. Si el upload directo falla, intentar via el servidor (fallback)
      if (!supaOk) {
        console.log('[upload] Supabase directo falló — intentando via servidor...');
        try {
          // Filtrar columnas esenciales para reducir el payload
          const rowsFilt = filtrarEsenciales(rows);
          const body = JSON.stringify({
            rows: rowsFilt, fileName: file.name,
            tipoReporte: 1, source: 'manual-upload'
          });
          const mbSize = body.length / 1024 / 1024;
          console.log(`[upload-server] payload: ${mbSize.toFixed(2)} MB`);
          if (mbSize <= 4.0) { // Margen de seguridad bajo el límite de Vercel (4.5MB)
            const r = await fetch('/api/save-detallado', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body
            }).then(x => x.json());
            supaOk = r && r.ok;
            if (supaOk) console.log('[upload-server] ✅ guardado via servidor');
            else console.warn('[upload-server] ❌', r && r.error);
          } else {
            console.warn(`[upload-server] payload muy grande (${mbSize.toFixed(2)} MB > 4 MB), omitiendo ruta servidor`);
          }
        } catch(e) {
          console.warn('[upload-server] excepción:', e.message);
        }
      }

      if (supaOk) {
        render();
        toast(`✅ ${fmtN(rows.length)} registros guardados en Supabase ☁️`,'success');
      } else {
        // Aunque no se guardó en Supabase, los datos están en pantalla
        toast(`⚠️ ${fmtN(rows.length)} registros cargados. Error al guardar en la nube — presiona "💾 Guardar en Supabase" para reintentar.`,'error');
      }
      setSpan('📤 Subir Detallado');
    });
  }

  // Upload por fuente específica (desde tab Datos)
  function handleUploadSource(input, sourceKey) {
    const file = input.files[0]; if (!file) return;
    const src = SOURCES.find(s=>s.key===sourceKey);
    toast(`⏳ Leyendo ${src?.label||sourceKey}…`,'info');
    readFile(file, (err, rows) => {
      if (err) { toast('❌ Error: '+err.message,'error'); return; }
      const stateKey = sourceKey === 'detallado' ? 'rows' : sourceKey+'Rows';
      state[stateKey] = rows;
      state.fileNames[sourceKey] = file.name;
      if (sourceKey === 'detallado') {
        state.meta = CALCS.extractMeta(rows);
      }
      // Para detallado: marcar como manual tipo=1 para proteger vs auto-sync
      const meta = sourceKey === 'detallado'
        ? { source: 'manual-upload', tipoReporte: 1 }
        : {};
      saveToServer(sourceKey.toUpperCase(), rows, file.name, meta);
      updateStatusBar();
      toast(`✅ ${src?.label||sourceKey}: ${fmtN(rows.length)} registros`,'success');
      if (sourceKey === 'detallado') navigate('dashboard'); else datos();
    });
  }

  // ── PERSISTENCIA: localStorage + servidor (opcional) ─────
  const LS_PREFIX = 'ir_';
  const LS_MAX_MB = 4; // máximo ~4MB por fuente en localStorage

  // meta: objeto opcional { source, tipoReporte } para identificar origen
  function saveToServer(table, rows, fileName, meta = {}) {
    // 1. Intentar localStorage (para fuentes pequeñas)
    try {
      const payload = JSON.stringify({rows, fileName, ...meta});
      if (payload.length < LS_MAX_MB * 1024 * 1024) {
        localStorage.setItem(LS_PREFIX + table, payload);
      }
    } catch(e) {}
    // 2. Supabase Storage (nube — persiste en Vercel, incluye meta)
    if (window.SUPA_DB) {
      window.SUPA_DB.supaUpload(table, rows, fileName, meta)
        .then(ok => { if (ok) toast(`☁️ ${table} guardado en la nube`,'success'); })
        .catch(()=>{});
    }
    // 3. Servidor local (solo en localhost)
    fetch('/api/data/'+table, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({rows, fileName, ...meta})
    }).catch(()=>{});
  }

  function updateStatusBar() {
    const total = state.rows.length;
    const extra = (state.rcvRows.length?1:0)+(state.aiuRows.length?1:0)+
                  (state.dntRows.length?1:0)+(state.cydRows.length?1:0)+(state.estanciaRows.length?1:0);
    // Mostrar botón Guardar en Supabase cuando hay datos cargados
    const btnSupa = document.getElementById('btn-save-supa');
    if (btnSupa) btnSupa.style.display = total > 0 ? 'inline-block' : 'none';
    // (btn-save-cloud legacy — ocultar siempre)
    const btnCloud = document.getElementById('btn-save-cloud');
    if (btnCloud) btnCloud.style.display = 'none';
    const el = document.getElementById('data-status');
    if (total > 0) {
      el.textContent = fmtN(total)+(extra>0?` +${extra} fuentes`:'');
      el.style.background = '#27ae60';
    }
  }

  // Cargar datos guardados: Supabase (prioridad) → localStorage → servidor local
  async function loadSaved() {
    const tables = {detallado:'DATOS', rcv:'RCV', aiu:'AIU', dnt:'DNT', cyd:'CYD', estancia:'ESTANCIA'};

    // Verificar servidor local (solo útil en localhost dev)
    let servidorOk = false;
    try {
      const r = await fetch('/api/tables', {signal: AbortSignal.timeout(1000)});
      servidorOk = r.ok;
    } catch(e) {}

    // Intentar Supabase SIEMPRE — es la fuente principal en Vercel
    // NO usamos supaCheck() porque requiere admin; supaDownload maneja errores solo
    const hasSupa = !!window.SUPA_DB;
    if (hasSupa) toast('☁️ Cargando datos desde la nube...','info');

    let supaRestoredMain = false;

    for (const [key, table] of Object.entries(tables)) {
      let d = null;

      // 1. SUPABASE — fuente principal (persiste en Vercel, accesible desde cualquier lugar)
      if (hasSupa) {
        try { d = await window.SUPA_DB.supaDownload(table); } catch(e) {}
      }

      // 2. localStorage — fallback por-dispositivo (si Supabase falla o no tiene datos)
      if (!d || !d.rows || !d.rows.length) {
        try {
          const raw = localStorage.getItem(LS_PREFIX + table);
          if (raw) d = JSON.parse(raw);
        } catch(e) {}
      }

      // 3. Servidor local — solo en localhost/dev
      if ((!d || !d.rows || !d.rows.length) && servidorOk) {
        try { d = await fetch('/api/data/'+table).then(r=>r.json()); } catch(e) {}
      }

      if (d && d.rows && d.rows.length) {
        const stateKey = key === 'detallado' ? 'rows' : key+'Rows';
        state[stateKey] = d.rows;
        state.fileNames[key] = d.fileName||table;
        if (d.uploadedAt) state.uploadedAt[key] = d.uploadedAt;
        if (key === 'detallado') {
          state.meta = CALCS.extractMeta(d.rows);
          if (d.tipoReporte != null) state.tipoReporte = d.tipoReporte;
          if (d.source != null) state.source = d.source;
          supaRestoredMain = true;
        }
      }
    }

    // Cargar mapa de auditores
    try {
      let a = null;
      if (hasSupa) { try { a = await window.SUPA_DB.supaDownload('AUDITORES'); } catch(e) {} }
      if (!a || !a.rows) {
        const raw = localStorage.getItem(LS_PREFIX+'AUDITORES');
        if (raw) a = JSON.parse(raw);
      }
      if ((!a || !a.rows) && servidorOk) {
        try { a = await fetch('/api/data/AUDITORES').then(r=>r.json()); } catch(e) {}
      }
      if (a && a.rows && a.rows.length) {
        const map = {};
        a.rows.forEach(r => { if (r.cedula && r.nombre) map[String(r.cedula).trim()] = r.nombre; });
        CALCS.setAuditoresMap(map);
        state.auditoresMap = map;
      }
    } catch(e) {}

    updateStatusBar();
    if (state.rows.length) {
      toast(`✅ ${fmtN(state.rows.length)} registros restaurados desde la nube ☁️`,'success');
    } else {
      toast('📂 No hay datos en la nube. Sube el Excel Detallado.','info');
    }
  }

  // ── TABS ─────────────────────────────────────────────────

  function dashboard() {
    const el = document.getElementById('tab-dashboard');
    if (!state.rows.length) {
      el.innerHTML = `<div class="no-data">
        <div class="nd-icon">🏥</div>
        <p>No hay datos cargados.<br>Descarga el Excel <b>Detallado Auditoria Hospitalaria</b> del sistema y súbelo aquí.</p>
        <label style="cursor:pointer;display:inline-block;margin-top:16px">
          <input type="file" accept=".xlsx,.xls,.xlsm" onchange="APP.handleUpload(this)" style="display:none">
          <span style="display:inline-flex;align-items:center;gap:8px;padding:14px 32px;background:#e67e22;color:#fff;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:2px solid #d35400">
            📤 Subir Detallado Auditoria Hospitalaria
          </span>
        </label>
        <div id="drive-log-box-dash" style="display:none">
          <div id="drive-log-content-dash"></div>
        </div>
      </div>`;
      return;
    }
    const d = CALCS.calcResumen(state.rows, state.filters);
    const r = CALCS.applyFilters(state.rows, state.filters);
    const extraFuentes = [
      state.rcvRows.length   ? `❤️ RCV: ${fmtN(state.rcvRows.length)}`   : null,
      state.aiuRows.length   ? `🚑 AIU: ${fmtN(state.aiuRows.length)}`   : null,
      state.dntRows.length   ? `🍽️ DNT: ${fmtN(state.dntRows.length)}`  : null,
      state.cydRows.length   ? `🌱 CyD: ${fmtN(state.cydRows.length)}`   : null,
      state.estanciaRows.length ? `🛏️ Est: ${fmtN(state.estanciaRows.length)}` : null,
    ].filter(Boolean);
    // Calcular período de la base
    const fechaMax = state.meta.fechaMax || '';
    let periodoInfo = '';
    if (fechaMax) {
      const m = fechaMax.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
      if (m) {
        const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
        const mesNom = meses[parseInt(m[2])-1];
        periodoInfo = `📅 Información hasta: <b>${m[3]} de ${mesNom} de ${m[1]}</b>`;
      }
    }

    el.innerHTML = `
      ${filterBar()}
      <!-- Banner estado Detallado -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:12px 16px;border-radius:10px;flex-wrap:wrap;${state.tipoReporte===1?'background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border:1.5px solid #a5d6a7':'background:linear-gradient(135deg,#fff3e0,#fff8e1);border:2px solid #ff9800'}">
        <span style="font-size:20px">${state.tipoReporte===1?'✅':'⚠️'}</span>
        <div style="flex:1;min-width:200px">
          <div style="font-weight:700;font-size:13px;color:${state.tipoReporte===1?'#2e7d32':'#e65100'}">
            ${state.tipoReporte===1
              ? `Detallado Auditoria Hospitalaria — ${fmtN(state.rows.length)} registros`
              : `Datos incompletos — ${fmtN(state.rows.length)} registros (no es el Detallado completo)`}
          </div>
          <div style="font-size:11px;color:#555;margin-top:2px">
            ${state.uploadedAt.detallado
              ? `📅 Última subida: <b>${new Date(state.uploadedAt.detallado).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</b>`
              : state.tipoReporte!==1 ? 'Sube el Excel <b>Detallado Auditoria Hospitalaria</b> descargado del sistema.' : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label style="cursor:pointer" title="Subir Excel DETALLADO_AUDITORIA_HOSPITALARIA del sistema hospitalario">
            <input type="file" accept=".xlsx,.xls,.xlsm" onchange="APP.handleUpload(this)" style="display:none">
            <span style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;background:#e67e22;color:#fff;font-size:13px;font-weight:700;cursor:pointer;border:2px solid #d35400;white-space:nowrap">
              📤 ${state.tipoReporte===1?'Actualizar Detallado':'Subir Detallado'}
            </span>
          </label>
          <button onclick="APP.hospitalSync()"
            style="padding:9px 18px;background:#1a4f7a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">
            ▶ Ejecutar descarga automática
          </button>
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        ${periodoInfo ? `<div style="padding:7px 14px;background:#e8f5e9;border-radius:8px;font-size:12px;color:#2e7d32;border:1px solid #a5d6a7">${periodoInfo}</div>` : ''}
        ${state.fileNames.detallado ? `<div style="padding:7px 14px;background:#f3f4f6;border-radius:8px;font-size:12px;color:#555">📄 <b>${state.fileNames.detallado}</b></div>` : ''}
        ${extraFuentes.length ? `<div style="padding:7px 14px;background:#f0f8ff;border-radius:8px;font-size:12px;color:#1a4f7a">${extraFuentes.join(' · ')} <a onclick="APP.navigate('datos')" style="margin-left:8px;font-weight:600;cursor:pointer">+</a></div>` :
        `<div style="padding:7px 14px;background:#fff8e1;border-radius:8px;font-size:12px;color:#888">⚡ Fuentes opcionales no cargadas — <a onclick="APP.navigate('datos')" style="color:#1a4f7a;font-weight:600;cursor:pointer">Cargar en ⚙️ Datos</a></div>`}
      </div>
      ${(() => {
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        const abiertosHoy = r.filter(row => {
          const est = String(CALCS.get(row,'Estado')||'').toLowerCase();
          if (!est.includes('abierto')) return false;
          const fi = CALCS.get(row,'Fecha Ingreso');
          if (!fi) return true;
          const d = new Date(fi); d.setHours(0,0,0,0);
          return d <= hoy;
        });
        const dd = String(hoy.getDate()).padStart(2,'0');
        const mm = String(hoy.getMonth()+1).padStart(2,'0');
        const yyyy = hoy.getFullYear();
        return `<div style="background:linear-gradient(135deg,#1a4f7a,#2980b9);border-radius:12px;padding:14px 20px;margin-bottom:16px;display:flex;align-items:center;gap:16px;color:#fff;box-shadow:0 2px 10px rgba(26,79,122,.3)">
          <div style="font-size:32px">🏥</div>
          <div>
            <div style="font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:.5px">Pacientes con casos ABIERTOS al día de hoy</div>
            <div style="font-size:28px;font-weight:800;line-height:1.1">${fmtN(abiertosHoy.length)} <span style="font-size:13px;font-weight:400;opacity:.8">pacientes activos</span></div>
            <div style="font-size:11px;opacity:.7;margin-top:2px">📅 ${dd}/${mm}/${yyyy} · ${fmt(CALCS.divide(abiertosHoy.length,r.length))}% del total de registros</div>
          </div>
        </div>`;
      })()}
      <div class="section-title" style="margin-bottom:14px"><span>📊</span> Resumen General</div>
      <div class="kpi-grid">
        ${kpi('Total Registros',    fmtN(r.length),             'pac.','',                                                     'blue',  '👥',  'Fuente: DETALLADO_AUDITORIA_HOSPITALARIA\nTodos los registros con los filtros aplicados.')}
        ${kpi('Hospitalizados',     fmtN(d.hospPac),            '',    'En servicios de hospitalización',                      'blue',  '🏥',  'Fuente: campo Servicio\nPacientes en Hospitalización Adultos, Pediátrica y servicios de internación.\nCálculo: registros donde Servicio contiene "Hospitalización".')}
        ${kpi('En UCI',             fmtN(d.uciPac),             '',    `${fmt(CALCS.divide(d.uciPac,r.length))}% del total`,  'purple','🫀',  'Fuente: campo Servicio\nPacientes en UCI Adulto, Neonatal o Pediátrica.\nCálculo: registros donde Servicio contiene "Cuidado Intensivo".')}
        ${kpi('Estancias Activas',   fmtN(d.abiertos),           '',    `${fmt(CALCS.divide(d.abiertos,r.length))}% del total`,'orange','🔄',  'Fuente: campo Estado\nRegistros con Estado = "Abierto" (pacientes aún hospitalizados o en seguimiento).')}
        ${kpi('Egresos (Cerrados)', fmtN(d.egresos),            '',    '',                                                     'blue',  '🚪',  'Fuente: campo Estado\nRegistros con Estado = "Cerrado" (pacientes dados de alta o egresados).')}
        ${kpi('Fallecidos',         fmtN(d.fallecidos),         '',    `${fmt(d.tasaMortalidad)} x1000`,                       'red',   '⚕️', 'Fuente: campo Estado del Egreso\nRegistros donde Estado del Egreso contiene "Fallecido" o "Muerte".')}
        ${kpi('Tasa Mortalidad',    d.tasaMortalidad,           'x1000','',                                                    semColor(d.tasaMortalidad,15,false),'📉','Fórmula: (Fallecidos ÷ Egresos) × 1.000\nMeta: ≤ 15 x1000\nFuente: campos Estado del Egreso y Estado.')}
        ${kpi('Gestantes',          fmtN(d.gestantes),          '',    `${fmt(CALCS.divide(d.gestantes,r.length))}% del total`,'purple','🤱', 'Fuente: campo Gestación\nRegistros donde Gestación = "Sí".')}
        ${kpi('Cesáreas',           d.tasaCesarea,              '%',   `${fmtN(d.cesareas)} de ${fmtN(d.gestantes)} gestantes`,semColor(d.tasaCesarea,50,false),'👶','Fórmula: (Cesáreas ÷ Gestantes) × 100\nMeta: ≤ 50%\nFuente: campo Vía Parto — contiene "cesarea".')}
        ${kpi('Reingresos',         d.tasaReingreso,            '%',   `${fmtN(d.reingresos)} reingresos`,                    semColor(d.tasaReingreso,5,false),'🔁', 'Fórmula: (Reingresos ÷ Egresos) × 100\nMeta: ≤ 5%\nFuente: campo Reingreso = "Sí".')}
        ${kpi('Con Glosa',          fmtN(d.conGlosa),           'casos',fmtM(d.valorGlosa * 1000),                           'red',   '📋',  'Fuente: campo Glosas\nRegistros con valor en Glosas (distinto de 0 o vacío).\nValor = Σ Valor Total Glosa × 1.000 (en COP).')}
        ${kpi('Días Est. Prom',     d.diasEstanciaPromedio,     'días','por egreso',                                         'teal',  '🛏️', 'Fórmula: Σ Estancia ÷ N° Egresos\nFuente: campo Estancia (días de hospitalización por paciente).')}
        ${kpi('Eventos Adversos',   fmtN(d.eventos),            '',    '',                                                    'orange','⚠️', 'Fuente: campo Eventos Adversos\nRegistros con valor numérico > 0 en Eventos Adversos.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Distribución por IPS (Top 10)</h4><canvas id="ch-dash-ips" height="260"></canvas></div>
        <div class="chart-card"><h4>Tendencia Mensual de Ingresos</h4><canvas id="ch-dash-mes" height="260"></canvas></div>
        <div class="chart-card"><h4>Estado del Egreso</h4><canvas id="ch-dash-egreso" height="260"></canvas></div>
        <div class="chart-card"><h4>Programa de Riesgo</h4><canvas id="ch-dash-prog" height="260"></canvas></div>
      </div>`;
    setTimeout(()=>{
      const porIps = CALCS.groupByIPS(r);
      const topIps = Object.entries(porIps).sort((a,b)=>b[1]-a[1]).slice(0,10);
      CHARTS.barras('ch-dash-ips',topIps.map(x=>x[0]),topIps.map(x=>x[1]),'Pacientes','#1a4f7a');
      const porMes = CALCS.groupByMes(r);
      const mesKeys = Object.keys(porMes).sort();
      CHARTS.lineas('ch-dash-mes',mesKeys,[{label:'Ingresos',data:mesKeys.map(k=>porMes[k])}]);
      const egresos = {};
      r.forEach(row=>{ const e=CALCS.get(row,'Estado del Egreso')||'Sin datos'; egresos[e]=(egresos[e]||0)+1; });
      CHARTS.dona('ch-dash-egreso',Object.keys(egresos),Object.values(egresos));
      const progs = {};
      r.forEach(row=>{ const p=CALCS.get(row,'Programa Riesgo')||'Sin programa'; if(p) progs[p]=(progs[p]||0)+1; });
      const topProg = Object.entries(progs).sort((a,b)=>b[1]-a[1]).slice(0,8);
      CHARTS.dona('ch-dash-prog',topProg.map(x=>x[0]),topProg.map(x=>x[1]));
    },50);
  }

  function hospitalizacion() {
    const el = document.getElementById('tab-hospitalizacion');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcHospitalizacion(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Total Hospitalizaciones',fmtN(d.total),'','','blue','🏥','Fuente: DETALLADO_AUDITORIA_HOSPITALARIA\nRegistros en servicios de Hospitalización Adultos, Pediátrica y Observación.')}
        ${kpi('Días Totales Estancia',fmtN(d.diasTotales),'días','','teal','🛏️','Fuente: campo Estancia\nSuma total de días de hospitalización de todos los pacientes en el período.')}
        ${kpi('Promedio Estancia',d.promEstancia,'días','por paciente','orange','📅','Fórmula: Σ Días Estancia ÷ N° Hospitalizaciones\nFuente: campo Estancia.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Hospitalizaciones por IPS (Top 15)</h4><canvas id="ch-hosp-ips" height="270"></canvas></div>
        <div class="chart-card"><h4>Por Servicio</h4><canvas id="ch-hosp-srv" height="270"></canvas></div>
        <div class="chart-card" style="grid-column:1/-1"><h4>Tendencia Mensual</h4><canvas id="ch-hosp-mes" height="200"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Por IPS</h4>${ipsTable(d.porIps)}</div>`;
    setTimeout(()=>{
      const topIps = Object.entries(d.porIps).sort((a,b)=>b[1]-a[1]).slice(0,15);
      CHARTS.barras('ch-hosp-ips',topIps.map(x=>x[0]),topIps.map(x=>x[1]),'Pacientes','#1a4f7a');
      const topSrv = Object.entries(d.porServicio).sort((a,b)=>b[1]-a[1]).slice(0,12);
      CHARTS.barras('ch-hosp-srv',topSrv.map(x=>x[0]),topSrv.map(x=>x[1]),'Pacientes','#2980b9');
      const mesKeys = Object.keys(d.porMes).sort();
      CHARTS.lineas('ch-hosp-mes',mesKeys,[{label:'Ingresos',data:mesKeys.map(k=>d.porMes[k])}]);
    },50);
  }

  function uci() {
    const el = document.getElementById('tab-uci');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcUCI(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('UCI Total',fmtN(d.uciTotal),'pac.',`${fmt(d.tasaUciTotal)}% de hospitalizados`,'blue','🫀','Fuente: campo Servicio\nSuma de UCI Adulto + Neonatal + Pediátrica.\nCálculo: registros donde Servicio contiene "Cuidado Intensivo".')}
        ${kpi('UCI Adulto',fmtN(d.uciAdulto),'',`${fmt(d.tasaUciAdulto)}% de UCI`,'orange','👨','Fuente: campo Servicio\nPacientes en UCI Adulto (Servicio contiene "Intensivo Adulto").')}
        ${kpi('UCI Neonatal',fmtN(d.uciNeonatal),'',`${fmt(d.tasaUciNeonatal)}% de UCI`,'purple','👶','Fuente: campo Servicio\nPacientes en UCI Neonatal (Servicio contiene "Neonatal" o "Neonat").')}
        ${kpi('UCI Pediátrica',fmtN(d.uciPediatrica),'',`${fmt(d.tasaUciPediatrica)}% de UCI`,'teal','🧒','Fuente: campo Servicio\nPacientes en UCI Pediátrica (Servicio contiene "Pediátric" o "Pediatric").')}
        ${kpi('Total Hospitalizados',fmtN(d.totalHosp),'','base de comparación','blue','🏥','Fuente: campo Servicio\nTotal de pacientes en servicios de hospitalización (base para calcular % UCI.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>UCI por Tipo</h4><canvas id="ch-uci-tipo" height="260"></canvas></div>
        <div class="chart-card"><h4>UCI por IPS</h4><canvas id="ch-uci-ips" height="260"></canvas></div>
      </div>`;
    setTimeout(()=>{
      CHARTS.dona('ch-uci-tipo',['UCI Adulto','UCI Neonatal','UCI Pediátrica'],[d.uciAdulto,d.uciNeonatal,d.uciPediatrica]);
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,12);
      CHARTS.barras('ch-uci-ips',top.map(x=>x[0]),top.map(x=>x[1].coincidencias),'UCI','#1a4f7a');
    },50);
  }

  function mortalidad() {
    const el = document.getElementById('tab-mortalidad');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcMortalidad(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Total Fallecidos',fmtN(d.fallecidos),'','','red','⚕️','Fuente: campo Estado del Egreso\nRegistros donde Estado del Egreso contiene "Fallecido" o "Muerte".')}
        ${kpi('Tasa Mortalidad',d.tasaMortalidad,'x1000',`de ${fmtN(d.total)} egresos`,semColor(d.tasaMortalidad,15,false),'📉','Fórmula: (Fallecidos ÷ Egresos) × 1.000\nMeta: ≤ 15 x1000\nFuente: campos Estado del Egreso y Estado.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Mortalidad por IPS</h4><canvas id="ch-mort-ips" height="280"></canvas></div>
        <div class="chart-card"><h4>Tendencia Mensual</h4><canvas id="ch-mort-mes" height="280"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado de Fallecidos</h4>
        ${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Estancia','Diagnostico','Cie10 Diagnostico','Cie10 Egreso','Auditor'])}
      </div>`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].fallecidos-a[1].fallecidos).slice(0,15);
      CHARTS.barras('ch-mort-ips',top.map(x=>x[0]),top.map(x=>x[1].fallecidos),'Fallecidos','#e74c3c');
      const mesKeys = Object.keys(d.porMes).sort();
      CHARTS.lineas('ch-mort-mes',mesKeys,[{label:'Fallecidos',data:mesKeys.map(k=>d.porMes[k])}]);
    },50);
  }

  function cesarea() {
    const el = document.getElementById('tab-cesarea');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcCesareas(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Total Gestantes',fmtN(d.gestantes),'','','purple','🤱','Fuente: campo Gestación\nRegistros donde Gestación = "Sí" o similar.')}
        ${kpi('Cesáreas',fmtN(d.cesareas),'',`${fmt(d.tasaCesarea)}% de partos`,semColor(d.tasaCesarea,50,false),'👶','Fuente: campo Vía Parto\nRegistros donde Vía Parto contiene "cesarea" (sin tilde).')}
        ${kpi('Partos Vaginales',fmtN(d.vaginales),'','','green','✅','Fuente: campo Vía Parto\nRegistros donde Vía Parto contiene "vaginal".')}
        ${kpi('Tasa Cesárea',d.tasaCesarea,'%','',semColor(d.tasaCesarea,50,false),'📊','Fórmula: (Cesáreas ÷ Total Gestantes) × 100\nMeta: ≤ 50%\nFuente: campo Vía Parto.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Tipo de Parto</h4><canvas id="ch-ces-tipo" height="260"></canvas></div>
        <div class="chart-card"><h4>Cesáreas por IPS</h4><canvas id="ch-ces-ips" height="260"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Por IPS</h4>
        <div class="table-scroll"><table><thead><tr><th>IPS</th><th>Gestantes</th><th>Cesáreas</th><th>Vaginales</th><th>Tasa</th></tr></thead>
        <tbody>${Object.entries(d.porIps).sort((a,b)=>b[1].gestantes-a[1].gestantes).map(([k,v])=>`
          <tr><td>${k}</td><td>${fmtN(v.gestantes)}</td><td>${fmtN(v.cesareas)}</td><td>${fmtN(v.vaginales)}</td>
          <td><b>${fmt(CALCS.divide(v.cesareas,v.gestantes))}%</b></td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    setTimeout(()=>{
      CHARTS.dona('ch-ces-tipo',['Cesárea','Vaginal','Sin dato'],[d.cesareas,d.vaginales,d.gestantes-d.cesareas-d.vaginales]);
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].cesareas-a[1].cesareas).slice(0,15);
      CHARTS.barras('ch-ces-ips',top.map(x=>x[0]),top.map(x=>x[1].cesareas),'Cesáreas','#8e44ad');
    },50);
  }

  function desnutricion() {
    const el = document.getElementById('tab-desnutricion');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcDNT(state.rows, state.filters);
    // Si hay datos DNT de SIVIGILA también mostramos
    const dntSivigila = state.dntRows.length;
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Con DNT (Auditoría)',fmtN(d.dnt),'','','red','🍽️','Fuente: campo Programa Riesgo o Cie10 Diagnostico\nPacientes con diagnóstico de desnutrición (CIE-10: E40-E46).')}
        ${kpi('Tasa DNT',d.tasaDNT,'%',`de ${fmtN(d.total)} pacientes`,semColor(d.tasaDNT,85),'📊','Fórmula: (Pacientes con DNT ÷ Total Hospitalizados) × 100\nMeta: ≤ 85% (indicador de detección).')}
        ${dntSivigila ? kpi('SIVIGILA DNT',fmtN(dntSivigila),'registros','Cargados desde Seguimiento DNT','orange','📋','Fuente: archivo Seguimiento DNT (SIVIGILA)\nRegistros de notificación obligatoria de desnutrición.') : ''}
      </div>
      <div class="chart-grid">
        <div class="chart-card" style="grid-column:1/-1"><h4>DNT por IPS</h4><canvas id="ch-dnt-ips" height="240"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado DNT</h4>
        ${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Diagnostico','Cie10 Diagnostico','Programa Riesgo','Estado del Egreso'])}
      </div>
      ${dntSivigila ? `<div class="data-table-wrap" style="margin-top:16px"><h4>SIVIGILA — Seguimiento DNT (${fmtN(dntSivigila)} registros)</h4>
        ${buildTable(state.dntRows,null,100)}</div>` : ''}`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,15);
      CHARTS.barras('ch-dnt-ips',top.map(x=>x[0]),top.map(x=>x[1].coincidencias),'Pacientes DNT','#e74c3c');
    },50);
  }

  function enfermedades() {
    const el = document.getElementById('tab-enfermedades');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcEnfermedades(state.rows, state.filters);

    // Tabla de indicador por enfermedad: DENOMINADOR, NUMERADOR, PROMEDIO
    function enfRow(label, icon, color, key) {
      const e = d[key];
      return `<tr>
        <td><span style="margin-right:6px">${icon}</span><b>${label}</b></td>
        <td style="text-align:center">${fmtN(e.denominador)}</td>
        <td style="text-align:center">${fmtN(e.numerador)}</td>
        <td style="text-align:center"><b style="color:${color}">${fmt(e.promedio)} días</b></td>
        <td style="text-align:center">${fmt(e.result)}%</td>
      </tr>`;
    }

    // Card compacta por enfermedad
    const ENF_INFO = {
      dengue:        'CIE-10: A90, A91, A970-A972\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      leishmaniasis: 'CIE-10: B550-B559, B55\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      chagas:        'CIE-10: B570-B575, B57\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      malaria:       'CIE-10: B50-B54\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      tuberculosis:  'CIE-10: A15-A19 (Tuberculosis pulmonar y extrapulmonar)\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      vih:           'CIE-10: B20-B24, Z21\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación, UCI\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      hematologicas: 'CIE-10: C81-C92, D46, D55-D69\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación, UCI\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      cancer:        'CIE-10: C__ (todos los cánceres)\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación, UCI\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
      erc:           'CIE-10: N18, N19 (Enfermedad Renal Crónica)\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación, UCI\nNumerador: Σ Días Estancia · Denominador: N° Pacientes',
    };
    function enfCard(label, icon, color, key) {
      const e = d[key];
      if (!e.n) return '';
      const info = ENF_INFO[key] || '';
      const infoBtn = info ? `<div class="kpi-info-btn" title="${info.replace(/"/g,"'")}">ⓘ<div class="kpi-tooltip">${info.replace(/\n/g,'<br>')}</div></div>` : '';
      return `<div class="kpi-card" style="border-left:4px solid ${color};position:relative">
        ${infoBtn}
        <div class="kpi-icon">${icon}</div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${fmtN(e.denominador)}<small style="font-size:12px;font-weight:400"> pac.</small></div>
        <div class="kpi-sub">Ʃ ${fmtN(e.numerador)} días · Prom <b>${fmt(e.promedio)}</b> días</div>
      </div>`;
    }

    // Tabla por IPS igual que Power BI: Razon Social | NUMERADOR | DENOMINADOR | RESULTADO
    function tablaIPS(enf, titulo, icon, color) {
      const entries = Object.entries(enf.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias);
      if (!entries.length) return `<div style="padding:12px;color:#aaa;font-size:12px">Sin casos registrados</div>`;
      const rows = entries.map(([ips,v])=>{
        const res = v.coincidencias > 0 ? (v.dias / v.coincidencias).toFixed(2) : '0.00';
        return `<tr><td>${ips}</td><td style="text-align:right">${fmtN(v.dias)}</td><td style="text-align:right">${fmtN(v.coincidencias)}</td><td style="text-align:right;font-weight:700;color:${color}">${res}</td></tr>`;
      });
      const totNum = enf.numerador, totDen = enf.denominador;
      const totRes = totDen > 0 ? (totNum/totDen).toFixed(2) : '0.00';
      return `<div style="margin-bottom:20px">
        <div style="font-weight:700;font-size:14px;padding:10px 14px;background:#f0f4f8;border-radius:8px 8px 0 0;border-left:4px solid ${color}">
          ${icon} ${titulo}
        </div>
        <div class="table-scroll"><table>
          <thead><tr><th>Razon Social</th><th style="text-align:right">NUMERADOR</th><th style="text-align:right">DENOMINADOR</th><th style="text-align:right">RESULTADO</th></tr></thead>
          <tbody>
            ${rows.join('')}
            <tr style="background:#f8fafd;font-weight:700">
              <td><b>Total</b></td>
              <td style="text-align:right">${fmtN(totNum)}</td>
              <td style="text-align:right">${fmtN(totDen)}</td>
              <td style="text-align:right;color:${color}">${totRes}</td>
            </tr>
          </tbody>
        </table></div>
      </div>`;
    }

    el.innerHTML = `${filterBar()}
      <div style="font-size:11px;color:#888;padding:6px 0 12px">
        <b>Lógica:</b> Numerador = Σ Días Estancia · Denominador = N° Pacientes · Resultado = Numerador ÷ Denominador (promedio estancia)
        <br>Servicios: Hosp. Adultos + Hosp. Pediátrica + Observación
      </div>

      <!-- KPI total de registros analizados -->
      <div style="padding:10px 16px;background:#e3f2fd;border-radius:8px;margin-bottom:16px;font-size:12px;color:#1a4f7a;border-left:4px solid #1a4f7a">
        📊 <b>${fmtN(d.total)}</b> registros analizados — se buscan diagnósticos CIE-10 en el campo <b>Diagnostico</b>
      </div>
      <div class="kpi-grid" style="margin-bottom:20px">
        ${[
          enfCard('Dengue (Total)','🦟','#f39c12','dengue'),
          enfCard('Leishmaniasis','🦠','#16a085','leishmaniasis'),
          enfCard('Chagas','🪲','#8b4513','chagas'),
          enfCard('Malaria','🦟','#e74c3c','malaria'),
          enfCard('Tuberculosis','🫁','#7f8c8d','tuberculosis'),
          enfCard('VIH/SIDA','🔴','#8e44ad','vih'),
          enfCard('Hematológicas','🩸','#c0392b','hematologicas'),
          enfCard('Cáncer','🎗️','#922b21','cancer'),
          enfCard('ERC','🫘','#2980b9','erc')
        ].filter(Boolean).join('') ||
        `<div style="grid-column:1/-1;padding:20px;text-align:center;color:#888;background:#f9f9f9;border-radius:8px;border:1px dashed #ccc">
          <div style="font-size:24px;margin-bottom:8px">🔍</div>
          <b>No se encontraron casos</b> de estas enfermedades trazadoras en el período seleccionado.<br>
          <small>Se buscaron CIE-10: A90-A97 (Dengue), B55 (Leishmaniasis), B57 (Chagas), B50-B54 (Malaria),
          A15-A19 (Tuberculosis), B20-B24 (VIH), C__ (Cáncer), N18-N19 (ERC).</small>
        </div>`}
      </div>

      <div class="data-table-wrap">
        ${tablaIPS(d.dengueSinSignos, 'DENGUE SIN SIGNOS DE ALARMA',  '🦟', '#f39c12')}
        ${tablaIPS(d.dengueConSignos, 'DENGUE CON SIGNOS DE ALARMA',  '🦟', '#e67e22')}
        ${tablaIPS(d.dengueGrave,     'DENGUE GRAVE',                  '🦟', '#e74c3c')}
        ${tablaIPS(d.leishmaniasis,   'LEISHMANIASIS',                 '🦠', '#16a085')}
        ${tablaIPS(d.chagas,          'ENFERMEDAD DE CHAGAS',          '🪲', '#8b4513')}
        ${tablaIPS(d.malaria,         'MALARIA',                       '🦟', '#c0392b')}
        ${tablaIPS(d.tuberculosis,    'TUBERCULOSIS',                  '🫁', '#7f8c8d')}
        ${tablaIPS(d.vih,             'VIH / SIDA',                    '🔴', '#8e44ad')}
        ${tablaIPS(d.hematologicas,   'ENFERMEDADES HEMATOLÓGICAS',    '🩸', '#c0392b')}
        ${tablaIPS(d.cancer,          'CÁNCER',                        '🎗️','#922b21')}
        ${tablaIPS(d.erc,             'ERC — ENF. RENAL CRÓNICA',      '🫘', '#2980b9')}
        ${tablaIPS(d.respiratorias,   'ENFERMEDADES RESP. CRÓNICAS',   '🫁', '#1a4f7a')}
      </div>

      <!-- ── Sección Recién Nacido — Res. 117/2026 ── -->
      <div style="margin-top:24px;border-top:2px solid #e3f2fd;padding-top:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="section-title" style="margin:0"><span>🍼</span> Eventos Recién Nacido — Res. 117 de 2026</div>
          <button class="btn btn-sm btn-primary" onclick="APP.navigate('rn')" style="font-size:12px">
            Ver módulo completo →
          </button>
        </div>
        <div style="font-size:11px;color:#888;margin-bottom:10px">
          Servicios: UCI Neonatal · C. Intermedio Neonatal · C. Básico Neonatal
        </div>
        <div class="kpi-grid" style="margin-bottom:14px">
          ${['rnBajoPeso','rnPesoExtremoBajo','rnCongenitas','rnInfeccion','rnAsfixia','rnIctericia']
            .map(k=>{
              const e = d[k]; if(!e) return '';
              const labels = {rnBajoPeso:'Bajo Peso (P070+P071)',rnPesoExtremoBajo:'Peso Extrem. Bajo (P070)',
                rnCongenitas:'Malform. Congénitas (Q)',rnInfeccion:'Infección Neonatal (P35-39)',
                rnAsfixia:'Asfixia (P20-21)',rnIctericia:'Ictericia Neonatal (P55-59)'};
              const icons  = {rnBajoPeso:'⚖️',rnPesoExtremoBajo:'🚨',rnCongenitas:'🧬',
                rnInfeccion:'🦠',rnAsfixia:'🫁',rnIctericia:'🟡'};
              const colors = {rnBajoPeso:'orange',rnPesoExtremoBajo:'red',rnCongenitas:'green',
                rnInfeccion:'red',rnAsfixia:'red',rnIctericia:'orange'};
              return kpi(labels[k], fmtN(e.n), '', `Prom. ${fmt(e.promedio)} días est.`, colors[k], icons[k]);
            }).join('')}
        </div>
        <div class="data-table-wrap">
          ${tablaIPS(d.rnBajoPeso,        'BAJO PESO AL NACER — P070 + P071',       '⚖️', '#e67e22')}
          ${tablaIPS(d.rnPesoExtremoBajo, 'PESO EXTREMADAM. BAJO — P070 (< 1.000g)','🚨', '#e74c3c')}
          ${tablaIPS(d.rnCongenitas,      'MALFORMACIONES CONGÉNITAS — Q00-Q99',    '🧬', '#27ae60')}
          ${tablaIPS(d.rnInfeccion,       'INFECCIÓN NEONATAL — P35-P39',           '🦠', '#c0392b')}
          ${tablaIPS(d.rnAsfixia,         'ASFIXIA PERINATAL — P20-P21',            '🫁', '#8e44ad')}
          ${tablaIPS(d.rnIctericia,       'ICTERICIA NEONATAL — P55-P59',           '🟡', '#f39c12')}
        </div>
      </div>

      <div class="chart-grid" style="margin-top:16px">
        <div class="chart-card" style="grid-column:1/-1"><h4>Comparativo N° Pacientes por Enfermedad Trazadora</h4><canvas id="ch-enf-bar" height="200"></canvas></div>
        <div class="chart-card"><h4>Promedio Días Estancia</h4><canvas id="ch-enf-prom" height="260"></canvas></div>
        <div class="chart-card"><h4>Dengue — Por IPS</h4><canvas id="ch-enf-dengue-ips" height="260"></canvas></div>
      </div>`;

    setTimeout(()=>{
      const labels = ['Dengue','Leishmaniasis','Chagas','Malaria','Tuberculosis','VIH','Hematológicas','Cáncer','ERC'];
      const keys   = ['dengue','leishmaniasis','chagas','malaria','tuberculosis','vih','hematologicas','cancer','erc'];
      CHARTS.barras('ch-enf-bar',labels,keys.map(k=>d[k].n),'Pacientes');
      CHARTS.barras('ch-enf-prom',labels,keys.map(k=>+d[k].promedio.toFixed(1)),'Días Promedio','#e67e22');
      const topDengue = Object.entries(d.dengue.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,12);
      if(topDengue.length) CHARTS.barras('ch-enf-dengue-ips',topDengue.map(x=>x[0]),topDengue.map(x=>x[1].coincidencias),'Dengue','#f39c12');
    },50);
  }

  function edaira() {
    const el = document.getElementById('tab-edaira');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const dE = CALCS.calcEDA(state.rows, state.filters);
    const dI = CALCS.calcIRA(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="section-title" style="margin-bottom:14px"><span>💊</span> EDA — Enfermedad Diarreica Aguda</div>
      <div class="kpi-grid">
        ${kpi('Casos EDA',fmtN(dE.eda),'',`${fmt(dE.tasa)}% del total`,'orange','💊','CIE-10: A00-A09 (Enfermedades intestinales infecciosas)\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación.')}
        ${kpi('Tasa EDA',dE.tasa,'%','','orange','📊','Fórmula: (Casos EDA ÷ Total Hospitalizados) × 100\nFuente: campo Diagnostico, CIE-10: A00-A09.')}
      </div>
      <div class="section-title" style="margin:20px 0 14px"><span>🫁</span> IRA — Infección Respiratoria Aguda</div>
      <div class="kpi-grid">
        ${kpi('Casos IRA',fmtN(dI.ira),'',`${fmt(dI.tasa)}% del total`,'blue','🫁','CIE-10: J00-J22 (Infecciones respiratorias agudas)\nFuente: campo Diagnostico\nServicios: Hosp. Adultos, Pediátrica, Observación.')}
        ${kpi('Tasa IRA',dI.tasa,'%','','blue','📊','Fórmula: (Casos IRA ÷ Total Hospitalizados) × 100\nFuente: campo Diagnostico, CIE-10: J00-J22.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>EDA por IPS</h4><canvas id="ch-eda-ips" height="260"></canvas></div>
        <div class="chart-card"><h4>IRA por IPS</h4><canvas id="ch-ira-ips" height="260"></canvas></div>
      </div>
      ${(() => {
        const COLS = ['IPS Primaria','Numero Identificacion','Nombre Paciente','Dirección','Municipio','Teléfonos','Fecha Ingreso','Fecha Egreso','IPS','Recuento','Ruta'];
        function buildDetalle(rows, ruta) {
          // Calcular recuento de apariciones por Numero Identificacion
          const conteo = {};
          rows.forEach(r => { const id = String(CALCS.get(r,'Numero Identificacion')||''); conteo[id] = (conteo[id]||0)+1; });
          const enriched = rows.map(r => {
            const id = String(CALCS.get(r,'Numero Identificacion')||'');
            return {
              'IPS Primaria':          CALCS.get(r,'IPS Primaria')||CALCS.get(r,'IPS')||'',
              'Numero Identificacion': id,
              'Nombre Paciente':       CALCS.get(r,'Nombre Paciente')||'',
              'Dirección':             CALCS.get(r,'Dirección')||CALCS.get(r,'Direccion')||'',
              'Municipio':             CALCS.get(r,'Municipio')||'',
              'Teléfonos':             CALCS.get(r,'Teléfonos')||CALCS.get(r,'Telefonos')||'',
              'Fecha Ingreso':         CALCS.get(r,'Fecha Ingreso')||'',
              'Fecha Egreso':          CALCS.get(r,'Fecha Egreso')||'',
              'IPS':                   CALCS.get(r,'IPS')||'',
              'Recuento':              conteo[id]||1,
              'Ruta':                  ruta,
            };
          });
          return buildTable(enriched, COLS);
        }
        return `
          <div class="data-table-wrap"><h4>Detalle EDA</h4>${buildDetalle(dE.rows,'EDA')}</div>
          <div class="data-table-wrap" style="margin-top:16px"><h4>Detalle IRA</h4>${buildDetalle(dI.rows,'IRA')}</div>`;
      })()}`;
    setTimeout(()=>{
      const topE = Object.entries(dE.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,12);
      CHARTS.barras('ch-eda-ips',topE.map(x=>x[0]),topE.map(x=>x[1].coincidencias),'Casos EDA','#f39c12');
      const topI = Object.entries(dI.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,12);
      CHARTS.barras('ch-ira-ips',topI.map(x=>x[0]),topI.map(x=>x[1].coincidencias),'Casos IRA','#2980b9');
    },50);
  }

  function saludmental() {
    const el = document.getElementById('tab-saludmental');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcSaludMental(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Total Casos S. Mental',fmtN(d.sm),'',`${fmt(d.tasa)}%`,'purple','🧠','CIE-10: F20-F99 (Trastornos mentales y del comportamiento)\nFuente: campo Diagnostico o Programa Riesgo\nIncluye: intentos de suicidio, psicosis, depresión, entre otros.')}
        ${Object.entries(d.eventos).map(([k,v])=>kpi(k,fmtN(v),'','','red','🔴')).join('')}
      </div>
      <div class="chart-grid">
        <div class="chart-card" style="grid-column:1/-1"><h4>Eventos de Salud Mental</h4><canvas id="ch-sm-bar" height="220"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado</h4>${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Programa Riesgo','Especialidad','Diagnostico','Estado del Egreso'])}</div>`;
    setTimeout(()=>CHARTS.barras('ch-sm-bar',Object.keys(d.eventos),Object.values(d.eventos),'Casos','#8e44ad'),50);
  }

  // ── COHORTE RECIÉN NACIDO — Res. 117/2026 ────────────────
  function rn() {
    const el = document.getElementById('tab-rn');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcRecienNacido(state.rows, state.filters);

    // Sub-tabs internos
    const subTab = el.dataset.subtab || 'resumen';

    const subNav = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;padding:0 2px">
        ${[
          ['resumen',    '📊 Resumen'],
          ['bajopeso',   '⚖️ Bajo Peso'],
          ['congenitas', '🧬 Congénitas'],
          ['tamizaje',   '🔬 Tamizaje'],
          ['abiertos',   '📂 Casos Abiertos'],
          ['fallecidos', '🕊️ Fallecidos'],
        ].map(([k,l])=>`<button class="btn btn-sm ${subTab===k?'btn-primary':'btn-secondary'}"
          onclick="document.getElementById('tab-rn').dataset.subtab='${k}';APP.navigate('rn')"
          style="font-size:12px">${l}</button>`).join('')}
      </div>`;

    let contenido = '';

    if (subTab === 'resumen') {
      contenido = `
        <div class="kpi-grid">
          ${kpi('Total Recién Nacidos', fmtN(d.totalRN), '', `${fmt(CALCS.divide(d.totalRN,d.total))}% del total`, 'blue', '👶',
            'Neonatos identificados por servicio neonatal, CIE-10 bloque P o edad ≤ 28 días.\nFuente: Detallado Auditoría Hospitalaria.')}
          ${kpi('Bajo Peso al Nacer', fmtN(d.bajoPeso), '', `${fmt(d.tasaBajoPeso)}% de RN`, d.bajoPeso>0?'orange':'green', '⚖️',
            'CIE-10: P070 (< 1.000 g) + P071 (1.000–2.499 g)\nResolución 117 de 2026 — Cohorte RN.')}
          ${kpi('Peso Extrem. Bajo (P070)', fmtN(d.pesoExtremoBajo), '', '< 1.000 g', d.pesoExtremoBajo>0?'red':'green', '🚨',
            'CIE-10: P070 — Peso extremadamente bajo al nacer (< 1.000 g)\nAlto riesgo: requiere seguimiento intensivo.')}
          ${kpi('Otro Peso Bajo (P071)', fmtN(d.otroPesoBajo), '', '1.000–2.499 g', d.otroPesoBajo>0?'orange':'green', '⚠️',
            'CIE-10: P071 — Otro peso bajo al nacer (1.000–2.499 g)')}
          ${kpi('Malform. Congénitas', fmtN(d.congenitas), '', `${fmt(CALCS.divide(d.congenitas,d.totalRN))}% de RN`, d.congenitas>0?'orange':'green', '🧬',
            'CIE-10: Q00–Q99 — Malformaciones y anomalías congénitas.\nSeguimiento prioritario según Res. 117/2026.')}
          ${kpi('Tamizaje Alterado', fmtN(d.tamizajeAlterado), '', '', d.tamizajeAlterado>0?'red':'green', '🔬',
            'CIE-10: E00, E03, E70, E74, H90 — Hipotiroidismo congénito, fenilcetonuria, galactosemia, hipoacusia.\nTamizaje neonatal obligatorio.')}
          ${kpi('Ictericia Neonatal', fmtN(d.ictericia), '', '', d.ictericia>0?'orange':'green', '🟡',
            'CIE-10: P55–P59 — Ictericia neonatal (hemolítica, por incompatibilidad, etc.)')}
          ${kpi('Infección Neonatal', fmtN(d.infeccion), '', '', d.infeccion>0?'red':'green', '🦠',
            'CIE-10: P35–P39 — Infecciones específicas del período perinatal.')}
          ${kpi('Asfixia Perinatal', fmtN(d.asfixia), '', '', d.asfixia>0?'red':'green', '🫁',
            'CIE-10: P20–P21 — Hipoxia intrauterina y asfixia al nacer.')}
          ${kpi('Casos Abiertos', fmtN(d.abiertos), '', 'Aún hospitalizados', d.abiertos>0?'orange':'green', '📂',
            'Recién nacidos con estado = Abierto (aún en hospitalización).')}
          ${kpi('Fallecidos Neonatales', fmtN(d.fallecidos), '', `Mortalidad ${fmt(d.tasaMortalidadRN)}%`, d.fallecidos>0?'red':'green', '🕊️',
            'Fallecidos entre los recién nacidos identificados en el período.\nFórmula: (Fallecidos RN ÷ Total RN) × 100')}
        </div>
        <div class="chart-grid">
          <div class="chart-card"><h4>📊 RN por Diagnóstico Agrupado</h4><canvas id="ch-rn-dx" height="280"></canvas></div>
          <div class="chart-card"><h4>📍 RN por IPS (Top 12)</h4><canvas id="ch-rn-ips" height="280"></canvas></div>
          <div class="chart-card" style="grid-column:1/-1"><h4>📅 Tendencia Mensual — Ingresos RN</h4><canvas id="ch-rn-mes" height="180"></canvas></div>
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">📋 Listado General Recién Nacidos (${fmtN(d.totalRN)} registros)</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('todos')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rows, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Estado','Estado del Egreso','Diagnostico','Cie10 Diagnostico','Servicio','Estancia','Auditor','Observación Seguimiento'])}
        </div>`;

    } else if (subTab === 'bajopeso') {
      contenido = `
        <div style="background:#fff8e1;border-left:4px solid #f39c12;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px">
          <strong>⚖️ Seguimiento Bajo Peso al Nacer — Res. 117/2026</strong><br>
          P070: Peso extremadamente bajo (&lt; 1.000 g) · P071: Otro peso bajo (1.000–2.499 g)
        </div>
        <div class="kpi-grid">
          ${kpi('Total Bajo Peso', fmtN(d.bajoPeso), '', `${fmt(d.tasaBajoPeso)}% de RN`, 'orange', '⚖️')}
          ${kpi('P070 Extrem. Bajo', fmtN(d.pesoExtremoBajo), '', '< 1.000 g · Alto riesgo', 'red', '🚨')}
          ${kpi('P071 Otro Bajo', fmtN(d.otroPesoBajo), '', '1.000–2.499 g', 'orange', '⚠️')}
          ${kpi('Fallecidos c/ Bajo Peso', fmtN(d.rowsBajoPeso.filter(r=>CALCS.get(r,'Estado del Egreso')&&/fallecid|muert/i.test(String(CALCS.get(r,'Estado del Egreso')))).length), '', '', 'red', '🕊️')}
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">Lista Bajo Peso al Nacer (${fmtN(d.rowsBajoPeso.length)})</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('bajopeso')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rowsBajoPeso, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Diagnostico','Cie10 Diagnostico','Estado del Egreso','Estancia','Observación Seguimiento'])}
        </div>`;

    } else if (subTab === 'congenitas') {
      contenido = `
        <div style="background:#e8f5e9;border-left:4px solid #27ae60;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px">
          <strong>🧬 Enfermedades Congénitas — Seguimiento Res. 117/2026</strong><br>
          CIE-10: Q00–Q99 — Malformaciones, deformidades y anomalías cromosómicas
        </div>
        <div class="kpi-grid">
          ${kpi('Total Congénitas', fmtN(d.congenitas), '', `${fmt(CALCS.divide(d.congenitas,d.totalRN))}% de RN`, 'green', '🧬')}
          ${kpi('Fallecidos c/ Congénita', fmtN(d.rowsCongenitas.filter(r=>CALCS.get(r,'Estado del Egreso')&&/fallecid|muert/i.test(String(CALCS.get(r,'Estado del Egreso')))).length), '', '', 'red', '🕊️')}
          ${kpi('Casos Abiertos', fmtN(d.rowsCongenitas.filter(r=>String(CALCS.get(r,'Estado')||'').toLowerCase()==='abierto').length), '', 'En seguimiento activo', 'orange', '📂')}
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">Lista Enfermedades Congénitas (${fmtN(d.rowsCongenitas.length)})</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('congenitas')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rowsCongenitas, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Diagnostico','Cie10 Diagnostico','Estado','Estado del Egreso','Estancia','Observación Seguimiento'])}
        </div>`;

    } else if (subTab === 'tamizaje') {
      contenido = `
        <div style="background:#f3e5f5;border-left:4px solid #8e44ad;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px">
          <strong>🔬 Tamizaje Neonatal Alterado — Res. 117/2026</strong><br>
          Hipotiroidismo congénito (E00/E03) · Fenilcetonuria (E70) · Galactosemia (E74) · Hipoacusia (H90)
        </div>
        <div class="kpi-grid">
          ${kpi('Tamizaje Alterado', fmtN(d.tamizajeAlterado), '', `${fmt(CALCS.divide(d.tamizajeAlterado,d.totalRN))}% de RN`, 'purple', '🔬')}
          ${kpi('En Seguimiento Activo', fmtN(d.rowsTamizaje.filter(r=>String(CALCS.get(r,'Estado')||'').toLowerCase()==='abierto').length), '', '', 'orange', '📂')}
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">Lista Tamizaje Alterado (${fmtN(d.rowsTamizaje.length)})</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('tamizaje')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rowsTamizaje, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Diagnostico','Cie10 Diagnostico','Estado','Estado del Egreso','Observación Seguimiento'])}
        </div>`;

    } else if (subTab === 'abiertos') {
      contenido = `
        <div style="background:#e3f2fd;border-left:4px solid #1a4f7a;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px">
          <strong>📂 Casos Abiertos — Recién Nacidos en Seguimiento Activo</strong><br>
          Neonatos con estado = Abierto (aún hospitalizados o en seguimiento). Prioridad Res. 117/2026.
        </div>
        <div class="kpi-grid">
          ${kpi('Total Abiertos', fmtN(d.abiertos), '', 'En seguimiento', 'blue', '📂')}
          ${kpi('c/ Bajo Peso', fmtN(d.rowsAbiertos.filter(r=>CALCS.matchCIE?true:true).filter(r=>['P070','P071'].some(p=>String(CALCS.get(r,'Diagnostico')||'').includes(p))).length), '', '', 'orange', '⚖️')}
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">Casos Abiertos (${fmtN(d.rowsAbiertos.length)})</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('abiertos')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rowsAbiertos, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Diagnostico','Cie10 Diagnostico','Servicio','Estancia','Auditor','Observación Seguimiento'])}
        </div>`;

    } else if (subTab === 'fallecidos') {
      contenido = `
        <div style="background:#fce4ec;border-left:4px solid #e74c3c;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:13px">
          <strong>🕊️ Mortalidad Neonatal</strong><br>
          Recién nacidos con egreso = Fallecido en el período seleccionado.
        </div>
        <div class="kpi-grid">
          ${kpi('Total Fallecidos RN', fmtN(d.fallecidos), '', `Tasa ${fmt(d.tasaMortalidadRN)}%`, 'red', '🕊️',
            'Fórmula: (RN Fallecidos ÷ Total RN) × 100')}
        </div>
        <div class="data-table-wrap">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0">Fallecidos Neonatales (${fmtN(d.rowsFallecidos.length)})</h4>
            <button class="btn btn-secondary btn-sm" onclick="APP.exportRN('fallecidos')">⬇️ Exportar</button>
          </div>
          ${buildTable(d.rowsFallecidos, ['IPS','Nombre Paciente','Numero Identificacion','Edad','Fecha Ingreso','Fecha Egreso','Diagnostico','Cie10 Diagnostico','Cie10 Egreso','Estado del Egreso','Estancia','Auditor','Observación Seguimiento'])}
        </div>`;
    }

    el.innerHTML = `${filterBar()}
      <div style="margin-bottom:14px">
        <div class="section-title"><span>👶</span> Cohorte Recién Nacido — Resolución 117 de 2026 · Min. Salud Colombia</div>
        <div style="font-size:12px;color:#888;margin-top:4px">
          Fuente: Detallado Auditoría Hospitalaria · Identificación por servicio neonatal, CIE-10 bloque P o edad ≤ 28 días
        </div>
      </div>
      ${subNav}
      ${contenido}`;

    // Gráficos solo en resumen
    if (subTab === 'resumen') {
      setTimeout(() => {
        // Diagnósticos
        const dxEntries = Object.entries(d.porDx).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
        if (dxEntries.length) CHARTS.barrasHoriz('ch-rn-dx', dxEntries.map(x=>x[0]), dxEntries.map(x=>x[1]), 'Casos', '#1a4f7a');
        // Por IPS
        const ipsTop = Object.entries(d.porIps).sort((a,b)=>b[1].total-a[1].total).slice(0,12);
        if (ipsTop.length) CHARTS.barrasAgrupadas('ch-rn-ips', ipsTop.map(x=>x[0]), [
          { label: 'Total RN',    data: ipsTop.map(x=>x[1].total) },
          { label: 'Bajo Peso',   data: ipsTop.map(x=>x[1].bajoPeso) },
          { label: 'Congénitas',  data: ipsTop.map(x=>x[1].congenita) },
          { label: 'Fallecidos',  data: ipsTop.map(x=>x[1].fallecidos) },
        ]);
        // Tendencia mensual
        const meses = Object.entries(d.tendenciaMes).sort((a,b)=>a[0]>b[0]?1:-1);
        if (meses.length) CHARTS.linea('ch-rn-mes', meses.map(x=>x[0]), meses.map(x=>x[1]), 'Ingresos RN', '#1a4f7a');
      }, 50);
    }
  }

  function rcv() {
    const el = document.getElementById('tab-rcv');
    // Usar RCV file si está cargado, sino DETALLADO
    const srcRows = state.rcvRows.length ? state.rcvRows : state.rows;
    if (!srcRows.length) { el.innerHTML = noData('Carga el archivo BD_RCV o la base DETALLADO'); return; }
    const d = CALCS.calcRCV(srcRows, state.rows.length ? state.filters : {});
    const fuenteInfo = state.rcvRows.length
      ? `<div style="padding:6px 14px;background:#fff0f0;border-radius:6px;font-size:12px;margin-bottom:12px">❤️ Fuente: <b>${state.fileNames.rcv||'BD_RCV'}</b> — ${fmtN(state.rcvRows.length)} registros</div>`
      : `<div style="padding:6px 14px;background:#fff8e1;border-radius:6px;font-size:12px;margin-bottom:12px">⚠️ Usando DETALLADO como fuente. Para mayor precisión carga el archivo <b>BD_RCV</b> en ⚙️ Datos.</div>`;
    el.innerHTML = `${filterBar()}${fuenteInfo}
      <div class="kpi-grid">
        ${kpi('RCV',fmtN(d.rcv),`${fmt(d.tasa)}%`,'','red','❤️','Fuente: BD_RCV o campo Programa Riesgo\nPacientes en ruta cardiovascular (RCV): hipertensión, diabetes, ACV, IAM.')}
        ${kpi('ACV',fmtN(d.acv),'','','red','🧠','CIE-10: I60-I69 (Enfermedades cerebrovasculares)\nFuente: campo Diagnostico o Patologia alto costo.')}
        ${kpi('IAM',fmtN(d.iam),'','','red','💔','CIE-10: I21-I22 (Infarto agudo de miocardio)\nFuente: campo Diagnostico o Patologia alto costo.')}
        ${kpi('ACV+IAM',fmtN(d.acvIam),'','','red','⚡','Total combinado ACV + IAM\nFuente: campos Diagnostico y Patologia alto costo.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card" style="grid-column:1/-1"><h4>RCV por IPS</h4><canvas id="ch-rcv-ips" height="240"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado RCV</h4>${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Programa Riesgo','Patologia alto costo','Cie10 Diagnostico','Estado del Egreso'])}</div>`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,15);
      CHARTS.barras('ch-rcv-ips',top.map(x=>x[0]),top.map(x=>x[1].coincidencias),'Pacientes RCV','#e74c3c');
    },50);
  }

  function riamp() {
    const el = document.getElementById('tab-riamp');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcRIAMP(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Gestantes Totales',fmtN(d.gestantes),'','','purple','🤱','Fuente: campo Gestación o Dx Gestante\nTotal de gestantes hospitalizadas en el período.')}
        ${kpi('En RIAMP',fmtN(d.riamp),`${fmt(d.tasaRIAMP)}%`,'','green','✅','Fuente: campo Programa Riesgo\nGestantes vinculadas a la Ruta Integral de Atención Materno-Perinatal (RIAMP).')}
        ${kpi('Con Control Prenatal',fmtN(d.conControl),`${fmt(d.tasaControl)}%`,'','blue','🏥','Fuente: campo Control Prenatal\nGestantes con al menos un control prenatal registrado en el sistema.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>RIAMP por IPS</h4><canvas id="ch-riamp-ips" height="260"></canvas></div>
        <div class="chart-card"><h4>Control Prenatal</h4><canvas id="ch-riamp-ctrl" height="260"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado RIAMP</h4>${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Programa Riesgo','Control Prenatal','Via Parto','Dx Gestante','Estado del Egreso'])}</div>`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].gestantes-a[1].gestantes).slice(0,12);
      CHARTS.barrasAgrupadas('ch-riamp-ips',top.map(x=>x[0]),[
        {label:'Gestantes',data:top.map(x=>x[1].gestantes)},
        {label:'RIAMP',data:top.map(x=>x[1].riamp)},
        {label:'Control Prenatal',data:top.map(x=>x[1].conControl)}
      ]);
      CHARTS.dona('ch-riamp-ctrl',['Con Control','Sin Control'],[d.conControl,d.gestantes-d.conControl]);
    },50);
  }

  function glosas() {
    const el = document.getElementById('tab-glosas');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    // ── Password gate ──
    if (!state.glosasUnlocked) {
      el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:300px">
          <div style="background:#fff;border-radius:16px;padding:36px 40px;box-shadow:0 4px 24px rgba(0,0,0,.12);text-align:center;max-width:340px">
            <div style="font-size:40px;margin-bottom:12px">🔒</div>
            <h3 style="color:#1a4f7a;margin-bottom:6px">Área Restringida</h3>
            <p style="font-size:13px;color:#888;margin-bottom:20px">Ingrese la contraseña para acceder a Glosas</p>
            <input id="glosas-pwd" type="password" placeholder="Contraseña"
              style="width:100%;padding:10px 14px;border:2px solid #d1dce8;border-radius:8px;font-size:14px;outline:none;margin-bottom:12px"
              onkeydown="if(event.key==='Enter')APP.unlockGlosas()">
            <button onclick="APP.unlockGlosas()"
              style="width:100%;padding:10px;background:#1a4f7a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">
              Entrar
            </button>
            <div id="glosas-pwd-err" style="color:#e74c3c;font-size:12px;margin-top:8px;display:none">Contraseña incorrecta</div>
          </div>
        </div>`;
      return;
    }
    const d = CALCS.calcGlosas(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Valor Total Glosas',fmtM(d.valorTotal),'','','red','💰','Fuente: campo Valor Total Glosa (en miles de COP)\nCálculo: Σ Valor Total Glosa × 1.000 para convertir a pesos colombianos.')}
        ${kpi('Registros con Glosa',fmtN(d.conGlosa),'',`${fmt(d.tasaGlosa)}% del total`,'orange','📋','Fuente: campo Glosas\nRegistros con valor en Glosas distinto de 0 o vacío.')}
        ${kpi('IPS con Glosas',fmtN(Object.keys(d.porIps).length),'','','blue','🏥','Número de IPS distintas que tienen al menos un registro con glosa en el período filtrado.')}
      </div>
      <div style="margin-bottom:16px">
        <h4 style="font-size:13px;color:#555;margin-bottom:10px">🏆 Auditores con más glosas</h4>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${Object.entries(d.porAuditor).sort((a,b)=>b[1].valor-a[1].valor).slice(0,5).map(([nombre,v],i)=>{
            const pct = CALCS.divide(v.valor,d.valorTotal);
            const color = i===0?'#e74c3c':i===1?'#e67e22':i===2?'#f39c12':'#2980b9';
            return `<div style="display:flex;align-items:center;gap:12px;background:#fff;border-radius:10px;padding:10px 16px;border-left:4px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,.07)">
              <span style="font-size:18px;min-width:28px;text-align:center">${['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:700;color:#2c3e50;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nombre}</div>
                <div style="font-size:11px;color:#888;margin-top:2px">${fmtN(v.count)} glosas · ${fmt(pct)}% del total</div>
              </div>
              <div style="font-size:15px;font-weight:700;color:${color};white-space:nowrap">${fmtM(v.valor)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Valor Glosa por IPS (Top 10)</h4><canvas id="ch-glos-ips" height="280"></canvas></div>
        <div class="chart-card"><h4>Valor Glosa por Auditor</h4><canvas id="ch-glos-aud2" height="280"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Por Auditor</h4>
        <div class="table-scroll"><table style="table-layout:fixed;width:100%">
          <colgroup>
            <col style="width:200px">
            <col style="width:90px">
            <col style="width:130px">
            <col style="width:80px">
          </colgroup>
          <thead><tr><th>Auditor</th><th>N° Glosas</th><th>Valor Total</th><th>%</th></tr></thead>
          <tbody>${Object.entries(d.porAuditor).sort((a,b)=>b[1].valor-a[1].valor).map(([k,v])=>`
            <tr>
              <td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="${k}"><b>${k}</b></td>
              <td style="text-align:right">${fmtN(v.count)}</td>
              <td style="text-align:right"><b>${fmtM(v.valor)}</b></td>
              <td style="text-align:right">${fmt(CALCS.divide(v.valor,d.valorTotal))}%</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="background:#f0f4f8;font-weight:700"><td>Total</td><td style="text-align:right">${fmtN(d.conGlosa)}</td><td style="text-align:right">${fmtM(d.valorTotal)}</td><td style="text-align:right">100%</td></tr></tfoot>
        </table></div>
      </div>
      <div class="data-table-wrap" style="margin-top:16px"><h4>Por IPS</h4>
        <div class="table-scroll"><table><thead><tr><th>IPS</th><th>Glosas</th><th>Valor Total</th><th>% del total</th></tr></thead>
        <tbody>${Object.entries(d.porIps).sort((a,b)=>b[1].valor-a[1].valor).slice(0,30).map(([k,v])=>`
          <tr><td>${k}</td><td>${fmtN(v.count)}</td><td><b>${fmtM(v.valor)}</b></td><td>${fmt(CALCS.divide(v.valor,d.valorTotal))}%</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="data-table-wrap" style="margin-top:16px"><h4>Listado de Glosas</h4>
        ${buildTable(d.rows.map(r=>({
          'IPS': r['IPS'],
          'Paciente': r['Nombre Paciente'],
          'Auditor': r['Nombre Auditor'],
          'Valor': fmtM(r['Valor COP']||0),
          'Tipo Glosa': r['Glosas'],
          'Ingreso': r['Fecha Ingreso'],
        })),null,300)}
      </div>`;
    setTimeout(()=>{
      const topIps = Object.entries(d.porIps).sort((a,b)=>b[1].valor-a[1].valor).slice(0,10);
      CHARTS.barras('ch-glos-ips',topIps.map(x=>x[0]),topIps.map(x=>x[1].valor),'Valor ($)','#e74c3c');
      const allAud = Object.entries(d.porAuditor).sort((a,b)=>b[1].valor-a[1].valor);
      CHARTS.barras('ch-glos-aud2',allAud.map(x=>x[0]),allAud.map(x=>x[1].valor),'Valor Glosa ($)','#8e44ad');
    },50);
  }

  function concurrencias() {
    const el = document.getElementById('tab-concurrencias');
    if (!state.rows.length) { el.innerHTML = noData(); return; }

    const d = CALCS.calcConcurrencias(state.rows, state.filters);

    // Agrupar por Departamento → Municipio → IPS para mostrar "dónde están"
    const porDept = {}, porMun = {};
    d.rows.forEach(row => {
      const dep = CALCS.get(row,'Departamento') || 'Sin Depto';
      const mun = CALCS.get(row,'Municipio')    || 'Sin Municipio';
      const ips = CALCS.get(row,'IPS')          || 'Sin IPS';
      porDept[dep] = (porDept[dep]||0) + 1;
      porMun[mun]  = (porMun[mun]||0)  + 1;
    });

    const topIps  = Object.entries(d.porIps).sort((a,b)=>b[1]-a[1]).slice(0,20);
    const topDept = Object.entries(porDept).sort((a,b)=>b[1]-a[1]);
    const topMun  = Object.entries(porMun).sort((a,b)=>b[1]-a[1]).slice(0,10);

    // Tabla resumen por IPS
    const tablaIps = `<div class="table-scroll"><table>
      <thead><tr><th>#</th><th>IPS / Prestador</th><th>Casos Abiertos</th><th>% del total</th></tr></thead>
      <tbody>${topIps.map(([ips,n],i)=>`<tr>
        <td style="color:#888;font-size:11px">${i+1}</td>
        <td><b>${ips}</b></td>
        <td style="font-weight:700;color:#e67e22">${fmtN(n)}</td>
        <td><div style="display:flex;align-items:center;gap:6px">
          <div style="width:${Math.round(n/d.abiertos*120)}px;height:8px;background:#f39c12;border-radius:4px;max-width:120px"></div>
          <span style="font-size:11px">${fmt(CALCS.divide(n,d.abiertos))}%</span>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>`;

    el.innerHTML = `${filterBar()}
      <!-- KPIs principales -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:18px">
        <div style="background:linear-gradient(135deg,#fff3e0,#fff);border:2px solid #f39c12;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#e65100;font-weight:600;text-transform:uppercase;letter-spacing:.5px">🔄 Casos Abiertos</div>
          <div style="font-size:36px;font-weight:800;color:#e67e22;margin:6px 0">${fmtN(d.abiertos)}</div>
          <div style="font-size:12px;color:#888">${fmt(d.tasa)}% del total · ${fmtN(d.total)} registros</div>
        </div>
        <div style="background:linear-gradient(135deg,#e8f5e9,#fff);border:2px solid #27ae60;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#1b5e20;font-weight:600;text-transform:uppercase;letter-spacing:.5px">🏥 IPS con Casos</div>
          <div style="font-size:36px;font-weight:800;color:#27ae60;margin:6px 0">${fmtN(Object.keys(d.porIps).length)}</div>
          <div style="font-size:12px;color:#888">prestadores activos</div>
        </div>
        <div style="background:linear-gradient(135deg,#e3f2fd,#fff);border:2px solid #1a4f7a;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#0d47a1;font-weight:600;text-transform:uppercase;letter-spacing:.5px">📍 Municipios</div>
          <div style="font-size:36px;font-weight:800;color:#1a4f7a;margin:6px 0">${fmtN(Object.keys(porMun).length)}</div>
          <div style="font-size:12px;color:#888">con casos abiertos</div>
        </div>
        <div style="background:linear-gradient(135deg,#f3e5f5,#fff);border:2px solid #8e44ad;border-radius:12px;padding:16px;text-align:center">
          <div style="font-size:11px;color:#4a148c;font-weight:600;text-transform:uppercase;letter-spacing:.5px">🗺️ Departamentos</div>
          <div style="font-size:36px;font-weight:800;color:#8e44ad;margin:6px 0">${fmtN(Object.keys(porDept).length)}</div>
          <div style="font-size:12px;color:#888">con casos abiertos</div>
        </div>
      </div>

      <!-- Distribución geográfica — tablas simples para máxima compatibilidad -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:18px">
        <div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
          <h4 style="font-size:13px;font-weight:700;color:#1a4f7a;margin-bottom:10px">🗺️ Casos por Departamento</h4>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            ${topDept.map(([dep,n],i)=>`<tr style="border-bottom:1px solid #f0f4f8">
              <td style="padding:5px 4px;font-weight:600">${dep}</td>
              <td style="padding:5px 4px;text-align:right;font-weight:800;color:#8e44ad">${fmtN(n)}</td>
              <td style="padding:5px 4px;width:90px">
                <div style="background:#f0f4f8;border-radius:3px;height:12px;overflow:hidden">
                  <div style="width:${Math.round(n/(topDept[0]?topDept[0][1]:1)*100)}%;min-width:2px;height:100%;background:#8e44ad"></div>
                </div>
              </td>
            </tr>`).join('')}
          </table>
        </div>
        <div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
          <h4 style="font-size:13px;font-weight:700;color:#1a4f7a;margin-bottom:10px">📍 Top Municipios</h4>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            ${topMun.map(([mun,n])=>`<tr style="border-bottom:1px solid #f0f4f8">
              <td style="padding:5px 4px;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mun}</td>
              <td style="padding:5px 4px;text-align:right;font-weight:800;color:#1a4f7a">${fmtN(n)}</td>
              <td style="padding:5px 4px;width:90px">
                <div style="background:#f0f4f8;border-radius:3px;height:12px;overflow:hidden">
                  <div style="width:${Math.round(n/(topMun[0]?topMun[0][1]:1)*100)}%;min-width:2px;height:100%;background:#1a4f7a"></div>
                </div>
              </td>
            </tr>`).join('')}
          </table>
        </div>
      </div>

      <!-- Gráfica por IPS -->
      <div class="chart-card" style="margin-bottom:18px">
        <h4>🏥 Casos Abiertos por IPS (Top ${Math.min(topIps.length,20)})</h4>
        <canvas id="ch-con-ips" height="${Math.max(240,Math.min(topIps.length,20)*26)}"></canvas>
      </div>

      <!-- Tabla por IPS -->
      <div class="data-table-wrap" style="margin-bottom:18px">
        <h4>📊 Resumen por IPS / Prestador</h4>
        ${tablaIps}
      </div>

      <!-- Listado de pacientes -->
      <div class="data-table-wrap">
        <h4>📋 Listado de Pacientes con Casos Abiertos (${fmtN(d.abiertos)} pacientes)</h4>
        ${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Diagnostico','Fecha Ingreso','Departamento','Municipio','Auditor','Observación Seguimiento'])}
      </div>`;

    // Gráfica — timeout para garantizar que el canvas esté en el DOM con dimensiones
    setTimeout(() => {
      if (!topIps.length) return;
      CHARTS.barras('ch-con-ips', topIps.map(x=>x[0]), topIps.map(x=>x[1]), 'Casos Abiertos', '#f39c12');
    }, 120);
  }

  function reingreso() {
    const el = document.getElementById('tab-reingreso');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcReingreso(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Reingresos',fmtN(d.reingresos),'',`${fmt(d.tasa)}% del total`,semColor(d.tasa,5,false),'🔁','Fuente: campo Reingreso\nRegistros donde Reingreso = "Sí" — paciente hospitalizado nuevamente dentro del período.')}
        ${kpi('Tasa Reingreso',d.tasa,'%','',semColor(d.tasa,5,false),'📊','Fórmula: (Reingresos ÷ Egresos) × 100\nMeta: ≤ 5%\nFuente: campo Reingreso.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card" style="grid-column:1/-1"><h4>Reingresos por IPS</h4><canvas id="ch-reing-ips" height="240"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado Reingresos</h4>
        ${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Edad','Diagnostico','Cie10 Diagnostico','Fecha Ingreso','Fecha Egreso','Estado del Egreso'])}
      </div>`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].coincidencias-a[1].coincidencias).slice(0,15);
      CHARTS.barras('ch-reing-ips',top.map(x=>x[0]),top.map(x=>x[1].coincidencias),'Reingresos','#d35400');
    },50);
  }

  function eventos() {
    const el = document.getElementById('tab-eventos');
    if (!state.rows.length) { el.innerHTML = noData(); return; }
    const d = CALCS.calcEventos(state.rows, state.filters);
    el.innerHTML = `${filterBar()}
      <div class="kpi-grid">
        ${kpi('Con Evento Adverso',fmtN(d.conEvento),'',`${fmt(d.tasa)}%`,'orange','⚠️','Fuente: campo Eventos Adversos y Cantidad Evento no calidad\nRegistros con valor numérico > 0 en dichos campos.')}
        ${kpi('Tasa',d.tasa,'%','','orange','📊','Fórmula: (Pacientes con Evento ÷ Total Hospitalizados) × 100\nFuente: campos Eventos Adversos y Cantidad Evento no calidad.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card" style="grid-column:1/-1"><h4>Eventos por IPS</h4><canvas id="ch-ev-ips" height="240"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Listado Eventos Adversos</h4>
        ${buildTable(d.rows,['IPS','Nombre Paciente','Numero Identificacion','Auditor','Eventos Adversos','Cantidad Evento no calidad','Diagnostico','Estado del Egreso'])}
      </div>`;
    setTimeout(()=>{
      const top = Object.entries(d.porIps).sort((a,b)=>b[1].count-a[1].count).slice(0,15);
      CHARTS.barras('ch-ev-ips',top.map(x=>x[0]),top.map(x=>x[1].count),'Eventos','#f39c12');
    },50);
  }

  // ── TAB AIU ───────────────────────────────────────────────
  function aiu() {
    const el = document.getElementById('tab-aiu');
    if (!state.aiuRows.length) {
      el.innerHTML = noData('Carga el archivo Reporte_AIU en ⚙️ Datos para ver las autorizaciones de urgencias');
      return;
    }
    const d = CALCS.calcAIU(state.aiuRows, {});
    el.innerHTML = `
      <div style="padding:6px 14px;background:#fff3e0;border-radius:6px;font-size:12px;margin-bottom:12px">
        🚑 Fuente: <b>${state.fileNames.aiu||'Reporte_AIU'}</b> — ${fmtN(state.aiuRows.length)} registros
      </div>
      <div class="kpi-grid">
        ${kpi('Total Autorizaciones',fmtN(d.total),'','','blue','🚑','Fuente: Reporte_AIU (Autorizaciones de Urgencias)\nTotal de solicitudes de autorización en el período.')}
        ${kpi('Cerradas',fmtN(d.cerradas),'',`${fmt(CALCS.divide(d.cerradas,d.total))}%`,'green','✅','Fuente: campo Estado de la autorización\nSolicitudes con estado Cerrada, Autorizada o Finalizada.')}
        ${kpi('Abiertas/Pendientes',fmtN(d.abiertas),'',`${fmt(CALCS.divide(d.abiertas,d.total))}%`,'orange','⏳','Fuente: campo Estado de la autorización\nSolicitudes con estado Abierta, Pendiente o En proceso.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Por Tipo de Solicitud</h4><canvas id="ch-aiu-tipo" height="260"></canvas></div>
        <div class="chart-card"><h4>Por IPS Solicitante (Top 15)</h4><canvas id="ch-aiu-ips" height="260"></canvas></div>
        <div class="chart-card" style="grid-column:1/-1"><h4>Por Municipio (Top 20)</h4><canvas id="ch-aiu-mun" height="220"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Primeros registros AIU</h4>
        ${buildTable(state.aiuRows,null,100)}
      </div>`;
    setTimeout(()=>{
      const topTipo = Object.entries(d.porTipo).sort((a,b)=>b[1]-a[1]).slice(0,8);
      CHARTS.dona('ch-aiu-tipo',topTipo.map(x=>x[0]),topTipo.map(x=>x[1]));
      const topIps = Object.entries(d.porIps).sort((a,b)=>b[1]-a[1]).slice(0,15);
      CHARTS.barras('ch-aiu-ips',topIps.map(x=>x[0]),topIps.map(x=>x[1]),'Autorizaciones','#e67e22');
      const topMun = Object.entries(d.porMunicipio).sort((a,b)=>b[1]-a[1]).slice(0,20);
      CHARTS.barras('ch-aiu-mun',topMun.map(x=>x[0]),topMun.map(x=>x[1]),'Autorizaciones','#2980b9');
    },50);
  }

  // ── TAB CYD ───────────────────────────────────────────────
  function cyd() {
    const el = document.getElementById('tab-cyd');
    if (!state.cydRows.length) {
      el.innerHTML = noData('Carga el archivo cyd.csv en ⚙️ Datos para ver los indicadores de Crecimiento y Desarrollo');
      return;
    }
    const d = CALCS.calcCYD(state.cydRows, {});
    el.innerHTML = `
      <div style="padding:6px 14px;background:#e8f5e9;border-radius:6px;font-size:12px;margin-bottom:12px">
        🌱 Fuente: <b>${state.fileNames.cyd||'cyd.csv'}</b> — ${fmtN(state.cydRows.length)} registros
      </div>
      <div class="kpi-grid">
        ${kpi('Total Evaluaciones',fmtN(d.total),'','','blue','🌱','Fuente: cyd.csv (Crecimiento y Desarrollo)\nTotal de evaluaciones de niños de 0 a 5 años registradas.')}
        ${kpi('Resultado Normal',fmtN(d.normal),'',`${fmt(d.tasaNormal)}%`,'green','✅','Fuente: campo Resultado o Clasificación\nNiños con tamizaje normal en la evaluación de CyD.')}
        ${kpi('En Riesgo/Alerta',fmtN(d.riesgo),'',`${fmt(CALCS.divide(d.riesgo,d.total))}%`,'red','⚠️','Fuente: campo Resultado o Clasificación\nNiños con resultado en riesgo, alerta o alterado.')}
        ${kpi('Sin Clasificar',fmtN(d.total-d.normal-d.riesgo),'','','orange','❓','Registros sin resultado clasificado (campo Resultado vacío o con valor no reconocido).')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Resultado de Tamizaje</h4><canvas id="ch-cyd-res" height="260"></canvas></div>
        <div class="chart-card"><h4>Por IPS Prestador (Top 15)</h4><canvas id="ch-cyd-ips" height="260"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Por IPS</h4>
        <div class="table-scroll"><table><thead><tr><th>IPS</th><th>Total</th><th>Normal</th><th>Riesgo</th><th>% Normal</th></tr></thead>
        <tbody>${Object.entries(d.porIps).sort((a,b)=>b[1].total-a[1].total).slice(0,30).map(([k,v])=>`
          <tr><td>${k}</td><td>${fmtN(v.total)}</td><td>${fmtN(v.normal)}</td><td>${fmtN(v.riesgo)}</td>
          <td><b>${fmt(CALCS.divide(v.normal,v.total))}%</b></td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="data-table-wrap" style="margin-top:16px"><h4>Primeros registros CyD</h4>
        ${buildTable(state.cydRows,null,80)}
      </div>`;
    setTimeout(()=>{
      CHARTS.dona('ch-cyd-res',['Normal','Riesgo/Alerta','Sin clasificar'],[d.normal,d.riesgo,d.total-d.normal-d.riesgo]);
      const topIps = Object.entries(d.porIps).sort((a,b)=>b[1].total-a[1].total).slice(0,15);
      CHARTS.barrasAgrupadas('ch-cyd-ips',topIps.map(x=>x[0]),[
        {label:'Normal',data:topIps.map(x=>x[1].normal)},
        {label:'Riesgo',data:topIps.map(x=>x[1].riesgo)}
      ]);
    },50);
  }

  // ── TAB ESTANCIA ──────────────────────────────────────────
  function estancia() {
    const el = document.getElementById('tab-estancia');
    const srcRows = state.estanciaRows.length ? state.estanciaRows : state.rows;
    if (!srcRows.length) { el.innerHTML = noData('Carga datos para ver la Estancia Detallada'); return; }
    const d = CALCS.calcEstancia(srcRows, state.estanciaRows.length ? {} : state.filters);
    const fuenteInfo = state.estanciaRows.length
      ? `<div style="padding:6px 14px;background:#e3f2fd;border-radius:6px;font-size:12px;margin-bottom:12px">🛏️ Fuente: <b>${state.fileNames.estancia||'Estancia Detallada'}</b> — ${fmtN(state.estanciaRows.length)} registros</div>`
      : `<div style="padding:6px 14px;background:#fff8e1;border-radius:6px;font-size:12px;margin-bottom:12px">⚠️ Calculado desde DETALLADO. Carga el archivo <b>ESTANCIA DETALLADA</b> en ⚙️ Datos para más detalle.</div>`;
    el.innerHTML = `${state.estanciaRows.length ? '' : filterBar()}${fuenteInfo}
      <div class="kpi-grid">
        ${kpi('Total Registros',fmtN(d.total),'','','blue','🛏️')}
        ${kpi('Días Totales',fmtN(d.diasTotal),'días','','teal','📅')}
        ${kpi('Promedio Estancia',d.promedio,'días','','orange','📊')}
      </div>
      <div class="chart-grid">
        <div class="chart-card"><h4>Promedio por Servicio</h4><canvas id="ch-est-srv" height="280"></canvas></div>
        <div class="chart-card"><h4>Por IPS (Top 15)</h4><canvas id="ch-est-ips" height="280"></canvas></div>
      </div>
      <div class="data-table-wrap"><h4>Por Servicio</h4>
        <div class="table-scroll"><table><thead><tr><th>Servicio</th><th>Pacientes</th><th>Días Totales</th><th>Prom. Estancia</th></tr></thead>
        <tbody>${Object.entries(d.porServicio).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>`
          <tr><td>${k}</td><td>${fmtN(v.n)}</td><td>${fmtN(v.dias)}</td>
          <td><b>${fmt(v.n>0?v.dias/v.n:0)} días</b></td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    setTimeout(()=>{
      const topSrv = Object.entries(d.porServicio).sort((a,b)=>b[1].n-a[1].n).slice(0,12);
      CHARTS.barras('ch-est-srv',topSrv.map(x=>x[0]),topSrv.map(x=>x[1].n>0?x[1].dias/x[1].n:0),'Prom. Días','#2980b9');
      const topIps = Object.entries(d.porIps).sort((a,b)=>b[1].n-a[1].n).slice(0,15);
      CHARTS.barras('ch-est-ips',topIps.map(x=>x[0]),topIps.map(x=>x[1].n>0?x[1].dias/x[1].n:0),'Prom. Días','#1a4f7a');
    },50);
  }

  // ── TAB UBICACIÓN — solo casos ABIERTOS (estancias activas) ──
  function ubicacion() {
    const el = document.getElementById('tab-ubicacion');
    if (!state.rows.length) { el.innerHTML = noData(); return; }

    // Filtros globales aplicados, luego solo ABIERTOS
    const filtrados = CALCS.applyFilters(state.rows, state.filters);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const r = filtrados.filter(row => {
      const est = String(CALCS.get(row,'Estado')||'').toLowerCase();
      if (!est.includes('abierto')) return false;
      const fi = CALCS.get(row,'Fecha Ingreso');
      if (!fi) return true;
      const d = new Date(fi); d.setHours(0,0,0,0);
      return d <= hoy;
    });

    if (!r.length) {
      el.innerHTML = filterBar() + `<div class="no-data"><div class="nd-icon">🏥</div><p>No hay pacientes con casos abiertos en el período seleccionado</p></div>`;
      return;
    }

    // Agrupar por Departamento, Municipio e IPS
    const porDepto   = {};
    const porMunic   = {};
    const porIpsUbic = {};
    const deptoMunis = {};

    r.forEach(row => {
      const dep = CALCS.get(row,'Departamento') || 'Sin Departamento';
      const mun = CALCS.get(row,'Municipio')    || 'Sin Municipio';
      const ips = CALCS.get(row,'IPS')          || 'Sin IPS';
      porDepto[dep]   = (porDepto[dep]||0)   + 1;
      porMunic[mun]   = (porMunic[mun]||0)   + 1;
      porIpsUbic[ips] = (porIpsUbic[ips]||0) + 1;
      if (!deptoMunis[dep]) deptoMunis[dep] = {};
      deptoMunis[dep][mun] = (deptoMunis[dep][mun]||0) + 1;
    });

    const nDeptos = Object.keys(porDepto).filter(k=>k!=='Sin Departamento').length;
    const nMunic  = Object.keys(porMunic).filter(k=>k!=='Sin Municipio').length;
    const nIps    = Object.keys(porIpsUbic).filter(k=>k!=='Sin IPS').length;

    const topDeptos = Object.entries(porDepto).sort((a,b)=>b[1]-a[1]).slice(0,15);
    const topIps    = Object.entries(porIpsUbic).sort((a,b)=>b[1]-a[1]).slice(0,15);

    const deptoRows = Object.entries(deptoMunis).sort((a,b)=>{
      return Object.values(b[1]).reduce((s,v)=>s+v,0) - Object.values(a[1]).reduce((s,v)=>s+v,0);
    });

    const dd = String(hoy.getDate()).padStart(2,'0');
    const mm = String(hoy.getMonth()+1).padStart(2,'0');
    const yyyy = hoy.getFullYear();

    el.innerHTML = `
      ${filterBar()}
      <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);border-radius:12px;padding:13px 20px;margin-bottom:16px;display:flex;align-items:center;gap:14px;color:#fff;box-shadow:0 2px 10px rgba(231,76,60,.3)">
        <div style="font-size:30px">🔴</div>
        <div>
          <div style="font-size:11px;opacity:.85;text-transform:uppercase;letter-spacing:.5px">Estancias activas al día de hoy — casos ABIERTOS</div>
          <div style="font-size:26px;font-weight:800;line-height:1.1">${fmtN(r.length)} <span style="font-size:13px;font-weight:400;opacity:.85">pacientes actualmente hospitalizados o en seguimiento</span></div>
          <div style="font-size:11px;opacity:.75;margin-top:2px">📅 ${dd}/${mm}/${yyyy} · de ${fmtN(filtrados.length)} registros totales (${fmt(CALCS.divide(r.length,filtrados.length))}%)</div>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi('Casos Abiertos',  fmtN(r.length),  '', `${fmt(CALCS.divide(r.length,filtrados.length))}% del total`, 'red',    '🔴', 'Pacientes con Estado = "Abierto" activos al día de hoy.\nFuente: campo Estado.')}
        ${kpi('Departamentos',   fmtN(nDeptos),   '', 'con pacientes activos',  'blue',   '🗺️', 'Departamentos distintos donde hay pacientes abiertos actualmente.')}
        ${kpi('Municipios',      fmtN(nMunic),    '', 'municipios afectados',   'teal',   '📍', 'Municipios distintos con al menos un caso abierto.')}
        ${kpi('IPS con Abiertos',fmtN(nIps),      '', 'instituciones activas',  'purple', '🏥', 'IPS que tienen pacientes con casos abiertos en este momento.')}
      </div>
      <div class="chart-grid">
        <div class="chart-card">
          <h4>🗺️ Casos Abiertos por Departamento</h4>
          <canvas id="ch-ub-dep" height="280"></canvas>
        </div>
        <div class="chart-card">
          <h4>🏥 Casos Abiertos por IPS (Top 15)</h4>
          <canvas id="ch-ub-ips" height="280"></canvas>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:4px">
        <div class="data-table-wrap">
          <h4>🗺️ Por Departamento y Municipio</h4>
          <div class="table-scroll"><table>
            <thead><tr><th>Departamento</th><th>Munic.</th><th>Abiertos</th><th>%</th></tr></thead>
            <tbody>${deptoRows.map(([dep, munis]) => {
              const total = Object.values(munis).reduce((s,v)=>s+v,0);
              const topMuns = Object.entries(munis).sort((a,b)=>b[1]-a[1]).slice(0,3)
                .map(([m,n]) => `<span style="color:#c0392b">${m}</span> <b>(${fmtN(n)})</b>`).join(', ');
              const pct = fmt(CALCS.divide(total, r.length));
              const barW = Math.min(Math.max(parseFloat(pct),0), 100);
              return `<tr>
                <td><b>${dep}</b><br><small style="color:#888;font-size:10px">${topMuns}</small></td>
                <td style="text-align:center">${Object.keys(munis).length}</td>
                <td><b style="color:#c0392b">${fmtN(total)}</b></td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;height:6px;background:#eee;border-radius:3px;min-width:40px">
                      <div style="width:${barW}%;height:6px;background:#e74c3c;border-radius:3px"></div>
                    </div>
                    <span style="font-size:11px;white-space:nowrap">${pct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table></div>
        </div>
        <div class="data-table-wrap">
          <h4>🏥 Por IPS — Casos Abiertos</h4>
          <div class="table-scroll"><table>
            <thead><tr><th>#</th><th>IPS / Prestador</th><th>Abiertos</th><th>%</th></tr></thead>
            <tbody>${Object.entries(porIpsUbic).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([ips, n], i) => {
              const pct = fmt(CALCS.divide(n, r.length));
              const barW = Math.min(Math.max(parseFloat(pct),0), 100);
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`<span style="color:#888;font-size:11px">${i+1}</span>`;
              return `<tr>
                <td style="text-align:center">${medal}</td>
                <td>${ips}</td>
                <td><b style="color:#c0392b">${fmtN(n)}</b></td>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;height:6px;background:#eee;border-radius:3px;min-width:40px">
                      <div style="width:${barW}%;height:6px;background:#e74c3c;border-radius:3px"></div>
                    </div>
                    <span style="font-size:11px;white-space:nowrap">${pct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
      <div class="data-table-wrap" style="margin-top:16px">
        <h4>📍 Municipios con casos abiertos</h4>
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 0">
          ${Object.entries(porMunic).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([m,n],i)=>{
            const pct = fmt(CALCS.divide(n,r.length));
            const col = i<3?'#c0392b':i<8?'#e74c3c':'#95a5a6';
            return `<div style="background:#fff5f5;border-radius:20px;padding:5px 13px;font-size:12px;display:flex;align-items:center;gap:7px;border:1px solid #fadbd8">
              <span style="font-weight:700;color:${col}">${m}</span>
              <span style="background:${col};color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;font-weight:700">${fmtN(n)}</span>
              <span style="color:#aaa;font-size:10px">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    setTimeout(() => {
      CHARTS.barras('ch-ub-dep', topDeptos.map(x=>x[0]), topDeptos.map(x=>x[1]), 'Casos Abiertos', '#e74c3c');
      CHARTS.barras('ch-ub-ips', topIps.map(x=>x[0]),    topIps.map(x=>x[1]),    'Casos Abiertos', '#c0392b');
    }, 50);
  }

  // ── TAB DATOS ─────────────────────────────────────────────
  function datos() {
    const el = document.getElementById('tab-datos');
    // Verificar estado de Drive al abrir la pestaña
    setTimeout(() => APP.driveCheckStatus && APP.driveCheckStatus(), 300);
    const totalMain = state.rows.length;
    const extras = [state.rcvRows,state.aiuRows,state.dntRows,state.cydRows,state.estanciaRows];
    const extraTotal = extras.reduce((a,r)=>a+r.length,0);

    function sourceCard(src) {
      const stateKey = src.key === 'detallado' ? 'rows' : src.key+'Rows';
      const loaded = state[stateKey] && state[stateKey].length > 0;
      const count = loaded ? state[stateKey].length : 0;
      const fname = state.fileNames[src.key]||'';
      return `<div style="border:2px solid ${loaded?src.color:'#d1dce8'};border-radius:12px;padding:20px;background:${loaded?'#f8fffa':'#f8fafd'};position:relative">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:28px">${src.icon}</span>
          <div>
            <div style="font-weight:700;font-size:14px">${src.label}</div>
            <div style="font-size:11px;color:#888">${src.hint}</div>
          </div>
          ${src.required ? '<span style="position:absolute;top:12px;right:12px;background:#1a4f7a;color:#fff;font-size:10px;padding:2px 8px;border-radius:10px">REQUERIDO</span>' : ''}
        </div>
        ${loaded ? `<div style="color:${src.color};font-weight:700;font-size:13px;margin-bottom:10px">✅ ${fmtN(count)} registros — ${fname}</div>` :
                   `<div style="color:#aaa;font-size:12px;margin-bottom:10px">Sin datos cargados</div>`}
        <label style="cursor:pointer;display:inline-block">
          <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onchange="APP.handleUploadSource(this,'${src.key}')" style="display:none">
          <span class="btn btn-${src.required?'primary':'secondary'} btn-sm">${loaded?'🔄 Cambiar archivo':'📂 Cargar archivo'}</span>
        </label>
        ${loaded && src.key !== 'detallado' ? `<button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="APP.clearSource('${src.key}')">🗑️ Limpiar</button>` : ''}
      </div>`;
    }

    el.innerHTML = `
      <!-- ── Panel Detallado Hospitalario ─────────────────── -->
      <div id="drive-panel" class="upload-section" style="border:2px solid #e67e22;background:linear-gradient(135deg,#fff8f0,#fff)">
        <h3 style="color:#d35400">🏥 Detallado Auditoria Hospitalaria</h3>
        <p style="font-size:13px;color:#555;margin-bottom:14px">
          Descarga el reporte <b>DETALLADO_AUDITORIA_HOSPITALARIA</b> del sistema hospitalario
          (<a href="http://asdempleados.dusakawiepsi.com:8080/sie_dusakawi/pages/audit/auditoria_hospitalaria/auditoria_hospitalaria.xhtml" target="_blank" style="color:#e67e22;font-weight:600">abrir sistema ↗</a>)
          y súbelo aquí. Los datos quedan guardados en la nube automáticamente.
        </p>
        ${state.rows.length ? `
        <div style="padding:12px 16px;border-radius:8px;background:${state.tipoReporte===1?'#e8f5e9':'#fff3e0'};border:1px solid ${state.tipoReporte===1?'#a5d6a7':'#ff9800'};font-size:12px;margin-bottom:14px;color:#333">
          ${state.tipoReporte===1
            ? `✅ <b>Detallado cargado</b> — ${fmtN(state.rows.length)} registros${state.uploadedAt.detallado?' · '+new Date(state.uploadedAt.detallado).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}`
            : `⚠️ Actualmente hay <b>${fmtN(state.rows.length)} registros</b> pero NO son el Detallado completo. Sube el archivo correcto.`}
        </div>` : `
        <div style="padding:12px 16px;border-radius:8px;background:#fff3e0;border:1px solid #ff9800;font-size:12px;margin-bottom:14px;color:#555">
          ⚠️ No hay datos cargados. Sube el Excel para activar el dashboard.
        </div>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label style="cursor:pointer;display:inline-block">
            <input type="file" accept=".xlsx,.xls,.xlsm" onchange="APP.handleUpload(this)" style="display:none">
            <span style="display:inline-flex;align-items:center;gap:8px;padding:11px 24px;background:#e67e22;color:#fff;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;border:2px solid #d35400">
              📤 ${state.tipoReporte===1?'Actualizar Detallado':'Subir Detallado'}
            </span>
          </label>
          <button id="btn-hospital-exec" onclick="APP.hospitalSync()"
            style="padding:11px 24px;background:#1a4f7a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">
            ▶ Ejecutar descarga automática
          </button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:#888">
          <b>Subir:</b> manual, tú eliges el archivo · <b>Ejecutar:</b> intenta descargar directo del sistema hospitalario y subir a Supabase
        </div>
        <div style="margin-top:10px">
          <button onclick="APP.recargarNube()" style="padding:8px 18px;background:#8e44ad;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">
            🔄 Recargar desde Supabase
          </button>
          <span style="font-size:11px;color:#888;margin-left:10px">Si ya subiste datos antes, esto los restaura desde la nube</span>
        </div>
        <div id="drive-log-box" style="display:none;margin-top:12px;background:#1a1a2e;border-radius:8px;padding:12px;font-size:11px;font-family:monospace;color:#a8ff78;max-height:220px;overflow-y:auto">
          <div id="drive-log-content"></div>
        </div>
      </div>

      <div class="upload-section">
        <h3>📁 Fuentes de Datos</h3>
        <p style="font-size:13px;color:#666;margin-bottom:20px">Carga las bases de datos para activar cada módulo. El archivo <b>DETALLADO</b> es requerido. Los demás son complementarios y enriquecen los cálculos de cada sección.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
          ${SOURCES.map(src=>sourceCard(src)).join('')}
        </div>
      </div>
      <div class="upload-section">
        <h3>👤 Cruce de Auditores — Cédula → Nombre</h3>
        <p style="font-size:13px;color:#666;margin-bottom:12px">
          Sube un Excel con columnas <b>cedula</b> y <b>nombre</b>, o escribe los nombres manualmente. Estos nombres reemplazarán las cédulas en el módulo de Glosas.
        </p>
        <label style="cursor:pointer;display:inline-block;margin-bottom:16px">
          <input type="file" accept=".xlsx,.xls,.csv" onchange="APP.importAuditores(this)" style="display:none">
          <span class="btn btn-secondary btn-sm">📂 Importar Excel de Auditores (cédula | nombre)</span>
        </label>
        <div id="auditores-editor">
          ${(() => {
            // Obtener todas las cédulas únicas de auditores en la data
            const cedulas = state.rows.length
              ? [...new Set(state.rows.map(r => String(CALCS.get(r,'Auditor')||'').trim()).filter(Boolean))]
              : Object.keys(state.auditoresMap||{});
            if (!cedulas.length) return '<p style="color:#aaa;font-size:12px">Carga la base DETALLADO para ver los auditores.</p>';
            return `<div class="table-scroll"><table>
              <thead><tr><th>Cédula</th><th>Nombre del Auditor</th><th></th></tr></thead>
              <tbody>${cedulas.sort().map(c => `
                <tr>
                  <td style="font-family:monospace;font-weight:600">${c}</td>
                  <td><input type="text" id="aud-${c}" value="${(state.auditoresMap||{})[c]||''}"
                    placeholder="Nombre completo del auditor"
                    style="width:100%;padding:5px 8px;border:1px solid #d1dce8;border-radius:6px;font-size:13px"></td>
                  <td></td>
                </tr>`).join('')}
              </tbody>
            </table></div>
            <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="APP.saveAuditores()">💾 Guardar nombres de auditores</button>`;
          })()}
        </div>
      </div>

      ${totalMain > 0 ? `
      <div class="upload-section">
        <h3>📊 Resumen de datos cargados</h3>
        <div class="kpi-grid" style="margin-bottom:16px">
          ${kpi('DETALLADO',fmtN(totalMain),'registros',state.fileNames.detallado||'','blue','🏥')}
          ${state.rcvRows.length   ? kpi('RCV',       fmtN(state.rcvRows.length),  'registros',state.fileNames.rcv||'',   'red',   '❤️')  : ''}
          ${state.aiuRows.length   ? kpi('AIU',       fmtN(state.aiuRows.length),  'registros',state.fileNames.aiu||'',   'orange','🚑')  : ''}
          ${state.dntRows.length   ? kpi('DNT',       fmtN(state.dntRows.length),  'registros',state.fileNames.dnt||'',   'purple','🍽️') : ''}
          ${state.cydRows.length   ? kpi('CyD',       fmtN(state.cydRows.length),  'registros',state.fileNames.cyd||'',   'green', '🌱')  : ''}
          ${state.estanciaRows.length ? kpi('Estancia',fmtN(state.estanciaRows.length),'registros',state.fileNames.estancia||'','teal','🛏️') : ''}
        </div>
        <h4 style="font-size:13px;color:#555;margin-bottom:8px">Vista previa DETALLADO (primeros 50 registros)</h4>
        ${buildTable(state.rows.slice(0,50), null, 50)}
      </div>` : ''}`;
  }

  return {
    init: async () => {
      // Mostrar pantalla de carga mientras se busca en Supabase
      const tabDatos = document.getElementById('tab-datos');
      if (tabDatos) tabDatos.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:20px">
          <div style="font-size:48px;animation:spin 1.2s linear infinite">☁️</div>
          <div style="font-size:18px;font-weight:700;color:#1a4f7a">Cargando datos desde la nube...</div>
          <div style="font-size:13px;color:#888">Conectando con Supabase — esto solo toma unos segundos</div>
        </div>
        <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>`;
      await loadSaved();
      navigate(state.rows.length ? 'dashboard' : 'datos');
    },
    navigate, render,
    // Recargar datos desde Supabase manualmente (para cuando el auto-load no funciona)
    recargarNube: async () => {
      toast('☁️ Recargando desde Supabase...','info');
      const prevRows = state.rows.length;
      await loadSaved();
      if (state.rows.length > 0) {
        navigate('dashboard');
        toast(`✅ ${fmtN(state.rows.length)} registros restaurados desde la nube`,'success');
      } else {
        toast('⚠️ No se encontraron datos en Supabase. Sube el Excel primero.','error');
        datos(); // refrescar tab datos
      }
    },
    setFilter: (k,v) => { state.filters[k]=v; render(); },
    setFilterDpto: (v) => { state.filters.departamento=v; state.filters.municipio='todos'; render(); },
    resetFilters: () => { state.filters={ips:'todos',anio:'todos',mes:'todos',departamento:'todos',municipio:'todos'}; render(); },
    // ── Exportar subgrupos del tab RN ────────────────────────
    exportRN: (subgrupo) => {
      if (!state.rows.length) { toast('Sin datos cargados','error'); return; }
      const d = CALCS.calcRecienNacido(state.rows, state.filters);
      const mapa = {
        todos:      { rows: d.rows,          name: 'RN_General' },
        bajopeso:   { rows: d.rowsBajoPeso,  name: 'RN_BajoPeso_P070_P071' },
        congenitas: { rows: d.rowsCongenitas,name: 'RN_Congenitas' },
        tamizaje:   { rows: d.rowsTamizaje,  name: 'RN_Tamizaje_Alterado' },
        abiertos:   { rows: d.rowsAbiertos,  name: 'RN_Casos_Abiertos' },
        fallecidos: { rows: d.rowsFallecidos,name: 'RN_Fallecidos' },
      };
      const { rows, name } = mapa[subgrupo] || mapa.todos;
      exportExcel(rows, name, ['IPS','Nombre Paciente','Numero Identificacion','Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso','Estado','Estado del Egreso','Diagnostico','Cie10 Diagnostico','Cie10 Egreso','Servicio','Estancia','Programa Riesgo','Auditor','Observación Seguimiento']);
    },
    exportTab: () => {
      const tab = state.activeTab;
      const tabNames = {
        dashboard:'Dashboard', hospitalizacion:'Hospitalizacion', uci:'UCI',
        mortalidad:'Mortalidad', cesarea:'Cesareas', desnutricion:'Desnutricion',
        enfermedades:'Enfermedades', edaira:'EDA_IRA', saludmental:'SaludMental',
        rcv:'RCV', riamp:'RIAMP', glosas:'Glosas', concurrencias:'Concurrencias',
        reingreso:'Reingreso', eventos:'EventosAdversos', aiu:'AIU', cyd:'CyD',
        estancia:'Estancia', ubicacion:'Ubicacion_Pacientes', rn:'Cohorte_RecienNacido'
      };
      const name = tabNames[tab] || tab;

      // ── Exportar filas de PACIENTES reales según la pestaña ──────────────
      function buildSummary() {
        const f = state.filters;

        // Fuentes externas propias (se exportan completas)
        if (tab === 'aiu')      return state.aiuRows;
        if (tab === 'cyd')      return state.cydRows;
        if (tab === 'estancia') return state.estanciaRows.length ? state.estanciaRows : CALCS.applyFilters(state.rows, f);
        if (tab === 'rcv')      return state.rcvRows.length ? state.rcvRows : CALCS.applyFilters(state.rows, f);

        // Columnas de identidad del paciente — siempre incluidas
        const BASE = [
          'IPS','Departamento','Municipio','Nombre Paciente','Numero Identificacion',
          'Tipo Identificacion','Edad','Sexo','Fecha Ingreso','Fecha Egreso',
          'Estado','Estado del Egreso','Servicio','Diagnostico','Cie10 Diagnostico',
          'Cie10 Egreso','Estancia','Programa Riesgo','Auditor'
        ];
        // Columnas adicionales según pestaña
        const EXTRA = {
          cesarea:       ['Gestacion','Via Parto','Dx Gestante','Control Prenatal'],
          desnutricion:  ['Patologia Alto Costo'],
          riamp:         ['Gestacion','Via Parto','Control Prenatal','Dx Gestante'],
          glosas:        ['Glosas','Valor Total Glosa','Nombre Auditor','Valor COP'],
          concurrencias: ['Observación Seguimiento','Reingreso'],
          reingreso:     ['Reingreso'],
          eventos:       ['Eventos Adversos','Cantidad Evento no calidad'],
          saludmental:   ['Especialidad'],
          enfermedades:  ['Especialidad','Cie10 Diagnostico'],
          edaira:        ['IPS Primaria','Ruta'],
          ubicacion:     [],
        };

        // Proyecta las columnas base + extra sobre las filas recibidas
        function project(rows) {
          if (!rows || !rows.length) return [];
          const extra = EXTRA[tab] || [];
          const cols = [...new Set([...BASE, ...extra])];
          return rows.map(row => {
            const o = {};
            cols.forEach(c => { o[c] = CALCS.get(row, c) ?? ''; });
            return o;
          });
        }

        // ── Ubicación: solo casos abiertos ───────────────────
        if (tab === 'ubicacion') {
          const hoyE = new Date(); hoyE.setHours(0,0,0,0);
          const abiertos = CALCS.applyFilters(state.rows, f).filter(row => {
            const est = String(CALCS.get(row,'Estado')||'').toLowerCase();
            if (!est.includes('abierto')) return false;
            const fi = CALCS.get(row,'Fecha Ingreso'); if (!fi) return true;
            const d = new Date(fi); d.setHours(0,0,0,0); return d <= hoyE;
          });
          return project(abiertos);
        }

        // ── Pestañas con filas en calc functions ────────────
        if (tab === 'hospitalizacion') {
          const d = CALCS.calcHospitalizacion(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'uci') {
          const d = CALCS.calcUCI(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'mortalidad') {
          const d = CALCS.calcMortalidad(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'cesarea') {
          const d = CALCS.calcCesareas(state.rows, f);
          // Exportar gestantes (incluye cesáreas y vaginales)
          return project(d.gestantesRows || d.rows || []);
        }
        if (tab === 'desnutricion') {
          const d = CALCS.calcDNT(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'riamp') {
          const d = CALCS.calcRIAMP(state.rows, f);
          // Exportar todas las gestantes (no solo las en RIAMP)
          return project(d.gestantesRows || d.rows || []);
        }
        if (tab === 'glosas') {
          const d = CALCS.calcGlosas(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'concurrencias') {
          const d = CALCS.calcConcurrencias(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'reingreso') {
          const d = CALCS.calcReingreso(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'eventos') {
          const d = CALCS.calcEventos(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'saludmental') {
          const d = CALCS.calcSaludMental(state.rows, f);
          return project(d.rows || []);
        }
        if (tab === 'edaira') {
          const dE = CALCS.calcEDA(state.rows, f);
          const dI = CALCS.calcIRA(state.rows, f);
          const mkRows = (rows, ruta) => rows.map(r => ({
            ...(() => { const o={}; BASE.forEach(c=>{o[c]=CALCS.get(r,c)??'';}); return o; })(),
            'IPS Primaria': CALCS.get(r,'IPS Primaria')||CALCS.get(r,'IPS')||'',
            'Ruta': ruta,
          }));
          return [...mkRows(dE.rows||[],'EDA'), ...mkRows(dI.rows||[],'IRA')];
        }
        if (tab === 'enfermedades') {
          // Combinar todas las enfermedades trazadoras
          const d = CALCS.calcEnfermedades(state.rows, f);
          const enfs = ['dengue','tuberculosis','vih','hematologicas','cancer','erc',
                        'leishmaniasis','chagas','malaria','zoonoticas','respiratorias'];
          const labels = {'dengue':'Dengue','tuberculosis':'Tuberculosis','vih':'VIH',
            'hematologicas':'Hematológicas','cancer':'Cáncer','erc':'ERC',
            'leishmaniasis':'Leishmaniasis','chagas':'Chagas','malaria':'Malaria',
            'zoonoticas':'Zoonóticas','respiratorias':'Respiratorias'};
          const allRows = [];
          enfs.forEach(k => {
            if (d[k] && d[k].rows) {
              d[k].rows.forEach(r => {
                const o = {}; BASE.forEach(c=>{o[c]=CALCS.get(r,c)??'';});
                o['Enfermedad'] = labels[k]||k;
                allRows.push(o);
              });
            }
          });
          // Deduplicar por ID paciente
          const seen = new Set();
          return allRows.filter(r => {
            const k = r['Numero Identificacion']||JSON.stringify(r);
            if (seen.has(k)) return false; seen.add(k); return true;
          });
        }

        // dashboard / default: todos los registros filtrados
        return project(CALCS.applyFilters(state.rows, f));
      }

      const rows = buildSummary();
      if (!rows || !rows.length) { toast('Sin datos para exportar','error'); return; }
      openExportModal(rows, name);
    },
    closeExportModal: () => {
      document.getElementById('export-modal').style.display = 'none';
    },
    updateColCount: () => {
      const total = document.querySelectorAll('.exp-col-chk').length;
      const checked = document.querySelectorAll('.exp-col-chk:checked').length;
      document.getElementById('export-col-count').textContent = `${checked} de ${total} columnas`;
    },
    toggleAllCols: (val) => {
      document.querySelectorAll('.exp-col-chk').forEach(c => c.checked = val);
      APP.updateColCount();
    },
    doExport: () => {
      const cols = [...document.querySelectorAll('.exp-col-chk:checked')].map(c => c.value);
      if (!cols.length) { toast('Selecciona al menos una columna','error'); return; }
      exportExcel(_exportRows, _exportName, cols);
      document.getElementById('export-modal').style.display = 'none';
    },
    unlockGlosas: () => {
      const pwd = document.getElementById('glosas-pwd')?.value;
      if (pwd === '123456') {
        state.glosasUnlocked = true;
        glosas();
      } else {
        const err = document.getElementById('glosas-pwd-err');
        if (err) { err.style.display='block'; err.textContent='Contraseña incorrecta ❌'; }
        const inp = document.getElementById('glosas-pwd');
        if (inp) { inp.style.border='2px solid #e74c3c'; inp.value=''; inp.focus(); }
      }
    },
    // ── Google Drive sync ──────────────────────────────────
    driveCheckStatus: async () => {
      try {
        const r = await fetch('/api/drive-status').then(x=>x.json());
        const box = document.getElementById('drive-status-box');
        const setupInfo = document.getElementById('drive-setup-info');
        if (!box) return;
        if (!r.configured) {
          box.innerHTML = '<span style="color:#e65100">⚠️ No se pudo conectar al servidor.</span>';
          return;
        }
        if (r.inProgress) {
          box.innerHTML = '<span style="color:#1a73e8">🔄 <b>Sincronización en progreso...</b></span>';
          return;
        }
        if (r.lastSync) {
          const s = r.lastSync;
          const ts = new Date(s.timestamp).toLocaleString('es-CO');
          const sync = s.synced||[];
          const skip = s.skipped||[];
          const err  = s.errors||[];
          const syncList = sync.length ? sync.map(x=>`<b>${x.table}</b>: ${x.name} (${(x.rows||0).toLocaleString()} reg.)`).join(' · ') : '—';
          box.innerHTML = `
            <div style="display:flex;gap:20px;flex-wrap:wrap">
              <span>🕐 Último sync: <b>${ts}</b></span>
              <span style="color:#27ae60">✅ Actualizados: <b>${sync.length}</b></span>
              <span style="color:#888">⏭️ Sin cambios: <b>${skip.length}</b></span>
              ${err.length?`<span style="color:#e74c3c">❌ Errores: <b>${err.length}</b></span>`:''}
            </div>
            ${sync.length?`<div style="margin-top:6px;color:#27ae60;font-size:11px">${syncList}</div>`:''}
            ${err.length?`<div style="margin-top:4px;color:#e74c3c;font-size:11px">${err.map(e=>e.name+': '+e.error).join(' · ')}</div>`:''}`;
        } else {
          box.innerHTML = '<span style="color:#888">Sin sincronizaciones previas. Haz clic en "Sincronizar ahora".</span>';
        }
      } catch(e) {
        const box = document.getElementById('drive-status-box');
        if (box) box.innerHTML = '<span style="color:#888">ℹ️ Servidor local no disponible (solo en modo local).</span>';
      }
    },
    driveSync: async (force=false) => {
      const btn = document.getElementById(force?'btn-drive-force':'btn-drive-sync');
      const btnDash = document.getElementById('btn-dash-sync');
      const btnTopbar = document.getElementById('btn-topbar-sync');
      const logBox = document.getElementById('drive-log-box');
      const logBoxDash = document.getElementById('drive-log-box-dash');
      const logContent = document.getElementById('drive-log-content');
      const logContentDash = document.getElementById('drive-log-content-dash');
      if (btn) { btn.disabled=true; btn.textContent='⏳ Sincronizando...'; }
      if (btnDash) { btnDash.disabled=true; btnDash.textContent='⏳ Descargando...'; }
      if (btnTopbar) { btnTopbar.disabled=true; btnTopbar.textContent='⏳ Actualizando...'; }
      if (logBox) { logBox.style.display='block'; logContent.innerHTML=''; }
      if (logBoxDash) { logBoxDash.style.display='block'; if(logContentDash) logContentDash.innerHTML=''; }
      toast('🔄 Descargando desde Google Sheets...','info');
      try {
        const r = await fetch('/api/drive-sync',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({force})
        }).then(x=>x.json());

        if (logContent && r.log) {
          logContent.innerHTML = r.log.map(l=>`<div>${l}</div>`).join('');
          logBox.scrollTop = logBox.scrollHeight;
        }
        if (logContentDash && r.log) {
          logContentDash.innerHTML = r.log.map(l=>`<div>${l}</div>`).join('');
          if (logBoxDash) logBoxDash.scrollTop = logBoxDash.scrollHeight;
        }

        if (!r.ok) {
          toast('❌ '+r.error,'error');
          if (r.result && r.result.needsSetup) {
            const si = document.getElementById('drive-setup-info');
            if (si) si.style.display='block';
          }
        } else {
          const s = r.result;
          const n = (s.synced||[]).length;
          if (n > 0) {
            toast(`✅ Datos actualizados desde Google Sheets. Recargando...`,'success');
            await loadSaved();
            render();
          } else {
            toast('☁️ Todo al día — sin cambios en Drive.','info');
          }
          APP.driveCheckStatus();
        }
      } catch(e) {
        toast('❌ Error: '+e.message,'error');
      }
      if (btn) { btn.disabled=false; btn.textContent=force?'⚡ Forzar re-descarga (todo)':'🔄 Sincronizar ahora'; }
      if (btnDash) { btnDash.disabled=false; btnDash.textContent='🔄 Descargar datos nuevos'; }
      if (btnTopbar) { btnTopbar.disabled=false; btnTopbar.textContent='🔄 Actualizar ahora'; }
    },
    handleUpload,
    handleUploadSource,
    // ── Guardar datos actuales en Supabase ────────────────────
    saveDetallado: async () => {
      if (!state.rows.length) { toast('⚠️ No hay datos cargados para guardar','error'); return; }
      const btn = document.getElementById('btn-save-supa');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando...'; }
      toast('⏳ Guardando en Supabase...', 'info');
      try {
        // Guardar directo en Supabase desde el browser (sin límite Vercel)
        const supaOkDirect = await window.SUPA_DB.supaUpload('DATOS', state.rows,
          state.fileNames.detallado || 'DETALLADO_AUDITORIA_HOSPITALARIA.xlsx',
          { tipoReporte: state.tipoReporte || 1, source: state.source || 'manual-upload' });
        const r = { ok: supaOkDirect, rows: state.rows.length,
          uploadedAt: new Date().toISOString(),
          error: supaOkDirect ? null : 'Error al subir a Supabase — ver consola' };
        if (!r.ok) {
          toast('❌ Error al guardar: ' + r.error, 'error');
          if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar en Supabase'; }
        } else {
          if (r.uploadedAt) state.uploadedAt.detallado = r.uploadedAt;
          toast(`✅ ${fmtN(r.rows)} registros guardados en Supabase ☁️`, 'success');
          if (btn) { btn.disabled = false; btn.textContent = '✅ Guardado en Supabase'; btn.style.background='#27ae60';
            setTimeout(() => { btn.textContent='💾 Guardar en Supabase'; btn.style.background='#8e44ad'; }, 4000);
          }
          render(); // refrescar dashboard con fecha actualizada
        }
      } catch(e) {
        toast('❌ Error: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar en Supabase'; }
      }
    },
    // ── Descarga directa del sistema hospitalario → Supabase ──
    hospitalSync: async () => {
      const btn = document.getElementById('btn-hospital-exec');
      const logBox = document.getElementById('drive-log-box');
      const logContent = document.getElementById('drive-log-content');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Ejecutando...'; }
      if (logBox) { logBox.style.display = 'block'; }
      if (logContent) { logContent.innerHTML = '<div style="color:#fff">🔄 Conectando al sistema hospitalario...</div>'; }
      toast('🔄 Descargando del hospital...', 'info');
      try {
        const r = await fetch('/api/drive-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        }).then(x => x.json());

        // Mostrar log
        if (logContent && r.log && r.log.length) {
          logContent.innerHTML = r.log.map(l => `<div>${l}</div>`).join('');
          if (logBox) logBox.scrollTop = logBox.scrollHeight;
        }

        if (!r.ok) {
          toast('❌ ' + (r.error || 'Error en la descarga'), 'error');
          if (logContent) logContent.innerHTML += `<div style="color:#ff6b6b">❌ ${r.error}</div>`;
        } else if (r.result && r.result.skipped) {
          toast('ℹ️ Datos ya estaban actualizados en la nube', 'info');
        } else {
          const rows = r.result && r.result.synced && r.result.synced[0] && r.result.synced[0].rows;
          toast(`✅ ${rows ? fmtN(rows) + ' registros' : 'Datos'} descargados y guardados en Supabase`, 'success');
          // Recargar datos en pantalla
          await loadSaved();
          render();
        }
      } catch(e) {
        toast('❌ Error: ' + e.message, 'error');
        if (logContent) logContent.innerHTML += `<div style="color:#ff6b6b">❌ ${e.message}</div>`;
      }
      if (btn) { btn.disabled = false; btn.textContent = '▶ Ejecutar descarga automática'; }
    },
    saveToCloud: async () => {
      if (!window.SUPA_DB) { toast('❌ Supabase no disponible','error'); return; }
      const btn = document.getElementById('btn-save-cloud');
      if (btn) { btn.disabled = true; btn.textContent = '☁️ Guardando...'; }
      const sources = [
        { table:'DATOS',    rows: state.rows,         fileName: state.fileNames.detallado },
        { table:'RCV',      rows: state.rcvRows,       fileName: state.fileNames.rcv },
        { table:'AIU',      rows: state.aiuRows,       fileName: state.fileNames.aiu },
        { table:'DNT',      rows: state.dntRows,       fileName: state.fileNames.dnt },
        { table:'CYD',      rows: state.cydRows,       fileName: state.fileNames.cyd },
        { table:'ESTANCIA', rows: state.estanciaRows,  fileName: state.fileNames.estancia },
      ].filter(s => s.rows && s.rows.length > 0);
      let ok = 0, fail = 0;
      for (const s of sources) {
        const res = await window.SUPA_DB.supaUpload(s.table, s.rows, s.fileName||s.table);
        res ? ok++ : fail++;
      }
      if (btn) { btn.disabled = false; btn.textContent = '☁️ Guardar en nube'; }
      if (ok > 0 && fail === 0) toast(`✅ ${ok} fuente(s) guardadas en la nube. Al abrir la app se restaurarán automáticamente.`, 'success');
      else if (ok > 0) toast(`⚠️ ${ok} guardadas, ${fail} fallaron (muy grandes). Revise la consola.`, 'info');
      else toast('❌ No se pudo guardar. Verifique el bucket en Supabase.', 'error');
    },
    importAuditores: (input) => {
      const file = input.files[0]; if (!file) return;
      readFile(file, (err, rows) => {
        if (err) { toast('❌ Error: '+err.message,'error'); return; }
        const map = {};
        rows.forEach(r => {
          // Acepta columnas: cedula/cédula/documento/cc y nombre/name
          const ced = String(r['cedula']||r['cédula']||r['Cedula']||r['CC']||r['Documento']||'').trim();
          const nom = String(r['nombre']||r['Nombre']||r['name']||r['NOMBRE']||'').trim();
          if (ced && nom) map[ced] = nom;
        });
        if (!Object.keys(map).length) { toast('⚠️ No se encontraron columnas cedula/nombre','error'); return; }
        state.auditoresMap = {...(state.auditoresMap||{}), ...map};
        CALCS.setAuditoresMap(state.auditoresMap);
        const rows2 = Object.entries(state.auditoresMap).map(([cedula,nombre])=>({cedula,nombre}));
        saveToServer('AUDITORES', rows2, 'auditores');
        toast(`✅ ${Object.keys(map).length} auditores importados`,'success');
        datos(); // re-render para mostrar nombres en el editor
      });
    },
    saveAuditores: () => {
      const inputs = document.querySelectorAll('[id^="aud-"]');
      const map = {};
      inputs.forEach(inp => {
        const cedula = inp.id.replace('aud-','');
        const nombre = inp.value.trim();
        if (nombre) map[cedula] = nombre;
      });
      state.auditoresMap = map;
      CALCS.setAuditoresMap(map);
      const rows = Object.entries(map).map(([cedula,nombre])=>({cedula,nombre}));
      saveToServer('AUDITORES', rows, 'auditores');
      toast(`✅ ${rows.length} nombres de auditores guardados`,'success');
    },
    clearSource: (key) => {
      const stateKey = key+'Rows';
      state[stateKey] = [];
      delete state.fileNames[key];
      try { localStorage.removeItem(LS_PREFIX + key.toUpperCase()); } catch(e) {}
      fetch('/api/data/'+key.toUpperCase(), {method:'DELETE'}).catch(()=>{});
      updateStatusBar();
      datos();
      toast(`🗑️ Fuente ${key.toUpperCase()} eliminada`,'info');
    },
    state
  };
})();

function navigate(tab) { APP.navigate(tab); }
document.addEventListener('DOMContentLoaded', () => APP.init());
