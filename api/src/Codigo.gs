/**
 * DASHBOARD DE TAMALES — API (Google Apps Script Web App)
 * Se implementa como aplicación web y se consume por fetch() desde
 * una página web separada, usando la URL de implementación (.../exec).
 *
 * Lectura  -> GET  {URL}?action=dashboard
 * Escritura -> POST {URL}  body: JSON.stringify({ action: '...', ...datos })
 */

const SHEET_PEDIDOS = 'Pedidos';
const SHEET_CONFIG = 'Config';

/* ---------------------- ENRUTADOR ---------------------- */

function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'dashboard';
    let data;
    switch (action) {
      case 'dashboard':
        data = getDashboardData();
        break;
      case 'config':
        data = getConfig();
        break;
      case 'pedidos':
        data = listarPedidos(e.parameter.estado || null);
        break;
      default:
        throw new Error('Acción GET no reconocida: ' + action);
    }
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let data;
    switch (action) {
      case 'crearPedido':
        data = crearPedido(body.cliente, body.items);
        break;
      case 'completarPedido':
        data = completarPedido(body.id, body.montoCobrado);
        break;
      case 'reabrirPedido':
        data = reabrirPedido(body.id);
        break;
      case 'eliminarPedido':
        data = eliminarPedido(body.id);
        break;
      case 'guardarConfig':
        data = guardarConfig(body.precio, body.tipos);
        break;
      default:
        throw new Error('Acción POST no reconocida: ' + action);
    }
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------- HOJA DE CÁLCULO ---------------------- */

function getSS() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets() {
  const ss = getSS();

  let pedidos = ss.getSheetByName(SHEET_PEDIDOS);
  if (!pedidos) {
    pedidos = ss.insertSheet(SHEET_PEDIDOS);
    pedidos.appendRow([
      'ID', 'Fecha', 'Semana', 'Cliente', 'Detalle',
      'CantidadTotal', 'MontoEsperado', 'MontoCobrado', 'Estado', 'FechaCompletado'
    ]);
    pedidos.setFrozenRows(1);
  }

  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) {
    config = ss.insertSheet(SHEET_CONFIG);
    config.getRange('A1').setValue('Precio por tamal');
    config.getRange('B1').setValue(15);
    config.getRange('A3').setValue('Tipos de tamal');
    config.getRange('A4').setValue('Verde');
    config.getRange('A5').setValue('Rojo');
    config.getRange('A6').setValue('Dulce');
    config.getRange('A7').setValue('Rajas con queso');
  }

  return { pedidos, config };
}

function getWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-S' + String(weekNo).padStart(2, '0');
}

/* ---------------------- CONFIG ---------------------- */

function getConfig() {
  const { config } = ensureSheets();
  const precio = config.getRange('B1').getValue();
  const lastRow = config.getLastRow();
  let tipos = [];
  if (lastRow >= 4) {
    tipos = config.getRange(4, 1, lastRow - 3, 1).getValues().flat().filter(String);
  }
  return { precio: Number(precio) || 0, tipos };
}

function guardarConfig(precio, tipos) {
  const { config } = ensureSheets();
  config.getRange('B1').setValue(precio);
  const lastRow = config.getLastRow();
  if (lastRow >= 4) config.getRange(4, 1, lastRow - 3, 1).clearContent();
  (tipos || []).forEach((t, i) => config.getRange(4 + i, 1).setValue(t));
  return getConfig();
}

/* ---------------------- PEDIDOS ---------------------- */

/** items: [{tipo: 'Verde', cantidad: 3}, ...] */
function crearPedido(cliente, items) {
  if (!cliente) throw new Error('Falta el nombre del cliente');
  if (!items || !items.length) throw new Error('El pedido no tiene tamales');

  const { pedidos } = ensureSheets();
  const { precio } = getConfig();
  const cantidadTotal = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
  const montoEsperado = cantidadTotal * precio;
  const now = new Date();
  const id = Utilities.getUuid();

  pedidos.appendRow([
    id, now, getWeekKey(now), cliente, JSON.stringify(items),
    cantidadTotal, montoEsperado, '', 'Pendiente', ''
  ]);

  return { id, montoEsperado };
}

function listarPedidos(filtroEstado) {
  const { pedidos } = ensureSheets();
  const lastRow = pedidos.getLastRow();
  if (lastRow < 2) return [];
  const data = pedidos.getRange(2, 1, lastRow - 1, 10).getValues();
  return data
    .map(row => ({
      id: row[0],
      fecha: row[1],
      semana: row[2],
      cliente: row[3],
      detalle: JSON.parse(row[4] || '[]'),
      cantidadTotal: row[5],
      montoEsperado: row[6],
      montoCobrado: row[7],
      estado: row[8],
      fechaCompletado: row[9]
    }))
    .filter(p => !filtroEstado || p.estado === filtroEstado)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function completarPedido(id, montoCobrado) {
  const { pedidos } = ensureSheets();
  const lastRow = pedidos.getLastRow();
  if (lastRow < 2) throw new Error('Pedido no encontrado');
  const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) throw new Error('Pedido no encontrado');
  const row = rowIndex + 2;
  pedidos.getRange(row, 8).setValue(Number(montoCobrado));
  pedidos.getRange(row, 9).setValue('Completado');
  pedidos.getRange(row, 10).setValue(new Date());
  return true;
}

function reabrirPedido(id) {
  const { pedidos } = ensureSheets();
  const lastRow = pedidos.getLastRow();
  const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) throw new Error('Pedido no encontrado');
  const row = rowIndex + 2;
  pedidos.getRange(row, 8).setValue('');
  pedidos.getRange(row, 9).setValue('Pendiente');
  pedidos.getRange(row, 10).setValue('');
  return true;
}

function eliminarPedido(id) {
  const { pedidos } = ensureSheets();
  const lastRow = pedidos.getLastRow();
  if (lastRow < 2) return false;
  const ids = pedidos.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIndex = ids.indexOf(id);
  if (rowIndex === -1) return false;
  pedidos.deleteRow(rowIndex + 2);
  return true;
}

function obtenerResumenSemanal() {
  const completados = listarPedidos('Completado');
  const map = {};
  completados.forEach(p => {
    if (!map[p.semana]) map[p.semana] = { semana: p.semana, total: 0, pedidos: 0 };
    map[p.semana].total += Number(p.montoCobrado || 0);
    map[p.semana].pedidos += 1;
  });
  return Object.values(map).sort((a, b) => a.semana.localeCompare(b.semana));
}

function getDashboardData() {
  const todos = listarPedidos(null);
  return {
    todos,
    completados: todos.filter(p => p.estado === 'Completado'),
    pendientes: todos.filter(p => p.estado === 'Pendiente'),
    resumenSemanal: obtenerResumenSemanal(),
    config: getConfig(),
    semanaActual: getWeekKey(new Date())
  };
}
