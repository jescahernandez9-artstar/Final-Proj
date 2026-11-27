/* AnneTea BrewTrack — Face login, "My identity" settings, and verified-ID deletion.
   Uses the face template (128-d descriptors, never photos) saved when the identity was verified (idv.js). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MATCH_FRONT = 0.45;   // live frontal face vs enrolled template (same person is normally < 0.40)
  const MATCH_TURN = 0.60;    // looser while the head is turned
  const NEED_GOOD = 3, MAX_BAD = 6, MAX_BAD_TURN = 4, TIMEOUT_MS = 60000;
  const FRONTAL = ['straight', 'closer', 'farther'];

  // ------------------------------------------------------------------
  // Live face check (camera + 1:1 match against ONE account's template + a head-turn challenge)
  // Resolves { ok, distance?, reason?, cancelled? }
  // ------------------------------------------------------------------
  function ensureModal() {
    let m = $('faModal'); if (m) return m;
    m = document.createElement('div'); m.id = 'faModal'; m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="modal-box idv-box" style="max-width:520px"><h3 id="faTitle">Face recognition</h3>
      <p class="hint-text" id="faSub" style="margin-bottom:10px"></p>
      <div class="idv-cam"><video id="faVideo" autoplay playsinline muted></video><div class="idv-oval" aria-hidden="true"></div><div class="idv-banner" id="faBanner">Starting camera…</div></div>
      <div class="idv-pills"><span class="pill" id="faPillFace">Entire face visible</span><span class="pill" id="faPillLight">Proper lighting</span><span class="pill" id="faPillClear">No glasses / mask</span></div>
      <p class="hint-text">Remove eyeglasses, sunglasses, face mask or anything covering your face. Look straight at the camera, then follow the head-turn instruction. Only one person in the frame.</p>
      <div class="idv-actions"><button type="button" class="modal-close" id="faCancel">Cancel</button></div></div>`;
    document.body.appendChild(m); return m;
  }

  function faceCheck(o) {
    return new Promise(async (resolve) => {
      const modal = ensureModal(), video = $('faVideo');
      $('faTitle').textContent = o.title || 'Face recognition'; $('faSub').textContent = o.subtitle || '';
      const banner = (t, k) => { const b = $('faBanner'); b.textContent = t; b.className = 'idv-banner' + (k ? ' ' + k : ''); };
      const pill = (id, ok) => { const p = $(id); p.className = 'pill ' + (ok === null ? '' : ok ? 'ok' : 'bad'); };
      let stream = null, done = false;
      const finish = (res) => {
        if (done) return; done = true;
        try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
        video.srcObject = null; modal.classList.remove('show'); resolve(res);
      };
      $('faCancel').onclick = () => finish({ ok: false, cancelled: true, reason: 'Cancelled.' });
      modal.classList.add('show'); banner('Starting camera…'); pill('faPillFace', null); pill('faPillLight', null); pill('faPillClear', null);
      try {
        const T = o.template || {};
        const tplAll = Object.values(T).map((d) => Float32Array.from(d));
        const tplFront = FRONTAL.map((k) => T[k]).filter(Boolean).map((d) => Float32Array.from(d));
        if (!tplFront.length) throw new Error('No face data is saved for this account.');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot access the camera. Use Chrome or Edge over https:// or localhost.');
        if (!window.IDVFace) throw new Error('Face recognition is not available. Reload the page.');
        banner('Loading face models…'); await window.IDVFace.ensureModels(); if (done) return;
        banner('Requesting camera access…');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream; await video.play().catch(() => {});
        const det = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        const turn = Math.random() < 0.5 ? 'left' : 'right';
        let phase = 'front', good = 0, bad = 0, badTurn = 0, okFrames = 0, best = 9; const t0 = Date.now();
        const obTrack = window.IDVFace.obstructionTracker();
        while (!done) {
          await sleep(170); if (done) return;
          if (Date.now() - t0 > TIMEOUT_MS) return finish({ ok: false, reason: 'Timed out. Try again in good lighting, or use your password.' });
          if (video.readyState < 2 || !video.videoWidth) continue;
          let dets; try { dets = await faceapi.detectAllFaces(video, det).withFaceLandmarks(); } catch (e) { continue; }
          if (done) return;
          if (!dets.length) { okFrames = 0; pill('faPillFace', false); banner('Looking for your face…', 'bad'); continue; }
          if (dets.length > 1) { okFrames = 0; pill('faPillFace', false); banner('Only one person should be in the frame.', 'bad'); continue; }
          const m = window.IDVFace.faceMetrics(dets[0], video); pill('faPillFace', m.inside);
          if (!m.inside) { okFrames = 0; banner('Make sure your entire face is visible.', 'bad'); continue; }
          const lt = window.IDVFace.lighting(video, m.box); pill('faPillLight', lt.ok);
          if (!lt.ok) { okFrames = 0; banner(lt.msg, 'bad'); continue; }
          const ob = obTrack(dets[0], video, m.yaw); pill('faPillClear', !ob);
          if (ob) { okFrames = 0; banner(window.IDVFace.OBSTRUCTION_MSG[ob], 'bad'); continue; }
          const key = phase === 'front' ? 'straight' : turn;
          const pc = window.IDVFace.poseCheck(key, m, m.wRatio);
          if (!pc.pass) { okFrames = 0; banner(phase === 'front' ? 'Look straight at the camera.' : 'Now slowly turn your head to your ' + turn + '.'); continue; }
          if (++okFrames < (phase === 'front' ? 3 : 2)) { banner('Hold still…', 'ok'); continue; }
          let full; try { full = await faceapi.detectSingleFace(video, det).withFaceLandmarks().withFaceDescriptor(); } catch (e) { full = null; }
          if (done) return; if (!full) { okFrames = 0; continue; }
          okFrames = 0;
          if (phase === 'front') {
            const d = Math.min(...tplFront.map((t) => faceapi.euclideanDistance(full.descriptor, t)));
            if (d <= MATCH_FRONT) { good++; best = Math.min(best, d); banner('Face recognised (' + good + '/' + NEED_GOOD + ')', 'ok'); if (good >= NEED_GOOD) { phase = 'turn'; banner('Now slowly turn your head to your ' + turn + '.'); } }
            else { bad++; if (bad >= MAX_BAD) return finish({ ok: false, reason: 'Face does not match this account.', distance: +d.toFixed(3) }); banner('Face not recognised — keep still and face the camera.', 'bad'); }
          } else {
            const d = Math.min(...tplAll.map((t) => faceapi.euclideanDistance(full.descriptor, t)));
            if (d <= MATCH_TURN) return finish({ ok: true, distance: +best.toFixed(3) });
            if (++badTurn >= MAX_BAD_TURN) return finish({ ok: false, reason: 'The face changed during the check. Please try again.' });
            banner('Keep your head turned and hold still…', 'bad');
          }
        }
      } catch (e) {
        const n = e && e.name; let msg = (e && e.message) || 'Camera error.';
        if (n === 'NotAllowedError') msg = 'Camera permission was denied. Allow camera access and try again.';
        else if (n === 'NotFoundError') msg = 'No camera was found on this device.';
        else if (n === 'NotReadableError') msg = 'The camera is being used by another application.';
        finish({ ok: false, reason: msg });
      }
    });
  }
  window.FaceAuth = { check: faceCheck };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('faModal') && $('faModal').classList.contains('show')) $('faCancel').click(); });

  // ------------------------------------------------------------------
  // Face sign-in (login screen). Username first, then a 1:1 face check for that account only.
  // ------------------------------------------------------------------
  const FAIL_KEY = 'at_face_fail';
  const fails = () => { try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{}'); } catch (e) { return {}; } };
  function lockLeft(u) { const f = fails()[u]; return f && f.n >= 5 ? Math.max(0, f.until - Date.now()) : 0; }
  function addFail(u) { const all = fails(), f = all[u] && all[u].until > Date.now() - 600000 ? all[u] : { n: 0 }; f.n++; f.until = Date.now() + 120000; all[u] = f; localStorage.setItem(FAIL_KEY, JSON.stringify(all)); }
  function clearFails(u) { const all = fails(); delete all[u]; localStorage.setItem(FAIL_KEY, JSON.stringify(all)); }

  window.loginWithFace = async function () {
    const err = $('loginError'); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const user = $('username').value.trim().toLowerCase();
    if (!user) return fail('Type your username first, then tap “Sign in with face recognition”.');
    const wait = lockLeft(user);
    if (wait > 0) return fail('Too many failed face attempts. Try again in ' + Math.ceil(wait / 1000) + ' seconds, or use your password.');
    const acct = loadAccounts()[user];
    if (!acct || !acct.faceLogin || !acct.faceTemplate) return fail('Face recognition is not turned on for this account. Please sign in with your password.');
    const res = await window.FaceAuth.check({ title: 'Face recognition sign-in', subtitle: 'Signing in as ' + user, template: acct.faceTemplate });
    if (res.cancelled) return;
    if (!res.ok) { addFail(user); return fail(res.reason || 'Face recognition failed.'); }
    clearFails(user);
    startSession(user, acct);
  };

  // ------------------------------------------------------------------
  // Delete a verified ID (erases ID details + face data, keeps an audit stub, turns face login off)
  // ------------------------------------------------------------------
  function deleteVerifiedId(user, by, method) {
    const accounts = loadAccounts(), a = accounts[user];
    if (!a || !a.idVerified) return false;
    const now = new Date().toISOString(), rid = a.verificationId;
    const list = window.idvRecords.load().map((r) => r.id !== rid ? r : {
      id: r.id, time: r.time, status: 'deleted', username: r.username, role: r.role,
      idType: '', idTypeLabel: '', idNumberMasked: '', idNumberHash: '', fullName: '', dob: '', age: null, address: '', expiry: '',
      ocrConfidence: 0, faceDistance: null, faceAttempts: 0, editedFields: [], manualCaptureSteps: [],
      reasons: ['Verified ID and face data deleted'], verifiedBy: r.verifiedBy, deletedAt: now, deletedBy: by, deleteMethod: method
    });
    window.idvRecords.save(list);
    a.idVerified = false; a.verificationId = ''; a.faceLogin = false; a.idDeletedAt = now; a.idDeletedBy = by;
    delete a.faceTemplate; delete a.faceTemplateAt; delete a.fullName;
    saveAccounts(accounts);
    if (typeof pushFullState === 'function') pushFullState();
    return true;
  }

  // Owner: delete directly from Manage → Accounts
  window.ownerDeleteId = function (user) {
    if (!session || session.role !== 'owner') return toast('Only the owner can delete a verified ID from Accounts.', 'err');
    if (!confirm('Delete the verified ID of “' + user + '”?\n\nThe ID details and saved face data are erased and face login is switched off. The account itself stays and can sign in with its password. This cannot be undone.')) return;
    if (deleteVerifiedId(user, session.username, 'owner (Accounts)')) { renderAccountsTable(); toast('Verified ID deleted for ' + user, 'ok'); }
  };

  // ------------------------------------------------------------------
  // "My identity" (every logged-in user): face-login choice + delete own ID (password + face)
  // ------------------------------------------------------------------
  const recFor = (a) => (window.idvRecords.load().find((r) => r.id === a.verificationId) || null);
  function msg(text, kind) { const e = $('myIdMsg'); if (!e) return; e.textContent = text || ''; e.className = kind === 'ok' ? 'hint-text' : 'error-msg'; e.hidden = !text; }

  window.openMyIdentity = function () {
    if (!session) return;
    renderMyId(); $('myIdModal').classList.add('show');
  };

  function renderMyId() {
    const a = loadAccounts()[session.username], body = $('myIdBody');
    if (!a) { body.innerHTML = '<p class="error-msg">Account not found.</p>'; return; }
    let h = '';
    if (a.idVerified) {
      const r = recFor(a), hasFace = !!a.faceTemplate;
      h += `<div class="idv-result ok" style="padding:10px"><div class="big" style="font-size:1.6rem">✓</div><h3 style="margin:4px 0">Identity verified</h3>
        <p class="hint-text">${r ? esc(r.idTypeLabel) + ' · ' + esc(r.idNumberMasked) + ' · ' + esc(new Date(r.time).toLocaleDateString()) : 'Verification on file'}</p></div>
        <h4 class="idv-sub">Log-in method</h4>
        ${hasFace ? `<label class="check idv-choice"><input type="checkbox" id="myIdFace" ${a.faceLogin ? 'checked' : ''}/> <span><b>Use face recognition to sign in</b><br><span class="hint-text">Type your username on the login screen, then tap “Sign in with face recognition”. Your password still works.</span></span></label>
        <div class="field" style="text-align:left;margin-top:8px"><label for="myIdPassSave">Password (to confirm the change)</label><input type="password" id="myIdPassSave" autocomplete="current-password" /></div>
        <button class="btn-sm" id="myIdSave">Save log-in method</button>`
        : '<p class="hint-text">No face data is saved for this account (it was verified before face login existed). Ask the owner to delete the ID, then verify again.</p>'}
        <h4 class="idv-sub" style="margin-top:18px;color:var(--danger)">Delete my verified ID</h4>
        <p class="hint-text">Erases your ID details and saved face data and switches face login off. ${hasFace ? 'To protect you, this needs your <b>password and a live face check</b>.' : 'Because no face data is saved, ask the owner to delete it from Accounts.'}</p>
        ${hasFace ? `<div class="field" style="text-align:left"><label for="myIdPassDel">Password</label><input type="password" id="myIdPassDel" autocomplete="current-password" /></div>
        <button class="btn-sm" id="myIdDelete" style="background:var(--danger)">Verify my face &amp; delete my ID</button>` : ''}`;
    } else {
      h += `<p class="hint-text">${a.idDeletedAt ? 'Your verified ID was deleted on ' + esc(new Date(a.idDeletedAt).toLocaleString()) + '.' : 'This account has no verified ID.'} Face sign-in is off.</p>
        <button class="btn-sm" id="myIdVerify">Verify my identity</button>`;
    }
    if (typeof notifSettingsHtml === 'function') h += notifSettingsHtml();
    body.innerHTML = h + '<p id="myIdMsg" class="error-msg" role="alert" hidden></p>';
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('myIdVerify', () => { closeAllModals(); openIdentityVerification(session.username); });
    on('myIdSave', async () => {
      const accounts = loadAccounts(), me = accounts[session.username];
      if (await sha256($('myIdPassSave').value) !== me.pass) return msg('Password is incorrect.');
      me.faceLogin = $('myIdFace').checked; saveAccounts(accounts); if (typeof pushFullState === 'function') pushFullState();
      toast(me.faceLogin ? 'Face recognition sign-in is ON' : 'Face recognition sign-in is OFF', 'ok'); renderMyId();
    });
    on('myIdDelete', async () => {
      const accounts = loadAccounts(), me = accounts[session.username];
      if (await sha256($('myIdPassDel').value) !== me.pass) return msg('Password is incorrect.');
      msg('');
      const res = await window.FaceAuth.check({ title: 'Confirm it is you', subtitle: 'Face check to delete your verified ID', template: me.faceTemplate });
      if (res.cancelled) return;
      if (!res.ok) { renderMyId(); return msg(res.reason || 'Face check failed. Your ID was NOT deleted.'); }
      if (!confirm('Last step: permanently delete your verified ID and face data?')) return;
      deleteVerifiedId(session.username, session.username, 'self (face + password)');
      toast('Your verified ID was deleted', 'ok'); renderMyId();
    });
  }
})();

// ---------------------------------------------------------------------
// Login screen: choose "Password" or "Face recognition" (face uses the face saved when the ID was verified)
// ---------------------------------------------------------------------
var loginMethod = 'password';
function setLoginMethod(m) {
  loginMethod = m === 'face' ? 'face' : 'password';
  try { localStorage.setItem('at_login_method', loginMethod); } catch (e) {}
  const face = loginMethod === 'face', $ = (id) => document.getElementById(id);
  document.querySelectorAll('.login-method button').forEach((b) => { const on = b.dataset.lm === loginMethod; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  $('loginPassField').hidden = face; $('loginPassHint').hidden = face;
  $('password').required = !face;
  $('loginBtn').hidden = face; $('loginBtn').style.display = face ? 'none' : '';   // inline style: the button's CSS would override [hidden]
  $('faceLoginBtn').hidden = !face; $('faceLoginBtn').style.display = face ? '' : 'none';
  $('loginError').hidden = true;
  updateLoginMethodHint();
}
function updateLoginMethodHint() {
  const h = document.getElementById('loginFaceHint'); if (!h) return;
  const user = (document.getElementById('username').value || '').trim().toLowerCase();
  const a = user ? (loadAccounts()[user] || null) : null, faceOn = !!(a && a.faceLogin && a.faceTemplate);
  let t = '';
  if (loginMethod === 'face') t = !user ? 'Type your username, then tap “Sign in with face recognition”. The camera checks your face against the face saved with your verified ID.'
    : a && !faceOn ? 'Face recognition is not turned on for “' + user + '”. Sign in with your password, then turn it on under My ID.' : '';
  else if (faceOn) t = 'Face recognition is on for this account — you can also choose “Face recognition” above.';
  h.textContent = t; h.hidden = !t;
}
document.addEventListener('DOMContentLoaded', () => {
  let m = 'password'; try { m = localStorage.getItem('at_login_method') || 'password'; } catch (e) {}
  if (document.querySelector('.login-method')) setLoginMethod(m);
});
