// 日本語. Mirrors en.js. Japanese has a single CLDR plural category, so plural
// values carry only `other` — i18n:check treats plural leaves per-language.

export default {
  boot: {
    loading: 'アプリを読み込んでいます…',
    slow: '読み込み中です — 接続が遅いようです…',
    failed: 'YANTA を起動できませんでした。再読み込みしてください。',
    stage: {
      vault: 'ボルトを開いています…',
      notes: 'ノートを読み込んでいます…',
      workspace: 'ワークスペースを準備しています…',
      almost: 'まもなく完了します…',
    },
  },

  common: {
    save: '保存',
    cancel: 'キャンセル',
    close: '閉じる',
    done: '完了',
    delete: '削除',
    copy: 'コピー',
    back: '戻る',
    reset: 'リセット',
    continue: '続ける',
    maybeLater: 'あとで',
  },

  appShell: {
    searchPlaceholder: 'ノートを検索…（Ctrl+K）',
    toggleTheme: 'テーマを切り替え（T）',
    settings: '設定',
    status: {
      words: { other: '{count} 語' },
      chars: { other: '{count} 文字' },
      saved: '保存しました',
    },
  },

  settings: {
    language: {
      title: '言語',
      subtitle: 'YANTA のインターフェースを表示する言語を選びます。',
      label: '表示言語',
      hint: 'アプリ全体に適用されます。言語の切り替え時に YANTA が再読み込みされます。',
      matchSystem: 'システムに合わせる',
      changed: '言語を変更しました',
    },
  },

  onboarding: {
    chooser: {
      title: 'ノートの保存先を選んでください',
      subtitle: 'まずは出発点を選びましょう — あとから変更できます。',
      ariaLabel: 'ノートの保存先を選んでください',
      groupLabel: '保存先',
      footnote: '設定からいつでも変更できます — ノートはそのまま残ります。',
    },
    badge: {
      default: '既定',
      recommended: 'おすすめ',
      advanced: '上級者向け',
    },
    choices: {
      local: {
        title: 'この端末に保存',
        desc: 'アカウント不要、設定も不要。標準でプライベート — ノートがこの端末から出ることはありません。',
      },
      cloud: {
        title: 'YANTA Cloud',
        desc: 'すべての端末でエンドツーエンド暗号化して同期します。保存されるのは暗号化されたオブジェクトのみです。',
      },
      byo: {
        title: '自分の Google ドライブ',
        desc: '自分のストレージを使えます。暗号化された同期は、あなたが完全に管理する Drive フォルダーを通して行われます。',
      },
    },
    localToast: 'ノートはこの端末に保存されます。同期は設定からいつでも有効にできます。',
    openError: '同期の設定を開けませんでした。設定からいつでも有効にできます。',
    nudge: {
      title: 'ノートはこの端末に保存されています',
      subtitle: '同期を設定すると、すべての端末で使えます。エンドツーエンドで暗号化されます。',
      cta: '同期を設定',
      dismiss: '閉じる',
    },
  },
};
