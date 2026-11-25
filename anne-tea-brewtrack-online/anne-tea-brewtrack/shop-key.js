// Shop key for the online version.
// When the server has SHOP_KEY set, every device must type that key once; it is remembered on the device
// and sent with each request. Loaded before app.js so every call to /api/ goes through it.
(function () {
  if (location.protocol === 'file:' || !window.fetch) return;
  const KEY = 'at_shop_key';
  const origFetch = window.fetch.bind(window);
  const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setKey = (k) => { try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); } catch (e) {} };
  const isApi = (url) => url.startsWith('/api/') || url.startsWith(location.origin + '/api/');
  let asking = null;

  function withKey(init) {
    const out = Object.assign({}, init || {});
    const h = new Headers(out.headers || {});
    const k = getKey(); if (k) h.set('X-Shop-Key', k); else h.delete('X-Shop-Key');
    out.headers = h; return out;
  }

  function askForKey(wrongBefore) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.className = 'modal show shop-key-modal'; box.style.zIndex = 10000;
      box.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="shopKeyTitle">' +
        '<h3 id="shopKeyTitle">Enter the shop key</h3>' +
        '<p class="hint-text" style="margin-bottom:12px">This device is opening the online AnneTea BrewTrack for the first time. Type the shop key the owner set up. You only need to do this once on each device.</p>' +
        '<form><div class="field" style="text-align:left"><label for="shopKeyInput">Shop key</label>' +
        '<input id="shopKeyInput" type="password" autocomplete="current-password" required /></div>' +
        '<p class="error-msg" id="shopKeyErr"' + (wrongBefore ? '' : ' hidden') + '>That key is not right. Ask the owner for the shop key.</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="submit" class="btn-primary">Continue</button>' +
        '<button type="button" class="modal-close" data-skip>Use offline on this device</button></div></form></div>';
      document.body.appendChild(box);
      const input = box.querySelector('input'), err = box.querySelector('#shopKeyErr');
      setTimeout(() => input.focus(), 50);
      box.querySelector('[data-skip]').onclick = () => { box.remove(); resolve(false); };
      box.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        const k = input.value.trim(); if (!k) return;
        const r = await origFetch(location.origin + '/api/key-check', { headers: { 'X-Shop-Key': k }, cache: 'no-store' }).catch(() => null);
        if (r && r.ok) { setKey(k); box.remove(); resolve(true); }
        else { err.hidden = false; input.select(); }
      };
    });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isApi(url)) return origFetch(input, init);
    let res = await origFetch(input, withKey(init));
    if (res.status === 401) {
      const hadKey = !!getKey(); setKey('');
      if (!asking) asking = new Promise((r) => {
        const go = () => askForKey(hadKey).then(r);
        if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
      }).finally(() => { setTimeout(() => { asking = null; }, 0); });
      if (await asking) res = await origFetch(input, withKey(init));
    }
    return res;
  };
  window.forgetShopKey = () => setKey('');
})();
