/**
 * Fortune Lab ─ 占い師別の「空き枠」計算
 * ----------------------------------------------------------------------
 * サイトの予約フォームから GET で呼ばれ、指定した占い師・日付の
 * 「予約できる時間（空き枠）」を返す。
 *
 *   空き枠 = その占い師の営業枠（曜日・時間） − 既存予約 − 過去の時刻（当日）
 *
 * 営業枠は Notion「占い師DB」の以下プロパティで管理する（未設定なら既定値）:
 *   受付曜日 … マルチセレクト（月/火/水/木/金/土/日）
 *   受付開始 … 数値（時。例: 10 = 10:00 から）
 *   受付終了 … 数値（時。例: 22 = 最終枠 21:30 まで）
 *   休業日   … テキスト（YYYY-MM-DD をカンマ/改行区切りで複数可）
 *
 * NOTION_TOKEN / NOTION_VERSION / NOTION_RESERVATION_DB は NotionSync.gs と共有。
 * ----------------------------------------------------------------------
 */

// 占い師DB の Database ID（機密ではない）
const NOTION_TELLER_DB = '507fd75b0aa94c48a259d05b6b211ea4';

// 1枠の分数
const SLOT_MINUTES = 30;

/** 占い師の営業枠が未設定のときの既定値（＝とりあえず予約を受けられる状態） */
function DEFAULT_OPEN_() {
  return { days: ['日', '月', '火', '水', '木', '金', '土'], startHour: 10, endHour: 22, holidays: [] };
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** YYYY-MM-DD → 曜日（日〜土） */
function weekdayJa_(dateStr) {
  const p = dateStr.split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

/** 営業時間（時）から30分刻みの開始時刻リストを生成 */
function genSlots_(startHour, endHour) {
  const out = [];
  for (let t = startHour * 60; t + SLOT_MINUTES <= endHour * 60; t += SLOT_MINUTES) {
    out.push(pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60));
  }
  return out;
}

/**
 * 空き枠を返すメイン関数
 * @param {string} tellerPageId 占い師DBのページID（空なら「おまかせ」＝既定営業枠）
 * @param {string} date YYYY-MM-DD
 * @return {{slots:string[], closed?:boolean, reason?:string}}
 */
function getAvailableSlots(tellerPageId, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date の形式が不正です（YYYY-MM-DD）。');
  }

  const av = tellerPageId ? getTellerAvailability_(tellerPageId) : DEFAULT_OPEN_();

  // 休業日
  if (av.holidays.indexOf(date) !== -1) {
    return { slots: [], closed: true, reason: 'holiday' };
  }
  // 受付曜日外
  if (av.days.indexOf(weekdayJa_(date)) === -1) {
    return { slots: [], closed: true, reason: 'weekday' };
  }

  const base = genSlots_(av.startHour, av.endHour);
  const booked = tellerPageId ? getBookedTimes_(tellerPageId, date) : [];

  const todayJst = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const nowHm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm');

  const slots = base.filter(function (s) {
    if (booked.indexOf(s) !== -1) return false; // 既存予約
    if (date === todayJst && s <= nowHm) return false; // 当日の過去時刻
    return true;
  });

  return { slots: slots };
}

/** 占い師の営業枠を Notion 占い師DB のページから取得（未設定は既定値で補完） */
function getTellerAvailability_(pageId) {
  const token = getNotionToken_();
  const def = DEFAULT_OPEN_();
  if (!token) return def;

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return def;

  const p = (JSON.parse(res.getContentText()) || {}).properties || {};
  const days = ((p['受付曜日'] && p['受付曜日'].multi_select) || []).map(function (o) { return o.name; });
  const startHour =
    p['受付開始'] && typeof p['受付開始'].number === 'number' ? p['受付開始'].number : null;
  const endHour =
    p['受付終了'] && typeof p['受付終了'].number === 'number' ? p['受付終了'].number : null;
  const holidaysText = ((p['休業日'] && p['休業日'].rich_text) || [])
    .map(function (t) { return t.plain_text; })
    .join('');
  const holidays = holidaysText
    .split(/[,、\s]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); });

  return {
    days: days.length ? days : def.days,
    startHour: startHour !== null ? startHour : def.startHour,
    endHour: endHour !== null ? endHour : def.endHour,
    holidays: holidays,
  };
}

/** その占い師・その日の「予約済み時刻」一覧を Notion 鑑定予約DB から取得 */
function getBookedTimes_(tellerPageId, date) {
  const token = getNotionToken_();
  if (!token) return [];

  const res = UrlFetchApp.fetch(
    'https://api.notion.com/v1/databases/' + NOTION_RESERVATION_DB + '/query',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VERSION },
      payload: JSON.stringify({
        filter: {
          and: [
            { property: '希望占い師', relation: { contains: tellerPageId } },
            { property: '日付', date: { equals: date } },
            { property: 'ステータス', select: { does_not_equal: 'キャンセル' } },
          ],
        },
      }),
      muteHttpExceptions: true,
    }
  );
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) return [];

  const rows = (JSON.parse(res.getContentText()) || {}).results || [];
  return rows
    .map(function (r) {
      const t = r.properties && r.properties['時間'];
      return ((t && t.rich_text) || []).map(function (x) { return x.plain_text; }).join('');
    })
    .filter(function (s) { return /^\d{2}:\d{2}$/.test(s); });
}

/** 送信時の二重予約チェック用：その枠が既に埋まっているか */
function isSlotTaken_(tellerPageId, date, time) {
  if (!tellerPageId) return false; // おまかせは占い師確定後に調整
  return getBookedTimes_(tellerPageId, date).indexOf(time) !== -1;
}

/** 【動作確認用】空き枠を取得してログ出力 */
function testAvailability() {
  const date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const result = getAvailableSlots('', date); // 占い師おまかせ＝既定営業枠
  console.log(JSON.stringify(result));
}
