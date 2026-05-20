import { useEffect, useState } from "react";
import type { HookInfo } from "../../lib/types";
import { getHookInfo } from "../../lib/ipc";
import { Button } from "../ui/Button";
import { showErrorToast } from "../../hooks/useTauriEvent";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [hookInfo, setHookInfo] = useState<HookInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    getHookInfo()
      .then(setHookInfo)
      .catch((err) => {
        console.error("getHookInfo failed:", err);
        showErrorToast("設定情報の取得に失敗しました");
      })
      .finally(() => setLoading(false));
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard API 不可の場合は無視
    }
  };

  const stopHookCmd = hookInfo
    ? `curl -s -X POST ${hookInfo.url} \\\n  -H "Authorization: Bearer ${hookInfo.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"event":"stop","workdir":"$(pwd)"}'`
    : "";

  const startHookCmd = hookInfo
    ? `curl -s -X POST ${hookInfo.url} \\\n  -H "Authorization: Bearer ${hookInfo.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"event":"start","workdir":"$(pwd)"}'`
    : "";

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="設定">
      <div className="settings-panel">
        <div className="settings-panel__header">
          <h3>設定 / Claude Code 連携</h3>
          <button className="settings-panel__close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        {loading && <div className="settings-panel__loading">読み込み中...</div>}

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
              <h4 className="settings-section__title">Claude Code Stop Hook 設定</h4>
              <p className="settings-section__desc">
                プロジェクトの <code>.claude/settings.json</code> に以下を追加します。
                AI が完了するとタスクが「進行中」に切り替わり、OS 通知が届きます。
              </p>

              <div className="settings-snippet">
                <div className="settings-snippet__label">Stop Hook（AI 完了 → 進行中に更新）</div>
                <pre className="settings-snippet__code">{stopHookCmd}</pre>
                <Button variant="ghost" size="sm" onClick={() => void copy(stopHookCmd, "stop")}>
                  {copied === "stop" ? "✓ コピー済み" : "コピー"}
                </Button>
              </div>

              <div className="settings-snippet">
                <div className="settings-snippet__label">Start Hook（AI 開始 → 待ちに更新）</div>
                <pre className="settings-snippet__code">{startHookCmd}</pre>
                <Button variant="ghost" size="sm" onClick={() => void copy(startHookCmd, "start")}>
                  {copied === "start" ? "✓ コピー済み" : "コピー"}
                </Button>
              </div>

              <div className="settings-snippet">
                <div className="settings-snippet__label">.claude/settings.json 例</div>
                <pre className="settings-snippet__code">{JSON.stringify(
                  {
                    hooks: {
                      Stop: [{ command: `curl -s -X POST ${hookInfo.url} -H "Authorization: Bearer ${hookInfo.token}" -H "Content-Type: application/json" -d '{"event":"stop","workdir":"$(pwd)"}'` }],
                    },
                  },
                  null,
                  2
                )}</pre>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
