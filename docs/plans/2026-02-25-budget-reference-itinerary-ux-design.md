# Budget / Reference / Itinerary UX Enhancements Design

**Date:** 2026-02-25
**Scope:** `js/app.js` only
**Source:** `docs/Todo List/01-下一次代辦事項.md` items 1, 2, 3, 5, 8

---

## Item 1: Budget Page — Summary Card Scroll Anchors

**Goal:** Clicking the 🚆 交通 or 🏯 景點 summary card scrolls to the corresponding detail table.

**Changes in `renderBudgetView`:**
- Add `id="budget-transport-section"` to the transport detail `<div>` wrapper
- Add `id="budget-attraction-section"` to the attraction detail `<div>` wrapper
- Add to 交通 card: `onclick="document.getElementById('budget-transport-section').scrollIntoView({behavior:'smooth'})"` + `cursor-pointer hover:shadow-md transition-shadow`
- Add to 景點 card: same onclick pointing to `budget-attraction-section`

---

## Item 2: Budget Page — Transport Table Alternating Day Row Colors

**Goal:** Rows grouped by date alternate between white and light-gray for readability.

**Changes in `renderTransportRows`:**

```js
const renderTransportRows = (items) => {
    let dayBg = 'bg-white';
    let lastDate = null;
    return items.map(x => {
        if (x.date !== lastDate) {
            lastDate = x.date;
            dayBg = dayBg === 'bg-white' ? 'bg-gray-50' : 'bg-white';
        }
        return `<tr class="${dayBg} border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors" ...>`;
    }).join('');
};
```

---

## Item 3: Budget Page — Attraction Table Enhancements

**Goal:** Add NT$ column, city column, and alternating day colors to the attraction detail table.

### 3a. `extractCosts()` — add `city` to attraction push

```js
attraction.push({ date: day.date, event: item.event, cost: ac, city: item.city || '' });
```

### 3b. `renderAttractionRows` — add city column, NT$, alternating colors

```js
const renderAttractionRows = (items) => {
    let dayBg = 'bg-white';
    let lastDate = null;
    return items.map(x => {
        if (x.date !== lastDate) {
            lastDate = x.date;
            dayBg = dayBg === 'bg-white' ? 'bg-gray-50' : 'bg-white';
        }
        return `
        <tr class="${dayBg} border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 px-3 text-xs text-gray-500">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3 text-xs text-gray-400">${escHtml(x.city || '-')}</td>
          <td class="py-2 px-3 text-sm text-gray-700">${escHtml(x.event)}</td>
          <td class="py-2 px-3 text-right">
            <div class="text-sm font-bold text-gray-800">${fmtJPY(x.cost)}</div>
            ${fmtTWD(x.cost) ? `<div class="text-xs text-gray-400">${fmtTWD(x.cost)}</div>` : ''}
          </td>
        </tr>`;
    }).join('');
};
```

### 3c. Attraction table header — add 城市 column

```html
<tr>
  <th ...>日期</th>
  <th ...>城市</th>
  <th ...>項目</th>
  <th ...>金額</th>
</tr>
```

### 3d. Attraction tfoot — adjust colspan from 2 to 3

```html
<td colspan="3" ...>小計</td>
```

---

## Item 5: Reference Page — Card Divider Color by Category

**Goal:** The horizontal rule above the links row matches the card's category color instead of white.

**Changes in `getCategoryCardStyle()`** — add `divider` field to each case:

| Category | `divider` value |
|----------|----------------|
| 交通 | `'border-sky-300'` |
| 餐廳 | `'border-orange-300'` |
| 景點 | `'border-emerald-300'` |
| 住宿 | `'border-violet-300'` |
| 購物 | `'border-amber-300'` |
| default | `'border-slate-200'` |

**Change in `renderReferenceView`** — links row divider line:

```js
// Before
<div class="flex gap-3 flex-wrap pt-1 border-t border-white/60">
// After
<div class="flex gap-3 flex-wrap pt-1 border-t ${style.divider}">
```

---

## Item 8: Itinerary Page — Transport Start/End Station Map Links

**Goal:** Add a map icon link after 起站 and 迄站 text; opens Google Maps search in a new tab. Free, no API key required.

**URL format:**
```
https://www.google.com/maps/search/?api=1&query=STATION_NAME
```

**Changes in `renderTransportMethod`** (lines ~457–458):

```js
// Before
${m.start && m.start !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">起站</span><span>📍 ${escHtml(m.start)}</span></div>` : ''}
${m.end && m.end !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">迄站</span><span>🏁 ${escHtml(m.end)}</span></div>` : ''}

// After
${m.start && m.start !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">起站</span><span>📍 ${escHtml(m.start)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.start)}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700">🗺️</a></span></div>` : ''}
${m.end && m.end !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">迄站</span><span>🏁 ${escHtml(m.end)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.end)}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700">🗺️</a></span></div>` : ''}
```

Note: `encodeURIComponent` is safe here — it's a JS expression, not interpolated into `escHtml()`. The href itself is a static base URL; only the query param is dynamic.

---

## Files Changed

| File | Changes |
|------|---------|
| `js/app.js` | All 5 items |

No changes to `index.html`, `scripts/fetch_data.js`, or data files.
