import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useBoardStore } from "../store/boardStore";
import type { AiCompletedPayload, FocusPayload } from "../lib/types";

export interface Toast {
  id: string;
  message: string;
  highlightTaskId?: string | null;
}

type ToastCallback = (toast: Toast) => void;

let toastCallback: ToastCallback | null = null;

export function registerToastCallback(cb: ToastCallback) {
  toastCallback = cb;
}

/** ユーザー向けエラートーストを表示する（WARN#3）*/
export function showErrorToast(message: string) {
  if (toastCallback) {
    toastCallback({ id: `err_${Date.now()}`, message });
  }
}

export function useTauriEvent() {
  const fetchBoard = useBoardStore((s) => s.fetchBoard);
  const setFocus = useBoardStore((s) => s.setFocus);

  useEffect(() => {
    let unlistenBoardChanged: (() => void) | null = null;
    let unlistenAiCompleted: (() => void) | null = null;
    let unlistenFocusChanged: (() => void) | null = null;

    const setup = async () => {
      unlistenBoardChanged = await listen("board_changed", () => {
        void fetchBoard();
      });

      unlistenFocusChanged = await listen<FocusPayload>("focus_changed", (event) => {
        setFocus(event.payload.projectId, event.payload.taskId);
      });

      unlistenAiCompleted = await listen<AiCompletedPayload>(
        "ai_completed",
        (event) => {
          const { projectName, taskTitle, taskId } = event.payload;
          const message = taskTitle
            ? `✓ ${projectName}: ${taskTitle} が完了しました`
            : `✓ ${projectName} の AI が完了しました`;

          if (toastCallback) {
            toastCallback({
              id: `ai_${Date.now()}`,
              message,
              highlightTaskId: taskId,
            });
          }

          void fetchBoard();
        }
      );
    };

    void setup();

    return () => {
      unlistenBoardChanged?.();
      unlistenAiCompleted?.();
      unlistenFocusChanged?.();
    };
  }, [fetchBoard, setFocus]);
}
