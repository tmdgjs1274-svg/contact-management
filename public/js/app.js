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

// ---------- 모달 ----------
function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
  overlay.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => overlay.classList.remove('active'))
  );
});

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
let choresCache = [];

function init() {
  loadMembers().then(() => loadWishTokens());
  updateMonthLabel();
  loadChoresMaster().then(() => loadAssignments(currentMonthStr()));
}

// ============================================================
// 소원권
// ============================================================

document.getElementById('openWishSettingsBtn').addEventListener('click', () => {
  renderMemberNameEditor();
  openModal('wishSettingsModal');
});
document.getElementById('openHistoryModalBtn').addEventListener('click', () => {
  document.querySelectorAll('.quick-filter-row button').forEach((b) => b.classList.remove('active'));
  const btn3m = document.querySelector('.quick-filter-row button[data-range="3m"]');
  btn3m.classList.add('active');
  const { from, to } = computeQuickRange('3m');
  document.getElementById('historyFrom').value = toDateInputValue(from);
  document.getElementById('historyTo').value = toDateInputValue(to);
  applyHistoryFilter();
  openModal('historyModal');
});

async function loadMembers() {
  membersCache = await api('/members');
  const select = document.getElementById('wishMember');
  select.innerHTML = membersCache
    .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`)
    .join('');
}

function renderMemberNameEditor() {
  const el = document.getElementById('memberNameEditList');
  el.innerHTML = membersCache
    .map(
      (m) => `
      <div class="member-name-row">
        <input type="text" value="${escapeHtml(m.name)}" data-id="${m.id}" />
        <button data-id="${m.id}">저장</button>
      </div>`
    )
    .join('');
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.member-name-row');
      const newName = row.querySelector('input').value.trim();
      const msgEl = document.getElementById('memberNameMsg');
      if (!newName) {
        showMsg(msgEl, '이름을 입력해주세요.', false);
        return;
      }
      try {
        await api('/members/' + btn.dataset.id, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName }),
        });
        showMsg(msgEl, '변경했어요!', true);
        await loadMembers();
        renderMemberNameEditor();
        loadWishTokens();
        loadAssignments(currentMonthStr());
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });
}

document.getElementById('deltaMinus').addEventListener('click', () => {
  const input = document.getElementById('deltaAmount');
  input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1);
});
document.getElementById('deltaPlus').addEventListener('click', () => {
  const input = document.getElementById('deltaAmount');
  input.value = (parseInt(input.value, 10) || 1) + 1;
});
document.getElementById('wishAddBtn').addEventListener('click', () => submitWish(1));
document.getElementById('wishSubBtn').addEventListener('click', () => submitWish(-1));

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

// 멤버가 시트에 등록된 순서를 기준으로 색상 클래스를 결정 (0=블루, 1=핑크, 2=퍼플, 3=민트)
// 이름이 바뀌었거나(과거 이력) 더 이상 존재하지 않는 멤버는 기본값(핑크)으로 표시
function memberColorClass(memberName) {
  const palette = ['color-0', 'color-1', 'color-2', 'color-3'];
  const idx = membersCache.findIndex((m) => m.name === memberName);
  return palette[idx >= 0 ? idx % palette.length : 1];
}

let wishHistoryCache = [];

function renderHistoryItems(container, items, opts = {}) {
  const editable = !!opts.editable;
  if (items.length === 0) {
    container.innerHTML = '';
    return false;
  }
  container.innerHTML = items
    .map((h) => {
      const sign = h.delta > 0 ? '+' : '';
      const cls = h.delta > 0 ? 'plus' : 'minus';
      const date = formatDateTime(h.timestamp);
      const badge = `<span class="name-badge ${memberColorClass(h.member)}">${escapeHtml(h.member)}</span>`;

      const actions = editable
        ? `<div class="h-actions">
             <button type="button" class="h-edit-btn" data-id="${h.id}">수정</button>
             <button type="button" class="h-del-btn" data-id="${h.id}">삭제</button>
           </div>`
        : '';

      const editForm = editable
        ? `<div class="h-edit-form" id="edit-form-${h.id}" style="display:none">
             <div class="form-row">
               <select class="h-edit-member">
                 ${membersCache.map((m) => `<option value="${escapeHtml(m.name)}" ${m.name === h.member ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
               </select>
             </div>
             <div class="form-row">
               <input type="number" class="h-edit-delta" value="${h.delta}" />
               <input type="text" class="h-edit-reason" value="${escapeHtml(h.reason || '')}" />
             </div>
             <div class="form-row">
               <button type="button" class="btn-secondary h-save-btn" data-id="${h.id}" style="flex:1">저장</button>
               <button type="button" class="btn-secondary h-cancel-btn" data-id="${h.id}" style="flex:1">취소</button>
             </div>
           </div>`
        : '';

      return `<li data-id="${h.id}">
        <div class="h-row">
          <span class="h-left">${date}<br>${badge} ${escapeHtml(h.reason || '')}</span>
          <span class="h-delta ${cls}">${sign}${h.delta}</span>
        </div>
        ${actions}
        ${editForm}
      </li>`;
    })
    .join('');

  if (editable) {
    container.querySelectorAll('.h-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const form = document.getElementById('edit-form-' + btn.dataset.id);
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
      });
    });
    container.querySelectorAll('.h-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('edit-form-' + btn.dataset.id).style.display = 'none';
      });
    });
    container.querySelectorAll('.h-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 기록을 삭제할까요? 보유 개수가 다시 계산돼요.')) return;
        try {
          await api('/wish-tokens/' + btn.dataset.id, { method: 'DELETE' });
          await loadWishTokens();
          applyHistoryFilter();
        } catch (e) {
          alert(e.message);
        }
      });
    });
    container.querySelectorAll('.h-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const li = container.querySelector(`li[data-id="${btn.dataset.id}"]`);
        const member = li.querySelector('.h-edit-member').value;
        const delta = parseInt(li.querySelector('.h-edit-delta').value, 10);
        const reason = li.querySelector('.h-edit-reason').value;
        try {
          await api('/wish-tokens/' + btn.dataset.id, {
            method: 'PATCH',
            body: JSON.stringify({ member, delta, reason }),
          });
          await loadWishTokens();
          applyHistoryFilter();
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  return true;
}

async function loadWishTokens() {
  const data = await api('/wish-tokens');
  wishHistoryCache = data.history;

  const grid = document.getElementById('balanceGrid');
  grid.innerHTML = data.balances
    .map(
      (b) => `
      <div class="balance-item ${memberColorClass(b.name)}">
        <div class="name">${escapeHtml(b.name)}</div>
        <div class="num">${b.balance}</div>
      </div>`
    )
    .join('');

  const recentEl = document.getElementById('historyListRecent');
  const emptyEl = document.getElementById('historyEmpty');
  const hasRecent = renderHistoryItems(recentEl, data.history.slice(0, 3), { editable: false });
  emptyEl.style.display = hasRecent ? 'none' : 'block';

  if (document.getElementById('historyModal').classList.contains('active')) {
    applyHistoryFilter();
  }
}

// ---- 전체 이력 모달: 날짜 필터 ----
function computeQuickRange(key) {
  const to = new Date();
  let from = null;
  if (key === '1m') from = new Date(to.getFullYear(), to.getMonth() - 1, to.getDate());
  else if (key === '3m') from = new Date(to.getFullYear(), to.getMonth() - 3, to.getDate());
  else if (key === '6m') from = new Date(to.getFullYear(), to.getMonth() - 6, to.getDate());
  else if (key === '1y') from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
  return { from, to: key === 'all' ? null : to };
}

function toDateInputValue(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function applyHistoryFilter() {
  const fromVal = document.getElementById('historyFrom').value;
  const toVal = document.getElementById('historyTo').value;
  const fromTime = fromVal ? new Date(fromVal + 'T00:00:00').getTime() : null;
  const toTime = toVal ? new Date(toVal + 'T23:59:59').getTime() : null;

  const filtered = wishHistoryCache.filter((h) => {
    const t = new Date(h.timestamp).getTime();
    if (fromTime !== null && t < fromTime) return false;
    if (toTime !== null && t > toTime) return false;
    return true;
  });

  const fullEl = document.getElementById('historyListFull');
  const emptyEl = document.getElementById('historyFullEmpty');
  const has = renderHistoryItems(fullEl, filtered, { editable: true });
  emptyEl.style.display = has ? 'none' : 'block';
}

document.querySelectorAll('.quick-filter-row button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quick-filter-row button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const { from, to } = computeQuickRange(btn.dataset.range);
    document.getElementById('historyFrom').value = toDateInputValue(from);
    document.getElementById('historyTo').value = toDateInputValue(to);
    applyHistoryFilter();
  });
});
['historyFrom', 'historyTo'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('.quick-filter-row button').forEach((b) => b.classList.remove('active'));
    applyHistoryFilter();
  });
});

// ============================================================
// 집안일
// ============================================================

let currentMonthState = (() => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
})();

function currentMonthStr() {
  return `${currentMonthState.y}-${String(currentMonthState.m).padStart(2, '0')}`;
}

function updateMonthLabel() {
  document.getElementById('monthLabel').textContent = `${currentMonthState.y}년 ${currentMonthState.m}월`;
}

function shiftMonth(delta) {
  let m = currentMonthState.m + delta;
  let y = currentMonthState.y;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  currentMonthState = { y, m };
  updateMonthLabel();
  loadAssignments(currentMonthStr());
}

document.getElementById('prevMonthBtn').addEventListener('click', () => shiftMonth(-1));
document.getElementById('nextMonthBtn').addEventListener('click', () => shiftMonth(1));
document.getElementById('monthLabel').addEventListener('click', () => {
  const hidden = document.getElementById('monthPickerHidden');
  hidden.value = currentMonthStr();
  if (hidden.showPicker) {
    try {
      hidden.showPicker();
      return;
    } catch (e) {
      /* fall through */
    }
  }
  hidden.focus();
});
document.getElementById('monthPickerHidden').addEventListener('change', (e) => {
  const v = e.target.value;
  if (/^\d{4}-\d{2}$/.test(v)) {
    const [y, m] = v.split('-').map(Number);
    currentMonthState = { y, m };
    updateMonthLabel();
    loadAssignments(currentMonthStr());
  }
});

async function loadChoresMaster() {
  choresCache = await api('/chores');
  return choresCache;
}

async function loadAssignments(month) {
  const list = await api('/assignments?month=' + encodeURIComponent(month));
  renderAssignmentCards(list);
  return list;
}

function renderAssignmentCards(list) {
  const container = document.getElementById('assignmentCards');
  const emptyEl = document.getElementById('assignmentEmpty');

  if (list.length === 0) {
    container.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  container.innerHTML = list
    .map((a) => {
      const chore = choresCache.find((c) => c.id === a.choreId);
      const note = chore && chore.note ? `<div class="chore-note">${escapeHtml(chore.note)}</div>` : '';
      const chips = [
        `<button type="button" class="chip unassigned${a.assignee ? '' : ' selected'}" data-assignment-id="${a.id}" data-assignee="">미정</button>`,
      ]
        .concat(
          membersCache.map((m) => {
            const selected = m.name === a.assignee;
            const cls = selected ? ' selected ' + memberColorClass(m.name) : '';
            return `<button type="button" class="chip${cls}" data-assignment-id="${a.id}" data-assignee="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>`;
          })
        )
        .join('');
      return `<div class="assignment-card" data-id="${a.id}">
        <div class="assignment-card-top">
          <div>
            <div class="chore-title">${escapeHtml(a.choreName)}</div>
            ${note}
          </div>
          <button type="button" class="remove-btn" data-remove-id="${a.id}" title="이 달에서 제거">✕</button>
        </div>
        <div class="chip-row">${chips}</div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const item = list.find((a) => a.id === chip.dataset.assignmentId);
      if (!item) return;
      const msgEl = document.getElementById('assignmentMsg');
      try {
        await api('/assignments', {
          method: 'POST',
          body: JSON.stringify({
            month: currentMonthStr(),
            choreId: item.choreId,
            assignee: chip.dataset.assignee,
          }),
        });
        loadAssignments(currentMonthStr());
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });

  container.querySelectorAll('[data-remove-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgEl = document.getElementById('assignmentMsg');
      try {
        await api('/assignments/' + btn.dataset.removeId, { method: 'DELETE' });
        loadAssignments(currentMonthStr());
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });
}

// ---- 이 달에 집안일 추가 ----
document.getElementById('openAddChoreModalBtn').addEventListener('click', openAddChoreModal);

async function openAddChoreModal() {
  await loadChoresMaster();
  const assignments = await api('/assignments?month=' + encodeURIComponent(currentMonthStr()));
  const existingIds = new Set(assignments.map((a) => a.choreId));
  const available = choresCache.filter((c) => !existingIds.has(c.id));

  const listEl = document.getElementById('availableChoreList');
  const emptyEl = document.getElementById('availableChoreEmpty');

  if (available.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    listEl.innerHTML = available
      .map((c) => `<div class="available-item"><span>${escapeHtml(c.name)}</span><button data-id="${c.id}">추가</button></div>`)
      .join('');
    listEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const msgEl = document.getElementById('addChoreMsg');
        try {
          await api('/assignments/add', {
            method: 'POST',
            body: JSON.stringify({ month: currentMonthStr(), choreId: btn.dataset.id }),
          });
          showMsg(msgEl, '추가했어요!', true);
          loadAssignments(currentMonthStr());
          openAddChoreModal();
        } catch (e) {
          showMsg(msgEl, e.message, false);
        }
      });
    });
  }
  openModal('addChoreModal');
}

// ---- 집안일 목록 관리 (마스터 카탈로그) ----
document.getElementById('openChoreSettingsBtn').addEventListener('click', () => {
  renderChoreManageList();
  openModal('choreSettingsModal');
});

async function renderChoreManageList() {
  await loadChoresMaster();
  const el = document.getElementById('choreManageList');
  if (choresCache.length === 0) {
    el.innerHTML = '<p class="empty">등록된 집안일이 없어요.</p>';
    return;
  }
  el.innerHTML = choresCache
    .map(
      (c) => `
      <div class="manage-item" data-id="${c.id}">
        <div class="form-row"><input type="text" class="chore-name-input" value="${escapeHtml(c.name)}" /></div>
        <div class="form-row"><textarea class="chore-note-input" rows="2" placeholder="상세 메모 (선택)">${escapeHtml(c.note || '')}</textarea></div>
        <div class="manage-item-actions">
          <button type="button" class="delete-btn" data-id="${c.id}">삭제</button>
          <button type="button" class="save-btn" data-id="${c.id}">저장</button>
        </div>
      </div>`
    )
    .join('');

  el.querySelectorAll('.save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const wrap = btn.closest('.manage-item');
      const name = wrap.querySelector('.chore-name-input').value.trim();
      const note = wrap.querySelector('.chore-note-input').value;
      const msgEl = document.getElementById('choreMsg');
      if (!name) {
        showMsg(msgEl, '이름을 입력해주세요.', false);
        return;
      }
      try {
        await api('/chores/' + btn.dataset.id, {
          method: 'PATCH',
          body: JSON.stringify({ name, note }),
        });
        showMsg(msgEl, '저장했어요!', true);
        await loadChoresMaster();
        loadAssignments(currentMonthStr());
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });

  el.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msgEl = document.getElementById('choreMsg');
      try {
        await api('/chores/' + btn.dataset.id, { method: 'DELETE' });
        showMsg(msgEl, '삭제했어요. (과거 배정 기록은 그대로 남아요)', true);
        renderChoreManageList();
        loadAssignments(currentMonthStr());
      } catch (e) {
        showMsg(msgEl, e.message, false);
      }
    });
  });
}

document.getElementById('addChoreBtn').addEventListener('click', async () => {
  const nameInput = document.getElementById('newChoreName');
  const noteInput = document.getElementById('newChoreNote');
  const msgEl = document.getElementById('choreMsg');
  const name = nameInput.value.trim();
  const note = noteInput.value.trim();
  if (!name) {
    showMsg(msgEl, '이름을 입력해주세요.', false);
    return;
  }
  try {
    await api('/chores', { method: 'POST', body: JSON.stringify({ name, note }) });
    nameInput.value = '';
    noteInput.value = '';
    showMsg(msgEl, '추가했어요!', true);
    renderChoreManageList();
  } catch (e) {
    showMsg(msgEl, e.message, false);
  }
});

// ---- 집안일 뽑기 ----
// 담당자(사람)는 이미 정해진 상태에서, 그 사람이 어떤 미정 집안일을 맡을지를 랜덤으로 뽑는다.
let drawPendingItems = []; // 이번 달 배정 중 미정(assignee === '')인 것들
let currentDrawnItem = null; // 이번 라운드에 뽑힌 집안일 (아직 "적용" 전, 미리보기 상태)

document.getElementById('openDrawModalBtn').addEventListener('click', openDrawModal);

async function openDrawModal() {
  document.getElementById('drawMsg').textContent = '';
  document.getElementById('drawResultWrap').style.display = 'none';
  currentDrawnItem = null;

  populateDrawMemberSelect();
  await refreshDrawPending();
  openModal('drawModal');
}

function populateDrawMemberSelect() {
  const select = document.getElementById('drawMemberSelect');
  select.innerHTML = membersCache
    .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`)
    .join('');
}

async function refreshDrawPending() {
  const assignments = await api('/assignments?month=' + encodeURIComponent(currentMonthStr()));
  drawPendingItems = assignments.filter((a) => !a.assignee);

  const listEl = document.getElementById('drawPendingList');
  const emptyEl = document.getElementById('drawEmpty');
  const introEl = document.getElementById('drawIntro');
  const controlsEl = document.getElementById('drawControls');

  if (drawPendingItems.length === 0) {
    listEl.innerHTML = '';
    introEl.textContent = '';
    emptyEl.style.display = 'block';
    controlsEl.style.display = 'none';
  } else {
    emptyEl.style.display = 'none';
    controlsEl.style.display = 'block';
    introEl.textContent = `아직 미정인 집안일이 ${drawPendingItems.length}개 남았어요.`;
    listEl.innerHTML = drawPendingItems
      .map(
        (a) => `<div class="draw-item"><span>${escapeHtml(a.choreName)}</span><span class="chip unassigned selected">미정</span></div>`
      )
      .join('');
  }
}

function runDraw() {
  if (drawPendingItems.length === 0) return;
  currentDrawnItem = drawPendingItems[Math.floor(Math.random() * drawPendingItems.length)];
  const member = document.getElementById('drawMemberSelect').value;

  const resultBox = document.getElementById('drawResultBox');
  resultBox.innerHTML = `<div class="draw-pop">
    <span class="name-badge ${memberColorClass(member)}">${escapeHtml(member)}</span>
    <span class="draw-arrow">→</span>
    <span class="draw-chore-name">${escapeHtml(currentDrawnItem.choreName)}</span>
  </div>`;

  document.getElementById('drawResultWrap').style.display = 'block';
}

document.getElementById('startDrawBtn').addEventListener('click', runDraw);
document.getElementById('redrawBtn').addEventListener('click', runDraw);

document.getElementById('applyDrawBtn').addEventListener('click', async () => {
  if (!currentDrawnItem) return;
  const msgEl = document.getElementById('drawMsg');
  const member = document.getElementById('drawMemberSelect').value;
  try {
    await api('/assignments', {
      method: 'POST',
      body: JSON.stringify({ month: currentMonthStr(), choreId: currentDrawnItem.choreId, assignee: member }),
    });
    showMsg(msgEl, `"${currentDrawnItem.choreName}" → ${member}(으)로 적용했어요!`, true);
    loadAssignments(currentMonthStr());

    currentDrawnItem = null;
    closeModal('drawModal');
  } catch (e) {
    showMsg(msgEl, e.message, false);
  }
});
