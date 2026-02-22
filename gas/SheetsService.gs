function writeToSheet(data, props) {
  try {
    const sheetId = props.getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    if (data.type === 'travel') {
      writeTravelData(ss, data.fields, props);
    } else {
      writeReferenceData(ss, data.fields, props);
    }
  } catch (err) {
    Logger.log('Sheets write error: ' + err.message);
    throw new Error('SHEETS_WRITE_FAILED');
  }
}

function writeTravelData(ss, fields, props) {
  const sheet = getSheetByGid(ss, props.getProperty('TRAVEL_SHEET_GID'));
  sheet.appendRow([
    '',                                    // 群組ID（留空）
    fields['日期'] || '',
    fields['星期'] || '',
    fields['時段'] || '',
    fields['時間'] || '',
    fields['類型'] || '',
    fields['城市'] || '',
    fields['活動標題'] || '',
    fields['內容詳情'] || '',
    fields['交通工具'] || '',
    fields['交通支付方式'] || '',
    fields['地點/導航'] || '',
    fields['相關連結(時刻表)'] || '',
    fields['起始站'] || '',
    fields['終點站'] || '',
    fields['班次頻率/時刻資訊'] || '',
    fields['移動時間'] || '',
    fields['交通費用(JPY)'] || '',
    fields['景點官網'] || '',
    fields['景點票價(JPY)'] || '',
    fields['營業時間/狀態'] || '',
    fields['景點簡介'] || '',
    fields['景點建議停留時間'] || '',
    fields['景點特殊狀況'] || ''
  ]);
}

function writeReferenceData(ss, fields, props) {
  const sheet = getSheetByGid(ss, props.getProperty('REFERENCE_SHEET_GID'));
  sheet.appendRow([
    fields['類別'] || '',
    fields['城市'] || '',
    fields['名稱'] || '',
    fields['官網連結'] || '',
    fields['地點/導航'] || '',
    fields['簡介'] || '',
    fields['備註'] || ''
  ]);
}

function getSheetByGid(ss, gid) {
  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    if (sheet.getSheetId().toString() === gid) return sheet;
  }
  throw new Error('找不到分頁 GID: ' + gid);
}

// Manual test — writes a test row to Reference Data sheet
function testWriteReference() {
  const props = PropertiesService.getScriptProperties();
  writeToSheet({
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
  Logger.log('寫入成功！請到 Google Sheets 確認，然後手動刪除測試列。');
}
