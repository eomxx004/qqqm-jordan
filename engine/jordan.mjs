// 조던 룰(마삼룰) 계산 엔진 — QQQM 전용, 금리 일반 모드
// 브라우저와 Node 양쪽에서 쓰는 순수 함수 모듈. 상장일부터 전체 기록을 다시 돌려 오늘 상태를 계산한다.

export const DEFAULTS = {
  rebalStep: 2.5,      // 1단계: 전고점 대비 -2.5%마다
  rebalUnit: 10,       //        주식 10%p 매도 (처음 기준)
  stakeStep: 2.5,      // 2단계 말뚝박기: 전고점 대비 -2.5%마다
  stakeEnd: 50,        //        전고점 대비 -50%에서 주식 100%
  stakeCurve: 'ramp',  //        flat: 구간마다 같은 양 / linear: 깊을수록 비례 / ramp: rampEnd까지 비례, 그 뒤 같은 양
  stakeRampEnd: 25,    //        -25%까지 비례 증가, -25%~-50%는 같은 양
  stakeUnit: 10,       //        (flat일 때 구간당 10%p)
  stakeVStep: 5,       // 말뚝박기 중 V자 반등을 세는 구간 크기 (2구간 = 10% 반등)
  mamsam: -3,          // 나스닥 종합지수 전일 대비 -3% 이하 = 마삼
  upStreak: 8,         // 나스닥 종합지수 8거래일 연속 상승 → 전량 매수
  vZones: 2,           // 최저 구간 대비 2구간 반등 → 전량 매수
  panicCount: 4,       // 최근 1개월 안에 마삼 4회 → 공황
  panicWaitMonths: 2,  // 마지막 마삼 후 2개월 + 1일
  panicWaitDays: 1,
  rebaseAfter: '2026-11-24', // 이 날 종가 위치에서 말뚝박기를 새로 시작 (그 전 장중 체결은 반영 안 함)
  panicAllowsOtherExits: true,  // 공황 대기 중에도 V자 반등/8일 연속 상승이면 전량 매수 (사용자 확정)
};

const EPS = 1e-9;
const zoneOf = (dd, step) => Math.max(0, Math.floor(dd / step + EPS));
const priceAt = (ath, pct) => ath * (1 - pct / 100);

// 말뚝박기 z번째 구간까지 왔을 때의 누적 주식 비중 %
// linear: k번째 구간에서 k만큼 산다 → 누적 = z(z+1) / N(N+1)
// ramp: k번째 구간에서 min(k, R)만큼 산다 (R = stakeRampEnd까지 비례 증가, 그 뒤로는 같은 양)
export function stakeStock(z, cfg = DEFAULTS) {
  const n = Math.round(cfg.stakeEnd / cfg.stakeStep);
  if (z <= 0) return 0;
  if (z >= n) return 100;
  const w = k => cfg.stakeCurve === 'flat' ? 1 : cfg.stakeCurve === 'ramp' ? Math.min(k, Math.round(cfg.stakeRampEnd / cfg.stakeStep)) : k;
  let cum = 0, total = 0;
  for (let k = 1; k <= n; k++) { total += w(k); if (k <= z) cum += w(k); }
  return Math.round(1000 * cum / total) / 10;
}

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
    maxDD: 0,              // 주문 체결 기준 최대 하락률 % (startDate에 현재가로 재설정)
    lowDD: 0,              // 이번 국면 실제 최저 하락률 % (V자 반등 판단용)
    lastClose: null, rebased: false,
    upStreak: 0,
    mamsamDates: [],
    lastMamsam: null,      // 가장 최근 마삼 { date, chg }
    panic: false, panicUntil: null,
    lastIxic: null,
  };
}

// 하루치 시세를 넣어 상태를 갱신하고 그날의 신호를 돌려준다.
// bar = { date:'YYYY-MM-DD', close: QQQM 종가, low: QQQM 장중 저가, ixic: 나스닥 종합 종가 }
// 하루 순서: ① 장중 — 걸어둔 리밸런싱/말뚝박기 주문 체결(저가가 구간 가격에 닿으면)
//            ② 종가 — 전고점 돌파, 마삼(나스닥 종가 -3%), V자/8일 상승/공황 종료 재진입
export function step(prev, bar, cfg = DEFAULTS) {
  const s = { ...prev, mamsamDates: [...prev.mamsamDates] };
  const before = s.stock;
  const reasons = [], trades = [];
  const trade = (to, price, why) => {
    if (to !== s.stock) trades.push({ from: s.stock, to, price, why });
    s.stock = to; reasons.push(why);
  };

  const ixicChg = s.lastIxic ? (bar.ixic / s.lastIxic - 1) * 100 : 0;
  const isMamsam = prev.lastIxic !== null && ixicChg <= cfg.mamsam + EPS;
  s.upStreak = ixicChg > 0 ? s.upStreak + 1 : 0;
  s.lastIxic = bar.ixic;

  // ① 장중 체결: 저가 기준으로 새로 닿은 구간마다 10%p씩
  if (s.ath > 0) {
    const low = Math.min(bar.low ?? bar.close, bar.close);
    const lowDD = (s.ath - low) / s.ath * 100;
    s.lowDD = Math.max(s.lowDD, lowDD);
    if (lowDD > s.maxDD) {
      const from = s.maxDD; s.maxDD = lowDD;
      if (s.mode === 'STAKE') {
        const st = cfg.stakeStep;
        for (let z = zoneOf(from, st) + 1; z <= zoneOf(lowDD, st); z++) {
          const t = stakeStock(z, cfg);
          if (t > s.stock) trade(t, priceAt(s.ath, z * st), `말뚝박기 -${z * st}% 도달 → 주식 ${t}%`);
        }
      } else {
        const st = cfg.rebalStep;
        for (let z = zoneOf(from, st) + 1; z <= zoneOf(lowDD, st); z++) {
          const t = Math.max(0, 100 - cfg.rebalUnit * (z - s.anchorZone));
          if (t < s.stock) trade(t, priceAt(s.ath, z * st), `현금화 -${(z * st).toFixed(1)}% 도달 → 주식 ${t}%`);
        }
        s.mode = s.stock < 100 ? 'REBAL' : 'HOLD';
      }
    }
  }

  // ② 종가: 전고점 갱신 → 전량 매수 + 모든 구간 재계산
  if (bar.close > s.ath) {
    if (s.stock < 100) trade(100, bar.close, '전고점 돌파 → 전량 매수');
    s.ath = bar.close; s.athDate = bar.date;
    s.mode = 'HOLD'; s.stock = 100; s.anchorZone = 0; s.maxDD = 0; s.lowDD = 0;
    s.panic = false; s.panicUntil = null;
  }
  const dd = (s.ath - bar.close) / s.ath * 100;

  if (isMamsam) {
    s.mamsamDates.push(bar.date);
    s.lastMamsam = { date: bar.date, chg: ixicChg };
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
      const t = stakeStock(zoneOf(dd, cfg.stakeStep), cfg);
      trade(t, bar.close, `마삼 발생 (나스닥 ${ixicChg.toFixed(2)}%) → 말뚝박기 전환, 표 기준 주식 ${t}%`);
    } else {
      reasons.push(`말뚝박기 중 마삼 (나스닥 ${ixicChg.toFixed(2)}%) → 매도 없음`);
    }
  }

  // 재진입 조건 (마삼 당일 제외)
  if (!isMamsam && s.stock < 100) {
    const exitsOk = !s.panic || cfg.panicAllowsOtherExits;
    const gridStep = s.mode === 'STAKE' ? (cfg.stakeVStep ?? cfg.stakeStep) : cfg.rebalStep;
    const lowZone = zoneOf(s.lowDD, gridStep);
    const vTarget = (lowZone - cfg.vZones) * gridStep;
    let why = null;
    if (s.panic && s.panicUntil && bar.date >= s.panicUntil) why = '공황 종료 (2개월+1일 동안 마삼 없음)';
    else if (exitsOk && s.upStreak >= cfg.upStreak) why = `나스닥 ${s.upStreak}거래일 연속 상승`;
    else if (exitsOk && lowZone >= cfg.vZones && dd <= vTarget + EPS) why = `V자 반등 (최저 -${(lowZone * gridStep).toFixed(1)}% 구간 → -${vTarget.toFixed(1)}% 회복)`;
    if (why) {
      trade(100, bar.close, `${why} → 전량 매수`);
      s.mode = 'HOLD';
      s.anchorZone = zoneOf(dd, cfg.rebalStep); s.maxDD = dd; s.lowDD = dd;
      s.panic = false; s.panicUntil = null;
    }
  }

  s.lastClose = bar.close;
  const delta = s.stock - before;
  return {
    state: s,
    signal: {
      date: bar.date, close: bar.close, low: bar.low, ixic: bar.ixic, ixicChg, dd,
      mode: s.mode, stock: s.stock, delta,
      action: delta > 0 ? 'BUY' : delta < 0 ? 'SELL' : 'HOLD',
      reasons, trades,
    },
  };
}

export function run(bars, cfg = DEFAULTS) {
  let state = initialState();
  const signals = [];
  for (const bar of bars) {
    const r = step(state, bar, cfg);
    state = r.state; signals.push(r.signal);
    // 기준일 종가 위치에서 다시 시작: 말뚝박기 중이면 그 위치의 표 비중으로 맞추고 아래 구간부터 주문
    if (cfg.rebaseAfter && !state.rebased && bar.date >= cfg.rebaseAfter) {
      state = { ...state, rebased: true };
      if (state.mode === 'STAKE') {
        const dd = (state.ath - bar.close) / state.ath * 100;
        state.maxDD = dd;
        state.stock = stakeStock(zoneOf(dd, cfg.stakeStep), cfg);
      }
    }
  }
  return { state, signals, triggers: nextTriggers(state, cfg) };
}

// 다음에 지켜볼 가격·조건 (대시보드와 알림 메시지용)
export function nextTriggers(s, cfg = DEFAULTS) {
  const t = { ath: s.ath, athDate: s.athDate, mamsamIxic: s.lastIxic ? s.lastIxic * (1 + cfg.mamsam / 100) : null,
    upStreak: s.upStreak, upStreakNeed: cfg.upStreak, panic: s.panic, panicUntil: s.panicUntil,
    recentMamsam: s.mamsamDates.length };
  t.orders = []; // 걸어둘 다음 2구간 주문 { side, pct, price, size(%p), stockAfter }
  if (s.mode === 'STAKE') {
    const z = zoneOf(s.maxDD, cfg.stakeStep);
    let prev = s.stock;
    for (let k = z + 1; k <= z + 2 && prev < 100; k++) {
      const after = stakeStock(k, cfg);
      t.orders.push({ side: 'BUY', pct: k * cfg.stakeStep, price: priceAt(s.ath, k * cfg.stakeStep), size: +(after - prev).toFixed(1), stockAfter: after });
      prev = after;
    }
    if (t.orders[0]) t.nextBuy = t.orders[0];
    const vs = cfg.stakeVStep ?? cfg.stakeStep, vz = zoneOf(s.lowDD, vs);
    if (vz >= cfg.vZones) t.vPrice = { pct: (vz - cfg.vZones) * vs, price: priceAt(s.ath, (vz - cfg.vZones) * vs) };
  } else {
    const z = zoneOf(s.maxDD, cfg.rebalStep);
    let prev = s.stock;
    for (let k = z + 1; k <= z + 2 && prev > 0; k++) {
      const after = Math.max(0, prev - cfg.rebalUnit);
      t.orders.push({ side: 'SELL', pct: k * cfg.rebalStep, price: priceAt(s.ath, k * cfg.rebalStep), size: prev - after, stockAfter: after });
      prev = after;
    }
    if (t.orders[0]) t.nextSell = t.orders[0];
    const lz = zoneOf(s.lowDD, cfg.rebalStep);
    if (s.stock < 100 && lz >= cfg.vZones) t.vPrice = { pct: (lz - cfg.vZones) * cfg.rebalStep, price: priceAt(s.ath, (lz - cfg.vZones) * cfg.rebalStep) };
  }
  return t;
}

// 전고점 기준 구간표 (전고점이 바뀌면 자동으로 다시 계산됨)
export function zoneTable(ath, cfg = DEFAULTS) {
  const rows = [];
  for (let pct = 0; pct <= 50 + EPS; pct += cfg.rebalStep) {
    const rebal = pct <= 25 + EPS ? Math.max(0, 100 - cfg.rebalUnit * Math.round(pct / cfg.rebalStep)) : null;
    const isStake = Math.abs(pct / cfg.stakeStep - Math.round(pct / cfg.stakeStep)) < EPS;
    rows.push({ pct, price: priceAt(ath, pct), rebalStock: rebal, stakeStock: isStake ? stakeStock(Math.round(pct / cfg.stakeStep), cfg) : null });
  }
  return rows;
}
