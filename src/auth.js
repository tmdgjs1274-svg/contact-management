// 아주 단순한 "공유 비밀번호 1개" 인증.
// 회원가입/개인 계정 없이, 두 사람만 아는 비밀번호로 세션을 발급한다.

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

function loginHandler(req, res) {
  const correct = process.env.SHARED_PASSWORD;
  if (!correct) {
    return res
      .status(500)
      .json({ error: '서버에 SHARED_PASSWORD 환경변수가 설정되어 있지 않습니다.' });
  }
  const { password } = req.body || {};
  if (typeof password === 'string' && password === correct) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
}

function logoutHandler(req, res) {
  req.session.destroy(() => res.json({ ok: true }));
}

function sessionHandler(req, res) {
  res.json({ authenticated: !!(req.session && req.session.authed) });
}

module.exports = { requireAuth, loginHandler, logoutHandler, sessionHandler };
