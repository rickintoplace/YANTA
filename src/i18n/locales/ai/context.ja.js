// YANTA AI — コンテキストピッカーとコンテキストメーター（日本語）。
// context.en.js と同じキー構造。t('ai.context.<path>') で使用。

export default {
  picker: {
    title: 'AI コンテキストに追加',
    close: '閉じる',
    tabsLabel: 'AI コンテキストの取得元',
    tabs: {
      notes: 'ノート',
      folders: 'フォルダー',
      events: '予定',
      upload: 'アップロード',
    },
    searchPlaceholder: '検索…',
    searchLabel: 'AI コンテキストを検索',
    noResults: '結果がありません。',
    untitledNote: '無題',
    untitledFolder: 'フォルダー',
    untitledEvent: 'タイトルなしの予定',
    home: 'ホーム',
    uploadTitle: 'ファイルを AI コンテキストとしてアップロード',
    uploadHint: 'テキスト、Markdown、JSON、CSV、PDF、DOCX、画像に対応しています。画像は WEBP に圧縮されます。',
    pickFiles: 'ファイルを選択',
    added: 'AI コンテキストに追加しました',
    addedUploads: {
      other: '{count} 件のアップロードを AI コンテキストに追加しました',
    },
  },
  meter: {
    tokens: '約 {count} トークン',
    words: { other: '{count} 語' },
    chars: { other: '{count} 文字' },
    items: { other: 'コンテキスト項目 {count} 件' },
    images: { other: '画像 {count} 件' },
    audio: { other: '音声 {count} 件' },
    unsupported: '非対応 {count} 件',
    messages: { other: '{count} 件のメッセージ' },
    titleEstimated: '推定合計: 約 {tokens} トークン',
    titleTotal: '合計: {words} 語 · {chars} 文字',
    titleHistory: '履歴: {messages} 件のメッセージ · {words} 語 · {chars} 文字',
    titleAttached: '添付したコンテキスト: {items} 件 · {words} 語 · {chars} 文字',
    titleImages: '画像: {count}',
    titleAudio: '音声: {count}',
    titleUnsupported: '非対応: {count}',
    titleNote: 'トークン数はローカルでの推定値です。正確なトークン数はモデルによって異なります。',
  },
};
