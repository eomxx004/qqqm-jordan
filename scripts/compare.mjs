// 말뚝박기 방식별 과거 성과 비교 (수수료·세금 제외, $10,000 목돈)
import { run, DEFAULTS, stakeStock } from '../engine/jordan.mjs';
import { loadBars } from './data.mjs';

const bars = await loadBars();

function simulate(cfg) {
  const { signals } = run(bars, cfg);
  let shares = 0, cash = 10000, peak = 0, mdd = 0, trades = 0;
  for (const s of signals) {
    if (shares === 0 && cash === 10000 && s.stock > 0) { shares = cash * s.stock / 100 / s.close; cash -= shares * s.close; }
    for (const t of s.trades) {
      const value = shares * t.price + cash, want = value * t.to / 100 / t.price;
      cash -= (want - shares) * t.price; shares = want; trades++;
    }
    const v = shares * s.close + cash;
    peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1);
  }
  const last = signals.at(-1), years = (new Date(last.date) - new Date(bars[0].date)) / 3.15576e10;
  const final = shares * last.close + cash;
  return { final, cagr: ((final / 10000) ** (1 / years) - 1) * 100, mdd: mdd * 100, trades, stock: last.stock };
}

const variants = [
  ['현행: -5%마다 10%p (-50% 완료)', { stakeStep: 5, stakeCurve: 'flat', stakeEnd: 50 }],
];
for (const end of [50, 40, 30]) for (const vs of [5, 2.5]) {
  variants.push([`2.5% 비례 (-${end}% 완료) V자 ${vs * 2}%`, { stakeStep: 2.5, stakeCurve: 'linear', stakeEnd: end, stakeVStep: vs }]);
}
for (const [name, v] of variants) {
  const cfg = { ...DEFAULTS, ...v };
  const r = simulate(cfg);
  const marks = [5, 10, 15, 20, 25, 30, 40].map(p => `-${p}%:${stakeStock(Math.round(p / cfg.stakeStep), cfg)}`).join(' ');
  console.log(`${name.padEnd(28)} $${r.final.toFixed(0)}  연${r.cagr.toFixed(1)}%  MDD ${r.mdd.toFixed(1)}%  매매${r.trades}  현재 주식${r.stock}%\n    누적 비중 ${marks}`);
}
