# Google Sheets Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add auto-sort + auto-format to GAS LINE Bot, add Important Info sheet support, and build a Python batch editor for Claude Code.

**Architecture:** Dual-track — GAS handles LINE Bot writes (format+sort in SheetsService.gs), Python + gspread handles Claude Code batch operations. Both write directly to Google Sheets. Format: header dark colored, data rows alternate by date/category group.

**Tech Stack:** Google Apps Script (GAS), Python 3, gspread, google-api-python-client, python-dotenv

**Design doc:** `docs/plans/2026-02-26-sheets-editor-design.md`

---

## Task 1: GAS — Add `formatSheet()` + `sortSheet()` to SheetsService.gs

**Files:**
- Modify: `gas/SheetsService.gs`

**Step 1: Add `formatSheet(sheet, type)` after the `getSheetByGid` function (end of file)**

Find the end of `SheetsService.gs` (after `getSheetByGid`) and append:

```javascript
// ── 格式化整張 Sheet（表頭顏色 + 依日期/類別交替底色）────────────
function formatSheet(sheet, type) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol === 0) return;

  // 表頭（第 1 列）
  const headerBg = (type === 'travel') ? '#1F4E79' : '#1E4620';
  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange.setBackground(headerBg);
  headerRange.setFontColor('#FFFFFF');
  headerRange.setFontWeight('bold');

  if (lastRow < 2) return;

  // 資料列交替底色（依日期 / 類別 分組）
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const groupColName = (type === 'travel') ? '日期'
    : (type === 'important') ? 'category'
    : '類別';
  const groupColIdx = headers.indexOf(groupColName);

  const dataValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const lightColor = (type === 'travel') ? '#E8F0FE' : '#E8F5E9';

  let groupIdx = -1;
  let lastGroupVal = null;
  const colors = [];

  for (let i = 0; i < dataValues.length; i++) {
    const groupVal = groupColIdx >= 0
      ? formatCellValue(dataValues[i][groupColIdx])
      : String(i); // fallback: alternate every row
    if (groupVal && groupVal !== lastGroupVal) {
      lastGroupVal = groupVal;
      groupIdx++;
    }
    const bg = (groupIdx % 2 === 0) ? '#FFFFFF' : lightColor;
    colors.push(Array(lastCol).fill(bg));
  }

  sheet.getRange(2, 1, dataValues.length, lastCol).setBackgrounds(colors);
}
```

**Step 2: Add `sortSheet(sheet, type)` after `formatSheet`**

```javascript
// ── 依關鍵欄位排序資料列（不含表頭）─────────────────────────────
function sortSheet(sheet, type) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol === 0) return; // header + 至少 2 筆才需排序

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);

  if (type === 'travel') {
    const dateCol = headers.indexOf('日期') + 1;
    const timeCol = headers.indexOf('時間') + 1;
    if (dateCol > 0 && timeCol > 0) {
      dataRange.sort([
        { column: dateCol, ascending: true },
        { column: timeCol, ascending: true }
      ]);
    }
  } else if (type === 'reference') {
    const catCol = headers.indexOf('類別') + 1;
    const nameCol = headers.indexOf('名稱') + 1;
    if (catCol > 0 && nameCol > 0) {
      dataRange.sort([
        { column: catCol, ascending: true },
        { column: nameCol, ascending: true }
      ]);
    }
  } else if (type === 'important') {
    const catCol = headers.indexOf('category') + 1;
    const titleCol = headers.indexOf('title') + 1;
    if (catCol > 0 && titleCol > 0) {
      dataRange.sort([
        { column: catCol, ascending: true },
        { column: titleCol, ascending: true }
      ]);
    }
  }
}
```

**Step 3: Commit**

```bash
git add gas/SheetsService.gs
git commit -m "feat(gas): add formatSheet and sortSheet to SheetsService"
```

---

## Task 2: GAS — Integrate sort+format into every write/delete

**Files:**
- Modify: `gas/SheetsService.gs`

**Step 1: In `checkAndWrite` — call sort+format after appendRow**

Find the travel branch:
```javascript
appendByHeaders(sheet, data.fields);
return { action: 'appended' };
```
Change to:
```javascript
appendByHeaders(sheet, data.fields);
sortSheet(sheet, data.type);
formatSheet(sheet, data.type);
return { action: 'appended' };
```

Find the reference branch (the `else` branch):
```javascript
appendByHeaders(sheet, data.fields);
return { action: 'appended' };
```
Change to:
```javascript
appendByHeaders(sheet, data.fields);
sortSheet(sheet, data.type);
formatSheet(sheet, data.type);
return { action: 'appended' };
```

**Step 2: In `overwriteRow` — call formatSheet after updateByHeaders**

Find:
```javascript
updateByHeaders(sheet, rowIndex, data.fields);
```
Change to:
```javascript
updateByHeaders(sheet, rowIndex, data.fields);
formatSheet(sheet, data.type);
```

**Step 3: In Code.gs — call formatSheet after deleteRow**

Find the delete confirmation block (both travel and reference delete paths). After each `deleteRow(sheet, delData.rowIndex)` call, add:
```javascript
formatSheet(sheet, delData.type);
```

There are two delete confirmation paths in `_handleMessage`. Find:
```javascript
deleteRow(sheet, delData.rowIndex);
cache.remove(pendingDelKey);
sendLineReply(replyToken, `✅ 已刪除：${delData.desc}`, props);
```
Change to:
```javascript
deleteRow(sheet, delData.rowIndex);
formatSheet(sheet, delData.type);
cache.remove(pendingDelKey);
sendLineReply(replyToken, `✅ 已刪除：${delData.desc}`, props);
```

**Step 4: Test via GAS console**

Open GAS editor → Run `testWriteReference` → Open Google Sheets → Verify:
- Header row: dark green background, white bold text
- Data rows: alternating white / light green by category

**Step 5: Commit**

```bash
git add gas/SheetsService.gs gas/Code.gs
git commit -m "feat(gas): call sort+format after every write and delete"
```

---

## Task 3: GAS — Important Info sheet support (SheetsService.gs)

**Files:**
- Modify: `gas/SheetsService.gs`

**Step 1: Add Important Info branch to `checkAndWrite`**

Find the `else {` block that handles reference data:
```javascript
  } else {
    // reference data
    const sheet = getSheetByGid(ss, props.getProperty('REFERENCE_SHEET_GID'));
```

Before this `else`, insert a new branch:
```javascript
  } else if (data.type === 'important') {
    const sheet = getSheetByGid(ss, props.getProperty('IMPORTANT_INFO_SHEET_GID'));
    const title = (data.fields['title'] || '').trim();
    if (title) {
      const existing = findRowByKey(sheet, { 'title': title });
      if (existing) {
        return {
          action: 'duplicate',
          rowIndex: existing.rowIndex,
          existingDesc: `title「${title}」`
        };
      }
    }
    appendByHeaders(sheet, data.fields);
    sortSheet(sheet, 'important');
    formatSheet(sheet, 'important');
    return { action: 'appended' };
```

**Step 2: Update `overwriteRow` to support 'important' type**

Find:
```javascript
  const gid = data.type === 'travel'
    ? props.getProperty('TRAVEL_SHEET_GID')
    : props.getProperty('REFERENCE_SHEET_GID');
```
Change to:
```javascript
  const gid = data.type === 'travel'
    ? props.getProperty('TRAVEL_SHEET_GID')
    : data.type === 'important'
      ? props.getProperty('IMPORTANT_INFO_SHEET_GID')
      : props.getProperty('REFERENCE_SHEET_GID');
```

**Step 3: Commit**

```bash
git add gas/SheetsService.gs
git commit -m "feat(gas): add Important Info sheet support to SheetsService"
```

---

## Task 4: GAS — Important Info LINE commands + Gemini prompt

**Files:**
- Modify: `gas/GeminiService.gs`
- Modify: `gas/Code.gs`

**Step 1: Add `IMPORTANT_INFO_SYSTEM_PROMPT` to GeminiService.gs**

Find `const REFERENCE_SYSTEM_PROMPT = ...` and after its closing backtick, add:

```javascript
const IMPORTANT_INFO_SYSTEM_PROMPT = `你是廣島旅行資訊助理。使用者會給你一筆重要旅遊資訊（標題 + 其他提示），請根據你的知識補全所有欄位，以 JSON 格式回傳。

欄位規格：
- category：緊急聯絡 / 入境手續 / 交通資訊 / 健康注意
- title：使用者提供的標題，繁體中文
- content：詳細說明，包含電話、地址、步驟等實用資訊（150字以內）
- link：官方URL，找不到填""

只回傳 JSON 物件，key 為欄位名，不要加任何說明文字。`;
```

**Step 2: Update `callGemini` to handle 'important' mode**

Find:
```javascript
  const systemPrompt = mode === 'travel' ? TRAVEL_SYSTEM_PROMPT : REFERENCE_SYSTEM_PROMPT;
```
Change to:
```javascript
  const systemPrompt = mode === 'travel' ? TRAVEL_SYSTEM_PROMPT
    : mode === 'important' ? IMPORTANT_INFO_SYSTEM_PROMPT
    : REFERENCE_SYSTEM_PROMPT;
```

**Step 3: Add `重要` and `刪除重要` commands to Code.gs**

In `_handleMessage`, find the block:
```javascript
  if (text.startsWith('補充 ')) {
```

After the entire `if (text.startsWith('補充 ')) { ... }` block, add:

```javascript
  if (text.startsWith('重要 ')) {
    const input = text.slice(3).trim();
    sendLoadingIndicator(userId, props);
    const fields = callGemini(input, 'important', props);
    const data = { type: 'important', fields };
    cache.put(pendingKey, JSON.stringify(data), 600);
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  if (text.startsWith('刪除重要 ')) {
    const title = text.slice(5).trim();
    const sheetId = props.getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = getSheetByGid(ss, props.getProperty('IMPORTANT_INFO_SHEET_GID'));
    const found = findRowByKey(sheet, { 'title': title });
    if (!found) {
      sendLineReply(replyToken, `查無重要資訊「${title}」，請確認標題。`, props);
      return;
    }
    cache.put(pendingDelKey, JSON.stringify({
      type: 'important',
      rowIndex: found.rowIndex,
      desc: title
    }), 600);
    sendLineReply(replyToken,
      `⚠️ 確定要刪除重要資訊「${title}」嗎？\n確認刪除 請回覆「確認」\n取消 請回覆「取消」`,
      props);
    return;
  }
```

**Step 4: Update help text at the bottom of `_handleMessage`**

Find the `sendLineReply` with the help text:
```javascript
  sendLineReply(replyToken,
    '請用以下格式輸入：\n\n🗓 新增行程：\n行程 ...\n\n📝 新增補充資料：\n補充 ...\n\n🗑 刪除行程：\n刪除行程 03/07 14:00\n刪除補充 裕示堂\n\n💡 等待確認時可用「取消」取消操作',
    props);
```
Change to:
```javascript
  sendLineReply(replyToken,
    '請用以下格式輸入：\n\n🗓 新增行程：\n行程 2026/03/07 下午 廣島 嚴島神社\n\n📝 新增補充資料：\n補充 裕示堂 廣島市威士忌酒吧\n\n🆘 新增重要資訊：\n重要 VJW 日本入境申報\n\n🗑 刪除：\n刪除行程 03/07 14:00\n刪除補充 裕示堂\n刪除重要 VJW\n\n💡 等待確認時可用「取消」取消操作',
    props);
```

**Step 5: Add `IMPORTANT_INFO_SHEET_GID` to GAS Script Properties**

In GAS editor: Project Settings → Script Properties → Add:
- Key: `IMPORTANT_INFO_SHEET_GID`
- Value: GID of the Important Info tab (find in Sheets URL: `#gid=XXXXXX`)

**Step 6: Deploy updated GAS Web App**

In GAS editor: Deploy → Manage deployments → New deployment → Web App → Execute as Me → Anyone → Deploy. Copy new URL if changed.

**Step 7: Test via LINE**

Send: `重要 VJW 日本入境申報`
Expected: Bot replies with confirmation card showing category/title/content/link.
Reply: `確認` → Check Google Sheets Important Info tab: new row added, sorted, formatted.

**Step 8: Commit**

```bash
git add gas/GeminiService.gs gas/Code.gs
git commit -m "feat(gas): add Important Info LINE commands and Gemini prompt"
```

---

## Task 5: Python — Environment setup

**Files:**
- Modify: `.env`

**Step 1: Install Python dependencies**

```bash
cd "/Users/lisa/Library/CloudStorage/GoogleDrive-chycl06@gmail.com/我的雲端硬碟/AI_project/csk/travel_planner"
pip install gspread google-auth google-api-python-client python-dotenv
```

Expected: packages install successfully.

**Step 2: Add new variables to `.env`**

Open `.env` and add these lines (fill in actual values):

```
# Google Sheets API (for Python batch editor)
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/your/service_account.json
SHEET_ID=your_spreadsheet_id_here
TRAVEL_SHEET_GID=your_travel_sheet_gid
REFERENCE_SHEET_GID=your_reference_sheet_gid
IMPORTANT_INFO_SHEET_GID=your_important_info_gid
```

> **SHEET_ID**: from your Sheets URL — `spreadsheets/d/XXXXXX/edit` → copy `XXXXXX`
> **GIDs**: each tab's GID from URL `#gid=XXXXXX`

**Step 3: Share Sheets with Service Account**

In Google Sheets → Share → paste service account email (from JSON file, field `client_email`) → Editor access.

**Step 4: Verify connection**

```bash
python3 -c "
import gspread, os
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv
load_dotenv()
creds = Credentials.from_service_account_file(os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON'), scopes=['https://www.googleapis.com/auth/spreadsheets'])
gc = gspread.authorize(creds)
ss = gc.open_by_key(os.getenv('SHEET_ID'))
print('✅ Connected:', ss.title)
"
```

Expected: `✅ Connected: [your spreadsheet name]`

---

## Task 6: Python — Create `scripts/sheets_editor.py` (core + CRUD)

**Files:**
- Create: `scripts/sheets_editor.py`

**Step 1: Create the file**

```python
"""
sheets_editor.py — Google Sheets batch editor for travel_planner.

Usage from Claude Code (interactive):
  python3 scripts/sheets_editor.py

Functions available for Claude Code to call:
  add_row(sheet_type, fields)
  update_row(sheet_type, key_fields, new_fields)
  delete_row(sheet_type, key_fields)
  replace_day(date_str, new_rows_list)
  format_sheet(sheet_type)
  sort_sheet(sheet_type)
  show_sheet(sheet_type)

sheet_type: 'travel' | 'reference' | 'important'
"""

import os
import json
from dotenv import load_dotenv

import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

load_dotenv()

SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

GID_KEYS = {
    'travel':    'TRAVEL_SHEET_GID',
    'reference': 'REFERENCE_SHEET_GID',
    'important': 'IMPORTANT_INFO_SHEET_GID',
}

SORT_KEYS = {
    'travel':    ['日期', '時間'],
    'reference': ['類別', '名稱'],
    'important': ['category', 'title'],
}

HEADER_COLORS = {
    'travel':    '#1F4E79',
    'reference': '#1E4620',
    'important': '#1E4620',
}

LIGHT_COLORS = {
    'travel':    '#E8F0FE',
    'reference': '#E8F5E9',
    'important': '#E8F5E9',
}

GROUP_COL = {
    'travel':    '日期',
    'reference': '類別',
    'important': 'category',
}


def _get_creds():
    sa_path = os.getenv('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not sa_path:
        raise ValueError('GOOGLE_SERVICE_ACCOUNT_JSON not set in .env')
    return Credentials.from_service_account_file(sa_path, scopes=SCOPES)


def _get_gc():
    return gspread.authorize(_get_creds())


def get_sheet(sheet_type):
    """Return the gspread Worksheet for the given sheet_type."""
    if sheet_type not in GID_KEYS:
        raise ValueError(f'Unknown sheet_type: {sheet_type}. Use: travel, reference, important')
    gc = _get_gc()
    sheet_id = os.getenv('SHEET_ID')
    if not sheet_id:
        raise ValueError('SHEET_ID not set in .env')
    ss = gc.open_by_key(sheet_id)
    gid = os.getenv(GID_KEYS[sheet_type])
    if not gid:
        raise ValueError(f'{GID_KEYS[sheet_type]} not set in .env')
    for ws in ss.worksheets():
        if str(ws.id) == gid:
            return ws
    raise ValueError(f'Sheet tab not found for GID={gid}')


def show_sheet(sheet_type):
    """Print current sheet contents to console."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if not data:
        print(f'[{sheet_type}] Empty sheet')
        return
    headers = data[0]
    print(f'\n[{sheet_type}] {len(data)-1} rows')
    print(' | '.join(headers))
    print('-' * 80)
    for row in data[1:]:
        print(' | '.join(str(v) for v in row[:6]))  # show first 6 cols


def add_row(sheet_type, fields):
    """Append a new row, then sort and format the sheet.

    Args:
        sheet_type: 'travel' | 'reference' | 'important'
        fields: dict mapping column headers to values
                e.g. {'日期': '2026/03/07', '時間': '14:00', ...}
    """
    ws = get_sheet(sheet_type)
    headers = ws.row_values(1)
    row = [fields.get(h, '') for h in headers]
    ws.append_row(row, value_input_option='USER_ENTERED')
    sort_sheet(sheet_type)
    format_sheet(sheet_type)
    print(f'✅ Added to {sheet_type}')


def update_row(sheet_type, key_fields, new_fields):
    """Find a row by key_fields and update new_fields.

    Args:
        key_fields: dict to identify the row, e.g. {'日期': '2026/03/07', '時間': '14:00'}
        new_fields: dict of fields to update, e.g. {'活動標題': '嚴島神社'}
    """
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 2:
        raise ValueError(f'{sheet_type} sheet has no data rows')
    headers = data[0]

    row_idx = None
    for i, row in enumerate(data[1:], start=2):
        match = all(
            (headers.index(k) < len(row) and row[headers.index(k)] == v)
            for k, v in key_fields.items()
            if k in headers
        )
        if match:
            row_idx = i
            break

    if row_idx is None:
        raise ValueError(f'Row not found matching {key_fields}')

    existing = list(data[row_idx - 1])
    for field, value in new_fields.items():
        if field in headers:
            existing[headers.index(field)] = value

    ws.update(f'A{row_idx}', [existing], value_input_option='USER_ENTERED')
    format_sheet(sheet_type)
    print(f'✅ Updated row {row_idx} in {sheet_type}')


def delete_row(sheet_type, key_fields):
    """Find a row by key_fields and delete it.

    Args:
        key_fields: dict to identify the row, e.g. {'日期': '2026/03/07', '時間': '14:00'}
    """
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 2:
        raise ValueError(f'{sheet_type} sheet has no data rows')
    headers = data[0]

    row_idx = None
    for i, row in enumerate(data[1:], start=2):
        match = all(
            (headers.index(k) < len(row) and row[headers.index(k)] == v)
            for k, v in key_fields.items()
            if k in headers
        )
        if match:
            row_idx = i
            break

    if row_idx is None:
        raise ValueError(f'Row not found matching {key_fields}')

    ws.delete_rows(row_idx)
    format_sheet(sheet_type)
    print(f'✅ Deleted row {row_idx} from {sheet_type}')


def replace_day(date_str, new_rows_list):
    """Delete all Travel rows for date_str and insert new_rows_list.

    Args:
        date_str: e.g. '2026/03/07'
        new_rows_list: list of dicts, each dict = one row's fields
                       e.g. [{'日期': '2026/03/07', '時間': '09:00', ...}, ...]
    """
    ws = get_sheet('travel')
    data = ws.get_all_values()
    if not data:
        raise ValueError('Travel sheet is empty')
    headers = data[0]
    date_idx = headers.index('日期') if '日期' in headers else 0

    # Collect row indices (1-indexed) for this date, bottom-up
    rows_to_delete = [
        i + 2
        for i, row in enumerate(data[1:])
        if row[date_idx] == date_str
    ]

    for row_idx in reversed(rows_to_delete):
        ws.delete_rows(row_idx)

    # Append new rows
    if new_rows_list:
        to_append = []
        for fields in new_rows_list:
            row = [fields.get(h, '') for h in headers]
            to_append.append(row)
        ws.append_rows(to_append, value_input_option='USER_ENTERED')

    sort_sheet('travel')
    format_sheet('travel')
    print(f'✅ Replaced {len(rows_to_delete)} rows for {date_str} → {len(new_rows_list)} new rows')
```

**Step 2: Commit**

```bash
git add scripts/sheets_editor.py
git commit -m "feat: add sheets_editor.py with CRUD functions"
```

---

## Task 7: Python — Add `sort_sheet()` + `format_sheet()` to sheets_editor.py

**Files:**
- Modify: `scripts/sheets_editor.py`

**Step 1: Append these two functions at the end of `sheets_editor.py`**

```python
def sort_sheet(sheet_type):
    """Sort data rows by key columns. Called automatically by add_row/replace_day."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if len(data) < 3:
        return  # header + <2 rows → nothing to sort

    headers = data[0]
    rows = data[1:]
    key_cols = SORT_KEYS.get(sheet_type, [])
    key_indices = [headers.index(k) for k in key_cols if k in headers]

    if key_indices:
        rows.sort(key=lambda r: tuple(r[i] if i < len(r) else '' for i in key_indices))

    # Clear data area and rewrite sorted rows
    total = len(rows)
    ws.batch_clear([f'A2:ZZ{total + 1}'])
    if rows:
        ws.update('A2', rows, value_input_option='USER_ENTERED')
    print(f'  ↳ sorted {total} rows in {sheet_type}')


def _hex_to_rgb(hex_color):
    """Convert #RRGGBB → {red, green, blue} with 0–1 float values."""
    h = hex_color.lstrip('#')
    return {
        'red':   int(h[0:2], 16) / 255,
        'green': int(h[2:4], 16) / 255,
        'blue':  int(h[4:6], 16) / 255,
    }


def format_sheet(sheet_type):
    """Apply header color + alternating row colors to the sheet."""
    ws = get_sheet(sheet_type)
    data = ws.get_all_values()
    if not data:
        return

    worksheet_id = ws.id
    spreadsheet_id = os.getenv('SHEET_ID')
    service = build('sheets', 'v4', credentials=_get_creds())

    headers = data[0]
    num_cols = len(headers)
    header_bg = HEADER_COLORS[sheet_type]
    light_color = LIGHT_COLORS[sheet_type]
    group_col_name = GROUP_COL[sheet_type]
    group_col_idx = headers.index(group_col_name) if group_col_name in headers else 0

    requests = []

    # ── Header row (row index 0 = row 1 in Sheets) ──
    requests.append({
        'repeatCell': {
            'range': {
                'sheetId': worksheet_id,
                'startRowIndex': 0,
                'endRowIndex': 1,
                'startColumnIndex': 0,
                'endColumnIndex': num_cols,
            },
            'cell': {
                'userEnteredFormat': {
                    'backgroundColor': _hex_to_rgb(header_bg),
                    'textFormat': {
                        'foregroundColor': _hex_to_rgb('#FFFFFF'),
                        'bold': True,
                    }
                }
            },
            'fields': 'userEnteredFormat(backgroundColor,textFormat)',
        }
    })

    # ── Data rows: alternating by group ──
    if len(data) > 1:
        group_idx = -1
        last_group = None

        for i, row in enumerate(data[1:]):
            row_0idx = i + 1  # 0-indexed sheet row
            group_val = row[group_col_idx] if group_col_idx < len(row) else ''
            if group_val and group_val != last_group:
                last_group = group_val
                group_idx += 1

            bg = '#FFFFFF' if group_idx % 2 == 0 else light_color
            requests.append({
                'repeatCell': {
                    'range': {
                        'sheetId': worksheet_id,
                        'startRowIndex': row_0idx,
                        'endRowIndex': row_0idx + 1,
                        'startColumnIndex': 0,
                        'endColumnIndex': num_cols,
                    },
                    'cell': {
                        'userEnteredFormat': {
                            'backgroundColor': _hex_to_rgb(bg)
                        }
                    },
                    'fields': 'userEnteredFormat.backgroundColor',
                }
            })

    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'requests': requests}
    ).execute()
    print(f'  ↳ formatted {sheet_type} ({len(data)-1} data rows)')
```

**Step 2: Commit**

```bash
git add scripts/sheets_editor.py
git commit -m "feat: add sort_sheet and format_sheet to sheets_editor"
```

---

## Task 8: Manual verification

**No files to modify — testing only**

**Step 1: Test format_sheet on Reference**

```bash
cd "/Users/lisa/Library/CloudStorage/GoogleDrive-chycl06@gmail.com/我的雲端硬碟/AI_project/csk/travel_planner"
python3 -c "
from scripts.sheets_editor import format_sheet
format_sheet('reference')
"
```
Expected output: `↳ formatted reference (N data rows)`
Open Google Sheets Reference tab → verify dark green header + alternating white/light green rows by category.

**Step 2: Test format_sheet on Travel**

```bash
python3 -c "
from scripts.sheets_editor import format_sheet
format_sheet('travel')
"
```
Open Travel tab → dark blue header + alternating white/light blue rows by date.

**Step 3: Test add_row on Important Info**

```bash
python3 -c "
from scripts.sheets_editor import add_row
add_row('important', {
    'category': '緊急聯絡',
    'title': '測試項目（請刪除）',
    'content': '這是測試資料',
    'link': ''
})
"
```
Expected: row added, sorted, formatted. Open Important Info tab to verify.

**Step 4: Test delete_row**

```bash
python3 -c "
from scripts.sheets_editor import delete_row
delete_row('important', {'title': '測試項目（請刪除）'})
"
```
Expected: row removed, format reapplied.

**Step 5: Test show_sheet**

```bash
python3 -c "
from scripts.sheets_editor import show_sheet
show_sheet('travel')
"
```
Expected: table printed to console with date, time, type, city, title columns.

---

## Summary

| Task | Scope | Key Result |
|------|-------|-----------|
| 1 | GAS | formatSheet() + sortSheet() added |
| 2 | GAS | Every write/delete triggers sort+format |
| 3 | GAS | Important Info CRUD in SheetsService |
| 4 | GAS | LINE commands: 重要 / 刪除重要 |
| 5 | Python | gspread installed, .env updated |
| 6 | Python | sheets_editor.py with CRUD functions |
| 7 | Python | format_sheet() + sort_sheet() added |
| 8 | Verify | Manual tests pass for all 3 sheets |

**After Task 4: deploy GAS Web App to activate LINE Bot changes.**
**After Task 8: Claude Code can call sheets_editor functions for batch edits.**
