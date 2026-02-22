// Gemini 3 Flash Preview — 直連，不使用 Google Search（2026/1 起需付費）
const GEMINI_MODEL = 'gemini-3-flash-preview'; // 備用：'gemini-2.5-flash'
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

// ── 限速設定 ──────────────────────────────────────────
// 官方 gemini-2.5-flash 免費配額：10 RPM / 250 RPD
// gemini-3-flash-preview 無官方公開數字，保守設定如下
// RPM=5 = 每分鐘最多 5 次（實際上限 10）→ 安全緩衝 50%
// RPD=20 = 每日最多 20 次（實際上限 250+）→ 個人用量夠，避免意外耗盡
const RPM_LIMIT = 5;
const RPD_LIMIT = 20;

// ── 限速保護 ──────────────────────────────────────────
// 使用 LockService 防止並發請求的 read-modify-write race condition
// GAS 最多 30 個並發執行；此 Bot 為單人使用，通常不超過 2 個並發
//
// 為何 sleep 在 lock 內：確保請求之間有間隔，防止瞬間 burst
// 這意味著每個 lock 佔用 ~3 秒；timeout 設 30s 可容納 ~8 個排隊請求
// 超過 30s 仍等不到 lock → 拋出 RATE_LIMITED（告知用戶稍後再試）
function checkAndThrottle(props) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 30s = 容納 ~8 個排隊請求（每個持鎖 ~3s）
  } catch (e) {
    Logger.log('LockService 等待超時 (30s)：系統過於繁忙');
    throw new Error('RATE_LIMITED');
  }

  try {
    const cache = CacheService.getScriptCache();
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

    // ── RPD 每日上限 ──
    const rpdKey = 'gem_rpd_' + today;
    const rpdCount = parseInt(props.getProperty(rpdKey) || '0');
    if (rpdCount >= RPD_LIMIT) {
      throw new Error('DAILY_LIMIT');
    }

    // ── RPM：每分鐘上限，達到時直接告知用戶（不 sleep 60s，避免 LINE token 過期）──
    // LINE reply token 有效期 30s；60s sleep 會導致 token 過期，用戶無回應
    const rpmKey = 'gem_rpm';
    const rpmCount = parseInt(cache.get(rpmKey) || '0');
    if (rpmCount >= RPM_LIMIT) {
      throw new Error('RATE_LIMITED');
    }

    // ── 請求間隔 3s（非第一次請求才 sleep）──
    // 目的：避免瞬間 burst 傷害 API；3s × 5 RPM = 最多每 3s 一次
    if (rpmCount > 0) {
      Utilities.sleep(3000);
    }

    // ── 原子計數更新（在 lock 保護內）──
    cache.put(rpmKey, String(rpmCount + 1), 60); // 60s TTL = 1 分鐘後重置
    props.setProperty(rpdKey, String(rpdCount + 1));
    Logger.log(`Gemini 用量 — 今日: ${rpdCount + 1}/${RPD_LIMIT}，本分鐘: ${rpmCount + 1}/${RPM_LIMIT}`);

  } finally {
    lock.releaseLock(); // 無論成功或例外都釋放 lock
  }
}

// ── System Prompts ────────────────────────────────────
const TRAVEL_SYSTEM_PROMPT = `你是廣島旅行規劃助理。使用者會給你一筆行程資料（不完整），請根據你的知識補全所有欄位，以 JSON 格式回傳。

欄位規格（嚴格遵守）：
- 日期：yyyy/mm/dd
- 星期：Mon./Tue./Wed./Thu./Fri./Sat./Sun.（根據日期計算）
- 時段：早上(<12:00) / 下午(12-18) / 晚上(>18)
- 時間：HH:mm（24小時制，推測合理時間）
- 類型：交通/用餐/景點/購物/住宿
- 城市：繁體中文
- 活動標題：繁體中文
- 內容詳情：一句話描述
- 交通工具：具體路線編號（如「路面電車1號線」），無則填"-"
- 交通支付方式：Apple Pay / ICOCA / 信用卡 / 現金，無則填"-"
- 地點/導航：https://maps.google.com/maps?q=[英文地名]&t=&z=15&ie=UTF8&iwloc=&output=embed，無則填"-"
- 相關連結(時刻表)：官方URL，無則填"-"
- 起始站：繁體中文 (日文名稱)，無則填"-"
- 終點站：繁體中文 (日文名稱)，無則填"-"
- 班次頻率/時刻資訊：文字描述，無則填"-"
- 移動時間：X分 或 X.X小時，無則填"-"
- 交通費用(JPY)：¥數字（千分位），免費填¥0
- 景點官網：URL，無則填"-"
- 景點票價 (JPY)：¥數字，免費填¥0，無則填"-"
- 營業時間/狀態：如「09:00-17:00，週一休」，無則填"-"
- 景點簡介：「1. xxx; 2. xxx; 3. xxx」三點格式，無則填"-"
- 景點建議停留時間：X.X hr，無則填"-"
- 景點特殊狀況：2026年3月的特殊資訊，無則填"-"

只回傳 JSON 物件，key 為欄位名，不要加任何說明文字。`;

const REFERENCE_SYSTEM_PROMPT = `你是廣島旅行資料助理。使用者會給你一筆補充資料（名稱 + 其他提示），請根據你的知識補全所有欄位，以 JSON 格式回傳。

欄位規格：
- 類別：交通/餐廳/其他
- 城市：繁體中文城市名
- 名稱：使用者提供的名稱
- 官網連結：官方URL，找不到填""
- 地點/導航：https://maps.google.com/maps?q=[城市英文]+[地點英文]&t=&z=15&ie=UTF8&iwloc=&output=embed，找不到填""
- 簡介：150字以內，說明特色、推薦原因、價位
- 備註：特殊資訊或""

只回傳 JSON 物件，key 為欄位名，不要加任何說明文字。`;

// ── 主要呼叫函式 ──────────────────────────────────────
function callGemini(userInput, mode, props) {
  checkAndThrottle(props); // 含 LockService 保護 + 計數器更新

  const apiKey = props.getProperty('GEMINI_API_KEY');
  const systemPrompt = mode === 'travel' ? TRAVEL_SYSTEM_PROMPT : REFERENCE_SYSTEM_PROMPT;
  const url = `${GEMINI_BASE_URL}${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: userInput }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // ✅ 不使用 googleSearch（2026/1 起需付費）
    generationConfig: { responseMimeType: 'application/json' }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const httpCode = response.getResponseCode();

  // HTTP 429 = API 端的速率限制（補充防線，通常不會到這裡因 checkAndThrottle 先攔截）
  if (httpCode === 429) {
    Logger.log('Gemini 429: API 端速率限制');
    throw new Error('RATE_LIMITED');
  }

  const result = JSON.parse(response.getContentText());
  if (result.error) {
    Logger.log('Gemini API error: ' + result.error.message);
    throw new Error('Gemini error: ' + result.error.message);
  }

  return JSON.parse(result.candidates[0].content.parts[0].text);
}

// ── 測試用（只跑一次，不要連續跑）────────────────────
function testGemini() {
  const props = PropertiesService.getScriptProperties();
  const result = callGemini('2026/03/07 下午 廣島 嚴島神社', 'travel', props);
  Logger.log(JSON.stringify(result, null, 2));
}
