# Design: UX Improvements & Exchange Rate Feature
Date: 2026-02-23

## Scope

Three features:
1. Fix Bopomofo (注音) IME search in reference page
2. Budget page transport cost improvements
3. New "匯率" tab with 7-day JPY/TWD chart

---

## Feature 1: Bopomofo IME Search Fix

**Root cause:** `oninput` fires mid-composition → `container.innerHTML` rebuilds DOM → IME state destroyed → phonetic symbols appear as literal text instead of composed Chinese.

**Solution:** Replace `oninput` with composition-aware event listeners attached after each render.

**Logic:**
```
compositionstart → isComposing = true  (suppress re-render)
compositionend   → isComposing = false, trigger search once
input            → only trigger if !isComposing
```

**Files:** `js/app.js` — `renderReferenceView()`, `setReferenceSearch()`

---

## Feature 2: Budget Page Transport Cost Improvements

### 2a. Shortest-Duration Grouping
- Merge `[primary, ...transportAlternatives]` for each transport item
- Sort by `parseDurMin()` (already exists in daily view)
- Use shortest option's `cost` + `transportType` for display

### 2b. New Data Fields in extractCosts()
```js
transport.push({
  date, event, cost,
  transportType,  // new
  dayIndex        // new — for navigation
})
```

### 2c. Dual-Currency Display
- Fetch `https://open.er-api.com/v6/latest/JPY` at page load
- Store `jpyToTwd = rates.TWD` (TWD per 1 JPY)
- Calculate: `NT$ = Math.round(cost * jpyToTwd)`
- Fallback: if fetch fails, `jpyToTwd = null` → hide NT$ column silently

### 2d. Table Layout
```
日期 | 項目                      | 金額
─────────────────────────────────────────
3/11 | 廣島→博多 新幹線           | ¥9,310
     | 🚄 新幹線 Nozomi           | NT$2,060
```
- Row is clickable: `onclick → location.hash = '#dayN'`
- Cursor pointer + hover highlight
- Summary cards also show NT$ totals

**Files:** `js/app.js` — `extractCosts()`, `renderBudgetView()`

---

## Feature 3: New 匯率 Tab

### Tab Bar Update
4 tabs: 行程 / 補充資料 / 費用 / **匯率**
- New hash: `#rate`
- Day nav hidden on `#rate`

### Page Layout
```
💴 日圓匯率

  1 JPY = NT$ 0.221          ← large text, current rate
  更新時間：2026-02-23

最高 0.225 · 最低 0.218 · 平均 0.221   ← stats first

📈 近 7 天趨勢
[Chart.js line chart]        ← chart below stats
```

### Data Architecture

**`data/exchange_rate_history.json`** (new file):
```json
[
  {"date": "2026-02-17", "rate": 0.219},
  {"date": "2026-02-23", "rate": 0.221}
]
```
- Max 7 entries, oldest dropped when new one added

**Current rate:** live fetch from `open.er-api.com` at page load
- Success → display live rate + timestamp
- Failure → use last entry from JSON as fallback

**Chart:** Chart.js via CDN (`<script>` in `index.html`)
- X-axis: dates, Y-axis: TWD rate
- Line + dots, no fill

### GitHub Actions Update
Add to `update_data.yml` nightly job:
1. Fetch current JPY→TWD from `open.er-api.com/v6/latest/JPY`
2. Read `data/exchange_rate_history.json` (or init empty array)
3. Append `{"date": today, "rate": rates.TWD}`
4. Keep only last 7 entries
5. Write back to file
6. Already included in `git add data/` step

**Files:**
- `index.html` — add Chart.js CDN, 4th tab button
- `js/app.js` — `renderRateView()`, routing, tab state
- `data/exchange_rate_history.json` — new data file
- `.github/workflows/update_data.yml` — append rate fetch step
- `scripts/fetch_data.js` — add `syncExchangeRate()` function
