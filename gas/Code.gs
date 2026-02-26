function doGet(e) {
  return okResponse();
}

// ── LINE Webhook 簽章驗證 ─────────────────────────────
// 官方文件：https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
// 演算法：Base64(HMAC-SHA256(rawBody, channelSecret))
function isValidLineSignature(rawBody, signature, props) {
  const channelSecret = props.getProperty('LINE_CHANNEL_SECRET');

  if (!channelSecret) {
    Logger.log('⚠️ LINE_CHANNEL_SECRET 未設定，跳過簽章驗證');
    return true;
  }

  if (!signature) {
    const strictMode = props.getProperty('STRICT_SIGNATURE_MODE') === 'true';
    Logger.log(strictMode
      ? '⛔ 嚴格模式：缺少 x-line-signature，拒絕請求'
      : '⚠️ 缺少 x-line-signature（e.headers 可能不支援），允許通過');
    return !strictMode;
  }

  try {
    const sigBytes = Utilities.computeHmacSha256Signature(rawBody, channelSecret);
    const computed = Utilities.base64Encode(sigBytes);
    if (computed !== signature) {
      Logger.log('⛔ 簽章不符，疑似偽造請求，已拒絕');
      return false;
    }
    return true;
  } catch (err) {
    Logger.log('簽章計算錯誤: ' + err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────
function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const rawBody = e.postData.contents;

    const signature = e.headers && (e.headers['x-line-signature'] || e.headers['X-Line-Signature']);
    if (!isValidLineSignature(rawBody, signature, props)) {
      return okResponse();
    }

    const body = JSON.parse(rawBody);
    const events = body.events;
    if (!events || events.length === 0) return okResponse();

    const event = events[0];
    if (event.type !== 'message' || event.message.type !== 'text') return okResponse();

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const text = event.message.text.trim();

    handleMessage(userId, replyToken, text, props);
  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
  }
  return okResponse();
}

function okResponse() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 錯誤代碼對應的用戶訊息 ──────────────────────────────
const ERROR_MESSAGES = {
  'RATE_LIMITED': '⚠️ 目前請求太頻繁，請等一分鐘後再傳訊息。',
  'DAILY_LIMIT': '⚠️ 今日 AI 查詢已達上限，請明天再使用。',
  'SHEETS_WRITE_FAILED': '❌ 寫入 Google Sheets 失敗，請稍後再試，或手動開啟試算表新增。'
};

function handleMessage(userId, replyToken, text, props) {
  try {
    _handleMessage(userId, replyToken, text, props);
  } catch (err) {
    const userMsg = ERROR_MESSAGES[err.message]
      || `❌ 發生錯誤：${err.message}\n請稍後再試。`;
    Logger.log(`handleMessage error [${err.message}]: ${err.stack}`);
    sendLineReply(replyToken, userMsg, props);
  }
}

// Parse natural language modification input.
// Supported patterns:
//   "改 欄位名 新內容"  (legacy format, preserved)
//   "欄位名改新內容" / "欄位名改成新內容"
//   "把欄位名改成新內容" / "把欄位名換成新內容"
//   "欄位名換成新內容"
//
// Returns { rawField, value } where rawField may be approximate,
// or null if no pattern matched.
function parseModification(text) {
  const patterns = [
    /^改\s+(\S+)\s+(.+)$/,                       // 改 欄位名 新內容
    /^把(.+?)(?:改成|換成|改為|換為)\s*(.+)$/,    // 把X改成Y
    /^(.+?)(?:改成|換成|改為|換為)\s*(.+)$/,      // X改成Y
    /^(.+?)改\s*(.+)$/,                           // X改Y
    /^(.+?)換\s*(.+)$/,                           // X換Y
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return { rawField: m[1].trim(), value: m[2].trim() };
  }
  return null;
}

// Resolve a user-supplied field name (possibly partial) to an exact key in fields.
// Returns exact key string, or null if not found.
// If multiple keys match the substring, returns the first match.
function resolveField(rawField, fields) {
  const keys = Object.keys(fields);
  // 1. Exact match
  if (rawField in fields) return rawField;
  // 2. Substring match: key contains rawField
  const sub = keys.filter(k => k.includes(rawField));
  if (sub.length === 1) return sub[0];
  if (sub.length > 1) return sub[0]; // pick first; caller may show all matches
  // 3. rawField contains key (e.g. user typed full name with brackets)
  const rev = keys.filter(k => rawField.includes(k));
  if (rev.length >= 1) return rev[0];
  return null;
}

function _handleMessage(userId, replyToken, text, props) {
  const cache = CacheService.getUserCache();
  const pendingKey = 'pending_' + userId;
  const pendingRaw = cache.get(pendingKey);
  const pendingDelKey = 'pending_del_' + userId;
  const pendingDelRaw = cache.get(pendingDelKey);

  // ── 等待刪除確認 ──────────────────────────────────────
  if (pendingDelRaw) {
    const delData = JSON.parse(pendingDelRaw);
    if (text === '取消') {
      cache.remove(pendingDelKey);
      sendLineReply(replyToken, '✅ 已取消，資料未刪除。', props);
      return;
    }
    if (text === '確認') {
      try {
        const sheetId = props.getProperty('SHEET_ID');
        const ss = SpreadsheetApp.openById(sheetId);
        const gid = delData.type === 'travel'
          ? props.getProperty('TRAVEL_SHEET_GID')
          : props.getProperty('REFERENCE_SHEET_GID');
        const sheet = getSheetByGid(ss, gid);
        deleteRow(sheet, delData.rowIndex);
        formatSheet(sheet, delData.type);
        cache.remove(pendingDelKey);
        sendLineReply(replyToken, `✅ 已刪除：${delData.desc}`, props);
      } catch (err) {
        Logger.log('deleteRow error: ' + err.message);
        cache.remove(pendingDelKey);
        sendLineReply(replyToken, '❌ 刪除失敗，請稍後再試。', props);
      }
      return;
    }
    // Unrecognized reply during delete confirmation → re-show prompt
    sendLineReply(replyToken,
      `⚠️ 確定要刪除「${delData.desc}」嗎？\n確認刪除 請回覆「確認」\n取消 請回覆「取消」`,
      props);
    return;
  }

  // ── 等待中狀態（已填好欄位，等用戶確認）──
  if (pendingRaw) {
    const data = JSON.parse(pendingRaw);

    // ── 取消（任何等待狀態都可取消）──
    if (text === '取消') {
      cache.remove(pendingKey);
      sendLineReply(replyToken, '✅ 已取消，資料未寫入。', props);
      return;
    }

    // ── 確認 ──
    if (text === '確認') {
      if (data.awaitingOverwrite) {
        // 第二次確認：用戶同意覆蓋既有列
        overwriteRow(data, data.rowIndex, props);
        cache.remove(pendingKey);
        sendLineReply(replyToken, buildSuccessText(data.type, props) + '\n（已覆蓋原有資料）', props);
      } else {
        // 第一次確認：先檢查是否有重複
        const result = checkAndWrite(data, props);
        if (result.action === 'appended') {
          cache.remove(pendingKey);
          sendLineReply(replyToken, buildSuccessText(data.type, props), props);
        } else {
          // 發現重複 → 請用戶決定是否覆蓋
          data.awaitingOverwrite = true;
          data.rowIndex = result.rowIndex;
          cache.put(pendingKey, JSON.stringify(data), 600);
          sendLineReply(replyToken,
            `⚠️ 已有相同記錄：${result.existingDesc}\n\n` +
            `覆蓋原資料請回覆「確認」\n放棄請回覆「取消」`,
            props);
        }
      }
      return;
    }

    // ── 欄位修改（支援自然語言，如：城市改廣島市、把費用改成¥1200）──
    const mod = parseModification(text);
    if (mod) {
      const exactField = resolveField(mod.rawField, data.fields);
      if (exactField) {
        data.fields[exactField] = mod.value;
        delete data.awaitingOverwrite;
        delete data.rowIndex;
        cache.put(pendingKey, JSON.stringify(data), 600);
        sendLineReply(replyToken, buildConfirmationText(data), props);
      } else {
        const fieldList = Object.keys(data.fields).join('、');
        sendLineReply(replyToken,
          `⚠️ 找不到欄位「${mod.rawField}」\n可用欄位：${fieldList}\n\n範例：城市改廣島市`,
          props);
      }
      return;
    }

    // 不認識的回覆 → 重新顯示確認畫面
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  // ── 新請求 ──
  if (text.startsWith('行程 ')) {
    const input = text.slice(3).trim();
    sendLoadingIndicator(userId, props);
    const fields = callGemini(input, 'travel', props);
    const data = { type: 'travel', fields };
    cache.put(pendingKey, JSON.stringify(data), 600);
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  if (text.startsWith('補充 ')) {
    const input = text.slice(3).trim();
    sendLoadingIndicator(userId, props);
    const fields = callGemini(input, 'reference', props);
    const data = { type: 'reference', fields };
    cache.put(pendingKey, JSON.stringify(data), 600);
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  // ── 刪除行程 ──────────────────────────────────────────
  // Format: "刪除行程 MM/DD HH:mm" or "刪除行程 MM/DD 活動標題"
  if (text.startsWith('刪除行程 ')) {
    const parts = text.slice(5).trim().split(/\s+/);
    if (parts.length < 2) {
      sendLineReply(replyToken, '格式：刪除行程 03/07 14:00\n或：刪除行程 03/07 嚴島神社', props);
      return;
    }
    const rawDate = parts[0];
    const dateStr = rawDate.includes('/') && rawDate.split('/')[0].length <= 2
      ? '2026/' + rawDate.padStart(5, '0')   // "3/07" → "2026/03/07"
      : rawDate;
    const second = parts.slice(1).join(' ');

    const sheetId = props.getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = getSheetByGid(ss, props.getProperty('TRAVEL_SHEET_GID'));

    // Try lookup by date + time first, then date + title
    const timePattern = /^\d{1,2}:\d{2}$/;
    const lookupKey = timePattern.test(second)
      ? { '日期': dateStr, '時間': second }
      : { '日期': dateStr, '活動標題': second };

    const found = findRowByKey(sheet, lookupKey);
    if (!found) {
      sendLineReply(replyToken, `查無「${rawDate} ${second}」，請確認日期與時間或標題。`, props);
      return;
    }
    const desc = `${rawDate} ${second}（${found.existingValues['活動標題'] || second}）`;
    cache.put(pendingDelKey, JSON.stringify({ type: 'travel', rowIndex: found.rowIndex, desc }), 600);
    sendLineReply(replyToken,
      `⚠️ 確定要刪除「${desc}」嗎？\n確認刪除 請回覆「確認」\n取消 請回覆「取消」`,
      props);
    return;
  }

  // ── 刪除補充 ──────────────────────────────────────────
  // Format: "刪除補充 名稱"
  if (text.startsWith('刪除補充 ')) {
    const name = text.slice(5).trim();
    const sheetId = props.getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = getSheetByGid(ss, props.getProperty('REFERENCE_SHEET_GID'));
    const found = findRowByKey(sheet, { '名稱': name });
    if (!found) {
      sendLineReply(replyToken, `查無補充資料「${name}」，請確認名稱。`, props);
      return;
    }
    cache.put(pendingDelKey, JSON.stringify({ type: 'reference', rowIndex: found.rowIndex, desc: name }), 600);
    sendLineReply(replyToken,
      `⚠️ 確定要刪除補充資料「${name}」嗎？\n確認刪除 請回覆「確認」\n取消 請回覆「取消」`,
      props);
    return;
  }

  // 未知指令
  sendLineReply(replyToken,
    '請用以下格式輸入：\n\n🗓 新增行程：\n行程 2026/03/07 下午 廣島 嚴島神社\n\n📝 新增補充資料：\n補充 裕示堂 廣島市威士忌酒吧\n\n🗑 刪除行程：\n刪除行程 03/07 14:00\n刪除補充 裕示堂\n\n💡 等待確認時可用「取消」取消操作',
    props);
}

// ── 模擬測試：直接在 GAS 控制台跑 ──────────────────────────
// 測試新增行程
function testNewTravel() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('🚀 開始測試：新增行程');
  handleMessage(
    'test_user_lisa', 
    'mock_token', 
    '行程 2026/03/07 下午 廣島 嚴島神社', 
    props
  );
  Logger.log('🏁 測試請求已發送，請查看上方 Log 中的 🎬 [MOCK LINE REPLY]');
}

function testDeleteReference() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('🚀 測試：刪除補充（查無）');
  handleMessage('test_user_lisa', 'mock_token', '刪除補充 不存在的地方', props);
}

function testDeleteFlow() {
  // Step 1: trigger delete (will find or not find)
  const props = PropertiesService.getScriptProperties();
  Logger.log('🚀 測試：刪除行程指令解析');
  handleMessage('test_user_lisa', 'mock_token', '刪除行程 03/07 14:00', props);
}

// 測試新增補充資料
function testNewReference() {
  const props = PropertiesService.getScriptProperties();
  Logger.log('🚀 開始測試：新增補充資料');
  handleMessage(
    'test_user_lisa', 
    'mock_token', 
    '補充 裕示堂 廣島市威士忌酒吧', 
    props
  );
  Logger.log('🏁 測試請求已發送，請查看下方 Log 中的 🎬 [MOCK LINE REPLY]');
}
