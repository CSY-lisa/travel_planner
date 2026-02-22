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

function _handleMessage(userId, replyToken, text, props) {
  const cache = CacheService.getUserCache();
  const pendingKey = 'pending_' + userId;
  const pendingRaw = cache.get(pendingKey);

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

    // ── 欄位修改（格式：改 欄位名 新內容）──
    if (text.startsWith('改 ')) {
      const spaceIdx = text.indexOf(' ', 2);
      if (spaceIdx !== -1) {
        const field = text.slice(2, spaceIdx).trim();
        const value = text.slice(spaceIdx + 1).trim();
        if (field in data.fields) {
          data.fields[field] = value;
          // 修改後重置 awaitingOverwrite，重新走確認流程
          delete data.awaitingOverwrite;
          delete data.rowIndex;
          cache.put(pendingKey, JSON.stringify(data), 600);
        } else {
          sendLineReply(replyToken, `⚠️ 找不到欄位「${field}」，請確認欄位名稱正確。`, props);
          return;
        }
      }
      sendLineReply(replyToken, buildConfirmationText(data), props);
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

  // 未知指令
  sendLineReply(replyToken,
    '請用以下格式輸入：\n\n🗓 新增行程：\n行程 2026/03/07 下午 廣島 嚴島神社\n\n📝 新增補充資料：\n補充 裕示堂 廣島市威士忌酒吧\n\n💡 等待確認時可用「取消」取消操作',
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
