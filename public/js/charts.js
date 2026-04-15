// ============================================================
// MÓDULO DE GRÁFICAS — Chart.js
// ============================================================

const CHARTS = (() => {
  const registry = {};

  const PALETTE = ['#1a4f7a','#27ae60','#e74c3c','#f39c12','#8e44ad','#16a085','#2980b9','#d35400','#2c3e50','#7f8c8d'];
  const PALETTE_LIGHT = ['#d6eaf8','#d5f5e3','#fde8e8','#fef3cd','#e8daef','#d1f2eb','#ebf5fb','#fae5d3','#eaecee','#f2f3f4'];

  function fmt(n, dec = 1) {
    if (n === null || n === undefined || isNaN(n)) return '0';
    return Number(n).toFixed(dec);
  }

  function fmtMoney(n) {
    return '$' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  function destroy(id) {
    if (registry[id]) { try { registry[id].destroy(); } catch(e) {} delete registry[id]; }
  }

  function create(id, config) {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    registry[id] = new Chart(canvas.getContext('2d'), config);
    return registry[id];
  }

  // ── Barras horizontales de indicadores hospitalarios ──
  function barrasHospitalarios(id, data) {
    const labels = ['Hospitalización', 'Cesárea', 'H. Salud Mental', 'UCI Adulto', 'UCI Neonatal', 'UCI Pediátrica'];
    const valores = [
      data.hospitalizacion?.resultado || 0,
      data.cesarea?.resultado || 0,
      data.hospitalizacionSM?.resultado || 0,
      data.uciAdulto?.resultado || 0,
      data.uciNeonatal?.resultado || 0,
      data.uciPediatrica?.resultado || 0
    ];
    return create(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Resultado (%)',
          data: valores,
          backgroundColor: PALETTE,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + '%' } } },
        scales: { x: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }, y: { ticks: { font: { size: 11 } } } }
      }
    });
  }

  // ── Barras mortalidad ──
  function barrasMortalidad(id, data) {
    const labels = ['Mort. Hospital (x1000)', 'Mort. UCI Adulto (%)', 'Mort. UCI Neonatal (%)'];
    const valores = [
      data.mortalidadHosp?.resultado || 0,
      data.mortalidadUciA?.resultado || 0,
      data.mortalidadUciN?.resultado || 0
    ];
    return create(id, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Tasa', data: valores, backgroundColor: ['#e74c3c','#c0392b','#922b21'], borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // ── Dona para distribución ──
  function dona(id, labels, values, title = '') {
    const nonZero = labels.filter((l, i) => values[i] > 0);
    const nonZeroVals = values.filter(v => v > 0);
    if (nonZero.length === 0) return;
    return create(id, {
      type: 'doughnut',
      data: {
        labels: nonZero,
        datasets: [{ data: nonZeroVals, backgroundColor: PALETTE, hoverOffset: 8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
          title: title ? { display: true, text: title, font: { size: 13, weight: 'bold' } } : { display: false }
        }
      }
    });
  }

  // ── Barras verticales genéricas ──
  function barras(id, labels, values, label = 'Valor', color = '#1a4f7a', pct = false) {
    return create(id, {
      type: 'bar',
      data: {
        labels: labels.map(l => l.length > 25 ? l.substring(0,23)+'…' : l),
        datasets: [{ label, data: values, backgroundColor: color, borderRadius: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + (pct ? '%' : '') } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v + (pct ? '%' : '') } }, x: { ticks: { font: { size: 10 } } } }
      }
    });
  }

  // ── Líneas de tendencia ──
  function lineas(id, labels, datasets) {
    return create(id, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE_LIGHT[i % PALETTE_LIGHT.length],
          fill: true,
          tension: 0.4,
          pointRadius: 4
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // ── Barras agrupadas ──
  function barrasAgrupadas(id, labels, datasets) {
    return create(id, {
      type: 'bar',
      data: {
        labels: labels.map(l => l.length > 20 ? l.substring(0,18)+'…' : l),
        datasets: datasets.map((ds, i) => ({
          label: ds.label,
          data: ds.data,
          backgroundColor: PALETTE[i % PALETTE.length],
          borderRadius: 4
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
        scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true } }
      }
    });
  }

  // ── Gauge simulado (semicírculo) ──
  function gauge(id, value, max = 100, label = '') {
    const pct = Math.min(value / max, 1);
    const color = pct >= 0.9 ? '#27ae60' : pct >= 0.6 ? '#f39c12' : '#e74c3c';
    return create(id, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [value, max - value < 0 ? 0 : max - value],
          backgroundColor: [color, '#e8eef4'],
          borderWidth: 0
        }]
      },
      options: {
        circumference: 180, rotation: -90,
        responsive: true, maintainAspectRatio: false, cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          title: { display: true, text: fmt(value) + '%', position: 'bottom', font: { size: 16, weight: 'bold' }, color }
        }
      }
    });
  }

  // ── Barras de riesgo (enfermedades) ──
  function barrasRiesgo(id, data) {
    const indicadores = [
      { label: 'DNT', v: data.dnt?.resultado || 0 },
      { label: 'Dengue', v: data.dengue?.resultado || 0 },
      { label: 'Hematológicas', v: data.hematologicas?.resultado || 0 },
      { label: 'Leishmaniasis', v: data.leishmaniasis?.resultado || 0 },
      { label: 'Cáncer', v: data.cancer?.resultado || 0 },
      { label: 'Reingreso', v: data.reingreso?.resultado || 0 },
      { label: 'RIAMP', v: data.riamp?.resultado || 0 },
      { label: 'RCV', v: data.rcv?.resultado || 0 },
    ];
    return create(id, {
      type: 'bar',
      data: {
        labels: indicadores.map(i => i.label),
        datasets: [{ label: 'Resultado (%)', data: indicadores.map(i => i.v), backgroundColor: PALETTE, borderRadius: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) + '%' } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } } }
      }
    });
  }

  // ── Salud mental ──
  function barrasSaludMental(id, eventos) {
    const labels = Object.keys(eventos);
    const values = Object.values(eventos);
    return create(id, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Casos', data: values, backgroundColor: ['#8e44ad','#c0392b','#e74c3c','#f39c12','#d35400','#16a085'], borderRadius: 6 }] },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });
  }

  return { barrasHospitalarios, barrasMortalidad, dona, barras, lineas, barrasAgrupadas, gauge, barrasRiesgo, barrasSaludMental, fmt, fmtMoney, destroy, create };
})();
