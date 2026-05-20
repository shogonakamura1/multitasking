import { useEffect, useState } from "react";
import type { HookInfo } from "../../lib/types";
import { getHookInfo, getFocusDetection, setFocusDetection } from "../../lib/ipc";
import { Button } from "../ui/Button";
import { showErrorToast } from "../../hooks/useTauriEvent";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [hookInfo, setHookInfo] = useState<HookInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [focusEnabled, setFocusEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getHookInfo()
      .then(setHookInfo)
      .catch((err) => {
        console.error("getHookInfo failed:", err);
        showErrorToast("設定情報の取得に失敗しました");
      })
      .finally(() => setLoading(false));

    getFocusDetection()
      .then(setFocusEnabled)
      .catch((err) => {
        console.error("getFocusDetection failed:", err);
        // 取得失敗時もトグルを操作可能にする（既定 ON 前提）
        setFocusEnabled(true);
      });
  }, []);

  const toggleFocus = async () => {
    const next = !focusEnabled;
    setFocusEnabled(next);
    try {
      await setFocusDetection(next);
    } catch (err) {
      setFocusEnabled(!next);
      console.error("setFocusDetection failed:", err);
      showErrorToast("集中検知の切り替えに失敗しました");
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard API 不可の場合は無視
    }
  };

  // Claude Code hooks は標準入力に JSON（cwd / transcript_path 等）を渡すので python3 で読み取って転送する。
  // Stop 時に transcript（会話ログ）のパスを送り、サーバ側でローカルLLMが依頼＋応答からタスクを抽出する。
  const extractHookCmd = hookInfo
    ? `python3 -c 'import sys,json,urllib.request as u; d=json.load(sys.stdin); b=json.dumps({"event":"extract","workdir":d.get("cwd",""),"transcript":d.get("transcript_path","")}).encode(); u.urlopen(u.Request("${hookInfo.url}",data=b,headers={"Authorization":"Bearer ${hookInfo.token}","Content-Type":"application/json"}),timeout=2)'`
    : "";

  const settingsJson = hookInfo
    ? JSON.stringify(
        {
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: extractHookCmd }] }],
          },
        },
        null,
        2
      )
    : "";

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="settings-panel">
        <div className="settings-panel__header">
          <h3>設定 / Claude Code 連携</h3>
          <button className="settings-panel__close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        {loading && <div className="settings-panel__loading">読み込み中...</div>}

        <section className="settings-section">
          <h4 className="settings-section__title">集中先の自動検知（マウス直下）</h4>
          <p className="settings-section__desc">
            1秒ごとにマウスカーソル直下のウィンドウを調べ、取り組み中のプロジェクトを推定して
            カードを青く発光させます。Chrome などのタブ名はローカル LLM（Ollama）で推定します。
            <br />
            <strong>※ タブ名の取得には macOS の「画面収録」権限が必要</strong>です
            （システム設定 &gt; プライバシーとセキュリティ &gt; 画面収録 で multitasking を許可）。
            LLM 推定には <code>ollama serve</code> の起動とモデル取得が必要です。
          </p>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={focusEnabled ?? false}
              onChange={() => void toggleFocus()}
              disabled={focusEnabled === null}
            />
            集中先の自動検知を有効にする
          </label>
        </section>

        {hookInfo && (
          <>
            <section className="settings-section">
              <h4 className="settings-section__title">Hook 接続情報</h4>
              <div className="settings-field">
                <label className="settings-field__label">URL</label>
                <div className="settings-field__row">
                  <code className="settings-field__value">{hookInfo.url}</code>
                  <Button variant="ghost" size="sm" onClick={() => void copy(hookInfo.url, "url")}>
                    {copied === "url" ? "✓" : "コピー"}
                  </Button>
                </div>
              </div>
              <div className="settings-field">
                <label className="settings-field__label">トークン</label>
                <div className="settings-field__row">
                  <code className="settings-field__value settings-field__value--masked">
                    {hookInfo.token.slice(0, 8)}••••••••
                  </code>
                  <Button variant="ghost" size="sm" onClick={() => void copy(hookInfo.token, "token")}>
                    {copied === "token" ? "✓" : "コピー"}
                  </Button>
                </div>
              </div>
              <div className="settings-field">
                <label className="settings-field__label">ポート</label>
                <code className="settings-field__value">{hookInfo.port}</code>
              </div>
            </section>

            <section className="settings-section">
              <h4 className="settings-section__title">Claude Code 連携（LLMでタスク自動抽出）</h4>
              <p className="settings-section__desc">
                プロジェクトの <code>.claude/settings.json</code> に下の JSON を貼り付けます。
                <br />
                <strong>Stop</strong>（AI が応答を終えたタイミング）で、その回の
                <strong>あなたの依頼とAIの応答</strong>を会話ログから読み取り、
                ローカル LLM（<code>qwen2.5:1.5b</code>）が<strong>やるべきタスクを抽出</strong>して
                自動追加します（作業ディレクトリに対応するプロジェクトへ。無ければフォルダ名で自動作成）。
                <br />
                ※ 標準入力の JSON（cwd・transcript_path）を読むため <code>python3</code>（macOS 標準）を使用します。
                <br />
                ※ 抽出には <code>ollama serve</code> の起動が必要です（未起動なら何も追加されません）。
              </p>

              <div className="settings-snippet">
                <div className="settings-snippet__label">.claude/settings.json（プロジェクト直下）</div>
                <pre className="settings-snippet__code">{settingsJson}</pre>
                <Button variant="ghost" size="sm" onClick={() => void copy(settingsJson, "settings")}>
                  {copied === "settings" ? "✓ コピー済み" : "コピー"}
                </Button>
              </div>

              <div className="settings-snippet">
                <div className="settings-snippet__label">Stop コマンド単体（依頼＋応答からタスク抽出）</div>
                <pre className="settings-snippet__code">{extractHookCmd}</pre>
                <Button variant="ghost" size="sm" onClick={() => void copy(extractHookCmd, "extract")}>
                  {copied === "extract" ? "✓ コピー済み" : "コピー"}
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
