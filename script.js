/* ================= CONFIGURACIÓN ================= */
const SUPABASE_URL = "https://tqaidimwfhlklkhsgtam.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxYWlkaW13Zmhsa2xraHNndGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1ODc3MjksImV4cCI6MjA4MDE2MzcyOX0.FuuvVxuKqaGR_9q_aB1-OaCf-gIFbTE7U-i4I__Ti0Q";

const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const DB_NAME = 'RecetaDigitalDB';
const DB_VERSION = 11;
const LS_KEYS = { settings:'receta_settings', recetas:'receta_items', catalogo:'receta_catalogo' };

let db = null;
let idbOk = true;

/* ================= HELPERS DOM ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function todayISO() { const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function num(v) { if(!v) return NaN; return parseFloat(String(v).replace(',', '.').trim()); }
function showLoading() { $('#loadingModal').classList.add('open'); }
function hideLoading() { $('#loadingModal').classList.remove('open'); }

/* ================= INDEXED DB (LOCAL) ================= */
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
    req.onsuccess = (e) => { 
        db=e.target.result; 
        db.onversionchange = () => { db.close(); alert("Nueva versión. Recargando..."); window.location.reload(); };
        resolve(db); 
    };
    req.onerror = () => { idbOk=false; resolve(null); };
  });
}
const tx = (name, mode='readonly') => db.transaction(name, mode).objectStore(name);
const idbOp = (req) => new Promise((res, rej) => { req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });

async function catAll() { return idbOk ? new Promise(r=>{const a=[]; tx('catalogo').openCursor().onsuccess=e=>{const c=e.target.result; c?(a.push(c.value),c.continue()):r(a)}}) : JSON.parse(localStorage.getItem(LS_KEYS.catalogo)||'[]'); }

/* ================= LÓGICA DE NEGOCIO ================= */

// Cálculo en tiempo real del próximo número (Sin caché)
async function sugerirProximoOC(finca) {
  if (!finca) return '';
  const todas = await listRecetas(); 
  const deEstaFinca = todas.filter(r => r.finca === finca);
  
  let maximo = 0;
  deEstaFinca.forEach(r => {
    const n = parseInt(r.oc, 10);
    if (!isNaN(n) && n > maximo) maximo = n;
  });

  return String(maximo + 1).padStart(6, '0');
}

function displayOC(finca, oc) { return (finca && oc) ? `${finca}-${oc}` : (oc || '—'); }

function parseQuantity(q) {
  if(!q) return {value:NaN, unit:'', kind:'liquid'};
  const s = q.toLowerCase().replace(',', '.');
  const raw = parseFloat(s.match(/([-+]?\d*\.?\d+)/)?.[1]);
  let unit = /\bml\b/.test(s)?'ml' : /\bl|litro/.test(s)?'L' : /\bkg\b/.test(s)?'kg' : /\bg\b/.test(s)?'g' : 'L';
  const kind = (unit==='ml'||unit==='L')?'liquid':'solid';
  let base = raw;
  if(unit==='L'||unit==='kg') base *= 1000;
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
    let total = q.value * factor;
    let outUnit = q.kind === 'liquid' ? 'ml' : 'g';
    if(pres.includes('l') || pres.includes('litro')) outUnit = 'L';
    if(pres.includes('kg')) outUnit = 'kg';
    if(outUnit === 'L' || outUnit === 'kg') total /= 1000;
    outField.value = `${parseFloat(total.toFixed(2))} ${outUnit}`;
  });
}

function addItem(prefill={}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="tbl-input it-producto" list="dlProductos" placeholder="Prod" value="${prefill.producto||''}"></td>
    <td><input class="tbl-input it-ia" placeholder="IA" value="${prefill.ingredienteActivo||''}"></td>
    <td><input class="tbl-input it-presentacion" placeholder="Unid" value="${prefill.presentacion||''}"></td>
    <td><input class="tbl-input it-dosisHa" placeholder="Dosis/ha" value="${prefill.dosisHa||''}"></td>
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
  showLoading();

  try {
    // 1. Generar OC si es nueva o 0
    let ocNum = Number(data.oc.replace(/^0+/,'')) || 0;
    if(ocNum <= 0) {
      const next = await sugerirProximoOC(data.finca);
      data.oc = next;
    }

    // 2. Guardar en IDB
    if(idbOk) {
       // Si no tiene ID, lo borramos para que IDB genere uno
       if (!data.id) delete data.id;
       const res = await idbOp(tx('recetas','readwrite').put(data));
       if(!data.id) data.id = res; 
    } else {
      const ls = JSON.parse(localStorage.getItem(LS_KEYS.recetas)||'[]');
      if(!data.id) data.id = Date.now();
      ls.push(data); 
      localStorage.setItem(LS_KEYS.recetas, JSON.stringify(ls));
    }

    // 3. Actualizar UI
    $('#oc').value = data.oc;
    $('#ocVisible').textContent = displayOC(data.finca, data.oc);
    if(data.id) $('#oc').dataset.id = data.id;
    
    // 4. Aprender productos
    data.items.forEach(it => {
      if(idbOk) tx('catalogo','readwrite').put({producto:it.producto, ia:it.ingredienteActivo, presentacion:it.presentacion, dosisHa:it.dosisHa});
    });

    // 5. Sync Nube
    await syncToCloud(data);

    hideLoading();
    // Bloqueamos la orden recién guardada para que no se edite
    setForm(data);

  } catch (error) {
    hideLoading();
    console.error(error);
    alert('Guardado en local, pero error en nube: ' + error.message);
  }
}

async function syncToCloud(rec) {
  const { data: { session } } = await supa.auth.getSession();
  if(!session) {
    setStatus('cloud', 'Offline (Sin Login)', '#94a3b8');
    return;
  }
  
  setStatus('cloud', 'Subiendo...', '#38bdf8');

  // A. SUBIR
  const payload = {
    owner_id: session.user.id,
    oc: rec.oc, fecha: rec.fecha, finca: rec.finca, cultivo: rec.cultivo, manejo: rec.manejo,
    tecnico: rec.tecnico, tractorista: rec.tractorista, tractor: rec.tractor,
    maquinaria: rec.maquinaria, 
    vol_maquinaria: num(rec.volumenMaquinaria), 
    vol_aplicacion: num(rec.volumenAplicacion),
    cuartel: rec.cuartel, indicaciones: rec.indicaciones, 
    updated_at: new Date().toISOString()
  };

  const { data: up, error } = await supa.from('order_cura').upsert(payload, { onConflict: 'owner_id,finca,oc' }).select().single();
  if(error) throw error;

  await supa.from('order_item').delete().eq('order_id', up.id);
  if(rec.items.length) {
    const itemsPayload = rec.items.map(it => ({
      order_id: up.id, producto: it.producto, ia: it.ingredienteActivo, presentacion: it.presentacion,
      dosis_ha: it.dosisHa, dosis_maquinada: it.dosisMaquinada, obs: it.obs
    }));
    await supa.from('order_item').insert(itemsPayload);
  }

  // B. BAJAR
  setStatus('cloud', 'Descargando...', '#38bdf8');
  await downloadFromCloud();
  setStatus('cloud', 'Sincronizado', '#22c55e');
}

async function downloadFromCloud() {
  const { data: orders, error } = await supa.from('order_cura').select('*, order_item(*)');
  if(error) { console.error("Error bajando:", error); return; }
  if(!orders || orders.length === 0) return;

  const currentLocals = await listRecetas();
  const mapLocals = new Map();
  currentLocals.forEach(r => mapLocals.set(`${r.finca}|${r.oc}`, r.id));

  const txRW = db.transaction('recetas', 'readwrite');
  const store = txRW.objectStore('recetas');

  orders.forEach(o => {
    const key = `${o.finca}|${o.oc}`;
    const existingId = mapLocals.get(key);

    const localFormat = {
      owner_id: o.owner_id,
      oc: o.oc, fecha: o.fecha, finca: o.finca, cultivo: o.cultivo, manejo: o.manejo,
      tecnico: o.tecnico, tractorista: o.tractorista, tractor: o.tractor,
      maquinaria: o.maquinaria, 
      volumenMaquinaria: o.vol_maquinaria, 
      volumenAplicacion: o.vol_aplicacion,
      cuartel: o.cuartel, indicaciones: o.indicaciones,
      updated_at: o.updated_at,
      items: (o.order_item || []).map(it => ({
          producto: it.producto, ingredienteActivo: it.ia, presentacion: it.presentacion,
          dosisHa: it.dosis_ha, dosisMaquinada: it.dosis_maquinada, obs: it.obs
      }))
    };

    // Validación de ID para evitar errores "DataError"
    if (existingId && typeof existingId === 'number' && !isNaN(existingId)) {
      localFormat.id = existingId;
    } else {
      delete localFormat.id; // Deja que IDB cree uno nuevo
    }
    
    store.put(localFormat);
  });

  return new Promise((resolve, reject) => {
    txRW.oncomplete = () => resolve();
    txRW.onerror = () => reject(txRW.error);
  });
}

/* ================= BUSCADOR & EXPORTACIÓN ================= */
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

async function renderListado() {
    const tbody = $('#tablaListado tbody');
    tbody.innerHTML = '<tr><td colspan="4">Cargando...</td></tr>';
    
    let lista = await listRecetas();
    const q = $('#q').value.toLowerCase();
    
    if(q) {
        lista = lista.filter(r => 
            (r.finca||'').toLowerCase().includes(q) || 
            (r.oc||'').includes(q) ||
            (r.cultivo||'').toLowerCase().includes(q)
        );
    }
    lista.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

    tbody.innerHTML = '';
    if(lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No hay órdenes.</td></tr>';
        return;
    }

    lista.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${displayOC(r.finca, r.oc)}</td>
            <td>${r.fecha}</td>
            <td>${r.finca}</td>
            <td><button class="btn small primary btnCargar" data-id="${r.id}">Abrir</button></td>
        `;
        tr.querySelector('.btnCargar').onclick = () => {
            setForm(r);
            $('#modalListado').classList.remove('open');
        };
        tbody.appendChild(tr);
    });
}

async function exportToCSV() {
  const recipes = await listRecetas();
  if (!recipes || recipes.length === 0) return alert('No hay datos guardados.');

  let csvContent = "\uFEFF"; // BOM
  csvContent += "Fecha;OC;Finca;Cultivo;Manejo;Tractor;Tractorista;Vol.Maq;Producto;Ing.Activo;Presentacion;Dosis/Ha;Dosis/Maq;Obs\n";

  recipes.forEach(r => {
    const clean = (txt) => String(txt || '').replace(/;/g, ' ').replace(/\n/g, ' ').trim();
    if (!r.items || r.items.length === 0) {
       csvContent += `${r.fecha};${clean(r.oc)};${clean(r.finca)};${clean(r.cultivo)};${clean(r.manejo)};${clean(r.tractor)};${clean(r.tractorista)};${r.volumenMaquinaria};-;-;-;-;-;-\n`;
    } else {
       r.items.forEach(item => {
         csvContent += `${r.fecha};${clean(r.oc)};${clean(r.finca)};${clean(r.cultivo)};${clean(r.manejo)};${clean(r.tractor)};${clean(r.tractorista)};${r.volumenMaquinaria};${clean(item.producto)};${clean(item.ingredienteActivo)};${clean(item.presentacion)};${clean(item.dosisHa)};${clean(item.dosisMaquinada)};${clean(item.obs)}\n`;
       });
    }
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Reporte_Ordenes_${todayISO()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ================= GESTIÓN DE CATÁLOGO ================= */
async function renderCatalogList() {
    const listDiv = $('#listaCatalogo');
    const filter = $('#qCat').value.toLowerCase();
    
    listDiv.innerHTML = '<div style="padding:20px; text-align:center">Cargando...</div>';
    const all = await catAll();
    const filtered = all.filter(p => p.producto.toLowerCase().includes(filter)).sort((a,b) => a.producto.localeCompare(b.producto));

    listDiv.innerHTML = '';
    if (filtered.length === 0) {
        listDiv.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8">No hay productos.</div>';
        return;
    }

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = 'cat-item';
        div.innerHTML = `
            <div>
                <div class="cat-name">${p.producto}</div>
                <div class="cat-info">${p.ia || '-'} | ${p.dosisHa || '-'}</div>
            </div>
            <button class="btn-trash" title="Borrar">🗑️</button>
        `;
        div.querySelector('.btn-trash').onclick = async () => {
            if(confirm(`¿Borrar "${p.producto}"?`)) {
                await deleteProduct(p.producto);
                renderCatalogList();
                refreshGlobalDatalist();
            }
        };
        listDiv.appendChild(div);
    });
}

async function deleteProduct(name) {
    if(idbOk) await idbOp(tx('catalogo', 'readwrite').delete(name));
    else {
        let arr = JSON.parse(localStorage.getItem(LS_KEYS.catalogo)||'[]');
        arr = arr.filter(x => x.producto !== name);
        localStorage.setItem(LS_KEYS.catalogo, JSON.stringify(arr));
    }
}

async function refreshGlobalDatalist() {
    const prods = await catAll();
    $('#dlProductos').innerHTML = prods.map(p => `<option value="${p.producto}">`).join('');
}

/* ================= EVENTOS DE BOTONES ================= */
function getFormData() {
  let rawId = $('#oc').dataset.id;
  let safeId = undefined;
  if (rawId && !isNaN(rawId) && Number(rawId) > 0) safeId = Number(rawId);

  return {
    id: safeId,
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
  
  if(r.id) $('#oc').dataset.id = r.id; else delete $('#oc').dataset.id;
  if(r.owner_id) $('#oc').dataset.owner = r.owner_id; else delete $('#oc').dataset.owner;

  if(r.manejo === 'Orgánico') document.body.classList.add('organic'); else document.body.classList.remove('organic');
  recalcDosisMaquinada();

  if (r.id) {
      $$('input, select, textarea').forEach(el => el.disabled = true);
      $('#btnGuardar').style.display = 'none';
      $('#addItem').style.display = 'none';
      $('#clearItems').style.display = 'none';
      $$('.btnDel').forEach(b => b.style.display = 'none');
      $('#ocVisible').innerHTML = `${displayOC(r.finca, r.oc)} <span style="color:#ef4444; font-size:0.8em; margin-left:5px">🔒 CERRADA</span>`;
  } else {
      desbloquearFormulario();
  }
}

function desbloquearFormulario() {
    $$('input, select, textarea').forEach(el => el.disabled = false);
    $('#oc').readOnly = true; 
    $('#btnGuardar').style.display = ''; 
    $('#addItem').style.display = '';
    $('#clearItems').style.display = '';
}

function setStatus(type, text, color) {
  const el = type==='cloud'?$('#cloudStatus'):$('#storageStatus');
  el.textContent = text; el.style.background = color;
}

// 1. NUEVA
$('#btnNueva').onclick = async () => { 
    setForm({items:[]}); 
    desbloquearFormulario();
    $('#oc').value=''; 
    delete $('#oc').dataset.id; 
    delete $('#oc').dataset.owner;
    $('#ocVisible').textContent='—'; 
    const finca = $('#finca').value;
    if(finca) {
        const next = await sugerirProximoOC(finca);
        $('#oc').value = next;
        $('#ocVisible').textContent = displayOC(finca, next);
    }
};

// 2. GUARDAR
$('#btnGuardar').onclick = async () => {
    if(!$('#finca').value) return alert('⚠️ Seleccioná FINCA');
    if(!$('#cultivo').value) return alert('⚠️ Seleccioná CULTIVO');
    const { data: { session } } = await supa.auth.getSession();
    const ownerDeLaOrden = $('#oc').dataset.owner;
    if (ownerDeLaOrden && session && ownerDeLaOrden !== session.user.id) return alert("⛔ No autorizado.");
    await saveReceta();
};

// 3. SYNC MANUAL
$('#btnSync').onclick = async () => {
    showLoading();
    try {
        const hayDatos = $('#finca').value;
        const esNueva = !$('#oc').dataset.id;
        if(hayDatos && esNueva) await syncToCloud(getFormData());
        else {
             setStatus('cloud', 'Descargando...', '#38bdf8');
             await downloadFromCloud();
             setStatus('cloud', 'Sincronizado', '#22c55e');
        }
        setTimeout(() => { hideLoading(); alert('✅ Sincronización completa.'); }, 500);
    } catch(e) {
        hideLoading();
        alert('❌ Error: ' + e.message);
    }
};

// 4. ITEMS & CAMBIOS
$('#addItem').onclick = () => addItem();
$('#clearItems').onclick = () => { $('#items tbody').innerHTML=''; addItem(); };
$('#finca').onchange = async (e) => { 
    const n = await sugerirProximoOC(e.target.value); 
    $('#oc').value = n; 
    $('#ocVisible').textContent = displayOC(e.target.value, n); 
};
$('#manejo').onchange = (e) => { if(e.target.value === 'Orgánico') document.body.classList.add('organic'); else document.body.classList.remove('organic'); };

// 5. LISTADO
$('#btnListado').onclick = () => { $('#modalListado').classList.add('open'); renderListado(); };
$('#btnCerrarListado').onclick = () => $('#modalListado').classList.remove('open');
$('#q').addEventListener('input', renderListado);

// 6. PDF (Diseño Final Limpio - Bodega Salentein)
$('#btnPDF').onclick = () => {
  const d = getFormData();
  
  if(!d.finca) return alert('Seleccioná una finca para imprimir.');

  // A. Inyectar Cabecera
  $('#metaBox').innerHTML = `
    <style>
      /* Título Principal (Afuera de la grilla) */
      .salentein-title {
          text-align: center;
          font-size: 22px;
          font-weight: bold;
          text-transform: uppercase;
          text-decoration: underline;
          margin-bottom: 30px;
          font-family: Arial, sans-serif;
      }
      
      /* Grilla de 2 columnas */
      .foa-grid { 
          display: grid; 
          grid-template-columns: 1fr 1fr; /* Mitad y mitad */
          gap: 60px; /* Separación amplia en el centro */
          font-family: Arial, sans-serif;
          font-size: 13px;
          margin-bottom: 20px;
      }

      /* Cada fila de datos */
      .data-row { 
          display: flex; 
          justify-content: space-between; /* Etiqueta a la izq, Valor a la der */
          border-bottom: 1px solid #999; /* Línea de renglón */
          padding-bottom: 4px;
          margin-bottom: 12px; /* Espacio vertical entre renglones */
          align-items: flex-end;
      }

      .lbl { font-weight: 900; text-transform: uppercase; color: #000; font-size: 11px; }
      .val { font-weight: 600; color: #222; text-align: right; font-size: 14px; }
    </style>

    <div class="salentein-title">ORDEN DE CURA - BODEGA SALENTEIN</div>

    <div class="foa-grid">
        <div>
            <div class="data-row">
                <span class="lbl">OC:</span> 
                <span class="val">${displayOC(d.finca, d.oc)}</span>
            </div>
            <div class="data-row">
                <span class="lbl">FINCA:</span> 
                <span class="val">${d.finca}</span>
            </div>
            <div class="data-row">
                <span class="lbl">CUARTEL:</span> 
                <span class="val">${d.cuartel || '-'}</span>
            </div>
            <div class="data-row">
                <span class="lbl">TRACTOR:</span> 
                <span class="val">${d.tractor || '-'}</span>
            </div>
            <div class="data-row">
                <span class="lbl" style="background:#eee; padding:0 3px;">IMPLEMENTO:</span> 
                <span class="val">${d.maquinaria || '-'}</span>
            </div>
        </div>

        <div>
            <div class="data-row">
                <span class="lbl">FECHA:</span> 
                <span class="val">${d.fecha.split('-').reverse().join('/')}</span>
            </div>
            <div class="data-row">
                <span class="lbl">RESPONSABLE:</span> 
                <span class="val">${d.tractorista || '-'}</span>
            </div>
             <div class="data-row">
                <span class="lbl">VOL. MAQ:</span> 
                <span class="val">${d.volumenMaquinaria ? d.volumenMaquinaria + ' L' : '-'}</span>
            </div>
            <div class="data-row">
                <span class="lbl">VOL. APLICACIÓN:</span> 
                <span class="val">${d.volumenAplicacion ? d.volumenAplicacion + ' L/ha' : '-'}</span>
            </div>
             <div class="data-row">
                <span class="lbl">CULTIVO:</span> 
                <span class="val">${d.cultivo || '-'}</span>
            </div>
        </div>
    </div>
  `;

  // B. Inyectar Tabla
  const tbody = $('#printTable tbody'); 
  tbody.innerHTML = '';
  
  d.items.forEach(it => {
    tbody.innerHTML += `
      <tr style="border-bottom:1px solid #ccc;">
        <td style="padding:8px; font-weight:bold;">${it.producto}</td>
        <td style="padding:8px;">${it.ingredienteActivo || '-'}</td>
        <td style="text-align:center; padding:8px;">${it.presentacion || '-'}</td>
        <td style="font-size:0.9em; font-style:italic; padding:8px;">${it.obs || ''}</td>
        <td style="text-align:center; font-weight:bold; background:#f0f0f0; border-left:2px solid #000; font-size:1.1em;">${it.dosisMaquinada || '-'}</td>
      </tr>`;
  });

  // C. Inyectar Indicaciones
  const indicacionesDiv = $('#printIndicaciones');
  indicacionesDiv.innerHTML = d.indicaciones ? d.indicaciones : 'Sin indicaciones adicionales.';

  // D. Imprimir
  window.print();
};

// 7. EXCEL
$('#btnExcel').onclick = () => exportToCSV();

// 8. CATÁLOGO
$('#btnCatalogo').onclick = () => { $('#modalCatalogo').classList.add('open'); renderCatalogList(); };
$('#btnCloseCat').onclick = () => $('#modalCatalogo').classList.remove('open');
$('#qCat').addEventListener('input', renderCatalogList);

// 9. LOGIN (MODO OTP CÓDIGO)
$('#btnLogin').onclick = () => {
    $('#loginModal').classList.add('open');
    $('#loginStep1').style.display = 'block';
    $('#loginStep2').style.display = 'none';
    $('#loginEmail').value = '';
    $('#loginToken').value = '';
};
$('#btnCloseLogin').onclick = () => $('#loginModal').classList.remove('open');

$('#btnSendCode').onclick = async () => {
    const email = $('#loginEmail').value.trim();
    if(!email) return alert('Ingresá un email');
    const btn = $('#btnSendCode'); btn.textContent = 'Enviando...'; btn.disabled = true;
    const { error } = await supa.auth.signInWithOtp({ email });
    btn.textContent = 'Enviar Código'; btn.disabled = false;
    if(error) alert('Error: ' + error.message);
    else {
        $('#loginStep1').style.display = 'none';
        $('#loginStep2').style.display = 'block';
        $('#loginToken').focus();
    }
};

$('#btnVerifyCode').onclick = async () => {
    const email = $('#loginEmail').value.trim();
    const token = $('#loginToken').value.trim();
    if(!token) return alert('Ingresá el código');
    const { error } = await supa.auth.verifyOtp({ email, token, type: 'email' });
    if(error) alert('Código incorrecto.');
    else {
        alert('¡Bienvenido!');
        $('#loginModal').classList.remove('open');
        window.location.reload();
    }
};
$('#btnBackToEmail').onclick = () => { $('#loginStep1').style.display = 'block'; $('#loginStep2').style.display = 'none'; };

// 10. SALIR
$('#btnLogout').onclick = async () => {
    if(confirm('¿Cerrar sesión?')) {
        await supa.auth.signOut();
        window.location.reload();
    }
};

/* ================= INIT ================= */
(async function() {
  await openDB();
  setStatus('storage', idbOk?'Local OK':'LocalStorage', idbOk?'#22c55e':'#f59e0b');
  if(!$('#fecha').value) $('#fecha').value = todayISO();
  addItem(); 
  const prods = await catAll();
  $('#dlProductos').innerHTML = prods.map(p => `<option value="${p.producto}">`).join('');
  
  const { data: { session } } = await supa.auth.getSession();
  if(session) { 
      setStatus('cloud', 'Conectado', '#22c55e'); 
      $('#btnLogin').style.display='none'; 
      $('#btnLogout').style.display='inline-block'; 
  }
})();










