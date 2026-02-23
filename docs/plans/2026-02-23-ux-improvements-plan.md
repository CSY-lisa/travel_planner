# UX Improvements & Exchange Rate Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Bopomofo IME search, improve budget transport display with dual currency, and add a new 匯率 tab with 7-day JPY/TWD line chart.

**Architecture:** All changes are in the vanilla JS single-file app (`js/app.js`) and static `index.html`. No build step. Exchange rate history is stored as a repo-committed JSON file updated nightly by GitHub Actions. Chart.js loaded via CDN.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), Chart.js (CDN), open.er-api.com (free, no key), GitHub Actions

**Note:** This project has NO test runner. Verification is done by running `python -m http.server 8080` and checking in the browser.

---

### Task 1: Fix Bopomofo IME Search

**Files:**
- Modify: `js/app.js` — `renderReferenceView()` and `setReferenceSearch()`

**Step 1: Understand current broken behaviour**

Open browser at `http://localhost:8080/#reference`, type Chinese using Bopomofo (注音). Observe phonetic symbols appearing in input without composing to characters.

**Step 2: Replace `oninput` with composition-aware listeners**

In `renderReferenceView()`, find the `<input>` element (line ~819):

```html
<!-- BEFORE: remove this attribute from the input -->
oninput="setReferenceSearch(this.value)"
```

Remove `oninput` from the input tag so it becomes:
```html
<input type="text"
    id="ref-search-input"
    placeholder="搜尋名稱..."
    value="${escHtml(referenceSearchQuery)}"
    class="w-full border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white shadow-sm">
```

**Step 3: Attach event listeners after render in `setReferenceSearch`**

Replace the existing `setReferenceSearch` function (line ~845):

```javascript
window.setReferenceSearch = function (val) {
    referenceSearchQuery = val;
    const mainContent = document.getElementById('main-content');
    renderReferenceView(mainContent);
    attachRefSearchListeners();
};
```

Add a new `attachRefSearchListeners` function right after `renderReferenceView`:

```javascript
function attachRefSearchListeners() {
    const inp = document.getElementById('ref-search-input');
    if (!inp) return;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);

    let isComposing = false;
    inp.addEventListener('compositionstart', () => { isComposing = true; });
    inp.addEventListener('compositionend', (e) => {
        isComposing = false;
        window.setReferenceSearch(e.target.value);
    });
    inp.addEventListener('input', (e) => {
        if (!isComposing) window.setReferenceSearch(e.target.value);
    });
}
```

**Step 4: Call `attachRefSearchListeners` after initial render**

In `renderReferenceView()`, add a call at the very end, after `container.innerHTML = ...`:

```javascript
    container.innerHTML = `...`;  // existing last line

    // attach IME-aware listeners
    attachRefSearchListeners();
```

**Step 5: Verify in browser**

1. Run: `python -m http.server 8080`
2. Go to `http://localhost:8080/#reference`
3. Type in Chinese using Bopomofo — characters should now compose correctly
4. Type English letters — search should filter in real time

**Step 6: Commit**

```bash
git add js/app.js
git commit -m "fix: use compositionend to fix Bopomofo IME search in reference page"
```

---

### Task 2: Fetch Exchange Rate at Page Load

**Files:**
- Modify: `js/app.js` — top-level state + `fetchData()`

**Step 1: Add exchange rate state variable**

Near the top of `app.js` alongside other state variables (line ~7):

```javascript
let jpyToTwd = null; // TWD per 1 JPY, fetched live
```

**Step 2: Fetch rate in `fetchData()`**

In `fetchData()`, add a third parallel fetch alongside travel and reference data:

```javascript
async function fetchData() {
    try {
        const [travelRes, referenceRes, rateRes] = await Promise.allSettled([
            fetch('data/travel_data.json'),
            fetch('data/reference_data.json'),
            fetch('data/exchange_rate_history.json')
        ]);

        if (travelRes.status === 'fulfilled' && travelRes.value.ok) {
            travelData = await travelRes.value.json();
        } else {
            console.error('Failed to load travel data');
        }

        if (referenceRes.status === 'fulfilled' && referenceRes.value.ok) {
            referenceData = await referenceRes.value.json();
        } else {
            console.warn('reference_data.json not found – reference page will be empty');
        }

        if (rateRes.status === 'fulfilled' && rateRes.value.ok) {
            exchangeRateHistory = await rateRes.value.json();
        } else {
            console.warn('exchange_rate_history.json not found');
        }

        // Try live rate fetch (non-blocking)
        fetchLiveRate();

        initApp();
    } catch (error) {
        console.error('Error loading data:', error);
        document.body.innerHTML = '<div class="p-4 text-red-500">Failed to load itinerary data.</div>';
    }
}
```

**Step 3: Add `exchangeRateHistory` state and `fetchLiveRate` function**

Add near top with other state variables:
```javascript
let exchangeRateHistory = []; // [{date, rate}] from JSON
```

Add `fetchLiveRate` function near `fetchData`:
```javascript
async function fetchLiveRate() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/JPY');
        if (!res.ok) throw new Error('rate fetch failed');
        const data = await res.json();
        jpyToTwd = data.rates && data.rates.TWD ? data.rates.TWD : null;
    } catch (e) {
        console.warn('Live rate unavailable:', e.message);
        // fallback: use last entry from history
        if (exchangeRateHistory.length > 0) {
            jpyToTwd = exchangeRateHistory[exchangeRateHistory.length - 1].rate;
        }
    }
}
```

**Step 4: Verify in browser console**

1. Open browser console on `http://localhost:8080`
2. Type `jpyToTwd` — should show a number like `0.221`

**Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: fetch live JPY/TWD exchange rate at page load"
```

---

### Task 3: Update Budget Page — Transport Cost Improvements

**Files:**
- Modify: `js/app.js` — `extractCosts()`, `renderBudgetView()`

**Step 1: Add `parseDurMin` helper at module level**

This function already exists inline inside `renderDailyView`. Move it (or duplicate it) to module level so `extractCosts` can use it:

```javascript
// Add near parseCostJPY, around line 12
function parseDurMin(s) {
    if (!s || s === '-') return Infinity;
    let m = 0;
    const h = s.match(/(\d+)\s*小時/); if (h) m += parseInt(h[1]) * 60;
    const min = s.match(/(\d+)\s*分/); if (min) m += parseInt(min[1]);
    return m || Infinity;
}
```

**Step 2: Rewrite `extractCosts()`**

Replace the existing function (line ~37):

```javascript
function extractCosts() {
    const transport = [];
    const attraction = [];

    travelData.forEach((day, dayIdx) => {
        (day.periods || []).forEach(period => {
            (period.timeline || []).forEach(item => {
                // Transport: merge primary + alternatives, pick shortest duration
                const allOptions = [
                    { cost: item.cost, duration: item.duration, transportType: item.transportType },
                    ...(item.transportAlternatives || [])
                ];
                const validOptions = allOptions.filter(o => parseCostJPY(o.cost) > 0);
                if (validOptions.length > 0) {
                    const sorted = [...validOptions].sort((a, b) => parseDurMin(a.duration) - parseDurMin(b.duration));
                    const best = sorted[0];
                    transport.push({
                        date: day.date,
                        event: item.event,
                        cost: parseCostJPY(best.cost),
                        transportType: best.transportType || '',
                        dayIndex: dayIdx + 1
                    });
                }

                // Attraction costs (unchanged)
                const ac = parseCostJPY(item.attractionPrice);
                if (ac > 0) {
                    attraction.push({ date: day.date, event: item.event, cost: ac });
                }
            });
        });
    });

    return { transport, attraction };
}
```

**Step 3: Rewrite `renderBudgetView()`**

Replace the entire function (line ~618):

```javascript
function renderBudgetView(container) {
    const { transport, attraction } = extractCosts();

    const transportTotal = transport.reduce((sum, x) => sum + x.cost, 0);
    const attractionTotal = attraction.reduce((sum, x) => sum + x.cost, 0);
    const grandTotal = transportTotal + attractionTotal;

    const fmtJPY = (n) => '¥' + n.toLocaleString('ja-JP');
    const fmtTWD = (n) => jpyToTwd ? `NT$${Math.round(n * jpyToTwd).toLocaleString()}` : '';

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

    const renderAttractionRows = (items) => items.map(x => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="py-2 px-3 text-xs text-gray-500">${escHtml((x.date || '').slice(5))}</td>
          <td class="py-2 px-3 text-sm text-gray-700">${escHtml(x.event)}</td>
          <td class="py-2 px-3 text-sm font-bold text-right text-gray-800">${fmtJPY(x.cost)}</td>
        </tr>
    `).join('');

    container.innerHTML = `
    <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-6">
      <h2 class="text-xl font-bold text-gray-800">💰 費用總覽</h2>
      ${jpyToTwd ? `<div class="text-xs text-gray-400 text-right">匯率參考：1 JPY = NT$${jpyToTwd.toFixed(3)}</div>` : ''}

      <!-- Summary Cards -->
      <div class="grid grid-cols-3 gap-3">
        <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
          <div class="text-xs text-blue-500 font-bold mb-1">🚆 交通</div>
          <div class="text-lg font-bold text-blue-700">${fmtJPY(transportTotal)}</div>
          ${fmtTWD(transportTotal) ? `<div class="text-xs text-blue-400">${fmtTWD(transportTotal)}</div>` : ''}
        </div>
        <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
          <div class="text-xs text-emerald-500 font-bold mb-1">🏯 景點</div>
          <div class="text-lg font-bold text-emerald-700">${fmtJPY(attractionTotal)}</div>
          ${fmtTWD(attractionTotal) ? `<div class="text-xs text-emerald-400">${fmtTWD(attractionTotal)}</div>` : ''}
        </div>
        <div class="bg-teal-600 rounded-xl p-4 text-center shadow-md">
          <div class="text-xs text-teal-100 font-bold mb-1">🎯 合計</div>
          <div class="text-lg font-bold text-white">${fmtJPY(grandTotal)}</div>
          ${fmtTWD(grandTotal) ? `<div class="text-xs text-teal-200">${fmtTWD(grandTotal)}</div>` : ''}
        </div>
      </div>

      <!-- Transport Detail Table -->
      <div>
        <h3 class="text-sm font-bold text-gray-600 mb-2 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> 交通費用明細
          <span class="text-xs text-gray-400 font-normal">（點擊查看行程）</span>
        </h3>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
            </thead>
            <tbody>${renderTransportRows(transport)}</tbody>
            <tfoot class="bg-blue-50 border-t border-blue-100">
              <tr>
                <td colspan="2" class="py-2 px-3 text-xs font-bold text-blue-700">小計</td>
                <td class="py-2 px-3 text-right">
                  <div class="text-sm font-bold text-blue-700">${fmtJPY(transportTotal)}</div>
                  ${fmtTWD(transportTotal) ? `<div class="text-xs text-blue-400">${fmtTWD(transportTotal)}</div>` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Attraction Detail Table -->
      <div>
        <h3 class="text-sm font-bold text-gray-600 mb-2 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> 景點費用明細
        </h3>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table class="w-full">
            <thead class="bg-gray-50 border-b border-gray-100">
              <tr>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">日期</th>
                <th class="py-2 px-3 text-left text-xs text-gray-400 font-bold">項目</th>
                <th class="py-2 px-3 text-right text-xs text-gray-400 font-bold">金額</th>
              </tr>
            </thead>
            <tbody>${renderAttractionRows(attraction)}</tbody>
            <tfoot class="bg-emerald-50 border-t border-emerald-100">
              <tr>
                <td colspan="2" class="py-2 px-3 text-xs font-bold text-emerald-700">小計</td>
                <td class="py-2 px-3 text-sm font-bold text-right text-emerald-700">${fmtJPY(attractionTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  `;
}
```

**Step 4: Verify in browser**

1. Go to `http://localhost:8080/#budget`
2. Check: transport rows show 交通類型 in small grey text
3. Check: if exchange rate loaded, NT$ shown alongside ¥
4. Click a transport row → should navigate to corresponding day
5. Check: 廣島→博多 新幹線 shows the shortest-duration option's cost

**Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: improve budget transport display with type, TWD rate, and day navigation"
```

---

### Task 4: Add 匯率 Tab to index.html

**Files:**
- Modify: `index.html` — tab bar, Chart.js CDN

**Step 1: Read index.html to find the tab bar**

Look for the 3 existing tab buttons (行程/補充資料/費用).

**Step 2: Add Chart.js CDN**

Before the closing `</body>` tag, add:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

**Step 3: Add 4th tab button**

After the existing 費用 tab button, add:

```html
<button id="tab-rate" class="tab-btn flex-1 py-3 text-sm font-medium text-gray-400" onclick="location.hash='#rate'">
    💴 匯率
</button>
```

**Step 4: Verify tabs render correctly in browser**

Check all 4 tabs visible and tappable on mobile width.

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add 匯率 tab to bottom tab bar with Chart.js CDN"
```

---

### Task 5: Add 匯率 Page Routing & Render

**Files:**
- Modify: `js/app.js` — `handleRouting()`, `updateTabState()`, `renderRateView()` (new)

**Step 1: Update `handleRouting()` to handle `#rate`**

In `handleRouting()`, add after the `#budget` branch:

```javascript
} else if (hash === '#rate') {
    renderRateView(mainContent);
    updateTabState('rate');
}
```

Also add `#rate` to the day-nav hiding condition:

```javascript
if (hash === '#reference' || hash === '#budget' || hash === '#rate') {
    dayNav.style.display = 'none';
```

**Step 2: Add `renderRateView()` function**

Add after `renderBudgetView()`:

```javascript
function renderRateView(container) {
    const history = exchangeRateHistory.slice(-7); // last 7 entries
    const currentRate = jpyToTwd;
    const rates = history.map(h => h.rate);
    const maxRate = rates.length ? Math.max(...rates).toFixed(4) : '-';
    const minRate = rates.length ? Math.min(...rates).toFixed(4) : '-';
    const avgRate = rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(4) : '-';
    const lastUpdated = history.length ? history[history.length - 1].date : '---';

    container.innerHTML = `
        <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-6">
            <h2 class="text-xl font-bold text-gray-800">💴 日圓匯率</h2>

            <!-- Current Rate -->
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-center">
                ${currentRate
                    ? `<div class="text-4xl font-bold text-teal-700 mb-1">NT$ ${currentRate.toFixed(3)}</div>
                       <div class="text-sm text-gray-400">每 1 JPY · 更新：${lastUpdated}</div>`
                    : `<div class="text-2xl font-bold text-gray-400 mb-1">載入中...</div>
                       <div class="text-sm text-gray-400">正在取得最新匯率</div>`
                }
            </div>

            <!-- Stats -->
            ${rates.length ? `
            <div class="grid grid-cols-3 gap-3 text-center">
                <div class="bg-red-50 border border-red-100 rounded-xl p-3">
                    <div class="text-xs text-red-400 font-bold mb-1">📈 最高</div>
                    <div class="text-lg font-bold text-red-600">${maxRate}</div>
                </div>
                <div class="bg-blue-50 border border-blue-100 rounded-xl p-3">
                    <div class="text-xs text-blue-400 font-bold mb-1">📉 最低</div>
                    <div class="text-lg font-bold text-blue-600">${minRate}</div>
                </div>
                <div class="bg-gray-50 border border-gray-100 rounded-xl p-3">
                    <div class="text-xs text-gray-400 font-bold mb-1">➖ 平均</div>
                    <div class="text-lg font-bold text-gray-600">${avgRate}</div>
                </div>
            </div>` : ''}

            <!-- Chart -->
            ${rates.length >= 2 ? `
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div class="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-teal-400 inline-block"></span> 近 ${rates.length} 天趨勢
                </div>
                <canvas id="rate-chart" height="200"></canvas>
            </div>` : `
            <div class="text-center text-gray-400 py-8 text-sm">累積 2 天以上資料後顯示趨勢圖</div>`}
        </div>
    `;

    // Render chart after DOM update
    if (rates.length >= 2) {
        const ctx = document.getElementById('rate-chart');
        if (ctx && window.Chart) {
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: history.map(h => h.date.slice(5)), // MM-DD
                    datasets: [{
                        data: rates,
                        borderColor: '#0d9488',
                        backgroundColor: 'rgba(13, 148, 136, 0.08)',
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#0d9488',
                        tension: 0.3,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            ticks: { callback: v => 'NT$' + v.toFixed(3) },
                            grid: { color: '#f3f4f6' }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
}
```

**Step 3: Verify routing works**

1. Click 匯率 tab → should show rate page
2. Check hash changes to `#rate`
3. Day nav pills should be hidden

**Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: add 匯率 tab page with current rate and 7-day chart"
```

---

### Task 6: Create Initial exchange_rate_history.json

**Files:**
- Create: `data/exchange_rate_history.json`

**Step 1: Create the file with today's rate**

```json
[
  {"date": "2026-02-23", "rate": 0.221}
]
```

Note: Use the actual current rate from `open.er-api.com/v6/latest/JPY` → `rates.TWD` when creating this file.

**Step 2: Verify chart renders with 1 entry**

Go to `#rate` — should show current rate + stats, but no chart (needs ≥ 2 entries).

**Step 3: Commit**

```bash
git add data/exchange_rate_history.json
git commit -m "feat: add initial exchange rate history data file"
```

---

### Task 7: Update GitHub Actions to Append Daily Rate

**Files:**
- Modify: `scripts/fetch_data.js` — add `syncExchangeRate()`
- Modify: `.github/workflows/update_data.yml` — include `exchange_rate_history.json` in git add

**Step 1: Add `syncExchangeRate()` to fetch_data.js**

Add before `runSync()`:

```javascript
async function syncExchangeRate() {
    try {
        console.log('Fetching JPY/TWD exchange rate...');
        const data = await new Promise((resolve, reject) => {
            https.get('https://open.er-api.com/v6/latest/JPY', (res) => {
                if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
            }).on('error', reject);
        });

        const rate = data.rates && data.rates.TWD;
        if (!rate) throw new Error('TWD rate not found in response');

        const historyPath = path.join(__dirname, '../data/exchange_rate_history.json');
        let history = [];
        if (fs.existsSync(historyPath)) {
            history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        }

        const today = new Date().toISOString().split('T')[0];
        // Update existing entry for today or append new
        const todayIdx = history.findIndex(h => h.date === today);
        if (todayIdx >= 0) {
            history[todayIdx].rate = parseFloat(rate.toFixed(4));
        } else {
            history.push({ date: today, rate: parseFloat(rate.toFixed(4)) });
        }

        // Keep only last 7 entries
        if (history.length > 7) history = history.slice(-7);

        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
        console.log(`RATE: 1 JPY = ${rate.toFixed(4)} TWD saved.`);
    } catch (err) {
        console.error('Exchange rate sync failed:', err.message);
        // non-fatal: don't exit(1), just skip
    }
}
```

**Step 2: Call `syncExchangeRate()` in `runSync()`**

Add at the end of `runSync()`:

```javascript
async function runSync() {
    // ... existing code ...
    await syncReferenceData();
    await syncExchangeRate(); // add this line
}
```

**Step 3: Update workflow to commit the new file**

In `.github/workflows/update_data.yml`, update git add line:

```yaml
git add --force data/travel_data.json data/reference_data.json data/exchange_rate_history.json
```

**Step 4: Test locally**

```bash
node scripts/fetch_data.js
cat data/exchange_rate_history.json
```

Expected output: updated JSON with today's rate entry.

**Step 5: Commit**

```bash
git add scripts/fetch_data.js .github/workflows/update_data.yml
git commit -m "feat: add daily exchange rate sync to GitHub Actions pipeline"
```

---

### Task 8: Final Verification & Push

**Step 1: Full browser walkthrough**

1. `python -m http.server 8080`
2. **補充資料頁** → type Chinese with Bopomofo → characters compose correctly ✓
3. **費用頁** → transport rows show type + NT$ → click row → navigates to day ✓
4. **匯率頁** → shows current rate, stats, chart (after ≥ 2 days data) ✓
5. Check mobile layout (narrow browser window) ✓

**Step 2: Push all commits**

```bash
git push
```

**Step 3: Trigger GitHub Actions manually**

Go to `https://github.com/CSY-lisa/travel_planner/actions/workflows/update_data.yml` → Run workflow

Verify `exchange_rate_history.json` gets a new commit.
