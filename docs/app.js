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
  // 👉 현재가 줄을 구간 사이에 끼워 넣고, 🎯 걸어둘 2구간을 표시
  const dd = live.dd, stake = st.mode === 'STAKE';
  const orderPcts = (t.orders || []).map(o => o.pct);
  const isOrder = pct => orderPcts.some(p => Math.abs(p - pct) < 1e-9);
  const cell = (v, active, pct) => v == null ? '' : active && pct && isOrder(pct) ? `🎯 <b>${v}%</b>` : v + '%';
  const rows = [];
  data.table.forEach((r, i) => {
    rows.push(`<tr class="${isOrder(r.pct) ? 'next' : ''}"><td>${r.pct ? '-' + r.pct.toFixed(1) + '%' : '전고점'}</td><td>${usd(r.price)}</td><td class="${stake ? 'off' : ''}">${cell(r.rebalStock, !stake, r.pct)}</td><td class="${stake ? '' : 'off'}">${cell(r.stakeStock, stake, r.pct)}</td></tr>`);
    const np = data.table[i + 1]?.pct ?? Infinity;
    if (dd >= r.pct - 1e-9 && dd < np - 1e-9) {
      rows.push(`<tr class="here"><td>👉 -${dd.toFixed(2)}%</td><td>${usd(live.close)}</td><td colspan="2">현재가 · 주식 ${st.stock}%</td></tr>`);
    }
  });
  $('#table').innerHTML = rows.join('');

  $('#history').innerHTML = data.history.map(h =>
    `<li><span class="d">${h.date} · $${h.close.toFixed(2)} (-${h.dd.toFixed(1)}%)</span><br><b class="${h.action === 'BUY' ? 'pos' : h.action === 'SELL' ? 'neg' : ''}">${actionText(h)} → 주식 ${h.stock}%</b><br>${esc(h.reasons.join(' · '))}</li>`).join('');
  $('#messages').innerHTML = (data.messages || []).map(m =>
    `<li class="msg"><span class="d">${kst(m.at)}</span><b>${esc(m.title)}</b><pre>${esc(m.body)}</pre></li>`).join('') || '<li>아직 없음</li>';

  $('#updated').textContent = `데이터 갱신: ${kst(data.updatedAt)} (장중 약 15분 간격)`;
  renderFills();
  renderAccount();
}

// 현재가 아래 2구간에 걸어둘 주문 (주문 크기 = 총자산 × 그 구간의 비중 증가분)
function renderOrder() {
  const sig = data.confirmed.signal, orders = data.confirmed.triggers.orders || [];
  const shares = +$('#shares').value || 0, cash = +$('#cash').value || 0;
  const total = shares * data.live.close + cash;
  let cashLeft = cash, sharesLeft = shares;
  const lines = orders.map(o => {
    const side = o.side === 'BUY' ? '매수' : '매도';
    let what = `주식 ${o.size}%p`;
    if (total > 0) {
      let q = Math.round(total * o.size / 100 / o.price);
      q = o.side === 'BUY' ? Math.min(q, Math.floor(cashLeft / o.price)) : Math.min(q, Math.floor(sharesLeft));
      if (o.side === 'BUY') cashLeft -= q * o.price; else sharesLeft -= q;
      what = `${q}주`;
    }
    return `<div><b>${usd(o.price)}에 ${what} ${side}</b> <span class="reason">(-${o.pct}% → 주식 ${o.stockAfter}%)</span></div>`;
  });
  const how = orders[0]?.side === 'SELL' ? '감시(스탑) 매도' : '지정가 매수';
  const hint = total > 0 ? '' : '<div class="reason" style="font-size:12px">내 계좌를 입력하면 주수가 나와요</div>';

  if (sig.action === 'HOLD' && orders.length) {
    $('#todayAction').innerHTML = `아래 ${orders.length}구간에 ${how}를 걸어두세요`;
    $('#todayAction').className = 'action ' + orders[0].side;
    $('#todayAction').style.fontSize = '18px';
    $('#order').innerHTML = `<div class="${orders[0].side === 'BUY' ? 'pos' : 'neg'}">${lines.join('')}</div>${hint}`;
  } else {
    $('#todayAction').textContent = sig.action === 'HOLD' ? '보유 유지' : actionText(sig);
    $('#todayAction').className = 'action ' + sig.action;
    $('#todayAction').style.fontSize = '';
    $('#order').innerHTML = orders.length ? `<div class="reason">다음 주문 (${how})</div>${lines.join('')}${hint}` : '';
  }
  $('#order').classList.toggle('hidden', !orders.length);
}

// ── '체결 못함' 버튼: GitHub에 그날 종가에서 다시 시작하라고 요청 ──
const REPO = 'eomxx004/qqqm-jordan';
const pending = () => JSON.parse(localStorage.getItem('unfilledPending') || '{}');

function renderFills() {
  const fills = data.fills || [], p = pending();
  $('#fillsWrap').classList.toggle('hidden', !fills.length);
  $('#fills').innerHTML = fills.map(f => {
    const done = (data.corrections || []).includes(f.date), asked = p[f.date] && !done;
    return `<li><span>${f.date.slice(5).replace('-', '/')}${f.today ? ' (오늘 장중)' : ''} · <b>${usd(f.price)}</b> ${f.side === 'BUY' ? '매수' : '매도'}<br><span class="reason">${esc(f.why)}</span></span>
      <span><button data-date="${f.date}" ${asked ? 'disabled' : ''}>${asked ? '요청됨 · 반영 중' : '체결 못함'}</button></span></li>`;
  }).join('');
  $('#fills').querySelectorAll('button[data-date]').forEach(b => b.onclick = () => markUnfilled(b.dataset.date, b));
}

async function markUnfilled(date, btn) {
  const token = localStorage.getItem('ghToken');
  if (!token) { alert("먼저 아래 '체결 못함 버튼 설정'에 GitHub 토큰을 저장해 주세요."); $('#ghToken').scrollIntoView({ behavior: 'smooth' }); return; }
  if (!confirm(`${date} 체결을 취소하고, 그날 종가 위치에서 다시 계산할까요?\n(두 분 폰 모두에 반영돼요)`)) return;
  btn.disabled = true; btn.textContent = '요청 중…';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { unfilled: date } }),
    });
    if (r.status !== 204) throw new Error(r.status === 401 || r.status === 403 || r.status === 404 ? '토큰 권한을 확인해 주세요' : `오류 ${r.status}`);
    localStorage.setItem('unfilledPending', JSON.stringify({ ...pending(), [date]: Date.now() }));
    btn.textContent = '요청됨 · 반영 중';
    alert('요청했어요. 1~2분 뒤 앱과 알림에 반영돼요.');
  } catch (e) {
    btn.disabled = false; btn.textContent = '체결 못함';
    alert('요청 실패: ' + e.message);
  }
}

$('#ghToken').value = localStorage.getItem('ghToken') ? '••••••••' : '';
$('#tokenState').textContent = localStorage.getItem('ghToken') ? '저장됨 ✓' : '';
$('#tokenBtn').onclick = () => {
  const v = $('#ghToken').value.trim();
  if (!v || v.startsWith('••')) return;
  localStorage.setItem('ghToken', v);
  $('#ghToken').value = '••••••••';
  $('#tokenState').textContent = '저장됨 ✓';
};

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
