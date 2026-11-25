const $ = s => document.querySelector(s);
const usd = v => v == null ? '—' : '$' + v.toFixed(2);
const sgn = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const kst = iso => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const MODE = { HOLD: '평상시', REBAL: '1단계 현금화', STAKE: '2단계 말뚝박기' };
const actionText = s => s.action === 'BUY' ? `주식 ${s.delta}%p 매수` : s.action === 'SELL' ? `주식 ${-s.delta}%p 매도` : '할 일 없음';
const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let data;

async function load() {
  try {
    const r = await fetch('data/latest.json?t=' + Date.now(), { cache: 'no-store' });
    data = await r.json();
    render();
  } catch (e) {
    $('#market').textContent = '오프라인';
  }
}

function render() {
  const c = data.confirmed, sig = c.signal, st = c.state, live = data.live;
  const open = data.market === 'open';
  $('#market').textContent = open ? '미국장 진행 중' : '장 마감';
  $('#market').className = 'badge' + (open ? ' open' : '');

  // 마지막 마삼
  const lm = st.lastMamsam;
  if (lm) {
    const days = Math.round((Date.parse(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })) - Date.parse(lm.date)) / 864e5);
    $('#mamsam').innerHTML = `마지막 마삼 (나스닥 -3%): <b>${lm.date}</b> · 나스닥 ${sgn(lm.chg)} · ${days === 0 ? '오늘' : days + '일 전'}`;
  } else $('#mamsam').textContent = '마지막 마삼: 기록 없음';

  // 오늘 할 일 (확정 종가 기준)
  $('#todayTitle').textContent = `${sig.date} 종가 기준 · ${MODE[st.mode]}${st.panic ? ' · 공황 대기' : ''}`;
  renderOrder();
  $('#todayReason').textContent = sig.reasons.length ? '오늘: ' + sig.reasons.join(' · ') : '';
  $('#stockBar').style.width = st.stock + '%';
  $('#stockText').textContent = `목표 비중: 주식 ${st.stock}% / 현금 ${100 - st.stock}%`;
  const doneKey = 'done-' + sig.date;
  $('#doneWrap').classList.toggle('hidden', sig.action === 'HOLD');
  $('#done').checked = localStorage.getItem(doneKey) === '1';
  $('#done').onchange = e => localStorage.setItem(doneKey, e.target.checked ? '1' : '0');

  // 장중 예상 신호
  const p = data.provisional;
  $('#provCard').classList.toggle('hidden', !open || !p);
  if (open && p) {
    $('#provAction').textContent = p.signal.action === 'HOLD' ? '변화 없음' : `${actionText(p.signal)} → 주식 ${p.signal.stock}%`;
    $('#provAction').className = 'action ' + p.signal.action;
    $('#provReason').textContent = p.signal.reasons.join(' · ') || `현재 목표 주식 ${p.signal.stock}% 유지`;
  }

  $('#priceLabel').textContent = open ? `QQQM 현재가 (${live.date})` : `QQQM 종가 (${live.date})`;
  $('#price').textContent = usd(live.close);
  $('#dd').textContent = (-live.dd).toFixed(2) + '%';
  $('#dd').className = live.dd > 0 ? 'neg' : '';
  $('#athLabel').textContent = `전고점 ${usd(st.ath)} (${st.athDate} 종가)`;

  // 시장 지표
  const num = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const IND = {
    ixic: v => num(v.price), spx: v => num(v.price),
    tnx: v => v.price.toFixed(3) + '%', gold: v => '$' + num(v.price, 1), krw: v => '₩' + num(v.price, 1),
  };
  const chgText = (k, v) => k === 'tnx' ? `${v.diff >= 0 ? '+' : ''}${(v.diff * 100).toFixed(1)}bp` : sgn(v.chg);
  $('#indicators').innerHTML = Object.entries(IND).filter(([k]) => data.indicators?.[k]).map(([k, f]) => {
    const v = data.indicators[k];
    return `<li><span>${v.name}</span><span><b>${f(v)}</b><span class="${v.chg < 0 ? 'neg' : 'pos'}">${chgText(k, v)}</span></span></li>`;
  }).join('');

  // 오늘 할 일 카드 아래: 꼭 알아야 할 조건만
  const t = c.triggers, li = (a, b) => `<li><span>${a}</span><span>${b}</span></li>`;
  $('#conds').innerHTML = [
    st.stock < 100 && t.vPrice && li('V자 반등 → 전량 매수', `종가 ${usd(t.vPrice.price)} 이상`),
    st.stock < 100 && li('연속 상승 → 전량 매수', `나스닥 ${t.upStreak}/${t.upStreakNeed}일`),
    st.mode !== 'STAKE' && li('마삼 → 말뚝박기 전환', `나스닥 종가 ${num(t.mamsamIxic, 0)} 이하`),
    t.panic ? li('공황 종료 → 전량 매수', `${t.panicUntil} 이후`) : t.recentMamsam > 1 && li('최근 1개월 마삼', `${t.recentMamsam}/4회 (4회면 공황)`),
  ].filter(Boolean).join('');

  // 구간표
  $('#tableAth').textContent = usd(st.ath);
  const dd = live.dd;
  $('#table').innerHTML = data.table.map((r, i) => {
    const nextPct = data.table[i + 1]?.pct ?? Infinity;
    const here = dd >= r.pct - 1e-9 && dd < nextPct - 1e-9;
    return `<tr class="${here ? 'here' : ''}"><td>${here ? '👉 ' : ''}${r.pct ? '-' + r.pct.toFixed(1) + '%' : '전고점'}</td><td>${usd(r.price)}</td><td>${r.rebalStock == null ? '' : r.rebalStock + '%'}</td><td>${r.stakeStock == null ? '' : r.stakeStock + '%'}</td></tr>`;
  }).join('');

  $('#history').innerHTML = data.history.map(h =>
    `<li><span class="d">${h.date} · $${h.close.toFixed(2)} (-${h.dd.toFixed(1)}%)</span><br><b class="${h.action === 'BUY' ? 'pos' : h.action === 'SELL' ? 'neg' : ''}">${actionText(h)} → 주식 ${h.stock}%</b><br>${esc(h.reasons.join(' · '))}</li>`).join('');
  $('#messages').innerHTML = (data.messages || []).map(m =>
    `<li class="msg"><span class="d">${kst(m.at)}</span><b>${esc(m.title)}</b><pre>${esc(m.body)}</pre></li>`).join('') || '<li>아직 없음</li>';

  $('#updated').textContent = `데이터 갱신: ${kst(data.updatedAt)} (장중 약 15분 간격)`;
  renderAccount();
}

// 할 일이 없으면 바로 밑 구간에 걸어둘 주문을 보여준다 (주문 1건 = 총자산의 10%)
function renderOrder() {
  const sig = data.confirmed.signal, t = data.confirmed.triggers;
  const o = t.nextBuy ? { side: '매수', how: '지정가 매수', ...t.nextBuy } : t.nextSell ? { side: '매도', how: '감시(스탑) 매도', ...t.nextSell } : null;
  const shares = +$('#shares').value || 0, cash = +$('#cash').value || 0;
  const total = shares * data.live.close + cash;
  let qty = null;
  if (o && total > 0) {
    qty = Math.round(total * 0.1 / o.price);
    qty = o.side === '매수' ? Math.min(qty, Math.floor(cash / o.price)) : Math.min(qty, Math.floor(shares));
  }
  const orderLine = o && (qty != null ? `<b>${usd(o.price)}에 ${qty}주 ${o.side}</b> 걸어두세요`
    : `<b>${usd(o.price)}에 주식 10%p ${o.side}</b> 걸어두세요<div class="reason" style="font-size:12px;font-weight:400">내 계좌를 입력하면 주수가 나와요</div>`);
  const detail = o && `<div class="reason">다음 구간 -${o.pct}% · ${o.how} · 체결되면 주식 ${o.stockAfter}%</div>`;

  if (sig.action === 'HOLD' && o) {
    $('#todayAction').innerHTML = orderLine;
    $('#todayAction').className = 'action ' + (o.side === '매수' ? 'BUY' : 'SELL');
    $('#order').innerHTML = detail;
  } else {
    $('#todayAction').textContent = sig.action === 'HOLD' ? '보유 유지' : actionText(sig);
    $('#todayAction').className = 'action ' + sig.action;
    $('#order').innerHTML = o ? `다음 주문: ${orderLine}${detail}` : '';
  }
  $('#order').classList.toggle('hidden', !o);
}

function renderAccount() {
  if (!data) return;
  renderOrder();
  const shares = +$('#shares').value || 0, cash = +$('#cash').value || 0;
  localStorage.setItem('acct', JSON.stringify({ shares, cash }));
  const price = data.live.close, total = shares * price + cash;
  const li = (a, b) => `<li><span>${a}</span><span>${b}</span></li>`;
  if (!total) { $('#account').innerHTML = li('보유 수량과 현금을 입력하세요', ''); return; }
  const now = shares * price / total * 100;
  const rows = [li('총자산', usd(total)), li('현재 주식 비중', now.toFixed(1) + '%')];
  const plan = (label, stock) => {
    const want = total * stock / 100 / price, diff = want - shares;
    const txt = Math.abs(diff) < 0.5 ? '조정 불필요' : `${diff > 0 ? '매수' : '매도'} 약 ${Math.round(Math.abs(diff))}주 (${usd(Math.abs(diff) * price)})`;
    rows.push(li(`${label} 주식 ${stock}%`, txt));
  };
  plan('목표', data.confirmed.state.stock);
  if (data.market === 'open' && data.provisional && data.provisional.signal.stock !== data.confirmed.state.stock) plan('장중 예상', data.provisional.signal.stock);
  $('#account').innerHTML = rows.join('');
}

const acct = JSON.parse(localStorage.getItem('acct') || '{}');
if (acct.shares) $('#shares').value = acct.shares;
if (acct.cash) $('#cash').value = acct.cash;
$('#shares').oninput = $('#cash').oninput = renderAccount;

// ── 푸시 ──
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
$('#pushBtn').onclick = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return alert('이 브라우저는 푸시를 지원하지 않아요. 크롬에서 열어 주세요.');
  if (await Notification.requestPermission() !== 'granted') return alert('알림 권한을 허용해 주세요.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(APP_CONFIG.vapidPublicKey) });
  $('#subJson').value = JSON.stringify(sub);
  $('#subWrap').classList.remove('hidden');
};
$('#copyBtn').onclick = async () => { await navigator.clipboard.writeText($('#subJson').value); $('#copyBtn').textContent = '복사됨 ✓'; };
$('#testBtn').onclick = async () => {
  if (await Notification.requestPermission() !== 'granted') return;
  (await navigator.serviceWorker.ready).showNotification('📊 테스트 알림', { body: '알림이 정상적으로 표시됩니다.', icon: 'icon-192.png' });
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
load();
setInterval(() => document.visibilityState === 'visible' && load(), 60 * 1000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
