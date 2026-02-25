# Budget / Reference / Itinerary UX Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 5 UX improvements across the budget, reference, and itinerary pages.

**Architecture:** All changes are in `js/app.js` only. No build step — this is a static HTML+JS app. Testing is manual: run `python -m http.server 8080` and verify in browser.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), Google Maps search URL (no API key needed)

**Design doc:** `docs/plans/2026-02-25-budget-reference-itinerary-ux-design.md`

---

## Task 1: Budget Card Scroll Anchors (Item 1)

**Files:**
- Modify: `js/app.js` lines 709, 714, 727, 756

**Step 1: Add `id` attributes to the two detail section wrappers**

Find line 727 (`<!-- Transport Detail Table -->`). Change:
```js
      <!-- Transport Detail Table -->
      <div>
```
To:
```js
      <!-- Transport Detail Table -->
      <div id="budget-transport-section">
```

Find line 756 (`<!-- Attraction Detail Table -->`). Change:
```js
      <!-- Attraction Detail Table -->
      <div>
```
To:
```js
      <!-- Attraction Detail Table -->
      <div id="budget-attraction-section">
```

**Step 2: Add `onclick` + hover styles to the 交通 card**

Find line 709. Change:
```js
        <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
```
To:
```js
        <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition-shadow" onclick="document.getElementById('budget-transport-section').scrollIntoView({behavior:'smooth'})">
```

**Step 3: Add `onclick` + hover styles to the 景點 card**

Find line 714. Change:
```js
        <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
```
To:
```js
        <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center cursor-pointer hover:shadow-md transition-shadow" onclick="document.getElementById('budget-attraction-section').scrollIntoView({behavior:'smooth'})">
```

**Step 4: Start local server and verify**

```bash
python -m http.server 8080
```

Open `http://localhost:8080/#budget` in browser.
- Click 🚆 交通 card → page scrolls smoothly to 交通費用明細 table
- Click 🏯 景點 card → page scrolls smoothly to 景點費用明細 table
- 🎯 合計 card should NOT scroll (intentional — no anchor)

**Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: add scroll anchors to budget summary cards"
```

---

## Task 2: Transport Table Alternating Day Row Colors (Item 2)

**Files:**
- Modify: `js/app.js` lines 679–692 (`renderTransportRows`)

**Step 1: Replace `renderTransportRows`**

Find and replace the entire `renderTransportRows` definition (lines 679–692):

Old:
```js
    const renderTransportRows = (items) => items.map(x => `
        <tr class="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
            onclick="location.hash='#day${x.dayIndex}'">
          <td class="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3">
            <div class="text-sm text-gray-700">${escHtml(x.event)}</div>
            ${x.transportType ? `<div class="text-xs text-gray-400 mt-0.5">🚌 ${escHtml(x.transportType)}</div>` : ''}
          </td>
          <td class="py-2 px-3 text-right">
            <div class="text-sm font-bold text-gray-800">${fmtJPY(x.cost)}</div>
            ${fmtTWD(x.cost) ? `<div class="text-xs text-gray-400">${fmtTWD(x.cost)}</div>` : ''}
          </td>
        </tr>
    `).join('');
```

New:
```js
    const renderTransportRows = (items) => {
        let dayBg = 'bg-white';
        let lastDate = null;
        return items.map(x => {
            if (x.date !== lastDate) {
                lastDate = x.date;
                dayBg = dayBg === 'bg-white' ? 'bg-gray-50' : 'bg-white';
            }
            return `
        <tr class="${dayBg} border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
            onclick="location.hash='#day${x.dayIndex}'">
          <td class="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3">
            <div class="text-sm text-gray-700">${escHtml(x.event)}</div>
            ${x.transportType ? `<div class="text-xs text-gray-400 mt-0.5">🚌 ${escHtml(x.transportType)}</div>` : ''}
          </td>
          <td class="py-2 px-3 text-right">
            <div class="text-sm font-bold text-gray-800">${fmtJPY(x.cost)}</div>
            ${fmtTWD(x.cost) ? `<div class="text-xs text-gray-400">${fmtTWD(x.cost)}</div>` : ''}
          </td>
        </tr>`;
        }).join('');
    };
```

**Step 2: Verify in browser**

Open `http://localhost:8080/#budget`.
- Transport table rows should alternate between white and light gray by date group
- Hover still shows blue highlight
- Clicking a row still navigates to the day

**Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: alternating day colors in transport detail table"
```

---

## Task 3: Attraction Table Enhancements (Item 3)

**Files:**
- Modify: `js/app.js`
  - `extractCosts()` line 75
  - `renderAttractionRows` lines 694–699
  - attraction table thead lines 763–767
  - attraction table tfoot lines 771–774

**Step 1: Add `city` to `extractCosts()` attraction push**

Find line 75:
```js
                    attraction.push({ date: day.date, event: item.event, cost: ac });
```
Change to:
```js
                    attraction.push({ date: day.date, event: item.event, cost: ac, city: item.city || '' });
```

**Step 2: Replace `renderAttractionRows` with city + NT$ + alternating colors**

Old (lines 694–699):
```js
    const renderAttractionRows = (items) => items.map(x => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 px-3 text-xs text-gray-500">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3 text-sm text-gray-700">${escHtml(x.event)}</td>
          <td class="py-2 px-3 text-sm font-bold text-right text-gray-800">${fmtJPY(x.cost)}</td>
        </tr>
    `).join('');
```

New:
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

**Step 3: Add 城市 column to attraction table `<thead>`**

Find lines 763–767:
```js
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
```
Change to:
```js
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">城市</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
```

**Step 4: Update attraction table `<tfoot>` — colspan 2→3, add NT$ to subtotal**

Find lines 771–774:
```js
                <td colspan="2" class="py-2 px-3 text-xs font-bold text-emerald-700">小計</td>
                <td class="py-2 px-3 text-sm font-bold text-right text-emerald-700">${fmtJPY(attractionTotal)}</td>
```
Change to:
```js
                <td colspan="3" class="py-2 px-3 text-xs font-bold text-emerald-700">小計</td>
                <td class="py-2 px-3 text-right">
                  <div class="text-sm font-bold text-emerald-700">${fmtJPY(attractionTotal)}</div>
                  ${fmtTWD(attractionTotal) ? `<div class="text-xs text-emerald-400">${fmtTWD(attractionTotal)}</div>` : ''}
                </td>
```

**Step 5: Verify in browser**

Open `http://localhost:8080/#budget`.
- Attraction table: 4 columns — 日期 | 城市 | 項目 | 金額
- City names visible (e.g., 廣島, 宮島)
- NT$ appears below JPY amount in smaller gray text
- Rows alternate white/gray by date
- Subtotal row: JPY + NT$ shown, colspan correct (no layout break)

**Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: enhance attraction table with city column, NT$ display, and alternating day colors"
```

---

## Task 4: Reference Card Divider Color by Category (Item 5)

**Files:**
- Modify: `js/app.js`
  - `getCategoryCardStyle()` lines 870–904
  - `renderReferenceView` line 961

**Step 1: Add `divider` to each case in `getCategoryCardStyle()`**

Find and update each `case` block to add a `divider` key:

```js
function getCategoryCardStyle(cat) {
    switch (cat) {
        case '交通': return {
            card:       'bg-sky-50 border-sky-100',
            badge:      'bg-indigo-100 text-indigo-700',
            cityBadge:  'bg-emerald-100 text-emerald-700 border-emerald-200',
            divider:    'border-sky-300'
        };
        case '餐廳': return {
            card:       'bg-orange-50 border-orange-100',
            badge:      'bg-violet-100 text-violet-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-orange-300'
        };
        case '景點': return {
            card:       'bg-emerald-50 border-emerald-100',
            badge:      'bg-indigo-100 text-indigo-700',
            cityBadge:  'bg-amber-100 text-amber-700 border-amber-200',
            divider:    'border-emerald-300'
        };
        case '住宿': return {
            card:       'bg-violet-50 border-violet-100',
            badge:      'bg-amber-100 text-amber-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-violet-300'
        };
        case '購物': return {
            card:       'bg-amber-50 border-amber-100',
            badge:      'bg-teal-100 text-teal-700',
            cityBadge:  'bg-indigo-100 text-indigo-700 border-indigo-200',
            divider:    'border-amber-300'
        };
        default:     return {
            card:       'bg-slate-50 border-slate-100',
            badge:      'bg-teal-100 text-teal-700',
            cityBadge:  'bg-sky-100 text-sky-700 border-sky-200',
            divider:    'border-slate-200'
        };
    }
}
```

**Step 2: Update divider line in `renderReferenceView`**

Find line 961:
```js
                <div class="flex gap-3 flex-wrap pt-1 border-t border-white/60">
```
Change to:
```js
                <div class="flex gap-3 flex-wrap pt-1 border-t ${style.divider}">
```

**Step 3: Verify in browser**

Open `http://localhost:8080/#reference`.
- 交通 cards: blue divider line above links row
- 餐廳 cards: orange divider line
- 景點 cards: green divider line
- 住宿 cards: purple divider line
- 購物 cards: amber divider line
- Line should be clearly visible (not white-on-white)

**Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: reference card divider color matches category theme"
```

---

## Task 5: Itinerary Transport Station Map Links (Item 8)

**Files:**
- Modify: `js/app.js` lines 457–458 (inside `renderTransportMethod`)

**Step 1: Update 起站 and 迄站 lines to include map link**

Find lines 457–458:
```js
                            ${m.start && m.start !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">起站</span><span>📍 ${escHtml(m.start)}</span></div>` : ''}
                            ${m.end && m.end !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">迄站</span><span>🏁 ${escHtml(m.end)}</span></div>` : ''}
```

Change to:
```js
                            ${m.start && m.start !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">起站</span><span>📍 ${escHtml(m.start)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.start)}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 ml-1">🗺️</a></span></div>` : ''}
                            ${m.end && m.end !== '-' ? `<div class="flex gap-2"><span class="text-gray-400 w-14 flex-shrink-0">迄站</span><span>🏁 ${escHtml(m.end)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.end)}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 ml-1">🗺️</a></span></div>` : ''}
```

**Security note:** `encodeURIComponent(m.start)` is safe — it's a JS expression producing URL-encoded text, not inserted into HTML via `escHtml`. The base URL `https://www.google.com/maps/search/?api=1&query=` is a static string. No injection risk.

**Step 2: Verify in browser**

Open `http://localhost:8080/#day1` (or any day with transport info).
- Expand a transport section by clicking the card
- 起站 row: station name + 🗺️ icon
- 迄站 row: station name + 🗺️ icon
- Click 🗺️ → opens Google Maps search for that station in a new tab
- Japanese station names (e.g., 広島駅) should encode correctly in the URL

**Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: add Google Maps links to transport start/end stations"
```

---

## Summary

| Task | Item | Lines affected |
|------|------|---------------|
| 1 | Budget scroll anchors | ~709, 714, 727, 756 |
| 2 | Transport alternating colors | ~679–692 |
| 3 | Attraction table enhancements | ~75, 694–699, 763–767, 771–774 |
| 4 | Reference divider colors | ~870–904, 961 |
| 5 | Station map links | ~457–458 |

All changes in `js/app.js`. No other files modified.
