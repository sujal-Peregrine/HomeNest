import { daysBetween } from "./dates.js";
export function computePenalty({amount, dueDate, graceDays=15, mode="flatPerDay", rate=0, asOf=new Date()}){
  const graceEnd = new Date(dueDate.getTime());
  graceEnd.setUTCDate(graceEnd.getUTCDate() + (graceDays||0));
  const overdueDays = Math.max(0, daysBetween(graceEnd, asOf));
  if (overdueDays <= 0) return 0;
  if (mode === "percentPerDay") return Math.floor(amount * (rate/100) * overdueDays);
  return Math.floor((rate||0) * overdueDays);
}
