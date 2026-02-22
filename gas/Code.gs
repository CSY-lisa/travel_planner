// ── LINE Webhook 簽章驗證 ─────────────────────────────
// 官方文件：https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
// 演算法：Base64(HMAC-SHA256(rawBody, channelSecret))
// GAS 的 Utilities.computeHmacSha256Signature 回傳 byte[]，需 base64Encode
//
// 注意：e.headers 在 GAS Web App 部署中可用（2024+ 版本）
// 若 e.headers 取不到簽章，系統會記錄警告並允許通過（避免封鎖合法請求）
// 確認部署正常後，可將 STRICT_SIGNATURE_MODE Script Property 設為 "true" 啟用嚴格模式
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
    return !strictMode; // strictMode=true 時拒絕；false 時允許（預設）
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

    // 簽章驗證：防止任何知道 GAS URL 的人偽造 webhook 請求
    const signature = e.headers && (e.headers['x-line-signature'] || e.headers['X-Line-Signature']);
    if (!isValidLineSignature(rawBody, signature, props)) {
      return okResponse(); // 靜默拒絕，不洩露任何資訊給攻擊者
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

  // ── 確認狀態 ──
  if (pendingRaw) {
    const data = JSON.parse(pendingRaw);

    if (text === '確認') {
      writeToSheet(data, props); // 失敗時拋出 SHEETS_WRITE_FAILED
      cache.remove(pendingKey);
      sendLineReply(replyToken, buildSuccessText(data.type, props), props);
      return;
    }

    if (text.startsWith('改 ')) {
      // 格式：改 欄位名 新內容
      const spaceIdx = text.indexOf(' ', 2); // 找「改 」後的第一個空格（欄位名與值的分隔）
      if (spaceIdx !== -1) {
        const field = text.slice(2, spaceIdx).trim();
        const value = text.slice(spaceIdx + 1).trim();
        if (field in data.fields) {
          data.fields[field] = value;
          cache.put(pendingKey, JSON.stringify(data), 600);
        } else {
          sendLineReply(replyToken, `⚠️ 找不到欄位「${field}」，請確認欄位名稱正確。`, props);
          return;
        }
      }
      sendLineReply(replyToken, buildConfirmationText(data), props);
      return;
    }

    // 不認識的回覆 → 重新顯示確認
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  // ── 新請求 ──
  if (text.startsWith('行程 ')) {
    const input = text.slice(3).trim();
    const fields = callGemini(input, 'travel', props); // 失敗時拋出 RATE_LIMITED 等
    const data = { type: 'travel', fields };
    cache.put(pendingKey, JSON.stringify(data), 600);
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  if (text.startsWith('補充 ')) {
    const input = text.slice(3).trim();
    const fields = callGemini(input, 'reference', props);
    const data = { type: 'reference', fields };
    cache.put(pendingKey, JSON.stringify(data), 600);
    sendLineReply(replyToken, buildConfirmationText(data), props);
    return;
  }

  // 未知指令
  sendLineReply(replyToken,
    '請用以下格式輸入：\n\n🗓 新增行程：\n行程 2026/03/07 下午 廣島 嚴島神社\n\n📝 新增補充資料：\n補充 裕示堂 廣島市威士忌酒吧',
    props);
}

// ── 模擬測試（不需真實 LINE 訊息）──────────────────────
// 注意：mock_reply_token 會讓 LINE 回覆 400（正常），Gemini + cache 邏輯仍會執行
function testDoPost() {
  const props = PropertiesService.getScriptProperties();
  _handleMessage(
    'test_user_id',
    'mock_reply_token',
    '補充 裕示堂 廣島市威士忌酒吧',
    props
  );
  Logger.log('testDoPost 完成，查看執行記錄');
}
