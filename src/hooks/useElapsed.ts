import { useState, useEffect } from "react";

// 単一の1分間隔タイマーで経過時間を再描画（N-02: タスク毎タイマー禁止）
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => clearInterval(id);
  }, []);

  return now;
}
