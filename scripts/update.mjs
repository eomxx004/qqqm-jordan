// 15분마다 GitHub Actions에서 실행: 시세 수집 → 룰 계산 → 앱 데이터(docs/data/latest.json) 갱신 → 푸시 발송
import { run, step, nextTriggers, zoneTable, DEFAULTS } from '../engine/jordan.mjs';
import { loadMarket } from './data.mjs';
import fs from 'node:fs';

const DIR = new URL('../docs/data/', import.meta.url);
fs.mkdirSync(DIR, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(new URL(f, DIR), JSON.stringify(v, null, 1));

const { bars, open } = await loadMarket();
const conf = run(open ? bars.slice(0, -1) : bars);
const lastConf = conf.signals.at(-1);
let prov = null;
if (open) {
  const r = step(conf.state, bars.at(-1));
  prov = { signal: r.signal, triggers: nextTriggers(r.state) };
}
const live = prov ? prov.signal : lastConf;

// ── 알림 메시지 만들기 ──
const usd = v => '$' + v.toFixed(2);
const sgn = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const actionText = s => s.action === 'BUY' ? `주식 ${s.delta}%p 매수 → 목표 주식 ${s.stock}%`
  : s.action === 'SELL' ? `주식 ${-s.delta}%p 매도 → 목표 주식 ${s.stock}%` : `할 일 없음 (목표 주식 ${s.stock}%)`;
const nextLines = t => [
  t.nextBuy && `다음 매수: 장중 ${usd(t.nextBuy.price)} 도달 (-${t.nextBuy.pct}%) → 주식 ${t.nextBuy.stockAfter}%`,
  t.nextSell && `다음 매도: 장중 ${usd(t.nextSell.price)} 도달 (-${t.nextSell.pct}%) → 주식 ${t.nextSell.stockAfter}%`,
  t.vPrice && `V자 반등 전량매수: 종가 ${usd(t.vPrice.price)} 이상`,
].filter(Boolean);

const notified = readJson('notified.json', { daily: null, alerts: {} });
const msgs = [];

// 할 일이 없을 때: 바로 밑 구간에 걸어둘 주문
const nextOrder = t => t.nextBuy ? { side: '매수', how: '지정가 매수', ...t.nextBuy }
  : t.nextSell ? { side: '매도', how: '감시(스탑) 매도', ...t.nextSell } : null;

if (!open && notified.daily !== lastConf.date) {
  const o = nextOrder(conf.triggers);
  const hold = lastConf.action === 'HOLD';
  msgs.push({
    tag: 'daily',
    title: `📊 ${lastConf.date.slice(5)} QQQM ${!hold ? (lastConf.action === 'BUY' ? '매수 신호' : '매도 신호') : o ? `${usd(o.price)} ${o.side} 걸기` : '보유 유지'}`,
    body: [
      `종가 ${usd(lastConf.close)} (전고점 대비 -${lastConf.dd.toFixed(1)}%) · 나스닥 ${sgn(lastConf.ixicChg)}`,
      hold && o ? `👉 다음 구간 ${usd(o.price)} (-${o.pct}%)에 주식 10%p ${o.how} 걸어두기 → 주식 ${o.stockAfter}%`
        : `👉 ${actionText(lastConf)}`,
      ...lastConf.reasons,
      ...nextLines(conf.triggers).filter(l => !(hold && o && l.startsWith('다음'))),
    ].join('\n'),
  });
  notified.daily = lastConf.date;
}

if (open) {
  const today = live.date;
  const sent = new Set(notified.alerts[today] || []);
  const alert = (key, title, body) => { if (!sent.has(key)) { sent.add(key); msgs.push({ tag: key, title, body }); } };
  if (live.ixicChg <= DEFAULTS.mamsam) alert('mamsam', '🚨 나스닥 -3% 돌파 (마삼 예상)', `나스닥 ${sgn(live.ixicChg)} · 이대로 마감하면: ${actionText(prov.signal)}`);
  else if (live.ixicChg <= DEFAULTS.mamsam + 0.5) alert('mamsam-near', '⚠️ 나스닥 -2.5% 이하', `나스닥 ${sgn(live.ixicChg)} · 마삼(-3%) 근접`);
  if (prov.signal.action !== 'HOLD') alert(`prov-${prov.signal.stock}`, `⏰ 장중 신호: ${prov.signal.action === 'BUY' ? '매수' : '매도'}`, `QQQM ${usd(live.close)} · ${actionText(prov.signal)}\n${prov.signal.reasons.join('\n')}`);
  const t = conf.triggers;
  for (const [k, p, label] of [['near-buy', t.nextBuy?.price, '다음 매수가'], ['near-sell', t.nextSell?.price, '다음 매도가'], ['near-v', t.vPrice?.price, 'V자 반등가'], ['near-ath', t.ath, '전고점']]) {
    if (p && Math.abs(live.close / p - 1) <= 0.01) alert(k, `🎯 ${label} 1% 이내`, `QQQM ${usd(live.close)} · ${label} ${usd(p)}`);
  }
  notified.alerts = { [today]: [...sent] };
}

if (process.env.TEST_PUSH === 'true') {
  msgs.push({ tag: 'test', title: '✅ 푸시 연결 완료', body: `QQQM ${usd(live.close)} (전고점 대비 -${live.dd.toFixed(1)}%) · 현재 ${conf.state.mode === 'STAKE' ? '2단계 말뚝박기' : conf.state.mode === 'REBAL' ? '1단계 현금화' : '평상시'}, 목표 주식 ${conf.state.stock}%` });
}

// ── 푸시 발송 ──
const clean = v => (v || '').replace(/^﻿/, '').trim();
let subs = [];
try { subs = [].concat(JSON.parse(clean(process.env.PUSH_SUBSCRIPTIONS) || '[]')); }
catch (e) { console.error('PUSH_SUBSCRIPTIONS 형식 오류 — 푸시 건너뜀'); }
if (msgs.length && subs.length && process.env.VAPID_PRIVATE_KEY) {
  const wp = await import('web-push');
  const webpush = wp.default ?? wp;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://github.com', clean(process.env.VAPID_PUBLIC_KEY), clean(process.env.VAPID_PRIVATE_KEY));
  for (const m of msgs) for (const sub of subs) {
    try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 6 * 3600 }); }
    catch (e) { console.error('푸시 실패', e.statusCode, e.body); }
  }
}

const log = readJson('messages.json', []);
const now = new Date().toISOString();
log.unshift(...msgs.map(m => ({ ...m, at: now })));
writeJson('messages.json', log.slice(0, 50));
writeJson('notified.json', notified);

const s = conf.state;
writeJson('latest.json', {
  updatedAt: now,
  market: open ? 'open' : 'closed',
  live,
  confirmed: { signal: lastConf, triggers: conf.triggers,
    state: { mode: s.mode, stock: s.stock, ath: s.ath, athDate: s.athDate, maxDD: s.maxDD, panic: s.panic, panicUntil: s.panicUntil, mamsamDates: s.mamsamDates, lastMamsam: s.lastMamsam } },
  provisional: prov,
  table: zoneTable(s.ath),
  history: conf.signals.filter(x => x.reasons.length).slice(-60).reverse(),
  messages: log.slice(0, 20),
  config: DEFAULTS,
});
console.log(`${open ? '장중' : '마감'} ${live.date} QQQM ${live.close.toFixed(2)} → ${lastConf.mode} ${lastConf.stock}% · 알림 ${msgs.length}건`);
