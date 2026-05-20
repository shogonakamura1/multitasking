import { useCallback, useRef } from "react";
import type { KeyboardEvent } from "react";

/**
 * 日本語IMEの「変換確定 Enter」を誤って確定アクションに使わないためのガード。
 *
 * macOS の WKWebView(WebKit) では、変換確定の Enter が
 * `isComposing === false` / `keyCode === 13` で飛んでくることがあり、
 * `isComposing` チェックだけでは防げない。そこで:
 *  - `isComposing` / `keyCode === 229`（IME処理中）に加えて
 *  - `compositionend` 直後（数十ms以内）の Enter も変換確定とみなして無視する。
 *
 * 変換確定の Enter は compositionend と同じイベントループで来るため、
 * しきい値内であれば確実に区別できる。確定後に改めて押す Enter は
 * 反応時間的にしきい値を超えるので通常の確定として通る。
 */
const IME_ENTER_WINDOW_MS = 120;

export function useCompositionGuard() {
  const lastCompositionEnd = useRef(0);

  const onCompositionEnd = useCallback(() => {
    lastCompositionEnd.current = Date.now();
  }, []);

  /** この Enter が IME 変換確定由来なら true（＝確定アクションを実行しない）。 */
  const isImeEnter = useCallback((e: KeyboardEvent): boolean => {
    return (
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      Date.now() - lastCompositionEnd.current < IME_ENTER_WINDOW_MS
    );
  }, []);

  return { onCompositionEnd, isImeEnter };
}
