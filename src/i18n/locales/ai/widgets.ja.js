// YANTA AI — チャットのインタラクティブウィジェット（日本語）。
// widgets.en.js と同じキー構造。t('ai.widgets.<path>') で使用。

export default {
  titles: {
    calculator: '計算機',
    chart: 'グラフ',
    table: '比較',
    checklist: 'チェックリスト',
    events: 'スケジュール',
    stats: '概要',
    progress: '進捗',
    steps: '手順',
    proscons: 'メリットとデメリット',
    choices: '1 つ選択',
    flashcards: '単語カード',
    timer: 'タイマー',
  },

  actions: {
    saveAsNote: 'ノートとして保存',
    noteTitleFallback: 'YANTA AI より',
  },

  toast: {
    saved: '「{title}」を保存しました',
    savedUntitled: 'ノートを保存しました',
    open: '開く',
    saveFailed: '保存できませんでした: {error}',
  },

  error: {
    notShown: 'このインタラクティブ表示を表示できませんでした',
    notBuilt: 'この表示を作成できませんでした。',
  },

  calculator: {
    yes: 'はい',
    no: 'いいえ',
  },

  chart: {
    seriesName: '系列 {n}',
    total: '合計',
  },

  table: {
    best: '最良',
  },

  events: {
    allDay: '終日',
    add: '追加',
    addToCalendar: 'カレンダーに追加',
    addAll: 'すべて追加',
    added: '追加済み',
    addFailed: '予定を追加できませんでした: {error}',
    allAdded: '予定をカレンダーに追加しました',
  },

  steps: {
    markDone: '完了にする',
  },

  proscons: {
    pros: 'メリット',
    cons: 'デメリット',
    verdictMarkdown: '**結論:** {verdict}',
  },

  flashcards: {
    flip: 'カードを裏返す',
    tapToFlip: 'タップして裏返す',
    question: '問題',
    answer: '答え',
    previous: '前へ',
    next: '次へ',
    shuffle: 'シャッフル',
    cardMarkdown: '**Q:** {front}\n**A:** {back}',
  },

  timer: {
    start: '開始',
    pause: '一時停止',
    resume: '再開',
    reset: 'リセット',
    minutes: { other: '{count} 分' },
    noteLine: 'タイマー: {duration}',
    timeUp: '{label}: 時間になりました',
    notificationBody: '時間になりました。',
  },
};
