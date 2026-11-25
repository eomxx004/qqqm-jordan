// Yahoo Finance 일봉 종가를 받아 QQQM과 나스닥 종합지수(^IXIC)를 날짜별로 맞춘다.
const UA = { 'User-Agent': 'Mozilla/5.0' };

async function daily(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=9999999999&interval=1d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${symbol} 시세 요청 실패: ${res.status}`);
  const r = (await res.json()).chart.result[0];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: r.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map = new Map(), lows = new Map();
  const qt = r.indicators.quote[0];
  r.timestamp.forEach((ts, i) => {
    const c = qt.close[i], d = fmt.format(new Date(ts * 1000));
    if (c != null) { map.set(d, c); lows.set(d, Math.min(qt.low[i] ?? c, c)); }
  });
  // 오늘 정규장 중이면 마지막 봉은 아직 확정되지 않은 현재가
  const reg = r.meta.currentTradingPeriod?.regular;
  const now = Date.now() / 1000;
  const today = reg ? fmt.format(new Date(reg.start * 1000)) : null;
  const open = !!reg && now >= reg.start && now < reg.end + 5 * 60;
  if (map.has(today) && r.meta.regularMarketPrice) {
    const p = r.meta.regularMarketPrice;
    map.set(today, p);
    lows.set(today, Math.min(lows.get(today) ?? p, r.meta.regularMarketDayLow ?? p, p));
  }
  return { map, lows, open, today };
}

export async function loadMarket() {
  const [q, n] = await Promise.all([daily('QQQM'), daily('^IXIC')]);
  const bars = [...q.map.keys()].filter(d => n.map.has(d)).sort()
    .map(d => ({ date: d, close: q.map.get(d), low: q.lows.get(d), ixic: n.map.get(d) }));
  const open = q.open && bars.at(-1)?.date === q.today;
  return { bars, open };
}

// 시장 지표: 최근 두 거래일 값으로 현재값·일간 변화 계산
export const INDICATORS = [
  { key: 'ixic', symbol: '^IXIC', name: '나스닥 종합' },
  { key: 'spx', symbol: '^GSPC', name: 'S&P 500' },
  { key: 'tnx', symbol: '^TNX', name: '미국채 10년' },
  { key: 'gold', symbol: 'GC=F', name: '금 ($/oz)' },
  { key: 'krw', symbol: 'KRW=X', name: '원/달러' },
];

export async function loadIndicators() {
  const out = {};
  await Promise.all(INDICATORS.map(async ({ key, symbol, name }) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d`;
      const r = (await (await fetch(url, { headers: UA })).json()).chart.result[0];
      const closes = r.indicators.quote[0].close.filter(c => c != null);
      const price = r.meta.regularMarketPrice ?? closes.at(-1);
      // 오늘 봉이 있으면 그 전날 종가가 기준, 없으면 마지막 종가가 기준
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: r.meta.exchangeTimezoneName });
      const lastDate = fmt.format(new Date(r.timestamp.at(-1) * 1000));
      const priceDate = fmt.format(new Date(r.meta.regularMarketTime * 1000));
      const prev = lastDate === priceDate ? closes.at(-2) : closes.at(-1);
      out[key] = { name, price, prev, chg: (price / prev - 1) * 100, diff: price - prev, date: priceDate };
    } catch (e) { console.error(`${symbol} 지표 실패`, e.message); }
  }));
  return out;
}

export async function loadBars() {
  const { bars, open } = await loadMarket();
  return open ? bars.slice(0, -1) : bars; // 확정된 종가만
}
