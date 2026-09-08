// ---------- 공통 ----------
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || '요청에 실패했습니다.');
  }
  return data;
}

function showMsg(el, text, ok = true) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  if (text) setTimeout(() => { el.textContent = ''; }, 3500);
}

// ---------- 세션 체크 ----------
(async function checkSession() {
  try {
    const data = await api('/session');
    if (!data.authenticated) {
      window.location.href = '/login.html';
    } else {
      init();
    }
  } catch (e) {
    window.location.href = '/login.html';
  }
})();

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- 탭 전환 ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
  });
});

let membersCache = [];

function init() {
  loadMembers().then(() => {
    loadWishTokens();
  });
  setupWishForm();
  setupChoreTab();
}

// ---------- 멤버 ----------
async function loadMembers() {
  membersCache = await api('/members');
  const select = document.getElementById('wishMember');
  select.innerHTML = membersCache.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
}

// ---------- 소원권 ----------
function setupWishForm() {
  const minusBtn = document.getElementById('deltaMinus');
  const plusBtn = document.getElementById('deltaPlus');
  const amountInput = document.getElementById('deltaAmount');

  minusBtn.addEventListener('click', () => {
    const v = Math.max(1, (parseInt(amountInput.value, 10) || 1) - 1);
    amountInput.value = v;
  });
  plusBtn.addEventListener('click', () => {
    const v = (parseInt(amountInput.value, 10) || 1) + 1;
    amountInput.value = v;
  });

  document.getElementById('wishAddBtn').addEventListener('click', () => submitWish(1));
  document.getElementById('wishSubBtn').addEventListener('click', () => submitWish(-1));
}

async function submitWish(sign) {
  const msgEl = document.getElementById('wishMsg');
  const member = document.getElementById('wishMember').value;
  const amount = Math.abs(parseInt(document.getElementById('deltaAmount').value, 10) || 0);
  const reason = document.getElementById('wishReason').value;

  if (!member || amount <= 0) {
    showMsg(msgEl, '대상과 개수를 확인해주세요.', false);
    return;
  }

  try {
    await api('/wish-tokens/adjust', {
      method: 'POST',
      body: JSON.stringify({ member, delta: sign * amount, reason }),
    });
    document.getElementById('wishReason').value = '';
    showMsg(msgEl, '반영했어요!', true);
    loadWishTokens();
  } catch (e) {
    showMsg(msgEl, e.message, false);
  }
}

async function loadWishTokens() {
  const data = await api('/wish-tokens');

  const grid = document.getElementById('balanceGrid');
  grid.innerHTML = data.balances
    .map(
      (b) => `
      <div class="balance-item">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="num">${b.balance}</div>
      </div>`
    )
    .join('');

  const list = document.getElementById('historyList');
  const emptyEl = document.getElementById('historyEmpty');
  if (data.history.length === 0) {
    list.innerHTML = '';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    list.innerHTML = data.history
      .map((h) => {
        const sign = h.delta > 0 ? '+' : '';
        const cls = h.delta > 0 ? 'plus' : 'minus';
        const date = formatDateTime(h.timestamp);
        return `<li>
          <span class="h-left">${date}<br><span class="h-member">${escapeHtml(h.member)}</span> ${escapeHtml(h.reason || '')}</span>
          <span class="h-delta ${cls}">${sign}${h.delta}</span>
        </li>`;
      })
      .join('');
  }
}

// ---------- 집안일 ----------
function currentMonthStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function setupChoreTab() {
  const monthPicker = document.getElementById('monthPicker');
  monthPicker.value = currentMonthStr();
  monthPicker.addEventListener('change', () => loadAssignments(monthPicker.value));

  document.getElementById('addChoreBtn').addEventListener('click', addChore);

  loadAssignments(monthPicker.value);
  loadChoreManageList();
}

async function loadAssignments(month) {
  const listEl = document.getElementById('assignmentList');
  const emptyEl = document.getElementById('assignmentEmpty');
  const data = await api('/assignments?month=' + encodeURIComponent(month));

  if (data.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = data
    .map((a) => {
      const options = ['<option value="">미정</option>']
        .concat(
          membersCache.map(
            (m) =>
              `<option value="${escapeHtml(m.name)}" ${m.name === a.assignee ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
          )
        )
        .join('');
      return `<div class="chore-row" data-chore-id="${a.choreId}">
        <span class="chore-name">${escapeHtml(a.choreName)}</span>
        <select data-chore-id="${a.choreId}">${options}</select>
      </div>`;
    })
    .join('');

  listEl.querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const choreId = sel.dataset.choreId;
      const msgEl = document.getElementById('assignmentMsg');
      try {
        await api('/assignments', {
          method: 'POST',
          body: JSON.stringify({
            month: document.getElementById('monthPicker').value,
            choreId,
            assignee: sel.value,
          }),
        });
        showMsg(msgEl, '저장했어요!', true);
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });
}

async function loadChoreManageList() {
  const chores = await api('/chores');
  const el = document.getElementById('choreManageList');
  if (chores.length === 0) {
    el.innerHTML = '<p class="empty">등록된 집안일이 없어요.</p>';
    return;
  }
  el.innerHTML = chores
    .map(
      (c) => `<div class="manage-row" data-id="${c.id}">
        <span>${escapeHtml(c.name)}</span>
        <button data-id="${c.id}">삭제</button>
      </div>`
    )
    .join('');

  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgEl = document.getElementById('choreMsg');
      try {
        await api('/chores/' + btn.dataset.id, { method: 'DELETE' });
        showMsg(msgEl, '삭제했어요.', true);
        loadChoreManageList();
        loadAssignments(document.getElementById('monthPicker').value);
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });
}

async function addChore() {
  const input = document.getElementById('newChoreName');
  const msgEl = document.getElementById('choreMsg');
  const name = input.value.trim();
  if (!name) {
    showMsg(msgEl, '이름을 입력해주세요.', false);
    return;
  }
  try {
    await api('/chores', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    showMsg(msgEl, '추가했어요!', true);
    loadChoreManageList();
    loadAssignments(document.getElementById('monthPicker').value);
  } catch (e) {
    showMsg(msgEl, e.message, false);
  }
}

// ---------- 유틸 ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${hh}:${mm}`;
  } catch (e) {
    return iso;
  }
}
