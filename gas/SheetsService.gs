// ── 主要寫入入口（含重複偵測）────────────────────────
// 回傳 { action: 'appended' }
//     { action: 'duplicate', rowIndex, existingDesc }
function checkAndWrite(data, props) {
  try {
    const sheetId = props.getProperty('SHEET_ID');
    if (!sheetId) {
      throw new Error('未設定 Script Properties: SHEET_ID。請至專案設定中新增您的 Google 試算表 ID。');
    }
    const ss = SpreadsheetApp.openById(sheetId);

    if (data.type === 'travel') {
      const sheet = getSheetByGid(ss, props.getProperty('TRAVEL_SHEET_GID'));
      const date = (data.fields['日期'] || '').trim();
      const time = (data.fields['時間'] || '').trim();

      if (date && time) {
        const existing = findRowByKey(sheet, { '日期': date, '時間': time });
        if (existing) {
          const title = existing.existingValues['活動標題'] || '';
          return {
            action: 'duplicate',
            rowIndex: existing.rowIndex,
            existingDesc: `${date} ${time}${title ? '「' + title + '」' : ''}`
          };
        }
      }
      appendByHeaders(sheet, data.fields);
      return { action: 'appended' };

    } else {
      // reference data
      const sheet = getSheetByGid(ss, props.getProperty('REFERENCE_SHEET_GID'));
      const name = (data.fields['名稱'] || '').trim();

      if (name) {
        const existing = findRowByKey(sheet, { '名稱': name });
        if (existing) {
          return {
            action: 'duplicate',
            rowIndex: existing.rowIndex,
            existingDesc: `名稱「${name}」`
          };
        }
      }
      appendByHeaders(sheet, data.fields);
      return { action: 'appended' };
    }

  } catch (err) {
    Logger.log('Sheets checkAndWrite error: ' + err.message);
    throw new Error('SHEETS_WRITE_FAILED');
  }
}

// ── 強制覆蓋既有列（用戶確認後才呼叫）──────────────────
function overwriteRow(data, rowIndex, props) {
  try {
    const sheetId = props.getProperty('SHEET_ID');
    if (!sheetId) {
      throw new Error('未設定 Script Properties: SHEET_ID。請至專案設定中新增您的 Google 試算表 ID。');
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const gid = data.type === 'travel'
      ? props.getProperty('TRAVEL_SHEET_GID')
      : props.getProperty('REFERENCE_SHEET_GID');
    const sheet = getSheetByGid(ss, gid);
    updateByHeaders(sheet, rowIndex, data.fields);
  } catch (err) {
    Logger.log('Sheets overwrite error: ' + err.message);
    throw new Error('SHEETS_WRITE_FAILED');
  }
}

// ── 動態 Append：讀 header 列決定欄位順序 ────────────
// 不再寫死欄位順序，避免 Google Sheets 調整欄位時城市/其他欄跑掉
function appendByHeaders(sheet, fields) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) throw new Error('Sheet 無 header 列，請先確認表格標題列');

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const row = headers.map(h => {
    if (h === '群組ID') return ''; // 新增資料 群組ID 留空
    const val = fields[h];
    return (val !== undefined && val !== null) ? val : '';
  });
  sheet.appendRow(row);
}

// ── 動態 Update：覆蓋指定列，保留 群組ID ─────────────
function updateByHeaders(sheet, rowIndex, fields) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // 讀取既有列，保留 群組ID 原值
  const existingRow = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  const newRow = headers.map((h, i) => {
    if (h === '群組ID') return existingRow[i]; // 保留原 群組ID
    const val = fields[h];
    return (val !== undefined && val !== null) ? val : existingRow[i];
  });

  sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
}

// ── 查找既有列 ────────────────────────────────────────
// keys: { '日期': '2026/03/07', '時間': '14:00' }  （可多個 key 同時比對）
// returns: { rowIndex, existingValues } or null
function findRowByKey(sheet, keys) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  const headers = data[0];
  const keyEntries = Object.entries(keys);

  for (let i = 1; i < data.length; i++) {
    const match = keyEntries.every(([col, val]) => {
      const idx = headers.indexOf(col);
      if (idx === -1) return false;
      // 日期欄可能是 Date 物件（GAS 自動轉型），統一轉字串比對
      const cellStr = formatCellValue(data[i][idx]);
      return cellStr === (val || '').trim();
    });

    if (match) {
      // 收集幾個關鍵欄位值，供顯示給用戶
      const existingValues = {};
      ['活動標題', '城市', '名稱', '類別', '時段'].forEach(key => {
        const idx = headers.indexOf(key);
        if (idx !== -1) existingValues[key] = data[i][idx] ? data[i][idx].toString() : '';
      });
      return { rowIndex: i + 1, existingValues }; // rowIndex 為 1-indexed
    }
  }
  return null;
}

// ── 欄位值標準化（處理 GAS 自動將日期轉為 Date 物件的問題）
function formatCellValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    // 日期格式統一輸出為 yyyy/mm/dd
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
  }
  return val.toString().trim();
}

function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    if (sheet.getSheetId().toString() === gid) return sheet;
  }
  throw new Error('找不到分頁 GID: ' + gid);
}

// ── 測試：寫入一筆測試資料，確認動態欄位對應正確 ────────
function testWriteReference() {
  const props = PropertiesService.getScriptProperties();
  const result = checkAndWrite({
    type: 'reference',
    fields: {
      '類別': '餐廳',
      '城市': '廣島市',
      '名稱': '測試餐廳（請刪除）',
      '官網連結': '',
      '地點/導航': '',
      '簡介': '這是測試資料，請手動刪除。',
      '備註': ''
    }
  }, props);

  if (result.action === 'appended') {
    Logger.log('✅ 寫入成功！請到 Google Sheets 確認欄位順序正確，然後手動刪除測試列。');
  } else {
    Logger.log(`⚠️ 已有相同資料（${result.existingDesc}），rowIndex=${result.rowIndex}`);
  }
}
