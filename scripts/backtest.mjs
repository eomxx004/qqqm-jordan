// QQQM 상장일부터 조던 룰을 돌려 매매 신호 기록과 성과를 출력한다.
import { run } from '../engine/jordan.mjs';
import { loadBars } from './data.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const bars = await loadBars();
const { state, signals, triggers } = run(bars);

// 목돈 $10,000, 신호가 난 날 종가에 목표 비중으로 리밸런싱 (수수료·세금 제외)
let shares = 0, cash = 10000, peak = 0, mdd = 0;
const bh = 10000 / bars[0].close;
let bhPeak = 0, bhMdd = 0;
for (const s of signals) {
  if (shares === 0 && cash === 10000 && s.stock > 0) { shares = cash * s.stock / 100 / s.close; cash -= shares * s.close; }
  for (const t of s.trades) { // 구간 가격(장중) 또는 종가에 체결
    const value = shares * t.price + cash, want = value * t.to / 100 / t.price;
    cash -= (want - shares) * t.price; shares = want;
  }
  const v = shares * s.close + cash;
  peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1);
  const b = bh * s.close; bhPeak = Math.max(bhPeak, b); bhMdd = Math.min(bhMdd, b / bhPeak - 1);
}
const last = signals.at(-1);
const years = (new Date(last.date) - new Date(bars[0].date)) / 3.15576e10;
const final = shares * last.close + cash, bhFinal = bh * last.close;
const cagr = x => ((x / 10000) ** (1 / years) - 1) * 100;

console.log(`기간 ${bars[0].date} ~ ${last.date} (${bars.length}거래일)\n`);
console.log('날짜        QQQM종가  전고점대비  나스닥   목표주식  변화   이유');
for (const s of signals.filter(s => s.reasons.length)) {
  console.log(`${s.date}  ${s.close.toFixed(2).padStart(7)}  ${(-s.dd).toFixed(2).padStart(7)}%  ${s.ixicChg.toFixed(2).padStart(6)}%  ${String(s.stock).padStart(5)}%  ${(s.delta > 0 ? '+' : '') + s.delta}`.padEnd(70) + s.reasons.join(' / '));
}
console.log(`\n조던 룰: $${final.toFixed(0)}  연평균 ${cagr(final).toFixed(1)}%  최대낙폭 ${(mdd * 100).toFixed(1)}%  매매 ${signals.filter(s => s.action !== 'HOLD').length}회`);
console.log(`단순보유: $${bhFinal.toFixed(0)}  연평균 ${cagr(bhFinal).toFixed(1)}%  최대낙폭 ${(bhMdd * 100).toFixed(1)}%`);
console.log('\n오늘 상태:', { mode: state.mode, stock: state.stock, ath: state.ath.toFixed(2), athDate: state.athDate, maxDD: state.maxDD.toFixed(2) });
console.log('다음 트리거:', JSON.stringify(triggers, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v, 1));

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/backtest.json', import.meta.url), JSON.stringify({ signals, state, triggers }, null, 1));
