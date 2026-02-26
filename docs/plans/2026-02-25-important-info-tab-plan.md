# 重要旅遊資訊 Tab 實作計劃

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在底部 Tab Bar 新增第 5 個「旅遊資訊」Tab，從 Google Sheets 讀取緊急聯絡、入境手續、交通資訊、健康注意等資料，提供搜尋與分類篩選功能。

**Architecture:** 仿照現有 reference_data 流程：Google Sheets TSV → `fetch_data.js` → `important_info.json` → `app.js renderImportantView()`。路由使用 hash `#important`，Tab Bar 新增第 5 個按鈕。

**Tech Stack:** Vanilla JS, Tailwind CSS, Google Sheets TSV export, Node.js (fetch_data.js)

---

## Task 1：建立 `data/important_info.json` 種子檔案

本 Task 建立靜態 seed 資料，讓前端開發可以不依賴 Google Sheets 直接測試。

**Files:**
- Create: `data/important_info.json`

**Step 1: 建立種子檔案**

建立 `data/important_info.json`，內容如下：

```json
[
  { "category": "緊急聯絡", "title": "台灣大使館（公益財團法人交流協會）", "content": "+81-3-3280-7811（東京）/ +81-6-6443-8481（大阪）", "link": "" },
  { "category": "緊急聯絡", "title": "日本緊急電話", "content": "警察：110　救護/消防：119", "link": "" },
  { "category": "入境手續", "title": "VJW（Visit Japan Web）", "content": "入境審查、海關申報線上辦理，出發前 6 小時完成", "link": "https://vjw.digital.go.jp" },
  { "category": "入境手續", "title": "海關申報", "content": "攜帶現金超過 100 萬日圓或等值外幣需申報", "link": "" },
  { "category": "交通資訊", "title": "ICOCA 卡購買", "content": "可於廣島站、宮島口等 JR 售票機購買，押金 500 円", "link": "" },
  { "category": "交通資訊", "title": "廣島電鐵一日券", "content": "成人 700 円，可無限次搭乘市區路面電車", "link": "" },
  { "category": "健康注意", "title": "花粉症（芬花季）", "content": "3 月為杉木花粉高峰，建議攜帶抗組織胺藥物與口罩", "link": "" },
  { "category": "健康注意", "title": "就醫資訊", "content": "廣島市立廣島市民醫院（可接待外國患者）+81-82-221-2291", "link": "" }
]
```

**Step 2: 確認檔案正確**

開啟 `data/important_info.json` 確認內容無誤（8 筆資料，4 個分類各 2 筆）。

**Step 3: Commit**

```bash
git add data/important_info.json
git commit -m "feat: add important_info.json seed data"
```

---

## Task 2：`app.js` — 新增全域變數 + 資料載入

**Files:**
- Modify: `js/app.js`（開頭全域變數區 + `fetchData()` 函式）

**Step 1: 在 app.js 開頭新增三個全域變數**

找到這段（約第 9-12 行）：
```js
let referenceActiveCategory = '全部';
let referenceSearchQuery = '';
let referenceCityFilter = '全部';
```

在其後方新增：
```js
let importantData = [];
let importantActiveCategory = '全部';
let importantSearchQuery = '';
```

**Step 2: 修改 `fetchData()` 新增第四個 fetch**

找到現有的 `fetchData()` 中的 `Promise.allSettled` 區塊（約第 101-104 行）：
```js
const [travelRes, referenceRes, rateRes] = await Promise.allSettled([
    fetch('data/travel_data.json'),
    fetch('data/reference_data.json'),
    fetch('data/exchange_rate_history.json')
]);
```

改為：
```js
const [travelRes, referenceRes, rateRes, importantRes] = await Promise.allSettled([
    fetch('data/travel_data.json'),
    fetch('data/reference_data.json'),
    fetch('data/exchange_rate_history.json'),
    fetch('data/important_info.json')
]);
```

**Step 3: 在 `fetchData()` 新增 importantRes 處理**

找到 rateRes 處理區塊結尾（約第 123 行），在其後新增：
```js
if (importantRes.status === 'fulfilled' && importantRes.value.ok) {
    importantData = await importantRes.value.json();
} else {
    console.warn('important_info.json not found – important page will be empty');
}
```

**Step 4: 開啟瀏覽器確認 console 無報錯**

```bash
python -m http.server 8080
```

開啟 `http://localhost:8080`，按 F12 確認 console 出現：
- 無紅色錯誤
- 無 "important_info.json not found" 警告

**Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: load important_info.json in fetchData"
```

---

## Task 3：`app.js` — 新增 `getImportantCardStyle()`

**Files:**
- Modify: `js/app.js`（在 `getCategoryCardStyle` 函式附近新增）

**Step 1: 新增色彩樣式函式**

在 `getCategoryCardStyle(cat)` 函式結尾後方新增：

```js
function getImportantCardStyle(cat) {
    switch (cat) {
        case '緊急聯絡': return {
            card:  'bg-red-50 border-red-100',
            badge: 'bg-red-100 text-red-700',
            chip:  'bg-red-600 text-white shadow-md',
            divider: 'border-red-200'
        };
        case '入境手續': return {
            card:  'bg-blue-50 border-blue-100',
            badge: 'bg-blue-100 text-blue-700',
            chip:  'bg-blue-600 text-white shadow-md',
            divider: 'border-blue-200'
        };
        case '交通資訊': return {
            card:  'bg-green-50 border-green-100',
            badge: 'bg-green-100 text-green-700',
            chip:  'bg-green-600 text-white shadow-md',
            divider: 'border-green-200'
        };
        case '健康注意': return {
            card:  'bg-orange-50 border-orange-100',
            badge: 'bg-orange-100 text-orange-700',
            chip:  'bg-orange-500 text-white shadow-md',
            divider: 'border-orange-200'
        };
        default: return {
            card:  'bg-gray-50 border-gray-200',
            badge: 'bg-gray-100 text-gray-700',
            chip:  'bg-gray-500 text-white shadow-md',
            divider: 'border-gray-200'
        };
    }
}
```

**Step 2: Commit**

```bash
git add js/app.js
git commit -m "feat: add getImportantCardStyle helper"
```

---

## Task 4：`app.js` — 新增 `renderImportantView()`

**Files:**
- Modify: `js/app.js`（在 `renderReferenceView()` 函式後方新增）

**Step 1: 新增 `renderImportantView(container)`**

在 `renderReferenceView()` 函式結尾後方（找到 `window.setReferenceCity` 區塊後方）新增：

```js
function renderImportantView(container) {
    const categories = ['全部', ...new Set(importantData.map(x => x.category).filter(Boolean))];

    const q = importantSearchQuery.toLowerCase().trim();
    const filtered = importantData.filter(x => {
        const catMatch = importantActiveCategory === '全部' || x.category === importantActiveCategory;
        const titleMatch = !q || (x.title || '').toLowerCase().includes(q);
        const contentMatch = !q || (x.content || '').toLowerCase().includes(q);
        return catMatch && (titleMatch || contentMatch);
    });

    const catChips = categories.map(cat => {
        const style = getImportantCardStyle(cat);
        const isActive = cat === importantActiveCategory;
        return `
            <button onclick="setImportantCategory('${escHtml(cat)}')"
                class="flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-bold transition-all ${isActive
                ? style.chip
                : 'bg-white text-gray-600 border border-gray-300'
            }">
                ${escHtml(cat)}
            </button>
        `;
    }).join('');

    const cards = filtered.length === 0
        ? '<div class="text-center text-gray-400 py-12">找不到符合的資料 🔍</div>'
        : filtered.map(item => {
            const style = getImportantCardStyle(item.category);
            const hasLink = item.link && /^https?:\/\//i.test(item.link);
            return `
            <div class="${style.card} rounded-xl shadow-sm border p-4 space-y-2 hover:shadow-md transition-shadow">
                <div class="flex items-start justify-between gap-2">
                    <h3 class="font-bold text-gray-800 text-base leading-tight">${escHtml(item.title)}</h3>
                    <span class="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${style.badge}">${escHtml(item.category)}</span>
                </div>
                <p class="text-sm text-gray-600 leading-relaxed">${escHtml(item.content)}</p>
                ${hasLink ? `
                <div class="pt-1 border-t ${style.divider}">
                    <a href="${escHtml(item.link)}" target="_blank" rel="noopener noreferrer"
                        class="text-xs font-bold text-blue-600 hover:underline">🔗 前往連結</a>
                </div>` : ''}
            </div>
        `;
        }).join('');

    container.innerHTML = `
        <div class="animate-fade-in max-w-md md:max-w-2xl mx-auto px-4 pt-6 pb-12 space-y-5">
            <h2 class="text-xl font-bold text-gray-800">🆘 重要旅遊資訊</h2>

            <!-- Search + Category Filters -->
            <div class="space-y-2">
                <input type="text"
                    id="important-search-input"
                    placeholder="搜尋標題、內容..."
                    value="${escHtml(importantSearchQuery)}"
                    oninput="setImportantSearch(this.value)"
                    class="w-full border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white shadow-sm">

                <div class="flex gap-2 flex-wrap">
                    ${catChips}
                </div>
            </div>

            <!-- Cards -->
            <div class="space-y-3">
                ${cards}
            </div>
        </div>
    `;

    attachImportantSearchListeners();
}

function attachImportantSearchListeners() {
    const inp = document.getElementById('important-search-input');
    if (!inp) return;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
}

window.setImportantCategory = function (cat) {
    importantActiveCategory = cat;
    const mainContent = document.getElementById('main-content');
    renderImportantView(mainContent);
};

window.setImportantSearch = function (val) {
    importantSearchQuery = val;
    const mainContent = document.getElementById('main-content');
    renderImportantView(mainContent);
};
```

**Step 2: Commit**

```bash
git add js/app.js
git commit -m "feat: add renderImportantView with search and category filter"
```

---

## Task 5：`app.js` — 修改路由 `handleRouting()`

**Files:**
- Modify: `js/app.js`（`handleRouting()` 函式）

**Step 1: 擴展 Day Nav 隱藏條件**

找到（約第 157 行）：
```js
if (hash === '#reference' || hash === '#budget' || hash === '#rate') {
```

改為：
```js
if (hash === '#reference' || hash === '#budget' || hash === '#rate' || hash === '#important') {
```

**Step 2: 新增 `#important` 路由分支**

找到（約第 180-183 行）：
```js
} else if (hash === '#rate') {
    renderRateView(mainContent);
    updateTabState('rate');
}
```

在結尾 `}` 前新增：
```js
} else if (hash === '#important') {
    renderImportantView(mainContent);
    updateTabState('important');
}
```

**Step 3: 手動測試路由**

在瀏覽器網址列輸入 `http://localhost:8080/#important`，確認：
- 頁面顯示「🆘 重要旅遊資訊」標題
- 顯示 8 筆種子資料卡片
- 日期導覽列已隱藏

**Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: add #important route to handleRouting"
```

---

## Task 6：`index.html` — Tab Bar 新增第 5 個 Tab

**Files:**
- Modify: `index.html`（底部 Tab Bar 區塊 + `switchTab()` 函式）

**Step 1: Tab Bar 新增按鈕**

找到（約第 169 行，`</nav>` 前最後一個 tab-btn）：
```html
<button onclick="switchTab('rate')" id="tab-rate"
  class="tab-btn flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-gray-400 font-medium">
  <span class="text-xl">💴</span>
  <span class="text-[10px]">匯率</span>
</button>
```

在其後新增：
```html
<button onclick="switchTab('important')" id="tab-important"
  class="tab-btn flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-gray-400 font-medium">
  <span class="text-xl">🆘</span>
  <span class="text-[10px]">旅遊資訊</span>
</button>
```

**Step 2: 修改 `switchTab()` 函式**

找到（約第 178 行）：
```js
function switchTab(tab) {
    if (tab === 'itinerary') window.location.hash = '#overview';
    else window.location.hash = '#' + tab;
}
```

改為：
```js
function switchTab(tab) {
    if (tab === 'itinerary') window.location.hash = '#overview';
    else if (tab === 'important') window.location.hash = '#important';
    else window.location.hash = '#' + tab;
}
```

**Step 3: 手動測試 Tab 切換**

1. 點擊底部「🆘 旅遊資訊」Tab → 頁面切換至重要資訊頁
2. 點擊「🗓️ 行程」Tab → 切回行程頁，日期導覽列重新出現
3. 確認旅遊資訊 Tab 在 active 時文字顯示 teal 色

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add 重要旅遊資訊 tab to bottom tab bar"
```

---

## Task 7：手動功能測試（搜尋 + 分類篩選）

**Files:** 無需修改，純測試

**Step 1: 測試分類篩選**

點擊「緊急聯絡」chip → 只顯示 2 筆緊急聯絡卡片
點擊「全部」→ 回復顯示全部 8 筆

**Step 2: 測試搜尋**

搜尋框輸入「大使館」→ 只顯示台灣大使館那筆
搜尋框輸入「花粉」→ 只顯示健康注意那筆
清空搜尋框 → 回復全部顯示

**Step 3: 測試分類 + 搜尋組合**

點擊「入境手續」chip，再搜尋「VJW」→ 只顯示 VJW 那筆
點擊「緊急聯絡」chip，搜尋「VJW」→ 顯示「找不到符合的資料 🔍」

**Step 4: 測試連結**

點擊 VJW 卡片的「🔗 前往連結」→ 新分頁開啟 vjw.digital.go.jp

---

## Task 8：`scripts/fetch_data.js` — 新增 `syncImportantInfoData()`

**Files:**
- Modify: `scripts/fetch_data.js`

> 注意：此 Task 需要先在 `.env` 設定 `IMPORTANT_INFO_SHEET_URL`，否則僅 skip（不報錯）。

**Step 1: 新增環境變數常數**

找到（約第 17-18 行）：
```js
const REFERENCE_SHEET_URL = process.env.REFERENCE_SHEET_URL;
const REFERENCE_OUTPUT_PATH = path.join(__dirname, '../data/reference_data.json');
```

在其後新增：
```js
const IMPORTANT_INFO_SHEET_URL = process.env.IMPORTANT_INFO_SHEET_URL;
const IMPORTANT_INFO_OUTPUT_PATH = path.join(__dirname, '../data/important_info.json');
```

**Step 2: 新增 `processImportantInfoData()` 函式**

在 `processReferenceData()` 函式後方新增：

```js
function processImportantInfoData(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0];
    const data = rows.slice(1);
    const idx = {};
    headers.forEach((h, i) => idx[h] = i);
    const get = (row, col) => {
        const val = row[idx[col]];
        return (val === undefined || val === null) ? '' : val.trim();
    };

    return data
        .filter(row => get(row, 'title') !== '')
        .map(row => ({
            category: get(row, 'category'),
            title: get(row, 'title'),
            content: get(row, 'content'),
            link: get(row, 'link')
        }));
}
```

**Step 3: 新增 `syncImportantInfoData()` 函式**

在 `syncReferenceData()` 函式後方新增：

```js
async function syncImportantInfoData() {
    try {
        if (!IMPORTANT_INFO_SHEET_URL) {
            console.warn('No IMPORTANT_INFO_SHEET_URL found. Skipping.');
            return;
        }
        console.log('Fetching important info data from Sheet...');
        const rawData = await getWithRedirect(IMPORTANT_INFO_SHEET_URL);
        const rows = parseTSV(rawData);
        const jsonData = processImportantInfoData(rows);
        fs.writeFileSync(IMPORTANT_INFO_OUTPUT_PATH, JSON.stringify(jsonData, null, 2));
        console.log(`IMPORTANT INFO: ${jsonData.length} items saved.`);
    } catch (err) {
        console.error('Important info sync failed:', err.message);
    }
}
```

**Step 4: 在 `runSync()` 呼叫新函式**

找到（約第 119-120 行）：
```js
await syncReferenceData();
await syncExchangeRate();
```

改為：
```js
await syncReferenceData();
await syncImportantInfoData();
await syncExchangeRate();
```

**Step 5: 測試（無 Sheet URL 時應正常跳過）**

```bash
node scripts/fetch_data.js
```

確認輸出包含：
```
No IMPORTANT_INFO_SHEET_URL found. Skipping.
```
且程式正常結束（exit 0），現有 JSON 檔案不受影響。

**Step 6: Commit**

```bash
git add scripts/fetch_data.js
git commit -m "feat: add syncImportantInfoData to fetch_data.js"
```

---

## Task 9：`.github/workflows/update_data.yml` — 更新 CI

**Files:**
- Modify: `.github/workflows/update_data.yml`

**Step 1: 新增 `IMPORTANT_INFO_SHEET_URL` 環境變數**

找到：
```yaml
    - name: Run Fetch Script
      env:
        SHEET_URL: ${{ secrets.SHEET_URL }}
        REFERENCE_SHEET_URL: ${{ secrets.REFERENCE_SHEET_URL }}
```

改為：
```yaml
    - name: Run Fetch Script
      env:
        SHEET_URL: ${{ secrets.SHEET_URL }}
        REFERENCE_SHEET_URL: ${{ secrets.REFERENCE_SHEET_URL }}
        IMPORTANT_INFO_SHEET_URL: ${{ secrets.IMPORTANT_INFO_SHEET_URL }}
```

**Step 2: 新增 `important_info.json` 到 git add**

找到：
```yaml
git add --force data/travel_data.json data/reference_data.json data/exchange_rate_history.json
```

改為：
```yaml
git add --force data/travel_data.json data/reference_data.json data/exchange_rate_history.json data/important_info.json
```

**Step 3: Commit**

```bash
git add .github/workflows/update_data.yml
git commit -m "ci: add IMPORTANT_INFO_SHEET_URL to GitHub Actions workflow"
```

**Step 4: 在 GitHub Repo Settings 新增 Secret**

前往 GitHub repo → Settings → Secrets and variables → Actions → New repository secret：
- Name: `IMPORTANT_INFO_SHEET_URL`
- Value: Google Sheets TSV export URL（格式同 `REFERENCE_SHEET_URL`）

> 注意：Google Sheets TSV export URL 格式為：
> `https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=tsv&gid=<PAGE_GID>`

---

## 完成檢查清單

- [ ] `data/important_info.json` 存在，包含 8 筆種子資料
- [ ] 底部 Tab Bar 顯示 5 個 Tab，最右側為「🆘 旅遊資訊」
- [ ] 點擊「旅遊資訊」Tab 切換至重要資訊頁面
- [ ] 頁面顯示搜尋框 + 分類 chips + 卡片列表
- [ ] 搜尋框可同時比對 title 和 content
- [ ] 分類篩選正常運作
- [ ] VJW 等有連結的卡片顯示「🔗 前往連結」按鈕
- [ ] 切換回其他 Tab 時日期導覽列正常顯示/隱藏
- [ ] `fetch_data.js` 無 Sheet URL 時正常 skip（不 crash）
- [ ] GitHub Actions workflow 已更新（含新 secret 名稱）
