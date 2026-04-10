export const pad = (n) => String(n).padStart(2, "0");

export async function walk(fetcher, fromDate, toDate, cb) {
  const fromYear = fromDate.getUTCFullYear();
  const fromMonth = fromDate.getUTCMonth() + 1;
  const fromDay = fromDate.getUTCDate();
  const toYear = toDate.getUTCFullYear();
  const toMonth = toDate.getUTCMonth() + 1;
  const toDay = toDate.getUTCDate();

  const root = await fetcher.fetchRootIndex();

  for (const year of root.entries) {
    if (year > toYear) break;
    if (year < fromYear) continue;

    const yearIndex = await fetcher.fetchYearIndex(year);
    const monthLo = year === fromYear ? fromMonth : 1;
    const monthHi = year === toYear ? toMonth : 12;

    for (const month of yearIndex.entries) {
      if (month > monthHi) break;
      if (month < monthLo) continue;

      const monthIndex = await fetcher.fetchMonthIndex(year, month);
      const dayLo = year === fromYear && month === fromMonth ? fromDay : 1;
      const dayHi = year === toYear && month === toMonth ? toDay : 31;

      for (const day of monthIndex.entries) {
        if (day > dayHi) break;
        if (day < dayLo) continue;

        const data = await fetcher.fetchDay(year, month, day);
        await cb(data, { year, month, day });
      }
    }
  }
}

export function httpFetcher(basePath) {
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json();
  }
  return {
    fetchUsers: () => fetchJson(`${basePath}/users.json`),
    fetchChannels: () => fetchJson(`${basePath}/channels.json`),
    fetchRootIndex: () => fetchJson(`${basePath}/index.json`),
    fetchYearIndex: (year) => fetchJson(`${basePath}/${year}/index.json`),
    fetchMonthIndex: (year, month) => fetchJson(`${basePath}/${year}/${pad(month)}/index.json`),
    fetchDay: (year, month, day) => fetchJson(`${basePath}/${year}/${pad(month)}/${pad(day)}.json`),
  };
}
