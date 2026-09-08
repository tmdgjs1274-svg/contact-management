const express = require('express');
const { readSheet, appendRow, updateRow, deleteRow, nextId } = require('../sheets');

const router = express.Router();

// ---------- 공통: 멤버 ----------
router.get('/members', async (req, res, next) => {
  try {
    const members = await readSheet('Members');
    res.json(members.map((m) => ({ id: m.id, name: m.name })));
  } catch (err) {
    next(err);
  }
});

router.post('/members', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '이름을 입력해주세요.' });
    }
    const members = await readSheet('Members');
    const id = nextId(members);
    await appendRow('Members', { id, name: String(name).trim() });
    res.json({ id, name: String(name).trim() });
  } catch (err) {
    next(err);
  }
});

router.patch('/members/:id', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '이름을 입력해주세요.' });
    }
    const members = await readSheet('Members');
    const target = members.find((m) => m.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 멤버를 찾을 수 없습니다.' });
    await updateRow('Members', target._row, { id: target.id, name: String(name).trim() });
    res.json({ id: target.id, name: String(name).trim() });
  } catch (err) {
    next(err);
  }
});

// ---------- 소원권 ----------
// 현재 잔여 개수 + 최근 이력 (최대 100건, 프론트에서 필요한 만큼만 잘라 씀)
router.get('/wish-tokens', async (req, res, next) => {
  try {
    const [members, log] = await Promise.all([readSheet('Members'), readSheet('WishTokenLog')]);

    const balances = members.map((m) => {
      const total = log
        .filter((l) => l.member === m.name)
        .reduce((sum, l) => sum + (parseInt(l.delta, 10) || 0), 0);
      return { id: m.id, name: m.name, balance: total };
    });

    const history = log
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .map((l) => ({
        id: l.id,
        timestamp: l.timestamp,
        member: l.member,
        delta: parseInt(l.delta, 10) || 0,
        reason: l.reason,
        balanceAfter: parseInt(l.balanceAfter, 10) || 0,
      }));

    res.json({ balances, history });
  } catch (err) {
    next(err);
  }
});

// 특정 멤버의 이력을 시간순으로 다시 훑으며 balanceAfter(그 시점까지의 누적 잔여)를 재계산한다.
// 이력을 수정하거나 삭제하면 그 뒤에 이어지는 기록들의 "변경 후 잔여" 표시가 어긋나므로 항상 다시 맞춰준다.
async function recomputeBalanceAfter(memberName) {
  const log = await readSheet('WishTokenLog');
  const entries = log
    .filter((l) => l.member === memberName)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let running = 0;
  for (const entry of entries) {
    running += parseInt(entry.delta, 10) || 0;
    if (parseInt(entry.balanceAfter, 10) !== running) {
      await updateRow('WishTokenLog', entry._row, {
        id: entry.id,
        timestamp: entry.timestamp,
        member: entry.member,
        delta: entry.delta,
        reason: entry.reason,
        balanceAfter: running,
      });
    }
  }
}

// 이력 한 건 수정 (대상/변경량/사유). 대상이나 변경량이 바뀌면 관련된 멤버들의 잔여 이력을 다시 계산한다.
router.patch('/wish-tokens/:id', async (req, res, next) => {
  try {
    const { member, delta, reason } = req.body || {};
    const log = await readSheet('WishTokenLog');
    const target = log.find((l) => l.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 이력을 찾을 수 없습니다.' });

    const members = await readSheet('Members');
    const newMember = member !== undefined && member ? String(member) : target.member;
    const newDelta = delta !== undefined ? parseInt(delta, 10) : parseInt(target.delta, 10);
    const newReason = reason !== undefined ? String(reason).trim() : target.reason;

    if (!members.some((m) => m.name === newMember)) {
      return res.status(400).json({ error: '존재하지 않는 멤버입니다.' });
    }
    if (!Number.isFinite(newDelta) || newDelta === 0) {
      return res.status(400).json({ error: '변경량은 0이 아닌 정수여야 합니다.' });
    }

    const oldMember = target.member;
    await updateRow('WishTokenLog', target._row, {
      id: target.id,
      timestamp: target.timestamp,
      member: newMember,
      delta: newDelta,
      reason: newReason,
      balanceAfter: target.balanceAfter, // 아래 recomputeBalanceAfter 에서 다시 계산됨
    });

    await recomputeBalanceAfter(newMember);
    if (oldMember !== newMember) await recomputeBalanceAfter(oldMember);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 이력 한 건 삭제
router.delete('/wish-tokens/:id', async (req, res, next) => {
  try {
    const log = await readSheet('WishTokenLog');
    const target = log.find((l) => l.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 이력을 찾을 수 없습니다.' });
    const member = target.member;
    await deleteRow('WishTokenLog', target._row);
    await recomputeBalanceAfter(member);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 더하기/빼기 (delta 는 양수/음수 정수)
router.post('/wish-tokens/adjust', async (req, res, next) => {
  try {
    const { member, delta, reason } = req.body || {};
    const deltaNum = parseInt(delta, 10);

    if (!member || !Number.isFinite(deltaNum) || deltaNum === 0) {
      return res.status(400).json({ error: '대상, 변경량(0이 아닌 정수)을 확인해주세요.' });
    }

    const [members, log] = await Promise.all([readSheet('Members'), readSheet('WishTokenLog')]);
    const memberExists = members.some((m) => m.name === member);
    if (!memberExists) {
      return res.status(400).json({ error: '존재하지 않는 멤버입니다.' });
    }

    const currentBalance = log
      .filter((l) => l.member === member)
      .reduce((sum, l) => sum + (parseInt(l.delta, 10) || 0), 0);
    const balanceAfter = currentBalance + deltaNum;

    const id = nextId(log);
    const entry = {
      id,
      timestamp: new Date().toISOString(),
      member,
      delta: deltaNum,
      reason: reason ? String(reason).trim() : '',
      balanceAfter,
    };
    await appendRow('WishTokenLog', entry);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// ---------- 집안일 목록 (마스터 카탈로그) ----------
router.get('/chores', async (req, res, next) => {
  try {
    const chores = await readSheet('Chores');
    const activeOnly = req.query.all !== '1';
    const list = chores
      .filter((c) => !activeOnly || String(c.active).toUpperCase() !== 'FALSE')
      .map((c) => ({
        id: c.id,
        name: c.name,
        note: c.note || '',
        active: String(c.active).toUpperCase() !== 'FALSE',
      }));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/chores', async (req, res, next) => {
  try {
    const { name, note } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '집안일 이름을 입력해주세요.' });
    }
    const chores = await readSheet('Chores');
    const id = nextId(chores);
    const entry = { id, name: String(name).trim(), active: 'TRUE', note: note ? String(note).trim() : '' };
    await appendRow('Chores', entry);
    res.json({ id: entry.id, name: entry.name, note: entry.note, active: true });
  } catch (err) {
    next(err);
  }
});

// 집안일 삭제는 소프트 삭제(active=FALSE) - 과거 월별 배정 이력은 choreName 스냅샷으로 그대로 보존됨
router.delete('/chores/:id', async (req, res, next) => {
  try {
    const chores = await readSheet('Chores');
    const target = chores.find((c) => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 집안일을 찾을 수 없습니다.' });
    await updateRow('Chores', target._row, {
      id: target.id,
      name: target.name,
      active: 'FALSE',
      note: target.note || '',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/chores/:id', async (req, res, next) => {
  try {
    const { name, note } = req.body || {};
    const chores = await readSheet('Chores');
    const target = chores.find((c) => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 집안일을 찾을 수 없습니다.' });
    const newName = name && String(name).trim() ? String(name).trim() : target.name;
    const newNote = note !== undefined ? String(note).trim() : target.note || '';
    await updateRow('Chores', target._row, {
      id: target.id,
      name: newName,
      active: target.active,
      note: newNote,
    });
    res.json({ id: target.id, name: newName, note: newNote });
  } catch (err) {
    next(err);
  }
});

// ---------- 월별 담당자 배정 ----------
// GET /api/assignments?month=2026-09
// 그 달에 "실제로 추가된" 배정 행만 돌려준다 (마스터 목록에서 삭제된 집안일이라도 과거 배정 기록은 그대로 남는다)
router.get('/assignments', async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month 는 YYYY-MM 형식이어야 합니다.' });
    }
    const assignments = await readSheet('ChoreAssignments');
    const result = assignments
      .filter((a) => a.month === month)
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
      .map((a) => ({
        id: a.id,
        choreId: a.choreId,
        choreName: a.choreName,
        assignee: a.assignee,
        updatedAt: a.updatedAt,
      }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/assignments/add { month, choreId } - 마스터 목록의 집안일을 해당 월에 추가 (이미 있으면 그대로 반환)
router.post('/assignments/add', async (req, res, next) => {
  try {
    const { month, choreId } = req.body || {};
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !choreId) {
      return res.status(400).json({ error: 'month(YYYY-MM), choreId 를 확인해주세요.' });
    }
    const [chores, assignments] = await Promise.all([
      readSheet('Chores'),
      readSheet('ChoreAssignments'),
    ]);
    const chore = chores.find((c) => c.id === String(choreId));
    if (!chore) return res.status(400).json({ error: '존재하지 않는 집안일입니다.' });

    const existing = assignments.find((a) => a.month === month && a.choreId === String(choreId));
    if (existing) {
      return res.json({
        id: existing.id,
        choreId: existing.choreId,
        choreName: existing.choreName,
        assignee: existing.assignee,
        updatedAt: existing.updatedAt,
      });
    }

    const id = nextId(assignments);
    const updatedAt = new Date().toISOString();
    const entry = {
      id,
      month,
      choreId: String(choreId),
      choreName: chore.name,
      assignee: '',
      updatedAt,
    };
    await appendRow('ChoreAssignments', entry);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/assignments { month, choreId, assignee } - 담당자 변경(칩 클릭 시 사용). 해당 월에 아직 없으면 새로 만든다.
router.post('/assignments', async (req, res, next) => {
  try {
    const { month, choreId, assignee } = req.body || {};
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !choreId) {
      return res.status(400).json({ error: 'month(YYYY-MM), choreId 를 확인해주세요.' });
    }

    const [chores, assignments, members] = await Promise.all([
      readSheet('Chores'),
      readSheet('ChoreAssignments'),
      readSheet('Members'),
    ]);
    const chore = chores.find((c) => c.id === String(choreId));
    if (!chore) return res.status(400).json({ error: '존재하지 않는 집안일입니다.' });
    if (assignee && !members.some((m) => m.name === assignee)) {
      return res.status(400).json({ error: '존재하지 않는 멤버입니다.' });
    }

    const existing = assignments.find((a) => a.month === month && a.choreId === String(choreId));
    const updatedAt = new Date().toISOString();

    if (existing) {
      await updateRow('ChoreAssignments', existing._row, {
        id: existing.id,
        month,
        choreId: String(choreId),
        choreName: chore.name,
        assignee: assignee || '',
        updatedAt,
      });
      return res.json({ id: existing.id, month, choreId: String(choreId), choreName: chore.name, assignee: assignee || '', updatedAt });
    }

    const id = nextId(assignments);
    const entry = {
      id,
      month,
      choreId: String(choreId),
      choreName: chore.name,
      assignee: assignee || '',
      updatedAt,
    };
    await appendRow('ChoreAssignments', entry);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/assignments/:id - 이 달의 배정 카드에서만 제거 (마스터 목록/다른 달에는 영향 없음)
router.delete('/assignments/:id', async (req, res, next) => {
  try {
    const assignments = await readSheet('ChoreAssignments');
    const target = assignments.find((a) => a.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 배정을 찾을 수 없습니다.' });
    await deleteRow('ChoreAssignments', target._row);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
