/* AnneTea BrewTrack — saved menu catalog, per-product recipes, ingredient rules, restock / manual adjustment,
   out-of-stock blocking, file-or-camera photo capture, undo, and notification settings.
   Loaded after app.js (uses its globals: MENU, CATEGORIES, inventory, order, stockLogs, session, toast helpers...). */

// =====================================================================
// Small helpers
// =====================================================================
const byId = (id) => document.getElementById(id);
const escH = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const fmtQty = (n) => +Number(n).toFixed(2);
function todayStr() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }

// "pearl", "Pearl ", "PEARLS" all mean the same ingredient → return the name exactly as it is saved in the system
function ingKey(s) {
  let k = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (k.length > 3 && k.endsWith('s') && !k.endsWith('ss')) k = k.slice(0, -1);
  return k;
}
function resolveIngredient(text) {
  const k = ingKey(text); if (!k) return null;
  return Object.keys(inventory).find((n) => ingKey(n) === k) || null;
}

// Low-stock level per ingredient (saved, editable in Inventory → Edit). Falls back to MIN_STOCK.
function getMinMap() { try { return JSON.parse(localStorage.getItem('at_ingredient_min') || '{}') || {}; } catch (e) { return {}; } }
function minFor(name) { const v = getMinMap()[name]; return v != null && v >= 0 ? v : MIN_STOCK; }
function setMinFor(name, v) { const m = getMinMap(); if (v == null || v === '' || isNaN(v)) delete m[name]; else m[name] = fmtQty(v); localStorage.setItem('at_ingredient_min', JSON.stringify(m)); }
function getUnitMap() { try { return JSON.parse(localStorage.getItem('at_ingredient_unit') || '{}') || {}; } catch (e) { return {}; } }
function unitOf(name) { return getUnitMap()[name] || ''; }
function setUnitFor(name, u) { const m = getUnitMap(); u = cleanName(u); if (!u) delete m[name]; else m[name] = u; localStorage.setItem('at_ingredient_unit', JSON.stringify(m)); }
const withUnit = (q, name) => fmtQty(q) + (unitOf(name) ? ' ' + unitOf(name) : '');
function lowStockItems() { return Object.entries(inventory).filter(([n, q]) => q <= minFor(n)); }

// A category decides whether its drinks ask for a sugar level (editable in Products → Categories)
function productNeedsSugar(product) {
  for (const [cat, items] of Object.entries(MENU)) {
    if (items.some((x) => x.id === product.id)) { const c = CATEGORIES.find((x) => x.id === cat); return !!(c && c.sugar); }
  }
  return false;
}

// =====================================================================
// CATALOG — categories + products + recipes are saved (and shared with the server), not hard-coded
// =====================================================================
const CATALOG_KEY = 'at_catalog';
const CATALOG_VERSION = 4;   // 4 = recipe list + 1-liter sizes + order-time choices (menu-seed.js)
const sizeLabel = (s) => (s === 'XL' ? '1L' : s);   // XL is the 1-liter cup

function catalogSnapshot() { return { v: CATALOG_VERSION, categories: CATEGORIES, menu: MENU }; }

function applyCatalog(c) {
  if (!c || !Array.isArray(c.categories) || !c.menu || typeof c.menu !== 'object') return false;
  CATEGORIES.length = 0; c.categories.forEach((x) => CATEGORIES.push({ id: x.id, label: x.label, sugar: x.sugar != null ? !!x.sugar : DRINK_CATS.has(x.id) }));
  Object.keys(MENU).forEach((k) => delete MENU[k]);
  CATEGORIES.forEach((cat) => { MENU[cat.id] = Array.isArray(c.menu[cat.id]) ? c.menu[cat.id] : []; });
  return true;
}

function saveCatalog() {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalogSnapshot()));
  if (typeof sharedMode !== 'undefined' && sharedMode && typeof pushFullState === 'function') pushFullState();
}

// Units and low-stock levels for the recipe-list ingredients (only filled in where nothing is saved yet)
function seedIngredientSettings() {
  const um = getUnitMap(), mm = getMinMap();
  Object.entries(INGREDIENT_SEED).forEach(([n, x]) => { if (!um[n]) um[n] = x.unit; if (mm[n] == null) mm[n] = x.low; });
  localStorage.setItem('at_ingredient_unit', JSON.stringify(um)); localStorage.setItem('at_ingredient_min', JSON.stringify(mm));
}
// Stock from the old built-in menu → the recipe list's ingredient names. Old demo ingredients no recipe uses are dropped;
// anything the shop added itself is kept. New recipe ingredients start with demo stock.
const OLD_SEED_INGREDIENTS = ['Pearl', 'Milk', 'Tea Base', 'Sugar', 'Creamcheese', 'Ice Cream', 'Mango', 'Ube Halaya', 'Avocado', 'Corn', 'Beef Patty', 'Chicken Nuggets', 'Rice', 'Egg', 'Spam', 'Tocino', 'Hotdog', 'Whipped Cream', 'Salty Cream'];
const OLD_RENAMES = { 'Pearl': 'Tapioca Pearls', 'Creamcheese': 'Cream Cheese', 'Whipped Cream': 'Whipping Cream' };
function migrateInventory(inv, onDrop) {
  const seedNames = Object.keys(INGREDIENT_SEED), toSeed = (n) => seedNames.find((x) => ingKey(x) === ingKey(n)) || null;
  const out = {};
  Object.entries(inv || {}).forEach(([n, q]) => {
    const target = toSeed(OLD_RENAMES[n] || n);
    if (!target && OLD_SEED_INGREDIENTS.includes(n)) { if (onDrop) onDrop(n, q); return; }
    const name = target || n; out[name] = fmtQty((out[name] || 0) + (+q || 0));
  });
  seedNames.forEach((n) => { if (out[n] == null) out[n] = INGREDIENT_SEED[n].start; });
  return out;
}
function migrateLocalInventory() {
  const em = getIngredientExpiryMap(), dropped = [];
  Object.entries(OLD_RENAMES).forEach(([o, n]) => { if (em[o] && !em[n]) setIngredientExpiry(n, em[o]); });
  inventory = migrateInventory(inventory, (n, q) => dropped.push([n, q]));
  Object.keys(getIngredientExpiryMap()).forEach((n) => { if (!(n in inventory)) setIngredientExpiry(n, null); });
  const mm = getMinMap(); Object.keys(mm).forEach((n) => { if (!(n in inventory)) delete mm[n]; }); localStorage.setItem('at_ingredient_min', JSON.stringify(mm));
  localStorage.setItem('at_inventory', JSON.stringify(inventory));
  dropped.forEach(([n, q]) => logStockChange(n, -(+q || 0), 'adjustment', 'Removed: not used by the new recipe list'));
}

function loadCatalog() {
  CATEGORIES.forEach((c) => { if (c.sugar == null) c.sugar = DRINK_CATS.has(c.id); });   // "ask sugar level" is a saved setting per category
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null'); } catch (e) { stored = null; }
  if (stored && (stored.v || 0) >= CATALOG_VERSION && applyCatalog(stored)) { seedIngredientSettings(); return; }
  // First run of this version: the recipe list replaces the old menu and its recipes.
  if (localStorage.getItem('at_inventory')) migrateLocalInventory();
  seedIngredientSettings();
  ['at_deleted_products', 'at_custom_products', 'at_product_expiry'].forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalogSnapshot()));
}
loadCatalog();

function findProduct(id) { for (const [cat, list] of Object.entries(MENU)) { const p = list.find((x) => x.id === id); if (p) return Object.assign({}, p, { category: cat }); } return null; }
function getAllProductsFlat() { const out = []; Object.entries(MENU).forEach(([cat, list]) => list.forEach((p) => out.push(Object.assign({}, p, { category: cat })))); return out; }
function catLabelOf(id) { return (CATEGORIES.find((c) => c.id === id) || {}).label || id; }

// =====================================================================
// STOCK RULES — what an order needs, and whether it can be made
// =====================================================================
// A recipe amount is one number (same for every size) or per size: { M: 200, L: 300, XL: 400 }.
// Without a size (e.g. "can this product be made at all?") the smallest size is used.
function recipeQty(v, size) {
  if (typeof v === 'number') return v;
  if (!v || typeof v !== 'object') return +v || 0;
  if (size && v[size] != null) return +v[size];
  if (v.REG != null) return +v.REG;
  const vals = Object.values(v).map(Number).filter((x) => !isNaN(x));
  return vals.length ? Math.min(...vals) : 0;
}
function ingredientsNeeded(lines) {
  const need = {};
  lines.forEach((l) => { const p = findProduct(l.id); if (!p || !p.recipe) return;
    Object.entries(p.recipe).forEach(([ing, q]) => { need[ing] = fmtQty((need[ing] || 0) + recipeQty(q, l.size) * l.qty); });
    if (l.opts) Object.values(l.opts).forEach((ing) => { need[ing] = fmtQty((need[ing] || 0) + l.qty); }); });   // chosen rice / dip / side: 1 each
  return need;
}
function shortagesFor(lines) {
  const need = ingredientsNeeded(lines), out = [];
  Object.entries(need).forEach(([ing, q]) => { const have = inventory[ing] == null ? 0 : inventory[ing]; if (have + 1e-9 < q) out.push({ ing, need: fmtQty(q), have: fmtQty(have) }); });
  return out;
}
const shortageText = (list) => 'Not enough stock — ' + list.map((s) => s.ing + ' (need ' + withUnit(s.need, s.ing) + ', have ' + withUnit(s.have, s.ing) + ')').join(', ');
function unavailableReason(p) { const s = shortagesFor([{ id: p.id, qty: 1 }]); return s.length ? shortageText(s) : ''; }
function orderLines(extra) { return order.map((i) => ({ id: i.id, qty: i.qty, size: i.size, opts: i.opts || null })).concat(extra || []); }
// Used by payment buttons: false (and a message) when anything in the order cannot be made
function orderStockOk() {
  const s = shortagesFor(orderLines());
  if (!s.length) return true;
  toast(shortageText(s) + '. Remove or reduce the item, or restock first.', 'err');
  return false;
}

function deductInventory(items) {
  items.forEach((item) => {
    const p = findProduct(item.id); if (!p || !p.recipe) return;
    const chosen = item.opts ? Object.values(item.opts).map((ing) => [ing, 1]) : [];
    Object.entries(p.recipe).concat(chosen).forEach(([ing, q]) => {
      if (inventory[ing] === undefined) return;
      const used = fmtQty(recipeQty(q, item.size) * item.qty);
      inventory[ing] = Math.max(0, +(inventory[ing] - used).toFixed(2));
      logStockChange(ing, -used, 'sale', item.qty + 'x ' + item.name + (item.size ? ' (' + item.size + ')' : ''));
    });
  });
  saveInventory();
}

// POS product grid — items that cannot be made are marked and explain why
function renderProducts() {
  const grid = byId('productGrid'); if (!grid) return;
  const items = MENU[currentCat] || [];
  const cat = CATEGORIES.find((c) => c.id === currentCat) || { label: '' };
  const [emoji, hue] = catMeta(currentCat);
  grid.innerHTML = '<div class="products-title">' + escH(cat.label) + '<small>' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</small></div>' +
    (items.length ? items.map((p) => {
      const keys = Object.keys(p.prices);
      const chips = keys.length === 1 ? '<span class="price-chip">₱' + p.prices[keys[0]] + '</span>'
        : keys.map((k) => '<span class="price-chip"><b>' + sizeLabel(k) + '</b>₱' + p.prices[k] + '</span>').join('');
      const sh = shortagesFor([{ id: p.id, qty: 1 }]);
      return '<button class="prod ' + (p.star ? 'star ' : '') + (sh.length ? 'oos' : '') + '" data-id="' + escH(p.id) + '" style="--h:' + hue + '" aria-label="' + escH(p.name) + (sh.length ? ' (out of stock)' : '') + '"' + (sh.length ? ' aria-disabled="true"' : '') + '>' +
        (p.star ? '<span class="prod-star">★ BEST</span>' : '') +
        '<span class="prod-avatar" aria-hidden="true">' + emoji + '</span><span class="prod-name">' + escH(p.name) + '</span>' +
        '<span class="prod-prices">' + chips + '</span>' +
        (sh.length ? '<span class="oos-tag">Out of stock · ' + escH(sh[0].ing) + '</span>' : '') + '</button>';
    }).join('') : '<div class="empty-block" style="grid-column:1/-1"><span class="empty-ico">🍃</span>Nothing in this category yet</div>');
  grid.querySelectorAll('.prod').forEach((btn) => {
    btn.onclick = () => { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); selectProduct(btn.dataset.id); };
  });
}

function voidLastItem() {
  if (!order.length) return;
  const removed = order.pop(); renderOrder();
  toast(removed.name + ' voided', 'info', { label: 'Undo', action: () => { order.push(removed); renderOrder(); } });
}

// =====================================================================
// INGREDIENT AUTOCOMPLETE (typeable + searchable)
// =====================================================================
function ensureIngList() {
  let dl = byId('ingList'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'ingList'; document.body.appendChild(dl); }
  dl.innerHTML = Object.keys(inventory).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((n) => '<option value="' + escH(n) + '">').join('');
}

// =====================================================================
// CATEGORIES (create / rename / delete)
// =====================================================================
function renderCategoryManager() {
  const el = byId('catManager'); if (!el) return;
  el.innerHTML = '<div class="cm-head"><b>Categories</b>' +
    '<form class="cm-add" onsubmit="return addCategory(event)"><input type="text" id="newCatName" placeholder="New category name" maxlength="30" /><label class="cm-sugar"><input type="checkbox" id="newCatSugar" /> drinks (ask sugar)</label><button class="btn-sm" type="submit">+ Add</button></form></div>' +
    '<div class="cm-chips">' + CATEGORIES.map((c) => '<span class="cm-chip">' + escH(c.label) + ' <small>' + (MENU[c.id] || []).length + '</small>' +
      '<button type="button" class="cm-sug' + (c.sugar ? ' on' : '') + '" title="' + (c.sugar ? 'Asks sugar level — tap to turn off' : 'No sugar level — tap to ask sugar level') + '" aria-pressed="' + !!c.sugar + '" onclick="toggleCategorySugar(\'' + c.id + '\')">🍬</button>' +
      '<button type="button" title="Rename" aria-label="Rename ' + escH(c.label) + '" onclick="renameCategory(\'' + c.id + '\')">✎</button>' +
      '<button type="button" title="Delete" aria-label="Delete ' + escH(c.label) + '" onclick="deleteCategory(\'' + c.id + '\')">✕</button></span>').join('') + '</div>';
}
function addCategory(e) {
  e.preventDefault();
  const label = cleanName(byId('newCatName').value);
  if (!label) { toast('Type a category name', 'err'); return false; }
  const dup = CATEGORIES.find((c) => c.label.toLowerCase() === label.toLowerCase());
  if (dup) { toast('“' + dup.label + '” already exists — no duplicate created', 'err'); return false; }
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'cat'; while (MENU[id]) id += 'x';
  const sugarBox = byId('newCatSugar');
  CATEGORIES.push({ id, label, sugar: !!(sugarBox && sugarBox.checked) }); MENU[id] = []; saveCatalog();
  renderCategoryManager(); renderProductTable(); renderCategories();
  toast('Category “' + label + '” added', 'ok', { label: 'Undo', action: () => {
    if ((MENU[id] || []).length) { toast('“' + label + '” already has products — delete them first', 'err'); return; }
    const i = CATEGORIES.findIndex((c) => c.id === id); if (i >= 0) CATEGORIES.splice(i, 1); delete MENU[id];
    if (currentCat === id) currentCat = CATEGORIES.length ? CATEGORIES[0].id : '';
    saveCatalog(); renderCategoryManager(); renderProductTable(); renderCategories(); renderProducts(); } });
  return false;
}
function toggleCategorySugar(id) {
  const c = CATEGORIES.find((x) => x.id === id); if (!c) return;
  c.sugar = !c.sugar; saveCatalog(); renderCategoryManager();
  toast(c.label + (c.sugar ? ' will ask for a sugar level' : ' will not ask for a sugar level'), 'ok', { label: 'Undo', action: () => { c.sugar = !c.sugar; saveCatalog(); renderCategoryManager(); } });
}
function renameCategory(id) {
  const c = CATEGORIES.find((x) => x.id === id); if (!c) return;
  const label = cleanName(prompt('Rename category', c.label));
  if (!label || label === c.label) return;
  if (CATEGORIES.some((x) => x.id !== id && x.label.toLowerCase() === label.toLowerCase())) { toast('That name is already used', 'err'); return; }
  const old = c.label; c.label = label; saveCatalog();
  renderCategoryManager(); renderProductTable(); renderCategories(); renderProducts();
  toast('Category renamed', 'ok', { label: 'Undo', action: () => { c.label = old; saveCatalog(); renderCategoryManager(); renderProductTable(); renderCategories(); renderProducts(); } });
}
function deleteCategory(id) {
  const c = CATEGORIES.find((x) => x.id === id); if (!c) return;
  if ((MENU[id] || []).length) { toast('“' + c.label + '” still has ' + MENU[id].length + ' product(s). Move or delete them first.', 'err'); return; }
  if (!confirm('Delete category “' + c.label + '”?')) return;
  const idx = CATEGORIES.indexOf(c); CATEGORIES.splice(idx, 1); delete MENU[id];
  if (currentCat === id) currentCat = CATEGORIES.length ? CATEGORIES[0].id : '';
  saveCatalog(); renderCategoryManager(); renderProductTable(); renderCategories(); renderProducts();
  toast('Category deleted', 'ok', { label: 'Undo', action: () => { CATEGORIES.splice(idx, 0, c); MENU[id] = []; saveCatalog(); renderCategoryManager(); renderProductTable(); renderCategories(); renderProducts(); } });
}

// =====================================================================
// PRODUCTS (create / read / update / delete) with a recipe per product
// =====================================================================
function renderProductTable() {
  const catFilter = byId('productCatFilter'), searchEl = byId('productSearch');
  if (catFilter) {
    const keep = catFilter.value || 'all';
    catFilter.innerHTML = '<option value="all">All categories</option>' + CATEGORIES.map((c) => '<option value="' + c.id + '">' + escH(c.label) + '</option>').join('');
    catFilter.value = CATEGORIES.some((c) => c.id === keep) ? keep : 'all';
  }
  const catVal = (catFilter && catFilter.value) || 'all', q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
  let list = getAllProductsFlat();
  if (catVal !== 'all') list = list.filter((p) => p.category === catVal);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || catLabelOf(p.category).toLowerCase().includes(q));
  const order_ = CATEGORIES.map((c) => c.id);
  list.sort((a, b) => order_.indexOf(a.category) - order_.indexOf(b.category) || a.name.localeCompare(b.name));
  const totalPages = Math.max(1, Math.ceil(list.length / PRODUCT_PAGE_SIZE));
  if (productPage > totalPages) productPage = totalPages; if (productPage < 1) productPage = 1;
  const pageItems = list.slice((productPage - 1) * PRODUCT_PAGE_SIZE, productPage * PRODUCT_PAGE_SIZE);
  let html = '<table><thead><tr><th>Name</th><th>Category</th><th>Prices</th><th>Recipe / stock</th><th></th></tr></thead><tbody>', last = null;
  pageItems.forEach((p) => {
    if (p.category !== last) { last = p.category; html += '<tr><td colspan="5" class="cat-group-header">' + escH(catLabelOf(p.category)) + '</td></tr>'; }
    const prices = Object.entries(p.prices || {}).map(([k, v]) => sizeLabel(k) + ':₱' + Number(v).toFixed(2)).join(' · ');
    const n = Object.keys(p.recipe || {}).length, sh = shortagesFor([{ id: p.id, qty: 1 }]);
    const rec = !n ? '<span class="hint-text">no recipe</span>' : (sh.length ? '<span class="pill low">Out: ' + escH(sh[0].ing) + '</span>' : '<span class="pill ok">' + n + ' ingredient' + (n > 1 ? 's' : '') + '</span>');
    html += '<tr><td>' + (p.star ? '★ ' : '') + escH(p.name) + '</td><td>' + escH(catLabelOf(p.category)) + '</td><td>' + prices + '</td><td>' + rec + '</td>' +
      '<td style="white-space:nowrap"><button class="link-btn" onclick="editProduct(\'' + escH(p.id) + '\')">Edit</button><button class="link-btn" onclick="deleteProduct(\'' + escH(p.id) + '\')">Delete</button></td></tr>';
  });
  if (!pageItems.length) html += '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No products found</td></tr>';
  byId('productTable').innerHTML = html + '</tbody></table>';
  const pager = byId('productPager');
  if (pager) pager.innerHTML = '<button type="button" ' + (productPage <= 1 ? 'disabled' : '') + ' onclick="productPage--;renderProductTable()">Prev</button><span style="color:var(--muted);font-size:.85rem">Page ' + productPage + ' / ' + totalPages + ' · ' + list.length + ' items</span><button type="button" ' + (productPage >= totalPages ? 'disabled' : '') + ' onclick="productPage++;renderProductTable()">Next</button>';
  const sel = byId('prodCat'); if (sel) sel.innerHTML = CATEGORIES.map((c) => '<option value="' + c.id + '">' + escH(c.label) + '</option>').join('');
  renderCategoryManager();
}

const RECIPE_SIZES = ['M', 'L', 'XL', 'REG'];
function pricedSizes() { const on = RECIPE_SIZES.filter((z) => parseFloat((byId('price' + z) || {}).value) > 0); return on.length ? on : ['REG']; }
function addRecipeRow(ing, qty) {
  const box = byId('recipeRows'); if (!box) return;
  const row = document.createElement('div'); row.className = 'rec-row';
  const val = (z) => { const v = qty == null ? null : typeof qty === 'object' ? (qty[z] != null ? qty[z] : null) : qty; return v == null ? '' : v; };
  row.innerHTML = '<input type="text" class="rec-ing" placeholder="Type to search ingredient" value="' + escH(ing || '') + '" autocomplete="off" />' +
    '<span class="rec-qtys">' + RECIPE_SIZES.map((z) => '<label class="rec-q" data-size="' + z + '"><small>' + sizeLabel(z) + '</small><input type="number" class="rec-qty" data-size="' + z + '" step="0.01" min="0" value="' + val(z) + '" /></label>').join('') + '</span>' +
    '<span class="rec-unit hint-text"></span>' +
    '<button type="button" class="link-btn" aria-label="Remove ingredient" onclick="this.closest(\'.rec-row\').remove()">✕</button>';
  box.appendChild(row);
  const ingEl = row.querySelector('.rec-ing'), unitEl = row.querySelector('.rec-unit');
  const showUnit = () => { const r = resolveIngredient(ingEl.value); unitEl.textContent = r ? unitOf(r) : ''; };
  ingEl.addEventListener('input', showUnit); ingEl.addEventListener('change', showUnit); showUnit();
  attachIngCombo(ingEl); syncRecipeSizes();
}
// only show amount boxes for the sizes this product is sold in
function syncRecipeSizes() {
  const on = pricedSizes();
  document.querySelectorAll('#recipeRows .rec-q').forEach((l) => { l.hidden = !on.includes(l.dataset.size); });
}
['M', 'L', 'XL', 'REG'].forEach((z) => document.addEventListener('input', (e) => { if (e.target && e.target.id === 'price' + z) syncRecipeSizes(); }));
function fmtRecipeQty(v, ing) {
  const u = unitOf(ing) ? ' ' + escH(unitOf(ing)) : '';
  if (typeof v !== 'object' || !v) return '<b>' + fmtQty(v) + '</b>' + u;
  return Object.entries(v).map(([z, q]) => '<small>' + sizeLabel(z) + '</small> <b>' + fmtQty(q) + '</b>').join(' / ') + u;
}

function showProductForm(id) {
  ensureIngList();
  byId('prodId').value = id || '';
  byId('productModalTitle').textContent = id ? 'Edit Product' : 'Add Product';
  byId('recipeRows').innerHTML = '';
  const err = byId('prodError'); if (err) err.hidden = true;
  if (id) {
    const p = findProduct(id); if (!p) return;
    byId('prodName').value = p.name; byId('prodCat').value = p.category;
    ['M', 'L', 'XL', 'REG'].forEach((s) => { byId('price' + s).value = p.prices[s] || ''; });
    byId('prodStar').checked = !!p.star;
    Object.entries(p.recipe || {}).forEach(([ing, q]) => addRecipeRow(ing, q));
    byId('prodOptions').value = (p.options || []).map((g) => g.label + ': ' + g.choices.join(', ')).join('\n');
  } else { byId('productForm').reset(); byId('prodId').value = ''; byId('prodOptions').value = ''; }
  syncRecipeSizes();
  byId('productModal').classList.add('show');
}
function editProduct(id) { showProductForm(id); }
function clearProductForm() {
  const id = byId('prodId').value;
  if (id) { showProductForm(id); toast('Changes cleared — showing the saved product', 'info'); return; }
  byId('productForm').reset(); byId('recipeRows').innerHTML = ''; byId('prodError').hidden = true; byId('prodName').focus();
}

function saveProduct(e) {
  e.preventDefault();
  const err = byId('prodError'), bad = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  const editId = byId('prodId').value, name = cleanName(byId('prodName').value), cat = byId('prodCat').value;
  if (!name) return bad('Product name is required.');
  const prices = {}; ['M', 'L', 'XL', 'REG'].forEach((s) => { const v = parseFloat(byId('price' + s).value); if (v > 0) prices[s] = v; });
  if (!Object.keys(prices).length) return bad('Enter at least one price.');
  if ((MENU[cat] || []).some((p) => p.id !== editId && p.name.toLowerCase() === name.toLowerCase())) return bad('“' + name + '” already exists in this category. Edit that product instead.');
  // recipe rows: typed names are matched to the ingredient already in the system (no duplicates, no unknown names)
  const recipe = {};
  const rows = [...document.querySelectorAll('#recipeRows .rec-row')];
  const sizes = Object.keys(prices);
  for (const r of rows) {
    const typed = cleanName(r.querySelector('.rec-ing').value);
    const qs = {}; sizes.forEach((z) => { const el = r.querySelector('.rec-qty[data-size="' + z + '"]'); qs[z] = el ? parseFloat(el.value) : NaN; });
    if (!typed && sizes.every((z) => isNaN(qs[z]))) continue;
    const real = resolveIngredient(typed);
    if (!real) return bad('“' + typed + '” is not in the inventory. Add it in Stock first, or pick one from the list.');
    const missing = sizes.filter((z) => !(qs[z] > 0));
    if (missing.length) return bad('Enter the amount of ' + real + ' for size ' + missing.join(', ') + ' (above 0).');
    const prev = recipe[real]; sizes.forEach((z) => { qs[z] = fmtQty(qs[z] + (prev ? recipeQty(prev, z) : 0)); });
    const vals = sizes.map((z) => qs[z]);
    recipe[real] = vals.every((v) => v === vals[0]) ? vals[0] : qs;   // same for every size → one number
  }
  // Choices the cashier picks when ordering, one group per line: "Rice: Java Rice, Garlic Rice"
  const options = [];
  for (const line of byId('prodOptions').value.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const m = line.match(/^([^:]+):(.+)$/);
    if (!m) return bad('Write each choice like “Rice: Java Rice, Garlic Rice”.');
    const label = cleanName(m[1]), choices = [];
    for (const c of m[2].split(',').map(cleanName).filter(Boolean)) {
      const real = resolveIngredient(c);
      if (!real) return bad('Choice “' + c + '” is not in the inventory. Add it in Stock first.');
      if (!choices.includes(real)) choices.push(real);
    }
    if (choices.length < 2) return bad('“' + label + '” needs at least two choices.');
    options.push({ label, choices });
  }
  const star = byId('prodStar').checked;
  const old = editId ? findProduct(editId) : null;
  const before = old ? JSON.parse(JSON.stringify(MENU[old.category].find((p) => p.id === editId))) : null, beforeIdx = old ? MENU[old.category].findIndex((p) => p.id === editId) : -1;
  const id = editId || ('p_' + Date.now().toString(36));
  const rec = { id, name, prices, star, expires: old ? (old.expires || null) : null, recipe };
  if (options.length) rec.options = options;
  if (old && old.category !== cat) MENU[old.category] = MENU[old.category].filter((p) => p.id !== id);
  if (!MENU[cat]) MENU[cat] = [];
  const idx = MENU[cat].findIndex((p) => p.id === id);
  if (idx >= 0) MENU[cat][idx] = rec; else MENU[cat].push(rec);
  saveCatalog(); closeAllModals(); renderProductTable(); renderProducts(); renderRecipes(); checkExpiryNotify();
  const refresh = () => { saveCatalog(); renderProductTable(); renderProducts(); renderRecipes(); };
  toast((editId ? '“' + name + '” updated' : '“' + name + '” added'), 'ok', { label: 'Undo', action: () => {
    Object.keys(MENU).forEach((k) => { MENU[k] = MENU[k].filter((p) => p.id !== id); });   // take out the saved version…
    if (before) { (MENU[old.category] = MENU[old.category] || []).splice(beforeIdx, 0, before); }   // …and put the old one back
    refresh(); } });
  return false;
}

function deleteProduct(id) {
  const p = findProduct(id); if (!p) { toast('Product not found', 'err'); return; }
  if (!confirm('Delete product “' + p.name + '”?')) return;
  const list = MENU[p.category], idx = list.findIndex((x) => x.id === id), removed = list.splice(idx, 1)[0];
  saveCatalog(); renderProductTable(); renderProducts(); renderRecipes();
  toast('“' + p.name + '” deleted', 'ok', { label: 'Undo', action: () => { (MENU[p.category] = MENU[p.category] || []).splice(idx, 0, removed); saveCatalog(); renderProductTable(); renderProducts(); renderRecipes(); } });
}

function renderRecipes() {
  const el = byId('recipeList'); if (!el) return;
  const q = ((byId('recipeSearch') || {}).value || '').trim().toLowerCase();
  let list = getAllProductsFlat().filter((p) => !q || p.name.toLowerCase().includes(q) || Object.keys(p.recipe || {}).some((i) => i.toLowerCase().includes(q)));
  if (!list.length) { el.innerHTML = '<div class="empty-block">No matching products</div>'; return; }
  el.innerHTML = '<table><thead><tr><th>Product</th><th>Ingredients used per serving</th><th>Can be made?</th><th></th></tr></thead><tbody>' +
    list.map((p) => { const ents = Object.entries(p.recipe || {}), sh = shortagesFor([{ id: p.id, qty: 1 }]);
      return '<tr><td>' + escH(p.name) + '<br><small class="hint-text">' + escH(catLabelOf(p.category)) + '</small></td><td>' +
        (ents.length ? '<div class="rc-chips">' + ents.map(([k, v]) => '<span class="rc-chip"><span>' + escH(k) + '</span> <span>' + fmtRecipeQty(v, k) + '</span></span>').join(' ') + '</div>' + (p.options || []).map((g) => '<span class="hint-text rc-opt">Choice of ' + escH(g.label) + ': ' + g.choices.map(escH).join(' / ') + ' (1 each)</span>').join('') : '<span class="hint-text">none — sales are not tracked for this item</span>') + '</td><td>' +
        (sh.length ? '<span class="pill low">No: ' + escH(sh[0].ing) + '</span>' : '<span class="pill ok">Yes</span>') +
        '</td><td><button class="link-btn" onclick="editProduct(\'' + escH(p.id) + '\')">Edit recipe</button></td></tr>'; }).join('') + '</tbody></table>';
}

// =====================================================================
// INVENTORY (create / read / update / delete) — search, no duplicates, undo
// =====================================================================
function usedByRecipes(ing) { return getAllProductsFlat().filter((p) => (p.recipe && p.recipe[ing] != null) || (p.options || []).some((g) => g.choices.includes(ing))); }

function openInventory(opts) {
  opts = opts || {};
  const expMap = getIngredientExpiryMap();
  const q = ((byId('invSearch') || {}).value || '').trim().toLowerCase();
  let entries = Object.entries(inventory).sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
  const lowAll = entries.filter(([n, v]) => v <= minFor(n));
  if (q) entries = entries.filter(([n]) => n.toLowerCase().includes(q));
  let html = '';
  if (lowAll.length) html += '<div class="inv-low-header" id="invLowHeader"><svg class="ic"><use href="#i-alert"/></svg> ' + lowAll.length + ' item(s) below minimum stock — restock these first</div>';
  html += '<table><thead><tr><th>Item</th><th>Stock</th><th>Min</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>';
  entries.forEach(([name, qty]) => {
    const isLow = qty <= minFor(name), exp = expMap[name] || '', days = exp ? daysUntilExpiry(exp) : null;
    let expCell = '—';
    if (exp) expCell = days != null && days < 0 ? '<span class="prod-expired">EXPIRED</span>' : days != null && days <= 5 ? '<span class="prod-expiring">' + exp + ' (' + days + 'd)</span>' : exp;
    const status = qty <= 0 ? '<span class="pill low">Out</span>' : isLow ? '<span class="pill low">Low</span>' : '<span class="pill ok">OK</span>';
    const a = escH(name).replace(/&#39;/g, "\\'");
    html += '<tr' + (isLow ? ' class="inv-row-low"' : '') + '><td>' + escH(name) + '</td><td>' + withUnit(qty, name) + '</td><td>' + minFor(name) + '</td><td>' + expCell + '</td><td>' + status + '</td>' +
      '<td style="white-space:nowrap"><button type="button" class="link-btn" onclick="adjustFromInventory(\'' + a + '\')">Adjust</button>' +
      '<button type="button" class="link-btn" onclick="editInventoryItem(\'' + a + '\')">Edit</button>' +
      '<button type="button" class="link-btn" onclick="removeInventoryItem(\'' + a + '\')">Remove</button></td></tr>';
  });
  if (!entries.length) html += '<tr><td colspan="6" style="text-align:center;color:var(--muted)">' + (q ? 'No ingredient matches “' + escH(q) + '”' : 'Inventory is empty — add an item') + '</td></tr>';
  byId('invTable').innerHTML = html + '</tbody></table>';
  byId('invModal').classList.add('show');
  if (opts.focusLow) setTimeout(() => { const h = byId('invLowHeader'); if (h) h.scrollIntoView({ block: 'nearest' }); }, 50);
}

function adjustFromInventory(name) {
  closeAllModals();
  openManagement();
  const tab = document.querySelector('.mgmt-tab[data-tab="restock"]'); if (tab) switchMgmtTab(tab);
  setTimeout(() => { byId('restockItem').value = name; updateRestockUi(); byId('restockAddQty').focus(); }, 30);
}

function showAddInventoryItem() {
  byId('invItemModalTitle').textContent = 'Add inventory item';
  byId('invItemOrig').value = '';
  byId('invItemName').value = ''; byId('invItemQty').value = '0'; byId('invItemQty').readOnly = false;
  byId('invItemQtyLabel').textContent = 'Starting quantity'; byId('invItemQtyHint').textContent = 'If you start with stock, an expiration date is required.';
  byId('invItemExpiry').value = ''; byId('invItemExpiry').min = todayStr(); byId('invItemMin').value = ''; byId('invItemUnit').value = '';
  byId('invItemExpStar').hidden = true; byId('invItemQty').oninput = () => { byId('invItemExpStar').hidden = !(parseFloat(byId('invItemQty').value) > 0); };
  byId('invItemNameHint').textContent = '';
  byId('invItemError').hidden = true; byId('invItemModal').classList.add('show');
  setTimeout(() => byId('invItemName').focus(), 50);
}
function editInventoryItem(name) {
  byId('invItemModalTitle').textContent = 'Edit inventory item';
  byId('invItemOrig').value = name; byId('invItemName').value = name;
  byId('invItemQty').value = inventory[name] == null ? 0 : inventory[name]; byId('invItemQty').readOnly = true;
  byId('invItemQtyLabel').textContent = 'Current quantity (read-only)';
  byId('invItemQtyHint').textContent = 'To change the quantity use Adjust (Restock / Manual adjustment) so the change is recorded.';
  byId('invItemExpiry').value = getIngredientExpiryMap()[name] || ''; byId('invItemExpiry').min = '';
  byId('invItemMin').value = minFor(name); byId('invItemUnit').value = unitOf(name); byId('invItemExpStar').hidden = true; byId('invItemQty').oninput = null;
  byId('invItemNameHint').textContent = '';
  byId('invItemError').hidden = true; byId('invItemModal').classList.add('show');
}
// Live duplicate check while typing a new item name ("pearl" → "Pearl already exists")
function invNameHint() {
  const h = byId('invItemNameHint'), orig = byId('invItemOrig').value, typed = cleanName(byId('invItemName').value);
  const clash = typed ? resolveIngredient(typed) : null;
  if (clash && clash !== orig) {
    const a = escH(clash).replace(/&#39;/g, "\\'");
    h.innerHTML = '<span class="warn-txt">“' + escH(clash) + '” is already in the inventory.</span> <button type="button" class="link-btn" onclick="byId(\'invItemModal\').classList.remove(\'show\');adjustFromInventory(\'' + a + '\')">Add/remove stock of ' + escH(clash) + ' instead</button>';
  } else h.textContent = '';
}
function clearInvItemForm() {
  const orig = byId('invItemOrig').value;
  if (orig) { editInventoryItem(orig); return; }
  showAddInventoryItem();
}

function renameIngredient(from, to) {
  inventory[to] = inventory[from]; delete inventory[from];
  const em = getIngredientExpiryMap(); if (em[from]) { setIngredientExpiry(to, em[from]); setIngredientExpiry(from, null); }
  const mm = getMinMap(); if (mm[from] != null) { setMinFor(to, mm[from]); setMinFor(from, null); }
  const um = getUnitMap(); if (um[from]) { setUnitFor(to, um[from]); setUnitFor(from, ''); }
  let touched = false; getAllProductsFlat().forEach((p) => { if (p.recipe && p.recipe[from] != null) { const m = MENU[p.category].find((x) => x.id === p.id); m.recipe[to] = m.recipe[from]; delete m.recipe[from]; touched = true; } });
  getAllProductsFlat().forEach((p) => { (p.options || []).forEach((g, gi) => { if (g.choices.includes(from)) { const m = MENU[p.category].find((x) => x.id === p.id); m.options[gi].choices = g.choices.map((c) => (c === from ? to : c)); touched = true; } }); });
  if (touched) saveCatalog();
  stockLogs.forEach((l) => { if (l.ingredient === from) l.ingredient = to; }); stockLogsChanged();
}

function saveInventoryItem(e) {
  e.preventDefault();
  const err = byId('invItemError'), bad = (m) => { err.textContent = m; err.hidden = false; return false; };
  err.hidden = true;
  const orig = byId('invItemOrig').value, name = cleanName(byId('invItemName').value);
  const qty = parseFloat(byId('invItemQty').value), expiry = byId('invItemExpiry').value || null;
  const minRaw = byId('invItemMin').value, min = minRaw === '' ? null : parseFloat(minRaw), unit = byId('invItemUnit').value;
  if (!name) return bad('Item name is required.');
  if (min != null && (isNaN(min) || min < 0)) return bad('Low-stock alert must be 0 or more.');
  const clash = resolveIngredient(name);
  if (clash && clash !== orig) return bad('“' + clash + '” already exists in the inventory' + (clash !== name ? ' (you typed “' + name + '”)' : '') + '. Use Adjust to add or remove stock instead of creating a duplicate.');
  if (!orig) {
    if (isNaN(qty) || qty < 0) return bad('Enter a valid starting quantity.');
    if (qty > 0 && !expiry) return bad('Expiration date is required when you add stock.');
    if (expiry && expiry < todayStr()) return bad('That expiration date has already passed.');
    inventory[name] = fmtQty(qty); setIngredientExpiry(name, expiry); setMinFor(name, min); setUnitFor(name, unit); saveInventory();
    if (qty > 0) logStockChange(name, qty, 'restock', 'New item added', { expiry });
    toast('“' + name + '” added to inventory', 'ok', { label: 'Undo', action: () => {
      if (usedByRecipes(name).length) { toast('“' + name + '” is now used in a recipe — remove it from Inventory instead', 'err'); return; }
      delete inventory[name]; setIngredientExpiry(name, null); setMinFor(name, null); setUnitFor(name, ''); saveInventory(); afterInventoryChange(); } });
  } else {
    const before = { name: orig, expiry: getIngredientExpiryMap()[orig] || null, min: getMinMap()[orig], unit: unitOf(orig) };
    if (name !== orig) renameIngredient(orig, name);   // rename everywhere it is used
    setIngredientExpiry(name, expiry); setMinFor(name, min); setUnitFor(name, unit); saveInventory();
    toast('“' + name + '” updated', 'ok', { label: 'Undo', action: () => {
      if (!(name in inventory)) return;
      if (name !== before.name) { if (resolveIngredient(before.name) && resolveIngredient(before.name) !== name) { toast('Cannot undo — “' + before.name + '” exists again', 'err'); return; } renameIngredient(name, before.name); }
      setIngredientExpiry(before.name, before.expiry); setMinFor(before.name, before.min); setUnitFor(before.name, before.unit); saveInventory(); afterInventoryChange(); } });
  }
  byId('invItemModal').classList.remove('show');
  afterInventoryChange(); return false;
}

function removeInventoryItem(name) {
  const users = usedByRecipes(name);
  const warn = users.length ? '\n\n' + users.length + ' product recipe(s) use it (' + users.slice(0, 3).map((p) => p.name).join(', ') + (users.length > 3 ? '…' : '') + '). Those products will show as out of stock until you change their recipe.' : '';
  if (!confirm('Remove “' + name + '” from inventory?' + warn)) return;
  const prevQty = inventory[name], prevExp = getIngredientExpiryMap()[name] || null, prevMin = getMinMap()[name], prevUnit = unitOf(name);
  delete inventory[name]; setIngredientExpiry(name, null); setMinFor(name, null); setUnitFor(name, ''); saveInventory();
  logStockChange(name, 0, 'adjustment', 'Item removed from list');
  afterInventoryChange();
  toast('“' + name + '” removed', 'ok', { label: 'Undo', action: () => { if (resolveIngredient(name)) { toast('“' + resolveIngredient(name) + '” already exists again', 'err'); return; } inventory[name] = prevQty; if (prevExp) setIngredientExpiry(name, prevExp); setMinFor(name, prevMin); setUnitFor(name, prevUnit); saveInventory(); logStockChange(name, 0, 'adjustment', 'Item restored (undo)'); afterInventoryChange(); } });
}

function afterInventoryChange() {
  ensureIngList();
  if (byId('invModal') && byId('invModal').classList.contains('show')) openInventory();
  fillRestockSelect(); renderProducts(); if (byId('productTable')) renderProductTable(); renderRecipes();
  checkLowStockNotify(); checkExpiryNotify();
}

// =====================================================================
// RESTOCK / MANUAL ADJUSTMENT
//   Two boxes, like the original form: Add quantity and Remove quantity (net change = add − remove)
//   Delivery            → expiration date REQUIRED
//   Manual adjustment   → expiration date REQUIRED · note REQUIRED
//   Waste / spoilage    → remove only · NO expiration date
// =====================================================================
function restockMode() {
  const reason = byId('restockReason').value;
  const num = (id) => { const v = parseFloat(byId(id).value); return v > 0 ? v : 0; };
  const add = reason === 'waste' ? 0 : num('restockAddQty'), remove = num('restockRemoveQty');
  const delta = fmtQty(add - remove);
  return { reason, add, remove, delta, dir: delta < 0 ? 'remove' : 'add' };
}
function updateRestockUi() {
  const { reason, dir, add, remove, delta } = restockMode();
  const addEl = byId('restockAddQty');
  addEl.disabled = reason === 'waste'; if (reason === 'waste') addEl.value = '';
  addEl.closest('.field').classList.toggle('is-off', reason === 'waste');
  const needExp = reason !== 'waste';
  byId('restockExpiryWrap').hidden = !needExp;
  byId('restockExpiry').required = needExp; byId('restockExpiry').min = dir === 'add' ? todayStr() : '';
  byId('restockExpStar').hidden = !needExp;
  byId('restockNotes').required = reason === 'adjustment';
  byId('restockNotesStar').hidden = reason !== 'adjustment';
  byId('restockHelp').textContent = { restock: 'Stock received from a supplier. Put the amount in Add quantity (use Remove for items sent back).', adjustment: 'Correct the count by hand: fill Add or Remove (or both). Please write why in the note.', waste: 'Spoiled, spilled or thrown away. Use the Remove quantity box.' }[reason];
  const typed = cleanName(byId('restockItem').value), real = resolveIngredient(typed);
  const cur = byId('restockCurrent'), prev = byId('restockPreview');
  if (!typed) { cur.textContent = ''; prev.textContent = ''; return; }
  if (!real) { cur.innerHTML = '<span class="warn-txt">“' + escH(typed) + '” is not in the inventory.</span> <button type="button" class="link-btn" onclick="quickAddIngredient()">Add it as a new item</button>'; prev.textContent = ''; return; }
  const savedExp = getIngredientExpiryMap()[real];
  cur.textContent = (real !== typed ? 'Saved as “' + real + '” · ' : '') + 'Now in stock: ' + withUnit(inventory[real], real) + (savedExp ? ' · expires ' + savedExp : '');
  const expEl = byId('restockExpiry');   // manual adjustment: start from the saved date so it only needs confirming
  if (reason === 'adjustment' && savedExp && !expEl.value && expEl._filledFor !== real) { expEl.value = savedExp; expEl._filledFor = real; }
  if (add > 0 || remove > 0) { const after = inventory[real] + delta; prev.innerHTML = escH(real) + ': <b>' + inventory[real] + '</b> → <b' + (after < 0 ? ' class="warn-txt"' : '') + '>' + fmtQty(after) + '</b>'; } else prev.textContent = '';
}
function quickAddIngredient() { const n = cleanName(byId('restockItem').value); showAddInventoryItem(); byId('invItemName').value = n; }

function fillRestockSelect() {
  ensureIngList();
  const form = byId('restockForm'); if (!form) return;
  if (!form._wired) {
    form._wired = true;
    ['restockItem', 'restockAddQty', 'restockRemoveQty', 'restockReason', 'restockNotes'].forEach((id) => byId(id).addEventListener('input', updateRestockUi));
    byId('restockReason').addEventListener('change', updateRestockUi);
    byId('restockExpiry').addEventListener('input', updateRestockUi);
    byId('restockItem').addEventListener('change', () => { const r = resolveIngredient(byId('restockItem').value); if (r) byId('restockItem').value = r; updateRestockUi(); });
    attachIngCombo(byId('restockItem'));
    form._picker = initPhotoPicker('restockPhotoPicker');
  }
  updateRestockUi();
}

function clearRestockForm() {
  const f = byId('restockForm'); f.reset(); byId('restockExpiry')._filledFor = null;
  if (f._picker) f._picker.clear();
  const m = byId('restockMsg'); m.hidden = true; m.textContent = '';
  updateRestockUi(); byId('restockItem').focus();
}

async function submitRestock(e) {
  e.preventDefault();
  const msg = byId('restockMsg'), fail = (t) => { msg.textContent = t; msg.className = 'msg err'; msg.hidden = false; return false; };
  const typed = cleanName(byId('restockItem').value), item = resolveIngredient(typed);
  if (!typed) return fail('Type or pick an ingredient.');
  if (!item) return fail('“' + typed + '” is not in the inventory. Add it first (Inventory → + Add item) so there are no duplicates.');
  const { reason, dir, add, remove, delta } = restockMode();
  const notes = cleanName(byId('restockNotes').value), expiry = byId('restockExpiry').value || null;
  if (reason === 'waste' && parseFloat(byId('restockAddQty').value) > 0) return fail('Waste can only remove stock. Use the Remove quantity box.');
  if (!(add > 0) && !(remove > 0)) return fail('Enter an amount in Add quantity or Remove quantity.');
  if (!delta) return fail('Add and Remove are the same, so nothing would change.');
  if (delta < 0 && -delta > inventory[item] + 1e-9) return fail('Only ' + inventory[item] + ' of “' + item + '” in stock — you cannot remove ' + (-delta) + '.');
  if (reason !== 'waste' && !expiry) return fail('Expiration date is required for ' + (reason === 'restock' ? 'a delivery.' : 'a manual adjustment.'));
  if (dir === 'add' && expiry && expiry < todayStr()) return fail('That expiration date has already passed.');
  if (reason === 'adjustment' && !notes) return fail('Please write a note explaining the manual adjustment.');
  const f = byId('restockForm'), photo = f._picker ? f._picker.get() : null;
  const prev = inventory[item], prevExp = getIngredientExpiryMap()[item] || null;
  inventory[item] = Math.max(0, fmtQty(prev + delta)); saveInventory();
  if (reason !== 'waste' && expiry) setIngredientExpiry(item, expiry);
  logStockChange(item, delta, reason, notes, { expiry: reason !== 'waste' ? expiry : null, photo });
  const logId = stockLogs[0] && stockLogs[0].id;
  msg.textContent = item + ': ' + prev + ' → ' + inventory[item] + (dir === 'add' && expiry ? ' · expires ' + expiry : '');
  msg.className = 'msg ok'; msg.hidden = false;
  f.reset(); byId('restockExpiry')._filledFor = null; if (f._picker) f._picker.clear(); updateRestockUi();
  afterInventoryChange();
  toast(item + ' ' + (delta > 0 ? '+' : '') + delta + ' saved', 'ok', { label: 'Undo', action: () => {
    if (!(item in inventory)) { toast('“' + item + '” was removed from the inventory', 'err'); return; }
    inventory[item] = Math.max(0, fmtQty(inventory[item] - delta));   // reverse only this change (sales made since are kept)
    setIngredientExpiry(item, prevExp); saveInventory();
    removeStockLog(logId);
    afterInventoryChange(); if (typeof renderHistory === 'function') renderHistory(); toast('Change undone', 'info'); } });
  if (typeof renderHistory === 'function') renderHistory();
  return false;
}

// =====================================================================
// PHOTO CAPTURE — choose a file OR open the camera (GCash proof, restock proof)
// =====================================================================
let _camStream = null;
function stopCam() { if (_camStream) { _camStream.getTracks().forEach((t) => t.stop()); _camStream = null; } const v = byId('camVideo'); if (v) v.srcObject = null; }
function scaleToJpeg(source, w, h) {
  const max = 1024, s = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s); c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}
// Phone/tablet camera app via <input capture>. Works even on http://192.168.x.x (where the browser blocks live camera access).
function captureViaInput(done) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
  inp.style.display = 'none'; document.body.appendChild(inp);
  inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
    try { done(await fileToJpeg(f)); } catch (er) { toast(er.message || 'Could not read the photo', 'err'); } };
  inp.click();
}
// Any picture (file or camera) is shrunk to a small JPEG so it fits in the browser's storage
function fileToJpeg(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!/^image\//.test(file.type || 'image/')) return reject(new Error('Please choose a picture (JPG, PNG, screenshot).'));
    if (file.size > 25 * 1024 * 1024) return reject(new Error('Picture is too large (max 25 MB).'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { try { resolve(scaleToJpeg(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can open.')); };
    img.src = url;
  });
}
function openCamera(done) {
  // Live camera needs https / localhost / file://. Otherwise (e.g. tablet on http://192.168.x.x) open the device camera app instead.
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { captureViaInput(done); return; }
  let m = byId('camModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'camModal'; m.className = 'modal';
    m.innerHTML = '<div class="modal-box" style="max-width:520px"><h3>Take a photo</h3><div class="idv-cam"><video id="camVideo" autoplay playsinline muted></video></div><p id="camMsg" class="error-msg" hidden></p><div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-primary" id="camShot">Capture</button><button type="button" class="btn-sm" id="camAlt">Use camera app</button><button type="button" class="modal-close" id="camCancel">Cancel</button></div></div>';
    document.body.appendChild(m);
  }
  const msg = byId('camMsg'); msg.hidden = true;
  const close = () => { stopCam(); m.classList.remove('show'); };
  byId('camCancel').onclick = close;
  byId('camAlt').onclick = () => { close(); captureViaInput(done); };
  byId('camShot').onclick = () => { const v = byId('camVideo'); if (!v.videoWidth) return; const url = scaleToJpeg(v, v.videoWidth, v.videoHeight); close(); done(url); };
  byId('camShot').disabled = false;
  m.classList.add('show');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
    .then((st) => { _camStream = st; const v = byId('camVideo'); v.srcObject = st; v.play().catch(() => {}); })
    .catch((er) => { msg.textContent = (er && er.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera could be opened here.') + ' Tap “Use camera app” or choose a file instead.'; msg.hidden = false; byId('camShot').disabled = true; });
}

function initPhotoPicker(rootId, onPhoto) {
  const root = byId(rootId); if (!root) return null;
  const pid = rootId.replace(/Picker$/, '') + 'Preview';
  root.innerHTML = '<div class="pp-btns"><button type="button" class="btn-sm" data-pp="file">📁 Choose file</button><button type="button" class="btn-sm" data-pp="cam">📷 Open camera</button><button type="button" class="link-btn" data-pp="clear" hidden>Remove photo</button></div>' +
    '<input type="file" accept="image/*" hidden /><div id="' + pid + '" class="photo-preview" hidden></div>';
  const input = root.querySelector('input[type=file]'), prev = byId(pid), clearBtn = root.querySelector('[data-pp=clear]');
  let data = null;
  const set = (url) => { data = url; prev.hidden = !url; prev.innerHTML = url ? '<img src="' + url + '" alt="Attached photo" title="Click to enlarge" />' : ''; clearBtn.hidden = !url; if (onPhoto) onPhoto(url); };
  root.querySelector('[data-pp=file]').onclick = () => input.click();
  root.querySelector('[data-pp=cam]').onclick = () => openCamera((url) => { set(url); toast('Photo attached', 'ok'); });
  clearBtn.onclick = () => { const was = data; input.value = ''; set(null); if (was) toast('Photo removed', 'info', { label: 'Undo', action: () => set(was) }); };
  input.onchange = async () => { const f = input.files && input.files[0]; if (!f) return;
    try { set(await fileToJpeg(f)); toast('Photo attached', 'ok'); } catch (er) { input.value = ''; toast(er.message || 'Photo upload failed', 'err'); } };
  return { get: () => data, clear: () => { input.value = ''; set(null); } };
}
const _closeAllBase = window.closeAllModals;
window.closeAllModals = function () { stopCam(); _closeAllBase(); };

// =====================================================================
// GCASH — reference number + proof photo from a file or the camera
// =====================================================================
function openGCash() {
  if (!order.length) { toast('Add items first', 'err'); return; }
  if (!orderStockOk()) return;
  const total = order.reduce((s, i) => s + i.price * i.qty, 0);
  pendingGCash = { total, photo: null };
  byId('gcashAmount').textContent = '₱' + total.toFixed(2);
  const input = byId('gcashRefInput'); input.value = '';
  initPhotoPicker('gcashPhotoPicker', (url) => { if (pendingGCash) pendingGCash.photo = url; });
  const st = byId('gcashStatus'); st.textContent = ''; st.className = 'gcash-status';
  byId('gcashConfirmBtn').disabled = false; byId('gcashModal').classList.add('show');
  setTimeout(() => input.focus(), 100);
  input.oninput = () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 13); input.value = digits;
    if (!digits.length) { st.textContent = ''; st.className = 'gcash-status'; }
    else if (digits.length < 13) { st.textContent = 'Reference must be exactly 13 digits (' + digits.length + '/13)'; st.className = 'gcash-status waiting'; }
    else { st.textContent = '13 digits entered — ready to confirm'; st.className = 'gcash-status success'; }
  };
}
async function confirmGCashPayment() {
  if (!pendingGCash || !order.length) { closeAllModals(); return; }
  const ref = (byId('gcashRefInput').value || '').replace(/\D/g, ''), st = byId('gcashStatus');
  if (!/^\d{13}$/.test(ref)) {
    st.textContent = 'Invalid reference. Enter exactly 13 numbers (no letters or spaces).'; st.className = 'gcash-status waiting';
    byId('gcashRefInput').focus(); toast('GCash reference must be exactly 13 digits', 'err'); return;
  }
  st.textContent = 'Saving payment…'; st.className = 'gcash-status success'; byId('gcashConfirmBtn').disabled = true;
  setTimeout(() => { completeSale('GCash', { ref, photo: pendingGCash ? pendingGCash.photo : null }); pendingGCash = null; }, 400);
}

// =====================================================================
// NOTIFICATIONS — no countdown timers (optional auto-hide in My ID → Notifications)
// =====================================================================
const AUTOHIDE_KEY = 'at_notify_autohide';
const notifyAutoHide = () => localStorage.getItem(AUTOHIDE_KEY) === '1';
function syncToastClear() {
  const wrap = byId('toastWrap'); if (!wrap) return;
  const n = wrap.querySelectorAll('.toast').length; let c = wrap.querySelector('.toast-clear');
  if (n >= 2 && !c) { c = document.createElement('button'); c.className = 'toast-clear'; c.textContent = 'Dismiss all'; c.onclick = () => { wrap.querySelectorAll('.toast').forEach((t) => t.remove()); syncToastClear(); }; wrap.appendChild(c); }
  else if (n < 2 && c) c.remove();
  if (c) wrap.appendChild(c);   // keep the button as the last (top-most) child
}
// ---------- UNDO: every message with an Undo button is also kept in a short history (top-bar Undo / Ctrl+Z) ----------
const undoStack = [];
function pushUndo(label, fn) { const u = { label, fn, el: null }; undoStack.push(u); if (undoStack.length > 20) undoStack.shift(); renderUndoBtns(); return u; }
function runUndo(u) {
  const i = undoStack.indexOf(u); if (i < 0) return false;    // already undone
  undoStack.splice(i, 1); renderUndoBtns();
  if (u.el) u.el.remove(); syncToastClear();
  try { u.fn(); } catch (e) { console.error(e); toast('Could not undo: ' + (e.message || e), 'err'); }
  return true;
}
function undoLast() {
  const u = undoStack[undoStack.length - 1];
  if (!u) { toast('Nothing to undo', 'info'); return; }
  if (runUndo(u)) toast('Undone: ' + u.label, 'info');
}
function clearUndo() { undoStack.length = 0; renderUndoBtns(); }
function renderUndoBtns() {
  const u = undoStack[undoStack.length - 1];
  document.querySelectorAll('[data-undo-btn]').forEach((b) => { b.disabled = !u; b.title = u ? 'Undo: ' + u.label + ' (Ctrl+Z)' : 'Nothing to undo'; });
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;   // let text fields undo typing
  if (!session || document.querySelector('.modal.show')) return;
  e.preventDefault(); undoLast();
});

function toast(msg, type, opts) {
  type = type || 'info'; opts = opts || {};
  const wrap = byId('toastWrap'); if (!wrap) return;
  const icon = { ok: 'check', err: 'alert', info: 'info' }[type] || 'info';
  const el = document.createElement('div'); el.className = 'toast ' + type; el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = '<svg class="ic t-ic" aria-hidden="true"><use href="#i-' + icon + '"/></svg><span class="t-msg"></span>';
  el.querySelector('.t-msg').textContent = msg;
  const close = () => { el.classList.add('leaving'); setTimeout(() => { el.remove(); syncToastClear(); }, 250); };
  if (opts.action) {
    const u = pushUndo(msg, opts.action); u.el = el;
    const b = document.createElement('button'); b.className = 't-act'; b.textContent = opts.label || 'Undo';
    b.onclick = (ev) => { ev.stopPropagation(); runUndo(u); };
    el.appendChild(b);
  }
  const x = document.createElement('button'); x.className = 't-x'; x.setAttribute('aria-label', 'Dismiss notification'); x.textContent = '×'; x.onclick = (ev) => { ev.stopPropagation(); close(); }; el.appendChild(x);
  if (!opts.action && type !== 'err') el.dataset.soft = '1';   // routine messages clear on the next click anywhere
  wrap.appendChild(el);
  const all = wrap.querySelectorAll('.toast'); for (let i = 0; i < all.length - 3; i++) all[i].remove();   // keep at most 3 (closed Undo messages stay in the Undo button)
  syncToastClear();
  if (notifyAutoHide() || opts.duration) setTimeout(close, opts.duration || (opts.action ? 7000 : 3500));
}
function notifSettingsHtml() {
  return '<h4 class="idv-sub" style="margin-top:18px">Notifications</h4><label class="check"><input type="checkbox" id="notifAutoHide" ' + (notifyAutoHide() ? 'checked' : '') + '/> <span>Hide pop-up messages automatically after a few seconds<br><span class="hint-text">Off = messages stay until you tap ×. Closed messages that had an Undo can still be undone with the Undo button at the top.</span></span></label>';
}
document.addEventListener('change', (e) => { if (e.target && e.target.id === 'notifAutoHide') { localStorage.setItem(AUTOHIDE_KEY, e.target.checked ? '1' : '0'); toast('Pop-up messages ' + (e.target.checked ? 'will hide automatically' : 'will stay until closed'), 'info'); } });

let lowDismissedSig = null, lowToastSig = null, expDismissedSig = null, expToastSig = null;
function checkLowStockNotify() {
  const low = lowStockItems();
  updateStockButtons(low.length);
  const banner = byId('lowStockBanner'), text = byId('lowStockBannerText');
  if (banner && text) {
    if (!low.length) { banner.hidden = true; lowDismissedSig = lowToastSig = null; }
    else {
      const sig = low.map(([n]) => n).sort().join('|');
      text.textContent = 'Low stock: ' + low.slice(0, 4).map(([n, q]) => n + ' (' + q + ')').join(' · ') + (low.length > 4 ? ' · +' + (low.length - 4) + ' more' : '') + ' — tap to open';
      banner.hidden = lowDismissedSig === sig;
      if (lowToastSig !== sig) { lowToastSig = sig; toast(low.length + ' item(s) low on stock — open Stock', 'err'); }
    }
  }
  checkExpiryNotify();
}
function dismissLowStockBanner() { lowDismissedSig = lowStockItems().map(([n]) => n).sort().join('|'); const b = byId('lowStockBanner'); if (b) b.hidden = true; }
function checkExpiryNotify() {
  const expiring = getExpiringProducts(), banner = byId('expiryBanner'), text = byId('expiryBannerText');
  if (!banner || !text) return;
  if (!expiring.length) { banner.hidden = true; document.body.classList.remove('has-expiry-banner'); expDismissedSig = expToastSig = null; return; }
  const sig = expiring.map((p) => p.kind + ':' + p.name).sort().join('|');
  const bits = expiring.slice(0, 3).map((p) => { const tag = p.kind === 'ingredient' ? ' [stock]' : ''; return p.name + tag + (p.daysLeft < 0 ? ' (EXPIRED)' : p.daysLeft === 0 ? ' (today)' : ' (' + p.daysLeft + 'd)'); });
  text.textContent = 'Expiring soon: ' + bits.join(' · ') + (expiring.length > 3 ? ' +' + (expiring.length - 3) + ' more' : '') + ' — tap to view';
  document.body.classList.add('has-expiry-banner'); banner.hidden = expDismissedSig === sig;
  if (expToastSig !== sig) { expToastSig = sig; toast(expiring.length + ' item(s) expire within 5 days', 'info'); }
}
function dismissExpiryBanner() { expDismissedSig = getExpiringProducts().map((p) => p.kind + ':' + p.name).sort().join('|'); const b = byId('expiryBanner'); if (b) b.hidden = true; document.body.classList.remove('has-expiry-banner'); }

// Routine ("saved", "added"…) messages disappear on the next click anywhere; errors and Undo messages stay until you close them.
document.addEventListener('click', () => { document.querySelectorAll('.toast[data-soft]').forEach((t) => t.remove()); syncToastClear(); }, true);
document.addEventListener('DOMContentLoaded', () => { ensureIngList(); });

// =====================================================================
// INGREDIENT PICKER — type to search, works on phones/tablets too (replaces the browser's datalist)
// =====================================================================
function attachIngCombo(input) {
  if (!input || input._combo) return; input._combo = true;
  input.removeAttribute('list'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  const wrap = document.createElement('span'); wrap.className = 'combo-wrap';
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const list = document.createElement('ul'); list.className = 'combo-list'; list.setAttribute('role', 'listbox'); list.hidden = true; wrap.appendChild(list);
  let items = [], active = -1;
  const pick = (name) => {
    input.value = name; hide();
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const hide = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const show = () => {
    const raw = cleanName(input.value).toLowerCase(), k = ingKey(raw);
    const names = Object.keys(inventory).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    items = !raw ? names : names.filter((n) => n.toLowerCase().includes(raw) || (k && ingKey(n).includes(k)))
      .sort((a, b) => (b.toLowerCase().startsWith(raw) ? 1 : 0) - (a.toLowerCase().startsWith(raw) ? 1 : 0));
    items = items.slice(0, 50);
    if (!items.length) { list.innerHTML = '<li class="combo-empty">No ingredient matches “' + escH(input.value) + '”</li>'; list.hidden = false; return; }
    list.innerHTML = items.map((n, i) => { const q = inventory[n], low = q <= minFor(n);
      return '<li role="option" data-i="' + i + '"' + (i === active ? ' class="active"' : '') + '><span>' + escH(n) + '</span><small class="' + (q <= 0 ? 'warn-txt' : low ? 'combo-low' : '') + '">' + withUnit(q, n) + ' in stock</small></li>'; }).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('focus', show);
  input.addEventListener('input', () => { active = -1; show(); });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  list.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; e.preventDefault(); pick(items[+li.dataset.i]); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { show(); return; }
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); show(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); show(); }
    else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); hide(); }
    const a = list.querySelector('li.active'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
  });
}

// =====================================================================
// VOID / UNDO A SALE — puts the ingredients back; the sale stays in the records marked "Voided"
// =====================================================================
function saleUsage(sale) { return sale.used && typeof sale.used === 'object' ? sale.used : ingredientsNeeded((sale.items || []).map((i) => ({ id: i.id, qty: i.qty, size: i.size, opts: i.opts || null }))); }
function refreshAfterSaleChange() {
  afterInventoryChange();
  if (byId('salesHistoryModal') && byId('salesHistoryModal').classList.contains('show')) renderSalesHistory();
  if (byId('todayScreen') && byId('todayScreen').classList.contains('active')) buildTodayPage();
  if (byId('dashScreen') && byId('dashScreen').classList.contains('active')) buildDashboard();
  if (typeof renderHistory === 'function') renderHistory();
}
function voidSale(id, opts) {
  opts = opts || {};
  const all = getSalesList(), sale = all.find((s) => String(s.id) === String(id));
  if (!sale) { toast('Sale not found', 'err'); return; }
  if (sale.voided) { toast((sale.order_no || 'Sale') + ' is already voided', 'info'); return; }
  if (!opts.reopen && !confirm('Void ' + (sale.order_no || 'this sale') + ' (₱' + Number(sale.total).toFixed(2) + ')? Its ingredients go back into stock and it is left out of the sales totals.')) return;
  Object.entries(saleUsage(sale)).forEach(([ing, q]) => {
    if (inventory[ing] === undefined) return;
    inventory[ing] = fmtQty(inventory[ing] + q);
    logStockChange(ing, q, 'void', (sale.order_no || 'Sale') + ' voided');
  });
  sale.voided = { by: session ? session.username : 'user', time: new Date().toISOString() };
  setSalesList(all); saveInventory(); if (typeof pushFullState === 'function') pushFullState();
  if (opts.reopen) {          // "Undo sale" right after paying: put the items back on the ticket so it can be fixed
    order = (sale.items || []).map((i) => Object.assign({}, i)).concat(order); renderOrder();
    const rm = byId('receiptModal'); if (rm) rm.classList.remove('show');
  }
  refreshAfterSaleChange();
  toast((sale.order_no || 'Sale') + ' voided' + (opts.reopen ? ' — items are back on the order' : ''), 'ok', { label: 'Undo', action: () => {
    if (opts.reopen) { const k = (i) => i.id + '|' + i.size + '|' + (i.sugar || '') + '|' + JSON.stringify(i.opts || null); const ids = new Set((sale.items || []).map(k)); order = order.filter((i) => !ids.has(k(i))); renderOrder(); }
    unvoidSale(sale.id, true);
  } });
}
function unvoidSale(id, silent) {
  const all = getSalesList(), sale = all.find((s) => String(s.id) === String(id));
  if (!sale || !sale.voided) return;
  const use = saleUsage(sale), short = Object.entries(use).filter(([ing, q]) => inventory[ing] !== undefined && inventory[ing] + 1e-9 < q);
  if (short.length) { toast('Cannot restore ' + (sale.order_no || 'sale') + ' — not enough ' + short.map(([n]) => n).join(', ') + ' left', 'err'); return; }
  Object.entries(use).forEach(([ing, q]) => { if (inventory[ing] === undefined) return; inventory[ing] = Math.max(0, fmtQty(inventory[ing] - q)); logStockChange(ing, -q, 'sale', (sale.order_no || 'Sale') + ' restored'); });
  delete sale.voided;
  setSalesList(all); saveInventory(); if (typeof pushFullState === 'function') pushFullState();
  refreshAfterSaleChange();
  if (!silent) toast((sale.order_no || 'Sale') + ' restored', 'ok');
}


// =====================================================================
// ORDER-TIME CHOICES — e.g. Java or Garlic rice, nugget dip, burger side. The pick is deducted from stock (1 each).
// =====================================================================
function openOptionPicker(product, size, price, sugar) {
  let m = byId('optModal');
  if (!m) { m = document.createElement('div'); m.id = 'optModal'; m.className = 'modal'; m.innerHTML = '<div class="modal-box"><h3 id="optTitle"></h3><div id="optGroups"></div><p id="optErr" class="error-msg" hidden></p><div style="margin-top:14px;display:flex;gap:8px"><button type="button" class="btn-primary" id="optAdd">Add to order</button><button type="button" class="modal-close" onclick="closeAllModals()">Cancel</button></div></div>'; document.body.appendChild(m); }
  const picks = {};
  byId('optTitle').textContent = product.name + (size && size !== 'REG' ? ' · ' + sizeLabel(size) : '');
  byId('optErr').hidden = true;
  byId('optGroups').innerHTML = product.options.map((g, gi) => '<h4 class="idv-sub">Choose ' + escH(g.label) + '</h4><div class="size-grid opt-grid">' +
    g.choices.map((c) => { const sh = shortagesFor(orderLines([{ id: product.id, qty: 1, size, opts: { [g.label]: c } }]));
      return '<button type="button" class="size-btn' + (sh.length ? ' oos' : '') + '" data-g="' + gi + '" data-c="' + escH(c) + '"' + (sh.length ? ' disabled' : '') + '><span class="sz">' + escH(c) + '</span><span class="sz-price">' + (sh.length ? 'Out of stock' : withUnit(inventory[c] || 0, c) + ' left') + '</span></button>'; }).join('') + '</div>').join('');
  byId('optGroups').querySelectorAll('button[data-c]').forEach((b) => { b.onclick = () => {
    const g = product.options[+b.dataset.g]; picks[g.label] = b.dataset.c;
    byId('optGroups').querySelectorAll('button[data-g="' + b.dataset.g + '"]').forEach((x) => x.classList.toggle('selected', x === b));
    if (product.options.every((gg) => picks[gg.label])) byId('optAdd').click();   // one group: add straight away
  }; });
  byId('optAdd').onclick = () => {
    const missing = product.options.filter((g) => !picks[g.label]).map((g) => g.label);
    if (missing.length) { byId('optErr').textContent = 'Choose ' + missing.join(' and ') + '.'; byId('optErr').hidden = false; return; }
    m.classList.remove('show'); addItem(product, size, price, sugar, Object.assign({}, picks));
  };
  // close any size/sugar dialog that led here, then show the choices
  ['sizeModal', 'sugarModal'].forEach((id) => { const x = byId(id); if (x) x.classList.remove('show'); });
  m.classList.add('show');
}
