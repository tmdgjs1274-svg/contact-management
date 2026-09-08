require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { ensureSchema } = require('./src/sheets');
const { requireAuth, loginHandler, logoutHandler, sessionHandler } = require('./src/auth');
const apiRouter = require('./src/routes/api');

const app = express();

app.use(express.json());

app.set('trust proxy', 1); // Render 는 프록시 뒤에서 동작하므로 secure 쿠키가 제대로 동작하려면 필요

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30일
    },
  })
);

// 인증 없이 접근 가능한 API
app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);
app.get('/api/session', sessionHandler);

// 나머지 API 는 로그인 필요
app.use('/api', requireAuth, apiRouter);

// 정적 파일 (로그인 페이지 포함)
app.use(express.static(path.join(__dirname, 'public')));

// 그 외 모든 경로는 SPA 진입점으로
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 에러 핸들러 (API 라우트에서 next(err) 로 넘어온 것들)
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message || '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 3000;

ensureSchema()
  .then(() => {
    console.log('구글 시트 스키마 확인 완료');
  })
  .catch((err) => {
    console.error('구글 시트 초기화 실패 (환경변수/시트 공유 설정을 확인하세요):', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    });
  });
