/* AnneTea BrewTrack — ID text parsing & validation (pure functions, no DOM)
   Used by idv.js. Takes raw OCR text and extracts: Full Name, Date of Birth,
   Address, ID Number, Expiration Date. Also checks completeness.

   NOTE: OCR is imperfect. Everything extracted here is shown to the user for
   review before submission, and none of it proves an ID is authentic. */
(function (root) {
  'use strict';

  // OCR often reads the digit 0 as the letter O (and 1 as I/l) inside ID numbers
  function fixDigits(s) { return String(s).replace(/O/g, '0'); }

  // ---------- Supported ID types (shown to the user in step 1) ----------
  const ID_TYPES = {
    philsys: {
      label: 'Philippine National ID (PhilSys)',
      short: 'National ID',
      required: ['name', 'dob', 'idNumber', 'address'],
      hasExpiry: false,
      keywords: ['PHILIPPINE IDENTIFICATION', 'PAMBANSANG', 'PHILSYS', 'REPUBLIKA NG PILIPINAS', 'REPUBLIC OF THE PHILIPPINES'],
      numRe: /\b[\dO]{4}[\s-]?[\dO]{4}[\s-]?[\dO]{4}[\s-]?[\dO]{4}\b/,
      format: (s) => { const d = fixDigits(s).replace(/\D/g, ''); return d.match(/.{1,4}/g).join('-'); }
    },
    driver: {
      label: "Driver's License (LTO)",
      short: "Driver's License",
      required: ['name', 'dob', 'idNumber', 'address', 'expiry'],
      hasExpiry: true,
      keywords: ['LAND TRANSPORTATION', 'DRIVER', 'LICENSE', 'LICENCE', 'LTO'],
      numRe: /\b[A-Z][\dO]{2}[\s-]?[\dO]{2}[\s-]?[\dO]{6}\b/,
      format: (s) => { const m = s.replace(/\s/g, '').match(/([A-Z])([\dO]{2})-?([\dO]{2})-?([\dO]{6})/); return m ? `${m[1]}${fixDigits(m[2])}-${fixDigits(m[3])}-${fixDigits(m[4])}` : s; }
    },
    passport: {
      label: 'Philippine Passport',
      short: 'Passport',
      required: ['name', 'dob', 'idNumber', 'expiry'],
      hasExpiry: true,
      keywords: ['PASSPORT', 'PASAPORTE'],
      numRe: /\b[A-Z][\dO]{7}[A-Z]\b/,
      format: (s) => { const t = s.replace(/\s/g, ''); return t.length === 9 ? t[0] + fixDigits(t.slice(1, 8)) + t[8] : t; }
    },
    umid: {
      label: 'UMID (Unified Multi-Purpose ID)',
      short: 'UMID',
      required: ['name', 'dob', 'idNumber'],
      hasExpiry: false,
      keywords: ['UNIFIED MULTI', 'UMID', 'SOCIAL SECURITY', 'GSIS', 'PHILHEALTH', 'PAG-IBIG'],
      numRe: /\b[\dO]{4}[\s-]?[\dO]{7}[\s-]?[\dO]\b/,
      format: (s) => { const d = fixDigits(s).replace(/\D/g, ''); return d.length === 12 ? `${d.slice(0, 4)}-${d.slice(4, 11)}-${d.slice(11)}` : s; }
    }
  };

  const FIELD_LABELS = {
    name: 'Full Name', dob: 'Date of Birth', address: 'Address',
    idNumber: 'ID Number', expiry: 'Expiration Date'
  };

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // ---------- Small helpers ----------
  const pad = (n) => String(n).padStart(2, '0');

  function cleanLines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/[|_~`]+/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 0);
  }

  function validYMD(y, m, d) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function monthIndex(word) {
    const i = MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
    return i < 0 ? 0 : i + 1;
  }

  // Finds every recognisable date in a string; returns ISO yyyy-mm-dd strings in order of appearance
  function findDates(str) {
    const s = String(str || '').replace(/(?<=\d)[Oo](?=[\d/.\-])/g, '0').replace(/(?<=[/.\-])[Oo](?=\d)/g, '0');
    const found = [];
    const add = (idx, iso) => { if (iso && !found.some((f) => f.iso === iso)) found.push({ idx, iso }); };
    let m;
    const reYMD = /\b(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/g;
    while ((m = reYMD.exec(s))) add(m.index, validYMD(+m[1], +m[2], +m[3]));
    const reMDY = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/g;
    while ((m = reMDY.exec(s))) {
      let a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) { const t = a; a = b; b = t; } // DD/MM/YYYY
      add(m.index, validYMD(+m[3], a, b));
    }
    const reDMonY = /\b(\d{1,2})\s*([A-Za-z]{3,9})\.?,?\s*(\d{4})\b/g;
    while ((m = reDMonY.exec(s))) { const mo = monthIndex(m[2]); if (mo) add(m.index, validYMD(+m[3], mo, +m[1])); }
    const reMonDY = /\b([A-Za-z]{3,9})\.?\s*(\d{1,2}),?\s*(\d{4})\b/g;
    while ((m = reMonDY.exec(s))) { const mo = monthIndex(m[1]); if (mo) add(m.index, validYMD(+m[3], mo, +m[2])); }
    return found.sort((a, b) => a.idx - b.idx).map((f) => f.iso);
  }

  function computeAge(iso, now) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const n = now || new Date();
    let age = n.getFullYear() - y;
    if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) age--;
    return age;
  }

  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s\-'.])([a-zñ])/g, (_, p, c) => p + c.toUpperCase());
  }

  function cleanName(s) {
    return String(s || '').replace(/[^A-Za-zÑñ.\-' ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- Label-based extraction ----------
  const LABELS = {
    last: /(?:apelyido\s*\/?\s*)?(?:last\s*name|surname)|apelyido/i,
    given: /(?:mga\s*pangalan\s*\/?\s*)?(?:given\s*names?|first\s*name)|mga\s*pangalan/i,
    middle: /(?:gitnang\s*apelyido\s*\/?\s*)?middle\s*name|gitnang\s*apelyido/i,
    dob: /(?:petsa\s*ng\s*kapanganakan\s*\/?\s*)?(?:date\s*of\s*birth|birth\s*date|birthdate)|petsa\s*ng\s*kapanganakan|\bdob\b/i,
    address: /(?:tirahan\s*\/?\s*)?address|tirahan/i,
    expiry: /(?:expir\w*\s*date|date\s*of\s*expiry|valid\s*until|expiration)|\bexpiry\b|\bexpires?\b/i,
    idno: /(?:licen[sc]e\s*(?:no|number)\.?|passport\s*(?:no|number)\.?|id\s*(?:no|number)\.?|\bcrn\b|\bpcn\b|card\s*(?:no|number)\.?)/i,
    fullname: /(?:full\s*name|\bname\b)/i
  };
  const OTHER_LABELS = '\\bsex\\b|nationality|blood\\s*type|date\\s*of\\s*issue|place\\s*of\\s*birth|agency\\s*code|eyes?\\s*colou?r|\\bheight\\b|\\bweight\\b|restrictions|conditions|signature|marital\\s*status|citizenship|authority';
  const ANY_LABEL = new RegExp(Object.values(LABELS).map((r) => r.source).join('|') + '|' + OTHER_LABELS, 'i');
  const ANY_LABEL_G = new RegExp(ANY_LABEL.source, 'gi');

  // Words that appear in printed labels (including OCR-truncated forms such as "Nan")
  const LABEL_WORDS = new Set(['last', 'first', 'middle', 'given', 'name', 'names', 'nan', 'nam', 'na', 'surname', 'and', 'full']);
  function isLabelOnly(rest) {
    if (rest.replace(ANY_LABEL_G, '').replace(/[\W_]+/g, '').length < 2) return true;
    const words = rest.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    return words.length > 0 && !/\d/.test(rest) && words.every((w) => LABEL_WORDS.has(w));
  }

  // Lines that should end a multi-line value (header text, ID numbers, other labels)
  function isStopLine(line) {
    if (ANY_LABEL.test(line)) return true;
    if (/^[\d\sO-]{9,}$/.test(line)) return true;
    const u = line.toUpperCase();
    return Object.values(ID_TYPES).some((t) => t.keywords.some((k) => u.includes(k)));
  }

  // Returns the value that follows a label (same line, or next line(s)).
  function labelValue(lines, re, extraLines) {
    extraLines = extraLines || 0;
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (!m) continue;
      let rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:;/\-.,]+/, '').trim();
      if (rest && isLabelOnly(rest)) rest = '';
      const vals = [];
      if (rest) vals.push(rest);
      let j = i + 1;
      while (j < lines.length && vals.length < 1 + extraLines) {
        if (isStopLine(lines[j])) break;
        vals.push(lines[j]);
        j++;
      }
      if (vals.length) return vals.join(', ');
    }
    return '';
  }

  // ---------- Passport MRZ (best effort) ----------
  function mrzDate(s, future) {
    const t = s.replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!/^\d{6}$/.test(t)) return '';
    const yy = +t.slice(0, 2), mm = +t.slice(2, 4), dd = +t.slice(4, 6);
    const curYY = new Date().getFullYear() % 100;
    const year = future ? 2000 + yy : (yy > curYY ? 1900 + yy : 2000 + yy);
    return validYMD(year, mm, dd) || '';
  }

  function parseMRZ(lines) {
    const cand = lines.map((l) => l.replace(/\s+/g, '').toUpperCase())
      .filter((l) => /^[A-Z0-9<]{36,48}$/.test(l) && l.includes('<'));
    for (let i = 0; i < cand.length - 1; i++) {
      const l1 = cand[i], l2 = cand[i + 1];
      if (l1[0] !== 'P') continue;
      const parts = l1.slice(5).split('<<');
      const surname = (parts[0] || '').replace(/</g, ' ').trim();
      const given = (parts[1] || '').replace(/</g, ' ').trim();
      return {
        name: cleanName(`${given} ${surname}`),
        idNumber: l2.slice(0, 9).replace(/</g, ''),
        dob: mrzDate(l2.slice(13, 19), false),
        expiry: mrzDate(l2.slice(21, 27), true)
      };
    }
    return null;
  }

  // ---------- Main parser ----------
  function parseID(rawText, typeKey) {
    const type = ID_TYPES[typeKey];
    const text = String(rawText || '');
    const lines = cleanLines(text);
    const upper = text.toUpperCase();
    const f = { name: '', dob: '', address: '', idNumber: '', expiry: '' };

    // NAME
    let last = '', given = '', middle = '';
    // "LAST, FIRST MIDDLE" printed under one combined label (typical for LTO licences)
    const combIdx = lines.findIndex((l) => /last\s*name\s*,?\s*first/i.test(l));
    if (combIdx >= 0) {
      for (let j = combIdx + 1; j < Math.min(lines.length, combIdx + 4); j++) {
        if (/,/.test(lines[j]) && !ANY_LABEL.test(lines[j]) && !/\d/.test(lines[j])) {
          const parts = lines[j].split(',').map((p) => cleanName(p)).filter(Boolean);
          if (parts.length >= 2) { last = parts[0]; given = parts.slice(1).join(' '); break; }
        }
      }
    }
    if (!(last && given)) {
      last = cleanName(labelValue(lines, LABELS.last));
      given = cleanName(labelValue(lines, LABELS.given));
      middle = cleanName(labelValue(lines, LABELS.middle));
    }
    if (last && given) {
      f.name = [given, middle, last].filter(Boolean).join(' ');
    } else {
      const generic = cleanName(labelValue(lines, LABELS.fullname));
      if (generic.split(' ').length >= 2) f.name = generic;
      else {
        const line = lines.find((l) => /^[A-ZÑ'.\- ]{3,},\s*[A-ZÑ'.\- ]{3,}$/.test(l));
        if (line) { const [l, g] = line.split(','); f.name = `${cleanName(g)} ${cleanName(l)}`; }
        else if (last || given) f.name = [given, middle, last].filter(Boolean).join(' ');
      }
    }

    // DATES
    const allDates = findDates(text);
    const dobLabel = findDates(labelValue(lines, LABELS.dob))[0];
    const now = new Date();
    if (dobLabel) f.dob = dobLabel;
    else {
      const plausible = allDates.filter((d) => { const a = computeAge(d, now); return a >= 5 && a <= 110; }).sort();
      if (plausible.length) f.dob = plausible[0];
    }
    const expLabel = findDates(labelValue(lines, LABELS.expiry))[0];
    if (expLabel) f.expiry = expLabel;
    else if (type.hasExpiry) {
      const others = allDates.filter((d) => d !== f.dob && d > f.dob).sort();
      if (others.length) f.expiry = others[others.length - 1];
    }

    // ADDRESS
    if (type.required.includes('address') || LABELS.address.test(text)) {
      const a = labelValue(lines, LABELS.address, 2).replace(/\s+,/g, ',').trim();
      if (a && !isLabelOnly(a)) f.address = a;
    }

    // ID NUMBER
    const numMatch = upper.match(type.numRe);
    if (numMatch) f.idNumber = type.format(numMatch[0].toUpperCase());
    else {
      const v = labelValue(lines, LABELS.idno).toUpperCase().replace(/[^A-Z0-9\- ]/g, '').trim();
      if (v.replace(/\D/g, '').length >= 6 || v.replace(/\s/g, '').length >= 8) f.idNumber = type.format(v);
    }

    // PASSPORT MRZ fallback
    if (typeKey === 'passport') {
      const mrz = parseMRZ(lines);
      if (mrz) {
        if (!f.name || f.name.split(' ').length < 2) f.name = mrz.name;
        if (!f.dob) f.dob = mrz.dob;
        if (!f.expiry) f.expiry = mrz.expiry;
        if (!f.idNumber) f.idNumber = mrz.idNumber;
      }
    }

    if (f.name) f.name = titleCase(f.name);
    // Does the text look like the ID type the user selected?
    const typeMatch = type.keywords.some((k) => upper.includes(k)) || type.numRe.test(upper);
    return { fields: f, typeMatch, lines };
  }

  // Combine the results of two OCR passes field by field (first pass wins; second fills the gaps)
  function mergeParsed(a, b) {
    const f = {};
    Object.keys(a.fields).forEach((k) => { f[k] = a.fields[k] || b.fields[k] || ''; });
    return { fields: f, typeMatch: a.typeMatch || b.typeMatch, lines: a.lines.concat(b.lines) };
  }

  // ---------- Completeness / validity check ----------
  function validateExtraction(typeKey, f, now) {
    now = now || new Date();
    const type = ID_TYPES[typeKey];
    const missing = [];
    const problems = [];

    if (!f.name || f.name.split(/\s+/).filter((w) => w.length > 1).length < 2) missing.push('name');
    if (!f.dob) missing.push('dob');
    else {
      const age = computeAge(f.dob, now);
      if (age === null || age < 0 || age > 120) problems.push('Date of birth looks invalid.');
    }
    if (!f.idNumber) missing.push('idNumber');
    if (type.required.includes('address') && (!f.address || f.address.length < 8)) missing.push('address');
    if (type.required.includes('expiry')) {
      if (!f.expiry) missing.push('expiry');
    }
    if (f.expiry) {
      const exp = new Date(f.expiry + 'T23:59:59');
      if (exp < now) problems.push('This ID has expired (expiration date: ' + f.expiry + ').');
    }
    return { ok: missing.length === 0 && problems.length === 0, missing, problems };
  }

  function maskId(id) {
    const s = String(id || '');
    return s.length <= 4 ? s : s.slice(0, -4).replace(/[A-Za-z0-9]/g, '•') + s.slice(-4);
  }

  root.IDVParser = {
    ID_TYPES, FIELD_LABELS, parseID, mergeParsed, validateExtraction, findDates,
    computeAge, titleCase, maskId, cleanLines, parseMRZ
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.IDVParser;
})(typeof window !== 'undefined' ? window : globalThis);
