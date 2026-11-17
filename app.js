/* Floyd Bebidas · stock y ventas — versión en la nube (Firebase) */

/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN = new Intl.NumberFormat('es-AR',{maximumFractionDigits:2});
const money = n => '$ ' + new Intl.NumberFormat('es-AR',{minimumFractionDigits:0,maximumFractionDigits:2}).format(Math.round((n||0)*100)/100);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const r3 = n => Math.round(n*1000)/1000;
const ymd = d => { const x = new Date(d); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); };
const fechaHora = iso => new Date(iso).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const isoDesde = d => new Date(d+'T00:00:00').toISOString();
const isoHasta = h => { const x = new Date(h+'T00:00:00'); x.setDate(x.getDate()+1); return x.toISOString(); };
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'),2600); }
function download(name, text, type='text/plain'){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text],{type})); a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
const csvCell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k,v) => { try{ localStorage.setItem(k,v); }catch(e){} };

/* ================= Firebase ================= */
const CFG = window.FIREBASE_CONFIG || {};
const DUENO = String(window.DUENO || '').toLowerCase();
let fdb, auth, USER = null, CONFIG = null;
const DB = {productos:[], movs:[]};
const VENTAS = {hoy:null, rep:null, hist:null};
let subs = {};
const col = n => fdb.collection('tienda').doc('datos').collection(n);
const cfgRef = () => fdb.collection('tienda').doc('config');
const newId = n => col(n).doc().id;
const inc = n => firebase.firestore.FieldValue.increment(n);
const mail = () => String(USER?.email || '').toLowerCase();
const esDueno = () => mail() === DUENO || (CONFIG?.duenos || []).includes(mail());

const prodById = id => DB.productos.find(p => p.id === id);
const prodByCode = c => DB.productos.find(p => p.codigo === String(c).trim());
const rubros = () => [...new Set(DB.productos.map(p => p.rubro).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));

function pantalla(estado, msg){
  document.body.classList.toggle('app', estado === 'app');
  $('#pLogo').src = $('header h1 img').src;
  $('#pMsg').innerHTML = msg || '';
  $('#entrar').style.display = estado === 'login' ? '' : 'none';
  $('#pSalir').style.display = estado === 'sinacceso' ? '' : 'none';
}
function pararTodo(){ Object.values(subs).forEach(s => { try{ (s.off || s)(); }catch(e){} }); subs = {}; VENTAS.hoy = VENTAS.rep = VENTAS.hist = null; DB.productos = []; DB.movs = []; }
function errEscritura(e){ console.error(e); alert('No se pudo guardar en la nube: ' + (e.code === 'permission-denied' ? 'tu cuenta no tiene permiso.' : e.message)); }
function errLectura(e){ console.error(e); if(e.code === 'permission-denied'){ pararTodo(); pantalla('sinacceso', `La cuenta <b>${esc(USER?.email)}</b> no tiene acceso al sistema.<br>Pedile al dueño que la agregue en Ajustes.`); } }

function iniciar(){
  if(!CFG.apiKey){ pantalla('sincfg', 'Falta configurar la conexión con la nube (firebase-config.js).'); return; }
  firebase.initializeApp(CFG);
  auth = firebase.auth(); fdb = firebase.firestore();
  fdb.enablePersistence({synchronizeTabs:true}).catch(() => {});
  auth.getRedirectResult().catch(e => pantalla('login', 'No se pudo entrar: ' + esc(e.message)));
  auth.onAuthStateChanged(async u => {
    pararTodo(); USER = u;
    if(!u){ pantalla('login', 'Sistema de stock y ventas.<br>Entrá con tu cuenta de Google.'); return; }
    pantalla('cargando', 'Entrando…');
    try{
      let snap = await cfgRef().get();
      if(!snap.exists){
        if(mail() !== DUENO) throw {code:'permission-denied'};
        await cfgRef().set({usuarios:[DUENO], duenos:[DUENO], creado:new Date().toISOString()});
      }
    }catch(e){ errLectura(e.code ? e : {code:'permission-denied'}); return; }
    subs.cfg = cfgRef().onSnapshot(s => { CONFIG = s.data() || {}; if(vista === 'respaldo') renderRespaldo(); }, errLectura);
    subs.prod = col('productos').onSnapshot({includeMetadataChanges:true}, s => {
      DB.productos = s.docs.map(d => ({id:d.id, ...d.data()})).filter(p => p.codigo);
      DB.productos.forEach(p => { p.stock = num(p.stock); p.precio = num(p.precio); p.costo = num(p.costo); p.min = num(p.min); });
      pendientes = s.metadata.hasPendingWrites; estadoSync();
      if(!document.body.classList.contains('app')){ pantalla('app'); ir(vista); } else renderSuave();
    }, errLectura);
    subs.movs = col('movs').orderBy('fecha','desc').limit(30).onSnapshot(s => { DB.movs = s.docs.map(d => ({id:d.id, ...d.data()})); if(vista === 'stock') renderStock(); }, errLectura);
    $('#userMail').textContent = u.email;
  });
}
$('#entrar').addEventListener('click', async () => {
  const prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({prompt:'select_account'});
  try{ await auth.signInWithPopup(prov); }
  catch(e){
    if(/popup|operation-not-supported/.test(e.code || '')){ try{ await auth.signInWithRedirect(prov); return; }catch(e2){ e = e2; } }
    if(e.code !== 'auth/cancelled-popup-request' && e.code !== 'auth/popup-closed-by-user') pantalla('login', 'No se pudo entrar: ' + esc(e.message));
  }
});
$('#salir').addEventListener('click', () => { if(!cart.length || confirm('Hay un ticket sin cobrar. ¿Salir igual?')) auth.signOut(); });
$('#pSalir').addEventListener('click', () => auth.signOut());

let pendientes = false;
function estadoSync(){
  const on = navigator.onLine;
  const el = $('#sync');
  el.classList.toggle('off', !on || pendientes);
  el.textContent = !on ? 'Sin internet (se guarda y se sube solo)' : pendientes ? 'Subiendo…' : 'En línea';
}
addEventListener('online', estadoSync); addEventListener('offline', estadoSync);

/* Ventas: se escuchan por rango de fechas, no todas juntas */
function escucharVentas(k, d, h){
  const key = d + '|' + h;
  if(subs['v_'+k]?.key === key) return;
  subs['v_'+k]?.off();
  VENTAS[k] = null;
  let q = col('ventas');
  if(d) q = q.where('fecha','>=', isoDesde(d));
  if(h) q = q.where('fecha','<', isoHasta(h));
  const off = q.orderBy('fecha').onSnapshot(s => {
    VENTAS[k] = s.docs.map(x => ({id:x.id, ...x.data()}));
    if((k === 'hoy' && vista === 'caja') || (k === 'rep' && vista === 'reportes') || (k === 'hist' && vista === 'ventas')) renderSuave();
  }, errLectura);
  subs['v_'+k] = {key, off};
}

/* ================= Navegación ================= */
let vista = 'caja';
$('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if(b) ir(b.dataset.v); });
function ir(v){
  vista = v;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-'+v));
  render();
  if(v === 'caja') $('#scan').focus();
}
function render(){
  if(!document.body.classList.contains('app')) return;
  ({caja:renderCaja, productos:renderProductos, stock:renderStock, reportes:renderReportes, ventas:renderVentas, respaldo:renderRespaldo})[vista]();
}
/* Re-dibuja por cambios que llegan de otro dispositivo, sin pisar lo que se está escribiendo */
function renderSuave(){
  const a = document.activeElement;
  if(a && a.closest && a.closest('#cart, #sSel') && a.matches('input,select')) return;
  render();
}

/* ================= Búsqueda / autocompletado ================= */
function buscar(q, lim=12){
  const t = norm(q).split(/\s+/).filter(Boolean); if(!t.length) return [];
  return DB.productos.filter(p => { const h = norm(p.codigo+' '+p.desc+' '+p.rubro); return t.every(w => h.includes(w)); }).slice(0, lim);
}
function stockPill(p){
  if(p.stock <= 0) return `<span class="pill out">${fmtN.format(p.stock)}</span>`;
  if(p.stock <= (p.min||0)) return `<span class="pill low">${fmtN.format(p.stock)}</span>`;
  return `<span class="pill">${fmtN.format(p.stock)}</span>`;
}
function setupSugg(input, box, onPick){
  let items = [], hi = 0;
  const draw = () => {
    if(!items.length){ box.style.display='none'; return; }
    box.style.display='block';
    box.innerHTML = items.map((p,i) => `<div data-i="${i}" class="${i===hi?'h':''}"><span>${esc(p.desc)} <span class="muted">· ${esc(p.codigo)}</span></span><span>${money(p.precio)} · ${stockPill(p)}</span></div>`).join('');
  };
  input.addEventListener('input', () => {
    const q = input.value.replace(/^\d+(?:[.,]\d+)?\*/, '');
    items = q.length >= 2 && !/^\d{6,}$/.test(q) ? buscar(q) : []; hi = 0; draw();
  });
  input.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown' && items.length){ hi = (hi+1)%items.length; draw(); e.preventDefault(); }
    else if(e.key === 'ArrowUp' && items.length){ hi = (hi-1+items.length)%items.length; draw(); e.preventDefault(); }
    else if(e.key === 'Escape'){ items=[]; draw(); }
    else if(e.key === 'Enter'){
      e.preventDefault();
      const raw = input.value.trim(); if(!raw) return;
      const m = raw.match(/^(\d+(?:[.,]\d+)?)\*(.*)$/); const qty = m ? num(m[1]) : 1; const q = m ? m[2].trim() : raw;
      const exact = prodByCode(q);
      const pick = exact || (items.length ? items[hi] : null);
      if(pick){ onPick(pick, qty); input.value=''; items=[]; draw(); }
      else onPick(null, qty, q);
    }
  });
  box.addEventListener('mousedown', e => {
    const d = e.target.closest('[data-i]'); if(!d) return; e.preventDefault();
    const raw = input.value.trim(); const m = raw.match(/^(\d+(?:[.,]\d+)?)\*/);
    onPick(items[+d.dataset.i], m ? num(m[1]) : 1); input.value=''; items=[]; draw(); input.focus();
  });
}

/* ================= Caja ================= */
let cart = [];
setupSugg($('#scan'), $('#sugg'), (p, qty, code) => {
  if(!p){
    if(confirm(`No existe un producto con "${code}". ¿Querés darlo de alta ahora?`)) abrirProducto(null, /^\d+$/.test(code) ? code : '', () => { const np = prodByCode(code); if(np) agregar(np, qty); $('#scan').focus(); });
    return;
  }
  agregar(p, qty);
});
function agregar(p, qty){
  const it = cart.find(i => i.pid === p.id);
  if(it) it.cant += qty; else cart.push({pid:p.id, cant:qty, precio:p.precio});
  renderCaja();
}
function renderCaja(){
  const hoy = ymd(new Date()); escucharVentas('hoy', hoy, hoy);
  const tb = $('#cart');
  if(!cart.length) tb.innerHTML = `<tr><td colspan="5" class="empty">Escaneá un producto para empezar</td></tr>`;
  else tb.innerHTML = cart.map((it,i) => {
    const p = prodById(it.pid);
    const aviso = !p ? ' <span class="pill out">borrado</span>' : p.stock < it.cant ? ` <span class="pill out" title="Stock insuficiente">stock ${fmtN.format(p.stock)}</span>` : '';
    return `<tr><td>${esc(p?.desc || '(producto borrado)')}${aviso}<div class="muted" style="font-size:12px">${esc(p?.codigo)}</div></td>
      <td class="n">${money(it.precio)}</td>
      <td class="n"><input class="qty" type="number" step="any" min="0" value="${it.cant}" data-i="${i}"></td>
      <td class="n">${money(it.precio*it.cant)}</td>
      <td><button class="b sm d" data-del="${i}" title="Quitar">✕</button></td></tr>`;
  }).join('');
  const tot = cart.reduce((s,i) => s + i.precio*i.cant, 0);
  $('#cartTotal').textContent = money(tot);
  const u = cart.reduce((s,i)=>s+i.cant,0);
  $('#cartCount').textContent = fmtN.format(u) + (u===1?' artículo':' artículos');
  calcVuelto();
  const vh = VENTAS.hoy;
  $('#hoyResumen').innerHTML = vh == null ? 'Cargando…' : vh.length ? `<b style="color:var(--ink);font-size:20px">${money(vh.reduce((s,v)=>s+v.total,0))}</b><br>${vh.length} ${vh.length===1?'venta':'ventas'} (todas las cajas)` : 'Todavía no hay ventas hoy.';
}
$('#cart').addEventListener('change', e => { if(e.target.dataset.i!=null){ const v=num(e.target.value); if(v<=0) cart.splice(+e.target.dataset.i,1); else cart[+e.target.dataset.i].cant=v; renderCaja(); }});
$('#cart').addEventListener('click', e => { const d=e.target.closest('[data-del]'); if(d){ cart.splice(+d.dataset.del,1); renderCaja(); $('#scan').focus(); }});
function calcVuelto(){
  const ef = $('#pago').value === 'Efectivo';
  $('#pagaConWrap').style.display = ef ? '' : 'none';
  const tot = cart.reduce((s,i)=>s+i.precio*i.cant,0); const pc = num($('#pagaCon').value);
  $('#vuelto').innerHTML = ef && pc > 0 ? (pc >= tot ? `Vuelto: <b style="color:var(--ink);font-size:18px">${money(pc-tot)}</b>` : `<span style="color:var(--bad)">Faltan ${money(tot-pc)}</span>`) : '';
}
$('#pago').addEventListener('change', calcVuelto);
$('#pagaCon').addEventListener('input', calcVuelto);
$('#vaciar').addEventListener('click', () => { if(cart.length && confirm('¿Cancelar el ticket actual?')){ cart=[]; renderCaja(); $('#scan').focus(); }});
$('#cobrar').addEventListener('click', cobrar);
document.addEventListener('keydown', e => { if(e.key === 'F2' && vista === 'caja' && document.body.classList.contains('app')){ e.preventDefault(); cobrar(); }});
function cobrar(){
  if(!cart.length){ toast('El ticket está vacío'); return; }
  if(cart.some(it => !prodById(it.pid))){ alert('Hay un producto que se borró desde otro dispositivo. Quitalo del ticket.'); return; }
  const faltan = cart.filter(it => prodById(it.pid).stock < it.cant);
  if(faltan.length && !confirm(`Hay ${faltan.length} producto(s) con stock insuficiente en el sistema. ¿Cobrar igual? (el stock quedará negativo)`)) return;
  const items = cart.map(it => { const p = prodById(it.pid); return {pid:p.id, codigo:p.codigo, desc:p.desc, rubro:p.rubro, cant:it.cant, precio:it.precio, costo:p.costo||0}; });
  const total = items.reduce((s,i)=>s+i.precio*i.cant,0);
  const b = fdb.batch();
  b.set(col('ventas').doc(newId('ventas')), {fecha:new Date().toISOString(), items, total, pago:$('#pago').value, usuario:mail()});
  items.forEach(i => b.set(col('productos').doc(i.pid), {stock:inc(-i.cant)}, {merge:true}));
  b.commit().catch(errEscritura);   // sin internet queda guardado y se sube solo
  cart=[]; $('#pagaCon').value=''; renderCaja(); toast('Venta registrada: '+money(total)); $('#scan').focus();
}

/* ================= Productos ================= */
let pSort = {k:'desc', d:1};
$('#pBuscar').addEventListener('input', renderProductos);
$('#pRubro').addEventListener('change', renderProductos);
$$('#v-productos th.s').forEach(th => th.addEventListener('click', () => { pSort = {k:th.dataset.k, d: pSort.k===th.dataset.k ? -pSort.d : 1}; renderProductos(); }));
function fillRubroSelect(sel, todos='Todos los rubros'){
  const v = sel.value; sel.innerHTML = `<option value="">${todos}</option>` + rubros().map(r => `<option>${esc(r)}</option>`).join(''); sel.value = rubros().includes(v) ? v : '';
}
function renderProductos(){
  fillRubroSelect($('#pRubro'));
  const q = $('#pBuscar').value, r = $('#pRubro').value;
  let list = q.trim() ? buscar(q, 100000) : DB.productos.slice();
  if(r) list = list.filter(p => p.rubro === r);
  const {k,d} = pSort;
  list.sort((a,b) => typeof a[k] === 'number' ? (a[k]-b[k])*d : String(a[k]||'').localeCompare(String(b[k]||''),'es')*d);
  $('#pTabla').innerHTML = list.length ? list.map(p => `<tr>
    <td>${esc(p.codigo)}</td><td>${esc(p.desc)}</td><td><span class="pill">${esc(p.rubro)}</span></td>
    <td class="n">${p.costo ? money(p.costo) : '<span class="muted">—</span>'}</td><td class="n"><b>${money(p.precio)}</b></td><td class="n">${stockPill(p)}</td>
    <td class="n"><button class="b sm" data-ed="${p.id}">Editar</button> <button class="b sm d" data-rm="${p.id}">Borrar</button></td></tr>`).join('')
    : `<tr><td colspan="7" class="empty">${DB.productos.length ? 'Sin resultados' : 'Todavía no hay productos. Tocá “+ Nuevo producto”.'}</td></tr>`;
}
$('#pTabla').addEventListener('click', e => {
  const ed = e.target.closest('[data-ed]'), rm = e.target.closest('[data-rm]');
  if(ed) abrirProducto(prodById(ed.dataset.ed));
  if(rm){ const p = prodById(rm.dataset.rm); if(p && confirm(`¿Borrar "${p.desc}"? Las ventas ya registradas se conservan.`)) col('productos').doc(p.id).delete().catch(errEscritura); }
});
$('#pNuevo').addEventListener('click', () => abrirProducto(null));
$('#pCsv').addEventListener('click', () => {
  download('productos.csv', toCsv([['codigo','descripcion','rubro','costo','precio','stock','minimo'], ...DB.productos.map(p => [p.codigo,p.desc,p.rubro,p.costo||'',p.precio,p.stock,p.min||0])]), 'text/csv');
});

let editando = null, despuesDeGuardar = null;
function abrirProducto(p, codigo='', cb=null){
  editando = p ? p.id : null; despuesDeGuardar = cb;
  $('#fTitulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
  $('#fCodigo').value = p?.codigo ?? codigo; $('#fDesc').value = p?.desc ?? ''; $('#fRubro').value = p?.rubro ?? '';
  $('#fCosto').value = p?.costo || ''; $('#fPrecio').value = p?.precio ?? ''; $('#fMin').value = p?.min ?? 0; $('#fStock').value = p?.stock ?? 0;
  $('#fStockWrap').style.display = p ? 'none' : '';
  $('#rubrosList').innerHTML = rubros().map(r => `<option value="${esc(r)}">`).join('');
  margen(); $('#dlgProd').showModal(); (codigo || p ? $('#fDesc') : $('#fCodigo')).focus();
}
function margen(){
  const c = num($('#fCosto').value), pr = num($('#fPrecio').value);
  $('#fMargen').textContent = c > 0 && pr > 0 ? `Margen: ${fmtN.format((pr-c)/c*100)} % (${money(pr-c)} por unidad)` : '';
}
$('#fCosto').addEventListener('input', margen); $('#fPrecio').addEventListener('input', margen);
$('#fCancel').addEventListener('click', () => $('#dlgProd').close());
$('#fCodigo').addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); $('#fDesc').focus(); }});
$('#fGen').addEventListener('click', () => {
  let n = 1; DB.productos.forEach(p => { const m = /^INT(\d+)$/.exec(p.codigo); if(m) n = Math.max(n, +m[1]+1); });
  $('#fCodigo').value = 'INT' + String(n).padStart(4,'0');
});
$('#fProd').addEventListener('submit', e => {
  e.preventDefault();
  const codigo = $('#fCodigo').value.trim(), desc = $('#fDesc').value.trim(), rubro = $('#fRubro').value.trim();
  const otro = prodByCode(codigo);
  if(otro && otro.id !== editando){ alert(`Ese código ya lo tiene "${otro.desc}".`); return; }
  const rub = rubros().find(r => norm(r) === norm(rubro)) || rubro;
  const datos = {codigo, desc, rubro:rub, costo:num($('#fCosto').value), precio:num($('#fPrecio').value), min:num($('#fMin').value)};
  if(editando) col('productos').doc(editando).set(datos, {merge:true}).catch(errEscritura);
  else {
    const id = newId('productos'), stock = num($('#fStock').value), alta = new Date().toISOString();
    const b = fdb.batch();
    b.set(col('productos').doc(id), {...datos, stock, alta});
    if(stock) b.set(col('movs').doc(newId('movs')), {fecha:alta, pid:id, desc, tipo:'Stock inicial', cant:stock, nota:'', usuario:mail()});
    b.commit().catch(errEscritura);
  }
  $('#dlgProd').close(); toast('Producto guardado');
  if(despuesDeGuardar){ const f = despuesDeGuardar; despuesDeGuardar = null; setTimeout(f, 50); }
});

/* ================= Stock ================= */
let sSel = null;
setupSugg($('#sScan'), $('#sSugg'), (p, qty, code) => {
  if(!p){ if(confirm(`No existe "${code}". ¿Darlo de alta?`)) abrirProducto(null, /^\d+$/.test(code)?code:''); return; }
  sSel = p.id; renderSel();
});
function renderSel(){
  const p = sSel && prodById(sSel);
  if(!p){ $('#sSel').innerHTML=''; return; }
  $('#sSel').innerHTML = `<div style="border:1px solid var(--line);border-radius:8px;padding:12px">
    <div><b>${esc(p.desc)}</b> <span class="muted">· ${esc(p.codigo)} · ${esc(p.rubro)}</span></div>
    <div class="muted" style="margin:4px 0 10px">Stock actual: ${stockPill(p)}</div>
    <div class="row">
      <label>Tipo<select id="mTipo"><option value="ing">Ingreso (suma)</option><option value="aj">Ajuste a cantidad exacta</option><option value="baja">Baja / rotura / vencido (resta)</option></select></label>
      <label>Cantidad<input id="mCant" type="number" step="any" style="width:110px"></label>
      <label>Nuevo costo (opcional)<input id="mCosto" type="number" step="any" style="width:130px" placeholder="${p.costo||''}"></label>
      <label style="flex:1;min-width:140px">Nota<input id="mNota" placeholder="Proveedor, remito…"></label>
      <button class="b p" id="mOk">Registrar</button>
    </div></div>`;
  $('#mCant').focus();
  $('#mCant').addEventListener('keydown', e => { if(e.key==='Enter') $('#mOk').click(); });
  $('#mOk').addEventListener('click', () => {
    const p = prodById(sSel); if(!p) return;
    const t = $('#mTipo').value, c = num($('#mCant').value);
    if(!$('#mCant').value){ toast('Ingresá una cantidad'); return; }
    let delta, tipo, cambio;
    if(t==='ing'){ delta = c; tipo='Ingreso'; cambio = {stock:inc(delta)}; }
    else if(t==='baja'){ delta = -Math.abs(c); tipo='Baja'; cambio = {stock:inc(delta)}; }
    else { delta = r3(c - p.stock); tipo='Ajuste'; cambio = {stock:c}; }
    if($('#mCosto').value) cambio.costo = num($('#mCosto').value);
    const b = fdb.batch();
    b.set(col('productos').doc(p.id), cambio, {merge:true});
    b.set(col('movs').doc(newId('movs')), {fecha:new Date().toISOString(), pid:p.id, desc:p.desc, tipo, cant:delta, nota:$('#mNota').value.trim(), usuario:mail()});
    b.commit().catch(errEscritura);
    toast(`${tipo} registrado. Stock: ${fmtN.format(r3(t==='aj' ? c : p.stock + delta))}`); sSel=null; $('#sSel').innerHTML=''; $('#sScan').focus();
  });
}
function renderStock(){
  const valCosto = DB.productos.reduce((s,p)=>s+Math.max(0,p.stock)*(p.costo||0),0);
  const valVenta = DB.productos.reduce((s,p)=>s+Math.max(0,p.stock)*p.precio,0);
  const bajo = DB.productos.filter(p => p.stock <= (p.min||0)).sort((a,b)=>(a.stock-(a.min||0))-(b.stock-(b.min||0)));
  const sin = DB.productos.filter(p => p.stock <= 0).length;
  $('#sKpis').innerHTML = [
    ['Productos', fmtN.format(DB.productos.length)], ['Valor del stock (costo)', money(valCosto)], ['Valor del stock (venta)', money(valVenta)],
    ['Para reponer', fmtN.format(bajo.length)], ['Sin stock', fmtN.format(sin)]
  ].map(([l,v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
  $('#sBajo').innerHTML = bajo.length ? bajo.map(p => `<tr><td>${esc(p.desc)}<div class="muted" style="font-size:12px">${esc(p.rubro)}</div></td><td class="n">${stockPill(p)}</td><td class="n">${fmtN.format(p.min||0)}</td></tr>`).join('') : `<tr><td colspan="3" class="empty">Todo en orden 👍</td></tr>`;
  const mv = DB.movs;
  $('#sMovs').innerHTML = mv.length ? mv.map(m => `<tr><td>${fechaHora(m.fecha)}</td><td>${esc(prodById(m.pid)?.desc || m.desc)}</td><td>${esc(m.tipo)}</td><td class="n">${m.cant>0?'+':''}${fmtN.format(m.cant)}</td><td class="muted">${esc(m.nota)}</td></tr>`).join('') : `<tr><td colspan="5" class="empty">Sin movimientos</td></tr>`;
  const p = sSel && prodById(sSel);
  if(p && !$('#sSel').contains(document.activeElement)) renderSel();
}

/* ================= Reportes ================= */
let rTodos = false;
function preset(p){
  const h = new Date(); let d = new Date(h), a = new Date(h);
  if(p==='ayer'){ d.setDate(h.getDate()-1); a = new Date(d); }
  else if(p==='7'){ d.setDate(h.getDate()-6); }
  else if(p==='30'){ d.setDate(h.getDate()-29); }
  else if(p==='mes'){ d = new Date(h.getFullYear(), h.getMonth(), 1); }
  else if(p==='mesant'){ d = new Date(h.getFullYear(), h.getMonth()-1, 1); a = new Date(h.getFullYear(), h.getMonth(), 0); }
  $('#rDesde').value = ymd(d); $('#rHasta').value = ymd(a);
  $$('#rPresets button').forEach(b => b.classList.toggle('on', b.dataset.p===p));
  render();
}
$('#rPresets').addEventListener('click', e => { const b = e.target.closest('button'); if(b) preset(b.dataset.p); });
['#rDesde','#rHasta'].forEach(s => $(s).addEventListener('change', () => { $$('#rPresets button').forEach(b=>b.classList.remove('on')); renderReportes(); }));
$('#rRubro').addEventListener('change', renderReportes); $('#rOrden').addEventListener('change', renderReportes);
$('#rMas').addEventListener('click', () => { rTodos = !rTodos; renderReportes(); });

function datosReporte(){
  const d = $('#rDesde').value, h = $('#rHasta').value, rub = $('#rRubro').value;
  escucharVentas('rep', d, h);
  const ventas = VENTAS.rep || [];
  const lineas = [];
  ventas.forEach(v => v.items.forEach(i => { if(!rub || i.rubro === rub) lineas.push({...i, fecha:v.fecha, pago:v.pago, vid:v.id}); }));
  return {d, h, rub, ventas, lineas, cargando: VENTAS.rep == null};
}
function renderReportes(){
  fillRubroSelect($('#rRubro'));
  const {d, h, rub, lineas, cargando} = datosReporte();
  if(cargando){ $('#rKpis').innerHTML = '<div class="kpi"><div class="l">Cargando ventas…</div><div class="v">—</div></div>'; return; }
  const imp = lineas.reduce((s,l)=>s+l.precio*l.cant,0);
  const uni = lineas.reduce((s,l)=>s+l.cant,0);
  const gan = lineas.reduce((s,l)=>s+(l.costo ? (l.precio-l.costo)*l.cant : 0),0);
  const tickets = new Set(lineas.map(l=>l.vid)).size;
  $('#rKpis').innerHTML = [
    ['Total vendido', money(imp)], ['Unidades', fmtN.format(uni)], ['Tickets', fmtN.format(tickets)],
    ['Ticket promedio', money(tickets ? imp/tickets : 0)], ['Ganancia estimada', money(gan)]
  ].map(([l,v]) => `<div class="kpi"><div class="l">${l}${rub?' · '+esc(rub):''}</div><div class="v">${v}</div></div>`).join('');

  const porDia = {}; lineas.forEach(l => { const f = ymd(l.fecha); porDia[f] = (porDia[f]||0) + l.precio*l.cant; });
  const dias = []; if(d && h){ for(let x = new Date(d+'T12:00'); ymd(x) <= h && dias.length < 400; x.setDate(x.getDate()+1)) dias.push(ymd(x)); }
  const maxD = Math.max(1, ...dias.map(k => porDia[k]||0));
  $('#rChart').innerHTML = dias.length ? dias.map(k => `<div class="c" title="${k.split('-').reverse().join('/')}: ${money(porDia[k]||0)}"><div style="height:${(porDia[k]||0)/maxD*100}%"></div><span>${dias.length<=31 || k.endsWith('-01') || k.endsWith('-15') ? k.slice(8)+'/'+k.slice(5,7) : ''}</span></div>`).join('') : '<div class="empty">Elegí un rango de fechas</div>';

  const porProd = {};
  lineas.forEach(l => { const o = porProd[l.pid] ||= {pid:l.pid, desc:l.desc, codigo:l.codigo, rubro:l.rubro, cant:0, imp:0, gan:0}; o.cant += l.cant; o.imp += l.precio*l.cant; o.gan += l.costo ? (l.precio-l.costo)*l.cant : 0; });
  const ord = $('#rOrden').value;
  const top = Object.values(porProd).sort((a,b) => b[ord]-a[ord]);
  const maxT = Math.max(1, ...top.map(t=>t[ord]));
  const vis = rTodos ? top : top.slice(0,15);
  $('#rTop').innerHTML = vis.length ? vis.map((t,i) => `<tr><td class="muted">${i+1}</td><td>${esc(prodById(t.pid)?.desc || t.desc)}</td><td><span class="pill">${esc(t.rubro)}</span></td><td class="n">${fmtN.format(t.cant)}</td><td class="n">${money(t.imp)}</td><td class="n">${money(t.gan)}</td><td class="barcell"><div class="bar" style="width:${Math.max(0,t[ord])/maxT*100}%"></div></td></tr>`).join('') : `<tr><td colspan="7" class="empty">No hay ventas en este período</td></tr>`;
  $('#rMas').style.display = top.length > 15 ? '' : 'none';
  $('#rMas').textContent = rTodos ? 'Ver solo los 15 primeros' : `Ver todos (${top.length})`;

  const porRub = {}; lineas.forEach(l => { const o = porRub[l.rubro||'(sin rubro)'] ||= {cant:0, imp:0}; o.cant += l.cant; o.imp += l.precio*l.cant; });
  const rr = Object.entries(porRub).sort((a,b) => b[1].imp - a[1].imp); const maxR = Math.max(1, ...rr.map(r=>r[1].imp));
  $('#rRubros').innerHTML = rr.length ? rr.map(([r,o]) => `<tr><td>${esc(r)}</td><td class="n">${fmtN.format(o.cant)}</td><td class="n">${money(o.imp)}</td><td class="n">${fmtN.format(imp? o.imp/imp*100 : 0)}%</td><td class="barcell"><div class="bar" style="width:${o.imp/maxR*100}%"></div></td></tr>`).join('') : `<tr><td colspan="5" class="empty">—</td></tr>`;

  const porPago = {}; lineas.forEach(l => porPago[l.pago] = (porPago[l.pago]||0) + l.precio*l.cant);
  $('#rPagos').innerHTML = Object.entries(porPago).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `<tr><td>${esc(k)}</td><td class="n">${money(v)}</td><td class="n muted">${fmtN.format(imp? v/imp*100:0)}%</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`;

  const nombres = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const dow = Array(7).fill(0); lineas.forEach(l => dow[new Date(l.fecha).getDay()] += l.precio*l.cant);
  const maxW = Math.max(1, ...dow);
  $('#rDow').innerHTML = imp ? [1,2,3,4,5,6,0].map(i => `<tr><td style="width:90px">${nombres[i]}</td><td class="n" style="width:110px">${money(dow[i])}</td><td><div class="bar" style="width:${dow[i]/maxW*100}%"></div></td></tr>`).join('') : `<tr><td class="empty">—</td></tr>`;

  const vendidos = new Set(lineas.map(l=>l.pid));
  const sin = DB.productos.filter(p => (!rub || p.rubro===rub) && !vendidos.has(p.id)).sort((a,b)=>Math.max(0,b.stock)*(b.costo||b.precio) - Math.max(0,a.stock)*(a.costo||a.precio));
  $('#rSinN').textContent = `(${sin.length})`;
  $('#rSin').innerHTML = sin.length ? sin.slice(0,50).map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.desc)}</td><td><span class="pill">${esc(p.rubro)}</span></td><td class="n">${stockPill(p)}</td><td class="n">${money(Math.max(0,p.stock)*(p.costo||p.precio))}</td></tr>`).join('') : `<tr><td colspan="5" class="empty">Todos los productos tuvieron ventas</td></tr>`;
}
$('#rCsv').addEventListener('click', () => {
  const {d, h, lineas} = datosReporte(); const m = {};
  lineas.forEach(l => { const o = m[l.pid] ||= [l.codigo, l.desc, l.rubro, 0, 0, 0]; o[3]+=l.cant; o[4]+=l.precio*l.cant; o[5]+=l.costo?(l.precio-l.costo)*l.cant:0; });
  const rows = Object.values(m).sort((a,b)=>b[3]-a[3]).map(r => [r[0],r[1],r[2],String(r[3]).replace('.',','),r[4].toFixed(2).replace('.',','),r[5].toFixed(2).replace('.',',')]);
  download(`ventas_${d}_a_${h}.csv`, toCsv([['codigo','producto','rubro','unidades','importe','ganancia'], ...rows]), 'text/csv');
});

/* ================= Historial de ventas ================= */
$('#vDesde').value = ymd(new Date(Date.now()-6*864e5)); $('#vHasta').value = ymd(new Date());
['#vDesde','#vHasta'].forEach(s => $(s).addEventListener('change', renderVentas));
function renderVentas(){
  const d = $('#vDesde').value, h = $('#vHasta').value;
  escucharVentas('hist', d, h);
  if(VENTAS.hist == null){ $('#vTabla').innerHTML = `<tr><td colspan="5" class="empty">Cargando…</td></tr>`; return; }
  const vs = VENTAS.hist.slice().reverse();
  $('#vResumen').textContent = `${vs.length} ventas · ${money(vs.reduce((s,v)=>s+v.total,0))}`;
  $('#vTabla').innerHTML = vs.length ? vs.slice(0,500).map(v => `<tr><td>${fechaHora(v.fecha)}${v.usuario?`<div class="muted" style="font-size:12px">${esc(v.usuario)}</div>`:''}</td>
    <td>${v.items.map(i => `${fmtN.format(i.cant)} × ${esc(i.desc)}`).join('<br>')}</td><td>${esc(v.pago)}</td>
    <td class="n"><b>${money(v.total)}</b></td><td><button class="b sm d" data-anular="${v.id}">Anular</button></td></tr>`).join('') : `<tr><td colspan="5" class="empty">Sin ventas en el período</td></tr>`;
}
$('#vTabla').addEventListener('click', e => {
  const b = e.target.closest('[data-anular]'); if(!b) return;
  const v = (VENTAS.hist||[]).find(x => x.id === b.dataset.anular); if(!v) return;
  if(!confirm(`¿Anular la venta de ${money(v.total)} del ${fechaHora(v.fecha)}? La mercadería vuelve al stock.`)) return;
  const bt = fdb.batch();
  bt.delete(col('ventas').doc(v.id));
  v.items.forEach(i => { if(prodById(i.pid)) bt.set(col('productos').doc(i.pid), {stock:inc(i.cant)}, {merge:true}); });
  bt.set(col('movs').doc(newId('movs')), {fecha:new Date().toISOString(), pid:'', desc:`Venta anulada (${money(v.total)})`, tipo:'Anulación', cant:v.items.reduce((s,i)=>s+i.cant,0), nota:fechaHora(v.fecha), usuario:mail()});
  bt.commit().catch(errEscritura);
  toast('Venta anulada');
});

/* ================= Ajustes: usuarios, respaldo, migración ================= */
const LS_LOCAL = 'minisuper_v1', LS_MIGRADO = 'minisuper_migrado_nube';
function datosLocales(){ try{ const d = JSON.parse(lsGet(LS_LOCAL) || 'null'); return d && Array.isArray(d.productos) ? d : null; }catch(e){ return null; } }
function renderRespaldo(){
  // usuarios
  const us = (CONFIG?.usuarios || []).slice().sort();
  const dueno = esDueno();
  $('#uTabla').innerHTML = us.map(u => `<tr><td>${esc(u)}${u===DUENO || (CONFIG?.duenos||[]).includes(u) ? ' <span class="pill ok">dueño</span>' : ''}${u===mail()?' <span class="muted">(vos)</span>':''}</td>
    <td class="n">${dueno && u !== DUENO && u !== mail() ? `<button class="b sm d" data-quitar="${esc(u)}">Quitar</button>` : ''}</td></tr>`).join('');
  $('#uAlta').style.display = dueno ? '' : 'none';
  // migración
  const loc = datosLocales();
  const mostrar = dueno && loc && (loc.productos.length || loc.ventas?.length) && !lsGet(LS_MIGRADO);
  $('#migrarCard').style.display = mostrar ? '' : 'none';
  if(mostrar) $('#migrarInfo').textContent = `Este navegador tiene ${loc.productos.length} productos, ${loc.ventas?.length||0} ventas y ${loc.movs?.length||0} movimientos de la versión anterior (sin nube). Subilos una sola vez para verlos en todos los dispositivos.`;
  const ub = lsGet('minisuper_ultimo_backup');
  $('#bkInfo').textContent = `En la nube: ${DB.productos.length} productos.` + (ub ? ` Última copia descargada en este dispositivo: ${fechaHora(ub)}.` : '');
}
$('#uAgregar').addEventListener('click', () => {
  const m = $('#uMail').value.trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)){ toast('Escribí un mail válido'); return; }
  cfgRef().update({usuarios: firebase.firestore.FieldValue.arrayUnion(m)}).then(() => toast('Agregado: '+m)).catch(errEscritura);
  $('#uMail').value = '';
});
$('#uMail').addEventListener('keydown', e => { if(e.key === 'Enter') $('#uAgregar').click(); });
$('#uTabla').addEventListener('click', e => {
  const b = e.target.closest('[data-quitar]'); if(!b) return;
  if(confirm(`¿Quitarle el acceso a ${b.dataset.quitar}?`)) cfgRef().update({usuarios: firebase.firestore.FieldValue.arrayRemove(b.dataset.quitar)}).catch(errEscritura);
});

async function subirTodo(d, etiqueta){
  const ops = [];
  (d.productos||[]).forEach(p => { const {id, ...r} = p; ops.push([col('productos').doc(id || newId('productos')), r]); });
  (d.ventas||[]).forEach(v => { const {id, ...r} = v; ops.push([col('ventas').doc(id || newId('ventas')), r]); });
  (d.movs||[]).forEach(m => { const {id, ...r} = m; ops.push([col('movs').doc(id || newId('movs')), r]); });
  for(let i = 0; i < ops.length; i += 400){
    const b = fdb.batch(); ops.slice(i, i+400).forEach(([ref, data]) => b.set(ref, data, {merge:true}));
    toast(`${etiqueta}: ${Math.min(i+400, ops.length)} de ${ops.length}…`);
    await b.commit();
  }
  return ops.length;
}
$('#migrar').addEventListener('click', async () => {
  const loc = datosLocales(); if(!loc) return;
  const choques = loc.productos.filter(p => { const o = prodByCode(p.codigo); return o && o.id !== p.id; });
  if(choques.length && !confirm(`${choques.length} producto(s) ya existen en la nube con el mismo código y quedarían repetidos. ¿Subir igual?`)) return;
  $('#migrar').disabled = true;
  try{ const n = await subirTodo(loc, 'Subiendo'); lsSet(LS_MIGRADO, new Date().toISOString()); toast(`Listo: ${n} registros subidos a la nube`); }
  catch(e){ errEscritura(e); }
  $('#migrar').disabled = false; renderRespaldo();
});
$('#bkExport').addEventListener('click', async () => {
  toast('Preparando la copia…');
  try{
    const [p, v, m] = await Promise.all(['productos','ventas','movs'].map(n => col(n).get()));
    const map = s => s.docs.map(d => ({id:d.id, ...d.data()}));
    download(`floyd_backup_${ymd(new Date())}.json`, JSON.stringify({productos:map(p), ventas:map(v), movs:map(m), exportado:new Date().toISOString()}), 'application/json');
    lsSet('minisuper_ultimo_backup', new Date().toISOString()); renderRespaldo();
  }catch(e){ errEscritura(e); }
});
$('#bkImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f) return;
  try{
    const d = JSON.parse(await f.text());
    if(!Array.isArray(d.productos) || !Array.isArray(d.ventas)) throw new Error('formato');
    if(!confirm(`La copia tiene ${d.productos.length} productos y ${d.ventas.length} ventas. Se suben a la nube (lo que tenga el mismo id se reemplaza; no se borra nada). ¿Continuar?`)) return;
    const n = await subirTodo(d, 'Subiendo copia'); toast(`Copia subida: ${n} registros`);
  }catch(err){ alert(err.message === 'formato' ? 'El archivo no es una copia válida.' : 'Error al subir: ' + err.message); }
});
$('#csvImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value=''; if(!f) return;
  const txt = (await f.text()).replace(/^﻿/, '');
  const sep = txt.split('\n')[0].includes(';') ? ';' : ',';
  let nuevos = 0, act = 0; const ops = [];
  txt.split(/\r?\n/).forEach((line, i) => {
    if(!line.trim()) return;
    const c = line.split(sep).map(s => s.trim().replace(/^"|"$/g,''));
    if(i === 0 && /codigo|código/i.test(c[0])) return;
    const [codigo, desc, rubro, costo, precio, stock, min] = c; if(!codigo || !desc) return;
    const ex = prodByCode(codigo);
    const datos = {codigo, desc, rubro:rubro||'General', costo:num(costo), precio:num(precio), min:num(min)};
    if(stock !== undefined && stock !== '') datos.stock = num(stock);
    if(ex){ ops.push([col('productos').doc(ex.id), datos]); act++; }
    else { ops.push([col('productos').doc(newId('productos')), {stock:0, ...datos, alta:new Date().toISOString()}]); nuevos++; }
  });
  try{
    for(let i = 0; i < ops.length; i += 400){ const b = fdb.batch(); ops.slice(i,i+400).forEach(([r,d]) => b.set(r, d, {merge:true})); await b.commit(); }
    toast(`${nuevos} nuevos, ${act} actualizados`);
  }catch(err){ errEscritura(err); }
});

/* ================= Arranque ================= */
$('#rDesde').value = ymd(new Date(Date.now()-29*864e5)); $('#rHasta').value = ymd(new Date());
$$('#rPresets button').forEach(b => b.classList.toggle('on', b.dataset.p === '30'));
estadoSync();
iniciar();
