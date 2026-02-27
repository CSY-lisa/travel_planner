# fetch_data.js 技術說明文件

> **檔案路徑**：`scripts/fetch_data.js`
> **用途**：從 Google Sheets 抓取旅遊行程資料，轉換並輸出為 JSON 檔案
> **執行方式**：`node scripts/fetch_data.js`

---

## 目錄

1. [整體流程](#整體流程)
2. [環境設定](#環境設定)
3. [常數定義](#常數定義)
4. [主流程 runSync()](#主流程-runsync)
5. [HTTP 請求 getWithRedirect()](#http-請求-getwithredirect)
6. [TSV 解析 parseTSV()](#tsv-解析-parsetsv)
7. [行程資料轉換 processData()](#行程資料轉換-processdata)
   - [Pass 1：逐列讀取](#pass-1逐列讀取)
   - [Pass 2：群組ID 合併](#pass-2群組id-合併)
   - [Pass 3：建立巢狀結構](#pass-3建立巢狀結構)
8. [補充資料同步 syncReferenceData()](#補充資料同步-syncreferencedata)
9. [補充資料轉換 processReferenceData()](#補充資料轉換-processreferencedata)
10. [地圖 URL 轉換 getMapUrl()](#地圖-url-轉換-getmapurl)
11. [TSV 欄位對應 JSON Key 總表](#tsv-欄位對應-json-key-總表)
12. [群組ID 完整說明](#群組id-完整說明)

---

## 整體流程

```
runSync()
  ├─ 從 SHEET_URL 抓取 TSV
  │     └─ getWithRedirect()     處理 Google 302 重導向
  │           └─ handleData()
  │                 ├─ parseTSV()       TSV 文字 → 二維陣列
  │                 ├─ processData()    二維陣列 → 結構化 JSON（3 passes）
  │                 └─ writeFileSync()  寫入 data/travel_data.json
  │
  └─ syncReferenceData()
        ├─ 從 REFERENCE_SHEET_URL 抓取 TSV
        ├─ parseTSV()
        ├─ processReferenceData()  → 單層陣列 JSON
        └─ writeFileSync()         寫入 data/reference_data.json
```

---

## 環境設定

**讀取 `.env` 檔案（第 4 行）**

使用標準套件 `dotenv`：

```javascript
require('dotenv').config({ path: path.join(__dirname, '../.env') });
```

**啟動驗證（第 6–13 行）**

`SHEET_URL` 為必填，缺少時立即終止並顯示明確錯誤，不靜默失敗：

```javascript
const REQUIRED_ENV = ['SHEET_URL'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set them in your .env file.');
    process.exit(1);
}
```

**`.env` 格式：**

```
SHEET_URL=https://docs.google.com/spreadsheets/d/{ID}/export?format=tsv&gid={GID}
REFERENCE_SHEET_URL=https://docs.google.com/spreadsheets/d/{ID}/export?format=tsv&gid={GID}
```

| 變數 | 必填 | 說明 |
|------|------|------|
| `SHEET_URL` | ✅ | 行程分頁 export URL，缺少會 `process.exit(1)` |
| `REFERENCE_SHEET_URL` | 選填 | 補充資料分頁 export URL，缺少只跳過不報錯 |

> **重要**：URL 必須使用 `/export?format=tsv` 格式，而非 `/edit` 頁面 URL。
> `/edit` URL 回傳 HTML，無法解析；`/export?format=tsv` 直接回傳純文字 TSV。
>
> **安全**：真實 URL 只存在 `.env`（本地）或 GitHub Secrets（CI），不得出現在程式碼中。

---

## 常數定義

| 常數 | 值 | 說明 |
|------|----|------|
| `SHEET_URL` | `process.env.SHEET_URL` | 行程 Google Sheets export URL |
| `OUTPUT_PATH` | `data/travel_data.json` | 行程資料輸出路徑 |
| `REFERENCE_SHEET_URL` | `process.env.REFERENCE_SHEET_URL` | 補充資料 Google Sheets export URL |
| `REFERENCE_OUTPUT_PATH` | `data/reference_data.json` | 補充資料輸出路徑 |

---

## 主流程 `runSync()`

```javascript
async function runSync() {
    if (SHEET_URL) {
        const rawData = await getWithRedirect(SHEET_URL);
        handleData(rawData);
    } else {
        console.warn('No SHEET_URL found.');
    }
    await syncReferenceData();
}
```

1. 用 `SHEET_URL` 發 HTTPS 請求
2. 取得 TSV 文字後交給 `handleData()` 解析並寫檔
3. 完成後呼叫 `syncReferenceData()` 處理補充資料

**`handleData()` 串接函式：**

```javascript
function handleData(rawData) {
    const rows = parseTSV(rawData);
    const jsonData = processData(rows);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jsonData, null, 2));
}
```

**預期 console output：**

```
--- Travel Planner Sync (Robust TSV) ---
Fetching from Sheet...
PROCESSED: 9 days.
SUCCESS: Remote sync complete.
Fetching reference data from Sheet...
REFERENCE: 12 items saved.
```

---

## HTTP 請求 `getWithRedirect()`

Google Sheets export URL 會先回 302 重導向，再跳到真正的下載 URL。此函式透過遞迴處理任意層數的重導向：

```javascript
function getWithRedirect(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(getWithRedirect(res.headers.location)); // 遞迴追蹤新 URL
                return;
            }
            if (res.statusCode !== 200) {
                res.resume(); // 釋放 response body，避免記憶體 leak
                reject(new Error(`HTTP Status ${res.statusCode}`));
                return;
            }
            let body = '';
            res.on('data', chunk => body += chunk); // 分批接收資料
            res.on('end', () => resolve(body));      // 完整後 resolve
        }).on('error', reject);
    });
}
```

**HTTP 狀態碼對應行為：**

| 狀態碼 | 行為 |
|--------|------|
| 301 / 302 | 遞迴重新請求 `Location` header 的新 URL |
| 200 | 讀取完整 body 並 resolve |
| 其他 | reject，拋出錯誤訊息 |

---

## TSV 解析 `parseTSV()`

不使用 `split('\t')` 的原因：Google Sheets 儲存格內容可能包含換行和 Tab，這類儲存格會用雙引號包覆，簡單 split 會切錯位置。

採用**字元狀態機**逐字解析：

```
狀態：inQuote = false（預設）

遇到 "      → inQuote = true（進入引號區段）
遇到 \t      → 欄位結束，push 到 row
遇到 \n      → 列結束，push row 到 rows
遇到 \r      → 忽略（Windows CRLF 相容）

inQuote = true 時：
遇到 ""     → 代表一個真正的 " 字元（TSV 逃脫規則）
遇到 "      → inQuote = false（離開引號區段）
遇到其他字元 → 直接累加（含 \n, \t 都視為資料）
```

**特殊處理：**
- 開頭移除 BOM（`\uFEFF`）：Windows Excel 存 UTF-8 時常自動加入，會導致第一欄標題解析錯誤

**輸入範例：**
```
日期	活動標題
2026/03/05	"台北起飛
（需早到機場）"
```

**輸出：**
```javascript
[
  ["日期", "活動標題"],
  ["2026/03/05", "台北起飛\n（需早到機場）"]  // 多行文字完整保留
]
```

---

## 行程資料轉換 `processData()`

輸入：`parseTSV()` 產生的二維陣列
輸出：3 層巢狀 JSON（天 → 時段 → 時間軸）

### Pass 1：逐列讀取

建立欄位名稱 → index 的映射表，安全取值：

```javascript
const idx = {};
headers.forEach((h, i) => idx[h] = i);

const get = (row, col) => {
    const val = row[idx[col]];
    return (val === undefined || val === null) ? '' : val;
};
```

每列 TSV 對應一個 `allItems` 物件，包含所有欄位。
跳過條件：`日期` 欄位為空，或值為 `'日期'`（誤把 header 當資料）。

---

### Pass 2：群組ID 合併

**目的**：同一事件的多種交通方案合併為一個 item，避免在時間軸上產生重複節點。

```javascript
const groupSeen = {}; // { "H001": 1 }  → groupId 對應 mergedItems 的 index

allItems.forEach(item => {
    if (item.groupId && groupSeen[item.groupId] !== undefined) {
        // 這個 groupId 之前見過 → 是替代方案列
        const existing = mergedItems[groupSeen[item.groupId]];
        if (!existing.transportAlternatives) existing.transportAlternatives = [];
        existing.transportAlternatives.push({
            transportType, transportPayment, start, end,
            transportFreq, duration, cost, link
            // 只保留交通欄位，其他欄位在替代列中為空
        });
    } else {
        // 新 groupId 或無 groupId → 記錄位置並推入
        if (item.groupId) groupSeen[item.groupId] = mergedItems.length;
        mergedItems.push(item);
    }
});
```

**執行範例：**

| 迭代 | item | groupSeen | mergedItems |
|------|------|-----------|-------------|
| [0] | groupId="" event="抵達廣島" | `{}` | `[抵達廣島]` |
| [1] | groupId="H1" event="前往宮島" (主要) | `{H1: 1}` | `[抵達廣島, 前往宮島]` |
| [2] | groupId="H1" event="" (替代) | `{H1: 1}` | `[抵達廣島, 前往宮島{alternatives:[巴士]}]` |
| [3] | groupId="H1" event="" (替代2) | `{H1: 1}` | `[抵達廣島, 前往宮島{alternatives:[巴士, 計程車]}]` |

---

### Pass 3：建立巢狀結構

```javascript
mergedItems.forEach(item => {
    // 遇到新日期 → 建立新的「天」物件
    if (item.date !== currentDate) {
        currentDayObj = { date, dayOfWeek, periods: [] };
        travelData.push(currentDayObj);
    }

    // 時段不存在 → 建立（早上 / 下午 / 晚上）
    let period = currentDayObj.periods.find(p => p.period === item.period);
    if (!period) {
        period = { period: item.period, timeRange: '', timeline: [] };
        currentDayObj.periods.push(period);
    }

    // 解構移除分類用欄位，其餘推入 timeline
    const { date, dayOfWeek, period: _p, groupId, ...rest } = item;
    period.timeline.push(rest);
});
```

**最終 JSON 結構：**

```json
[
  {
    "date": "2026/03/05",
    "dayOfWeek": "Thu.",
    "periods": [
      {
        "period": "早上",
        "timeRange": "",
        "timeline": [
          {
            "time": "07:00",
            "type": "交通",
            "event": "台北起飛",
            "transportAlternatives": []
          }
        ]
      }
    ]
  }
]
```

---

## 補充資料同步 `syncReferenceData()`

與 `runSync()` 結構對稱，差別只在資料來源與處理函式：

```javascript
async function syncReferenceData() {
    if (REFERENCE_SHEET_URL) {
        const rawData = await getWithRedirect(REFERENCE_SHEET_URL);
        // parseTSV → processReferenceData → writeFileSync
    } else {
        console.warn('No REFERENCE_SHEET_URL found. Skipping.');
    }
}
```

---

## 補充資料轉換 `processReferenceData()`

單層轉換，無群組ID邏輯：

```javascript
return data
    .filter(row => get(row, '名稱') !== '')  // 過濾空白列
    .map(row => ({
        category: get(row, '類別'),
        name:     get(row, '名稱'),
        website:  get(row, '官網連結'),
        mapUrl:   getMapUrl(get(row, '地點/導航')),
        description: get(row, '簡介'),
        notes:    get(row, '備註')
    }));
```

**輸出格式：**

```json
[
  {
    "category": "交通",
    "name": "ICOCA Card",
    "website": "https://...",
    "mapUrl": "https://maps.google.com/maps?q=...&output=embed",
    "description": "可在全日本使用的交通IC卡",
    "notes": "可在便利商店購買"
  }
]
```

---

## 地圖 URL 轉換 `getMapUrl()`

```javascript
function getMapUrl(location) {
    if (!location || location.trim() === '-' || location.trim() === '') return null;
    return `https://maps.google.com/maps?q=${location.trim()}&output=embed`;
}
```

| 輸入 | 輸出 |
|------|------|
| `"廣島城"` | `"https://maps.google.com/maps?q=廣島城&output=embed"` |
| `"-"` | `null` |
| `""` | `null` |

回傳 `null` 時，前端不渲染地圖按鈕。
回傳 URL 時，可直接用於 `<iframe src="...">` 嵌入 Google Maps。

---

## TSV 欄位對應 JSON Key 總表

| Google Sheet 欄位名 | JSON Key | 層級 | 說明 |
|---------------------|----------|------|------|
| `日期` | `date` | day 層 | 用於分組，不進 timeline |
| `星期` | `dayOfWeek` | day 層 | Thu. / Fri. ... |
| `時段` | `period` | period 層 | 早上 / 下午 / 晚上 |
| `群組ID` | _(捨棄)_ | — | 合併後不保留 |
| `時間` | `time` | timeline | HH:mm |
| `類型` | `type` | timeline | 交通 / 景點 / 用餐... |
| `城市` | `city` | timeline | 廣島 |
| `活動標題` | `event` | timeline | 台北起飛 |
| `內容詳情` | `description` | timeline | 詳細說明 |
| `交通工具` | `transportType` | timeline | 飛機 (CI112) |
| `交通支付方式` | `transportPayment` | timeline | 信用卡 |
| `地點/導航` | `mapUrl` | timeline | 轉為 embed URL |
| `相關連結(時刻表)` | `link` | timeline | 官方時刻表 URL |
| `起始站` | `start` | timeline | 台北 |
| `終點站` | `end` | timeline | 廣島 |
| `班次頻率/時刻資訊` | `transportFreq` | timeline | 每 15 分一班 |
| `移動時間` | `duration` | timeline | 45分 |
| `交通費用(JPY)` | `cost` | timeline | ¥1,400 |
| `景點官網` | `attractionWebsite` | timeline | URL |
| `景點票價 (JPY)` | `attractionPrice` | timeline | ¥500 |
| `營業時間/狀態` | `attractionHours` | timeline | 09:00–17:00 |
| `景點簡介` | `attractionIntro` | timeline | 3 點式清單 |
| `景點建議停留時間` | `attractionDuration` | timeline | 1.5 hr |
| `景點特殊狀況` | `specialNotes` | timeline | 維修中... |

---

## 群組ID 完整說明

### 規則

- **不填群組ID** → 獨立 item，直接進時間軸
- **填群組ID** → 相同 ID 的列合併為一個 item
  - **第一列**：主要方案，完整填寫所有欄位
  - **第二列起**：替代方案，**只填交通相關欄位**，其他欄位留空

### Google Sheet 填寫範例

| 群組ID | 時間 | 活動標題 | 交通工具 | 費用 | 其他欄位 |
|--------|------|----------|----------|------|----------|
| `H001` | 13:00 | 前往宮島 | JR + 渡輪 | ¥680 | 正常填寫 |
| `H001` | | | 高速巴士 | ¥1,500 | **留空** |
| `H001` | | | 計程車 | ¥5,000 | **留空** |

### 合併後 JSON

```json
{
  "time": "13:00",
  "event": "前往宮島",
  "transportType": "JR + 渡輪",
  "cost": "¥680",
  "transportAlternatives": [
    { "transportType": "高速巴士", "cost": "¥1,500", "start": "...", "end": "..." },
    { "transportType": "計程車",   "cost": "¥5,000", "start": "...", "end": "..." }
  ]
}
```

### 前端顯示效果

```
[ 方法 1 ] JR + 渡輪   ¥680
[ 方法 2 ] 高速巴士    ¥1,500
[ 方法 3 ] 計程車      ¥5,000
```

替代方案數量無上限，每新增一列同 groupId 即增加一個方法。
