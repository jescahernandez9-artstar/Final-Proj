/* AnneTea BrewTrack POS
   Secure login · GCash payment · Light/Dark theme · Owner Dashboard
*/


// Production: use server-side bcrypt. Hash below = SHA-256 of "1234".
const USERS = {
  owner:  { pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'owner',  name: 'Christine De Chavez' },
  coowner:{ pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'co_owner', name: 'Jessica Hernandez' },
  staff:  { pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'staff',  name: 'Niur Rayne Marasigan' }
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
let session = null;
let pendingGCash = null; // { total, ref }

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

function toast(msg, type) {
  type = type || 'info';
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2800);
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  const lockMsg = document.getElementById('lockoutMsg');
  err.hidden = true;
  lockMsg.hidden = true;

  const state = getLoginState();
  if (state.lockUntil && Date.now() < state.lockUntil) {
    const secs = Math.ceil((state.lockUntil - Date.now()) / 1000);
    lockMsg.textContent = 'Too many failed attempts. Try again in ' + secs + 's.';
    lockMsg.hidden = false;
    return false;
  }
  if (state.lockUntil && Date.now() >= state.lockUntil) {
    setLoginState({ attempts: 0 });
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const user = document.getElementById('username').value.trim().toLowerCase();
  const pass = document.getElementById('password').value;
  const hash = await sha256(pass);
  const account = USERS[user];

  await new Promise(r => setTimeout(r, 350));

  if (!account || account.pass !== hash) {
    const attempts = (getLoginState().attempts || 0) + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      setLoginState({ attempts, lockUntil: Date.now() + LOCKOUT_MS });
      err.textContent = 'Account temporarily locked after ' + MAX_LOGIN_ATTEMPTS + ' failed attempts.';
      lockMsg.textContent = 'Wait 2 minutes before trying again.';
      lockMsg.hidden = false;
    } else {
      setLoginState({ attempts });
      err.textContent = 'Invalid username or password (' + attempts + '/' + MAX_LOGIN_ATTEMPTS + ')';
    }
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return false;
  }

  setLoginState({ attempts: 0 });
  session = {
    username: user,
    role: account.role,
    name: account.name,
    token: crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)),
    expires: Date.now() + 8 * 60 * 60 * 1000
  };
  saveSession();
  toast('Welcome, ' + account.name.split(' ')[0], 'ok');
  enterApp();
  return false;
}

function doLogout() {
  if (order.length && !confirm('There is an open order. Logout anyway?')) return;
  clearSession();
  order = [];
  pendingGCash = null;
  ['posScreen','dashScreen','mgmtScreen','todayScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
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
const CATEGORIES = [
  { id: 'classic', label: 'Classic' },
  { id: 'creamcheese', label: 'Creamcheese' },
  { id: 'creampuff', label: 'Creampuff' },
  { id: 'cheesecake', label: 'Cheesecake' },
  { id: 'house', label: 'House' },
  { id: 'salty', label: 'Salty Cream' },
  { id: 'fruitea', label: 'Fruitea' },
  { id: 'summer', label: 'Summer Drinks' },
  { id: 'frappe', label: 'Frappe' },
  { id: 'coldbrew', label: 'Cold Brew' },
  { id: 'latte', label: 'Latte' },
  { id: 'dirty', label: 'Dirty Milk' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'rice', label: 'Rice Meals' },
  { id: 'sinkers', label: 'Add-ons' }
];

const MENU = {
  classic: [
    { id:'c1', name:'Plain Milk Tea', prices:{M:70,L:80,XL:125} },
    { id:'c2', name:'Wintermelon', prices:{M:75,L:85,XL:130}, star:true },
    { id:'c3', name:'Okinawa', prices:{M:80,L:90,XL:140} },
    { id:'c4', name:'Salted Caramel', prices:{M:80,L:90,XL:140}, star:true },
    { id:'c5', name:'Red Velvet', prices:{M:80,L:90,XL:140}, star:true },
    { id:'c6', name:'Cheesecake', prices:{M:80,L:90,XL:140} }
  ],
  creamcheese: [
    { id:'cc1', name:'Dark Chocolate', prices:{M:80,L:90,XL:150} },
    { id:'cc2', name:'Cookies & Cream', prices:{M:80,L:90,XL:150}, star:true },
    { id:'cc3', name:'Strawberry', prices:{M:80,L:90,XL:150} },
    { id:'cc4', name:'Oreo', prices:{M:80,L:90,XL:150}, star:true },
    { id:'cc5', name:'Vanilla Cookie', prices:{M:80,L:90,XL:150} },
    { id:'cc6', name:'Matcha', prices:{M:90,L:100,XL:160}, star:true }
  ],
  creampuff: [
    { id:'cp1', name:'Wintermelon Creampuff', prices:{M:90,L:100,XL:160} },
    { id:'cp2', name:'Okinawa Creampuff', prices:{M:95,L:105,XL:170} },
    { id:'cp3', name:'Red Velvet Creampuff', prices:{M:95,L:105,XL:170} },
    { id:'cp4', name:'Dark Chocolate Creampuff', prices:{M:95,L:105,XL:170} },
    { id:'cp5', name:'Strawberry Creampuff', prices:{M:95,L:105,XL:170} },
    { id:'cp6', name:'Vanilla Cookie Creampuff', prices:{M:95,L:105,XL:170} },
    { id:'cp7', name:'Matcha Creampuff', prices:{M:100,L:110,XL:180} },
    { id:'cp8', name:'Chocomalt Creampuff', prices:{M:100,L:110,XL:180} },
    { id:'cp9', name:'Cookies & Creampuff', prices:{M:100,L:110,XL:180} },
    { id:'cp10', name:'Nutella Creampuff', prices:{M:110,L:120,XL:190} }
  ],
  cheesecake: [
    { id:'ch1', name:'Wintermelon Cheesecake', prices:{M:100,L:110,XL:170} },
    { id:'ch2', name:'Okinawa Cheesecake', prices:{M:110,L:120,XL:190} },
    { id:'ch3', name:'Red Velvet Cheesecake', prices:{M:110,L:120,XL:190} },
    { id:'ch4', name:'Dark Chocolate Cheesecake', prices:{M:110,L:120,XL:190} },
    { id:'ch5', name:'Strawberry Cheesecake', prices:{M:110,L:120,XL:190} },
    { id:'ch6', name:'Vanilla Cookie Cheesecake', prices:{M:110,L:120,XL:190} },
    { id:'ch7', name:'Matcha Cheesecake', prices:{M:115,L:125,XL:195} },
    { id:'ch8', name:'Chocomalt Cheesecake', prices:{M:115,L:125,XL:195} },
    { id:'ch9', name:'Nutella Cheesecake', prices:{M:115,L:125,XL:195} }
  ],
  house: [
    { id:'h1', name:"Annetea's Special", prices:{M:90,L:100,XL:160}, star:true },
    { id:'h2', name:'Brown Sugar Milk', prices:{M:90,L:100,XL:160} },
    { id:'h3', name:'Choco Nutella', prices:{M:95,L:105,XL:170} },
    { id:'h4', name:'Triple Chocolate', prices:{M:95,L:105,XL:170} },
    { id:'h5', name:'Milo Dinosaur', prices:{M:110,L:120,XL:190} },
    { id:'h6', name:'Cheese Cream & Pearl MT', prices:{M:110,L:120,XL:190} },
    { id:'h7', name:'Biscoff Cheescoff', prices:{M:120,L:130,XL:190} }
  ],
  salty: [
    { id:'s1', name:'Okinawa & Salty Cream', prices:{M:100,L:110,XL:180} },
    { id:'s2', name:'Salted Caramel & Salty Cream', prices:{M:100,L:110,XL:180} },
    { id:'s3', name:'Dark Choco & Salty Cream', prices:{M:100,L:110,XL:180} },
    { id:'s4', name:'Matcha & Salty Cream', prices:{M:105,L:110,XL:190} },
    { id:'s5', name:"Annetea's Special & Salty Cream", prices:{M:105,L:110,XL:190}, star:true }
  ],
  fruitea: [
    { id:'f1', name:'Lychee', prices:{M:80,L:90,XL:140} },
    { id:'f2', name:'Lemon', prices:{M:80,L:90,XL:140} },
    { id:'f3', name:'Green Apple', prices:{M:80,L:90,XL:140} },
    { id:'f4', name:'Strawberry', prices:{M:80,L:90,XL:140} },
    { id:'f5', name:'Blueberry', prices:{M:80,L:90,XL:140} },
    { id:'f6', name:'Passion Fruit', prices:{M:80,L:90,XL:140} },
    { id:'f7', name:"Annetea's Signature Fruitea", prices:{M:100,L:110,XL:180}, star:true }
  ],
  summer: [
    { id:'su1', name:'Mango Graham', prices:{M:120,L:135} },
    { id:'su2', name:'Ube Cheese Macapuno', prices:{M:115,L:130} },
    { id:'su3', name:'Oreovocado', prices:{M:120,L:135} },
    { id:'su4', name:'Mais Con Hielo', prices:{M:110,L:125} },
    { id:'su5', name:'Halo Especial', prices:{M:130,L:140} }
  ],
  frappe: [
    { id:'fr1', name:'Strawberry Choco', prices:{M:100,L:110} },
    { id:'fr2', name:'Vanilla Cookie', prices:{M:100,L:110} },
    { id:'fr3', name:'Rocky Road', prices:{M:100,L:110} },
    { id:'fr4', name:'Strawberry Cheesecake', prices:{M:100,L:110} },
    { id:'fr5', name:'Blueberry Cheesecake', prices:{M:100,L:110} },
    { id:'fr6', name:'Ferrero', prices:{M:100,L:110} },
    { id:'fr7', name:'Macchiato', prices:{M:100,L:110} },
    { id:'fr8', name:'Cappuccino', prices:{M:100,L:110} },
    { id:'fr9', name:'Nutella', prices:{M:110,L:120} },
    { id:'fr10', name:'Caramel Creme Cheesecake', prices:{M:110,L:120} },
    { id:'fr11', name:'Java Chip', prices:{M:110,L:120} },
    { id:'fr12', name:'Matcha', prices:{M:110,L:120} },
    { id:'fr13', name:'Lotus Biscoff', prices:{M:140,L:160} }
  ],
  coldbrew: [
    { id:'cb1', name:'Cold Brew Americano', prices:{L:80} },
    { id:'cb2', name:'Cold Brew Latte', prices:{L:120} },
    { id:'cb3', name:'Cold Brew Cappuccino', prices:{L:120} },
    { id:'cb4', name:'Iced Brown Sugar Latte', prices:{L:120} },
    { id:'cb5', name:'Dark Mocha Latte', prices:{L:120} },
    { id:'cb6', name:'Iced Caramel Macchiato', prices:{L:120} },
    { id:'cb7', name:'Iced Hazelnut Macchiato', prices:{L:120} },
    { id:'cb8', name:'Iced Vanilla Macchiato', prices:{L:120} }
  ],
  latte: [
    { id:'l1', name:'Choco Latte', prices:{M:90,L:100,XL:150} },
    { id:'l2', name:'Matcha Latte', prices:{M:90,L:100,XL:150} },
    { id:'l3', name:'Strawberry Latte', prices:{M:90,L:100,XL:150} }
  ],
  dirty: [
    { id:'d1', name:'Strawberry Dirty Milk', prices:{M:90,L:100,XL:160} },
    { id:'d2', name:'Matcha Dirty Milk', prices:{M:90,L:100,XL:160} },
    { id:'d3', name:'Blueberry Dirty Milk', prices:{M:90,L:100,XL:160} }
  ],
  snacks: [
    { id:'sn1', name:'Flame-Grilled Burger', prices:{REG:125} },
    { id:'sn2', name:'Chicken Nuggets 5pcs', prices:{REG:90} },
    { id:'sn3', name:'Chicken Nuggets 10pcs', prices:{REG:150} },
    { id:'sn4', name:'Lava Fries', prices:{REG:130} },
    { id:'sn5', name:'Solo Fries', prices:{REG:45} },
    { id:'sn6', name:'Nachos with Beef', prices:{REG:110} },
    { id:'sn7', name:'Fries with Beef', prices:{REG:120} }
  ],
  rice: [
    { id:'r1', name:'Spam & Egg', prices:{REG:99} },
    { id:'r2', name:'Hungarian', prices:{REG:109} },
    { id:'r3', name:'Hotsilog', prices:{REG:99} },
    { id:'r4', name:'Tocilog', prices:{REG:99} },
    { id:'r5', name:'Nug-Egg', prices:{REG:99} }
  ],
  sinkers: [
    { id:'sk1', name:'Pearl', prices:{REG:15} },
    { id:'sk2', name:'Crushed Oreo', prices:{REG:20} },
    { id:'sk3', name:'Nata de Coco', prices:{REG:20} },
    { id:'sk4', name:'Creamcheese', prices:{REG:20} },
    { id:'sk5', name:'Whipped Cream', prices:{REG:20} },
    { id:'sk6', name:'Salty Cream', prices:{REG:25} },
    { id:'sk7', name:'Creampuff', prices:{REG:30} },
    { id:'sk8', name:'Cheesecake Cream', prices:{REG:30} }
  ]
};

// Simple recipe → ingredient usage (for auto-deduction)
const RECIPES = {
  // default milk tea style
  default_mt: { 'Pearl': 1, 'Milk': 0.2, 'Tea Base': 0.15, 'Sugar': 0.1 },
  summer: { 'Ice Cream': 1, 'Milk': 0.15 },
  snacks_burger: { 'Beef Patty': 1 },
  snacks_nuggets: { 'Chicken Nuggets': 1 },
  rice: { 'Rice': 1, 'Egg': 1 }
};

// Inventory
let inventory = JSON.parse(localStorage.getItem('at_inventory') || 'null') || {
  'Pearl': 180, 'Milk': 45, 'Tea Base': 38, 'Sugar': 28,
  'Creamcheese': 22, 'Ice Cream': 18, 'Mango': 14, 'Ube Halaya': 11,
  'Avocado': 9, 'Corn': 16, 'Beef Patty': 28, 'Chicken Nuggets': 75,
  'Rice': 35, 'Egg': 48, 'Spam': 18, 'Tocino': 14, 'Hotdog': 22,
  'Whipped Cream': 30, 'Salty Cream': 20
};
const MIN_STOCK = 12;

function saveInventory() {
  localStorage.setItem('at_inventory', JSON.stringify(inventory));
  if (typeof pushInventoryToServer === 'function') pushInventoryToServer();
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
    `<button class="cat-btn ${c.id === currentCat ? 'active' : ''}" data-id="${c.id}">${c.label}</button>`
  ).join('');
  nav.querySelectorAll('.cat-btn').forEach(btn => {
    btn.onclick = () => {
      currentCat = btn.dataset.id;
      renderCategories();
      renderProducts();
    };
  });
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  const items = MENU[currentCat] || [];
  grid.innerHTML = items.map(p => {
    const keys = Object.keys(p.prices);
    const priceStr = keys.length === 1
      ? `₱${p.prices[keys[0]]}`
      : keys.map(k => `${k} ₱${p.prices[k]}`).join(' · ');
    return `<button class="prod ${p.star ? 'star' : ''}" data-id="${p.id}">
      <div class="prod-name">${p.name}</div>
      <div class="prod-price">${priceStr}</div>
    </button>`;
  }).join('');
  grid.querySelectorAll('.prod').forEach(btn => {
    btn.onclick = () => selectProduct(btn.dataset.id);
  });
}

const DRINK_CATS = new Set(['classic','creamcheese','creampuff','cheesecake','house','salty','fruitea','summer','frappe','coldbrew','latte','dirty']);
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
    `<button class="size-btn" data-size="${s}">${s}<br>₱${p.prices[s]}</button>`
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

function addItem(product, size, price, sugar) {
  const sugarKey = sugar == null ? '' : String(sugar);
  const found = order.find(i => i.id === product.id && i.size === size && (i.sugar || '') === sugarKey);
  if (found) found.qty++;
  else order.push({
    id: product.id,
    name: product.name,
    size,
    price,
    qty: 1,
    sugar: sugarKey || null,
    sugarLabel: sugarKey === '0' ? 'No Sugar' : (sugarKey ? sugarKey + '%' : null)
  });
  renderOrder();
}

// ---------- ORDER ----------
function renderOrder() {
  const body = document.getElementById('orderList');
  if (!order.length) {
    body.innerHTML = '<div class="empty-state">Tap items to add</div>';
  } else {
    body.innerHTML = order.map(i => `
      <div class="line">
        <div class="line-qty">${i.qty}</div>
        <div class="line-info">
          <div class="line-name">${i.name}</div>
          <div class="line-size">${i.size}${i.sugarLabel ? ' · ' + i.sugarLabel : ''}</div>
        </div>
        <div class="line-amt">₱${(i.price * i.qty).toFixed(2)}</div>
      </div>`).join('');
  }
  const sub = order.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('subtotal').textContent = `₱${sub.toFixed(2)}`;
  document.getElementById('grandTotal').textContent = `₱${sub.toFixed(2)}`;
}

function clearOrder() {
  if (!order.length) return;
  if (confirm('Clear the whole order?')) {
    order = [];
    renderOrder();
  }
}

function voidLastItem() {
  if (!order.length) return;
  order.pop();
  renderOrder();
}

// ---------- PAYMENT + INVENTORY RULES ----------
function logStockChange(ingredient, change, reason, notes) {
  if (typeof stockLogs === 'undefined') return;
  const after = inventory[ingredient];
  const log = {
    id: Date.now() + Math.random(),
    ingredient,
    change: +Number(change).toFixed(2),
    balance: after != null ? +Number(after).toFixed(2) : null,
    reason,
    notes: notes || '',
    user: (session && (session.roleLabel || session.username || session.name)) || 'system',
    time: new Date().toISOString()
  };
  // roleLabel may not be on session - use username
  if (session) log.user = session.username || session.name || 'user';
  stockLogs.unshift(log);
  if (stockLogs.length > 500) stockLogs.length = 500;
  localStorage.setItem('at_stock_logs', JSON.stringify(stockLogs));
}

function deductInventory(items) {
  items.forEach(item => {
    const name = item.name.toLowerCase();
    let recipe = RECIPES.default_mt;
    if (name.includes('summer') || name.includes('mango') || name.includes('halo') || name.includes('mais') || name.includes('oreovocado') || name.includes('ube')) {
      recipe = RECIPES.summer;
    } else if (name.includes('burger')) {
      recipe = RECIPES.snacks_burger;
    } else if (name.includes('nugget')) {
      recipe = RECIPES.snacks_nuggets;
    } else if (name.includes('silog') || name.includes('spam') || name.includes('hungarian') || name.includes('nug-egg') || name.includes('tocilog')) {
      recipe = RECIPES.rice;
    }
    Object.entries(recipe).forEach(([ing, qty]) => {
      if (inventory[ing] !== undefined) {
        const used = +(qty * item.qty).toFixed(2);
        inventory[ing] = Math.max(0, +(inventory[ing] - used).toFixed(2));
        logStockChange(ing, -used, 'sale', item.qty + 'x ' + item.name + (item.size ? ' (' + item.size + ')' : ''));
      }
    });
  });
  saveInventory();
}

function completeSale(method, extra) {
  extra = extra || {};
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  deductInventory(order);

  const roleLabel = { owner: 'Owner', co_owner: 'Co-owner', staff: 'Staff' }[session.role] || session.role;
  const sale = {
    id: Date.now(),
    transaction_no: (method === 'GCash' && extra.ref) ? extra.ref : ('AT' + Date.now()),
    items: JSON.parse(JSON.stringify(order)),
    total,
    method,
    payment_ref: extra.ref || null,
    tendered: extra.tendered != null ? extra.tendered : null,
    change: extra.change != null ? extra.change : null,
    user: session.username,
    name: session.name,
    roleLabel: roleLabel,
    time: new Date().toISOString()
  };
  const all = getSalesList();
  all.push(sale);
  setSalesList(all);
  pushSaleToServer(sale);

  showReceipt(sale);
  order = [];
  renderOrder();
  toast('Sale completed · ' + method + ' · ₱' + total.toFixed(2), 'ok');
  checkLowStockNotify();
}

function takePayment(method) {
  if (!order.length) {
    toast('Add items first', 'err');
    return;
  }
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
  closeAllModals();
}

function openGCash() {
  if (!order.length) {
    toast('Add items first', 'err');
    return;
  }
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  pendingGCash = { total };
  document.getElementById('gcashAmount').textContent = '₱' + total.toFixed(2);
  const input = document.getElementById('gcashRefInput');
  input.value = '';
  document.getElementById('gcashStatus').textContent = '';
  document.getElementById('gcashStatus').className = 'gcash-status';
  document.getElementById('gcashConfirmBtn').disabled = false;
  document.getElementById('gcashModal').classList.add('show');
  setTimeout(() => input.focus(), 100);

  // live validation while typing
  input.oninput = () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 13);
    input.value = digits;
    const st = document.getElementById('gcashStatus');
    if (!digits.length) {
      st.textContent = '';
      st.className = 'gcash-status';
    } else if (digits.length < 13) {
      st.textContent = 'Reference must be exactly 13 digits (' + digits.length + '/13)';
      st.className = 'gcash-status waiting';
    } else {
      st.textContent = '13 digits entered — ready to confirm';
      st.className = 'gcash-status success';
    }
  };
}

function confirmGCashPayment() {
  if (!pendingGCash || !order.length) {
    closeAllModals();
    return;
  }
  const ref = (document.getElementById('gcashRefInput').value || '').replace(/\D/g, '');
  const st = document.getElementById('gcashStatus');
  if (!/^\d{13}$/.test(ref)) {
    st.textContent = 'Invalid reference. Enter exactly 13 numbers (no letters or spaces).';
    st.className = 'gcash-status waiting';
    document.getElementById('gcashRefInput').focus();
    toast('GCash reference must be exactly 13 digits', 'err');
    return;
  }
  st.textContent = 'Saving reference and completing sale…';
  st.className = 'gcash-status success';
  document.getElementById('gcashConfirmBtn').disabled = true;
  setTimeout(() => {
    completeSale('GCash', { ref: ref });
    pendingGCash = null;
    closeAllModals();
  }, 400);
}

function cancelGCash() {
  pendingGCash = null;
  closeAllModals();
  toast('GCash payment cancelled', 'info');
}

// ---------- RECEIPT ----------
function showReceipt(sale) {
  const paper = document.getElementById('receiptPaper');
  const d = new Date(sale.time);
  let t = '';
  t += '      ANNETEA BREWTRACK\n';
  t += '  Sitio Trangka, Pinagsibaan\n';
  t += '     Rosario, Batangas\n';
  t += '--------------------------------\n';
  t += d.toLocaleString('en-PH') + '\n';
  t += 'Cashier: ' + (sale.roleLabel || sale.name || sale.user) + '\n';
  t += 'Ref: ' + sale.id + '\n';
  t += '--------------------------------\n';
  sale.items.forEach(i => {
    const sug = i.sugarLabel ? ' ' + i.sugarLabel : '';
    const line = `${i.qty}x ${i.name} (${i.size}${sug})`;
    const amt = `₱${(i.price * i.qty).toFixed(2)}`;
    t += line.substring(0, 24).padEnd(24) + amt.padStart(8) + '\n';
  });
  t += '--------------------------------\n';
  t += 'TOTAL'.padEnd(22) + ('₱' + sale.total.toFixed(2)).padStart(10) + '\n';
  t += 'Payment: ' + sale.method + '\n';
  if (sale.payment_ref) t += 'GCash Ref: ' + sale.payment_ref + '\n';
  if (sale.tendered != null) t += 'Cash: ₱' + Number(sale.tendered).toFixed(2) + '\n';
  if (sale.change != null) t += 'Change: ₱' + Number(sale.change).toFixed(2) + '\n';
  t += '--------------------------------\n';
  t += '   Thank you! Come again.\n';
  t += '     annen tea · 2026\n';
  paper.textContent = t;
  document.getElementById('receiptModal').classList.add('show');
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

function openInventory(opts) {
  opts = opts || {};
  const focusLow = !!opts.focusLow;
  const expMap = getIngredientExpiryMap();
  const entries = Object.entries(inventory).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
  );
  const low = entries.filter(([, q]) => q <= MIN_STOCK);
  let html = '';
  if (low.length) {
    html += `<div class="inv-low-header" id="invLowHeader">⚠ ${low.length} item(s) below minimum stock — restock these first</div>`;
  }
  html += `<table><thead><tr>
    <th>Item</th><th>Stock</th><th>Min</th><th>Expires</th><th>Status</th><th></th>
  </tr></thead><tbody>`;
  entries.forEach(([name, qty]) => {
    const isLow = qty <= MIN_STOCK;
    const exp = expMap[name] || '';
    const days = exp ? daysUntilExpiry(exp) : null;
    let expCell = '—';
    if (exp) {
      if (days != null && days < 0) expCell = `<span class="prod-expired">EXPIRED</span>`;
      else if (days != null && days <= 5) expCell = `<span class="prod-expiring">${exp} (${days}d)</span>`;
      else expCell = exp;
    }
    const status = isLow ? '<span style="color:#ff6b6b;font-weight:800">LOW</span>' : 'OK';
    const rowClass = isLow ? ' class="inv-row-low"' : '';
    const safeName = name.replace(/'/g, "\'");
    html += `<tr${rowClass}>
      <td>${name}</td>
      <td>${qty}</td>
      <td>${MIN_STOCK}</td>
      <td>${expCell}</td>
      <td>${status}</td>
      <td style="white-space:nowrap">
        <button type="button" class="link-btn" onclick="editInventoryItem('${safeName}')">Edit</button>
        <button type="button" class="link-btn" onclick="removeInventoryItem('${safeName}')">Remove</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('invTable').innerHTML = html;
  document.getElementById('invModal').classList.add('show');
  if (focusLow) {
    setTimeout(() => {
      const header = document.getElementById('invLowHeader');
      if (header) header.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const scroller = document.querySelector('.inv-scroll');
      if (scroller) scroller.scrollTop = 0;
    }, 50);
  }
}

function showAddInventoryItem() {
  document.getElementById('invItemModalTitle').textContent = 'Add inventory item';
  document.getElementById('invItemName').value = '';
  document.getElementById('invItemName').disabled = false;
  document.getElementById('invItemQty').value = '0';
  document.getElementById('invItemExpiry').value = '';
  document.getElementById('invItemError').hidden = true;
  document.getElementById('invItemModal').classList.add('show');
}

function editInventoryItem(name) {
  document.getElementById('invItemModalTitle').textContent = 'Edit inventory item';
  document.getElementById('invItemName').value = name;
  document.getElementById('invItemName').disabled = true;
  document.getElementById('invItemQty').value = inventory[name] ?? 0;
  document.getElementById('invItemExpiry').value = getIngredientExpiryMap()[name] || '';
  document.getElementById('invItemError').hidden = true;
  document.getElementById('invItemModal').classList.add('show');
}

function saveInventoryItem(e) {
  e.preventDefault();
  const err = document.getElementById('invItemError');
  err.hidden = true;
  const name = document.getElementById('invItemName').value.trim();
  const qty = parseFloat(document.getElementById('invItemQty').value);
  const expiry = document.getElementById('invItemExpiry').value || null;
  const editing = document.getElementById('invItemName').disabled;

  if (!name) {
    err.textContent = 'Item name is required.';
    err.hidden = false;
    return false;
  }
  if (isNaN(qty) || qty < 0) {
    err.textContent = 'Enter a valid quantity.';
    err.hidden = false;
    return false;
  }
  if (!editing && inventory[name] !== undefined) {
    err.textContent = 'Item already exists. Use Edit instead.';
    err.hidden = false;
    return false;
  }

  const prev = inventory[name];
  inventory[name] = +qty.toFixed(2);
  saveInventory();
  setIngredientExpiry(name, expiry);

  if (!editing) {
    logStockChange(name, qty, 'adjustment', 'New item added');
  } else if (prev !== qty) {
    logStockChange(name, +(qty - prev).toFixed(2), 'adjustment', 'Quantity edited');
  }

  document.getElementById('invItemModal').classList.remove('show');
  openInventory();
  fillRestockSelect();
  checkLowStockNotify();
  checkExpiryNotify();
  toast('Inventory item saved', 'ok');
  return false;
}

function removeInventoryItem(name) {
  if (!confirm('Remove "' + name + '" from inventory?')) return;
  delete inventory[name];
  saveInventory();
  setIngredientExpiry(name, null);
  logStockChange(name, 0, 'adjustment', 'Item removed from list');
  openInventory();
  fillRestockSelect();
  checkLowStockNotify();
  checkExpiryNotify();
  toast('Item removed', 'ok');
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
  const lowCount = Object.values(inventory).filter(q => q <= MIN_STOCK).length;

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
        `<div class="best-item"><span><span class="best-rank">${i + 1}</span>${name}</span><span>${qty} sold</span></div>`
      ).join('')
    : '<p style="color:var(--muted);font-size:0.9rem">No sales yet today</p>';

  // Recent
  const recent = sales.slice(-8).reverse();
  let table = '<table><thead><tr><th>Time</th><th>Cashier</th><th>Method</th><th>Total</th></tr></thead><tbody>';
  recent.forEach(s => {
    const t = new Date(s.time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    table += `<tr><td>${t}</td><td>${s.name || s.user}</td><td>${s.method}</td><td>₱${s.total.toFixed(2)}</td></tr>`;
  });
  table += '</tbody></table>';
  document.getElementById('recentSales').innerHTML = recent.length ? table : '<p style="color:var(--muted)">No transactions yet</p>';

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
        backgroundColor: '#1b7a4a',
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b9bb4' }, grid: { display: false } },
        y: { ticks: { color: '#8b9bb4' }, grid: { color: '#3a4d66' } }
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
let customProducts = JSON.parse(localStorage.getItem('at_custom_products') || '[]');

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

// ----- Products -----
function getAllProductsFlat() {
  const list = [];
  Object.entries(MENU).forEach(([cat, items]) => {
    items.forEach(p => list.push({ ...p, category: cat }));
  });
  // merge custom
  customProducts.forEach(p => list.push(p));
  return list;
}

function daysUntilExpiry(dateStr) {
  if (!dateStr) return null;
  const exp = new Date(dateStr + 'T23:59:59');
  if (isNaN(exp.getTime())) return null;
  const now = new Date();
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

function renderProductTable() {
  const all = getAllProductsFlat();
  let html = `<table><thead><tr>
    <th>Name</th><th>Category</th><th>Prices</th><th></th>
  </tr></thead><tbody>`;
  all.forEach(p => {
    const prices = Object.entries(p.prices || {}).map(([k,v]) => `${k}:₱${v}`).join(' · ');
    html += `<tr>
      <td>${p.name}${p.star ? ' ★' : ''}</td>
      <td>${p.category}</td>
      <td>${prices}</td>
      <td><button class="link-btn" onclick="editProduct('${p.id}')">Edit</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  document.getElementById('productTable').innerHTML = html;

  const sel = document.getElementById('prodCat');
  if (sel) {
    sel.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  }
}

function showProductForm(id) {
  document.getElementById('prodId').value = id || '';
  document.getElementById('productModalTitle').textContent = id ? 'Edit Product' : 'Add Product';
  if (id) {
    const p = getAllProductsFlat().find(x => x.id === id);
    if (p) {
      document.getElementById('prodName').value = p.name;
      document.getElementById('prodCat').value = p.category;
      document.getElementById('priceM').value = p.prices.M || '';
      document.getElementById('priceL').value = p.prices.L || '';
      document.getElementById('priceXL').value = p.prices.XL || '';
      document.getElementById('priceREG').value = p.prices.REG || '';
      document.getElementById('prodStar').checked = !!p.star;
      const pe = document.getElementById('prodExpiry'); if (pe) pe.value = p.expires || '';
    }
  } else {
    document.getElementById('productForm').reset();
    document.getElementById('prodId').value = '';
    const pe2 = document.getElementById('prodExpiry'); if (pe2) pe2.value = '';
  }
  document.getElementById('productModal').classList.add('show');
}

function editProduct(id) { showProductForm(id); }

function saveProduct(e) {
  e.preventDefault();
  const id = document.getElementById('prodId').value || ('custom_' + Date.now());
  const name = document.getElementById('prodName').value.trim();
  const cat = document.getElementById('prodCat').value;
  const prices = {};
  ['M','L','XL','REG'].forEach(s => {
    const v = parseFloat(document.getElementById('price' + s).value);
    if (v > 0) prices[s] = v;
  });
  if (!Object.keys(prices).length) {
    alert('Enter at least one price');
    return false;
  }
  const star = document.getElementById('prodStar').checked;
  const expires = (document.getElementById('prodExpiry') && document.getElementById('prodExpiry').value) || null;

  let found = false;
  if (MENU[cat]) {
    const idx = MENU[cat].findIndex(p => p.id === id);
    if (idx >= 0) {
      MENU[cat][idx] = { id, name, prices, star, expires };
      found = true;
      // also update customProducts if it was a custom item
      const ci = customProducts.findIndex(p => p.id === id);
      if (ci >= 0) {
        customProducts[ci] = { id, name, prices, star, expires, category: cat };
        localStorage.setItem('at_custom_products', JSON.stringify(customProducts));
      } else {
        // persist expiry for built-in products
        saveProductExpiry(id, expires);
      }
    }
  }
  if (!found) {
    customProducts = customProducts.filter(p => p.id !== id);
    customProducts.push({ id, name, prices, star, expires, category: cat });
    localStorage.setItem('at_custom_products', JSON.stringify(customProducts));
    if (!MENU[cat]) MENU[cat] = [];
    MENU[cat] = MENU[cat].filter(p => p.id !== id);
    MENU[cat].push({ id, name, prices, star, expires });
  }
  closeAllModals();
  renderProductTable();
  renderProducts();
  checkExpiryNotify();
  return false;
}

// ----- Restock -----
function fillRestockSelect() {
  const sel = document.getElementById('restockItem');
  if (!sel) return;
  sel.innerHTML = Object.keys(inventory).sort().map(n =>
    `<option value="${n}">${n} (now: ${inventory[n]})</option>`
  ).join('');
}

function submitRestock(e) {
  e.preventDefault();
  const item = document.getElementById('restockItem').value;
  const qty  = parseFloat(document.getElementById('restockQty').value);
  const reason = document.getElementById('restockReason').value;
  const notes = document.getElementById('restockNotes').value.trim();
  const expiry = document.getElementById('restockExpiry')?.value || null;
  if (!item || isNaN(qty) || qty === 0) return false;

  inventory[item] = Math.max(0, +(inventory[item] + qty).toFixed(2));
  saveInventory();
  if (expiry) setIngredientExpiry(item, expiry);
  logStockChange(item, qty, reason, notes + (expiry ? (notes ? ' · ' : '') + 'Exp: ' + expiry : ''));

  const msg = document.getElementById('restockMsg');
  msg.textContent = `Updated ${item}: ${qty > 0 ? '+' : ''}${qty} → now ${inventory[item]}` + (expiry ? ` · expires ${expiry}` : '');
  msg.className = 'msg ok';
  msg.hidden = false;
  document.getElementById('restockForm').reset();
  fillRestockSelect();
  checkLowStockNotify();
  checkExpiryNotify();
  setTimeout(() => { msg.hidden = true; }, 3500);
  return false;
}

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
    el.innerHTML = '<p style="color:var(--muted)">No inventory changes recorded yet</p>';
    return;
  }

  let html = `<table><thead><tr>
    <th>When</th><th>Item</th><th>Change</th><th>Balance</th><th>Reason</th><th>By</th><th>Notes</th>
  </tr></thead><tbody>`;
  logs.slice(0, 100).forEach(l => {
    const t = new Date(l.time).toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const sign = l.change > 0 ? '+' : '';
    const bal = l.balance != null ? l.balance : '—';
    const reasonLabel = ({
      sale: 'Sale',
      restock: 'Restock',
      adjustment: 'Adjustment',
      waste: 'Waste'
    })[l.reason] || l.reason;
    html += `<tr>
      <td>${t}</td>
      <td>${l.ingredient}</td>
      <td style="color:${l.change > 0 ? '#7dcea0' : '#ff8a8a'};font-weight:600">${sign}${l.change}</td>
      <td>${bal}</td>
      <td>${reasonLabel}</td>
      <td>${l.user}</td>
      <td style="font-size:0.8rem">${l.notes || '—'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ----- Recipes -----
function renderRecipes() {
  const el = document.getElementById('recipeList');
  const cards = [
    { title: 'Milk Tea / Classic style', rules: RECIPES.default_mt },
    { title: 'Summer Drinks', rules: RECIPES.summer },
    { title: 'Burgers', rules: RECIPES.snacks_burger },
    { title: 'Chicken Nuggets', rules: RECIPES.snacks_nuggets },
    { title: 'Rice Meals (silog, etc.)', rules: RECIPES.rice }
  ];
  el.innerHTML = cards.map(c => `
    <div class="recipe-card">
      <h4>${c.title}</h4>
      <ul>${Object.entries(c.rules).map(([k,v]) => `<li>${k}: <strong>${v}</strong> per unit sold</li>`).join('')}</ul>
    </div>
  `).join('');
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
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('at_theme') || 'dark';
  applyTheme(saved);
})();


// ---------- FORGOT PASSWORD ----------
function openForgotPassword() {
  document.getElementById('forgotUser').value = '';
  document.getElementById('forgotNew').value = '';
  document.getElementById('forgotConfirm').value = '';
  document.getElementById('forgotError').hidden = true;
  document.getElementById('forgotModal').classList.add('show');
  return false;
}

async function submitForgotPassword() {
  const err = document.getElementById('forgotError');
  err.hidden = true;
  const user = document.getElementById('forgotUser').value.trim().toLowerCase();
  const p1 = document.getElementById('forgotNew').value;
  const p2 = document.getElementById('forgotConfirm').value;

  if (!user || !p1 || !p2) {
    err.textContent = 'Fill in all fields.';
    err.hidden = false;
    return;
  }
  if (p1.length < 4) {
    err.textContent = 'Password must be at least 4 characters.';
    err.hidden = false;
    return;
  }
  if (p1 !== p2) {
    err.textContent = 'Passwords do not match.';
    err.hidden = false;
    return;
  }

  const accounts = loadAccounts();
  if (!accounts[user]) {
    err.textContent = 'Username not found. Contact the owner to reset your password.';
    err.hidden = false;
    return;
  }

  // Security: only allow self-reset for staff if they know username;
  // owner accounts require owner to reset via Manage → Accounts for stronger security
  // For demo/school: allow reset if username exists (owner should change default passwords)
  const hash = await sha256(p1);
  accounts[user].pass = hash;
  saveAccounts(accounts);
  // sync in-memory USERS
  if (USERS[user]) USERS[user].pass = hash;

  closeAllModals();
  toast('Password updated. You can sign in now.', 'ok');
}

// ---------- ACCOUNT STORAGE (owner management) ----------
function defaultAccounts() {
  return {
    owner:  { pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'owner',  name: 'Owner' },
    coowner:{ pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'co_owner', name: 'Co-owner' },
    staff:  { pass: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', role: 'staff',  name: 'Staff' }
  };
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem('at_accounts');
    if (raw) {
      const parsed = JSON.parse(raw);
      // merge into USERS for login
      Object.keys(USERS).forEach(k => delete USERS[k]);
      Object.assign(USERS, parsed);
      return parsed;
    }
  } catch (e) {}
  const d = defaultAccounts();
  saveAccounts(d);
  Object.keys(USERS).forEach(k => delete USERS[k]);
  Object.assign(USERS, d);
  return d;
}

function saveAccounts(accounts) {
  localStorage.setItem('at_accounts', JSON.stringify(accounts));
  Object.keys(USERS).forEach(k => delete USERS[k]);
  Object.assign(USERS, accounts);
}

// Load accounts on boot (before login)
loadAccounts();

function renderAccountsTable() {
  const accounts = loadAccounts();
  const el = document.getElementById('accountsTable');
  if (!el) return;
  let html = `<table><thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead><tbody>`;
  Object.entries(accounts).forEach(([user, info]) => {
    const roleLabel = { owner: 'Owner', co_owner: 'Co-owner', staff: 'Staff' }[info.role] || info.role;
    const canDelete = user !== 'owner' && user !== session.username;
    html += `<tr>
      <td>${user}</td>
      <td>${roleLabel}</td>
      <td>
        <button class="link-btn" onclick="showAccountForm('${user}')">Edit</button>
        ${canDelete ? `<button class="link-btn" onclick="deleteAccount('${user}')">Delete</button>` : ''}
      </td>
    </tr>`;
  });
  html += '</tbody></table>';
  el.innerHTML = html;
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
    document.getElementById('acctPassword').value = '';
    document.getElementById('acctPassLabel').textContent = 'New password (leave blank to keep)';
    document.getElementById('acctPassword').required = false;
  } else {
    document.getElementById('acctUsername').value = '';
    document.getElementById('acctUsername').disabled = false;
    document.getElementById('acctRole').value = 'staff';
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
    if (!pass || pass.length < 4) {
      err.textContent = 'Password must be at least 4 characters.';
      err.hidden = false;
      return false;
    }
    accounts[user] = {
      pass: await sha256(pass),
      role,
      name: role === 'owner' ? 'Owner' : role === 'co_owner' ? 'Co-owner' : 'Staff'
    };
  } else {
    user = editUser;
    accounts[user].role = role;
    accounts[user].name = role === 'owner' ? 'Owner' : role === 'co_owner' ? 'Co-owner' : 'Staff';
    if (pass) {
      if (pass.length < 4) {
        err.textContent = 'Password must be at least 4 characters.';
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
  delete accounts[user];
  saveAccounts(accounts);
  renderAccountsTable();
  toast('Account deleted', 'ok');
}

// Hook accounts tab into switchMgmtTab
const _origSwitchMgmt = typeof switchMgmtTab === 'function' ? switchMgmtTab : null;
// Will patch switchMgmtTab via string replace below

// ---------- LOW STOCK NOTIFICATIONS ----------
let lowStockDismissed = false;

function updateStockButtons(lowCount) {
  document.querySelectorAll('.stock-btn, .top-actions .tb-btn').forEach(btn => {
    const isStock = btn.classList.contains('stock-btn') ||
      /^Stock(\s*\(|$)/.test(btn.textContent.trim());
    if (!isStock) return;
    if (lowCount > 0) {
      btn.classList.add('stock-alert');
      btn.textContent = 'Stock (' + lowCount + ')';
    } else {
      btn.classList.remove('stock-alert');
      btn.textContent = 'Stock';
    }
  });
}

function checkLowStockNotify() {
  const low = Object.entries(inventory).filter(([, q]) => q <= MIN_STOCK);
  const banner = document.getElementById('lowStockBanner');
  const text = document.getElementById('lowStockBannerText');
  if (!banner || !text) return;

  updateStockButtons(low.length);

  // Stock is OK — clear everything
  if (low.length === 0) {
    banner.hidden = true;
    lowStockDismissed = false;
    window._lowStockToasted = false;
    if (window._lowStockInterval) {
      clearInterval(window._lowStockInterval);
      window._lowStockInterval = null;
    }
    return;
  }

  const names = low.slice(0, 4).map(([n, q]) => n + ' (' + q + ')').join(' · ');
  const more = low.length > 4 ? ' · +' + (low.length - 4) + ' more' : '';
  text.textContent = 'LOW STOCK: ' + names + more + ' — tap to open';

  if (!lowStockDismissed) {
    banner.hidden = false;
  }

  if (!window._lowStockInterval) {
    window._lowStockInterval = setInterval(() => {
      const still = Object.entries(inventory).filter(([, q]) => q <= MIN_STOCK);
      if (still.length === 0) {
        clearInterval(window._lowStockInterval);
        window._lowStockInterval = null;
        checkLowStockNotify(); // full clear
        return;
      }
      lowStockDismissed = false;
      updateStockButtons(still.length);
      const b = document.getElementById('lowStockBanner');
      if (b) {
        b.hidden = false;
        const t = document.getElementById('lowStockBannerText');
        if (t) {
          const n = still.slice(0, 4).map(([name, q]) => name + ' (' + q + ')').join(' · ');
          t.textContent = 'LOW STOCK: ' + n + ' — tap to open';
        }
      }
      toast('⚠ Low stock still needs attention — tap the red banner', 'err');
    }, 90000);
  }

  if (!window._lowStockToasted) {
    toast('⚠ ' + low.length + ' item(s) low on stock — click the red banner', 'err');
    window._lowStockToasted = true;
    setTimeout(() => { window._lowStockToasted = false; }, 20000);
  }
}

function dismissLowStockBanner() {
  // Temporary dismiss only (30s) so it stays urgent long-term
  lowStockDismissed = true;
  const banner = document.getElementById('lowStockBanner');
  if (banner) banner.hidden = true;
  setTimeout(() => {
    lowStockDismissed = false;
    checkLowStockNotify();
  }, 30000);
}


// ---------- SALES / PAYMENT HISTORY (all roles) ----------
function openSalesHistory() {
  renderSalesHistory();
  document.getElementById('salesHistoryModal').classList.add('show');
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
    el.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No payments yet</p>';
    return;
  }

  let html = `<table><thead><tr>
    <th>Time</th><th>Method</th><th>Total</th><th>Ref / Cash given</th><th>Change</th><th>Cashier</th><th></th>
  </tr></thead><tbody>`;

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
    html += `<tr>
      <td>${timeStr}</td>
      <td>${s.method}</td>
      <td>₱${Number(s.total).toFixed(2)}</td>
      <td style="font-family:monospace;font-size:0.82rem">${refOrCash}</td>
      <td>${changeCell}</td>
      <td>${cashier}</td>
      <td><button type="button" class="link-btn" onclick="viewSaleReceipt(${s.id})">Receipt</button></td>
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
function applyStoredExpiries() {
  const map = loadProductExpiries();
  Object.values(MENU).forEach(list => {
    list.forEach(p => {
      if (map[p.id]) p.expires = map[p.id];
    });
  });
  // custom products already store expires on the object
  customProducts.forEach(cp => {
    if (!MENU[cp.category]) return;
    const p = MENU[cp.category].find(x => x.id === cp.id);
    if (p && cp.expires) p.expires = cp.expires;
  });
}

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

function checkExpiryNotify() {
  const expiring = getExpiringProducts();
  const banner = document.getElementById('expiryBanner');
  const text = document.getElementById('expiryBannerText');
  if (!banner || !text) return;

  if (!expiring.length) {
    banner.hidden = true;
    document.body.classList.remove('has-expiry-banner');
    expiryDismissed = false;
    return;
  }

  const bits = expiring.slice(0, 3).map(p => {
    const tag = p.kind === 'ingredient' ? ' [stock]' : '';
    if (p.daysLeft < 0) return p.name + tag + ' (EXPIRED)';
    if (p.daysLeft === 0) return p.name + tag + ' (today)';
    return p.name + tag + ' (' + p.daysLeft + 'd)';
  });
  const more = expiring.length > 3 ? ' +' + (expiring.length - 3) + ' more' : '';
  text.textContent = 'EXPIRING SOON: ' + bits.join(' · ') + more + ' — tap to view';

  document.body.classList.add('has-expiry-banner');
  if (!expiryDismissed) banner.hidden = false;

  if (!window._expiryToasted) {
    toast('📅 ' + expiring.length + ' product(s) expire within 5 days', 'info');
    window._expiryToasted = true;
    setTimeout(() => { window._expiryToasted = false; }, 30000);
  }
}

function dismissExpiryBanner() {
  expiryDismissed = true;
  const banner = document.getElementById('expiryBanner');
  if (banner) banner.hidden = true;
  setTimeout(() => {
    expiryDismissed = false;
    checkExpiryNotify();
  }, 60000);
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

// Hook expiry check into enterApp
const _checkLowOrig = checkLowStockNotify;
checkLowStockNotify = function() {
  _checkLowOrig();
  checkExpiryNotify();
};
applyStoredExpiries();

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
  const sales = getSalesList();
  const period = dashPeriod || 'day';
  const filtered = filterSalesByPeriod(sales, period);
  const revenue = filtered.reduce((s, x) => s + (x.total || 0), 0);
  const count = filtered.length;
  const avg = count ? revenue / count : 0;
  const lowCount = Object.values(inventory).filter(q => q <= MIN_STOCK).length;

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
        `<div class="best-item"><span><span class="best-rank">${i + 1}</span>${name}</span><span>${qty} sold</span></div>`
      ).join('')
    : '<p style="color:var(--muted);font-size:0.9rem">No sales in this period</p>';

  const recent = filtered.slice().sort((a,b) => new Date(b.time) - new Date(a.time)).slice(0, 10);
  let table = '<table><thead><tr><th>Time</th><th>Cashier</th><th>Method</th><th>Total</th></tr></thead><tbody>';
  recent.forEach(s => {
    const t = new Date(s.time).toLocaleString('en-PH', { month:'short', day:'numeric', hour: '2-digit', minute: '2-digit' });
    table += `<tr><td>${t}</td><td>${s.roleLabel || s.user || '—'}</td><td>${s.method}</td><td>₱${Number(s.total).toFixed(2)}</td></tr>`;
  });
  table += '</tbody></table>';
  document.getElementById('recentSales').innerHTML = recent.length ? table : '<p style="color:var(--muted)">No transactions yet</p>';

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
        backgroundColor: '#1b7a4a',
        borderRadius: 6,
        maxBarThickness: period === 'month' ? 18 : 36
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b9bb4', maxRotation: 0, autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
        y: { ticks: { color: '#8b9bb4' }, grid: { color: '#3a4d66' } }
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
    el.innerHTML = '<p style="color:var(--muted);padding:16px;text-align:center">No transactions yet today</p>';
    return;
  }
  let html = `<table><thead><tr>
    <th>Time</th><th>Method</th><th>Total</th><th>Ref / Cash given</th><th>Change</th><th>Cashier</th><th></th>
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
    html += `<tr>
      <td>${t}</td>
      <td>${s.method}</td>
      <td>₱${Number(s.total).toFixed(2)}</td>
      <td style="font-family:monospace;font-size:0.82rem">${refOrCash}</td>
      <td>${changeCell}</td>
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
  localStorage.setItem('at_sales', JSON.stringify(list));
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
    if (Array.isArray(data.sales)) setSalesList(data.sales);
    if (data.inventory && typeof data.inventory === 'object') {
      inventory = data.inventory;
      saveInventory();
    }
    if (Array.isArray(data.stock_logs)) {
      stockLogs = data.stock_logs;
      localStorage.setItem('at_stock_logs', JSON.stringify(stockLogs));
    }
    if (data.ingredient_expiry) {
      localStorage.setItem('at_ingredient_expiry', JSON.stringify(data.ingredient_expiry));
    }
    if (data.accounts) {
      localStorage.setItem('at_accounts', JSON.stringify(data.accounts));
      Object.keys(USERS).forEach(k => delete USERS[k]);
      Object.assign(USERS, data.accounts);
    }
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
  try {
    await fetch(API_BASE + '/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory,
        ingredient_expiry: getIngredientExpiryMap(),
        stock_logs: typeof stockLogs !== 'undefined' ? stockLogs : []
      })
    });
  } catch (e) {}
}

async function pushFullState() {
  if (!API_BASE || !sharedMode) return;
  try {
    await fetch(API_BASE + '/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales: getSalesList(),
        inventory,
        stock_logs: typeof stockLogs !== 'undefined' ? stockLogs : [],
        accounts: JSON.parse(localStorage.getItem('at_accounts') || '{}'),
        ingredient_expiry: getIngredientExpiryMap()
      })
    });
  } catch (e) {}
}

// Pull shared data on load
pullSharedState();
// Refresh sales every 15s when in shared mode
setInterval(() => { if (sharedMode) pullSharedState(); }, 15000);
