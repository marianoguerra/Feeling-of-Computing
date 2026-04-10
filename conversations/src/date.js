function cloneDate(d) {
  return new Date(d.getTime());
}

export function addDays(d0, dayOffset) {
  const d = cloneDate(d0);
  d.setDate(d.getDate() + dayOffset);
  return d;
}

export function dateIsLessThanDate(d1, d2) {
  return d1.getTime() < d2.getTime();
}

export function nowDayOffset(dayOffset) {
  const d = new Date();
  return addDays(d, dayOffset);
}

export function tomorrowDate() {
  return dateToDateString(nowDayOffset(1));
}

export function yesterdayDate() {
  return dateToDateString(nowDayOffset(-1));
}

export function dateDayOffset(offset) {
  return dateToDateString(nowDayOffset(offset));
}

function padZero(n) {
  const s = "" + n;
  return s.length === 1 ? "0" + s : s;
}

export function dateParts(d) {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function dateToDateString(d) {
  const [year, month, day] = dateParts(d);
  return `${year}-${padZero(month)}-${padZero(day)}`;
}
