# Frontend UX Fixes Design

**Date:** 2026-02-22
**Scope:** `js/app.js`, `scripts/fetch_data.js`, `index.html`

---

## Fix 1: Reference Search Input Loses Focus

**Root Cause:** `setReferenceSearch()` → `renderReferenceView()` → `container.innerHTML = ...` destroys the `<input>` DOM node on every keystroke, losing browser focus.

**Fix:**
- Add `id="ref-search-input"` to the search `<input>` in `renderReferenceView`.
- After `container.innerHTML = ...`, call:
  ```js
  const inp = document.getElementById('ref-search-input');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  ```
- Apply same pattern in `setReferenceCategory` (re-render after category click should not move focus to search, so only restore focus when triggered from search input handler).

---

## Fix 2: City Filter in Reference View

**Design:**
- New state variable: `let referenceCityFilter = '全部';`
- City list: extract unique `city` values from **all** `referenceData` (not filtered subset), prepend `'全部'`.
- Add a second pill-row below the category row in `renderReferenceView`.
- Filter logic: `catMatch && cityMatch && nameMatch` (three-way AND).
- New handler: `window.setReferenceCity = function(city) { referenceCityFilter = city; renderReferenceView(...); }`
- City filter row only shown if there are 2+ unique cities; hidden if all items are from one city.

---

## Fix 3: Garbled Characters (U+FFFD in JSON)

**Root Cause:** `getWithRedirect` in `fetch_data.js` accumulates HTTP response chunks as string:
```js
let body = '';
res.on('data', chunk => body += chunk); // splits multi-byte UTF-8 chars across chunks
```
When a 3-byte CJK character is split across Buffer chunk boundaries, the implicit `.toString()` produces U+FFFD replacement characters.

**Fix:** Collect raw Buffers, concat once at end:
```js
const chunks = [];
res.on('data', chunk => chunks.push(chunk));
res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
```

**Post-fix:** Re-run `node scripts/fetch_data.js` to regenerate clean JSON. Commit updated JSON files.

---

## Fix 4: Nav Pills — Add Day-of-Week from Data

**Design:**
- Nav pills in `index.html` keep their `data-target` and `onclick` attributes but start with minimal text (date only as fallback).
- In `initApp()`, call `updateNavDayLabels()` after `travelData` is loaded.
- `updateNavDayLabels()` loops over `travelData`, extracts `date` and `dayOfWeek`, updates each button's `textContent`:
  ```js
  // date "2026/03/05", dayOfWeek "Thu." → "3/5(Thu.)"
  const [, m, d] = day.date.split('/');
  btn.textContent = `${parseInt(m)}/${parseInt(d)}(${day.dayOfWeek})`;
  ```
- Falls back gracefully if `travelData` is empty or button not found.

---

## Files Changed

| File | Changes |
|------|---------|
| `js/app.js` | Fix 1 (search focus restore), Fix 2 (city filter state + render), Fix 4 (updateNavDayLabels) |
| `scripts/fetch_data.js` | Fix 3 (Buffer concat encoding) |
| `data/travel_data.json` | Regenerated after Fix 3 |
| `data/reference_data.json` | Regenerated after Fix 3 |
| `index.html` | No changes needed (nav labels set by JS) |
