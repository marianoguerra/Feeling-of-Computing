// Timestamp formatting for message headers. Mirrors the role of the
// original conversations frontend's date.js, adapted to ISO `createdAt`.

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const pad = (n) => String(n).padStart(2, "0");

// "2026-06-23" — the local calendar date of `d` as a zero-padded YYYY-MM-DD
// string (matches the <input type="date"> / range-query format).
export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Jun 23, 07:37" — local time, deterministic format.
export function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
