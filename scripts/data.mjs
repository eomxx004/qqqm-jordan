// Yahoo Finance 일봉 종가를 받아 QQQM과 나스닥 종합지수(^IXIC)를 날짜별로 맞춘다.
const UA = { 'User-Agent': 'Mozilla/5.0' };

async function daily(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${symbol} 시세 요청 실패: ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: r.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map = new Map();
  r.timestamp.forEach((ts, i) => {
    const c = r.indicators.quote[0].close[i];
    if (c != null) map.set(fmt.format(new Date(ts * 1000)), c);
  });
  // 오늘 정규장 중이면 마지막 봉은 아직 확정되지 않은 현재가
  const reg = r.meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const today = reg ? fmt.format(new Date(reg.start * 1000)) : null;
  const open = !!reg && now >= reg.start && now < reg.end + 5 * 60;
  if (map.has(today) && r.meta.regularMarketPrice) map.set(today, r.meta.regularMarketPrice);
  return { map, open, today };
}

export async function loadMarket() {
  const [q, n] = await Promise.all([daily('QQQM'), daily('^IXIC')]);
  const bars = [...q.map.keys()].filter(d => n.map.has(d)).sort()
    .map(d => ({ date: d, close: q.map.get(d), ixic: n.map.get(d) }));
  const open = q.open && bars.at(-1)?.date === q.today;
  return { bars, open };
}

export async function loadBars() {
  const { bars, open } = await loadMarket();
  return open ? bars.slice(0, -1) : bars; // 확정된 종가만
}
