/* AnneTea BrewTrack POS
   Secure login · GCash payment · Light/Dark theme · Owner Dashboard
*/

// ---------- AUTH (secure demo) ----------
// Production: use server-side bcrypt. Hash below = SHA-256 of "1234".
const USERS = {
  // Default password for all demo accounts: Annetea@1  (meets 8-15 policy)
  owner:  { pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'owner',  name: 'Owner' },
  coowner:{ pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'co_owner', name: 'Co-owner' },
  staff:  { pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'staff',  name: 'Staff' }
};

let session = null;
let pendingGCash = null; // { total, ref, photo }
let productPage = 1;
const PRODUCT_PAGE_SIZE = 15;
const BUSINESS_TIN_BASE = '000-000-000'; // store TIN base (update with real TIN when available)
let tinSeq = parseInt(localStorage.getItem('at_tin_seq') || '0', 10);
let orderSeq = parseInt(localStorage.getItem('at_order_seq') || '1000', 10);

/** Permanent registries — numbers used once forever (even next day / after browser reopen) */
function loadUsedSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch (e) { return new Set(); }
}
function saveUsedSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}
function markUsed(key, value) {
  const set = loadUsedSet(key);
  set.add(value);
  saveUsedSet(key, set);
}
function rebuildUsedFromSales() {
  // Sync registries from all historical sales so nothing is ever reused
  const sales = (typeof getSalesList === 'function') ? getSalesList() : [];
  const orders = loadUsedSet('at_used_order_nos');
  const tins = loadUsedSet('at_used_tins');
  sales.forEach(s => {
    if (s.order_no) orders.add(s.order_no);
    if (s.tin) tins.add(s.tin);
  });
  saveUsedSet('at_used_order_nos', orders);
  saveUsedSet('at_used_tins', tins);
}

/** Unique TIN per transaction — one-time use only, never repeated across days */
function nextUniqueTin() {
  rebuildUsedFromSales();
  const used = loadUsedSet('at_used_tins');
  let candidate;
  do {
    tinSeq += 1;
    candidate = BUSINESS_TIN_BASE + '-' + String(tinSeq).padStart(6, '0');
  } while (used.has(candidate));
  localStorage.setItem('at_tin_seq', String(tinSeq));
  markUsed('at_used_tins', candidate);
  return candidate;
}

function validatePasswordPolicy(pass) {
  if (!pass || pass.length < 8 || pass.length > 15) {
    return 'Password must be 8–15 characters.';
  }
  if (!/[A-Z]/.test(pass)) return 'Include at least one uppercase letter.';
  if (!/[a-z]/.test(pass)) return 'Include at least one lowercase letter.';
  if (!/[0-9]/.test(pass)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pass)) return 'Include at least one special symbol.';
  return null;
}

function nextOrderNumber() {
  // Unique order numbers — one-time use only, never repeated next day
  rebuildUsedFromSales();
  const used = loadUsedSet('at_used_order_nos');
  let candidate;
  do {
    orderSeq += 1;
    candidate = 'ORD-' + String(orderSeq).padStart(6, '0');
  } while (used.has(candidate));
  localStorage.setItem('at_order_seq', String(orderSeq));
  markUsed('at_used_order_nos', candidate);
  return candidate;
}

function nextSaleId() {
  // Unique sale id (never reuse)
  const existing = new Set(getSalesList().map(s => String(s.id)));
  let id = Date.now();
  while (existing.has(String(id))) id += 1;
  return id;
}

function readFileAsDataURL(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > maxBytes) {
      reject(new Error('File too large (max ' + Math.round(maxBytes/1024/1024) + 'MB)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getLoginState() {
  try {
    return JSON.parse(localStorage.getItem('at_login_state') || '{}');
  } catch (e) { return {}; }
}
function setLoginState(state) {
  localStorage.setItem('at_login_state', JSON.stringify(state));
}

function saveSession() {
  localStorage.setItem('at_session', JSON.stringify(session));
}
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem('at_session'));
    if (s && s.expires > Date.now()) {
      session = s;
      return true;
    }
  } catch (e) {}
  return false;
}
function clearSession() {
  session = null;
  localStorage.removeItem('at_session');
}

function togglePassword() {
  const input = document.getElementById('password');
  const btn = document.querySelector('.pwd-toggle');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}


async function doLogin(e) {
  e.preventDefault();
  if (typeof loginMethod !== 'undefined' && loginMethod === 'face') { loginWithFace(); return false; }
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  err.hidden = true;

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const user = document.getElementById('username').value.trim().toLowerCase();
  const pass = document.getElementById('password').value;
  const hash = await sha256(pass);
  const account = USERS[user];

  await new Promise(r => setTimeout(r, 350));

  if (!account || account.pass !== hash) {
    err.textContent = 'Invalid username or password';
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return false;
  }

  startSession(user, account);
  return false;
}

// Shared by password sign-in and face sign-in
function startSession(user, account) {
  session = {
    username: user,
    role: account.role,
    name: account.name,
    token: crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)),
    expires: Date.now() + 8 * 60 * 60 * 1000
  };
  saveSession();
  toast('Welcome, ' + (account.name || user), 'ok');
  enterApp();
}

function doLogout() {
  if (order.length && !confirm('There is an open order. Logout anyway?')) return;
  clearSession();
  order = [];
  pendingGCash = null;
  if (typeof clearUndo === 'function') clearUndo();
  ['posScreen','dashScreen','mgmtScreen','todayScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  const lb = document.getElementById('loginBtn'); if (lb) { lb.disabled = false; lb.textContent = 'Sign In'; }
  const le = document.getElementById('loginError'); if (le) le.hidden = true;
  toast('Logged out', 'info');
}

function enterApp() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('posScreen').classList.add('active');
  const roleLabel = { owner: 'Owner', co_owner: 'Co-owner', staff: 'Staff' };
  document.getElementById('displayRole').textContent = roleLabel[session.role] || session.role;
  const isOwner = session.role === 'owner' || session.role === 'co_owner';
  const dashBtn = document.getElementById('btnDashboard');
  if (dashBtn) dashBtn.hidden = !isOwner;
  // Manage is available to all roles (staff = restock only)
  renderCategories();
  renderProducts();
  renderOrder();
  checkLowStockNotify();
}

// ---------- MENU DATA ----------
// Categories and menu come from menu-seed.js (built from the shop's recipe list). After the first run they are saved
// and edited in Manage → Products (stock-menu.js), so these are only the starting values.
const CATEGORIES = JSON.parse(JSON.stringify(CATALOG_SEED.categories));

const CAT_META = {
  classic: ['🧋', 150], creamcheese: ['🧀', 45], creampuff: ['☁️', 205], cheesecake: ['🍰', 330],
  house: ['🍯', 35], salty: ['🧂', 190], fruitea: ['🍓', 355], summer: ['🍹', 20],
  frappe: ['🥤', 280], coldbrew: ['☕', 25], latte: ['🥛', 60], dirty: ['🤎', 20],
  snacks: ['🍟', 40], rice: ['🍚', 95], sinkers: ['🫧', 215], meiji: ['🍫', 15]
};
function catMeta(id) { return CAT_META[id] || ['🍵', 150]; }

const MENU = JSON.parse(JSON.stringify(CATALOG_SEED.menu));

// Recipes are saved per product in the catalog (see stock-menu.js)

// Inventory
let inventory = JSON.parse(localStorage.getItem('at_inventory') || 'null') ||
  Object.fromEntries(Object.entries(INGREDIENT_SEED).map(([n, x]) => [n, x.start]));   // demo starting stock — set real counts with Restock
const MIN_STOCK = 12;   // default low-stock level; each ingredient can have its own (Inventory → Edit)

function saveInventory() {
  localStorage.setItem('at_inventory', JSON.stringify(inventory));
  if (typeof pushInventoryToServer === 'function') pushInventoryToServer();
  if (typeof renderProducts === 'function' && document.getElementById('productGrid')) renderProducts();   // keep out-of-stock marks current
}

// ---------- STATE ----------
let currentCat = 'classic';
let order = [];
let pending = null;
let salesChart = null;

// ---------- CLOCK ----------
function tick() {
  const t = new Date().toLocaleString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  document.getElementById('clock').textContent = t;
  const c2 = document.getElementById('clock2');
  if (c2) c2.textContent = t;
}
setInterval(tick, 1000);
tick();

// ---------- CATEGORIES & PRODUCTS ----------
function renderCategories() {
  const nav = document.getElementById('catNav');
  nav.innerHTML = CATEGORIES.map(c =>
    `<button class="cat-btn ${c.id === currentCat ? 'active' : ''}" data-id="${c.id}" aria-pressed="${c.id === currentCat}">
      <span class="cat-emoji" aria-hidden="true">${catMeta(c.id)[0]}</span><span class="cat-label">${c.label}</span></button>`
  ).join('');
  nav.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      currentCat = btn.dataset.id;
      renderCategories();
      renderProducts();
      const grid = document.getElementById('productGrid');
      if (grid) grid.scrollTop = 0;
    };
  });
  const active = nav.querySelector('.cat-btn.active');
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}


const DRINK_CATS = new Set(['classic','creamcheese','creampuff','cheesecake','house','salty','fruitea','summer','frappe','coldbrew','latte','dirty','meiji']);
const SUGAR_LEVELS = [
  { id: '0', label: 'No Sugar' },
  { id: '25', label: '25%' },
  { id: '50', label: '50%' },
  { id: '75', label: '75%' },
  { id: '100', label: '100%' }
];

function productNeedsSugar(product) {
  // Find category of product
  for (const [cat, items] of Object.entries(MENU)) {
    if (items.some(x => x.id === product.id)) return DRINK_CATS.has(cat);
  }
  return false;
}

function selectProduct(id) {
  const p = Object.values(MENU).flat().find(x => x.id === id);
  if (!p) return;
  const why = unavailableReason(p);
  if (why) { toast(p.name + ' — ' + why, 'err'); return; }
  const sizes = Object.keys(p.prices);
  const needsSugar = productNeedsSugar(p);

  if (sizes.length === 1 && !needsSugar) {
    addItem(p, sizes[0], p.prices[sizes[0]], null);
    return;
  }

  if (sizes.length === 1 && needsSugar) {
    pending = { product: p, size: sizes[0], price: p.prices[sizes[0]] };
    document.getElementById('sugarTitle').textContent = p.name + ' · Sugar';
    renderSugarGrid('sugarGridSolo', (sugar) => {
      addItem(pending.product, pending.size, pending.price, sugar);
      closeAllModals();
      pending = null;
    });
    document.getElementById('sugarModal').classList.add('show');
    return;
  }

  // Multi-size (± sugar)
  pending = { product: p };
  document.getElementById('sizeTitle').textContent = p.name;
  document.getElementById('sizeGrid').innerHTML = sizes.map(s =>
    { const sh = shortagesFor(orderLines([{ id: p.id, qty: 1, size: s }]));   // a size can be out even when a smaller one is not
      return `<button class="size-btn${sh.length ? ' oos' : ''}" data-size="${s}"${sh.length ? ' disabled title="' + shortageText(sh).replace(/"/g, '') + '"' : ''}><span class="sz">${sizeLabel(s)}</span><span class="sz-price">${sh.length ? 'Out: ' + sh[0].ing : '₱' + p.prices[s]}</span></button>`; }
  ).join('');
  const sugarSec = document.getElementById('sugarSection');
  if (needsSugar) {
    sugarSec.hidden = false;
    let chosenSugar = '100';
    renderSugarGrid('sugarGrid', (sugar) => { chosenSugar = sugar; }, chosenSugar);
    document.querySelectorAll('#sizeGrid .size-btn').forEach(b => {
      b.onclick = () => {
        const sugar = document.querySelector('#sugarGrid .sugar-btn.selected')?.dataset.sugar || '100';
        addItem(p, b.dataset.size, p.prices[b.dataset.size], sugar);
        closeAllModals();
        pending = null;
      };
    });
  } else {
    sugarSec.hidden = true;
    document.querySelectorAll('#sizeGrid .size-btn').forEach(b => {
      b.onclick = () => {
        addItem(p, b.dataset.size, p.prices[b.dataset.size], null);
        closeAllModals();
        pending = null;
      };
    });
  }
  document.getElementById('sizeModal').classList.add('show');
}

function renderSugarGrid(containerId, onPick, preselect) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const pre = preselect || '100';
  grid.innerHTML = SUGAR_LEVELS.map(s =>
    `<button type="button" class="sugar-btn${s.id === pre ? ' selected' : ''}" data-sugar="${s.id}">${s.label}</button>`
  ).join('');
  grid.querySelectorAll('.sugar-btn').forEach(btn => {
    btn.onclick = () => {
      grid.querySelectorAll('.sugar-btn').forEach(x => x.classList.remove('selected'));
      btn.classList.add('selected');
      if (onPick && containerId === 'sugarGridSolo') onPick(btn.dataset.sugar);
    };
  });
}

function addItem(product, size, price, sugar, opts) {
  // products with a choice (rice, dip, side…) ask for it first
  if (product.options && product.options.length && !opts) { openOptionPicker(product, size, price, sugar); return; }
  opts = opts || null;
  const short = shortagesFor(orderLines([{ id: product.id, qty: 1, size, opts }]));
  if (short.length) { toast(shortageText(short), 'err'); return; }
  const sugarKey = sugar == null ? '' : String(sugar);
  const optKey = opts ? JSON.stringify(opts) : '';
  const found = order.find(i => i.id === product.id && i.size === size && (i.sugar || '') === sugarKey && (i.opts ? JSON.stringify(i.opts) : '') === optKey);
  if (found) found.qty++;
  else order.push({
    id: product.id,
    name: product.name,
    size,
    price,
    qty: 1,
    sugar: sugarKey || null,
    sugarLabel: sugarKey === '0' ? 'No Sugar' : (sugarKey ? sugarKey + '%' : null),
    opts,
    optLabel: opts ? Object.values(opts).join(', ') : null
  });
  renderOrder();
}

// ---------- ORDER ----------
function renderOrder() {
  const body = document.getElementById('orderList');
  const count = order.reduce((n, i) => n + i.qty, 0);
  if (!order.length) {
    body.innerHTML = '<div class="empty-state"><span class="empty-ico">🧋</span><strong>No items yet</strong>Tap a product to start an order</div>';
  } else {
    body.innerHTML = order.map((i, idx) => `
      <div class="line">
        <div class="line-top">
          <div class="line-info">
            <div class="line-name">${i.name}</div>
            <div class="line-size">${sizeLabel(i.size)}${i.optLabel ? ' · ' + i.optLabel : ''}${i.sugarLabel ? ' · ' + i.sugarLabel + ' sugar' : ''} · ₱${Number(i.price).toFixed(2)} each</div>
          </div>
          <div class="line-amt">₱${(i.price * i.qty).toFixed(2)}</div>
        </div>
        <div class="line-bottom">
          <div class="stepper">
            <button type="button" aria-label="Decrease quantity" onclick="changeQty(${idx}, -1)"><svg class="ic"><use href="#i-minus"/></svg></button>
            <span class="q">${i.qty}</span>
            <button type="button" aria-label="Increase quantity" onclick="changeQty(${idx}, 1)"><svg class="ic"><use href="#i-plus"/></svg></button>
          </div>
          <button type="button" class="line-del" aria-label="Remove ${i.name}" onclick="removeLine(${idx})"><svg class="ic"><use href="#i-trash"/></svg></button>
        </div>
      </div>`).join('');
    body.scrollTop = body.scrollHeight;
  }
  const sub = order.reduce((s, i) => s + i.price * i.qty, 0);
  const money = `₱${sub.toFixed(2)}`;
  document.getElementById('subtotal').textContent = money;
  document.getElementById('grandTotal').textContent = money;
  const mini = document.getElementById('miniTotal'); if (mini) mini.textContent = money;
  const pill = document.getElementById('orderCount');
  if (pill) { pill.textContent = count; pill.classList.toggle('zero', !count); }
  ['payCash', 'payGcash', 'btnVoid', 'btnReceipt', 'btnClear'].forEach(id => {
    const b = document.getElementById(id); if (b) b.disabled = !order.length;
  });
}

function changeQty(idx, delta) {
  const it = order[idx]; if (!it) return;
  if (delta > 0) { const short = shortagesFor(orderLines([{ id: it.id, qty: delta, size: it.size, opts: it.opts }])); if (short.length) { toast(shortageText(short), 'err'); return; } }
  it.qty += delta;
  if (it.qty <= 0) order.splice(idx, 1);
  renderOrder();
}
function removeLine(idx) {
  const it = order[idx]; if (!it) return;
  const removed = order.splice(idx, 1)[0];
  renderOrder();
  toast(removed.name + ' removed', 'info', { label: 'Undo', action: () => { order.splice(idx, 0, removed); renderOrder(); } });
}

// Mobile / tablet-portrait: the order ticket is a bottom sheet
function onTicketHeadClick(e) {
  if (e.target.closest('button')) return;
  if (window.matchMedia('(max-width: 820px)').matches) document.getElementById('ticket').classList.toggle('open');
}

function clearOrder() {
  if (!order.length) return;
  const backup = order;
  order = [];
  renderOrder();
  toast('Order cleared', 'info', { label: 'Undo', action: () => { order = backup.concat(order); renderOrder(); } });
}


// ---------- PAYMENT + INVENTORY RULES ----------
function logStockChange(ingredient, change, reason, notes, extra) {
  if (typeof stockLogs === 'undefined') return;
  extra = extra || {};
  const after = inventory[ingredient];
  const log = {
    id: Date.now() + Math.random(),
    ingredient,
    change: +Number(change).toFixed(2),
    balance: after != null ? +Number(after).toFixed(2) : null,
    reason,
    notes: notes || '',
    expiry: extra.expiry || null,
    photo: extra.photo || null,
    user: (session && (session.username || session.name)) || 'system',
    time: new Date().toISOString()
  };
  if (session) log.user = session.username || session.name || 'user';
  stockLogs.unshift(log);
  if (stockLogs.length > 500) stockLogs.length = 500;
  stockLogsPending.add(String(log.id));   // stays marked until the server confirms it has it
  stockLogsChanged();
}


function completeSale(method, extra) {
  extra = extra || {};
  const _short = shortagesFor(orderLines());   // stock may have changed since the items were added
  if (_short.length) { pendingGCash = null; closeAllModals(); toast(shortageText(_short) + '. Sale not completed.', 'err'); return; }
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  const used = ingredientsNeeded(orderLines());   // exact amounts, so a void/undo puts back what was really taken
  deductInventory(order);

  const roleLabel = { owner: 'Owner', co_owner: 'Co-owner', staff: 'Staff' }[session.role] || session.role;
  const sale = {
    id: nextSaleId(),
    order_no: nextOrderNumber(), // unique, never repeated
    transaction_no: (method === 'GCash' && extra.ref) ? extra.ref : ('AT' + Date.now()),
    items: JSON.parse(JSON.stringify(order)),
    total,
    method,
    payment_ref: extra.ref || null,
    payment_photo: extra.photo || null,
    tendered: extra.tendered != null ? extra.tendered : null,
    change: extra.change != null ? extra.change : null,
    tin: nextUniqueTin(), // unique per sale — never repeated
    user: session.username,
    name: session.name,
    roleLabel: roleLabel,
    used,
    time: new Date().toISOString()
  };
  const all = getSalesList();
  all.push(sale);
  setSalesList(all);
  pushSaleToServer(sale);

  // Close payment modals only — do NOT close receipt
  ['cashModal', 'gcashModal', 'sizeModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });

  order = [];
  renderOrder();
  toast('Sale completed · ' + sale.order_no + ' · ' + method + ' · ₱' + total.toFixed(2), 'ok', { label: 'Undo sale', action: () => voidSale(sale.id, { reopen: true }) });
  checkLowStockNotify();

  // Always show dual receipt right after payment
  showReceipt(sale);
}

function takePayment(method) {
  if (!order.length) {
    toast('Add items first', 'err');
    return;
  }
  if (!orderStockOk()) return;
  if (method === 'GCash') {
    openGCash();
    return;
  }
  openCashCalculator();
}

function openCashCalculator() {
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('cashDue').textContent = '₱' + total.toFixed(2);
  document.getElementById('cashTendered').value = '';
  document.getElementById('cashChange').textContent = '₱0.00';
  document.getElementById('cashChange').className = '';
  document.getElementById('cashError').hidden = true;
  document.getElementById('cashModal').classList.add('show');
  bindCashNumpad(total);
}

function bindCashNumpad(due) {
  const input = document.getElementById('cashTendered');
  const changeEl = document.getElementById('cashChange');
  const pad = document.getElementById('cashNumpad');
  const err = document.getElementById('cashError');
  const quick = document.getElementById('cashQuick');
  if (quick) quick.onclick = (e) => {
    const b = e.target.closest('button[data-bill]'); if (!b) return;
    input.value = parseFloat(b.dataset.bill).toFixed(2);
    if (err) { err.hidden = true; err.className = 'error-msg'; err.style.color = ''; err.style.background = ''; }
    updateChange();
  };

  function updateChange() {
    const tendered = parseFloat(input.value) || 0;
    const change = tendered - due;
    if (tendered <= 0) {
      changeEl.textContent = '₱0.00';
      changeEl.className = '';
    } else if (change < 0) {
      changeEl.textContent = 'Short ₱' + Math.abs(change).toFixed(2);
      changeEl.className = 'short';
    } else {
      changeEl.textContent = '₱' + change.toFixed(2);
      changeEl.className = '';
    }
  }

  pad.onclick = (e) => {
    const btn = e.target.closest('button[data-k]');
    if (!btn) return;
    const k = btn.dataset.k;
    let v = input.value || '';
    if (k === 'eq') {
      // Record the amount customer gave — lock display & show change
      if (!v || parseFloat(v) <= 0) {
        if (err) {
          err.textContent = 'Enter the amount the customer gave first.';
          err.hidden = false;
        }
        return;
      }
      const tendered = parseFloat(v);
      input.value = tendered.toFixed(2);
      updateChange();
      if (err) {
        if (tendered < due) {
          err.textContent = 'Recorded ₱' + tendered.toFixed(2) + ' — still short of amount due.';
          err.hidden = false;
        } else {
          err.textContent = 'Recorded ₱' + tendered.toFixed(2) + ' · Change ₱' + (tendered - due).toFixed(2);
          err.hidden = false;
          err.className = 'error-msg';
          err.style.color = 'var(--cash)';
          err.style.background = 'var(--success-soft)';
        }
      }
      return;
    }
    if (err) {
      err.hidden = true;
      err.style.color = '';
      err.style.background = '';
      err.className = 'error-msg';
    }
    if (k === 'clear') v = '';
    else if (k === 'back') v = v.slice(0, -1);
    else if (k === 'exact') v = due.toFixed(2);
    else if (k === '.') {
      if (!v.includes('.')) v = (v || '0') + '.';
    } else if (k === '00') {
      if (v.includes('.')) {
        const parts = v.split('.');
        if (parts[1].length >= 2) return;
        v = v + '00';
        if (v.split('.')[1].length > 2) v = parts[0] + '.' + (parts[1] + '00').slice(0, 2);
      } else v = v + '00';
    } else {
      if (v.includes('.')) {
        const parts = v.split('.');
        if (parts[1].length >= 2) return;
      }
      v = v + k;
    }
    if (v && !v.startsWith('0.') && /^0+[1-9]/.test(v)) v = v.replace(/^0+/, '');
    input.value = v;
    updateChange();
  };
}

function confirmCashPayment() {
  const due = order.reduce((s, i) => s + i.price * i.qty, 0);
  const tendered = parseFloat(document.getElementById('cashTendered').value) || 0;
  const err = document.getElementById('cashError');
  if (tendered < due) {
    err.textContent = 'Customer cash is less than the amount due.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const change = tendered - due;
  completeSale('Cash', { tendered, change });
}



function cancelGCash() {
  pendingGCash = null;
  closeAllModals();
  toast('GCash payment cancelled', 'info');
}

// ---------- RECEIPT ----------
function buildCustomerReceipt(sale) {
  const d = new Date(sale.time);
  let t = '';
  t += '      ANNETEA BREWTRACK\n';
  t += '  Sitio Trangka, Pinagsibaan\n';
  t += '     Rosario, Batangas\n';
  t += '  TIN: ' + (sale.tin || '—') + '\n';
  t += '--------------------------------\n';
  t += 'CUSTOMER RECEIPT\n';
  t += d.toLocaleString('en-PH') + '\n';
  t += 'Order No: ' + (sale.order_no || sale.id) + '\n';
  t += 'Cashier: ' + (sale.roleLabel || sale.name || sale.user) + '\n';
  t += '--------------------------------\n';
  (sale.items || []).forEach(i => {
    const sug = i.sugarLabel ? ' ' + i.sugarLabel : '';
    const line = i.qty + 'x ' + i.name + ' (' + sizeLabel(i.size) + sug + (i.optLabel ? ', ' + i.optLabel : '') + ')';
    const amt = '₱' + (i.price * i.qty).toFixed(2);
    t += line.substring(0, 24).padEnd(24) + amt.padStart(8) + '\n';
  });
  t += '--------------------------------\n';
  t += 'TOTAL'.padEnd(22) + ('₱' + Number(sale.total).toFixed(2)).padStart(10) + '\n';
  t += 'Payment: ' + sale.method + '\n';
  if (sale.payment_ref) t += 'GCash Ref: ' + sale.payment_ref + '\n';
  if (sale.tendered != null) t += 'Cash: ₱' + Number(sale.tendered).toFixed(2) + '\n';
  if (sale.change != null) t += 'Change: ₱' + Number(sale.change).toFixed(2) + '\n';
  t += '--------------------------------\n';
  t += '   Thank you! Come again.\n';
  t += '     annetea · 2026\n';
  return t;
}

function buildKitchenReceipt(sale) {
  const d = new Date(sale.time);
  let t = '';
  t += '   *** STAFF / CHEF COPY ***\n';
  t += '      ANNETEA BREWTRACK\n';
  t += '--------------------------------\n';
  t += 'Order No: ' + (sale.order_no || sale.id) + '\n';
  t += 'TIN: ' + (sale.tin || '—') + '\n';
  t += d.toLocaleString('en-PH') + '\n';
  t += 'Cashier: ' + (sale.roleLabel || sale.user) + '\n';
  t += '--------------------------------\n';
  t += 'PREPARE:\n';
  (sale.items || []).forEach(i => {
    const sug = i.sugarLabel ? ' · ' + i.sugarLabel : '';
    t += ' ' + i.qty + 'x ' + i.name + '\n';
    t += '    Size: ' + sizeLabel(i.size) + sug + '\n';
    if (i.optLabel) t += '    With: ' + i.optLabel + '\n';
  });
  t += '--------------------------------\n';
  t += 'Items: ' + (sale.items || []).reduce((s,i)=>s+i.qty,0) + '\n';
  t += '*** NOT A CUSTOMER RECEIPT ***\n';
  return t;
}

function showReceipt(sale) {
  window._lastSaleReceipt = sale;
  const paper = document.getElementById('receiptPaper');
  const kit = document.getElementById('receiptPaperKitchen');
  paper.textContent = buildCustomerReceipt(sale);
  if (kit) {
    kit.textContent = buildKitchenReceipt(sale);
    kit.hidden = true;
  }
  paper.hidden = false;
  document.querySelectorAll('.receipt-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.rcpt === 'customer');
  });
  document.getElementById('receiptModal').classList.add('show');
}

function switchReceiptTab(which, btn) {
  document.querySelectorAll('.receipt-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const paper = document.getElementById('receiptPaper');
  const kit = document.getElementById('receiptPaperKitchen');
  if (which === 'kitchen') {
    paper.hidden = true;
    if (kit) kit.hidden = false;
  } else {
    paper.hidden = false;
    if (kit) kit.hidden = true;
  }
}

function printBothReceipts() {
  const sale = window._lastSaleReceipt;
  if (!sale) { window.print(); return; }
  const paper = document.getElementById('receiptPaper');
  const kit = document.getElementById('receiptPaperKitchen');
  const original = paper.textContent;
  paper.hidden = false;
  if (kit) kit.hidden = true;
  paper.textContent = buildCustomerReceipt(sale) + '\n\n' + buildKitchenReceipt(sale);
  window.print();
  paper.textContent = original;
}

function previewReceipt() {
  if (!order.length) {
    toast('No open order', 'err');
    return;
  }
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  showReceipt({
    id: 'PREVIEW',
    items: order,
    total,
    method: '—',
    name: session.name,
    time: new Date().toISOString()
  });
}

// ---------- INVENTORY MODAL ----------
function getIngredientExpiryMap() {
  try { return JSON.parse(localStorage.getItem('at_ingredient_expiry') || '{}'); }
  catch (e) { return {}; }
}
function setIngredientExpiry(name, dateStr) {
  const map = getIngredientExpiryMap();
  if (dateStr) map[name] = dateStr;
  else delete map[name];
  localStorage.setItem('at_ingredient_expiry', JSON.stringify(map));
}






function goToLowStock(e) {
  if (e) e.preventDefault();
  // Ensure we are on a screen where inventory is usable
  const mgmt = document.getElementById('mgmtScreen');
  const dash = document.getElementById('dashScreen');
  if (mgmt && mgmt.classList.contains('active')) {
    // stay on mgmt but open inventory modal for the problem items
  }
  openInventory({ focusLow: true });
  // Also offer restock path for owners
  if (session && (session.role === 'owner' || session.role === 'co_owner')) {
    toast('Low items highlighted — use Manage → Restock to add/remove stock', 'info');
  }
}

// ---------- REPORTS (quick) ----------
function openReports() {
  openTodayPage();
}

// ---------- OWNER DASHBOARD ----------
function openDashboard() {
  if (session.role !== 'owner' && session.role !== 'co_owner') return;
  document.getElementById('posScreen').classList.remove('active');
  document.getElementById('todayScreen')?.classList.remove('active');
  document.getElementById('dashScreen').classList.add('active');
  buildDashboard();
}

function backToPOS() {
  document.getElementById('dashScreen').classList.remove('active');
  document.getElementById('posScreen').classList.add('active');
}

function buildDashboard() {
  const sales = JSON.parse(localStorage.getItem('at_sales') || '[]');
  const todayStr = new Date().toDateString();
  const todays = sales.filter(s => new Date(s.time).toDateString() === todayStr);
  const revenue = todays.reduce((s, x) => s + x.total, 0);
  const count = todays.length;
  const avg = count ? revenue / count : 0;
  const lowCount = lowStockItems().length;

  document.getElementById('kpiRevenue').textContent = '₱' + revenue.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  document.getElementById('kpiCount').textContent = count;
  document.getElementById('kpiAvg').textContent = '₱' + avg.toFixed(0);
  document.getElementById('kpiLow').textContent = lowCount;

  // Best sellers
  const tally = {};
  todays.forEach(s => s.items.forEach(i => {
    tally[i.name] = (tally[i.name] || 0) + i.qty;
  }));
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
  document.getElementById('bestSellers').innerHTML = ranked.length
    ? ranked.map(([name, qty], i) =>
        `<div class="best-item"><div class="best-top"><span><span class="best-rank">${i + 1}</span>${name}</span><span class="best-qty">${qty} sold</span></div><div class="best-bar"><i style="width:${Math.max(6, Math.round(qty / ranked[0][1] * 100))}%"></i></div></div>`
      ).join('')
    : '<p style="color:var(--muted);font-size:0.9rem">No sales yet today</p>';

  // Recent
  const recent = sales.slice(-8).reverse();
  let table = '<table><thead><tr><th>Time</th><th>Order</th><th>TIN</th><th>Cashier</th><th>Method</th><th>Total</th></tr></thead><tbody>';
  recent.forEach(s => {
    const t = new Date(s.time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    table += `<tr><td>${t}</td><td>${s.order_no || '—'}</td><td style="font-size:0.75rem;font-family:monospace">${s.tin || '—'}</td><td>${s.roleLabel || s.name || s.user || '—'}</td><td>${methodPill(s.method)}</td><td>₱${Number(s.total).toFixed(2)}</td></tr>`;
  });
  table += '</tbody></table>';
  document.getElementById('recentSales').innerHTML = recent.length ? table : '<div class="empty-block"><span class="empty-ico">🧾</span>No transactions yet</div>';

  // Chart – last 7 days
  const days = [];
  const vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    days.push(d.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric' }));
    vals.push(sales.filter(s => new Date(s.time).toDateString() === key).reduce((sum, x) => sum + x.total, 0));
  }
  const ctx = document.getElementById('salesChart').getContext('2d');
  if (salesChart) salesChart.destroy();
  salesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        label: 'Revenue (₱)',
        data: vals,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--green-2').trim() || '#1b7a4a',
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ₱' + Number(c.parsed.y).toLocaleString('en-PH', { minimumFractionDigits: 2 }) } } },
      scales: {
        x: { ticks: { color: '#8b9bb4' }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), callback: v => '₱' + v.toLocaleString('en-PH') }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() } }
      }
    }
  });
}

// ---------- MODALS ----------
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', () => {
  if (loadSession()) {
    enterApp();
  }
});

// ============================================================
// MANAGEMENT MODULE (Owner / Co-owner)
// ============================================================

let stockLogs = JSON.parse(localStorage.getItem('at_stock_logs') || '[]');

// ---------- STOCK HISTORY SAVING ----------
// Each history entry is sent to the server right after it is written. Entries the server has not
// confirmed yet are remembered ("pending"), so a refresh from the server (every 15 s, or when the app
// is opened again) can never wipe a restock that was just saved. Undone entries are sent as "removed".
function lsGetJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
}
let stockLogsPending = new Set(lsGetJson('at_stock_logs_pending', []).map(String));
let stockLogsRemoved = new Set(lsGetJson('at_stock_logs_removed', []).map(String));
let _stockPushTimer = null;

function saveStockLogsLocal() {
  try { localStorage.setItem('at_stock_logs', JSON.stringify(stockLogs)); }
  catch (e) {   // browser storage full (restock photos are big): keep this device's copy without photos; the server keeps them
    try { localStorage.setItem('at_stock_logs', JSON.stringify(stockLogs.map((l) => (l.photo ? Object.assign({}, l, { photo: null }) : l)))); } catch (e2) {}
  }
  try {
    localStorage.setItem('at_stock_logs_pending', JSON.stringify([...stockLogsPending]));
    localStorage.setItem('at_stock_logs_removed', JSON.stringify([...stockLogsRemoved]));
  } catch (e) {}
}
// Call after any change to stockLogs: saves on this device now and sends to the server a moment later
function stockLogsChanged() {
  saveStockLogsLocal();
  clearTimeout(_stockPushTimer);
  _stockPushTimer = setTimeout(() => { if (typeof pushInventoryToServer === 'function') pushInventoryToServer(); }, 300);
}
function removeStockLog(id) {
  const k = String(id);
  stockLogs = stockLogs.filter((l) => String(l.id) !== k);
  stockLogsPending.delete(k); stockLogsRemoved.add(k);
  stockLogsChanged();
}
// What is sent to the server, and what to forget once the server said OK
function stockLogPayload() {
  return { stock_logs: stockLogs, stock_logs_removed: [...stockLogsRemoved],
           _sent: new Set(stockLogs.map((l) => String(l.id))), _removed: [...stockLogsRemoved] };
}
function stockLogsSynced(p) {
  p._sent.forEach((k) => stockLogsPending.delete(k));
  p._removed.forEach((k) => stockLogsRemoved.delete(k));
  saveStockLogsLocal();
}
// Server list + this device's entries the server does not have yet (newest first)
function mergeServerStockLogs(serverLogs, serverRemoved) {
  const gone = new Set((serverRemoved || []).map(String));
  const onServer = new Set(serverLogs.map((l) => String(l.id)));
  stockLogsPending.forEach((k) => { if (onServer.has(k) || gone.has(k)) stockLogsPending.delete(k); });
  const localPhoto = {}; stockLogs.forEach((l) => { if (l.photo) localPhoto[String(l.id)] = l.photo; });
  const waiting = stockLogs.filter((l) => stockLogsPending.has(String(l.id)));
  const fromServer = serverLogs.filter((l) => !stockLogsRemoved.has(String(l.id)) && !gone.has(String(l.id)))
    .map((l) => (!l.photo && localPhoto[String(l.id)] ? Object.assign({}, l, { photo: localPhoto[String(l.id)] }) : l));
  stockLogs = waiting.concat(fromServer).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).slice(0, 500);
  saveStockLogsLocal();
  return waiting.length > 0 || stockLogsRemoved.size > 0;   // true: something still has to be sent
}

function openManagement() {
  document.getElementById('posScreen').classList.remove('active');
  document.getElementById('dashScreen').classList.remove('active');
  document.getElementById('mgmtScreen').classList.add('active');
  const c3 = document.getElementById('clock3');
  if (c3) c3.textContent = document.getElementById('clock').textContent;

  const isOwner = session.role === 'owner' || session.role === 'co_owner';
  // Staff only sees Restock + Stock History
  document.querySelectorAll('.mgmt-tab').forEach(tab => {
    const ownerOnly = tab.getAttribute('data-owner-only') === '1';
    tab.style.display = (ownerOnly && !isOwner) ? 'none' : '';
  });

  // Default tab: restock for staff, keep products for owner
  let defaultTab = document.querySelector('.mgmt-tab[data-tab="restock"]');
  if (isOwner) {
    defaultTab = document.querySelector('.mgmt-tab[data-tab="products"]') || defaultTab;
  }
  if (defaultTab) switchMgmtTab(defaultTab);
  fillRestockSelect();
  renderHistory();
  if (isOwner) {
    renderProductTable();
    renderRecipes();
  }
}


function switchMgmtTab(btn) {
  document.querySelectorAll('.mgmt-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.mgmt-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'products') renderProductTable();
  if (tab === 'history') renderHistory();
  if (tab === 'recipes') renderRecipes();
  if (tab === 'restock') fillRestockSelect();
  if (tab === 'accounts') renderAccountsTable();
}


function daysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const exp = new Date(dateStr + 'T23:59:59');
  if (isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}



function editProduct(id) { showProductForm(id); }






// ----- History -----
function renderHistory() {
  const el = document.getElementById('historyTable');
  if (!el) return;

  const filterEl = document.getElementById('stockHistoryFilter');
  const reasonEl = document.getElementById('stockHistoryReason');
  const filter = (filterEl && filterEl.value || '').trim().toLowerCase();
  const reasonFilter = (reasonEl && reasonEl.value) || 'all';

  let logs = stockLogs.slice();
  if (reasonFilter !== 'all') {
    logs = logs.filter(l => l.reason === reasonFilter);
  }
  if (filter) {
    logs = logs.filter(l => {
      const blob = [l.ingredient, l.reason, l.user, l.notes, String(l.change)].join(' ').toLowerCase();
      return blob.includes(filter);
    });
  }

  if (!logs.length) {
    el.innerHTML = '<div class="empty-block"><span class="empty-ico">📦</span>No inventory changes recorded yet</div>';
    return;
  }

  let html = `<table><thead><tr>
    <th>When</th><th>Item</th><th>Change</th><th>Balance</th><th>Reason</th>
    <th>Exp. date</th><th>Notes</th><th>Photo</th><th>By</th>
  </tr></thead><tbody>`;
  logs.slice(0, 100).forEach(l => {
    const t = new Date(l.time).toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const sign = l.change > 0 ? '+' : '';
    const bal = l.balance != null ? l.balance : '—';
    const reasonLabel = ({
      sale: 'Sale',
      restock: 'Restock',
      adjustment: 'Adjustment',
      waste: 'Waste',
      void: 'Sale voided'
    })[l.reason] || l.reason;
    // expiry may be on field or parsed from notes
    let exp = l.expiry || '—';
    if (!l.expiry && l.notes && /Exp:\s*([\d-]+)/i.test(l.notes)) {
      exp = l.notes.match(/Exp:\s*([\d-]+)/i)[1];
    }
    const notesClean = (l.notes || '')
      .replace(/\s*·\s*Exp:\s*[\d-]+/gi, '')
      .replace(/\s*·\s*\[photo attached\]/gi, '')
      .trim() || '—';
    const photoCell = l.photo
      ? `<img class="hist-thumb" src="${l.photo}" alt="proof" title="Click to view" onclick="openPhotoLightbox(this.src)" />`
      : '—';
    html += `<tr>
      <td>${t}</td>
      <td>${l.ingredient}</td>
      <td style="color:${l.change > 0 ? '#7dcea0' : '#ff8a8a'};font-weight:600">${sign}${l.change}</td>
      <td>${bal}</td>
      <td>${reasonLabel}</td>
      <td style="font-size:0.8rem">${exp}</td>
      <td style="font-size:0.8rem;max-width:140px">${notesClean}</td>
      <td>${photoCell}</td>
      <td>${l.user}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}


// Make sure clock3 updates
const _origTick = tick;
tick = function() {
  _origTick();
  const c3 = document.getElementById('clock3');
  if (c3) c3.textContent = document.getElementById('clock').textContent;
};

// ---------- THEME (Light / Dark) ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('at_theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.setAttribute('aria-pressed', theme === 'dark'));
  const dash = document.getElementById('dashScreen');
  if (dash && dash.classList.contains('active') && typeof buildDashboard === 'function') buildDashboard();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('at_theme') || 'dark';
  applyTheme(saved);
})();


// ---------- FORGOT PASSWORD (Gmail verification) ----------
let resetUser = null; // username that a code was requested for

function isValidGmail(email) {
  email = (email || '').trim().toLowerCase();
  // Accept any email ending in gmail.com for this school project
  return /^[a-z0-9._%+-]+@gmail\.com$/.test(email);
}

function openForgotPassword() {
  resetUser = null;
  document.getElementById('forgotUser').value = '';
  document.getElementById('forgotCode').value = '';
  document.getElementById('forgotNew').value = '';
  document.getElementById('forgotConfirm').value = '';
  document.getElementById('forgotError').hidden = true;
  document.getElementById('forgotError2').hidden = true;
  document.getElementById('forgotStep1').hidden = false;
  document.getElementById('forgotStep2').hidden = true;
  document.getElementById('forgotModal').classList.add('show');
  checkEmailSetup();
  return false;
}

// Warn before the user tries, when this copy cannot email codes yet
async function checkEmailSetup() {
  const w = document.getElementById('forgotSetupWarn'); if (!w) return;
  w.hidden = true;
  if (!API_BASE) { w.textContent = 'Email codes need the server: start server.py and open the site through it (not by double-clicking index.html).'; w.hidden = false; return; }
  try {
    const r = await fetch(API_BASE + '/api/forgot/status', { cache: 'no-store' });
    const d = await r.json();
    if (!d.email_ready) { w.textContent = 'Email is not set up on the server yet. The owner must fill in SMTP_USER and SMTP_PASS in the .env file (see README).'; w.hidden = false; }
  } catch (e) { w.textContent = 'Cannot reach the server. Make sure server.py is running.'; w.hidden = false; }
}

// The 6-digit code is generated and emailed by the SERVER to the email registered on the account.
// It is never shown on screen.
async function sendResetCode() {
  const err = document.getElementById('forgotError');
  const btn = document.getElementById('forgotSendBtn');
  err.hidden = true;
  const user = document.getElementById('forgotUser').value.trim().toLowerCase();
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!user) return fail('Enter your username.');
  if (!API_BASE) return fail('Email codes need the server. Start server.py and open the site through it (see README), not by double-clicking index.html.');
  btn.disabled = true;
  try {
    const res = await fetch(API_BASE + '/api/forgot/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503) return fail('The server cannot send email yet. Ask the owner to set up the email (SMTP) settings — see README.');
    if (!res.ok) return fail(data.error || 'Could not send the code. Try again.');
    resetUser = user;
    document.getElementById('forgotStep1').hidden = true;
    document.getElementById('forgotStep2').hidden = false;
    document.getElementById('forgotError2').hidden = true;
    document.getElementById('forgotCodeHint').textContent =
      'If “' + user + '” has a registered email address, a 6-digit code was just sent to it. Check your inbox (and spam). The code is valid for 10 minutes.';
    toast('Check your registered email for the code', 'ok');
  } catch (e) {
    fail('Cannot reach the server. Make sure server.py is running.');
  } finally {
    btn.disabled = false;
  }
}

async function submitForgotPassword() {
  const err = document.getElementById('forgotError2');
  err.hidden = true;
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!resetUser) return fail('Go back and request a new code.');
  const code = (document.getElementById('forgotCode').value || '').trim();
  const p1 = document.getElementById('forgotNew').value;
  const p2 = document.getElementById('forgotConfirm').value;
  if (!/^\d{6}$/.test(code)) return fail('Enter the 6-digit code from your email.');
  if (!p1 || !p2) return fail('Fill in both password fields.');
  const pol = validatePasswordPolicy(p1);
  if (pol) return fail(pol);
  if (p1 !== p2) return fail('Passwords do not match.');
  try {
    const res = await fetch(API_BASE + '/api/forgot/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: resetUser, code, newHash: await sha256(p1) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'Could not reset the password.');
    resetUser = null;
    await pullSharedState();
    closeAllModals();
    toast('Password updated. Sign in with your new password.', 'ok');
  } catch (e) {
    fail('Cannot reach the server. Make sure server.py is running.');
  }
}

// ---------- ACCOUNT STORAGE (owner management) ----------
function defaultAccounts() {
  return {
    owner:  { pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'owner',  name: 'Owner', email: 'owner.annetea@gmail.com' },
    coowner:{ pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'co_owner', name: 'Co-owner', email: 'coowner.annetea@gmail.com' },
    staff:  { pass: 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c', role: 'staff',  name: 'Staff', email: 'staff.annetea@gmail.com' }
  };
}

function loadAccounts() {
  let accounts = null;
  try {
    const raw = localStorage.getItem('at_accounts');
    if (raw) accounts = JSON.parse(raw);
  } catch (e) { accounts = null; }

  if (!accounts || typeof accounts !== 'object') {
    accounts = defaultAccounts();
  }

  // Migrate old demo password hash (1234) → Annetea@1
  let changed = false;
  Object.keys(accounts).forEach(u => {
    if (accounts[u] && accounts[u].pass === '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4') {
      accounts[u].pass = 'f981d29e764c7051b2e6dfa7a11e5801e471cf532f76d348aeafde1e2eb9af2c';
      changed = true;
    }
  });

  // Ensure default demo accounts always exist + have Gmail
  const defaults = defaultAccounts();
  ['owner', 'coowner', 'staff'].forEach(u => {
    if (!accounts[u]) {
      accounts[u] = defaults[u];
      changed = true;
    } else if (!accounts[u].email) {
      accounts[u].email = defaults[u].email;
      changed = true;
    }
  });

  if (changed || !localStorage.getItem('at_accounts')) {
    localStorage.setItem('at_accounts', JSON.stringify(accounts));
  }

  Object.keys(USERS).forEach(k => delete USERS[k]);
  Object.assign(USERS, accounts);
  return accounts;
}

function saveAccounts(accounts) {
  localStorage.setItem('at_accounts', JSON.stringify(accounts));
  Object.keys(USERS).forEach(k => delete USERS[k]);
  Object.assign(USERS, accounts);
  if (typeof sharedMode !== 'undefined' && sharedMode && typeof pushFullState === 'function') pushFullState();  // keep the shared server in step (otherwise the next sync undoes the change)
}

// Load accounts on boot (before login)
loadAccounts();

function renderAccountsTable() {
  const accounts = loadAccounts();
  const el = document.getElementById('accountsTable');
  if (!el) return;
  let html = `<table><thead><tr><th>Username</th><th>Role</th><th>Gmail</th><th>Identity</th><th>Face login</th><th>Actions</th></tr></thead><tbody>`;
  Object.entries(accounts).forEach(([user, info]) => {
    const roleLabel = { owner: 'Owner', co_owner: 'Co-owner', staff: 'Staff' }[info.role] || info.role;
    const canDelete = user !== 'owner' && user !== session.username;
    html += `<tr>
      <td>${user}</td>
      <td>${roleLabel}</td>
      <td style="font-size:0.8rem">${info.email || '—'}</td>
      <td>${info.idVerified ? '<span class="pill-status ok" title="' + (info.verificationId || '') + '">✓ Verified</span>' : '<span class="pill-status">' + (info.idDeletedAt ? 'ID deleted' : 'Not verified') + '</span>'}</td>
      <td>${info.faceLogin ? '<span class="pill-status ok">On</span>' : '<span class="pill-status">Off</span>'}</td>
      <td>
        <button class="link-btn" onclick="showAccountForm('${user}')">Edit</button>
        ${info.idVerified && session.role === 'owner' ? `<button class="link-btn" onclick="ownerDeleteId('${user}')">Delete ID</button>` : ''}
        ${!info.idVerified ? `<button class="link-btn" onclick="openIdentityVerification('${user}')">Verify ID</button>` : ''}
        ${canDelete ? `<button class="link-btn" onclick="deleteAccount('${user}')">Delete</button>` : ''}
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
  if (typeof renderVerificationLog === 'function') renderVerificationLog();
}

function showAccountForm(editUser) {
  document.getElementById('acctError').hidden = true;
  document.getElementById('accountModalTitle').textContent = editUser ? 'Edit Account' : 'Add Account';
  document.getElementById('acctEditUser').value = editUser || '';
  if (editUser) {
    const accounts = loadAccounts();
    const a = accounts[editUser];
    document.getElementById('acctUsername').value = editUser;
    document.getElementById('acctUsername').disabled = true;
    document.getElementById('acctRole').value = a.role;
    document.getElementById('acctEmail').value = a.email || '';
    document.getElementById('acctPassword').value = '';
    document.getElementById('acctPassLabel').textContent = 'New password (leave blank to keep)';
    document.getElementById('acctPassword').required = false;
  } else {
    document.getElementById('acctUsername').value = '';
    document.getElementById('acctUsername').disabled = false;
    document.getElementById('acctRole').value = 'staff';
    document.getElementById('acctEmail').value = '';
    document.getElementById('acctPassword').value = '';
    document.getElementById('acctPassLabel').textContent = 'Password';
    document.getElementById('acctPassword').required = true;
  }
  document.getElementById('accountModal').classList.add('show');
}

async function saveAccount(e) {
  e.preventDefault();
  const err = document.getElementById('acctError');
  err.hidden = true;
  const editUser = document.getElementById('acctEditUser').value;
  let user = document.getElementById('acctUsername').value.trim().toLowerCase();
  const role = document.getElementById('acctRole').value;
  const pass = document.getElementById('acctPassword').value;
  const accounts = loadAccounts();

  if (!editUser) {
    // New accounts must go through ID + face verification (see idv.js)
    err.textContent = 'New accounts require identity verification. Use “+ Add Account (verify ID)”.';
    err.hidden = false;
    return false;
  }
  if (!editUser) {
    if (!user || user.length < 2) {
      err.textContent = 'Username is required.';
      err.hidden = false;
      return false;
    }
    if (accounts[user]) {
      err.textContent = 'Username already exists.';
      err.hidden = false;
      return false;
    }
    const pol = validatePasswordPolicy(pass);
    if (pol) {
      err.textContent = pol;
      err.hidden = false;
      return false;
    }
    const email = document.getElementById('acctEmail').value.trim().toLowerCase();
    if (email && !isValidGmail(email)) {
      err.textContent = 'Gmail must end with @gmail.com';
      err.hidden = false;
      return false;
    }
    accounts[user] = {
      pass: await sha256(pass),
      role,
      name: role === 'owner' ? 'Owner' : role === 'co_owner' ? 'Co-owner' : 'Staff',
      email: email || ''
    };
  } else {
    user = editUser;
    accounts[user].role = role;
    accounts[user].name = role === 'owner' ? 'Owner' : role === 'co_owner' ? 'Co-owner' : 'Staff';
    const email = document.getElementById('acctEmail').value.trim().toLowerCase();
    if (email && !isValidGmail(email)) {
      err.textContent = 'Gmail must end with @gmail.com';
      err.hidden = false;
      return false;
    }
    accounts[user].email = email || accounts[user].email || '';
    if (pass) {
      const pol2 = validatePasswordPolicy(pass);
      if (pol2) {
        err.textContent = pol2;
        err.hidden = false;
        return false;
      }
      accounts[user].pass = await sha256(pass);
    }
  }
  saveAccounts(accounts);
  closeAllModals();
  renderAccountsTable();
  toast('Account saved', 'ok');
  return false;
}

function deleteAccount(user) {
  if (user === 'owner') {
    toast('Cannot delete the main owner account', 'err');
    return;
  }
  if (!confirm('Delete account "' + user + '"?')) return;
  const accounts = loadAccounts();
  const removed = accounts[user];
  delete accounts[user];
  saveAccounts(accounts);
  renderAccountsTable();
  toast('Account “' + user + '” deleted', 'ok', { label: 'Undo', action: () => {
    const acc = loadAccounts(); if (acc[user]) return;
    acc[user] = removed; saveAccounts(acc); renderAccountsTable();
  } });
}

// Hook accounts tab into switchMgmtTab
const _origSwitchMgmt = typeof switchMgmtTab === 'function' ? switchMgmtTab : null;
// Will patch switchMgmtTab via string replace below

// ---------- LOW STOCK NOTIFICATIONS ----------
let lowStockDismissed = false;

function updateStockButtons(lowCount) {
  document.querySelectorAll('[data-stock-btn]').forEach(btn => {
    let badge = btn.querySelector('.badge');
    btn.classList.toggle('stock-alert', lowCount > 0);
    if (lowCount > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; btn.appendChild(badge); }
      badge.textContent = lowCount;
      btn.title = 'Inventory · ' + lowCount + ' item(s) low';
    } else {
      if (badge) badge.remove();
      btn.title = 'Inventory';
    }
  });
}




// ---------- SALES / PAYMENT HISTORY (all roles) ----------
function openSalesHistory() {
  renderSalesHistory();
  document.getElementById('salesHistoryModal').classList.add('show');
}

function methodPill(m) {
  return `<span class="pill ${String(m).toLowerCase() === 'gcash' ? 'gcash' : 'cash'}">${m}</span>`;
}

function renderSalesHistory() {
  const el = document.getElementById('salesHistoryTable');
  if (!el) return;
  const filter = (document.getElementById('salesHistoryFilter')?.value || '').trim().toLowerCase();
  let sales = getSalesList().slice().reverse();

  if (filter) {
    sales = sales.filter(s => {
      const blob = [
        s.method, s.payment_ref, s.transaction_no, s.user, s.name, s.roleLabel,
        String(s.total), new Date(s.time).toLocaleString('en-PH')
      ].join(' ').toLowerCase();
      return blob.includes(filter);
    });
  }

  if (!sales.length) {
    el.innerHTML = '<div class="empty-block"><span class="empty-ico">🧾</span>No payments yet</div>';
    return;
  }

  let html = `<table><thead><tr>
    <th>Time</th><th>Order</th><th>TIN</th><th>Method</th><th>Total</th><th>Ref / Cash given</th><th>Change</th><th>Proof</th><th>Cashier</th><th></th>
  </tr></thead><tbody>`;

  const canVoid = session && (session.role === 'owner' || session.role === 'co_owner');
  sales.forEach((s) => {
    const t = new Date(s.time);
    const timeStr = t.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let refOrCash = '—';
    let changeCell = '—';
    if (s.method === 'GCash' && s.payment_ref) {
      refOrCash = s.payment_ref;
    } else if (s.method === 'Cash') {
      if (s.tendered != null) refOrCash = '₱' + Number(s.tendered).toFixed(2);
      if (s.change != null) changeCell = '₱' + Number(s.change).toFixed(2);
    }
    const cashier = s.roleLabel || s.user || '—';
    const orderNo = s.order_no || '—';
    const tinNo = s.tin || '—';
    const photoCell = s.payment_photo
      ? `<img class="hist-thumb" src="${s.payment_photo}" alt="proof" onclick="viewPaymentPhoto('${s.id}')" title="View proof" />`
      : '—';
    const voidCell = s.voided
      ? `<span class="pill low" title="Voided by ${s.voided.by || ''}">Voided</span>${canVoid ? ` <button type="button" class="link-btn" onclick="unvoidSale(${s.id})">Restore</button>` : ''}`
      : (canVoid ? `<button type="button" class="link-btn" onclick="voidSale(${s.id})">Void</button>` : '');
    html += `<tr${s.voided ? ' class="sale-voided"' : ''}>
      <td>${timeStr}</td>
      <td>${orderNo}</td>
      <td style="font-family:monospace;font-size:0.78rem">${tinNo}</td>
      <td>${methodPill(s.method)}</td>
      <td>₱${Number(s.total).toFixed(2)}</td>
      <td style="font-family:monospace;font-size:0.82rem">${refOrCash}</td>
      <td>${changeCell}</td>
      <td>${photoCell}</td>
      <td>${cashier}</td>
      <td style="white-space:nowrap"><button type="button" class="link-btn" onclick="viewSaleReceipt(${s.id})">Receipt</button> ${voidCell}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function viewSaleReceipt(saleId) {
  const sales = getSalesList();
  const sale = sales.find(s => s.id === saleId);
  if (!sale) {
    toast('Sale not found', 'err');
    return;
  }
  closeAllModals();
  showReceipt(sale);
}


// ---------- PRODUCT EXPIRY (5-day warning) ----------
function loadProductExpiries() {
  try {
    return JSON.parse(localStorage.getItem('at_product_expiry') || '{}');
  } catch (e) { return {}; }
}
function saveProductExpiry(id, expires) {
  const map = loadProductExpiries();
  if (expires) map[id] = expires;
  else delete map[id];
  localStorage.setItem('at_product_expiry', JSON.stringify(map));
}
function applyStoredExpiries() { /* expiry is stored on each product in the saved catalog (stock-menu.js) */ }

let expiryDismissed = false;
function getExpiringProducts() {
  applyStoredExpiries();
  const list = [];
  getAllProductsFlat().forEach(p => {
    if (!p.expires) return;
    const days = daysUntilExpiry(p.expires);
    if (days == null) return;
    if (days <= 5) list.push({ ...p, daysLeft: days, kind: 'product' });
  });
  // Inventory ingredients
  const expMap = getIngredientExpiryMap();
  Object.keys(expMap).forEach(name => {
    const days = daysUntilExpiry(expMap[name]);
    if (days == null) return;
    if (days <= 5) list.push({ name, expires: expMap[name], daysLeft: days, kind: 'ingredient' });
  });
  list.sort((a, b) => a.daysLeft - b.daysLeft);
  return list;
}



function goToExpiringProducts(e) {
  if (e) e.preventDefault();
  const expiring = getExpiringProducts();
  const hasIngredient = expiring.some(x => x.kind === 'ingredient');
  if (hasIngredient) {
    openInventory({ focusLow: false });
    toast('Check Expires column — items within 5 days are highlighted', 'info');
  } else if (session.role === 'owner' || session.role === 'co_owner') {
    openManagement();
    const tab = document.querySelector('.mgmt-tab[data-tab="products"]');
    if (tab) switchMgmtTab(tab);
    toast('Products expiring within 5 days are marked in the list', 'info');
  } else {
    openInventory();
  }
}


// ---------- OWNER DASHBOARD (day / week / month / year) ----------
let dashPeriod = 'day';

function openDashboard() {
  if (session.role !== 'owner' && session.role !== 'co_owner') return;
  document.getElementById('posScreen').classList.remove('active');
  document.getElementById('todayScreen')?.classList.remove('active');
  document.getElementById('dashScreen').classList.add('active');
  buildDashboard();
}

function backToPOS() {
  document.getElementById('dashScreen').classList.remove('active');
  document.getElementById('mgmtScreen')?.classList.remove('active');
  document.getElementById('todayScreen')?.classList.remove('active');
  document.getElementById('posScreen').classList.add('active');
}

function setDashPeriod(period, btn) {
  dashPeriod = period;
  document.querySelectorAll('#dashPeriodTabs .period-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  buildDashboard();
}

function filterSalesByPeriod(sales, period) {
  const now = new Date();
  return sales.filter(s => {
    if (s.voided) return false;
    const d = new Date(s.time);
    if (isNaN(d.getTime())) return false;
    if (period === 'day') return d.toDateString() === now.toDateString();
    if (period === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0,0,0,0);
      return d >= start;
    }
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (period === 'year') return d.getFullYear() === now.getFullYear();
    return true;
  });
}

function buildDashboard() {
  const sales = getSalesList().filter(s => !s.voided);
  const period = dashPeriod || 'day';
  const filtered = filterSalesByPeriod(sales, period);
  const revenue = filtered.reduce((s, x) => s + (x.total || 0), 0);
  const count = filtered.length;
  const avg = count ? revenue / count : 0;
  const lowCount = lowStockItems().length;

  const labels = {
    day: "Today's Sales",
    week: 'Last 7 Days Sales',
    month: "This Month's Sales",
    year: "This Year's Sales"
  };
  const bestLabels = {
    day: 'Best Sellers Today',
    week: 'Best Sellers (7 days)',
    month: 'Best Sellers (Month)',
    year: 'Best Sellers (Year)'
  };

  const elLabel = document.getElementById('kpiRevenueLabel');
  if (elLabel) elLabel.textContent = labels[period] || labels.day;
  document.getElementById('kpiRevenue').textContent = '₱' + revenue.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  document.getElementById('kpiCount').textContent = count;
  document.getElementById('kpiAvg').textContent = '₱' + avg.toFixed(0);
  document.getElementById('kpiLow').textContent = lowCount;
  const bestTitle = document.getElementById('bestTitle');
  if (bestTitle) bestTitle.textContent = bestLabels[period];

  const tally = {};
  filtered.forEach(s => (s.items || []).forEach(i => {
    tally[i.name] = (tally[i.name] || 0) + i.qty;
  }));
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
  document.getElementById('bestSellers').innerHTML = ranked.length
    ? ranked.map(([name, qty], i) =>
        `<div class="best-item"><div class="best-top"><span><span class="best-rank">${i + 1}</span>${name}</span><span class="best-qty">${qty} sold</span></div><div class="best-bar"><i style="width:${Math.max(6, Math.round(qty / ranked[0][1] * 100))}%"></i></div></div>`
      ).join('')
    : '<div class="empty-block"><span class="empty-ico">📈</span>No sales in this period</div>';

  const recent = filtered.slice().sort((a,b) => new Date(b.time) - new Date(a.time)).slice(0, 10);
  let table = '<table><thead><tr><th>Time</th><th>Order</th><th>TIN</th><th>Cashier</th><th>Method</th><th>Total</th></tr></thead><tbody>';
  recent.forEach(s => {
    const t = new Date(s.time).toLocaleString('en-PH', { month:'short', day:'numeric', hour: '2-digit', minute: '2-digit' });
    table += `<tr><td>${t}</td><td>${s.order_no || '—'}</td><td style="font-size:0.75rem;font-family:monospace">${s.tin || '—'}</td><td>${s.roleLabel || s.user || '—'}</td><td>${methodPill(s.method)}</td><td>₱${Number(s.total).toFixed(2)}</td></tr>`;
  });
  table += '</tbody></table>';
  document.getElementById('recentSales').innerHTML = recent.length ? table : '<div class="empty-block"><span class="empty-ico">🧾</span>No transactions yet</div>';

  // Chart by period
  let chartLabels = [];
  let chartVals = [];
  const chartTitle = document.getElementById('chartTitle');
  if (period === 'day') {
    if (chartTitle) chartTitle.textContent = 'Sales by hour (today)';
    for (let h = 0; h < 24; h++) {
      chartLabels.push(String(h).padStart(2,'0') + ':00');
      chartVals.push(filtered.filter(s => new Date(s.time).getHours() === h).reduce((sum, x) => sum + x.total, 0));
    }
  } else if (period === 'week') {
    if (chartTitle) chartTitle.textContent = 'Sales (last 7 days)';
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toDateString();
      chartLabels.push(d.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric' }));
      chartVals.push(sales.filter(s => new Date(s.time).toDateString() === key).reduce((sum, x) => sum + x.total, 0));
    }
  } else if (period === 'month') {
    if (chartTitle) chartTitle.textContent = 'Sales by day (this month)';
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      chartLabels.push(String(day));
      chartVals.push(filtered.filter(s => new Date(s.time).getDate() === day).reduce((sum, x) => sum + x.total, 0));
    }
  } else {
    if (chartTitle) chartTitle.textContent = 'Sales by month (this year)';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let m = 0; m < 12; m++) {
      chartLabels.push(months[m]);
      chartVals.push(filtered.filter(s => new Date(s.time).getMonth() === m).reduce((sum, x) => sum + x.total, 0));
    }
  }

  const ctx = document.getElementById('salesChart').getContext('2d');
  if (salesChart) salesChart.destroy();
  salesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Revenue (₱)',
        data: chartVals,
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--green-2').trim() || '#1b7a4a',
        borderRadius: 6,
        maxBarThickness: period === 'month' ? 18 : 36
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ₱' + Number(c.parsed.y).toLocaleString('en-PH', { minimumFractionDigits: 2 }) } } },
      scales: {
        x: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), callback: v => '₱' + v.toLocaleString('en-PH') }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--line').trim() } }
      }
    }
  });
}

function openTodayPage() {
  document.getElementById('posScreen').classList.remove('active');
  document.getElementById('dashScreen')?.classList.remove('active');
  document.getElementById('mgmtScreen')?.classList.remove('active');
  document.getElementById('todayScreen').classList.add('active');
  const c = document.getElementById('clockToday');
  if (c) c.textContent = document.getElementById('clock')?.textContent || '';
  buildTodayPage();
}

function backToPOSFromToday() {
  document.getElementById('todayScreen').classList.remove('active');
  document.getElementById('posScreen').classList.add('active');
}

function buildTodayPage() {
  const sales = filterSalesByPeriod(getSalesList(), 'day')
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const revenue = sales.reduce((s, x) => s + (x.total || 0), 0);
  const cash = sales.filter(s => s.method === 'Cash').reduce((s, x) => s + x.total, 0);
  const gcash = sales.filter(s => s.method === 'GCash').reduce((s, x) => s + x.total, 0);
  document.getElementById('todayRevenue').textContent = '₱' + revenue.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  document.getElementById('todayCount').textContent = sales.length;
  document.getElementById('todayCash').textContent = '₱' + cash.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  document.getElementById('todayGcash').textContent = '₱' + gcash.toLocaleString('en-PH', { maximumFractionDigits: 0 });

  const el = document.getElementById('todayTable');
  if (!sales.length) {
    el.innerHTML = '<div class="empty-block"><span class="empty-ico">🧋</span>No transactions yet today</div>';
    return;
  }
  let html = `<table><thead><tr>
    <th>Time</th><th>Order</th><th>TIN</th><th>Method</th><th>Total</th><th>Ref / Cash given</th><th>Change</th><th>Proof</th><th>Cashier</th><th></th>
  </tr></thead><tbody>`;
  sales.forEach(s => {
    const t = new Date(s.time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    let refOrCash = '—';
    let changeCell = '—';
    if (s.method === 'GCash' && s.payment_ref) refOrCash = s.payment_ref;
    else if (s.method === 'Cash') {
      if (s.tendered != null) refOrCash = '₱' + Number(s.tendered).toFixed(2);
      if (s.change != null) changeCell = '₱' + Number(s.change).toFixed(2);
    }
    const photoCell = s.payment_photo
      ? `<img class="hist-thumb" src="${s.payment_photo}" alt="proof" onclick="viewPaymentPhoto('${s.id}')" title="View proof" />`
      : '—';
    html += `<tr>
      <td>${t}</td>
      <td>${s.order_no || '—'}</td>
      <td style="font-family:monospace;font-size:0.78rem">${s.tin || '—'}</td>
      <td>${methodPill(s.method)}</td>
      <td>₱${Number(s.total).toFixed(2)}</td>
      <td style="font-family:monospace;font-size:0.82rem">${refOrCash}</td>
      <td>${changeCell}</td>
      <td>${photoCell}</td>
      <td>${s.roleLabel || s.user || '—'}</td>
      <td><button type="button" class="link-btn" onclick="viewSaleReceipt(${s.id})">Receipt</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}


// ---------- SHARED DATA (multi-device via server.py) ----------
const API_BASE = (function() {
  if (location.protocol === 'file:') return '';
  return location.origin;
})();
let sharedMode = false;

function getSalesList() {
  try { return JSON.parse(localStorage.getItem('at_sales') || '[]'); }
  catch (e) { return []; }
}
function setSalesList(list) {
  for (let tries = 0; tries < 200; tries++) {
    try { localStorage.setItem('at_sales', JSON.stringify(list)); return; }
    catch (e) {   // browser storage full: drop the oldest proof photos (the sale itself is always kept)
      const old = list.find(s => s.payment_photo);
      if (!old) throw e;
      old.payment_photo = null; old.photo_dropped = true;
      if (tries === 0 && typeof toast === 'function') toast('Storage is full — older GCash proof photos were removed to save this sale.', 'err');
    }
  }
}

async function pullSharedState() {
  if (!API_BASE) {
    sharedMode = false;
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = 'Local mode only — open via http://PC-IP:5000 to sync devices';
    return;
  }
  try {
    const res = await fetch(API_BASE + '/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('no server');
    const data = await res.json();
    sharedMode = true;
    if (!data.accounts || !data.catalog) pushFullState();   // first run: give the server the accounts so it can email reset codes
    const serverMenuOld = data.catalog && (data.catalog.v || 0) < CATALOG_VERSION;
    if (serverMenuOld) {   // another device still has the old menu: this copy has the new recipe list, so send it
      data.catalog = null;
      if (data.inventory && typeof migrateInventory === 'function') data.inventory = migrateInventory(data.inventory);
    }
    if (data.catalog && typeof applyCatalog === 'function' && JSON.stringify(data.catalog) !== JSON.stringify(catalogSnapshot())) {
      applyCatalog(data.catalog); localStorage.setItem('at_catalog', JSON.stringify(data.catalog));
      if (document.getElementById('productGrid')) { renderCategories(); renderProducts(); }
    }
    if (Array.isArray(data.sales)) setSalesList(data.sales);
    if (data.inventory && typeof data.inventory === 'object') {
      inventory = data.inventory;
      saveInventory();
    }
    if (Array.isArray(data.stock_logs)) {
      if (mergeServerStockLogs(data.stock_logs, data.stock_logs_removed)) stockLogsChanged();
      if (typeof renderHistory === 'function' && document.getElementById('historyTable')) renderHistory();
    }
    if (data.ingredient_expiry) {
      localStorage.setItem('at_ingredient_expiry', JSON.stringify(data.ingredient_expiry));
    }
    if (!serverMenuOld && data.ingredient_min && typeof data.ingredient_min === 'object') {
      localStorage.setItem('at_ingredient_min', JSON.stringify(data.ingredient_min));
    }
    if (!serverMenuOld && data.ingredient_unit && typeof data.ingredient_unit === 'object') {
      localStorage.setItem('at_ingredient_unit', JSON.stringify(data.ingredient_unit));
    }
    if (Array.isArray(data.verifications) && typeof idvMergeRemoteRecords === 'function') idvMergeRemoteRecords(data.verifications);
    if (data.accounts) {
      localStorage.setItem('at_accounts', JSON.stringify(data.accounts));
      Object.keys(USERS).forEach(k => delete USERS[k]);
      Object.assign(USERS, data.accounts);
    }
    if (serverMenuOld) pushFullState();
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = '✓ Shared mode — devices on this server see the same data';
  } catch (e) {
    sharedMode = false;
    const el = document.getElementById('syncStatus');
    if (el) el.textContent = 'Local mode — start server.py for multi-device sync';
  }
}

async function pushSaleToServer(sale) {
  if (!API_BASE) return;
  try {
    await fetch(API_BASE + '/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sale)
    });
  } catch (e) {}
}

async function pushInventoryToServer() {
  if (!API_BASE || !sharedMode) return;
  const logs = stockLogPayload();
  try {
    const res = await fetch(API_BASE + '/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory,
        ingredient_expiry: getIngredientExpiryMap(),
        ingredient_min: typeof getMinMap === 'function' ? getMinMap() : {},
        ingredient_unit: typeof getUnitMap === 'function' ? getUnitMap() : {},
        stock_logs: logs.stock_logs,
        stock_logs_removed: logs.stock_logs_removed
      })
    });
    if (res.ok) stockLogsSynced(logs);
  } catch (e) {}
}

async function pushFullState() {
  if (!API_BASE || !sharedMode) return;
  const logs = stockLogPayload();
  try {
    const res = await fetch(API_BASE + '/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales: getSalesList(),
        inventory,
        stock_logs: logs.stock_logs,
        stock_logs_removed: logs.stock_logs_removed,
        accounts: JSON.parse(localStorage.getItem('at_accounts') || '{}'),
        verifications: JSON.parse(localStorage.getItem('at_verifications') || '[]'),
        catalog: typeof catalogSnapshot === 'function' ? catalogSnapshot() : null,
        ingredient_expiry: getIngredientExpiryMap(),
        ingredient_min: typeof getMinMap === 'function' ? getMinMap() : {},
        ingredient_unit: typeof getUnitMap === 'function' ? getUnitMap() : {}
      })
    });
    if (res.ok) stockLogsSynced(logs);
  } catch (e) {}
}

// Pull shared data on load
pullSharedState();
// Refresh sales every 15s when in shared mode
setInterval(() => { if (sharedMode) pullSharedState(); }, 15000);


// ---------- CHANGE OWN PASSWORD (admin / any logged-in user) ----------
function openChangePassword() {
  document.getElementById('chgPassCurrent').value = '';
  document.getElementById('chgPassNew').value = '';
  document.getElementById('chgPassConfirm').value = '';
  document.getElementById('chgPassError').hidden = true;
  document.getElementById('changePassModal').classList.add('show');
}

async function submitChangePassword() {
  const err = document.getElementById('chgPassError');
  err.hidden = true;
  const cur = document.getElementById('chgPassCurrent').value;
  const n1 = document.getElementById('chgPassNew').value;
  const n2 = document.getElementById('chgPassConfirm').value;
  if (!session) return;
  const accounts = loadAccounts();
  const me = accounts[session.username];
  if (!me) {
    err.textContent = 'Account not found.';
    err.hidden = false;
    return;
  }
  const curHash = await sha256(cur);
  if (curHash !== me.pass) {
    err.textContent = 'Current password is incorrect.';
    err.hidden = false;
    return;
  }
  const pol = validatePasswordPolicy(n1);
  if (pol) {
    err.textContent = pol;
    err.hidden = false;
    return;
  }
  if (n1 !== n2) {
    err.textContent = 'New passwords do not match.';
    err.hidden = false;
    return;
  }
  me.pass = await sha256(n1);
  accounts[session.username] = me;
  saveAccounts(accounts);
  closeAllModals();
  toast('Password changed successfully', 'ok');
}


function viewPaymentPhoto(saleId) {
  const sale = getSalesList().find(s => String(s.id) === String(saleId));
  if (!sale || !sale.payment_photo) {
    toast('No photo for this payment', 'err');
    return;
  }
  openPhotoLightbox(sale.payment_photo);
}


// ---------- UX: modal dismissal (Esc / click outside) ----------
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal.show');
  if (!open) return;
  if (open.id === 'idvModal') return; // handled by idv.js (asks before discarding progress)
  if (open.id === 'gcashModal') cancelGCash(); else closeAllModals();
});
document.addEventListener('mousedown', (e) => {
  const m = e.target;
  // Payment modals are excluded so a stray tap can't lose an in-progress payment
  if (m.classList && m.classList.contains('modal') && m.classList.contains('show') && !['cashModal', 'gcashModal', 'idvModal'].includes(m.id)) {
    closeAllModals();
  }
});


// ---------- PHOTO LIGHTBOX (preview → full view on click) ----------
function openPhotoLightbox(src) {
  if (!src) return;
  let box = document.getElementById('photoLightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'photoLightbox';
    box.className = 'photo-lightbox';
    box.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">&times;</button><img alt="Preview" />';
    document.body.appendChild(box);
    box.addEventListener('click', (e) => {
      if (e.target === box || e.target.classList.contains('lightbox-close')) closePhotoLightbox();
    });
  }
  box.querySelector('img').src = src;
  box.classList.add('show');
}
function closePhotoLightbox() {
  const box = document.getElementById('photoLightbox');
  if (box) box.classList.remove('show');
}


// Enhance GCash / history thumbs to use lightbox
document.addEventListener('click', (e) => {
  const img = e.target.closest('img.hist-thumb, #gcashPhotoPreview img, #restockPhotoPreview img');
  if (img && img.src) {
    e.preventDefault();
    openPhotoLightbox(img.src);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  try { rebuildUsedFromSales(); } catch (e) {}
});
