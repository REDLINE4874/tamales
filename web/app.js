/* ==========================================================
   API — llamadas a la URL de implementación de Apps Script
   ========================================================== */

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), { method: 'GET' });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error desconocido');
  return json.data;
}

async function apiPost(action, payload = {}) {
  // Sin header Content-Type explícito -> el navegador usa text/plain,
  // lo que evita el preflight CORS. Apps Script igual lee el JSON del body.
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error desconocido');
  return json.data;
}

/* ==========================================================
   ESTADO Y ARRANQUE
   ========================================================== */

let STATE = { config: { precio: 0, tipos: [] }, pendientes: [], completados: [], resumenSemanal: [], semanaActual: '' };
let chartsReady = false;

google.charts.load('current', { packages: ['corechart'] });
google.charts.setOnLoadCallback(() => { chartsReady = true; if (STATE.resumenSemanal.length) drawChart(); });

document.addEventListener('DOMContentLoaded', () => {
  if (!API_URL || API_URL.includes('PEGA_AQUI')) {
    setConnStatus('Falta configurar API_URL en config.js', 'error');
  }
  setupNav();
  setupForm();
  setupModal();
  cargarTodo();
});

function setConnStatus(text, cls) {
  const el = document.getElementById('connStatus');
  el.textContent = text;
  el.className = 'conn-status' + (cls ? ' ' + cls : '');
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });
}

async function cargarTodo() {
  try {
    setConnStatus('Sincronizando…');
    const data = await apiGet('dashboard');
    onDataLoaded(data);
    setConnStatus('Conectado', 'ok');
  } catch (err) {
    onError(err);
    setConnStatus('Sin conexión con la API', 'error');
  }
}

function onDataLoaded(data) {
  STATE.config = data.config;
  STATE.pendientes = data.pendientes;
  STATE.completados = data.completados;
  STATE.resumenSemanal = data.resumenSemanal;
  STATE.semanaActual = data.semanaActual;

  document.getElementById('currentWeekChip').textContent = 'Semana ' + (data.semanaActual.split('-S')[1] || '');
  if (!document.querySelector('.item-row')) addItemRow();
  else refreshItemRowOptions();

  renderPedidosActivos();
  renderDashboardStats();
  renderHistorico();
  if (chartsReady) drawChart();
}

function onError(err) {
  console.error(err);
  alert('Ocurrió un error: ' + (err && err.message ? err.message : err));
}

/* ==========================================================
   NUEVO PEDIDO
   ========================================================== */

function addItemRow() {
  const list = document.getElementById('itemsList');
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <select class="item-tipo">${optionsHTML()}</select>
    <input type="number" class="item-cant" min="1" value="1" placeholder="Cant.">
    <button type="button" class="remove-item">✕</button>
  `;
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); updateTotal(); });
  row.querySelector('.item-cant').addEventListener('input', updateTotal);
  list.appendChild(row);
  updateTotal();
}

function optionsHTML() {
  return (STATE.config.tipos || []).map(t => `<option value="${t}">${t}</option>`).join('');
}

function refreshItemRowOptions() {
  document.querySelectorAll('.item-tipo').forEach(sel => { sel.innerHTML = optionsHTML(); });
}

function updateTotal() {
  let cantidad = 0;
  document.querySelectorAll('.item-row').forEach(r => {
    cantidad += Number(r.querySelector('.item-cant').value || 0);
  });
  const total = cantidad * (STATE.config.precio || 0);
  document.getElementById('totalEstimado').textContent = '$' + total.toFixed(0);
}

function setupForm() {
  document.getElementById('addItemBtn').addEventListener('click', addItemRow);
  document.getElementById('crearPedidoBtn').addEventListener('click', crearPedido);
}

async function crearPedido() {
  const cliente = document.getElementById('clienteInput').value.trim();
  if (!cliente) { alert('Escribe el nombre del cliente'); return; }

  const items = [];
  document.querySelectorAll('.item-row').forEach(r => {
    const tipo = r.querySelector('.item-tipo').value;
    const cantidad = Number(r.querySelector('.item-cant').value || 0);
    if (cantidad > 0) items.push({ tipo, cantidad });
  });
  if (!items.length) { alert('Agrega al menos un tamal'); return; }

  const btn = document.getElementById('crearPedidoBtn');
  btn.disabled = true; btn.textContent = 'Creando…';

  try {
    await apiPost('crearPedido', { cliente, items });
    document.getElementById('clienteInput').value = '';
    document.getElementById('itemsList').innerHTML = '';
    addItemRow();
    await cargarTodo();
    document.querySelector('.nav-item[data-view="activos"]').click();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Crear comanda';
  }
}

/* ==========================================================
   PEDIDOS ACTIVOS
   ========================================================== */

function renderPedidosActivos() {
  const wrap = document.getElementById('pedidosActivosList');
  if (!STATE.pendientes.length) {
    wrap.innerHTML = '<div class="empty-state">No hay comandas pendientes. Crea una desde “Nuevo pedido”.</div>';
    return;
  }
  wrap.innerHTML = STATE.pendientes.map(p => `
    <div class="ticket">
      <div class="ticket-head">
        <span class="ticket-cliente">${escapeHtml(p.cliente)}</span>
        <span class="ticket-badge">Pendiente</span>
      </div>
      <ul class="ticket-detalle">
        ${p.detalle.map(d => `<li><span>${escapeHtml(d.tipo)}</span><span>x${d.cantidad}</span></li>`).join('')}
      </ul>
      <div class="ticket-foot">
        <span class="ticket-total mono">$${Number(p.montoEsperado).toFixed(0)}</span>
        <button class="ticket-complete-btn" onclick="abrirModal('${p.id}', '${escapeHtml(p.cliente)}', ${p.montoEsperado})">Marcar pagado</button>
      </div>
    </div>
  `).join('');
}

/* ==========================================================
   MODAL
   ========================================================== */

function setupModal() {
  document.getElementById('modalCancelBtn').addEventListener('click', cerrarModal);
  document.getElementById('modalConfirmBtn').addEventListener('click', confirmarCobro);
}
let modalPedidoId = null;
function abrirModal(id, cliente, montoEsperado) {
  modalPedidoId = id;
  document.getElementById('modalClienteInfo').textContent = cliente + ' — monto esperado $' + Number(montoEsperado).toFixed(0);
  document.getElementById('montoCobradoInput').value = Number(montoEsperado).toFixed(0);
  document.getElementById('modalOverlay').classList.add('open');
}
function cerrarModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  modalPedidoId = null;
}
async function confirmarCobro() {
  const monto = Number(document.getElementById('montoCobradoInput').value || 0);
  const btn = document.getElementById('modalConfirmBtn');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await apiPost('completarPedido', { id: modalPedidoId, montoCobrado: monto });
    cerrarModal();
    await cargarTodo();
  } catch (err) {
    onError(err);
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar cobro';
  }
}

/* ==========================================================
   DASHBOARD
   ========================================================== */

function renderDashboardStats() {
  const semanaActual = STATE.resumenSemanal.find(s => s.semana === STATE.semanaActual);
  document.getElementById('statSemanaActual').textContent = '$' + (semanaActual ? semanaActual.total.toFixed(0) : '0');
  document.getElementById('statCompletados').textContent = STATE.completados.length;
  document.getElementById('statPendientes').textContent = STATE.pendientes.length;
}

function drawChart() {
  const el = document.getElementById('chartGanancias');
  if (!el) return;
  if (!STATE.resumenSemanal.length) { el.innerHTML = '<div class="empty-state">Aún no hay ventas completadas para graficar.</div>'; return; }

  const dataTable = new google.visualization.DataTable();
  dataTable.addColumn('string', 'Semana');
  dataTable.addColumn('number', 'Ganancias');
  STATE.resumenSemanal.forEach(s => dataTable.addRow([s.semana.split('-S')[1] ? 'S' + s.semana.split('-S')[1] : s.semana, s.total]));

  const options = {
    backgroundColor: 'transparent',
    legend: { position: 'none' },
    colors: ['#E3A72B'],
    chartArea: { left: 60, top: 20, right: 20, bottom: 40, width: '100%', height: '75%' },
    hAxis: { textStyle: { color: '#2B2118', fontName: 'Inter' } },
    vAxis: { textStyle: { color: '#2B2118', fontName: 'Inter' }, format: '$#' },
    bar: { groupWidth: '55%' }
  };
  new google.visualization.ColumnChart(el).draw(dataTable, options);
}

/* ==========================================================
   HISTORICO
   ========================================================== */

function renderHistorico() {
  const wrap = document.getElementById('historicoList');
  if (!STATE.resumenSemanal.length) {
    wrap.innerHTML = '<div class="empty-state">Todavía no hay semanas cerradas con ventas.</div>';
    return;
  }
  const semanas = [...STATE.resumenSemanal].sort((a, b) => b.semana.localeCompare(a.semana));
  wrap.innerHTML = semanas.map((s, i) => {
    const pedidosSemana = STATE.completados.filter(p => p.semana === s.semana);
    return `
      <div class="week-block">
        <div class="week-summary" onclick="toggleWeek(${i})">
          <div>
            <div class="week-title">Semana ${s.semana.split('-S')[1]} · ${s.semana.split('-')[0]}</div>
            <div class="week-meta">${s.pedidos} pedido${s.pedidos === 1 ? '' : 's'} completado${s.pedidos === 1 ? '' : 's'}</div>
          </div>
          <div class="week-total mono">$${s.total.toFixed(0)}</div>
        </div>
        <div class="week-detail" id="week-detail-${i}">
          ${pedidosSemana.map(p => `
            <div class="pedido-row">
              <div>
                <div class="p-cliente">${escapeHtml(p.cliente)}</div>
                <div class="p-detalle">${p.detalle.map(d => d.tipo + ' x' + d.cantidad).join(', ')}</div>
              </div>
              <div class="mono">$${Number(p.montoCobrado).toFixed(0)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function toggleWeek(i) {
  document.getElementById('week-detail-' + i).classList.toggle('open');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
