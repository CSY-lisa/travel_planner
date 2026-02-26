# 設計文件：新增「重要旅遊資訊」Tab

建立日期：2026-02-25
狀態：已確認，待實作

---

## 需求摘要

在現有底部 Tab Bar（4 個 Tab）新增第 5 個 Tab「重要旅遊資訊」，提供旅途中常用的緊急聯絡、入境手續、交通技巧、健康注意等資訊，資料由 Google Sheets 維護。

---

## 1. 資料層

### Google Sheets 新頁簽

名稱建議：`重要旅遊資訊`
欄位結構：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `category` | string | 分類（緊急聯絡 / 入境手續 / 交通資訊 / 健康注意） |
| `title` | string | 項目名稱 |
| `content` | string | 說明文字 |
| `link` | string | 外部連結 URL（選填） |

範例資料：

| category | title | content | link |
|----------|-------|---------|------|
| 緊急聯絡 | 台灣大使館 | +81-3-3280-7811 | |
| 入境手續 | VJW | 再入境必填，出發前完成申請 | https://vjw.digital.go.jp |

### 環境變數（.env）

新增：
```
IMPORTANT_INFO_SHEET_URL=<Google Sheets TSV export URL>
```

### 輸出檔案

`data/important_info.json`，結構：
```json
[
  { "category": "緊急聯絡", "title": "台灣大使館", "content": "+81-3-3280-7811", "link": "" },
  { "category": "入境手續", "title": "VJW", "content": "再入境必填", "link": "https://vjw.digital.go.jp" }
]
```

### fetch_data.js 修改

- 新增 `IMPORTANT_INFO_SHEET_URL` 讀取邏輯（仿 `REFERENCE_SHEET_URL`）
- 輸出 `data/important_info.json`

---

## 2. 前端渲染（app.js）

### 新增全域變數

```js
let importantData = [];
let importantActiveCategory = '全部';
let importantSearchQuery = '';
```

### 新增函式

- `renderImportantView(container)` — 主渲染函式
- `window.setImportantCategory(cat)` — 切換分類
- `window.setImportantSearch(val)` — 更新搜尋關鍵字

### 版面結構

```
┌─────────────────────────────┐
│  🆘 重要旅遊資訊              │  ← 頁面標題
│  ┌──────────────────────┐   │
│  │ 🔍 搜尋標題、內容...  │   │  ← 圓角搜尋框（同補充資料）
│  └──────────────────────┘   │
│  [全部] [緊急聯絡] [入境手續] │  ← 分類 chips（動態從資料產生）
│  [交通資訊] [健康注意]        │
├─────────────────────────────┤
│  卡片列表（分類標籤 + title + content + 連結按鈕） │
└─────────────────────────────┘
```

### 搜尋邏輯

同時比對 `title` 和 `content` 欄位（不區分大小寫）

### 分類色系

| 分類 | 主色 |
|------|------|
| 緊急聯絡 | 紅色（red） |
| 入境手續 | 藍色（blue） |
| 交通資訊 | 綠色（green） |
| 健康注意 | 橙色（orange） |

---

## 3. 路由與 Tab Bar（index.html + app.js）

### Hash

`#important`

### handleRouting() 修改

新增分支：
```js
} else if (hash === '#important') {
    renderImportantView(mainContent);
    updateTabState('important');
}
```

Day nav（日期導覽列）隱藏條件新增 `#important`：
```js
if (hash === '#reference' || hash === '#budget' || hash === '#rate' || hash === '#important') {
    dayNav.style.display = 'none';
}
```

### Tab Bar 新增第 5 個按鈕

```html
<button onclick="switchTab('important')" id="tab-important"
  class="tab-btn flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-gray-400 font-medium">
  <span class="text-xl">🆘</span>
  <span class="text-[10px]">旅遊資訊</span>
</button>
```

### switchTab() 修改

新增：
```js
else if (tab === 'important') window.location.hash = '#important';
```

---

## 4. 資料載入（fetchData）

`fetchData()` 新增載入 `important_info.json` 並賦值給 `importantData`。

---

## 實作範圍

| 檔案 | 修改內容 |
|------|---------|
| `scripts/fetch_data.js` | 新增第 3 個 Sheet 抓取 + 輸出 `important_info.json` |
| `data/important_info.json` | 新建輸出檔案 |
| `js/app.js` | 新增全域變數、`renderImportantView()`、路由分支、資料載入 |
| `index.html` | Tab Bar 新增第 5 個按鈕 |
| `.env` | 新增 `IMPORTANT_INFO_SHEET_URL` |
| `.github/workflows/update_data.yml` | 確認 GitHub Actions 自動更新涵蓋新 JSON |
