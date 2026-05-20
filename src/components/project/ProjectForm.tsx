import { useState } from "react";
import type { Project, ProjectColor, CreateProjectInput } from "../../lib/types";
import { useBoardStore } from "../../store/boardStore";
import { useCompositionGuard } from "../../hooks/useCompositionGuard";
import { Button } from "../ui/Button";

const COLORS: { key: ProjectColor; label: string }[] = [
  { key: "blue",   label: "青" },
  { key: "green",  label: "緑" },
  { key: "red",    label: "赤" },
  { key: "amber",  label: "橙" },
  { key: "purple", label: "紫" },
  { key: "slate",  label: "灰" },
];

interface ProjectFormProps {
  project?: Project; // 既存プロジェクトの編集
  onClose: () => void;
}

export function ProjectForm({ project, onClose }: ProjectFormProps) {
  const createProject = useBoardStore((s) => s.createProject);
  const updateProject = useBoardStore((s) => s.updateProject);
  const deleteProject = useBoardStore((s) => s.deleteProject);

  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<string>(project?.color ?? "blue");
  const [workdir, setWorkdir] = useState(project?.workdir ?? "");
  const [status, setStatus] = useState(project?.status ?? "active");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const guard = useCompositionGuard();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (project) {
        await updateProject({
          ...project,
          name: name.trim(),
          color,
          workdir: workdir.trim() || null,
          status,
        });
      } else {
        const input: CreateProjectInput = {
          name: name.trim(),
          color,
          status,
          workdir: workdir.trim() || null,
        };
        await createProject(input);
      }
      onClose();
    } catch (err) {
      console.error("ProjectForm submit error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Tauri の WebView では window.confirm が効かないため、アプリ内の2段階確認にする
  const handleDelete = async () => {
    if (!project) return;
    setSubmitting(true);
    try {
      await deleteProject(project.id);
      onClose();
    } catch (err) {
      console.error("deleteProject error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="project-form-overlay" role="dialog" aria-modal="true" aria-label="プロジェクト設定">
      <form className="project-form" onSubmit={handleSubmit}>
        <div className="project-form__header">
          <h3>{project ? "プロジェクトを編集" : "プロジェクトを作成"}</h3>
          <button type="button" className="project-form__close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="proj-name">名前</label>
          <input
            id="proj-name"
            className="project-form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onCompositionEnd={guard.onCompositionEnd}
            onKeyDown={(e) => {
              // IME 変換確定の Enter でフォーム送信しない
              if (e.key === "Enter" && guard.isImeEnter(e)) {
                e.preventDefault();
              }
            }}
            placeholder="プロジェクト名"
            required
            autoFocus
          />
        </div>

        <div className="project-form__field">
          <label className="project-form__label">色</label>
          <div className="project-form__colors">
            {COLORS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`color-swatch color-swatch--${key} ${color === key ? "color-swatch--selected" : ""}`}
                onClick={() => setColor(key)}
                title={label}
                aria-label={label}
                aria-pressed={color === key}
                style={{ background: `var(--proj-${key})` }}
              />
            ))}
          </div>
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="proj-workdir">作業ディレクトリ（Claude Code hooks 用）</label>
          <input
            id="proj-workdir"
            className="project-form__input project-form__input--mono"
            value={workdir}
            onChange={(e) => setWorkdir(e.target.value)}
            placeholder="/path/to/project"
          />
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="proj-status">ステータス</label>
          <select
            id="proj-status"
            className="project-form__select"
            value={status}
            onChange={(e) => setStatus(e.target.value as Project["status"])}
          >
            <option value="active">アクティブ</option>
            <option value="paused">一時停止</option>
            <option value="done">完了</option>
          </select>
        </div>

        {project && confirmingDelete && (
          <div className="project-form__confirm">
            <span className="project-form__confirm-msg">
              「{project.name}」を削除しますか？（タスクも削除されます）
            </span>
            <div className="project-form__confirm-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={submitting}>
                やめる
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={() => void handleDelete()} disabled={submitting}>
                {submitting ? "削除中..." : "削除する"}
              </Button>
            </div>
          </div>
        )}

        <div className="project-form__actions">
          {project && !confirmingDelete && (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmingDelete(true)} disabled={submitting}>
              削除
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={submitting || !name.trim()}>
            {submitting ? "保存中..." : project ? "保存" : "作成"}
          </Button>
        </div>
      </form>
    </div>
  );
}
