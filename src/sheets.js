// Google Sheets 를 DB처럼 사용하기 위한 얇은 레이어.
// - 서비스 계정으로 인증
// - 시트(탭)를 표 형태(헤더행 + 데이터행)로 읽고/쓰고/추가하는 범용 헬퍼
// - 앱 시작 시 필요한 탭이 없으면 자동으로 만들어주는 ensureSchema()

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// 이 앱이 사용하는 탭(시트)과 각 탭의 컬럼 정의
const SCHEMA = {
  Members: ['id', 'name'],
  WishTokenLog: ['id', 'timestamp', 'member', 'delta', 'reason', 'balanceAfter'],
  Chores: ['id', 'name', 'active'],
  ChoreAssignments: ['id', 'month', 'choreId', 'choreName', 'assignee', 'updatedAt'],
};

let cachedClient = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY 환경변수가 설정되지 않았습니다. README.md 를 참고해 설정해주세요.'
    );
  }
  // .env 나 Render 환경변수에 저장하면 개행이 \n 문자열로 들어오는 경우가 많아 실제 개행으로 변환
  const privateKey = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT(email, null, privateKey, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
}

async function getSheetsClient() {
  if (cachedClient) return cachedClient;
  if (!SPREADSHEET_ID) {
    throw new Error('GOOGLE_SPREADSHEET_ID 환경변수가 설정되지 않았습니다.');
  }
  const auth = getAuth();
  await auth.authorize();
  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

// 숫자 -> 스프레드시트 컬럼 문자 (1 -> A, 27 -> AA ...)
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 헤더 행만 읽어서 있는지 확인
async function readHeaderRow(sheetsApi, title) {
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1:Z1`,
  });
  return (res.data.values || [])[0] || [];
}

// 탭 전체를 [{...}, ...] 형태 객체 배열로 읽기. 각 객체에는 실제 시트 행 번호(_row)도 포함.
async function readSheet(title) {
  const sheetsApi = await getSheetsClient();
  const headers = SCHEMA[title];
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1:${colLetter(headers.length)}100000`,
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
}

// 새 행 추가
async function appendRow(title, rowObject) {
  const sheetsApi = await getSheetsClient();
  const headers = SCHEMA[title];
  const values = [headers.map((h) => (rowObject[h] !== undefined ? rowObject[h] : ''))];
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

// 기존 행(rowNumber = 시트상 실제 행번호, readSheet 결과의 _row) 덮어쓰기
async function updateRow(title, rowNumber, rowObject) {
  const sheetsApi = await getSheetsClient();
  const headers = SCHEMA[title];
  const values = [headers.map((h) => (rowObject[h] !== undefined ? rowObject[h] : ''))];
  const range = `${title}!A${rowNumber}:${colLetter(headers.length)}${rowNumber}`;
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

async function seedDefaults(title) {
  if (title === 'Members') {
    await appendRow('Members', { id: '1', name: '나' });
    await appendRow('Members', { id: '2', name: '와이프' });
  }
  if (title === 'Chores') {
    const defaults = ['설거지', '빨래', '청소기 돌리기', '쓰레기 버리기', '화장실 청소'];
    for (let i = 0; i < defaults.length; i++) {
      await appendRow('Chores', { id: String(i + 1), name: defaults[i], active: 'TRUE' });
    }
  }
}

// 앱 시작 시 1회 호출: 필요한 탭이 스프레드시트에 없으면 만들고, 헤더가 없으면 헤더를 쓰고 기본값을 시딩한다.
async function ensureSchema() {
  const sheetsApi = await getSheetsClient();
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existingTitles = (meta.data.sheets || []).map((s) => s.properties.title);

  const missing = Object.keys(SCHEMA).filter((t) => !existingTitles.includes(t));
  if (missing.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  for (const title of Object.keys(SCHEMA)) {
    const headerRow = await readHeaderRow(sheetsApi, title);
    if (!headerRow || headerRow.length === 0) {
      await sheetsApi.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${title}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [SCHEMA[title]] },
      });
      await seedDefaults(title);
    }
  }
}

function nextId(records) {
  const max = records.reduce((m, r) => {
    const n = parseInt(r.id, 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1);
}

module.exports = {
  SCHEMA,
  readSheet,
  appendRow,
  updateRow,
  ensureSchema,
  nextId,
};
