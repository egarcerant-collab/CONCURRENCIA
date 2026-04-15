// ============================================================
// MOTOR DE CÁLCULOS — Multi-fuente
// Fuentes: DETALLADO (principal), RCV, AIU, DNT, CYD, ESTANCIA
// ============================================================
const CALCS = (() => {

  // ── Utilidades ──────────────────────────────────────────
  function safeNum(v) {
    if (!v && v !== 0) return 0;
    const s = String(v).replace(/[^\d.\-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  function norm(s) {
    return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  }
  function esSI(v) { return /^s[ií]$/i.test(String(v||'').trim()); }
  function divide(n, d, scale=100) {
    n = safeNum(n); d = safeNum(d);
    return (!d || d===0) ? 0 : (n/d)*scale;
  }
  function get(row, col) {
    if (row[col] !== undefined) return row[col];
    const nc = norm(col);
    for (const k of Object.keys(row)) if (norm(k)===nc) return row[k];
    return '';
  }

  // ── Clasificación de Servicios (basada en SERVICIOS.txt) ─
  const SVC_MAP = {
    'hospitalizacion adultos':     'Hospitalización Adultos',
    'hospitalizacion pediatrica':  'Hospitalización Pediátrica',
    'observacion':                 'Observación',
    'urgencias':                   'Urgencias',
    'cirugia':                     'Cirugía',
    'salud mental':                'Salud Mental',
    'cuidado intensivo adulto':    'UCI Adulto',
    'cuidado intensivo neonatal':  'UCI Neonatal',
    'cuidado intensivo pediatrica':'UCI Pediátrica',
    'cuidado intermedio adulto':   'C. Intermedio Adulto',
    'cuidado intermedio neonatal': 'C. Intermedio Neonatal',
    'cuidado intermedio pediatrica':'C. Intermedio Pediátrica',
    'cuidado basico neonatal':     'C. Básico Neonatal',
    'otros':                       'Otros',
  };

  // Extrae TODOS los servicios de un registro (el campo puede tener varios separados por --)
  function getServicios(row) {
    const raw = String(get(row,'Servicio')||'');
    // Extraer todos los "Servicio=X/"
    const matches = raw.match(/Servicio\s*=\s*([^\/\n]+)/gi) || [];
    if (matches.length) {
      return matches.map(m => {
        const name = m.replace(/Servicio\s*=\s*/i,'').trim();
        return SVC_MAP[norm(name)] || name;
      });
    }
    // Fallback: usar el raw directo
    const direct = norm(raw);
    for (const [k,v] of Object.entries(SVC_MAP)) if (direct.includes(k)) return [v];
    return ['Otros'];
  }

  function getPrimerServicio(row) { return getServicios(row)[0] || 'Otros'; }

  function isUCI(row) {
    return getServicios(row).some(s => /uci|cuidado intensivo/i.test(s));
  }
  function isUCIAdulto(row) {
    return getServicios(row).some(s => /uci adulto|intensivo adulto/i.test(s));
  }
  function isUCINeonatal(row) {
    return getServicios(row).some(s => /uci neonatal|intensivo neonatal/i.test(s));
  }
  function isUCIPediatrica(row) {
    return getServicios(row).some(s => /uci pedi|intensivo pedi/i.test(s));
  }
  function isCuidadoIntermedio(row) {
    return getServicios(row).some(s => /intermedio/i.test(s));
  }
  function isHospitalizacion(row) {
    return getServicios(row).some(s => /hospitalizaci/i.test(s));
  }
  function isSaludMentalSvc(row) {
    return getServicios(row).some(s => /salud mental/i.test(s));
  }

  // ── CIE10 matching ───────────────────────────────────────
  // El campo 'Diagnostico' contiene los CÓDIGOS (ej: "A971 -- N390")
  // El campo 'Cie10 Diagnostico' / 'Cie10 Egreso' contienen DESCRIPCIONES de texto
  function getCodes(row) {
    // Fuente principal: campo Diagnostico (tiene códigos reales separados por " -- ")
    const raw = String(get(row,'Diagnostico')||'');
    const codes = raw.toUpperCase().match(/[A-Z]\d{2,4}[A-Z0-9]*/g) || [];
    return codes;
  }
  function matchCIE(row, prefixes) {
    const codes = getCodes(row);
    return codes.some(c => prefixes.some(p =>
      typeof p === 'string' ? c.startsWith(p.toUpperCase()) : p.test(c)
    ));
  }

  // ── Filtros ──────────────────────────────────────────────
  function applyFilters(rows, filters={}) {
    let r = rows;
    if (filters.ips && filters.ips !== 'todos') {
      const n = norm(filters.ips);
      r = r.filter(row =>
        norm(get(row,'IPS')).includes(n) ||
        norm(get(row,'razon social')||get(row,'Razon Social')||'').includes(n) ||
        norm(get(row,'NOMBRE DE LA  IPS QUE HACE SEGUIMIENTO')||'').includes(n)
      );
    }
    if (filters.departamento && filters.departamento !== 'todos') {
      const n = norm(filters.departamento);
      r = r.filter(row => norm(get(row,'Departamento')||get(row,'DEPARTAMENTO')||'').includes(n));
    }
    if (filters.municipio && filters.municipio !== 'todos') {
      const n = norm(filters.municipio);
      r = r.filter(row => norm(get(row,'Municipio')||get(row,'MUNICIPIO')||get(row,'municipio')||'').includes(n));
    }
    if (filters.anio && filters.anio !== 'todos') {
      r = r.filter(row => {
        const f = String(get(row,'Fecha Ingreso')||get(row,'fecha_solicitud')||get(row,'FECHA INSCRIPCION PROGRAMA DE HTA - DM)')||'');
        return f.includes(filters.anio);
      });
    }
    if (filters.mes && filters.mes !== 'todos') {
      const m = filters.mes.padStart(2,'0');
      r = r.filter(row => {
        const f = String(get(row,'Fecha Ingreso')||get(row,'fecha_solicitud')||'');
        return f.includes('/'+m+'/') || f.includes('-'+m+'-') || f.startsWith(m+'/');
      });
    }
    return r;
  }

  function extractMeta(rows) {
    const ips = [...new Set(rows.map(r =>
      get(r,'IPS')||get(r,'razon social')||get(r,'Razon Social')||''
    ).filter(Boolean))].sort();
    const anios = [...new Set(rows.map(r => {
      const f = String(get(r,'Fecha Ingreso')||get(r,'fecha_solicitud')||'');
      const m = f.match(/(\d{4})/); return m?m[1]:null;
    }).filter(Boolean))].sort().reverse();
    const departamentos = [...new Set(rows.map(r =>
      get(r,'Departamento')||get(r,'DEPARTAMENTO')||''
    ).filter(Boolean))].sort();
    const municipios = [...new Set(rows.map(r =>
      get(r,'Municipio')||get(r,'MUNICIPIO')||get(r,'municipio')||''
    ).filter(Boolean))].sort();
    // Fecha más reciente de atención en la base
    let fechaMax = '';
    rows.forEach(r => {
      const f = String(get(r,'Fecha Ingreso')||get(r,'Fecha Egreso')||'');
      if (f > fechaMax) fechaMax = f;
    });
    return { ips, anios, departamentos, municipios, fechaMax };
  }

  // ── 1. RESUMEN GENERAL ───────────────────────────────────
  function calcResumen(rows, filters) {
    const r = applyFilters(rows, filters);
    const egresos   = r.filter(row => get(row,'Estado')==='Cerrado').length || r.length;
    const fallecidos= r.filter(row => /fallecid|muert/i.test(String(get(row,'Estado del Egreso')))).length;
    const gestantes = r.filter(row => esSI(get(row,'Gestación'))).length;
    const cesareas  = r.filter(row => /cesarea/i.test(String(get(row,'Via Parto')))).length;
    const reingresos= r.filter(row => esSI(get(row,'Reingreso'))).length;
    const conGlosa  = r.filter(row => { const g=String(get(row,'Glosas')||'').trim(); return g&&g!=='0'&&g.length>2; }).length;
    const valorGlosa= r.reduce((a,row)=>a+safeNum(get(row,'Valor Total Glosa')),0);
    const abiertos  = r.filter(row => get(row,'Estado')==='Abierto').length;
    const eventos   = r.filter(row => { const cant=safeNum(get(row,'Cantidad Evento no calidad')); if(cant>0) return true; const e=String(get(row,'Eventos Adversos')||'').trim(); if(!e||e==='0'||/^no$/i.test(e)) return false; const n=parseFloat(e); return !isNaN(n)?n>0:true; }).length;
    const diasTotal = r.reduce((a,row)=>a+safeNum(get(row,'Estancia')),0);
    const uciPac    = r.filter(isUCI).length;
    const hospPac   = r.filter(isHospitalizacion).length;
    return {
      total: r.length, egresos, fallecidos, gestantes, cesareas, reingresos,
      conGlosa, valorGlosa, abiertos, eventos,
      diasEstanciaPromedio: egresos>0 ? diasTotal/egresos : 0,
      tasaMortalidad: divide(fallecidos, egresos, 1000),
      tasaCesarea: divide(cesareas, gestantes),
      tasaReingreso: divide(reingresos, egresos),
      uciPac, hospPac,
    };
  }

  // ── 2. HOSPITALIZACIÓN ───────────────────────────────────
  function calcHospitalizacion(rows, filters) {
    const r = applyFilters(rows, filters);
    // Clasificar por servicio real
    const porServicio = {};
    r.forEach(row => {
      getServicios(row).forEach(svc => {
        porServicio[svc] = (porServicio[svc]||0) + 1;
      });
    });
    const porIps = groupByIPS(r);
    const porMes = groupByMes(r);
    const dias = r.reduce((a,row)=>a+safeNum(get(row,'Estancia')),0);
    const porEdad = { '0-5':0,'6-11':0,'12-17':0,'18-59':0,'60+':0 };
    r.forEach(row => {
      const edad = safeNum(get(row,'Edad'));
      if (edad<=5) porEdad['0-5']++;
      else if (edad<=11) porEdad['6-11']++;
      else if (edad<=17) porEdad['12-17']++;
      else if (edad<=59) porEdad['18-59']++;
      else porEdad['60+']++;
    });
    const porSexo = { M:0, F:0, Otro:0 };
    r.forEach(row => {
      const s = String(get(row,'Sexo')||'').toUpperCase().trim();
      if (s==='M'||s==='MASCULINO') porSexo.M++;
      else if (s==='F'||s==='FEMENINO') porSexo.F++;
      else porSexo.Otro++;
    });
    return { total: r.length, porServicio, porIps, porMes, porEdad, porSexo,
      diasTotales: dias, promEstancia: r.length>0?dias/r.length:0, rows: r };
  }

  // ── 3. UCI ───────────────────────────────────────────────
  function calcUCI(rows, filters) {
    const r = applyFilters(rows, filters);
    const total = r.length;
    const uciA   = r.filter(isUCIAdulto);
    const uciN   = r.filter(isUCINeonatal);
    const uciP   = r.filter(isUCIPediatrica);
    const interA = r.filter(row => getServicios(row).some(s=>/intermedio adulto/i.test(s)));
    const interN = r.filter(row => getServicios(row).some(s=>/intermedio neonatal/i.test(s)));
    const interP = r.filter(row => getServicios(row).some(s=>/intermedio pedi/i.test(s)));
    const basN   = r.filter(row => getServicios(row).some(s=>/basico neonatal/i.test(s)));
    const uciTot = r.filter(isUCI);

    const porIps = {};
    uciTot.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips] = { coincidencias:0, uciA:0, uciN:0, uciP:0 };
      porIps[ips].coincidencias++;
      if (isUCIAdulto(row))    porIps[ips].uciA++;
      if (isUCINeonatal(row))  porIps[ips].uciN++;
      if (isUCIPediatrica(row)) porIps[ips].uciP++;
    });
    const uciTotal = uciTot.length;
    const totalHosp = r.filter(isHospitalizacion).length;

    return {
      total, uciTotal, totalHosp,
      uciAdulto: uciA.length, uciNeonatal: uciN.length, uciPediatrica: uciP.length,
      interAdulto: interA.length, interNeonatal: interN.length, interPediatrica: interP.length,
      basNeonatal: basN.length,
      tasaUciTotal:     divide(uciTotal, totalHosp||total),
      tasaUciAdulto:    divide(uciA.length, uciTotal),
      tasaUciNeonatal:  divide(uciN.length, uciTotal),
      tasaUciPediatrica:divide(uciP.length, uciTotal),
      porIps, rows: uciTot, rows_uciA: uciA, rows_uciN: uciN, rows_uciP: uciP
    };
  }

  // ── 4. MORTALIDAD ────────────────────────────────────────
  function calcMortalidad(rows, filters) {
    const r = applyFilters(rows, filters);
    const fallecidos = r.filter(row => /fallecid|muert/i.test(String(get(row,'Estado del Egreso'))));
    const porIps = {};
    r.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips] = {total:0, fallecidos:0};
      porIps[ips].total++;
      if (/fallecid|muert/i.test(String(get(row,'Estado del Egreso')))) porIps[ips].fallecidos++;
    });
    const porServicio = {};
    fallecidos.forEach(row => {
      getServicios(row).forEach(svc => { porServicio[svc]=(porServicio[svc]||0)+1; });
    });
    const porMes = groupByMesFiltered(r, row => /fallecid|muert/i.test(String(get(row,'Estado del Egreso'))));
    return {
      total: r.length, fallecidos: fallecidos.length,
      tasaMortalidad: divide(fallecidos.length, r.length, 1000),
      porIps, porServicio, porMes, rows: fallecidos
    };
  }

  // ── 5. CESÁREAS ──────────────────────────────────────────
  function calcCesareas(rows, filters) {
    const r = applyFilters(rows, filters);
    const gestantes = r.filter(row => esSI(get(row,'Gestación')));
    const cesareas  = gestantes.filter(row => /cesarea/i.test(String(get(row,'Via Parto'))));
    const vaginales = gestantes.filter(row => /vaginal/i.test(String(get(row,'Via Parto'))));
    const conControl= gestantes.filter(row => esSI(get(row,'Control Prenatal')));
    const porIps = {};
    gestantes.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips] = {gestantes:0,cesareas:0,vaginales:0,conControl:0};
      porIps[ips].gestantes++;
      if (/cesarea/i.test(String(get(row,'Via Parto')))) porIps[ips].cesareas++;
      if (/vaginal/i.test(String(get(row,'Via Parto')))) porIps[ips].vaginales++;
      if (esSI(get(row,'Control Prenatal'))) porIps[ips].conControl++;
    });
    return {
      gestantes: gestantes.length, cesareas: cesareas.length,
      vaginales: vaginales.length, conControl: conControl.length,
      tasaCesarea: divide(cesareas.length, gestantes.length),
      tasaControl: divide(conControl.length, gestantes.length),
      porIps, rows: cesareas, gestantesRows: gestantes
    };
  }

  // ── 6. DNT ───────────────────────────────────────────────
  // CIE10 de DESNUTRICION.txt: E43X, E440, E441, E40X, E41X, E42X, E46X
  function calcDNT(rows, filters) {
    const r = applyFilters(rows, filters);
    const isDNT = row =>
      /alteraciones.?nutricio/i.test(String(get(row,'Programa Riesgo'))) ||
      matchCIE(row, ['E40','E41','E42','E43','E44','E45','E46','E50','E63','E64']);
    const dnt = r.filter(isDNT);
    const porIps = groupByIPSFiltered(r, isDNT);
    const porEdad = { '0-5':0,'6-11':0,'12-17':0,'18-59':0,'60+':0 };
    dnt.forEach(row => {
      const edad = safeNum(get(row,'Edad'));
      if (edad<=5) porEdad['0-5']++;
      else if (edad<=11) porEdad['6-11']++;
      else if (edad<=17) porEdad['12-17']++;
      else if (edad<=59) porEdad['18-59']++;
      else porEdad['60+']++;
    });
    return {
      total: r.length, dnt: dnt.length,
      tasaDNT: divide(dnt.length, r.length),
      porIps, porEdad, rows: dnt
    };
  }

  // ── 7. ENFERMEDADES TRAZADORAS ──────────────────────────
  // Lógica exacta del DAX Power BI:
  //   NUMERADOR   = SUM(Dias Estancia) filtrado por Servicio ∩ CIE10
  //   DENOMINADOR = COUNTROWS           filtrado por Servicio ∩ CIE10
  //   INDICADOR   = NUMERADOR / DENOMINADOR  (promedio de estancia)
  function calcEnfermedades(rows, filters) {
    const r = applyFilters(rows, filters);

    // Grupos de servicios (igual a los usados en los filtros DAX)
    const SVC_HOSP     = ['Hospitalización Adultos','Hospitalización Pediátrica','Observación'];
    const SVC_HOSP_UCI = ['Hospitalización Adultos','Hospitalización Pediátrica','Observación',
                          'UCI Adulto','UCI Neonatal','UCI Pediátrica','C. Intermedio Adulto'];

    function inSvc(row, svcs) {
      if (!svcs || svcs.length === 0) return true;
      const rowSvcs = getServicios(row);
      return rowSvcs.some(s => svcs.some(a => norm(s).includes(norm(a))));
    }

    function calcIndicador(base, svcs, ciePrefixes, extraFn) {
      const filtered = base.filter(row =>
        inSvc(row, svcs) &&
        matchCIE(row, ciePrefixes) &&
        (extraFn ? extraFn(row) : true)
      );
      const numerador   = filtered.reduce((a,row) => a + safeNum(get(row,'Estancia')), 0);
      const denominador = filtered.length;
      const porIps = {};
      filtered.forEach(row => {
        const ips = get(row,'IPS')||'Sin IPS';
        if (!porIps[ips]) porIps[ips] = { coincidencias:0, dias:0 };
        porIps[ips].coincidencias++;
        porIps[ips].dias += safeNum(get(row,'Estancia'));
      });
      return {
        n: denominador, numerador, denominador,
        promedio: denominador > 0 ? numerador / denominador : 0,
        result: divide(denominador, base.length),
        porIps, rows: filtered
      };
    }

    return {
      total: r.length,
      // ── Dengue: separado en Sin signos / Con signos (igual que Power BI) ──
      // A970 = Dengue sin signos de alarma  (DAX: CONTAINSSTRING "A90X" → A970/A90)
      // A971 = Dengue con signos de alarma  (DAX: CONTAINSSTRING "A91X" → A971/A91)
      dengueSinSignos: calcIndicador(r, SVC_HOSP, ['A970','A90']),
      dengueConSignos: calcIndicador(r, SVC_HOSP, ['A971','A91']),
      dengueGrave:     calcIndicador(r, SVC_HOSP, ['A972','A972']),
      // Total dengue (A90 + A91 + A97)
      dengue:          calcIndicador(r, SVC_HOSP, ['A90','A91','A97']),
      // ── Otras enfermedades por vectores ───────────────
      leishmaniasis:   calcIndicador(r, SVC_HOSP, ['B550','B551','B552','B559','B55']),
      chagas:          calcIndicador(r, SVC_HOSP, ['B570','B571','B572','B573','B574','B575','B57']),
      malaria:         calcIndicador(r, SVC_HOSP, ['B500','B501','B510','B511','B520','B521','B530','B531','B54','B50','B51','B52','B53']),
      zoonoticas:      calcIndicador(r, SVC_HOSP, ['A20','A21','A22','A23','A24','A26','A27','A28']),
      // ── Otras enfermedades trazadoras ─────────────────
      tuberculosis:    calcIndicador(r, SVC_HOSP,     ['A150','A151','A152','A153','A154','A155','A156','A157','A158','A159','A15','A16','A17','A18','A19']),
      vih:             calcIndicador(r, SVC_HOSP_UCI, ['B20','B21','B22','B23','B24','Z21']),
      hematologicas:   calcIndicador(r, SVC_HOSP_UCI,
                         ['C81','C82','C83','C84','C85','C86','C88','C90','C91','C92',
                          'D46','D55','D56','D57','D58','D59','D60','D61','D62',
                          'D65','D66','D67','D68','D69']),
      cancer:          calcIndicador(r, SVC_HOSP_UCI, ['C']),
      erc:             calcIndicador(r, SVC_HOSP_UCI, ['N18','N19']),
      respiratorias:   calcIndicador(r, SVC_HOSP,     ['J40','J41','J42','J43','J44','J45','J46','J47']),
    };
  }

  // ── 8. EDA ───────────────────────────────────────────────
  function calcEDA(rows, filters) {
    const r = applyFilters(rows, filters);
    const isEDA = row => matchCIE(row,['A00','A01','A02','A03','A04','A05','A06','A07','A08','A09','K52','K58','K59']);
    const eda = r.filter(isEDA);
    return { total: r.length, eda: eda.length, tasa: divide(eda.length, r.length),
      porIps: groupByIPSFiltered(r, isEDA), rows: eda };
  }

  // ── 9. IRA ───────────────────────────────────────────────
  function calcIRA(rows, filters) {
    const r = applyFilters(rows, filters);
    const isIRA = row => matchCIE(row,['J00','J01','J02','J03','J04','J05','J06','J10','J11','J12','J13','J14','J15','J16','J17','J18','J20','J21','J22']);
    const ira = r.filter(isIRA);
    return { total: r.length, ira: ira.length, tasa: divide(ira.length, r.length),
      porIps: groupByIPSFiltered(r, isIRA), rows: ira };
  }

  // ── 10. SALUD MENTAL ─────────────────────────────────────
  function calcSaludMental(rows, filters) {
    const r = applyFilters(rows, filters);
    const isSMProg  = row => /salud.?mental/i.test(String(get(row,'Programa Riesgo')));
    const isViolen  = row => /violencia/i.test(String(get(row,'Programa Riesgo')));
    const isSPA     = row => /spa|sust.*psicoac/i.test(String(get(row,'Programa Riesgo')));
    const isSMSvc   = row => isSaludMentalSvc(row);
    const isPsiq    = row => /psiquiatri/i.test(String(get(row,'Especialidad')));
    const isCIE     = row => matchCIE(row,['F','X6','X7','X8','X9','Y0']);
    const sm = r.filter(row => isSMProg(row)||isViolen(row)||isSPA(row)||isSMSvc(row)||isPsiq(row));
    const eventos = {
      'Prog. Salud Mental':  r.filter(isSMProg).length,
      'Violencias':          r.filter(isViolen).length,
      'Trastornos SPA':      r.filter(isSPA).length,
      'Serv. Salud Mental':  r.filter(isSMSvc).length,
      'Psiquiatría':         r.filter(isPsiq).length,
      'CIE-10 Mental':       r.filter(isCIE).length,
    };
    return { total: r.length, sm: sm.length, tasa: divide(sm.length, r.length),
      eventos, porIps: groupByIPSFiltered(r, row=>isSMProg(row)||isViolen(row)||isSPA(row)||isSMSvc(row)),
      rows: sm };
  }

  // ── 11. RCV ──────────────────────────────────────────────
  function calcRCV(rows, filters) {
    const r = applyFilters(rows, filters);
    const isRCV   = row => /cardiovascular|cardiov/i.test(String(get(row,'Programa Riesgo')||get(row,'CLASIFICACION DEL RCV ACTUAL')||''));
    const isHTA   = row => esSI(get(row,'DX CONFIRMADO HTA')) || /hta/i.test(String(get(row,'Patologia alto costo')||''));
    const isDM    = row => esSI(get(row,'DX CONFIRMADO DM'))  || /diabetes/i.test(String(get(row,'Patologia alto costo')||''));
    const isHTACtrl = row => esSI(get(row,'HTA CONTROLADA')) || esSI(get(row,'HTA CONTROLADA_1'));
    const isDMCtrl  = row => esSI(get(row,'DM CONTROLADA'));
    const isACV   = row => matchCIE(row,['I60','I61','I62','I63','I64','I65','I66']);
    const isIAM   = row => matchCIE(row,['I21','I22']);

    const rcv = r.filter(isRCV);
    const htaRows = r.filter(isHTA);
    const dmRows  = r.filter(isDM);
    const htaCtrl = htaRows.filter(isHTACtrl);
    const dmCtrl  = dmRows.filter(isDMCtrl);

    return {
      total: r.length, rcv: rcv.length, tasa: divide(rcv.length, r.length),
      hta: htaRows.length, htaControlada: htaCtrl.length, tasaHTACtrl: divide(htaCtrl.length, htaRows.length),
      dm:  dmRows.length,  dmControlada:  dmCtrl.length,  tasaDMCtrl:  divide(dmCtrl.length, dmRows.length),
      acv: r.filter(isACV).length, iam: r.filter(isIAM).length,
      acvIam: r.filter(row=>isACV(row)||isIAM(row)).length,
      porIps: groupByIPSFiltered(r, isRCV),
      rows: rcv
    };
  }

  // ── 12. RIAMP ────────────────────────────────────────────
  function calcRIAMP(rows, filters) {
    const r = applyFilters(rows, filters);
    const gestantes  = r.filter(row => esSI(get(row,'Gestación')));
    const isRIAMP    = row => /materno|perinatal/i.test(String(get(row,'Programa Riesgo')));
    const riamp      = r.filter(isRIAMP);
    const conControl = gestantes.filter(row => esSI(get(row,'Control Prenatal')));
    const conVDRL    = gestantes.filter(row => !/no reactivo|no aplica/i.test(String(get(row,'VDRL')||'No')) && String(get(row,'VDRL')||'').length>2);
    const porIps = {};
    gestantes.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips] = {gestantes:0,riamp:0,conControl:0,cesareas:0};
      porIps[ips].gestantes++;
      if (isRIAMP(row)) porIps[ips].riamp++;
      if (esSI(get(row,'Control Prenatal'))) porIps[ips].conControl++;
      if (/cesarea/i.test(String(get(row,'Via Parto')))) porIps[ips].cesareas++;
    });
    return {
      total: r.length, gestantes: gestantes.length, riamp: riamp.length,
      conControl: conControl.length, conVDRL: conVDRL.length,
      tasaRIAMP:   divide(riamp.length, gestantes.length),
      tasaControl: divide(conControl.length, gestantes.length),
      porIps, rows: riamp, gestantesRows: gestantes
    };
  }

  // ── 13. GLOSAS ───────────────────────────────────────────
  // Mapa de cédulas de auditores → nombres (fuente: NOMINA.txt cruzado con campo Auditor)
  let AUDITORES_MAP = {
    '77020051':   'MARINO EDUARDO SALAZAR GONZALEZ',
    '1065635492': 'YAIR ENRIQUE VILLAZON MINDIOLA',
    '1122402961': 'LINA MARCELA MENDOZA CATAÑO',
    '1124050309': 'AIRTON QUINTERO SUAREZ',
    '1083016921': 'KARLA TATIANA REBOLLEDO LOPEZ',
    '1065578928': 'CLAUDIA JHANETH LOPERENA VEGA',
    '1065659306': 'KEVIN SAMIR QUINTERO MEJIA',
    '1121331044': 'MARIA BEATRIZ CUADRADO CORTES',
    '39046905':   'LILIAN PATRICIA PADILLA PANA',
    '40930755':   'MARELYS YUSET PIMIENTA AGUILAR',
    '49719928':   'KAREN MARGARITA CASTILLO ZAPATA',
    '22650315':   'ALEJANDRINA QUINTERO SURMAY',
    '1065624712': 'YURANIS DEL ROSARIO USTARIZ RINCONES',
    '1045677922': 'ELIANA ROCIO PARRA ANGULO',
    '1121303251': 'ALDAIR JOSE MEJIA OJEDA',
  };
  function setAuditoresMap(m) { AUDITORES_MAP = {...AUDITORES_MAP, ...(m||{})}; }
  function nombreAuditor(cedula) {
    const k = String(cedula||'').trim();
    return AUDITORES_MAP[k] || k;
  }

  // Los valores de Glosa en el archivo están en MILES de pesos colombianos
  // Se multiplica × 1000 para mostrar el valor real en COP
  const GLOSA_SCALE = 1000;

  function calcGlosas(rows, filters) {
    const r = applyFilters(rows, filters);
    const conGlosa = r.filter(row => {
      const g = String(get(row,'Glosas')||'').trim();
      return g && g!=='0' && g.length>2;
    });
    const valorTotal = r.reduce((a,row)=>a+safeNum(get(row,'Valor Total Glosa'))*GLOSA_SCALE,0);
    const porIps={}, porAuditor={}, tiposGlosa={};
    conGlosa.forEach(row => {
      const val = safeNum(get(row,'Valor Total Glosa')) * GLOSA_SCALE;
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips]={count:0,valor:0};
      porIps[ips].count++; porIps[ips].valor += val;
      const cedula = String(get(row,'Auditor')||'Sin auditor').trim();
      const aud = nombreAuditor(cedula);
      if (!porAuditor[aud]) porAuditor[aud]={count:0,valor:0,cedula};
      porAuditor[aud].count++; porAuditor[aud].valor += val;
      String(get(row,'Glosas')).split('--').forEach(g=>{
        const m = g.match(/\d+\s*-->\s*(.+)/);
        const tipo = m ? m[1].trim() : g.trim();
        if (tipo) tiposGlosa[tipo]=(tiposGlosa[tipo]||0)+1;
      });
    });
    const rowsEnriq = conGlosa.map(row => ({
      ...row,
      'Nombre Auditor': nombreAuditor(String(get(row,'Auditor')||'').trim()),
      'Valor COP': safeNum(get(row,'Valor Total Glosa')) * GLOSA_SCALE
    }));
    return { total: r.length, conGlosa: conGlosa.length, valorTotal,
      tasaGlosa: divide(conGlosa.length, r.length),
      porIps, porAuditor, tiposGlosa, rows: rowsEnriq };
  }

  // ── 14. CONCURRENCIAS ────────────────────────────────────
  function calcConcurrencias(rows, filters) {
    const r = applyFilters(rows, filters);
    const abiertos = r.filter(row => get(row,'Estado')==='Abierto');
    const porIps={}, porAuditor={};
    abiertos.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      porIps[ips]=(porIps[ips]||0)+1;
      const aud = get(row,'Auditor')||'Sin auditor';
      porAuditor[aud]=(porAuditor[aud]||0)+1;
    });
    const porMes = groupByMesFiltered(r, row=>get(row,'Estado')==='Abierto');
    return { total: r.length, abiertos: abiertos.length,
      tasa: divide(abiertos.length, r.length),
      porIps, porAuditor, porMes, rows: abiertos };
  }

  // ── 15. REINGRESO ────────────────────────────────────────
  function calcReingreso(rows, filters) {
    const r = applyFilters(rows, filters);
    const reingresos = r.filter(row => esSI(get(row,'Reingreso')));
    const porIps = groupByIPSFiltered(r, row=>esSI(get(row,'Reingreso')));
    const porDx = {};
    reingresos.forEach(row => {
      const dx = String(get(row,'Diagnostico')||'').substring(0,50);
      porDx[dx]=(porDx[dx]||0)+1;
    });
    return { total: r.length, reingresos: reingresos.length,
      tasa: divide(reingresos.length, r.length),
      porIps, porDx, rows: reingresos };
  }

  // ── 16. EVENTOS ADVERSOS ─────────────────────────────────
  function calcEventos(rows, filters) {
    const r = applyFilters(rows, filters);
    const conEvento = r.filter(row => {
      // Revisar también "Cantidad Evento no calidad" como señal adicional
      const cant = safeNum(get(row,'Cantidad Evento no calidad'));
      if (cant > 0) return true;
      const e = String(get(row,'Eventos Adversos')||'').trim();
      if (!e || e==='0' || /^no$/i.test(e)) return false;
      // Si es número debe ser > 0; si es texto cualquier valor no vacío cuenta
      const n = parseFloat(e);
      return !isNaN(n) ? n > 0 : true;
    });
    const porIps={}, porTipo={};
    conEvento.forEach(row => {
      const ips = get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips]={count:0,cantidad:0};
      porIps[ips].count++; porIps[ips].cantidad+=safeNum(get(row,'Cantidad Evento no calidad'));
      const tipo = String(get(row,'Eventos Adversos')).substring(0,60);
      porTipo[tipo]=(porTipo[tipo]||0)+1;
    });
    return { total: r.length, conEvento: conEvento.length,
      tasa: divide(conEvento.length, r.length),
      porIps, porTipo, rows: conEvento };
  }

  // ── 17. AIU ──────────────────────────────────────────────
  function calcAIU(rows, filters) {
    const r = applyFilters(rows, filters);
    const porMunicipio={}, porIps={}, porTipo={};
    r.forEach(row => {
      const mun = get(row,'nombre_municipio_afiliado')||get(row,'municipio_afiliado')||'Sin municipio';
      porMunicipio[mun]=(porMunicipio[mun]||0)+1;
      const ips = get(row,'ips_solicitante')||'Sin IPS';
      const ipsShort = ips.replace(/^\d+-/, '').substring(0,40);
      porIps[ipsShort]=(porIps[ipsShort]||0)+1;
      const tipo = get(row,'tipo_solicitud')||'Sin tipo';
      porTipo[tipo]=(porTipo[tipo]||0)+1;
    });
    const cerradas = r.filter(row => /cerrad/i.test(String(get(row,'estado')||''))).length;
    return { total: r.length, cerradas, abiertas: r.length-cerradas,
      porMunicipio, porIps, porTipo };
  }

  // ── 18. CYD (Crecimiento y Desarrollo 0-5) ───────────────
  function calcCYD(rows, filters) {
    const r = applyFilters(rows, filters);
    const normal = r.filter(row => /normal|adecuado|bueno/i.test(String(get(row,'Resultado de tamizaje VALE')||'')));
    const riesgo = r.filter(row => /riesgo|alerta/i.test(String(get(row,'Resultado de tamizaje VALE')||'')));
    const porIps = {};
    r.forEach(row => {
      const ips = get(row,'NOMBRE DEL PRESTADOR')||get(row,'IPS')||'Sin IPS';
      if (!porIps[ips]) porIps[ips]={total:0,normal:0,riesgo:0};
      porIps[ips].total++;
      if (/normal|adecuado|bueno/i.test(String(get(row,'Resultado de tamizaje VALE')||''))) porIps[ips].normal++;
      if (/riesgo|alerta/i.test(String(get(row,'Resultado de tamizaje VALE')||''))) porIps[ips].riesgo++;
    });
    return { total: r.length, normal: normal.length, riesgo: riesgo.length,
      tasaNormal: divide(normal.length, r.length), porIps };
  }

  // ── 19. ESTANCIA DETALLADA ───────────────────────────────
  function calcEstancia(rows, filters) {
    const r = applyFilters(rows, filters);
    const porServicio={}, porIps={}, porDx={};
    r.forEach(row => {
      const svc = get(row,'NOMBRE GENERAL DEL SERVICIO')||getPrimerServicio(row)||'Sin servicio';
      if (!porServicio[svc]) porServicio[svc]={n:0,dias:0};
      const dias = safeNum(get(row,'Estancia')||get(row,'NUMERADOR'));
      porServicio[svc].n++; porServicio[svc].dias+=dias;
      const ips = get(row,'IPS')||get(row,'Razon Social')||'Sin IPS';
      if (!porIps[ips]) porIps[ips]={n:0,dias:0};
      porIps[ips].n++; porIps[ips].dias+=dias;
    });
    const diasTotal = r.reduce((a,row)=>a+safeNum(get(row,'Estancia')||get(row,'NUMERADOR')),0);
    return { total: r.length, diasTotal,
      promedio: r.length>0?diasTotal/r.length:0,
      porServicio, porIps };
  }

  // ── HELPERS ──────────────────────────────────────────────
  function groupByIPS(rows) {
    const g={};
    rows.forEach(row => { const k=get(row,'IPS')||'Sin IPS'; g[k]=(g[k]||0)+1; });
    return g;
  }
  function groupByIPSFiltered(rows, fn) {
    const g={};
    rows.forEach(row => {
      const k=get(row,'IPS')||'Sin IPS';
      if (!g[k]) g[k]={total:0,coincidencias:0};
      g[k].total++; if(fn(row)) g[k].coincidencias++;
    });
    return g;
  }
  function groupByMes(rows) {
    const g={};
    rows.forEach(row => {
      const f=String(get(row,'Fecha Ingreso')||get(row,'fecha_solicitud')||'');
      const m=f.match(/(\d{4})[\/\-](\d{2})/);
      if(m){ const k=m[1]+'-'+m[2]; g[k]=(g[k]||0)+1; }
    });
    return g;
  }
  function groupByMesFiltered(rows, fn) {
    const g={};
    rows.filter(fn).forEach(row => {
      const f=String(get(row,'Fecha Ingreso')||'');
      const m=f.match(/(\d{4})[\/\-](\d{2})/);
      if(m){ const k=m[1]+'-'+m[2]; g[k]=(g[k]||0)+1; }
    });
    return g;
  }

  return {
    applyFilters, extractMeta, get, safeNum, divide, normStr: norm,
    setAuditoresMap, nombreAuditor,
    getServicios, getPrimerServicio,
    calcResumen, calcHospitalizacion, calcUCI, calcMortalidad,
    calcCesareas, calcDNT, calcEnfermedades, calcEDA, calcIRA,
    calcSaludMental, calcRCV, calcRIAMP, calcGlosas,
    calcConcurrencias, calcReingreso, calcEventos,
    calcAIU, calcCYD, calcEstancia,
    groupByIPS, groupByIPSFiltered, groupByMes
  };
})();
