import { useState, useEffect, useRef } from "react";

interface NextActionFieldProps {
  value: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export function NextActionField({ value, onChange, onBlur }: NextActionFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    onChange(draft);
    onBlur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setIsEditing(false);
    }
  };

  return (
    <div className="next-action-field">
      <div className="next-action-field__label">
        <span className="next-action-field__icon">→</span>
        次にやること
        <span className="next-action-field__hint">（最重要）</span>
      </div>
      {isEditing ? (
        <input
          ref={inputRef}
          className="next-action-field__input"
          value={draft}
          placeholder="復帰時にやること..."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div
          className={`next-action-field__display ${!value ? "next-action-field__display--empty" : ""}`}
          onClick={() => setIsEditing(true)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setIsEditing(true);
          }}
          role="button"
          aria-label="次にやることを編集"
        >
          {value || "（未設定 — クリックして入力）"}
        </div>
      )}
    </div>
  );
}
