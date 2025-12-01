/* ================= CONFIGURACIÓN ================= */
const IS_PROD = location.hostname.endsWith(".vercel.app");
const SUPABASE_URL = "https://tqaidimwfhlklkhsgtam.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxYWlkaW13Zmhsa2xraHNndGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1ODc3MjksImV4cCI6MjA4MDE2MzcyOX0.FuuvVxuKqaGR_9q_aB1-OaCf-gIFbTE7U-i4I__Ti0Q";

// Inicializar cliente
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB_NAME = 'RecetaDigitalDB';
const DB_VERSION = 11;
const LS_KEYS = { settings:'receta_settings', recetas:'receta_items', catalogo:'receta_catalogo' };
const NEXT_MAP_KEY = 'nextOCMap';

let db = null;
let idbOk = true;

/* ================= HELPERS DOM ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function todayISO() { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function num(v) { if(!v) return NaN; return parseFloat(String(v).replace(',', '.').trim()); }

/* ================= INDEXED DB (OFFLINE) ================= */
function openDB() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) { idbOk=false; resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const udb = e.target.result;
      if(!udb.objectStoreNames.contains('recetas')) udb.createObjectStore('recetas',{ keyPath:'id', autoIncrement:true }).createIndex('by_finca_oc', ['finca','oc'], { unique:true });
      if(!udb.objectStoreNames.contains('settings')) udb.createObjectStore('settings',{ keyPath:'key' });
      if(!udb.objectStoreNames.contains('catalogo')) udb.createObjectStore('catalogo',{keyPath:'producto'});
    };
    req.onsuccess = (e) => { db=e.target.result; resolve(db); };
    req.onerror = () => { idbOk=false; resolve(null); };
  });
}

const tx = (name, mode='readonly') => db.transaction(name, mode).objectStore(name);
const idbOp = (req) => new Promise((res, rej) => { req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });

async function getSetting(key) {
  if(!idbOk) return JSON.parse(localStorage.getItem(LS_KEYS.settings)||'{}')[key] || null;
  return (await idbOp(tx('settings').get(key)))?.value || null;
}
async function setSetting(key, val) {
  if(!idbOk) { const s=JSON.parse(localStorage.getItem(LS_KEYS.settings)||'{}'); s[key]=val; localStorage.setItem(LS_KEYS.settings, JSON.stringify(s)); return; }
  await idbOp(tx('settings','readwrite').put({key, value:val}));
}
async function catAll() { return idbOk ? new Promise(r=>{const a=[]; tx('catalogo').openCursor().onsuccess=e=>{const c=e.target.result; c?(a.push(c.value),c.continue()):r(a)}}) : JSON.parse(localStorage.getItem(LS_KEYS.catalogo)||'[]'); }

/* ================= LÓGICA DE NEGOCIO ================= */
// 1. Consecutivos
async function getNextOCForFinca(finca) {
  const map = (await getSetting(NEXT_MAP_KEY)) || {};
  return Number(map[String(finca).trim().toUpperCase()] || 1);
}
async function setNextOCForFinca(finca, n) {
  const map = (await getSetting(NEXT_MAP_KEY)) || {};
  map[String(finca).trim().toUpperCase()] = Math.max(1, Number(n)||1);
  await setSetting(NEXT_MAP_KEY, map);
}
function displayOC(finca, oc) { return (finca && oc) ? `${finca}-${oc}` : (oc || '—'); }

async function recomputeAllFincasNextOC(){
  const all = await listRecetas();
  const groups = {};
  all.forEach(r => {
    const k = String(r.finca||'').trim().toUpperCase();
    const v = Number((r.oc||'').replace(/^0+/,''))||0;
    groups[k] = Math.max(groups[k]||0, v);
  });
  const map = (await getSetting(NEXT_MAP_KEY)) || {};
  for(const k in groups) { if(groups[k]+1 > (map[k]||1)) map[k] = groups[k]+1; }
  await setSetting(NEXT_MAP_KEY, map);
}

// 2. Cálculos de Dosis
function parseQuantity(q) {
  if(!q) return {value:NaN, unit:'', kind:'liquid'};
  const s = q.toLowerCase().replace(',', '.');
  const raw = parseFloat(s.match(/([-+]?\d*\.?\d+)/)?.[1]);
  let unit = /\bml\b/.test(s)?'ml' : /\bl|litro/.test(s)?'L' : /\bkg\b/.test(s)?'kg' : /\bg\b/.test(s)?'g' : 'L';
  const kind = (unit==='ml'||unit==='L')?'liquid':'solid';
  let base = raw;
  if(unit==='L'||unit==='kg') base *= 1000; // Normalizar a ml/g base
  return {value:base, unit, kind};
}

function recalcDosisMaquinada() {
  const volMaq = num($('#volumenMaquinaria').value);
  const volApl = num($('#volumenAplicacion').value);
  const factor = (volMaq && volApl) ? volMaq/volApl : 0;
  
  $('#factorChip').textContent = factor ? `Factor: ${factor.toFixed(2)}` : 'Factor: —';

  $$('#items tbody tr').forEach(tr => {
    const inHa = tr.querySelector('.it-dosisHa').value;
    const outField = tr.querySelector('.it-dosisMaquinada');
    const pres = tr.querySelector('.it-presentacion').value.toLowerCase();
    
    if(!factor || !inHa) { outField.value = ''; return; }
    
    const q = parseQuantity(inHa);
    if(isNaN(q.value)) return;

    let total = q.value * factor; // Total en ml o g
    
    // Formatear salida inteligente
    let outUnit = q.kind === 'liquid' ? 'ml' : 'g';
    if(pres.includes('l') || pres.includes('litro')) outUnit = 'L';
    if(pres.includes('kg')) outUnit = 'kg';

    if(outUnit === 'L' || outUnit === 'kg') total /= 1000;
    
    outField.value = `${parseFloat(total.toFixed(2))} ${outUnit}`;
  });
}

// 3. Gestión de Items UI
function addItem(prefill={}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="tbl-input it-producto" list="dlProductos" placeholder="Producto" value="${prefill.producto||''}"></td>
    <td><input class="tbl-input it-ia" placeholder="Ing. Activo" value="${prefill.ingredienteActivo||''}"></td>
    <td><input class="tbl-input it-presentacion" placeholder="Unid." value="${prefill.presentacion||''}"></td>
    <td><input class="tbl-input it-dosisHa" type="text" placeholder="Dosis/ha" value="${prefill.dosisHa||''}"></td>
    <td><input class="tbl-input it-dosisMaquinada" readonly tabindex="-1"></td>
    <td><input class="tbl-input it-obs" placeholder="..." value="${prefill.obs||''}"></td>
    <td class="no-print"><button class="btn small danger btnDel">×</button></td>`;
  
  tr.querySelector('.btnDel').onclick = () => { tr.remove(); recalcDosisMaquinada(); };
  ['input','change'].forEach(ev => tr.addEventListener(ev, (e) => {
    if(e.target.matches('.it-dosisHa, .it-presentacion')) recalcDosisMaquinada();
    if(e.target.matches('.it-producto') && ev === 'change') autoFillProduct(e.target);
  }));
  $('#items tbody').appendChild(tr);
  recalcDosisMaquinada();
}

async function autoFillProduct(input) {
  const hit = (await catAll()).find(x => x.producto.toLowerCase() === input.value.trim().toLowerCase());
  if(hit) {
    const tr = input.closest('tr');
    if(!tr.querySelector('.it-ia').value) tr.querySelector('.it-ia').value = hit.ia||'';
    if(!tr.querySelector('.it-presentacion').value) tr.querySelector('.it-presentacion').value = hit.presentacion||'';
    if(!tr.querySelector('.it-dosisHa').value) tr.querySelector('.it-dosisHa').value = hit.dosisHa||'';
    recalcDosisMaquinada();
  }
}

function readItems() {
  return $$('#items tbody tr').map(tr => ({
    producto: tr.querySelector('.it-producto').value.trim(),
    ingredienteActivo: tr.querySelector('.it-ia').value.trim(),
    presentacion: tr.querySelector('.it-presentacion').value.trim(),
    dosisHa: tr.querySelector('.it-dosisHa').value.trim(),
    dosisMaquinada: tr.querySelector('.it-dosisMaquinada').value.trim(),
    obs: tr.querySelector('.it-obs').value.trim(),
  })).filter(x => x.producto);
}

/* ================= CRUD & SYNC ================= */
async function saveReceta() {
  const data = getFormData();
  if(!data.finca) return alert('Falta FINCA');
  
  // Generar OC si es nueva
  let ocNum = Number(data.oc.replace(/^0+/,'')) || 0;
  if(ocNum <= 0) {
    await recomputeAllFincasNextOC(); // Asegurar consistencia
    ocNum = await getNextOCForFinca(data.finca);
    data.oc = String(ocNum).padStart(6,'0');
    // Actualizar contador
    await setNextOCForFinca(data.finca, ocNum + 1);
  }

  // Guardar Local
  if(idbOk) await idbOp(tx('recetas','readwrite').put(data));
  else {
    const ls = JSON.parse(localStorage.getItem(LS_KEYS.recetas)||'[]');
    ls.push({...data, id: Date.now()}); 
    localStorage.setItem(LS_KEYS.recetas, JSON.stringify(ls));
  }

  // Actualizar UI
  $('#oc').value = data.oc;
  $('#ocVisible').textContent = displayOC(data.finca, data.oc);
  
  // Aprender productos nuevos
  data.items.forEach(it => {
    if(idbOk) tx('catalogo','readwrite').put({producto:it.producto, ia:it.ingredienteActivo, presentacion:it.presentacion, dosisHa:it.dosisHa});
  });

  alert('Guardado localmente. Sync en segundo plano...');
  syncToCloud(data);
}

async function listRecetas() {
  if(!idbOk) return JSON.parse(localStorage.getItem(LS_KEYS.recetas)||'[]');
  return new Promise(r => { 
      const res = []; 
      tx('recetas').openCursor().onsuccess = e => {
          const c = e.target.result;
          if(c) { res.push(c.value); c.continue(); } else r(res);
      }
  });
}

async function syncToCloud(rec) {
  const { data: { session } } = await supa.auth.getSession();
  if(!session) return setStatus('cloud', 'Offline', '#94a3b8');
  
  setStatus('cloud', 'Subiendo...', '#38bdf8');
  try {
    const payload = {
      owner_id: session.user.id,
      oc: rec.oc, fecha: rec.fecha, finca: rec.finca, cultivo: rec.cultivo, manejo: rec.manejo,
      tecnico: rec.tecnico, tractorista: rec.tractorista, tractor: rec.tractor,
      maquinaria: rec.maquinaria, vol_maquinaria: num(rec.volumenMaquinaria), vol_aplicacion: num(rec.volumenAplicacion),
      cuartel: rec.cuartel, indicaciones: rec.indicaciones, updated_at: new Date().toISOString()
    };

    const { data: up, error } = await supa.from('order_cura').upsert(payload, { onConflict: 'owner_id,finca,oc' }).select().single();
    if(error) throw error;

    // Items
    await supa.from('order_item').delete().eq('order_id', up.id);
    if(rec.items.length) {
      const itemsPayload = rec.items.map(it => ({
        order_id: up.id, producto: it.producto, ia: it.ingredienteActivo, presentacion: it.presentacion,
        dosis_ha: it.dosisHa, dosis_maquinada: it.dosisMaquinada, obs: it.obs
      }));
      await supa.from('order_item').insert(itemsPayload);
    }
    setStatus('cloud', 'Sincronizado', '#22c55e');
  } catch (e) {
    console.error(e);
    setStatus('cloud', 'Error Sync', '#ef4444');
  }
}

/* ================= UI EVENTS & UTIL ================= */
function getFormData() {
  return {
    id: $('#oc').dataset.id ? Number($('#oc').dataset.id) : undefined,
    oc: $('#oc').value, fecha: $('#fecha').value, finca: $('#finca').value,
    cultivo: $('#cultivo').value, manejo: $('#manejo').value, tecnico: $('#tecnico').value,
    tractorista: $('#tractorista').value, tractor: $('#tractor').value,
    maquinaria: $('#maquinaria').value, volumenMaquinaria: $('#volumenMaquinaria').value,
    volumenAplicacion: $('#volumenAplicacion').value, cuartel: $('#cuartel').value,
    indicaciones: $('#indicaciones').value, items: readItems(),
    updated_at: new Date().toISOString()
  };
}

function setForm(r) {
  $('#oc').value = r.oc||''; $('#fecha').value = r.fecha||todayISO();
  $('#finca').value = r.finca||''; $('#cultivo').value = r.cultivo||'';
  $('#manejo').value = r.manejo||''; $('#tecnico').value = r.tecnico||'';
  $('#tractorista').value = r.tractorista||''; $('#tractor').value = r.tractor||'';
  $('#maquinaria').value = r.maquinaria||''; $('#volumenMaquinaria').value = r.volumenMaquinaria||'';
  $('#volumenAplicacion').value = r.volumenAplicacion||''; $('#cuartel').value = r.cuartel||'';
  $('#indicaciones').value = r.indicaciones||'';
  $('#items tbody').innerHTML = '';
  (r.items||[]).forEach(addItem);
  $('#ocVisible').textContent = displayOC(r.finca, r.oc);
  if(r.id) $('#oc').dataset.id = r.id;
  
  if(r.manejo === 'Orgánico') document.body.classList.add('organic');
  else document.body.classList.remove('organic');
  recalcDosisMaquinada();
}

function setStatus(type, text, color) {
  const el = type==='cloud'?$('#cloudStatus'):$('#storageStatus');
  el.textContent = text; el.style.background = color;
}

// Event Listeners
$('#btnNueva').onclick = () => { 
    setForm({items:[]}); 
    $('#oc').value=''; $('#oc').dataset.id=''; 
    $('#ocVisible').textContent='—'; 
};
$('#btnGuardar').onclick = saveReceta;
$('#addItem').onclick = () => addItem();
$('#clearItems').onclick = () => { $('#items tbody').innerHTML=''; addItem(); };
$('#finca').onchange = async (e) => {
    const n = await getNextOCForFinca(e.target.value);
    $('#oc').value = String(n).padStart(6,'0');
    $('#ocVisible').textContent = displayOC(e.target.value, $('#oc').value);
};
$('#manejo').onchange = (e) => {
    if(e.target.value === 'Orgánico') document.body.classList.add('organic');
    else document.body.classList.remove('organic');
};
// BOTÓN MANUAL SYNC
$('#btnSync').onclick = async () => {
    showLoading(); // Mostramos el spinner
    try {
        // Intenta subir los datos que hay en pantalla
        await syncToCloud(getFormData());
        // Forzamos un pequeño retardo para que se vea la animación
        setTimeout(() => {
            hideLoading();
            alert('Sincronización completada correctamente.');
        }, 500);
    } catch (e) {
        hideLoading();
        // Si falla (ej. sin internet), no pasa nada grave, el usuario ya ve el estado rojo
        alert('No se pudo sincronizar: ' + (e.message || 'Sin conexión'));
    }
};

// Imprimir
$('#btnPDF').onclick = () => {
  const d = getFormData();
  $('#metaBox').innerHTML = `
    <div><strong>OC:</strong> ${displayOC(d.finca, d.oc)}</div>
    <div><strong>Fecha:</strong> ${d.fecha}</div>
    <div><strong>Finca:</strong> ${d.finca} (${d.cuartel})</div>
    <div><strong>Tractor:</strong> ${d.tractor} (${d.tractorista})</div>
    <div><strong>Vol. Maq:</strong> ${d.volumenMaquinaria}L</div>
  `;
  const tbody = $('#printTable tbody'); tbody.innerHTML='';
  d.items.forEach(it => {
    tbody.innerHTML += `<tr><td>${it.producto}</td><td>${it.ingredienteActivo}</td><td>${it.presentacion}</td><td>${it.dosisMaquinada}</td><td>${it.obs}</td></tr>`;
  });
  $('#printIndicaciones').textContent = d.indicaciones;
  window.print();
};

// Login Magic Link
$('#btnLogin').onclick = () => $('#loginModal').classList.add('open');
$('#btnCloseLogin').onclick = () => $('#loginModal').classList.remove('open');
$('#btnSendMagicLink').onclick = async () => {
    const email = $('#loginEmail').value;
    const { error } = await supa.auth.signInWithOtp({ email });
    alert(error ? error.message : 'Revisa tu correo!');
    if(!error) $('#loginModal').classList.remove('open');
};

/* ================= INIT ================= */
(async function() {
  await openDB();
  setStatus('storage', idbOk?'IndexedDB OK':'Modo Fallback (LocalStorage)', idbOk?'#22c55e':'#f59e0b');
  
  if(!$('#fecha').value) $('#fecha').value = todayISO();
  addItem(); // Fila vacía inicial
  
  // Refrescar Datalist
  const prods = await catAll();
  $('#dlProductos').innerHTML = prods.map(p => `<option value="${p.producto}">`).join('');

  // Check Auth
  const { data: { session } } = await supa.auth.getSession();
  if(session) { 
      setStatus('cloud', 'Online', '#22c55e');
      $('#btnLogin').style.display='none'; $('#btnLogout').style.display='';
  }
})();
