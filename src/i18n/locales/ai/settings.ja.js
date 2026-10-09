// AI 設定パネルと AI アクセスポリシーの文字列（日本語）。
// settings.en.js と同じキー構造。t('ai.settings.<path>') で使用。

export default {
  access: {
    label: 'AI アクセス',
    included: 'Included AI: YANTA Cloud クレジット',
    byok: 'BYOK: 自分の OpenRouter キー',
    includedModel: 'Included AI モデル',
    provider: 'プロバイダー',
    baseUrl: 'ベース URL',
    model: 'モデル',
    keyStorage: 'API キーの保存方法',
    keyStorageSession: 'セッション中のみ',
    keyStorageLocal: 'この端末に記憶（localStorage）',
    keyStorageNone: '保存しない',
    apiKey: 'OpenRouter API キー',
    clearKey: 'キーを消去',
  },

  privacy: {
    label: 'プライバシー',
    currentNote: '現在のノートを含める',
    metadataOnly: 'メタデータのみ',
  },

  thinking: {
    label: '思考',
    off: 'オフ · 最速、予算の大半を回答に使います',
    low: '低 · 実行前に短い計画を立てます',
    medium: '中 · 難しいタスク向け、遅く費用も高めです',
  },

  citations: {
    label: '引用の確認',
    check: '確認 · ウェブページ・記事・ノートからの引用をすべて元の内容と照合します',
    revise: '確認して修正 · 不合格の引用を一度だけモデルに差し戻します',
    off: 'オフ · 引用ルールなし、確認なし',
  },

  includedLimits: {
    heading: 'Included AI の上限',
    body: 'Included AI は YANTA Cloud が管理するクレジットを使用します。YANTA が承認したモデルから 1 つを選べます。コンテキストサイズ、出力サイズ、1 日あたりのクレジット、レート制限は、不正利用防止のため YANTA Cloud が管理します。',
    current: '現在のクライアント側の上限: コンテキスト {context} 文字、ツールラウンド {rounds} 回、最大出力 {output} トークン。',
  },

  byokLimits: {
    heading: 'BYOK の詳細な上限',
    maxContext: '最大コンテキスト文字数',
    maxToolRounds: '最大ツールラウンド数',
    body: 'BYOK ではご自身の OpenRouter キーを使用します。モデル、ベース URL、上限は自由に設定できます。',
  },

  badges: {
    recommended: '推奨',
    optional: '任意',
  },

  permissions: {
    heading: '権限',
    readNotes: 'アシスタントにノートの読み取りを許可',
    createNotes: 'アシスタントにノートの作成を許可',
    editNotes: 'アシスタントにノートの編集を許可',
    deleteNotes: 'アシスタントにノートの削除を許可',
    manageCalendar: 'アシスタントにカレンダーの予定の管理を許可',
    readAiBrain: 'アシスタントに AI Brain の読み取りを許可',
    writeAiBrain: 'アシスタントに AI Brain への書き込みを許可',
    weather: 'アシスタントに Open-Meteo 経由での天気の取得を許可',
    webSearch: 'アシスタントにウェブ検索を許可',
    approxLocation: 'アシスタントにおおよその位置情報の受け取りを許可',
    readRss: 'アシスタントにソース／RSS 項目の読み取りを許可',
    manageRss: 'アシスタントにソースの更新・管理を許可',
    addRssSources: 'アシスタントに RSS フィードと YouTube チャンネルのソースへの追加を許可',
    saveRssToNotes: 'アシスタントにソースの項目をノートとして保存することを許可',
    readChat: 'アシスタントにチャットメッセージの読み取りを許可',
    sendChat: 'アシスタントに確認後のチャットメッセージ送信を許可',
    sendChatAutonomous: 'アシスタントに確認なしでのチャットメッセージ送信を許可',
  },

  location: {
    heading: 'おおよその位置情報',
    intro: '「ここの天気」のような天気の質問に使われます。正確な位置の代わりに、市区町村、地域、郵便番号を入力してください。',
    stored: '保存済み:',
    none: 'おおよその位置情報は保存されていません。',
    placeLabel: '市区町村、地域、郵便番号',
    placePlaceholder: '例: 東京, 100-0001, 10001, SW1A 1AA',
    countryLabel: '国コード（任意）',
    searching: '場所を検索しています…',
    resultFallback: '場所',
    find: '候補を検索',
    saveBest: '最も近い候補を保存',
    clear: '位置情報を消去',
    enterQuery: '市区町村、地域、郵便番号を入力してください',
    saved: 'おおよその位置情報を保存しました',
    cleared: 'おおよその位置情報を消去しました',
    notFound: '場所が見つかりませんでした',
    saveFailed: '位置情報を保存できませんでした',
  },

  externalAgents: {
    heading: '外部エージェント',
    allow: '外部 AI エージェントの接続を許可',
    enabled: '有効',
    disabled: '無効',
    bridgeUrl: 'ローカルブリッジ URL',
    token: 'セッショントークン',
    connected: 'ローカルブリッジに接続済み',
    notConnected: '未接続',
    hidden: '外部エージェントのアクセスが無効のため、ブリッジの設定は非表示になっています。有効にすると、ブリッジ URL、トークン、権限、セットアップ用テキストが表示されます。',
    copySetup: 'セットアップ用テキストをコピー',
    regenerateToken: 'トークンを再生成',
    disconnect: '切断',
    connect: '接続',
    setupCopied: '外部エージェントのセットアップ用テキストをコピーしました',
    tokenRegenerated: '外部エージェントのトークンを再生成しました',
    bridgeConnected: '外部エージェントのブリッジに接続しました',
    connectFailed: 'ブリッジに接続できませんでした',
    disconnected: '外部エージェントを切断しました',
    permissions: {
      readNotes: '外部エージェントにノートの読み取りを許可',
      createNotes: '外部エージェントにノートの作成を許可',
      editNotes: '外部エージェントにノートの編集を許可',
      deleteNotes: '外部エージェントにノートの削除を許可',
      manageCalendar: '外部エージェントにカレンダーの予定の管理を許可',
    },
  },

  advanced: '詳細オプション',

  prompt: {
    heading: 'アシスタントのプロンプト',
    reset: 'デフォルトに戻す',
    resetDone: 'アシスタントのプロンプトをリセットしました',
  },

  privacyNote: {
    zdrEnabled: '{label} が有効です。',
    includedTitle: 'Included AI のプライバシーについて:',
    includedBody: 'プロンプトと選択したコンテキストは、ZDR を有効にした OpenRouter へ転送する目的に限り、YANTA Cloud で一時的に処理されます。YANTA はプロンプト、生成結果、ツールの結果をサーバーに保存しません。暗号化された同期ボルトはゼロ知識のままです。',
    byokTitle: 'BYOK のプライバシーについて:',
    byokBody: 'API キーはこのブラウザ内にとどまります。プロンプトと選択したコンテキストは、ZDR を有効にした OpenRouter に直接送信されます。localStorage への永続保存は便利ですが、セッション中のみの保存より安全性が低くなります。',
  },

  save: 'AI 設定を保存',
  saved: 'AI 設定を保存しました',
  keyCleared: 'AI キーを消去しました',
  copyFailed: 'コピーに失敗しました',
  includedEnabled: 'YANTA Cloud クレジットで Included AI を有効にしました',

  policy: {
    includedModelLabel: 'YANTA Cloud クレジット',
    zdrDescription: 'YANTA は OpenRouter に Zero Data Retention（データ保持ゼロ）ルーティングを要求します。プロンプトは Zero Data Retention ポリシーを持つエンドポイントにのみ送られます。',
    syncInactive: 'この端末では YANTA Cloud Sync が有効になっていません。',
    signIn: '先に YANTA Cloud にサインインしてください。',
    notOnPlan: '現在のプランでは Included AI を利用できません。',
    verifyFailed: 'YANTA Cloud の状態を確認できませんでした。',
  },
  // Short descriptions in the included-model menu, by model id
  // (non-alphanumerics → _). Unknown models show the server's text.
  modelHints: {
    deepseek_deepseek_v4_1_flash: '高速でツール操作が安定。おすすめ。',
    xiaomi_mimo_v2_6_flash: '同クラスで最高のツール操作、画像も読めます。やや低速。',
    z_ai_glm_5_3_flash: '高性能でとても経済的。常に先に考えるため、応答に数秒かかります。',
    xiaomi_mimo_v2_6_pro: '最も高性能なオープンモデル。クレジットを約 3 倍消費します。',
    google_gemini_3_1_flash_lite: 'PDF と画像に最適。',
  },
};
