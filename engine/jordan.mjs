// 조던 룰(마삼룰) 계산 엔진 — QQQM 전용, 금리 일반 모드
// 브라우저와 Node 양쪽에서 쓰는 순수 함수 모듈. 상장일부터 전체 기록을 다시 돌려 오늘 상태를 계산한다.

export const DEFAULTS = {
  rebalStep: 2.5,      // 1단계: 전고점 대비 -2.5%마다
  rebalUnit: 10,       //        주식 10%p 매도 (처음 기준)
  stakeStep: 5,        // 2단계 말뚝박기: 전고점 대비 -5%마다
  stakeUnit: 10,       //        주식 10%p 매수 (-50%에서 100%)
  mamsam: -3,          // 나스닥 종합지수 전일 대비 -3% 이하 = 마삼
  upStreak: 8,         // 나스닥 종합지수 8거래일 연속 상승 → 전량 매수
  vZones: 2,           // 최저 구간 대비 2구간 반등 → 전량 매수
  panicCount: 4,       // 최근 1개월 안에 마삼 4회 → 공황
  panicWaitMonths: 2,  // 마지막 마삼 후 2개월 + 1일
  panicWaitDays: 1,
  panicAllowsOtherExits: true,  // 공황 대기 중에도 V자 반등/8일 연속 상승이면 전량 매수 (사용자 확정)
};

const EPS = 1e-9;
const zoneOf = (dd, step) => Math.max(0, Math.floor(dd / step + EPS));
const priceAt = (ath, pct) => ath * (1 - pct / 100);

// 'YYYY-MM-DD'에 m개월 + d일을 더한다. 말일 넘침은 그 달 말일로 맞춘다.
export function addMonthsDays(date, m, d) {
  const [y, mo, da] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo - 1 + m + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(y, mo - 1 + m, Math.min(da, last) + d));
  return dt.toISOString().slice(0, 10);
}

export function initialState() {
  return {
    ath: 0, athDate: null,
    mode: 'HOLD',          // HOLD(주식 100%) | REBAL(1단계 현금화) | STAKE(2단계 말뚝박기)
    stock: 100,            // 목표 주식 비중 %
    anchorZone: 0,         // 1단계 기준 구간 (재진입한 구간; 전고점에서 시작하면 0)
    maxDD: 0,              // 이번 국면의 최대 하락률 % (종가)
    upStreak: 0,
    mamsamDates: [],
    panic: false, panicUntil: null,
    lastIxic: null,
  };
}

// 하루치 종가를 넣어 상태를 갱신하고 그날의 신호를 돌려준다.
// bar = { date:'YYYY-MM-DD', close: QQQM 종가, ixic: 나스닥 종합 종가 }
export function step(prev, bar, cfg = DEFAULTS) {
  const s = { ...prev, mamsamDates: [...prev.mamsamDates] };
  const before = s.stock;
  const reasons = [];

  const ixicChg = s.lastIxic ? (bar.ixic / s.lastIxic - 1) * 100 : 0;
  s.upStreak = ixicChg > 0 ? s.upStreak + 1 : 0;
  s.lastIxic = bar.ixic;
  const isMamsam = s.lastIxic !== null && ixicChg <= cfg.mamsam + EPS && prev.lastIxic !== null;

  // 전고점 갱신 → 전량 매수 + 모든 구간 재계산
  if (bar.close > s.ath) {
    if (s.stock < 100) reasons.push('전고점 돌파 → 전량 매수');
    s.ath = bar.close; s.athDate = bar.date;
    s.mode = 'HOLD'; s.stock = 100; s.anchorZone = 0; s.maxDD = 0;
    s.panic = false; s.panicUntil = null;
  }
  const dd = (s.ath - bar.close) / s.ath * 100;

  if (isMamsam) {
    s.mamsamDates.push(bar.date);
    const monthAgo = addMonthsDays(bar.date, -1, 0);
    s.mamsamDates = s.mamsamDates.filter(d => d > monthAgo);
    if (s.mamsamDates.length >= cfg.panicCount) {
      if (!s.panic) reasons.push(`공황 발동 (최근 1개월 마삼 ${s.mamsamDates.length}회)`);
      s.panic = true;
    }
    if (s.panic) s.panicUntil = addMonthsDays(bar.date, cfg.panicWaitMonths, cfg.panicWaitDays);

    if (s.mode !== 'STAKE') {
      s.mode = 'STAKE';
      s.maxDD = dd;
      s.stock = Math.min(100, cfg.stakeUnit * zoneOf(dd, cfg.stakeStep));
      reasons.push(`마삼 발생 (나스닥 ${ixicChg.toFixed(2)}%) → 말뚝박기 전환, 표 기준 주식 ${s.stock}%`);
    } else {
      reasons.push(`말뚝박기 중 마삼 (나스닥 ${ixicChg.toFixed(2)}%) → 매도 없음`);
    }
  }

  // 재진입 조건 (마삼 당일 제외)
  if (!isMamsam && s.stock < 100) {
    const exitsOk = !s.panic || cfg.panicAllowsOtherExits;
    const gridStep = s.mode === 'STAKE' ? cfg.stakeStep : cfg.rebalStep;
    const lowZone = zoneOf(s.maxDD, gridStep);
    const vTarget = (lowZone - cfg.vZones) * gridStep;
    let why = null;
    if (s.panic && s.panicUntil && bar.date >= s.panicUntil) why = '공황 종료 (2개월+1일 동안 마삼 없음)';
    else if (exitsOk && s.upStreak >= cfg.upStreak) why = `나스닥 ${s.upStreak}거래일 연속 상승`;
    else if (exitsOk && lowZone >= cfg.vZones && dd <= vTarget + EPS) why = `V자 반등 (최저 -${(lowZone * gridStep).toFixed(1)}% 구간 → -${vTarget.toFixed(1)}% 회복)`;
    if (why) {
      reasons.push(`${why} → 전량 매수`);
      s.mode = 'HOLD'; s.stock = 100;
      s.anchorZone = zoneOf(dd, cfg.rebalStep); s.maxDD = dd;
      s.panic = false; s.panicUntil = null;
    }
  }

  // 하락 구간 처리
  // 말뚝박기는 마삼 당일에도 계속 (새 저점이면 매수)
  if ((!isMamsam || s.mode === 'STAKE') && reasons.every(r => !r.includes('전량 매수'))) {
    s.maxDD = Math.max(s.maxDD, dd);
    if (s.mode === 'STAKE') {
      const t = Math.min(100, cfg.stakeUnit * zoneOf(s.maxDD, cfg.stakeStep));
      if (t > s.stock) { reasons.push(`말뚝박기: 전고점 대비 -${(zoneOf(s.maxDD, cfg.stakeStep) * cfg.stakeStep)}% 도달`); s.stock = t; }
    } else {
      const z = zoneOf(s.maxDD, cfg.rebalStep);
      const t = Math.max(0, 100 - cfg.rebalUnit * (z - s.anchorZone));
      if (t < s.stock) { reasons.push(`현금화 리밸런싱: 전고점 대비 -${(z * cfg.rebalStep).toFixed(1)}% 도달`); s.stock = t; }
      s.mode = s.stock < 100 ? 'REBAL' : 'HOLD';
    }
  }

  const delta = s.stock - before;
  return {
    state: s,
    signal: {
      date: bar.date, close: bar.close, ixic: bar.ixic, ixicChg, dd,
      mode: s.mode, stock: s.stock, delta,
      action: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'HOLD',
      reasons,
    },
  };
}

export function run(bars, cfg = DEFAULTS) {
  let state = initialState();
  const signals = [];
  for (const bar of bars) {
    const r = step(state, bar, cfg);
    state = r.state; signals.push(r.signal);
  }
  return { state, signals, triggers: nextTriggers(state, cfg) };
}

// 다음에 지켜볼 가격·조건 (대시보드와 알림 메시지용)
export function nextTriggers(s, cfg = DEFAULTS) {
  const t = { ath: s.ath, athDate: s.athDate, mamsamIxic: s.lastIxic ? s.lastIxic * (1 + cfg.mamsam / 100) : null,
    upStreak: s.upStreak, upStreakNeed: cfg.upStreak, panic: s.panic, panicUntil: s.panicUntil,
    recentMamsam: s.mamsamDates.length };
  if (s.mode === 'STAKE') {
    const z = zoneOf(s.maxDD, cfg.stakeStep);
    if (s.stock < 100) t.nextBuy = { pct: (z + 1) * cfg.stakeStep, price: priceAt(s.ath, (z + 1) * cfg.stakeStep), stockAfter: Math.min(100, s.stock + cfg.stakeUnit) };
    if (z >= cfg.vZones) t.vPrice = { pct: (z - cfg.vZones) * cfg.stakeStep, price: priceAt(s.ath, (z - cfg.vZones) * cfg.stakeStep) };
  } else {
    const z = zoneOf(s.maxDD, cfg.rebalStep);
    if (s.stock > 0) t.nextSell = { pct: (z + 1) * cfg.rebalStep, price: priceAt(s.ath, (z + 1) * cfg.rebalStep), stockAfter: Math.max(0, s.stock - cfg.rebalUnit) };
    if (s.stock < 100 && z >= cfg.vZones) t.vPrice = { pct: (z - cfg.vZones) * cfg.rebalStep, price: priceAt(s.ath, (z - cfg.vZones) * cfg.rebalStep) };
  }
  return t;
}

// 전고점 기준 구간표 (전고점이 바뀌면 자동으로 다시 계산됨)
export function zoneTable(ath, cfg = DEFAULTS) {
  const rows = [];
  for (let pct = 0; pct <= 50 + EPS; pct += cfg.rebalStep) {
    const rebal = pct <= 25 + EPS ? Math.max(0, 100 - cfg.rebalUnit * Math.round(pct / cfg.rebalStep)) : null;
    const isStake = Math.abs(pct / cfg.stakeStep - Math.round(pct / cfg.stakeStep)) < EPS;
    rows.push({ pct, price: priceAt(ath, pct), rebalStock: rebal, stakeStock: isStake ? Math.min(100, cfg.stakeUnit * Math.round(pct / cfg.stakeStep)) : null });
  }
  return rows;
}
