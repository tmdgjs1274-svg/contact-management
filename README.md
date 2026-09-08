# 🏡 우리집 홈 — 소원권 & 집안일 담당자 관리 웹앱

부부 두 분이 함께 쓰는 아주 작은 웹앱입니다.

- 💝 **소원권**: 서로 보유한 소원권 개수를 확인하고, 더하기/빼기(사유 포함) 할 수 있어요. 변경 이력이 전부 남습니다.
- 🧹 **집안일 담당자**: 집안일 목록을 자유롭게 추가/삭제하고, 월별로 담당자를 지정해서 볼 수 있어요.

데이터는 전부 **구글 시트(Google Sheets)**에 저장되고, 앱 자체는 **Render**에 무료로 배포합니다.
로그인은 회원가입 없이 **두 분만 아는 공유 비밀번호 하나**로 되어 있어요.

> 💡 **이미 Render에 배포해두신 분**: 이 코드로 갈아끼우실 때는 환경변수를 새로 입력할 필요 없이,
> 기존 GitHub 저장소의 내용을 이 폴더 내용으로 덮어쓰고 다시 push 하시면 Render가 자동으로 재배포합니다.
> 앱이 다시 켜질 때 구글 시트의 `Chores` 탭에 `note`(메모) 컬럼이 자동으로 추가되고, 기존 데이터는 그대로 보존됩니다.
> `나`/`와이프`로 이미 만들어진 멤버 이름은 자동으로 바뀌지 않으니, 앱 안의 **소원권 → ⚙️ 소원권 관리 → 이름 설정**에서
> 원하는 이름으로 바꾸시거나, 구글 시트의 `Members` 탭에서 직접 수정하셔도 됩니다.

---

## 0. 전체 그림

```
[브라우저] --- (비밀번호 로그인) ---> [Render 에 올라간 웹앱]
                                          |
                                          v
                                   [구글 시트 (DB 역할)]
```

앱이 처음 켜질 때 구글 시트 안에 필요한 탭(Members, WishTokenLog, Chores, ChoreAssignments)을
**자동으로 만들어줍니다.** 여러분은 빈 시트 하나만 준비하시면 됩니다.

---

## 1. 구글 클라우드 설정 (구글 시트 API 사용 권한 만들기)

1. [Google Cloud Console](https://console.cloud.google.com/) 접속 → 새 프로젝트 생성 (이름 아무거나, 예: `our-home-app`)
2. 좌측 메뉴에서 **"API 및 서비스" → "라이브러리"** 이동 → `Google Sheets API` 검색 → **사용 설정**
3. **"API 및 서비스" → "사용자 인증 정보"** 이동 → **"사용자 인증 정보 만들기" → "서비스 계정"** 선택
   - 이름 아무거나 입력 (예: `sheets-bot`) → 완료 (역할 부여는 건너뛰어도 됩니다)
4. 생성된 서비스 계정 클릭 → 상단 **"키" 탭** → **"키 추가" → "새 키 만들기"** → JSON 선택 → 다운로드
   - `xxxxx.json` 파일이 다운로드됩니다. **이 파일 안에 중요한 정보가 들어있으니 남에게 공유하지 마세요.**
5. 다운로드한 JSON 파일을 열어보면 아래 두 값이 있습니다. 이 값들을 나중에 환경변수로 사용합니다.
   - `client_email` → 예: `sheets-bot@our-home-app.iam.gserviceaccount.com`
   - `private_key` → `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` 형태의 긴 문자열

---

## 2. 구글 시트 준비

1. [Google 드라이브](https://drive.google.com)에서 새 **Google 스프레드시트**를 하나 만듭니다. (이름은 자유롭게, 예: `우리집 홈 DB`)
2. 시트 우측 상단 **"공유"** 버튼 클릭 → 위에서 확인한 `client_email` 주소를 추가 → 권한은 **"편집자(Editor)"**로 설정 → 공유
   - ⚠️ 이 단계를 빼먹으면 앱이 시트에 접근하지 못합니다.
3. 시트 주소창의 URL을 확인하세요.
   ```
   https://docs.google.com/spreadsheets/d/1AbCDeFGhiJKLmnoPQRstuVWxyZ/edit
                                          └────────── 이 부분이 스프레드시트 ID ─────────┘
   ```
   이 ID 값을 나중에 환경변수로 사용합니다.

---

## 3. 로컬에서 먼저 테스트 (선택사항이지만 추천)

```bash
cd couple-home-app
npm install
cp .env.example .env
```

`.env` 파일을 열어서 아래 값들을 채워주세요.

- `SHARED_PASSWORD`: 두 분이 로그인할 때 쓸 비밀번호
- `SESSION_SECRET`: 아무 임의의 긴 문자열 (예: 키보드로 대충 길게 입력)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: 1번에서 확인한 `client_email`
- `GOOGLE_PRIVATE_KEY`: 1번에서 확인한 `private_key` (줄바꿈 `\n` 그대로, 큰따옴표로 감싸기)
- `GOOGLE_SPREADSHEET_ID`: 2번에서 확인한 스프레드시트 ID

그 다음 실행:

```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속 → 비밀번호 입력 → 정상적으로 화면이 뜨면 성공입니다.
(콘솔에 "구글 시트 스키마 확인 완료" 로그가 뜨면 시트에 자동으로 탭들이 생성된 것입니다. 시트를 새로고침해서 확인해보세요.)

---

## 4. GitHub에 올리기

Render는 GitHub 저장소를 연결해서 배포하는 방식이 제일 간편합니다.

```bash
cd couple-home-app
git init
git add .
git commit -m "Initial commit"
```

GitHub에서 새 저장소(Public 또는 Private 둘 다 가능)를 만든 뒤:

```bash
git remote add origin <여러분의 저장소 URL>
git branch -M main
git push -u origin main
```

`.env` 파일은 `.gitignore`에 이미 포함되어 있어서 GitHub에는 올라가지 않습니다 (안전합니다).

---

## 5. Render에 배포

1. [Render](https://render.com) 가입/로그인
2. **"New +" → "Web Service"** 선택
3. 방금 만든 GitHub 저장소 연결
4. 설정값:
   - **Name**: 원하는 이름 (예: `our-home-app`)
   - **Region**: Singapore 등 가까운 지역
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free 로 충분합니다
5. **"Environment Variable"** 항목에서 아래 값들을 하나씩 추가:

   | Key | Value |
   |---|---|
   | `SHARED_PASSWORD` | 두 분이 쓸 비밀번호 |
   | `SESSION_SECRET` | 임의의 긴 문자열 |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | 서비스 계정 이메일 |
   | `GOOGLE_PRIVATE_KEY` | 서비스 계정 private key (아래 주의사항 참고) |
   | `GOOGLE_SPREADSHEET_ID` | 스프레드시트 ID |
   | `NODE_ENV` | `production` |

   > **`GOOGLE_PRIVATE_KEY` 붙여넣기 주의사항**
   > JSON 파일에 있는 값을 그대로 복사해서 붙여넣으면 됩니다. `\n` 이 실제 줄바꿈이 아니라 문자 그대로 들어있어도
   > 코드에서 자동으로 변환하도록 되어 있으니 걱정하지 않으셔도 됩니다. 값 앞뒤에 큰따옴표(")는 넣지 않습니다
   > (Render 환경변수 입력창은 따옴표 없이 값만 넣는 곳입니다).

6. **"Create Web Service"** 클릭 → 몇 분 기다리면 배포 완료
7. 제공된 주소(`https://our-home-app.onrender.com` 같은 형태)로 접속 → 비밀번호 입력 → 사용 시작!

> 💡 Render 무료 플랜은 일정 시간 요청이 없으면 서버가 잠들었다가, 다시 접속할 때 10~30초 정도
> 깨어나는 시간이 걸릴 수 있어요. 정상적인 동작이니 당황하지 않으셔도 됩니다.

---

## 6. 사용법 요약

- **소원권 탭**: 대상(나/와이프) 선택 → 개수 선택(+/− 버튼) → 사유 입력 → "더하기로 적용" 또는 "빼기로 적용" 클릭
  - 하단에 최근 100건까지 변경 이력이 표시됩니다.
- **집안일 탭**: 상단 월 선택 후, 각 집안일 옆 드롭다운에서 담당자 선택 → 자동 저장
  - "⚙️ 집안일 목록 관리"를 펼치면 집안일을 추가/삭제할 수 있습니다 (삭제해도 과거 배정 기록은 남습니다).

멤버(나/와이프)나 집안일 초기 목록은 구글 시트의 `Members`, `Chores` 탭에서 직접 수정하셔도 됩니다.

---

## 7. 자주 발생하는 문제

- **로그인 후 화면에 오류가 뜬다 / 데이터가 안 보인다**
  → 구글 시트를 서비스 계정 이메일과 "편집자"로 공유했는지, `GOOGLE_SPREADSHEET_ID` 값이 정확한지 확인하세요.
- **`GOOGLE_PRIVATE_KEY` 관련 오류**
  → Render 환경변수에 값을 붙여넣을 때 앞뒤 공백이나 따옴표가 섞여 들어가지 않았는지 확인하세요.
- **비밀번호가 안 맞다고 나온다**
  → `SHARED_PASSWORD` 환경변수가 Render에 정확히 설정되어 있는지 확인하세요.

---

## 8. 폴더 구조

```
couple-home-app/
├── server.js                # 앱 진입점 (Express 서버, 세션, 라우팅)
├── src/
│   ├── sheets.js             # 구글 시트 연동 (읽기/쓰기/스키마 자동 생성)
│   ├── auth.js                # 공유 비밀번호 로그인/세션
│   └── routes/api.js         # 소원권 / 집안일 API
├── public/
│   ├── login.html
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── package.json
└── .env.example
```
