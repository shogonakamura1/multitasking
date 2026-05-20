// 経過時間計算ユーティリティ

export function formatElapsed(updatedAt: number, now: number = Date.now()): string {
  const diffMs = now - updatedAt;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}時間前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}日前`;
}

export function formatWaiting(updatedAt: number, now: number = Date.now()): string {
  const diffMs = now - updatedAt;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "待ち中";
  if (diffMin < 60) return `${diffMin}分待ち`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}時間待ち`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}日待ち`;
}

// 長待ち警告しきい値: 30分
export const LONG_WAIT_THRESHOLD_MS = 30 * 60_000;
// 放置警告しきい値: 60分
export const STALE_THRESHOLD_MS = 60 * 60_000;

export function isLongWait(updatedAt: number, now: number = Date.now()): boolean {
  return now - updatedAt > LONG_WAIT_THRESHOLD_MS;
}

export function isStale(updatedAt: number, now: number = Date.now()): boolean {
  return now - updatedAt > STALE_THRESHOLD_MS;
}
