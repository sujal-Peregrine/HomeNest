export function getMonthBoundaries(year, month, dueDay=1) {
  // month: 1-12
  const start = new Date(Date.UTC(year, month-1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const d = Math.min(Math.max(dueDay,1),28);
  const dueDate = new Date(Date.UTC(year, month-1, d, 0,0,0));
  return { start, end, dueDate };
}
export function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000*60*60*24));
}
