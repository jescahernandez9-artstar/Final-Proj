/* AnneTea BrewTrack — Integrated Identity Verification (IT 312 Final Project)
   Required sequence:
   ID Upload → ID Scanning (OCR) → Face Registration → Face Matching → Personal Information → Final Verification

   Open-source stack (runs in the browser, no paid APIs):
   - Tesseract.js  → OCR of the uploaded ID
   - face-api.js   → face detection, landmarks (head pose) and 128-d face descriptors

   Privacy: ID photo and camera frames stay in memory only and are discarded when the dialog closes.
   Saved: the verification record (masked ID number, result, scores), the account, and a FACE TEMPLATE
   (numeric descriptors, not photos) so the person can sign in with their face and later delete their own ID. */
(function () {
  'use strict';

  const P = window.IDVParser;
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';
  const MAX_FACE_ATTEMPTS = 3;
  const MAX_SCAN_ATTEMPTS = 3;
  const MATCH_BEST = 0.55;    // best frontal distance must be at or under this
  const MATCH_MEDIAN = 0.60;  // and the median frontal distance at or under this
  const STEP_NAMES = ['ID Upload', 'ID Scan', 'Face Capture', 'Face Match', 'Your Info', 'Result'];
  const CAPTURE_STEPS = [
    { key: 'straight', text: 'Look straight at the camera' },
    { key: 'left', text: 'Look to the left' },
    { key: 'right', text: 'Look to the right' },
    { key: 'closer', text: 'Move closer to the camera' },
    { key: 'farther', text: 'Move slightly farther away' }
  ];

  let S = null;            // state of the current verification attempt
  let modelsPromise = null;

  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function freshState() {
    return {
      step: 1, consent: false, idType: '', file: null, previewUrl: '', idCanvas: null,
      fileReady: false, scanAttempts: 0,
      idOk: false, idFields: null, idDescriptor: null, ocrConf: 0, idNumberHash: '',
      captureDone: false, descriptors: {}, faceAttempts: 0, faceOk: false, faceDistance: null, faceDistances: [],
      forcedSteps: [], finalized: false, record: null, failReasons: [], loopToken: 0, stream: null, forceNow: false
    };
  }

  // =====================================================================
  // SEQUENCE ENFORCEMENT — a step can only be entered if all earlier steps passed
  // =====================================================================
  function canEnter(n) {
    if (!S) return false;
    if (n >= 2 && !S.fileReady) return false;
    if (n >= 3 && !S.idOk) return false;
    if (n >= 4 && !S.captureDone) return false;
    if (n >= 5 && !S.faceOk) return false;                 // personal info needs ID scan AND face match
    if (n >= 6 && !S.finalized) return false;
    return true;
  }

  function go(n) {
    if (!canEnter(n)) {
      toast('Please complete the previous verification steps first.', 'err');
      return;
    }
    stopCamera();
    S.step = n;
    render();
  }

  // =====================================================================
  // OPEN / CLOSE
  // =====================================================================
  window.openIdentityVerification = function (targetUser) {
    cleanup();
    S = freshState(); S.target = (typeof targetUser === 'string' && targetUser) ? targetUser : '';
    $('idvModal').classList.add('show');
    render();
    ensureModels().catch(() => {}); // warm up in background
  };

  function cleanup() {
    if (S) {
      S.loopToken++;
      if (S.previewUrl) { try { URL.revokeObjectURL(S.previewUrl); } catch (e) {} }
      S.idCanvas = null; S.idDescriptor = null; S.descriptors = {};
    }
    stopCamera();
    S = null;
  }

  window.idvCancel = function (silent) {
    if (S && S.step > 1 && S.step < 6 && !silent) {
      if (!confirm('Cancel identity verification? Your progress will be lost.')) return;
    }
    cleanup();
    $('idvModal').classList.remove('show');
  };

  // Make sure the camera is released whenever any code closes all dialogs
  const _closeAll = window.closeAllModals;
  window.closeAllModals = function () {
    if (S) cleanup();
    if (_closeAll) _closeAll();
  };

  // =====================================================================
  // LIBRARIES
  // =====================================================================
  function libsReady() {
    return !!(window.Tesseract && window.faceapi);
  }

  function ensureModels() {
    if (modelsPromise) return modelsPromise;
    modelsPromise = (async () => {
      if (!window.faceapi) throw new Error('Face recognition library could not be loaded. Check your internet connection and reload.');
      try { await faceapi.tf.ready(); } catch (e) {}
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);
    })().catch((e) => { modelsPromise = null; throw e; });
    return modelsPromise;
  }

  // =====================================================================
  // RENDERING
  // =====================================================================
  function stepperHtml() {
    return '<ol class="idv-stepper" aria-label="Verification progress">' + STEP_NAMES.map((n, i) => {
      const k = i + 1;
      const cls = k < S.step ? 'done' : k === S.step ? 'active' : '';
      return `<li class="${cls}"><span class="dot">${k < S.step ? '✓' : k}</span><span class="nm">${n}</span></li>`;
    }).join('') + '</ol>';
  }

  function render() {
    const root = $('idvRoot');
    if (!S) { root.innerHTML = ''; return; }
    let body = '';
    if (S.step === 1) body = step1Html();
    else if (S.step === 2) body = step2Html();
    else if (S.step === 3) body = step3Html();
    else if (S.step === 4) body = step4Html();
    else if (S.step === 5) body = step5Html();
    else body = step6Html();
    root.innerHTML = stepperHtml() + '<div class="idv-panel">' + body + '</div>';
    if (S.step === 1) bindStep1();
    else if (S.step === 2) runScan();
    else if (S.step === 3) startFaceCapture();
    else if (S.step === 4) runMatch();
    else if (S.step === 5) bindStep5();
    const box = root.closest('.modal-box'); if (box) box.scrollTop = 0;
  }

  // ---------------------------------------------------------------------
  // STEP 1 — VALID ID UPLOAD
  // ---------------------------------------------------------------------
  function step1Html() {
    const types = Object.entries(P.ID_TYPES);
    return `
      <h3>Step 1 · Upload a valid government ID</h3>
      <p class="hint-text">Supported IDs (choose one):</p>
      <ul class="idv-chips">${types.map(([, t]) => `<li>${esc(t.label)}</li>`).join('')}</ul>
      <div class="field">
        <label for="idvType">ID type</label>
        <select id="idvType">
          <option value="">— Select ID type —</option>
          ${types.map(([k, t]) => `<option value="${k}" ${S.idType === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="idvFile">Photo of the ID (front side)</label>
        <input type="file" id="idvFile" accept="image/jpeg,image/png,image/webp" />
      </div>
      <div id="idvPreview" class="idv-preview" ${S.previewUrl ? '' : 'hidden'}>${S.previewUrl ? `<img src="${S.previewUrl}" alt="Uploaded ID preview" />` : ''}</div>
      <p id="idvFileMsg" class="error-msg" role="alert" hidden></p>
      <p class="hint-text idv-tips">Tips: place the ID flat, upright and fully in frame with all four corners visible, in good light and without glare. Upload the side that shows your photo and personal details.</p>
      <label class="check idv-consent"><input type="checkbox" id="idvConsent" ${S.consent ? 'checked' : ''}/> <span>I consent to my ID and face being processed <b>on this device</b> for identity verification. The ID photo and camera images are not saved. A numeric <b>face template</b> (not a photo) is saved with my account so I can use face sign-in and confirm it is me before deleting my verified ID; I can delete it any time. (Use sample / synthetic IDs for testing and demos.)</span></label>
      <div class="idv-actions">
        <button type="button" class="btn-primary" id="idvNext1" disabled>Scan ID</button>
        <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
      </div>`;
  }

  function bindStep1() {
    const type = $('idvType'), file = $('idvFile'), consent = $('idvConsent'), next = $('idvNext1');
    const refresh = () => { next.disabled = !(S.consent && S.idType && S.fileReady); };
    type.addEventListener('change', () => { S.idType = type.value; refresh(); });
    consent.addEventListener('change', () => { S.consent = consent.checked; refresh(); });
    file.addEventListener('change', async () => {
      const msg = $('idvFileMsg'); msg.hidden = true;
      S.fileReady = false; S.idCanvas = null; refresh();
      const f = file.files && file.files[0];
      if (!f) return;
      try {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error('Unsupported file. Please upload a JPG, PNG or WEBP photo of your ID.');
        if (f.size > 8 * 1024 * 1024) throw new Error('Image is too large (max 8 MB).');
        const { canvas, url } = await loadImageToCanvas(f);
        if (S.previewUrl) { try { URL.revokeObjectURL(S.previewUrl); } catch (e) {} }
        S.previewUrl = url;
        const q = imageQuality(canvas);
        const prev = $('idvPreview'); prev.hidden = false; prev.innerHTML = `<img src="${url}" alt="Uploaded ID preview" />`;
        if (q.problem) throw new Error(q.problem);
        S.idCanvas = canvas; S.file = f; S.fileReady = true;
      } catch (e) {
        msg.textContent = e.message || 'Could not read that image. Please submit it again.';
        msg.hidden = false;
        file.value = '';
      }
      refresh();
    });
    next.addEventListener('click', () => go(2));
    refresh();
  }

  function loadImageToCanvas(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 2000;
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ canvas: c, url });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The file could not be opened as an image.')); };
      img.src = url;
    });
  }

  // Basic "is this image usable?" check: size, brightness, sharpness
  function imageQuality(canvas) {
    if (Math.min(canvas.width, canvas.height) < 400) return { problem: 'Image resolution is too low (at least 400 px on the short side). Please submit a clearer photo.' };
    const w = 640, h = Math.round(canvas.height * (w / canvas.width));
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const ctx = t.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) { g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += g[p]; }
    const mean = sum / g.length;
    if (mean < 45) return { problem: 'The image is too dark. Retake it in better lighting.' };
    if (mean > 240) return { problem: 'The image is overexposed. Avoid glare and retake it.' };
    // variance of Laplacian = sharpness
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      s += l; s2 += l * l; n++;
    }
    const variance = s2 / n - (s / n) * (s / n);
    if (variance < 20) return { problem: 'The image looks blurry or unreadable. Hold the camera steady and submit it again.' };
    return { problem: '' };
  }

  // ---------------------------------------------------------------------
  // STEP 2 — ID SCANNING & INFORMATION EXTRACTION (OCR)
  // ---------------------------------------------------------------------
  function step2Html() {
    return `
      <h3>Step 2 · Scanning your ID</h3>
      <div id="idvScan" class="idv-scan">
        <div class="idv-spinner" aria-hidden="true"></div>
        <p id="idvScanMsg">Preparing scanner…</p>
        <div class="idv-bar"><i id="idvScanBar" style="width:4%"></i></div>
        <p class="hint-text">The first scan downloads the OCR language data and face models, so it can take a little while.</p>
      </div>`;
  }

  function setScan(msg, pct) {
    const m = $('idvScanMsg'), b = $('idvScanBar');
    if (m) m.textContent = msg;
    if (b && pct != null) b.style.width = Math.max(4, Math.min(100, pct)) + '%';
  }

  function preprocessForOCR(src) {
    const longest = Math.max(src.width, src.height);
    const scale = longest < 1400 ? 1400 / longest : Math.min(1, 2200 / longest);
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = ((d[i] - lo) / range) * 255; d[i] = d[i + 1] = d[i + 2] = v; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function ocrOnce(canvas, psm, label, base, span) {
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => { if (m.status === 'recognizing text') setScan(label + ' ' + Math.round(m.progress * 100) + '%', base + m.progress * span); }
    });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: String(psm), user_defined_dpi: '300' });
      const { data } = await worker.recognize(canvas);
      return { text: data.text || '', conf: data.confidence || 0 };
    } finally { await worker.terminate(); }
  }

  async function detectIdFace(canvas) {
    const tries = [0, 90, 270, 180];
    for (const deg of tries) {
      let c = canvas;
      if (deg) {
        c = document.createElement('canvas');
        const swap = deg === 90 || deg === 270;
        c.width = swap ? canvas.height : canvas.width; c.height = swap ? canvas.width : canvas.height;
        const ctx = c.getContext('2d');
        ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      }
      const all = await faceapi.detectAllFaces(c, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 })).withFaceLandmarks().withFaceDescriptors();
      if (all.length) {
        all.sort((a, b) => b.detection.box.area - a.detection.box.area); // main portrait = biggest face
        return all[0];
      }
    }
    return null;
  }

  async function runScan() {
    const fail = (reasons) => scanFailed(reasons);
    if (!libsReady()) return fail(['The OCR / face libraries did not load. Check your internet connection, reload the page, and try again.']);
    try {
      setScan('Loading face models…', 6);
      await ensureModels();
      if (!S) return;

      // --- OCR ---
      const prepared = preprocessForOCR(S.idCanvas);
      setScan('Reading text (pass 1)…', 15);
      let r1 = await ocrOnce(prepared, 11, 'Reading text (pass 1)…', 15, 35);
      if (!S) return;
      let text = r1.text, conf = r1.conf;
      let parsed = P.parseID(text, S.idType);
      let check = P.validateExtraction(S.idType, parsed.fields);
      if (!check.ok && check.missing.length) {
        setScan('Some fields missing — trying a second pass…', 52);
        const r2 = await ocrOnce(prepared, 6, 'Reading text (pass 2)…', 52, 28);
        if (!S) return;
        const parsed2 = P.mergeParsed(parsed, P.parseID(r2.text, S.idType));
        const check2 = P.validateExtraction(S.idType, parsed2.fields);
        parsed = parsed2; check = check2; text = text + '\n' + r2.text;
        conf = Math.max(conf, r2.conf);
      }
      S.ocrConf = Math.round(conf);

      const reasons = [];
      const alnum = text.replace(/[^A-Za-z0-9]/g, '').length;
      if (alnum < 25 || conf < 30) reasons.push('The ID text is unreadable (OCR confidence ' + Math.round(conf) + '%). Retake the photo with less glare and better focus.');
      else {
        if (!parsed.typeMatch) reasons.push('This does not look like a ' + P.ID_TYPES[S.idType].label + '. Check the selected ID type or upload the correct side of the ID.');
        check.missing.forEach((k) => reasons.push(P.FIELD_LABELS[k] + ' is missing or unreadable.'));
        check.problems.forEach((p) => reasons.push(p));
      }

      // --- Face on the ID photo (needed for matching later) ---
      setScan('Locating the photo on the ID…', 84);
      const idFace = await detectIdFace(S.idCanvas);
      if (!S) return;
      if (!idFace) reasons.push('No clear face photo was found on the ID. Make sure the portrait is visible and not covered by glare.');

      // --- Duplicate ID check (same ID number already used for a verified account) ---
      let hash = '';
      if (parsed.fields.idNumber) {
        hash = await sha256((S.idType + ':' + parsed.fields.idNumber).toUpperCase());
        const accts = loadAccounts();
        const dup = loadRecords().find((r) => r.status === 'verified' && r.idNumberHash === hash && accts[r.username]);
        if (dup) reasons.push('This ID has already been used to verify account "' + (dup.username || '—') + '".');
      }

      setScan('Finishing…', 98);
      if (reasons.length) return fail(reasons);

      S.idOk = true; S.idFields = parsed.fields; S.idDescriptor = idFace.descriptor; S.idNumberHash = hash;
      scanSucceeded();
    } catch (e) {
      console.error(e);
      fail([(e && e.message) || 'Scanning failed unexpectedly. Please try again.']);
    }
  }

  function scanSucceeded() {
    const f = S.idFields, type = P.ID_TYPES[S.idType];
    const rows = ['name', 'dob', 'address', 'idNumber', 'expiry']
      .filter((k) => f[k] || type.required.includes(k))
      .map((k) => `<tr><th>${P.FIELD_LABELS[k]}</th><td>${esc(f[k] || '—')}</td><td class="ok">✓</td></tr>`).join('');
    $('idvScan').outerHTML = `
      <div class="idv-result ok"><div class="big">✓</div><h3>ID scanned successfully</h3>
        <p class="hint-text">OCR confidence ${S.ocrConf}% · all required details are readable · portrait found.</p></div>
      <table class="idv-table"><tbody>${rows}</tbody></table>
      <p class="hint-text">You can review and correct these details later. Next: face registration with your camera.</p>
      <div class="idv-actions">
        <button type="button" class="btn-primary" onclick="idvGo(3)">Continue to face registration</button>
        <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
      </div>`;
  }

  async function scanFailed(reasons) {
    S.scanAttempts++;
    S.failReasons = reasons;
    const left = MAX_SCAN_ATTEMPTS - S.scanAttempts;
    if (left <= 0) {
      await finalizeFailure('ID scanning failed ' + MAX_SCAN_ATTEMPTS + ' times: ' + reasons.join(' '));
      return;
    }
    $('idvScan').outerHTML = `
      <div class="idv-result bad"><div class="big">✗</div><h3>This ID needs to be submitted again</h3></div>
      <ul class="idv-reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="hint-text">Attempt ${S.scanAttempts} of ${MAX_SCAN_ATTEMPTS}. ${left} retr${left === 1 ? 'y' : 'ies'} left.</p>
      <div class="idv-actions">
        <button type="button" class="btn-primary" onclick="idvRetryUpload()">Upload ID again</button>
        <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
      </div>`;
  }

  window.idvRetryUpload = function () {
    if (!S) return;
    if (S.previewUrl) { try { URL.revokeObjectURL(S.previewUrl); } catch (e) {} }
    S.previewUrl = ''; S.file = null; S.idCanvas = null; S.fileReady = false;
    S.idOk = false; S.idFields = null; S.idDescriptor = null;
    S.step = 1; render();
  };
  window.idvGo = go;

  // ---------------------------------------------------------------------
  // STEP 3 — FACE REGISTRATION & CAPTURE (guided)
  // ---------------------------------------------------------------------
  function step3Html() {
    return `
      <h3>Step 3 · Face registration</h3>
      <div class="idv-cam">
        <video id="idvVideo" autoplay playsinline muted></video>
        <div class="idv-oval" aria-hidden="true"></div>
        <div class="idv-banner" id="idvBanner">Starting camera…</div>
      </div>
      <div class="idv-pills">
        <span class="pill" id="pillFace">Entire face visible</span>
        <span class="pill" id="pillLight">Proper lighting</span>
      </div>
      <ol class="idv-capsteps" id="idvCapList">
        ${CAPTURE_STEPS.map((c, i) => `<li id="cap-${c.key}" class="${i === 0 ? 'now' : ''}"><span class="ci">${i + 1}</span>${c.text}</li>`).join('')}
      </ol>
      <p class="hint-text">Follow the instructions one at a time. Make sure your entire face is visible and the room is well lit. Capture happens automatically.</p>
      <button type="button" class="btn-sm idv-force" id="idvForce" hidden>Capture this step anyway</button>
      <p id="idvCamErr" class="error-msg" role="alert" hidden></p>
      <div class="idv-actions">
        <button type="button" class="modal-close" id="idvRestartCap">Restart capture</button>
        <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
      </div>`;
  }

  function stopCamera() {
    if (S) S.loopToken++;
    const v = $('idvVideo');
    if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; }
    if (S && S.stream) { S.stream.getTracks().forEach((t) => t.stop()); S.stream = null; }
  }

  function banner(text, kind) {
    const b = $('idvBanner'); if (!b) return;
    b.textContent = text; b.className = 'idv-banner' + (kind ? ' ' + kind : '');
  }
  function pill(id, ok) { const p = $(id); if (p) p.className = 'pill ' + (ok === null ? '' : ok ? 'ok' : 'bad'); }

  async function startFaceCapture() {
    S.descriptors = {}; S.forcedSteps = []; S.captureDone = false;
    const camErr = $('idvCamErr');
    $('idvRestartCap').addEventListener('click', () => { if (S) { stopCamera(); render(); } });
    $('idvForce').addEventListener('click', () => { if (S) S.forceNow = true; });
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot access the camera. Use Chrome or Edge over https:// or localhost.');
      banner('Loading face models…');
      await ensureModels();
      if (!S || S.step !== 3) return;
      banner('Requesting camera access…');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!S || S.step !== 3) { stream.getTracks().forEach((t) => t.stop()); return; }
      S.stream = stream;
      const video = $('idvVideo');
      video.srcObject = stream;
      await video.play().catch(() => {});
      const token = ++S.loopToken;
      captureLoop(token);
    } catch (e) {
      const name = e && e.name;
      let msg = (e && e.message) || 'Camera error.';
      if (name === 'NotAllowedError') msg = 'Camera permission was denied. Allow camera access in the browser and try again.';
      else if (name === 'NotFoundError') msg = 'No camera was found on this device.';
      else if (name === 'NotReadableError') msg = 'The camera is being used by another application.';
      banner('Camera unavailable', 'bad');
      camErr.textContent = msg; camErr.hidden = false;
    }
  }

  function faceMetrics(det, video) {
    const box = det.detection.box, vw = video.videoWidth, vh = video.videoHeight;
    const pts = det.landmarks.positions;
    const jawL = pts[0].x, jawR = pts[16].x, nose = pts[30].x;
    const yaw = (nose - (jawL + jawR) / 2) / Math.max(1, (jawR - jawL)); // + = user's left (raw, un-mirrored frame)
    const inside = pts.every((p) => p.x > 2 && p.y > 2 && p.x < vw - 2 && p.y < vh - 2) &&
      box.x > -box.width * 0.02 && box.y > -box.height * 0.02;
    return { box, yaw, wRatio: box.width / vw, inside };
  }

  const lumCanvas = document.createElement('canvas');
  function lighting(video, box) {
    const w = 64, h = 48;
    lumCanvas.width = w; lumCanvas.height = h;
    const ctx = lumCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const sx = Math.max(0, Math.floor(box.x / video.videoWidth * w)), sy = Math.max(0, Math.floor(box.y / video.videoHeight * h));
    const sw = Math.max(4, Math.min(w - sx, Math.floor(box.width / video.videoWidth * w))), sh = Math.max(4, Math.min(h - sy, Math.floor(box.height / video.videoHeight * h)));
    const d = ctx.getImageData(sx, sy, sw, sh).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += l; sum2 += l * l; n++; }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    if (mean < 55) return { ok: false, msg: 'Too dark — move to a brighter place or face a light.' };
    if (mean > 220) return { ok: false, msg: 'Too bright — avoid strong backlight or glare.' };
    if (sd < 10) return { ok: false, msg: 'Lighting looks flat or uneven — adjust the light on your face.' };
    return { ok: true };
  }

  function poseCheck(key, m, baseW) {
    const ay = Math.abs(m.yaw);
    switch (key) {
      case 'straight':
        if (ay > 0.10) return { pass: false, hint: 'Face the camera directly.' };
        if (m.wRatio < 0.18) return { pass: false, hint: 'Move a little closer.' };
        if (m.wRatio > 0.65) return { pass: false, hint: 'Move back a little.' };
        return { pass: true };
      case 'left':
        return m.yaw >= 0.16 ? { pass: true } : { pass: false, hint: 'Turn your head slowly to your left.' };
      case 'right':
        return m.yaw <= -0.16 ? { pass: true } : { pass: false, hint: 'Turn your head slowly to your right.' };
      case 'closer':
        if (ay > 0.2) return { pass: false, hint: 'Face the camera while moving closer.' };
        return m.wRatio >= baseW * 1.25 ? { pass: true } : { pass: false, hint: 'Move closer to the camera.' };
      case 'farther':
        if (ay > 0.2) return { pass: false, hint: 'Face the camera while moving back.' };
        if (m.wRatio < 0.12) return { pass: false, hint: 'A bit closer — your face is too small.' };
        return m.wRatio <= baseW * 0.8 ? { pass: true } : { pass: false, hint: 'Move slightly farther from the camera.' };
    }
    return { pass: false };
  }

  async function captureLoop(token) {
    const video = $('idvVideo');
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    let idx = 0, okFrames = 0, baseW = null, stepStart = Date.now(), noFaceSince = Date.now();
    while (S && token === S.loopToken) {
      await sleep(170);
      if (!S || token !== S.loopToken) return;
      if (video.readyState < 2 || !video.videoWidth) continue;
      const cur = CAPTURE_STEPS[idx];
      let dets;
      try { dets = await faceapi.detectAllFaces(video, opts).withFaceLandmarks(); } catch (e) { continue; }
      if (!S || token !== S.loopToken) return;

      if (!dets.length) {
        okFrames = 0; pill('pillFace', false); pill('pillLight', null);
        banner(Date.now() - noFaceSince > 3000 ? 'No face detected — position your face inside the oval.' : 'Looking for your face…', 'bad');
        continue;
      }
      noFaceSince = Date.now();
      if (dets.length > 1) { okFrames = 0; pill('pillFace', false); banner('Only one person should be in the frame.', 'bad'); continue; }
      const det = dets[0];
      const m = faceMetrics(det, video);
      pill('pillFace', m.inside);
      if (!m.inside) { okFrames = 0; banner('Make sure your entire face is visible.', 'bad'); continue; }
      const lt = lighting(video, m.box);
      pill('pillLight', lt.ok);
      if (!lt.ok) { okFrames = 0; banner(lt.msg, 'bad'); continue; }

      const pc = poseCheck(cur.key, m, baseW || m.wRatio);
      const forced = S.forceNow && cur.key !== 'straight';
      if (!pc.pass && !forced) {
        okFrames = 0;
        banner(cur.text + (pc.hint ? ' — ' + pc.hint : ''));
        $('idvForce').hidden = !(cur.key !== 'straight' && Date.now() - stepStart > 14000);
        continue;
      }
      okFrames++;
      if (okFrames < 4 && !forced) { banner('Hold still…', 'ok'); continue; }

      // Capture: compute the 128-d descriptor for this pose
      let full;
      try { full = await faceapi.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor(); } catch (e) { full = null; }
      if (!S || token !== S.loopToken) return;
      if (!full) { okFrames = 0; continue; }
      S.descriptors[cur.key] = full.descriptor;
      if (forced) S.forcedSteps.push(cur.key);
      if (cur.key === 'straight') baseW = m.wRatio;
      S.forceNow = false; $('idvForce').hidden = true;
      const li = $('cap-' + cur.key); if (li) { li.classList.remove('now'); li.classList.add('done'); }
      idx++; okFrames = 0; stepStart = Date.now();
      if (idx >= CAPTURE_STEPS.length) {
        S.captureDone = true;
        banner('All captures complete ✓', 'ok');
        await sleep(600);
        if (S && token === S.loopToken) go(4);
        return;
      }
      const nxt = $('cap-' + CAPTURE_STEPS[idx].key); if (nxt) nxt.classList.add('now');
      banner(CAPTURE_STEPS[idx].text);
    }
  }

  // ---------------------------------------------------------------------
  // STEP 4 — FACE RECOGNITION & IDENTITY MATCHING
  // ---------------------------------------------------------------------
  function step4Html() {
    return `
      <h3>Step 4 · Matching your face with the ID</h3>
      <div id="idvMatch" class="idv-scan"><div class="idv-spinner" aria-hidden="true"></div><p>Comparing your face with the ID photo…</p></div>`;
  }

  async function runMatch() {
    await sleep(500);
    if (!S || S.step !== 4) return;
    const frontal = ['straight', 'closer', 'farther'].map((k) => S.descriptors[k]).filter(Boolean);
    if (!frontal.length || !S.idDescriptor) {
      return matchResult(false, null, 'The captured face images were unclear. Please repeat the face capture.', true);
    }
    const dists = frontal.map((d) => faceapi.euclideanDistance(d, S.idDescriptor)).sort((a, b) => a - b);
    const best = dists[0], median = dists[Math.floor(dists.length / 2)];
    S.faceDistances = dists.map((d) => +d.toFixed(3));
    S.faceDistance = +best.toFixed(3);
    const ok = best <= MATCH_BEST && median <= MATCH_MEDIAN;
    matchResult(ok, best, '', false);
  }

  function matchResult(ok, best, note, unclear) {
    const box = $('idvMatch'); if (!box) return;
    if (ok) {
      S.faceOk = true;
      box.outerHTML = `
        <div class="idv-result ok"><div class="big">✓</div><h3>Face matches the ID</h3>
          <p class="hint-text">Match distance ${best.toFixed(2)} (must be ≤ ${MATCH_BEST.toFixed(2)}). The captured face matches the person shown on the ID.</p></div>
        <div class="idv-actions">
          <button type="button" class="btn-primary" onclick="idvGo(5)">Continue to personal information</button>
        </div>`;
    } else {
      S.faceOk = false; S.faceAttempts++;
      const left = MAX_FACE_ATTEMPTS - S.faceAttempts;
      if (left <= 0) {
        finalizeFailure('Face did not match the ID photo after ' + MAX_FACE_ATTEMPTS + ' attempts' + (best != null ? ' (best distance ' + best.toFixed(2) + ').' : '.'));
        return;
      }
      box.outerHTML = `
        <div class="idv-result bad"><div class="big">✗</div><h3>Face does not match the ID</h3>
          <p class="hint-text">${esc(note || (best != null ? 'Match distance ' + best.toFixed(2) + ' is above the allowed ' + MATCH_BEST.toFixed(2) + '.' : ''))}
          Make sure you are the person on the ID, remove glasses or hats if possible, and face a light source.</p></div>
        <p class="hint-text">Attempt ${S.faceAttempts} of ${MAX_FACE_ATTEMPTS}. ${left} retr${left === 1 ? 'y' : 'ies'} left.</p>
        <div class="idv-actions">
          <button type="button" class="btn-primary" onclick="idvRetryFace()">Repeat face capture</button>
          <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
        </div>`;
    }
  }

  window.idvRetryFace = function () {
    if (!S) return;
    S.captureDone = false; S.descriptors = {}; S.faceOk = false;
    go(3);
  };

  // ---------------------------------------------------------------------
  // STEP 5 — PERSONAL INFORMATION (only reachable after ID scan AND face match)
  // ---------------------------------------------------------------------
  function step5Html() {
    if (!S.idOk || !S.faceOk) return '<p class="error-msg">Access denied. Complete ID scanning and face matching first.</p>';
    const f = S.idFields, type = P.ID_TYPES[S.idType];
    const showExpiry = !!(f.expiry || type.hasExpiry);
    return `
      <h3>Step 5 · Personal information</h3>
      <p class="hint-text">Filled in automatically from your ID. Please review — OCR can make mistakes, so fix anything that is wrong. Edited fields are noted in the verification record.</p>
      <form id="idvForm" autocomplete="off" novalidate>
        <div class="field"><label for="pfName">Full name</label><input type="text" id="pfName" value="${esc(f.name)}" required /></div>
        <div class="idv-row">
          <div class="field"><label for="pfDob">Date of birth</label><input type="date" id="pfDob" value="${esc(f.dob)}" required /></div>
          <div class="field"><label for="pfAge">Age (automatic)</label><input type="text" id="pfAge" readonly /></div>
        </div>
        <div class="field"><label for="pfAddress">Address</label><input type="text" id="pfAddress" value="${esc(f.address)}" ${type.required.includes('address') ? 'required' : ''} /></div>
        <div class="idv-row">
          <div class="field"><label for="pfIdType">ID type</label><input type="text" id="pfIdType" value="${esc(type.label)}" readonly /></div>
          <div class="field"><label for="pfIdNo">ID number</label><input type="text" id="pfIdNo" value="${esc(f.idNumber)}" required /></div>
        </div>
        ${showExpiry ? `<div class="field"><label for="pfExp">Expiration date</label><input type="date" id="pfExp" value="${esc(f.expiry)}" /></div>` : ''}
        ${S.target ? '' : `        <h4 class="idv-sub">Account setup</h4>
        <div class="idv-row">
          <div class="field"><label for="pfUser">Username</label><input type="text" id="pfUser" autocomplete="off" required /></div>
          <div class="field"><label for="pfRole">Role</label>
            <select id="pfRole"><option value="staff">Staff</option><option value="co_owner">Co-owner</option><option value="owner">Owner</option></select></div>
        </div>
        <div class="field"><label for="pfEmail">Gmail address</label><input type="email" id="pfEmail" placeholder="name@gmail.com" autocomplete="off" /></div>
        <div class="field"><label for="pfPass">Password</label><input type="password" id="pfPass" autocomplete="new-password" minlength="8" maxlength="15" required />
          <p class="hint-text" style="margin-top:4px">8–15 · upper · lower · number · symbol (e.g. Pass@1234)</p></div>
`}
        <p id="pfErr" class="error-msg" role="alert" hidden></p>
        <div class="idv-actions">
          <button type="submit" class="btn-primary">Submit for final verification</button>
          <button type="button" class="modal-close" onclick="idvCancel()">Cancel</button>
        </div>
      </form>`;
  }

  function bindStep5() {
    if (!S.idOk || !S.faceOk) { S.step = 1; return; }
    const dob = $('pfDob'), age = $('pfAge');
    const upd = () => { const a = P.computeAge(dob.value); age.value = a == null || isNaN(a) ? '' : a + ' years old'; };
    dob.addEventListener('input', upd); upd();
    $('idvForm').addEventListener('submit', submitInfo);
  }

  async function submitInfo(e) {
    e.preventDefault();
    if (!S || !S.idOk || !S.faceOk) return;   // gate re-checked at submit time
    const err = $('pfErr'); err.hidden = true;
    const bad = (m) => { err.textContent = m; err.hidden = false; };
    const v = (id) => ($(id) ? $(id).value.trim() : '');
    const info = { name: v('pfName'), dob: v('pfDob'), address: v('pfAddress'), idNumber: v('pfIdNo'), expiry: v('pfExp') };
    const type = P.ID_TYPES[S.idType];
    const existing = S.target ? loadAccounts()[S.target] : null;
    const user = existing ? S.target : v('pfUser').toLowerCase(), role = existing ? existing.role : v('pfRole'), email = existing ? (existing.email || '') : v('pfEmail').toLowerCase(), pass = existing ? '' : $('pfPass').value;

    if (info.name.split(/\s+/).filter(Boolean).length < 2) return bad('Please enter your full name.');
    const age = P.computeAge(info.dob);
    if (!info.dob || age == null || isNaN(age) || age < 0 || age > 120) return bad('Please enter a valid date of birth.');
    if (type.required.includes('address') && info.address.length < 8) return bad('Please enter your address.');
    if (info.idNumber.length < 6) return bad('Please enter the ID number.');
    if (info.expiry && new Date(info.expiry + 'T23:59:59') < new Date()) return bad('The expiration date shows this ID has expired.');
    const accounts = loadAccounts();
    if (!existing) {
      if (!user || user.length < 2) return bad('Username is required.');
      if (accounts[user]) return bad('Username already exists.');
      const pol = validatePasswordPolicy(pass); if (pol) return bad(pol);
      if (email && !isValidGmail(email)) return bad('Gmail must end with @gmail.com');
    }

    const edited = ['name', 'dob', 'address', 'idNumber', 'expiry'].filter((k) => (info[k] || '') !== (S.idFields[k] || ''));
    const idNo = info.idNumber.toUpperCase();
    const rec = {
      id: 'IDV-' + Date.now().toString(36).toUpperCase(),
      time: new Date().toISOString(), status: 'verified', username: user, role,
      idType: S.idType, idTypeLabel: type.label,
      idNumberMasked: P.maskId(idNo), idNumberHash: await sha256((S.idType + ':' + S.idFields.idNumber).toUpperCase()),
      fullName: P.titleCase(info.name), dob: info.dob, age, address: info.address, expiry: info.expiry || '',
      ocrConfidence: S.ocrConf, faceDistance: S.faceDistance, faceAttempts: S.faceAttempts + 1,
      editedFields: edited, manualCaptureSteps: S.forcedSteps.slice(),
      reasons: [], verifiedBy: (typeof session !== 'undefined' && session && session.username) || ''
    };
    // Face template = descriptors of the live captures (numbers only, no images). Used for face sign-in and for confirming ID deletion.
    const faceTemplate = {};
    ['straight', 'left', 'right', 'closer', 'farther'].forEach((k) => { if (S.descriptors[k]) faceTemplate[k] = Array.from(S.descriptors[k]).map((x) => +x.toFixed(4)); });
    const faceFields = { fullName: rec.fullName, idVerified: true, verificationId: rec.id, faceTemplate, faceTemplateAt: rec.time, faceLogin: false, idDeletedAt: '', idDeletedBy: '' };
    if (existing) accounts[user] = Object.assign({}, existing, faceFields);
    else accounts[user] = Object.assign({
      pass: await sha256(pass), role,
      name: role === 'owner' ? 'Owner' : role === 'co_owner' ? 'Co-owner' : 'Staff',
      email: email || ''
    }, faceFields);
    saveAccounts(accounts);
    saveRecord(rec);
    S.record = rec; S.finalized = true;
    go(6);
  }

  // ---------------------------------------------------------------------
  // STEP 6 — FINAL VERIFICATION RESULT
  // ---------------------------------------------------------------------
  function step6Html() {
    const r = S.record;
    if (r && r.status === 'verified') {
      return `
        <div class="idv-result ok"><div class="big">✓</div><h3>Identity verified</h3>
          <p class="hint-text">Account <b>${esc(r.username)}</b> ${S.target ? 'is now verified' : 'was created'} for <b>${esc(r.fullName)}</b>.</p></div>
        <div class="idv-loginpick" id="idvLoginPick">
          <h4 class="idv-sub">How do you want to sign in?</h4>
          <p class="hint-text">Choose one. You can change it later under “My ID”.</p>
          <label class="check idv-choice"><input type="radio" name="idvLogin" value="password" onchange="idvPickLogin(this.value)"/> <span><b>Password only</b><br><span class="hint-text">Sign in with username and password.</span></span></label>
          <label class="check idv-choice"><input type="radio" name="idvLogin" value="face" onchange="idvPickLogin(this.value)"/> <span><b>Password or face recognition</b><br><span class="hint-text">Also allow signing in with my face. Your face template is stored with your account.</span></span></label>
        </div>
        <table class="idv-table"><tbody>
          <tr><th>ID upload</th><td>${esc(r.idTypeLabel)}</td><td class="ok">✓</td></tr>
          <tr><th>ID scan (OCR)</th><td>Confidence ${r.ocrConfidence}% · ${esc(r.idNumberMasked)}</td><td class="ok">✓</td></tr>
          <tr><th>Face match</th><td>Distance ${r.faceDistance.toFixed(2)} · attempt ${r.faceAttempts}</td><td class="ok">✓</td></tr>
          <tr><th>Information reviewed</th><td>${r.editedFields.length ? 'Edited: ' + esc(r.editedFields.join(', ')) : 'No edits'}</td><td class="ok">✓</td></tr>
          <tr><th>Record saved</th><td>${esc(r.id)} · ${new Date(r.time).toLocaleString()}</td><td class="ok">✓</td></tr>
        </tbody></table>
        ${limitationsHtml()}
        <div class="idv-actions"><button type="button" class="btn-primary" id="idvDoneBtn" onclick="idvDone()" disabled>Done</button><span class="hint-text" id="idvDoneHint">Pick a sign-in method to continue.</span></div>`;
    }
    const reasons = (r && r.reasons) || S.failReasons || [];
    return `
      <div class="idv-result bad"><div class="big">✗</div><h3>Verification unsuccessful</h3>
        <p class="hint-text">No account was created. This attempt has been recorded${r ? ' (' + esc(r.id) + ')' : ''}.</p></div>
      <ul class="idv-reasons">${reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="idv-actions">
        <button type="button" class="btn-primary" onclick="openIdentityVerification()">Start over</button>
        <button type="button" class="modal-close" onclick="idvDone()">Close</button>
      </div>`;
  }

  function limitationsHtml() {
    return `<details class="idv-limits"><summary>Limitations of this verification</summary>
      <ul>
        <li>Successful OCR and a face match do <b>not</b> prove the ID is genuine. The system cannot check holograms, security features, or the issuing agency's database, so a forged or edited ID could still pass.</li>
        <li>There is no liveness detection. The multi-pose capture makes simple photo spoofing harder but does not stop a determined attempt (e.g. video replay).</li>
        <li>OCR accuracy depends on photo quality, glare and ID layout; face matching can be affected by lighting, age of the ID photo, glasses and image quality.</li>
        <li>All checks run in the browser, so they can be tampered with by someone with technical access. A production system should repeat them on a server and use a trusted verification source.</li>
        <li>Use only consenting users and sample / synthetic IDs for demos.</li>
      </ul></details>`;
  }

  window.idvPickLogin = function (v) {
    if (!S) return; S.loginChoice = v;
    const b = $('idvDoneBtn'); if (b) b.disabled = false; const h = $('idvDoneHint'); if (h) h.hidden = true;
  };

  window.idvDone = function () {
    if (S && S.record && S.record.status === 'verified') {
      if (!S.loginChoice) return;
      const accounts = loadAccounts(), a = accounts[S.record.username];
      if (a) { a.faceLogin = S.loginChoice === 'face'; saveAccounts(accounts); }
    }
    window.idvCancel(true);
    if (typeof renderAccountsTable === 'function') renderAccountsTable();
  };

  async function finalizeFailure(reason) {
    const rec = {
      id: 'IDV-' + Date.now().toString(36).toUpperCase(),
      time: new Date().toISOString(), status: 'failed', username: '',
      idType: S.idType, idTypeLabel: S.idType ? P.ID_TYPES[S.idType].label : '',
      idNumberMasked: S.idFields ? P.maskId(S.idFields.idNumber) : '', idNumberHash: S.idNumberHash || '',
      fullName: '', dob: '', age: null, address: '', expiry: '',
      ocrConfidence: S.ocrConf || 0, faceDistance: S.faceDistance, faceAttempts: S.faceAttempts,
      editedFields: [], manualCaptureSteps: [], reasons: [reason],
      verifiedBy: (typeof session !== 'undefined' && session && session.username) || ''
    };
    saveRecord(rec);
    S.record = rec; S.finalized = true; S.step = 6;
    stopCamera();
    render();
  }

  // =====================================================================
  // VERIFICATION RECORDS (saved locally + pushed to the shared server if present)
  // =====================================================================
  window.idvRecords = {
    load: function () { return loadRecords(); },
    save: function (list) { localStorage.setItem('at_verifications', JSON.stringify(list.slice(0, 500))); }
  };
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem('at_verifications') || '[]'); } catch (e) { return []; }
  }
  function saveRecord(rec) {
    const list = loadRecords(); list.unshift(rec);
    localStorage.setItem('at_verifications', JSON.stringify(list.slice(0, 500)));
    if (typeof API_BASE !== 'undefined' && API_BASE) {
      fetch(API_BASE + '/api/verifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }).catch(() => {});
    }
    if (typeof pushFullState === 'function') pushFullState();
  }

  window.renderVerificationLog = function () {
    const el = $('verifTable'); if (!el) return;
    const list = loadRecords();
    if (!list.length) { el.innerHTML = '<p class="hint-text" style="padding:8px 2px">No verification attempts yet.</p>'; return; }
    el.innerHTML = '<table><thead><tr><th>Date</th><th>Result</th><th>Account</th><th>ID</th><th>Face distance</th></tr></thead><tbody>' +
      list.slice(0, 50).map((r) => `<tr>
        <td style="font-size:.8rem">${esc(new Date(r.time).toLocaleString())}</td>
        <td><span class="pill-status ${r.status === 'verified' ? 'ok' : 'bad'}" title="${esc((r.reasons || []).join(' ') + (r.deletedAt ? ' · deleted by ' + (r.deletedBy || '?') + ' via ' + (r.deleteMethod || '?') + ' on ' + new Date(r.deletedAt).toLocaleString() : ''))}">${r.status === 'verified' ? '✓ Verified' : r.status === 'deleted' ? '🗑 ID deleted' : '✗ Failed'}</span></td>
        <td>${esc(r.username || '—')}</td>
        <td style="font-size:.8rem">${esc(r.idTypeLabel || '—')}<br>${esc(r.idNumberMasked || '')}</td>
        <td>${r.faceDistance == null ? '—' : esc(r.faceDistance)}</td></tr>`).join('') + '</tbody></table>';
  };

  // Pull records that other devices pushed (shared mode)
  window.idvMergeRemoteRecords = function (remote) {
    if (!Array.isArray(remote)) return;
    const byId = new Map();
    loadRecords().concat(remote).forEach((r) => {
      if (!r || !r.id) return;
      const old = byId.get(r.id);
      if (!old || (r.status === 'deleted' && old.status !== 'deleted')) byId.set(r.id, r);   // a deletion always wins
    });
    const merged = Array.from(byId.values()).sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 500);
    localStorage.setItem('at_verifications', JSON.stringify(merged));
  };

  // Shared helpers for face-auth.js (face sign-in, ID deletion)
  window.IDVFace = { ensureModels, faceMetrics, lighting, poseCheck };

  // Esc key handled here for this dialog (app.js ignores it)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S && $('idvModal').classList.contains('show')) window.idvCancel();
  });
})();
