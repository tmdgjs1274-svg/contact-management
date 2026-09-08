const express = require('express');
const { readSheet, appendRow, updateRow, nextId } = require('../sheets');

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
// 현재 잔여 개수 + 최근 이력
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
      .slice(0, 100)
      .map((l) => ({
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

// ---------- 집안일 목록 ----------
router.get('/chores', async (req, res, next) => {
  try {
    const chores = await readSheet('Chores');
    const activeOnly = req.query.all !== '1';
    const list = chores
      .filter((c) => !activeOnly || String(c.active).toUpperCase() !== 'FALSE')
      .map((c) => ({ id: c.id, name: c.name, active: String(c.active).toUpperCase() !== 'FALSE' }));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

router.post('/chores', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '집안일 이름을 입력해주세요.' });
    }
    const chores = await readSheet('Chores');
    const id = nextId(chores);
    const entry = { id, name: String(name).trim(), active: 'TRUE' };
    await appendRow('Chores', entry);
    res.json(entry);
  } catch (err) {
    next(err);
  }
});

// 집안일 삭제는 소프트 삭제(active=FALSE) - 과거 배정 이력은 그대로 보존
router.delete('/chores/:id', async (req, res, next) => {
  try {
    const chores = await readSheet('Chores');
    const target = chores.find((c) => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 집안일을 찾을 수 없습니다.' });
    await updateRow('Chores', target._row, { id: target.id, name: target.name, active: 'FALSE' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/chores/:id', async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const chores = await readSheet('Chores');
    const target = chores.find((c) => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: '해당 집안일을 찾을 수 없습니다.' });
    const newName = name && String(name).trim() ? String(name).trim() : target.name;
    await updateRow('Chores', target._row, { id: target.id, name: newName, active: target.active });
    res.json({ id: target.id, name: newName });
  } catch (err) {
    next(err);
  }
});

// ---------- 월별 담당자 배정 ----------
// GET /api/assignments?month=2026-09
router.get('/assignments', async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month 는 YYYY-MM 형식이어야 합니다.' });
    }
    const [chores, assignments] = await Promise.all([
      readSheet('Chores'),
      readSheet('ChoreAssignments'),
    ]);

    const activeChores = chores.filter((c) => String(c.active).toUpperCase() !== 'FALSE');
    const result = activeChores.map((c) => {
      const found = assignments.find((a) => a.month === month && a.choreId === c.id);
      return {
        choreId: c.id,
        choreName: c.name,
        assignee: found ? found.assignee : '',
        updatedAt: found ? found.updatedAt : '',
      };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/assignments { month, choreId, assignee }
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
    } else {
      const id = nextId(assignments);
      await appendRow('ChoreAssignments', {
        id,
        month,
        choreId: String(choreId),
        choreName: chore.name,
        assignee: assignee || '',
        updatedAt,
      });
    }

    res.json({ month, choreId: String(choreId), choreName: chore.name, assignee: assignee || '', updatedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
