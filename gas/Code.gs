/**
 * Fortune Lab ─ 鑑定予約受付 Google Apps Script（フォーム処理）
 * ----------------------------------------------------------------------
 * サイトの予約フォーム / LIFF からの JSON（text/plain）を受け取り、
 *   (1) Google スプレッドシートに1行追記
 *   (2) Notion「Fortune Lab 鑑定予約DB」に1ページ作成（NotionSync.gs）
 * します。
 *
 * スプレッドシートの列:
 *   受付日時 | 予約者 | userId | メール | 電話番号 | 希望占い師 | 鑑定メニュー | 日付 | 時間 | 備考
 * ----------------------------------------------------------------------
 */

// 予約データを書き込むスプレッドシートID（新規作成して貼り付けてください）
const SPREADSHEET_ID = 'ここに予約用スプレッドシートのIDを貼り付け';

// 見出し行
const HEADERS = [
  '受付日時',
  '予約者',
  'userId',
  'メール',
  '電話番号',
  '希望占い師',
  '鑑定メニュー',
  '日付',
  '時間',
  '備考',
];

/**
 * POST エントリーポイント
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('リクエストボディが空です。');
    }
    const data = JSON.parse(e.postData.contents);
    return handleFormReservation(data);
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

/**
 * サイトフォーム / LIFF からの予約を処理
 */
function handleFormReservation(data) {
  const r = {
    userName: (data.userName || '').toString(),
    userId: (data.userId || '').toString(),
    email: (data.email || '').toString(),
    phone: (data.phone || '').toString(),
    tellerPageId: (data.tellerPageId || '').toString(),
    tellerName: (data.tellerName || '').toString(),
    menu: (data.menu || '').toString(),
    date: (data.date || '').toString(),
    time: (data.time || '').toString(),
    note: (data.note || '').toString(),
  };

  // 必須チェック
  if (!r.userId || !r.menu || !r.date || !r.time) {
    throw new Error('必須項目が不足しています（userId / menu / date / time）。');
  }
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
    throw new Error('メールアドレスの形式が不正です。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    throw new Error('date の形式が不正です（YYYY-MM-DD）。');
  }
  if (!/^\d{2}:\d{2}$/.test(r.time)) {
    throw new Error('time の形式が不正です（HH:MM）。');
  }

  appendReservation(r);
  return jsonOutput({ status: 'success' });
}

/**
 * 予約1行をスプレッドシートに追記し、Notionにも同期
 */
function appendReservation(r) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 二重予約チェック（ロック内で確認 → 同期まで済ませてから解放）
    if (isSlotTaken_(r.tellerPageId, r.date, r.time)) {
      throw new Error(
        '申し訳ありません。その時間はちょうど予約が入りました。別の時間をお選びください。'
      );
    }

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    }
    sheet.appendRow([
      new Date(),
      r.userName || '',
      r.userId || '',
      r.email || '',
      r.phone || '',
      r.tellerName || '',
      r.menu || '',
      r.date || '',
      r.time || '',
      r.note || '',
    ]);

    // Notion「鑑定予約DB」にも同期（失敗してもスプシ記録は成立させる）。
    // ロック内で同期し、次の予約の空き枠チェックに反映されるようにする。
    try {
      syncReservationToNotion(r); // NotionSync.gs
    } catch (err) {
      console.error('Notion同期に失敗しました: ' + (err && err.message ? err.message : err));
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * 【1回だけ手動実行】既存シートを見出し付きで作り直す。
 * ※ 既存データはすべて消えます。テスト行を消したいときに。
 */
function resetHeaders() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0];
  sheet.clear();
  sheet.appendRow(HEADERS);
}

/**
 * GET エントリーポイント
 *   ?action=slots&teller=<占い師ページID>&date=YYYY-MM-DD … 空き枠を返す
 *   （それ以外）… 動作確認メッセージ
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'slots') {
      const result = getAvailableSlots(
        (params.teller || '').toString(),
        (params.date || '').toString()
      );
      return jsonOutput({ status: 'success', slots: result.slots, closed: !!result.closed });
    }
    return jsonOutput({ status: 'ok', message: 'Fortune Lab 予約API は稼働中です。' });
  } catch (err) {
    return jsonOutput({
      status: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
}

/** JSON レスポンス共通関数 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
