// LINE 官方規格：text message 上限 5000 UTF-16 字元
// 保留 4500 給欄位內容，500 給頁首/頁尾/說明文字
const LINE_MSG_LIMIT = 4500;

// LINE reply token 有效期為 30 秒
// 確保整個流程（LockService 等待 + Gemini 呼叫）不超過此時限
function sendLineReply(replyToken, message, props) {
  // ── 測試模式：若為 mock_token 則僅印出 Log 不發送 ──
  if (replyToken === 'mock_token') {
    Logger.log('🎬 [MOCK LINE REPLY]\n' + message);
    return true;
  }

  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: message }]
    }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    // 400 = token 已過期（>30s）或已使用；401 = token 無效；429 = 超過速率限制
    Logger.log(`LINE reply failed [${code}]: ${response.getContentText()}`);
    return false;
  }
  return true;
}

// LINE Chat Loading Indicator API
// Shows a typing animation while the bot processes. Does NOT consume reply token.
// loadingSeconds: 5–60 (rounded to multiples of 5)
function sendLoadingIndicator(userId, props) {
  if (!userId || userId === 'test_user_lisa') return; // skip in test mode
  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ chatId: userId, loadingSeconds: 20 }),
    muteHttpExceptions: true
  });
}

function buildConfirmationText(data) {
  const label = data.type === 'travel' ? '詳細行程' : '補充資料';
  const header = '📋 準備寫入：' + label + '\n──────────────────\n';
  const footer = '──────────────────\n✅ 確認寫入　請回覆「確認」\n✏️ 需要修改　請回覆「改 [欄位名] [新內容]」';

  var lines = [];
  for (var key in data.fields) {
    if (!Object.prototype.hasOwnProperty.call(data.fields, key)) continue;
    if (key === 'alternatives') continue; // 備選路線另行顯示，不在欄位列表中
    var value = data.fields[key];
    var v = (value || '').toString().trim();
    if (v && v !== '-') {
      // 地圖 URL 太長，縮短顯示
      var display = v.startsWith('https://maps.google') ? '[地圖連結已產生]' : v;
      var line = key + '：' + display + '\n';

      // 加上此行後超過上限 → 截斷並提示
      if (header.length + lines.join('').length + line.length + footer.length > LINE_MSG_LIMIT) {
        lines.push('…（其餘欄位已省略）\n');
        break;
      }
      lines.push(line);
    }
  }

  // ── 備選路線（travel 且有 alternatives）──────────────────
  var alts = (data.fields && data.fields.alternatives) || [];
  if (alts.length > 0) {
    lines.push('');
    alts.forEach(function(alt, i) {
      var tool = alt['交通工具'] || '-';
      var cost = alt['交通費用(JPY)'] || '-';
      var dur  = alt['移動時間'] || '-';
      var pay  = alt['交通支付方式'] || '-';
      lines.push('🔀 備選 ' + (i + 1) + '：' + tool);
      lines.push('　費用：' + cost + ' | 時間：' + dur + ' | 支付：' + pay);
    });
  }

  return header + lines.join('') + footer;
}

function buildSuccessText(type, props) {
  const sheetId = props.getProperty('SHEET_ID');
  const gid = type === 'travel'
    ? props.getProperty('TRAVEL_SHEET_GID')
    : props.getProperty('REFERENCE_SHEET_GID');
  const label = type === 'travel' ? '已新增行程！' : '已新增補充資料！';
  return `✅ ${label}\n\n📄 查看 Google Sheets：\nhttps://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}`;
}
