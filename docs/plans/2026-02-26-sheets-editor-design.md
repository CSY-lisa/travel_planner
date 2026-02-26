# Google Sheets Editor — Design Document

**Date:** 2026-02-26
**Goal:** Enable CRUD operations on all 3 Google Sheets (Travel, Reference, Important Info) from both LINE Bot and Claude Code, with automatic sorting and formatting.

---

## Architecture: Dual-Track

```
LINE 傳訊息
  → GAS Web App
    ✅ Gemini 補全欄位（知識庫，不使用 Google Search）
    ✅ 寫入 Travel / Reference / Important Info
    ✅ 自動排序（日期→時間）
    ✅ 自動格式化（寫完立即執行 formatSheet）

Claude Code 對話
  → Python + gspread（Service Account JSON）
    ✅ 批次 CRUD（多筆一次處理）
    ✅ WebSearch 驗證資料 / 補全欄位
    ✅ 自動排序 + 格式化
    ✅ 支援整天行程更新
```

兩邊各自獨立，不互相依賴。

---

## Supported Operations

| 操作 | LINE Bot | Claude Code |
|------|----------|-------------|
| 新增一筆（AI 補全）| ✅ | ✅ |
| 修改指定欄位 | ✅ | ✅ |
| 刪除一筆 | ✅ | ✅ |
| 更新整天行程 | ❌ | ✅ |
| 批次新增多筆 | ❌ | ✅ |
| 上網驗證資料 | ❌（知識庫） | ✅（WebSearch）|

---

## Google Sheets: 3 Sheet Targets

| Sheet | 現有支援 | 新增 |
|-------|----------|------|
| Travel（行程）| LINE ✅ | Claude Code ✅ |
| Reference（補充資料）| LINE ✅ | Claude Code ✅ |
| Important Info（旅遊資訊）| ❌ | LINE ✅ + Claude Code ✅ |

---

## Formatting Spec

### Travel Sheet
| 部分 | 顏色 |
|------|------|
| 表頭（第 1 列）| 深藍底 `#1F4E79` + 白色粗體字 |
| 奇數日（3/5、3/7…）| 白底 `#FFFFFF` |
| 偶數日（3/6、3/8…）| 淺藍灰 `#E8F0FE` |

### Reference / Important Info Sheet
| 部分 | 顏色 |
|------|------|
| 表頭（第 1 列）| 深綠底 `#1E4620` + 白色粗體字 |
| 奇數類別組 | 白底 `#FFFFFF` |
| 偶數類別組 | 淺綠 `#E8F5E9` |

格式化在每次寫入/刪除/排序後自動觸發。

---

## Sorting Rules

- **Travel:** 日期（ascending）→ 時間（ascending, HH:mm）
- **Reference:** 類別（ascending）→ 名稱（ascending）
- **Important Info:** category（ascending）→ title（ascending）

---

## System A: GAS Changes (LINE Bot)

### New: formatSheet(sheet, type)
Called after every write/delete. Applies header + alternating row colors.

### New: sortSheet(sheet, type)
Called after every append. Sorts data rows (row 2 onward) by key columns.

### New: Important Info support
- New GAS property: `IMPORTANT_INFO_SHEET_GID`
- New `checkAndWrite` branch for `type === 'important'`
- New LINE command: `重要 <title> <content>`
- New LINE command: `刪除重要 <title>`
- New Gemini system prompt: `IMPORTANT_INFO_SYSTEM_PROMPT`

---

## System B: Python + gspread (Claude Code)

### File: scripts/sheets_editor.py

**Authentication:** Service Account JSON (path from `.env`)
**Library:** `gspread` + `google-auth`

**Functions:**
- `get_sheet(sheet_type)` — connect to correct sheet tab
- `add_row(sheet_type, fields)` — append + sort + format
- `update_row(sheet_type, key, fields)` — find row + update + format
- `delete_row(sheet_type, key)` — find row + delete + format
- `format_sheet(sheet_type)` — apply header + alternating colors
- `sort_sheet(sheet_type)` — sort data rows
- `replace_day(date, rows)` — delete all rows for a date, insert new ones (Travel only)

**Usage from Claude Code:**
Claude reads the request, optionally uses WebSearch to verify/fill data,
then calls the appropriate function via Python.

---

## Environment Variables (.env additions)

```
GOOGLE_SERVICE_ACCOUNT_JSON=path/to/service_account.json
IMPORTANT_INFO_SHEET_GID=<GID of the Important Info tab>
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `gas/SheetsService.gs` | Add `formatSheet()`, `sortSheet()`, Important Info support |
| `gas/Code.gs` | Add Important Info commands, call sort+format after every write |
| `gas/GeminiService.gs` | Add `IMPORTANT_INFO_SYSTEM_PROMPT` |
| `scripts/sheets_editor.py` | **New** — Python batch editor |
| `.env` | Add `GOOGLE_SERVICE_ACCOUNT_JSON`, `IMPORTANT_INFO_SHEET_GID` |
| `data/column_definition.json` | Add Important Info schema |
