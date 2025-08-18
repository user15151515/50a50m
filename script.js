// ===== Intranet · Firestore (compat) – funciona amb file:// =====
// A l'HTML, assegura’t d’incloure AQUESTES línies ABANS d’aquest fitxer:
// <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js"></script>

const firebaseConfig = {
  apiKey: "AIzaSyBJYrC_AMd75DdAf9WUd_OGQ9FZ_w9GRXM",
  authDomain: "a50m-9bf6a.firebaseapp.com",
  projectId: "a50m-9bf6a",
  storageBucket: "a50m-9bf6a.firebasestorage.app",
  messagingSenderId: "354934277995",
  appId: "1:354934277995:web:a38327615be79f20eeae2e",
  measurementId: "G-LJEVSEGB2E"
};
if(!window.firebase){ alert("Falten els scripts compat de Firebase a l’HTML."); }
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const FV = firebase.firestore.FieldValue;

// ---------- Utils ----------
const EURO = new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const fmt = n => EURO.format(n || 0);
const todayISO = () => new Date().toISOString().slice(0,10);
const num = v => (isNaN(+v) ? 0 : +v);
const escapeHTML = s => (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const asHref = (s)=>{ const v=(s||'').trim(); if(!v) return ''; return /^https?:\/\//i.test(v)? v : 'https://' + v; };

// ---------- Estat ----------
const state = {
  packages: [],
  currentPkgId: null,
  sort: { key:'name', dir:1 },
  selectedDisplayMode: 'potential' // 'potential' | 'progress'
};
const itemUnsubs = new Map(); // listeners per paquet

// ---------- Seed (opcional) ----------
const AUTO_SEED = false;
const seedItems = [
  { name: 'Camiseta rallas hombro', cost: 7.23, price: 11.0, link: '', sold: false, dateSold: '' },
  { name: 'Vestido rombos naranja', cost: 7.51, price: 12.0, link: '', sold: false, dateSold: '' },
  { name: 'Top dorado brillo', cost: 7.01, price: 11.0, link: '', sold: false, dateSold: '' },
  { name: 'Top negro', cost: 5.92, price: 10.0, link: '', sold: false, dateSold: '' },
  { name: 'Camisa blanca y azul', cost: 10.2, price: 14.0, link: '', sold: false, dateSold: '' },
  { name: 'Camisa blanca fea', cost: 0.01, price: 5.0, link: '', sold: false, dateSold: '' },
  { name: 'Blusa negra agujeros', cost: 9.11, price: 13.0, link: '', sold: false, dateSold: '' },
  { name: 'Vestido carne blanco azul', cost: 7.23, price: 11.8, link: '', sold: false, dateSold: '' },
  { name: 'Top cruzado salmón', cost: 4.31, price: 8.5, link: '', sold: false, dateSold: '' },
  { name: 'Top tirantes azul', cost: 2.51, price: 6.0, link: '', sold: false, dateSold: '' },
  { name: 'Top floral granate', cost: 3.81, price: 7.0, link: '', sold: false, dateSold: '' },
  { name: 'Top floral blanc', cost: 4.98, price: 8.0, link: '', sold: false, dateSold: '' },
];
function seedIfEmpty(){
  if(!AUTO_SEED) return Promise.resolve();
  return db.collection('packages').get().then(snap=>{
    if(!snap.empty) return;
    return db.collection('packages').add({
      name:'Paquet 1', discount:15, shipping:0,
      createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
    }).then(async ref=>{
      for(const it of seedItems){
        await db.collection('packages').doc(ref.id).collection('items').add({
          ...it, createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
        });
      }
    });
  }).catch(()=>{});
}

// ---------- Càlculs ----------
function getCurrentPackage(){ return state.packages.find(p=>p.id===state.currentPkgId) || state.packages[0] || null; }
function computePackageMetrics(pkg){
  if(!pkg) return { itemsCost:0, pkgCost:0, revenueExp:0, revenueReal:0, costReal:0, shares:new Map() };
  const itemsCost = pkg.items.reduce((s,it)=> s+(it.cost||0), 0);
  const pkgCost   = itemsCost - (pkg.discount||0) + (pkg.shipping||0);
  const revenueExp= pkg.items.reduce((s,it)=> s+(it.price||0), 0);
  const shares = new Map(); // prorrateig del cost total
  for(const it of pkg.items){
    const w = itemsCost>0 ? (it.cost||0)/itemsCost : 0;
    shares.set(it.id, pkgCost*w);
  }
  let revenueReal = 0, costReal=0;
  for(const it of pkg.items) if(it.sold){ revenueReal += (it.price||0); costReal += (shares.get(it.id)||0); }
  return { itemsCost, pkgCost, revenueExp, revenueReal, costReal, shares };
}
function computeGlobalMetrics(){
  let totalPkgCost = 0, revenueReal = 0;
  for(const p of state.packages){
    const m = computePackageMetrics(p);
    totalPkgCost += m.pkgCost;
    for(const it of (p.items||[])) if(it.sold) revenueReal += (it.price||0);
  }
  return { profit: revenueReal - totalPkgCost };
}

// ---------- DOM ----------
const themeToggle = document.getElementById('themeToggle');
const pkgChips   = document.getElementById('pkgChips'); // si existeix
const pkgSelect  = document.getElementById('pkgSelect');
const addPkgBtn  = document.getElementById('addPkgBtn');
const renamePkgBtn = document.getElementById('renamePkgBtn');
const deletePkgBtn = document.getElementById('deletePkgBtn');

const summaryLabel  = document.getElementById('summaryLabel');
const summaryAmount = document.getElementById('summaryAmount');

const pkgTitle = document.getElementById('pkgTitle');
const kItemsCost = document.getElementById('kpiItemsCost');
const kPkgCost   = document.getElementById('kpiPkgCost');
const kRevenueExp= document.getElementById('kpiRevenueExp');
const kRevenueReal = document.getElementById('kpiRevenueReal');

const pkgDiscount = document.getElementById('pkgDiscount');
const pkgShipping = document.getElementById('pkgShipping');

const countLabel = document.getElementById('countLabel');
const tbody = document.getElementById('tbody');

const itemDialog = document.getElementById('itemDialog');
const modalTitle = document.getElementById('modalTitle');
const fName = document.getElementById('fName');
const fLink = document.getElementById('fLink');
const fCost = document.getElementById('fCost');
const fPrice = document.getElementById('fPrice');
const fSold = document.getElementById('fSold');
const fDate = document.getElementById('fDate');
const cancelItem = document.getElementById('cancelItem');
const saveItem = document.getElementById('saveItem');

const pkgProfitBadge  = document.getElementById('pkgProfitBadge');
const pkgProfitAmount = document.getElementById('pkgProfitAmount');

// ——— Snackbar Undo ———
const snack = document.getElementById('snackbar');
const snackMsg = document.getElementById('snackMsg');
const snackUndo = document.getElementById('snackUndo');
let snackTimer = null;
let lastUndo = null;

function showSnack(msg, undoFn){
  snackMsg.textContent = msg;
  lastUndo = undoFn || null;
  snack.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnack, 4000);
}
function hideSnack(){
  snack.classList.remove('show');
  lastUndo = null;
}
if (snackUndo){
  snackUndo.addEventListener('click', ()=>{
    if (lastUndo) lastUndo().catch(()=>{}).finally(hideSnack);
    else hideSnack();
  });
}


// ---------- Render ----------
function renderSummary(){
  const g = computeGlobalMetrics();
  const profit = g.profit;
  summaryAmount.textContent = fmt(profit);
  summaryLabel.textContent  = profit >= 0 ? 'Benefici' : 'Pèrdua';
  summaryLabel.classList.toggle('profit', profit>=0);
  summaryLabel.classList.toggle('loss', profit<0);
}

function renderPackageControls(){
  // Antic -> nou perquè els nous apareguin a la dreta
  const ordered = [...state.packages].sort(
    (a,b)=> (a.createdAt?.toMillis?.()||0) - (b.createdAt?.toMillis?.()||0)
  );

  if (pkgChips){
    pkgChips.innerHTML = '';
for (const p of ordered){
  const m = computePackageMetrics(p);
  const revenueExp = m.revenueExp || 0;
  const progress   = revenueExp > 0 ? (m.revenueReal / revenueExp) : 0; // reals / previstos
  const pct        = Math.max(0, Math.min(150, Math.round(progress * 100))); // capa 150%
  const potential  = (m.revenueExp - m.pkgCost);
  const dotClass   = potential >= 0 ? '' : 'neg';
  const isCurrent  = p.id === state.currentPkgId;

  // banda de color coherent
  const band = (pct < 50) ? 'low' : (pct < 100 ? 'mid' : 'win');

  // per defecte MOSTRA POTENCIAL, encara que no estigui seleccionat
  const mode = isCurrent ? (state.selectedDisplayMode || 'potential') : 'potential';
  const valueText = mode === 'potential' ? fmt(potential) : `${pct}%`;

  const title = isCurrent
    ? (mode==='potential'
        ? `Clica per veure progrés (%). Potencial: ${fmt(potential)}`
        : `Clica per veure potencial (€). Progrés: ${pct}%`)
    : `Canvia a aquest paquet`;

  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip pb ${band}${isCurrent ? ' active' : ''}`;
  b.dataset.id = p.id;
  b.title = title;

  b.innerHTML = `
    <span class="fill" style="--pct:${Math.min(pct,100)}%"></span>
    <span class="txt">
      <span class="pkg-name">${escapeHTML(p.name || 'Paquet')}</span>
      <span class="value mono">${valueText}</span>
      <i class="dot ${dotClass}" aria-hidden="true"></i>
    </span>
  `;
  pkgChips.appendChild(b);
}


    const add = document.createElement('button');
    add.type='button'; add.className='chip add'; add.id='chipAdd'; add.textContent='＋ Nou paquet';
    pkgChips.appendChild(add);
  }

  if (pkgSelect){
    pkgSelect.innerHTML = ordered
      .map(p=>`<option value="${p.id}">${escapeHTML(p.name||'Paquet')}</option>`)
      .join('');
    pkgSelect.value = state.currentPkgId || ordered[0]?.id || '';
  }
}


function renderKPIs(){
  const pkg = getCurrentPackage();
  if (!pkg) return;

  pkgTitle.textContent = pkg.name;

  const m = computePackageMetrics(pkg);

  // KPIs de la graella
  kItemsCost.textContent   = fmt(m.itemsCost);
  kPkgCost.textContent     = fmt(m.pkgCost);
  kRevenueExp.textContent  = fmt(m.revenueExp);
  kRevenueReal.textContent = fmt(m.revenueReal); // <-- nou “Ingressos reals”

  // Benefici/Pèrdua real del paquet (sota el títol)
  const profit = m.revenueReal - m.pkgCost; // pot ser negatiu
  pkgProfitAmount.textContent = fmt(profit);
  pkgProfitBadge.textContent  = profit >= 0 ? 'Benefici' : 'Pèrdua';
  pkgProfitBadge.classList.remove('profit','loss');
  pkgProfitBadge.classList.add(profit >= 0 ? 'profit' : 'loss');
}

function renderControls(){
  const pkg = getCurrentPackage(); if(!pkg) return;
  pkgDiscount.value = (Number(pkg.discount)||0).toFixed(2);
  pkgShipping.value = (Number(pkg.shipping)||0).toFixed(2);
}
function renderRows(){
  const pkg = getCurrentPackage();
  if(!pkg){ tbody.innerHTML=''; countLabel.textContent='0 productes'; return; }
  const m = computePackageMetrics(pkg);

  let rows = [...pkg.items];
  const {key, dir} = state.sort;
  rows.sort((a,b)=>{
    let va, vb;
    if(key==='margin'){ va=(a.price||0)-(m.shares.get(a.id)||0); vb=(b.price||0)-(m.shares.get(b.id)||0); }
    else { va=a[key]??''; vb=b[key]??''; }
    return (va<vb?-1:va>vb?1:0)*dir;
  });

  countLabel.textContent = `${rows.length} productes`;
  tbody.innerHTML='';
  for(const it of rows){
    const allocated = m.shares.get(it.id)||it.cost||0;
    const margin = (it.price||0)-allocated;
    const tr = document.createElement('tr');
    if(it.sold) tr.classList.add('sold');
    tr.innerHTML = `
      <td class="editable" data-field="name" data-id="${it.id}">
        ${
          (()=>{
            const href = asHref(it.link);
            return href
              ? `<a class="name-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(it.name)}</a>`
              : `<span class="name-link">${escapeHTML(it.name)}</span>`;
          })()
        }
      </td>
      <td class="right mono editable" data-field="cost" data-id="${it.id}">${fmt(it.cost)}</td>
      <td class="right mono editable" data-field="price" data-id="${it.id}">${fmt(it.price)}</td>
      <td class="right mono">${fmt(margin)}</td>
      <td data-field="sold" data-id="${it.id}">${it.sold? '<span class="pill ok">Venut</span>':'<span class="pill">Disponible</span>'}</td>
      <td class="mono editable" data-field="dateSold" data-id="${it.id}">${it.dateSold||''}</td>
      <td class="right"><div class="actions">
        <button class="btn ghost tiny" data-act="toggle" data-id="${it.id}">${it.sold? 'Desmarcar':'Marcar venut'}</button>
        <button class="btn bad tiny" data-act="del" data-id="${it.id}">Eliminar</button>
      </div></td>`;
    tbody.appendChild(tr);
  }

  // Accions fila
  tbody.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', ev=>{
      const {act,id} = btn.dataset;
      if(act==='toggle') toggleSold(id);
      else if(act==='del') deleteItem(id);
      ev.stopPropagation();
    });
  });
}
function renderAll(){ renderSummary(); renderPackageControls(); renderKPIs(); renderControls(); renderRows(); }

// ---------- Listeners Firestore ----------
let unsubPkgs = null;
function listenPackages(){
  if (unsubPkgs) unsubPkgs();
  seedIfEmpty().finally(()=>{
    unsubPkgs = db.collection('packages').orderBy('createdAt','asc').onSnapshot(snap=>{
      // conserva items que ja teníem (evita KPIs a 0 durant ms)
      const prev = new Map(state.packages.map(p => [p.id, p.items || []]));

      // tanca listeners d'items de paquets que ja no existeixen
      const newIds = new Set(snap.docs.map(d=>d.id));
      for (const [pkgId,unsub] of itemUnsubs.entries()){
        if (!newIds.has(pkgId)){ unsub(); itemUnsubs.delete(pkgId); }
      }

      // reconstrueix paquets reusant items anteriors
      state.packages = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || 'Paquet',
          discount: data.discount || 0,
          shipping: data.shipping || 0,
          items: prev.get(d.id) || []
        };
      });

      if (!state.currentPkgId || !state.packages.find(p=>p.id===state.currentPkgId)) {
        state.currentPkgId = state.packages[0]?.id || null;
      }

      // listeners d'items per a TOTS els paquets (resum global correcte)
      for (const p of state.packages){
        if (!itemUnsubs.has(p.id)){
          const unsub = db.collection('packages').doc(p.id).collection('items')
            .orderBy('createdAt','desc')
.onSnapshot(itemsSnap=>{
  const pkg = state.packages.find(x=>x.id===p.id);
  if (!pkg) return;
  pkg.items = itemsSnap.docs.map(it => ({ id: it.id, ...it.data() }));
  if (state.currentPkgId === p.id){ renderRows(); renderKPIs(); }
  renderSummary();
  renderPackageControls(); // refresca xips (barres + valor mostrant-se)
});



          itemUnsubs.set(p.id, unsub);
        }
      }

      renderPackageControls();
      renderSummary();
      renderKPIs();
      renderControls();
      renderRows();
    });
  });
}

// ---------- Paquets ----------
function addPackage(){
  const name = prompt('Nom del nou paquet:', `Paquet ${state.packages.length+1}`); if(!name) return;
  db.collection('packages').add({
    name: name.trim(), discount:0, shipping:0,
    createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
  }).then(ref=>{
    // selecciona immediatament el nou paquet i mostra 0 productes
    state.currentPkgId = ref.id;
    state.packages.push({ id: ref.id, name: name.trim(), discount:0, shipping:0, items:[] });
    renderPackageControls(); renderControls(); renderRows(); renderKPIs();
  });
}
function renamePackage(){
  const pkg = getCurrentPackage(); if(!pkg) return;
  const name = prompt('Nou nom del paquet:', pkg.name); if(!name) return;
  db.collection('packages').doc(pkg.id).update({ name:name.trim(), updatedAt:FV.serverTimestamp() });
}
function deletePackage(){
  const pkg = getCurrentPackage(); if(!pkg) return;
  if(!confirm('Eliminar el paquet actual?')) return;
  db.collection('packages').doc(pkg.id).collection('items').get().then(async snap=>{
    for(const d of snap.docs) await db.collection('packages').doc(pkg.id).collection('items').doc(d.id).delete();
    await db.collection('packages').doc(pkg.id).delete();
    const un = itemUnsubs.get(pkg.id); if(un){ un(); itemUnsubs.delete(pkg.id); }
    state.currentPkgId = state.packages.find(p=>p.id!==pkg.id)?.id || null;
  });
}

// ---------- Items ----------
let editingId = null;
function openItemEditor(id=null){
  const pkg = getCurrentPackage(); const it = id? pkg.items.find(x=>x.id===id): null;
  editingId = it?.id || null;

  modalTitle.textContent = it? 'Editar producte' : 'Afegir producte';
  fName.value  = it?.name  || '';
  fLink.value  = it?.link  || '';
  fCost.value  = it?.cost?.toFixed(2)  || '';
  fPrice.value = it?.price?.toFixed(2) || '';
  fSold.value  = it?.sold? 'true':'false';
  fDate.value  = it?.dateSold || '';

  // Enllaç: només a la CREACIÓ. En editar, no es pot canviar.
  const isEditing = Boolean(it);
  fLink.disabled = isEditing;
  fLink.title = isEditing ? "L'enllaç només es defineix en crear l'article" : "";

  itemDialog.showModal();
}
function saveItemFromModal(){
  const pkg=getCurrentPackage(); if(!pkg) return;
  const isEditing = Boolean(editingId);

  const base = {
    name:(fName.value||'Sense nom').trim(),
    cost:num(fCost.value),
    price:num(fPrice.value),
    sold:fSold.value==='true',
    dateSold:(fDate.value||''),
    updatedAt:FV.serverTimestamp()
  };

  if(isEditing){
    db.collection('packages').doc(pkg.id).collection('items').doc(editingId).set(base, {merge:true})
      .then(()=> itemDialog.close());
  } else {
    const payload = { ...base, link: asHref(fLink.value), createdAt:FV.serverTimestamp() };
    db.collection('packages').doc(pkg.id).collection('items').add(payload)
      .then(()=> itemDialog.close());
  }
}
async function toggleSold(id){
  const pkg = getCurrentPackage(); if(!pkg) return;
  const it = pkg.items.find(x=>x.id===id); if(!it) return;

  const newSold = !it.sold;
  const prevDate = it.dateSold || '';
  await db.collection('packages').doc(pkg.id).collection('items').doc(id).update({
    sold: newSold,
    dateSold: newSold ? (prevDate || todayISO()) : '',
    updatedAt: FV.serverTimestamp()
  });
  renderSummary(); renderKPIs();

  // prepara Undo: revertir a l'estat anterior
  showSnack(newSold ? `Marcat com venut: “${it.name}”` : `Desmarcat: “${it.name}”`, async ()=>{
    await db.collection('packages').doc(pkg.id).collection('items').doc(id).update({
      sold: it.sold,
      dateSold: prevDate,
      updatedAt: FV.serverTimestamp()
    });
  });
}

async function deleteItem(id){
  const pkg = getCurrentPackage(); if(!pkg) return;
  const it = pkg.items.find(x=>x.id===id); if(!it) return;
  if(!confirm('Eliminar producte?')) return;

  // guarda una còpia local abans d'eliminar
  const backup = { ...it };

  await db.collection('packages').doc(pkg.id).collection('items').doc(id).delete();
  showSnack(`Eliminat: “${it.name}”`, async ()=>{
    // restaura amb el mateix id
    await db.collection('packages').doc(pkg.id).collection('items').doc(id).set({
      ...backup, updatedAt: FV.serverTimestamp()
    });
  });
}


// ---------- Inline edit (mateixa mida) — NOM editable, ENLLAÇ immutable ----------
tbody.addEventListener('dblclick', (e)=>{
  const td = e.target.closest('td.editable'); if(!td) return;
  const field = td.dataset.field || (td.classList.contains('editable') && td.querySelector('.name-link') ? 'name' : '');
  const id = td.dataset.id || td.closest('tr')?.querySelector('[data-id]')?.dataset.id;
  if(!field || !id) return;

  const pkg = getCurrentPackage(); const it = pkg?.items.find(x=>x.id===id); if(!it) return;

  const a = td.querySelector('a'); if(a) a.addEventListener('click', ev=>ev.preventDefault(), { once:true });

  const prevHTML = td.innerHTML;
  let cancelled = false;

  td.classList.add('editing');
  td.innerHTML = '';

  const wrap  = document.createElement('div');
  wrap.className = 'cell-editor';
  Object.assign(wrap.style, { position:'absolute', inset:'0', display:'flex', alignItems:'center', background:'transparent' });

  const input = document.createElement('input');
  if(field==='name'){
    input.type='text';
    input.value = it.name || '';
  } else if(field==='dateSold'){
    input.type='date';
    input.value = it.dateSold || '';
  } else {
    input.type='text'; input.inputMode='decimal'; input.pattern='[0-9]*[.,]?[0-9]*';
    input.value = (it[field] ?? 0).toString();
    if (td.classList.contains('right')) input.style.textAlign = 'right';
  }
  Object.assign(input.style, {
    width:'100%', height:'100%', margin:0, padding:0, border:0, outline:'none',
    background:'transparent', color:'var(--text)', font:'inherit', textAlign: input.style.textAlign||'inherit', lineHeight:'inherit'
  });

  wrap.appendChild(input);
  td.style.position='relative';
  td.appendChild(wrap);

  const commit = ()=>{
    const ref = db.collection('packages').doc(pkg.id).collection('items').doc(it.id);
    if(field==='name'){
      const newName = (input.value || 'Sense nom').trim();
      ref.update({ name:newName, updatedAt:FV.serverTimestamp() })
        .then(()=>{
          const href = asHref(it.link);
          td.innerHTML = href
            ? `<a class="name-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(newName)}</a>`
            : `<span class="name-link">${escapeHTML(newName)}</span>`;
        })
        .catch(()=> td.innerHTML = prevHTML)
        .finally(()=>{ td.classList.remove('editing'); renderRows(); });
      return;
    }
    if(field==='dateSold'){
      const v = input.value || '';
      ref.update({ dateSold:v, updatedAt:FV.serverTimestamp() })
        .then(()=> td.innerHTML = v || '')
        .catch(()=> td.innerHTML = prevHTML)
        .finally(()=>{ td.classList.remove('editing'); renderRows(); });
      return;
    }
    if(field==='cost' || field==='price'){
      let v = (input.value||'').replace(',','.').trim();
      v = v===''? 0 : Number(v); if(isNaN(v)) v=0;
      const patch={ [field]:v, updatedAt:FV.serverTimestamp() };
      ref.update(patch)
        .then(()=> td.innerHTML = fmt(v))
        .catch(()=> td.innerHTML = prevHTML)
        .finally(()=>{ td.classList.remove('editing'); renderRows(); });
      return;
    }
  };
  const cancel = ()=>{ cancelled = true; td.innerHTML = prevHTML; td.classList.remove('editing'); };

  input.addEventListener('keydown', (ev)=>{
    if(ev.key==='Enter'){ ev.preventDefault(); commit(); }
    if(ev.key==='Escape'){ ev.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', ()=>{ if(!cancelled) commit(); });

  requestAnimationFrame(()=>{ input.focus(); input.select && input.select(); });
});

// Click a la píndola per canviar estat
tbody.addEventListener('click', e=>{
  const pill = e.target.closest('.pill'); if(!pill) return;
  const td = pill.closest('td[data-field="sold"]'); if(!td) return;
  toggleSold(td.dataset.id);
});

// ---------- Events UI ----------
Array.from(document.querySelectorAll('th[data-sort]')).forEach(th=>{
  th.addEventListener('click', ()=>{
    const key=th.dataset.sort; state.sort={ key, dir:(state.sort.key===key? -state.sort.dir : 1) }; renderRows();
  });
});
const addBtn = document.getElementById('addItemBtn');
if(addBtn) addBtn.addEventListener('click', ()=>openItemEditor());
if(cancelItem) cancelItem.addEventListener('click', ()=>itemDialog.close());
if(saveItem)   saveItem.addEventListener('click', saveItemFromModal);

if(renamePkgBtn) renamePkgBtn.addEventListener('click', renamePackage);
if(deletePkgBtn) deletePkgBtn.addEventListener('click', deletePackage);
if(addPkgBtn)    addPkgBtn.addEventListener('click', addPackage);

if(pkgChips){
  pkgChips.addEventListener('click', e=>{
    const chip = e.target.closest('.chip'); if(!chip) return;
    if(chip.id === 'chipAdd'){ addPackage(); return; }
    const id = chip.dataset.id; if(!id) return;

    if(id === state.currentPkgId){
      // mateix paquet → alterna el mode del xip (potencial ↔ progrés)
      state.selectedDisplayMode = (state.selectedDisplayMode === 'potential') ? 'progress' : 'potential';
      renderPackageControls();
    } else {
      // paquet nou → selecciona i mostra POT per defecte
      state.currentPkgId = id;
      state.selectedDisplayMode = 'potential';
      renderAll();
    }
  });
}

if(pkgSelect){
  pkgSelect.addEventListener('change', ()=>{
    state.currentPkgId = pkgSelect.value; renderAll();
  });
}

// Inputs paquet (guardar en sortir del camp)
pkgDiscount.addEventListener('change', ()=>{
  const pkg=getCurrentPackage(); if(!pkg) return;
  const val = num(pkgDiscount.value);
  pkg.discount = val; // estat local primer (evita flicker)
  renderKPIs(); renderSummary();
  db.collection('packages').doc(pkg.id).update({ discount: val, updatedAt: FV.serverTimestamp() });
});
pkgShipping.addEventListener('change', ()=>{
  const pkg=getCurrentPackage(); if(!pkg) return;
  const val = num(pkgShipping.value);
  pkg.shipping = val;
  renderKPIs(); renderSummary();
  db.collection('packages').doc(pkg.id).update({ shipping: val, updatedAt: FV.serverTimestamp() });
});

// Tema clar/fosc
const THEME_KEY='intranet-theme';
function applyTheme(){ const t=localStorage.getItem(THEME_KEY)||'dark'; document.body.setAttribute('data-theme',t); if(themeToggle) themeToggle.textContent=t==='dark'?'🌙':'☀️'; }
applyTheme();
if(themeToggle){
  themeToggle.addEventListener('click', ()=>{ const cur=document.body.getAttribute('data-theme')==='dark'?'light':'dark'; localStorage.setItem(THEME_KEY,cur); applyTheme(); });
}
// ===== Scroll chaining manual per a contenidors de taula =====
// [TABLE:sticky] + handoff cap al body quan es toca el límit
function enableScrollHandoff(el){
  if(!el) return;

  // Ratolí / trackpad
  el.addEventListener('wheel', (e)=>{
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const goingDown = e.deltaY > 0;

    // Si som al límit, “passem” el scroll al window
    if ((goingDown && atBottom) || (!goingDown && atTop)){
      e.preventDefault();
      window.scrollBy({ top: e.deltaY, left: 0, behavior: 'auto' });
    }
  }, { passive: false });

  // Tacte (mòbil)
  let startY = 0;
  el.addEventListener('touchstart', (e)=>{ startY = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e)=>{
    const delta = startY - e.touches[0].clientY; // + baix, - amunt
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;

    if ((delta > 0 && atBottom) || (delta < 0 && atTop)){
      e.preventDefault();
      window.scrollBy(0, delta);
    }
  }, { passive: false });
}

// activa-ho per a totes les taules scrollables
document.querySelectorAll('.card .table-wrap').forEach(enableScrollHandoff);

// ---------- Init ----------
seedIfEmpty().finally(()=>{ listenPackages(); renderAll(); });