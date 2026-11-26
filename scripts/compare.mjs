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
  ['처음 방식: -5%마다 10%p', { stakeStep: 5, stakeCurve: 'flat', stakeEnd: 50, rebaseAfter: null }],
  ['어제 방식: 2.5% 비례 -50%', { stakeStep: 2.5, stakeCurve: 'linear', stakeEnd: 50, rebaseAfter: null }],
  ['새 방식: -25%까지 비례, 이후 같은 양', { stakeStep: 2.5, stakeCurve: 'ramp', stakeRampEnd: 25, stakeEnd: 50, rebaseAfter: null }],
];
for (const [name, v] of variants) {
  const cfg = { ...DEFAULTS, ...v };
  const r = simulate(cfg);
  const marks = [5, 10, 15, 20, 25, 30, 40].map(p => `-${p}%:${stakeStock(Math.round(p / cfg.stakeStep), cfg)}`).join(' ');
  console.log(`${name.padEnd(28)} $${r.final.toFixed(0)}  연${r.cagr.toFixed(1)}%  MDD ${r.mdd.toFixed(1)}%  매매${r.trades}  현재 주식${r.stock}%\n    누적 비중 ${marks}`);
}
