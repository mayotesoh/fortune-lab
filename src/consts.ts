// サイト全体で使う共通定数

/** サイト名・キャッチ */
export const SITE_NAME = 'Fortune Lab';
export const SITE_NAME_JA = 'フォーチュンラボ';
export const SITE_TAGLINE = 'あなたの運命を照らす、オンライン占い館';

/**
 * 公式LINE 友だち追加・予約・相談リンク
 * 未設定（空文字）なら、LINE関連のボタンは表示されません。
 */
export const LINE_URL = '';

/** LINEボタンの既定ラベル */
export const LINE_LABEL = 'LINEで相談する';

/**
 * 予約データ送信先（Google Apps Script ウェブアプリURL）
 * Fortune Lab 用に新しく発行した GAS の /exec URL を設定してください。
 * gas/README.md のセットアップ手順を参照。
 * 未設定（空文字）の場合、予約フォームは送信できず案内メッセージを表示します。
 */
export const GAS_URL = '';

/**
 * LIFF ID（LINE Developers コンソールで発行）
 * 未設定（空文字）の場合は、LINE外からの利用とみなして
 * 名前を手入力する「Web予約モード」で動作します。
 */
export const LIFF_ID = '';

/** 鑑定メニュー（予約フォーム / 鑑定予約DBの「鑑定メニュー」と揃える） */
export const MENU_TYPES = [
  '対面鑑定',
  'オンライン鑑定',
  '電話鑑定',
  'チャット鑑定',
  'その他',
];
