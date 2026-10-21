import assert from "node:assert/strict"; // 인증 결과 검증
import { execFileSync, spawn } from "node:child_process"; // 실제 PHP와 MySQL 실행
import { randomBytes } from "node:crypto"; // 독립 DB 이름 생성
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"; // 비공개 검증 파일 관리
import net from "node:net"; // 임의 포트 확인
import path from "node:path"; // 운영체제 경로 처리
import { fileURLToPath } from "node:url"; // 프로젝트 경로 변환
import test from "node:test"; // 기본 테스트 실행
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // 실제 PHP 경로
const client = process.env.MYSQL_TEST_CLIENT || path.join(root, ".runtime/mysql/mysql-8.4.13-winx64/bin/mysql.exe"); // 실제 MySQL 경로
const port = process.env.MYSQL_TEST_PORT || "33360"; // 테스트 MySQL 포트
const database = "systemmakers_auth_test_" + randomBytes(6).toString("hex"); // 삭제 가능한 독립 DB
function sql(statement, selected = true) // 실제 DB 요청
{
    const args = ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4"]; // 로컬 테스트 연결
    if (selected) // 독립 DB 선택 조건
    {
        args.push(database); // 테스트 DB 지정
    }
    return execFileSync(client, args, { input: statement, encoding: "utf8", windowsHide: true }).trim(); // 실제 SQL 결과
}
async function vacantPort() // 임시 서버 포트 확보
{
    const probe = net.createServer(); // 포트 탐색 서버
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 임의 포트 할당
    const value = probe.address().port; // 할당 번호
    await new Promise((resolve) => probe.close(resolve)); // 탐색 서버 종료
    return value; // 사용 가능한 포트
}
test("실제 PHP·MySQL 회원 인증 계약", async (context) => // 모의 구현 없는 전체 인증 검증
{
    assert.match(database, /^systemmakers_auth_test_[a-f0-9]{12}$/); // 삭제 대상 이름 제한
    assert.match(port, /^\d+$/); // 포트 형식 제한
    assert.notEqual(port, "3306"); // 기존 기본 DB 접근 차단
    const work = path.join(root, ".runtime", database); // 외부 비공개 검증 폴더
    mkdirSync(path.join(work, "sessions"), { recursive: true }); // 독립 세션 저장소
    const base = root.replaceAll("\\", "/").replaceAll("'", "\\'"); // PHP 경로 인용
    const fixture = `<?php // 비공개 인증 테스트 라우터
require '${base}/backend/includes/bootstrap.php'; // 실제 공통 처리
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); // 실제 요청 경로
if ($route === '/ready') // 테스트 서버 준비 확인
{
    respond_success(['ready' => true]); // 준비 완료 응답
}
if ($route === '/expire') // 테스트 전용 수명 변경
{
    start_secure_session(); // 실제 세션 잠금
    $_SESSION['last_activity_at'] = time() - 1801; // 만료 시각 준비
    respond_success([]); // 세션 저장 후 응답
}
if ($route === '/key-missing') // 잘못된 로그인 설정 검사
{
    putenv('AUTH_RATE_LIMIT_KEY'); // 테스트 요청에만 키 제거
    $route = '/api/login.php'; // 실제 로그인 실행 경로
}
$allowed = ['csrf', 'get_current_user', 'health', 'register', 'login', 'logout']; // 실제 API 목록
$name = basename((string) $route, '.php'); // 엔드포인트 이름
if (in_array($name, $allowed, true) && is_file('${base}/backend/api/' . $name . '.php')) // 실제 구현 존재 조건
{
    require '${base}/backend/api/' . $name . '.php'; // 실제 API 실행
}
respond_error('NOT_FOUND', '경로 없음', 404); // 미구현 API 실패
`; // 검증용 PHP 소스 종료
    writeFileSync(path.join(work, "router.php"), fixture); // 공개 경로 밖 라우터 저장
    const servers = []; // 이 테스트의 PHP 서버 목록
    const origins = []; // 독립 서버 접속 주소
    let logs = ""; // 시작 실패 진단
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;", false); // 독립 DB 생성
    try // 실패 시에도 정리 보장
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 스키마 적용
        for (let index = 0; index < 4; index++) // 병렬 요청용 독립 PHP 프로세스
        {
            const httpPort = await vacantPort(); // 서버별 전용 포트
            const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0", AUTH_RATE_LIMIT_KEY: "auth-test-only-secret-key-32-bytes-minimum" }; // 격리된 테스트 설정
            const server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(work, "sessions"), "-S", "127.0.0.1:" + httpPort, "-t", work, path.join(work, "router.php")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }); // 실제 서버 시작
            server.stderr.on("data", (value) => // 서버 진단 수집
            {
                logs += value; // 실패 원인 기록
            }); // 수집 등록 종료
            servers.push(server); // 종료 대상 등록
            origins.push("http://127.0.0.1:" + httpPort); // 접속 주소 등록
        }
        async function request(route, options = {}, index = 0) // 실제 HTTP 요청
        {
            const response = await fetch(origins[index] + route, options); // 선택한 실제 PHP 서버 요청
            const body = await response.json(); // 실제 JSON 응답
            assert.match(response.headers.get("content-type"), /^application\/json; charset=utf-8$/i); // JSON 응답 계약
            assert.equal(response.headers.get("cache-control"), "no-store"); // 인증 응답 저장 차단
            return { response, body }; // 상태와 본문 반환
        }
        for (let index = 0; index < origins.length; index++) // 모든 서버 준비 확인
        {
            let ready = false; // 현재 서버 준비 여부
            for (let attempt = 0; attempt < 80; attempt++) // 제한된 준비 재시도
            {
                try // 서버 시작 중 연결 확인
                {
                    await request("/ready", {}, index); // 실제 준비 요청
                    ready = true; // 서버 준비 확인
                    break; // 확인 반복 종료
                }
                catch // 시작 전 연결 거절
                {
                    await new Promise((resolve) => setTimeout(resolve, 50)); // 짧은 시작 대기
                }
            }
            assert.ok(ready, logs); // 실제 시작 실패 진단
        }
        async function guest(index = 0) // 독립 게스트 세션 발급
        {
            const issued = await request("/api/csrf.php", {}, index); // 실제 CSRF 발급
            return { cookie: issued.response.headers.get("set-cookie").split(";")[0], token: issued.body.data.csrf_token }; // 실제 게스트 쿠키와 토큰
        }
        async function post(endpoint, body, session, extra = {}, index = 0) // 실제 보호 POST 요청
        {
            return request(endpoint.startsWith("/") ? endpoint : "/api/" + endpoint + ".php", { method: "POST", headers: { Cookie: session.cookie, "Content-Type": "application/json", "X-CSRF-Token": session.token, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) }, index); // 실제 입력과 CSRF 전달
        }
        function expectError(result, status, code) // 공통 오류 계약 확인
        {
            assert.equal(result.response.status, status, JSON.stringify(result.body)); // HTTP 상태 비교
            assert.equal(result.body.error.code, code); // 화면 분기 코드 비교
        }
        const password = "  OriginalPass123!  "; // 공백 유지 검증 비밀번호
        const member = { username: "  Test_User  ", email: "  Member@Example.COM  ", password }; // 정규화 검증 회원
        const session = await guest(); // 기본 게스트 발급
        let publicUser; // 가입된 공개 사용자
        await context.test("실제 가입·정규화·공개 필드·원문 비밀번호 해시", async () => // 평문 저장과 가입 자동 인증 포착
        {
            const result = await post("register", member, session); // 실제 회원가입
            assert.equal(result.response.status, 201, JSON.stringify(result.body)); // 저장 후 생성 상태
            publicUser = result.body.data.user; // 공개 회원 결과
            assert.deepEqual(Object.keys(publicUser).sort(), ["created_at", "email", "id", "username"]); // 해시 노출 차단
            assert.equal(publicUser.username, "test_user"); // 소문자 사용자명
            assert.equal(publicUser.email, "member@example.com"); // 정규화 이메일
            assert.match(publicUser.id, /^[1-9]\d*$/); // 문자열 식별자
            assert.match(publicUser.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // UTC 시각
            const hash = sql("SELECT password_hash FROM users WHERE id=" + publicUser.id); // 실제 저장 해시
            const verified = execFileSync(php, ["-r", "echo password_verify($argv[1], $argv[2]) ? 'verified' : 'invalid';", password, hash], { encoding: "utf8", windowsHide: true }); // 실제 PHP 비밀번호 검증
            assert.equal(verified, "verified"); // 원문 공백 포함 해시 일치
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: session.cookie } }), 401, "UNAUTHORIZED"); // 가입 후 게스트 유지
            assert.equal(sql("SELECT COUNT(*) FROM server_members"), "0"); // 자동 멤버십 없음
        }); // 실제 저장 검증 종료
        if (!publicUser) // 기본 구현 실패 후 연쇄 실패 방지
        {
            return; // 최초 누락 실패 결과 유지
        }
        await context.test("중복 이메일 우선과 사용자명 충돌 및 동시 가입 UNIQUE", async () => // 사전 검사만 사용하는 중복 처리 포착
        {
            expectError(await post("register", member, session), 409, "EMAIL_TAKEN"); // 두 중복의 이메일 우선
            expectError(await post("register", { ...member, email: "other@example.com" }, session), 409, "USERNAME_TAKEN"); // 사용자명 고유 제약
            const attempts = await Promise.all([0, 1, 2, 3].map(async (index) => // 실제 동시 가입 요청
            {
                return post("register", { username: "racer_" + index, email: "race@example.com", password }, await guest(index), {}, index); // 다른 이름의 동일 이메일
            })); // 동시 결과 수집
            assert.deepEqual(attempts.map((value) => value.response.status).sort(), [201, 409, 409, 409]); // 하나만 저장
            for (const result of attempts.filter((value) => value.response.status === 409)) // UNIQUE 충돌 결과
            {
                assert.equal(result.body.error.code, "EMAIL_TAKEN"); // DB 경쟁의 계약 오류 매핑
            }
        }); // 중복 검증 종료
        await context.test("메서드·본문·CSRF·필드 우선순위와 실패의 DB 무변경", async () => // 검증 전 쓰기와 제한 누적 포착
        {
            const usersBefore = sql("SELECT COUNT(*) FROM users"); // 기존 사용자 수
            for (const endpoint of ["register", "login", "logout"]) // 상태 변경 API 목록
            {
                const result = await request("/api/" + endpoint + ".php"); // 잘못된 GET
                expectError(result, 405, "METHOD_NOT_ALLOWED"); // 메서드 우선
                assert.equal(result.response.headers.get("allow"), "POST"); // 허용 메서드 안내
            }
            for (const endpoint of ["register", "login"]) // 게스트 POST 검증
            {
                expectError(await post(endpoint, "[]", session), 400, "INVALID_JSON"); // 배열 거절
                expectError(await post(endpoint, "{", session), 400, "INVALID_JSON"); // 문법 오류
                expectError(await post(endpoint, "{}", session, { "X-CSRF-Token": "bad" }), 403, "CSRF_INVALID"); // 필드보다 CSRF 우선
                expectError(await post(endpoint, {}, session), 422, "VALIDATION_ERROR"); // 필수 필드 누락
                expectError(await post(endpoint, member, session, { "Content-Type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"); // JSON 전용
                expectError(await post(endpoint, " ".repeat(32769), session), 413, "PAYLOAD_TOO_LARGE"); // 본문 크기 상한
                expectError(await post(endpoint, { email: "invalid", password }, session), 422, "VALIDATION_ERROR"); // 이메일 형식
            }
            expectError(await post("logout", "{", session), 401, "UNAUTHORIZED"); // 로그아웃 인증 우선
            assert.equal(sql("SELECT COUNT(*) FROM users"), usersBefore); // 검증 실패 가입 없음
            assert.equal(sql("SELECT COUNT(*) FROM auth_rate_limits"), "0"); // 검증 실패 시도 미누적
        }); // 검증 우선순위 종료
        await context.test("비밀번호 문자·바이트 경계와 이메일·사용자명·알 수 없는 필드", async () => // bcrypt 입력 절단과 비문자 입력 포착
        {
            const invalidPasswords = ["x".repeat(11), "x".repeat(65), "가".repeat(25), "😀".repeat(19), "x".repeat(12) + "\0", 123, null]; // 잘못된 원문 경계
            for (const value of invalidPasswords) // 개별 비밀번호 실패 확인
            {
                expectError(await post("register", { ...member, password: value }, session), 422, "VALIDATION_ERROR"); // 가입 비밀번호 거절
                expectError(await post("login", { email: member.email, password: value }, session), 422, "VALIDATION_ERROR"); // 로그인 동일 규칙
            }
            for (const value of [{ username: "ab" }, { username: "가나다" }, { username: "x".repeat(33) }, { email: "가@example.com" }, { email: "x".repeat(255) + "@example.com" }, { unknown: true }]) // 나머지 필드 실패
            {
                expectError(await post("register", { ...member, ...value }, session), 422, "VALIDATION_ERROR"); // 잘못된 필드 거절
            }
            const validPasswords = ["x".repeat(12), "x".repeat(64), "가".repeat(24), "😀".repeat(18)]; // 문자·바이트 허용 경계
            for (let index = 0; index < validPasswords.length; index++) // 허용 경계 저장
            {
                assert.equal((await post("register", { username: "boundary_" + index, email: "boundary" + index + "@example.com", password: validPasswords[index] }, session)).response.status, 201); // 실제 해시와 저장 성공
            }
        }); // 필드 경계 검증 종료
        await context.test("같은 자격증명 오류·세션과 토큰 교체·인증 중 거절·로그아웃", async () => // 해시 비교 우회와 세션 고정 포착
        {
            const missing = await post("login", { email: "missing@example.com", password }, session); // 없는 사용자 로그인
            const wrong = await post("login", { email: member.email, password: password.trim() }, session); // 원문 공백 제거 오입력
            expectError(missing, 401, "INVALID_CREDENTIALS"); // 없는 계정 오류
            expectError(wrong, 401, "INVALID_CREDENTIALS"); // 잘못된 해시 오류
            assert.deepEqual(missing.body, wrong.body); // 동일 오류 안내
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: session.cookie } }), 401, "UNAUTHORIZED"); // 로그인 실패 인증 없음
            const result = await post("login", { email: member.email, password }, session); // 실제 로그인 성공
            assert.equal(result.response.status, 200, JSON.stringify(result.body)); // 올바른 해시 인증
            assert.deepEqual(result.body.data.user, publicUser); // 공개 사용자 계약
            const signed = { cookie: result.response.headers.get("set-cookie").split(";")[0], token: result.body.data.csrf_token }; // 교체 인증 세션
            assert.notEqual(signed.cookie, session.cookie); // 세션 고정 방지
            assert.notEqual(signed.token, session.token); // CSRF 교체
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: session.cookie } }), 401, "UNAUTHORIZED"); // 이전 쿠키 인증 불가
            assert.equal((await request("/api/get_current_user.php", { headers: { Cookie: signed.cookie } })).body.data.user.id, publicUser.id); // 새 쿠키 인증 성공
            expectError(await post("login", "{", signed), 409, "ALREADY_AUTHENTICATED"); // 본문보다 재로그인 검사 우선
            expectError(await post("register", "{", signed), 409, "ALREADY_AUTHENTICATED"); // 인증 중 가입 차단
            expectError(await post("logout", {}, signed, { "X-CSRF-Token": session.token }), 403, "CSRF_INVALID"); // 이전 CSRF 거절
            expectError(await post("logout", { extra: 1 }, signed), 422, "VALIDATION_ERROR"); // 빈 객체 계약
            const out = await post("logout", {}, signed); // 실제 로그아웃
            assert.equal(out.response.status, 200); // 로그아웃 성공
            assert.match(out.response.headers.get("set-cookie"), /expires=.*1970|Max-Age=0/i); // 쿠키 만료
            assert.match(out.response.headers.get("set-cookie"), /path=\/.*HttpOnly.*SameSite=Lax/i); // 동일 쿠키 속성
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: signed.cookie } }), 401, "UNAUTHORIZED"); // 세션 파일 인증 폐기
        }); // 인증 흐름 검증 종료
        await context.test("유휴 만료의 게스트 전환과 기존 CSRF 거절", async () => // 만료 세션의 재로그인 차단 오류 포착
        {
            sql("DELETE FROM auth_rate_limits"); // 독립 시나리오 제한 초기화
            const fresh = await guest(); // 새 로그인 세션
            const logged = await post("login", { email: member.email, password }, fresh); // 실제 인증 준비
            const signed = { cookie: logged.response.headers.get("set-cookie").split(";")[0], token: logged.body.data.csrf_token }; // 실제 인증 쿠키
            await request("/expire", { headers: { Cookie: signed.cookie } }); // 유휴 수명 만료
            expectError(await post("login", { email: member.email, password }, signed), 403, "CSRF_INVALID"); // 만료 토큰 인증 폐기
        }); // 만료 검증 종료
        await context.test("키 누락 로그인만 실패 폐쇄와 응답 비밀 비노출", async () => // 제한 없는 설정 누락 인증 포착
        {
            const result = await post("/key-missing", { email: member.email, password }, await guest()); // 키 누락 실제 로그인
            expectError(result, 500, "INTERNAL_ERROR"); // 제한 생략 없는 실패
            assert.doesNotMatch(JSON.stringify(result.body), /secret|AUTH_RATE|password_hash|SELECT|\.php/i); // 내부 원인 숨김
            assert.equal((await request("/api/health.php")).response.status, 200); // 다른 API 정상 작동
        }); // 설정 실패 검증 종료
        await context.test("같은 게스트의 동시 로그인과 로그아웃의 오래된 세션 복원 차단", async () => // 잠금 해제 뒤 오래된 인증 상태 덮어쓰기 포착
        {
            sql("DELETE FROM auth_rate_limits"); // 독립 경쟁 시나리오 제한 초기화
            const fresh = await guest(); // 공유할 실제 게스트 세션
            const concurrent = [0, 1, 2, 3].map((index) => post("login", { email: member.email, password }, fresh, {}, index)); // 같은 쿠키와 토큰의 네 로그인
            const results = await Promise.all(concurrent); // 실제 세션 회전 경쟁 결과
            const successful = results.filter((value) => value.response.status === 200); // 인증 성공 응답
            assert.equal(successful.length, 1); // 한 요청만 인증 상태 확정
            for (const rejected of results.filter((value) => value.response.status !== 200)) // 오래된 세션 요청 결과
            {
                assert.ok([403, 409].includes(rejected.response.status), JSON.stringify(rejected.body)); // 오래된 인증 복원 거절
                assert.equal(rejected.response.headers.get("set-cookie"), null); // 성공 쿠키를 덮어쓸 게스트 쿠키 차단
            }
            const result = successful[0]; // 유일한 인증 세션
            const signed = { cookie: result.response.headers.get("set-cookie").split(";")[0], token: result.body.data.csrf_token }; // 교체된 쿠키와 토큰
            assert.equal((await post("logout", {}, signed)).response.status, 200); // 인증 직후 실제 로그아웃
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: fresh.cookie } }), 401, "UNAUTHORIZED"); // 원래 게스트 인증 없음
            expectError(await request("/api/get_current_user.php", { headers: { Cookie: signed.cookie } }), 401, "UNAUTHORIZED"); // 로그아웃 인증 복원 없음
        }); // 동시 세션 경쟁 검증 종료
        await context.test("이메일 고정 창·성공 횟수 유지·세션 교체 우회 차단·만료 초기화", async () => // 성공 시 초기화와 세션별 제한 오류 포착
        {
            sql("DELETE FROM auth_rate_limits"); // 전용 시나리오 제한 초기화
            for (let index = 0; index < 5; index++) // 허용된 다섯 번 시도
            {
                const fresh = await guest(); // 매 요청 다른 세션
                const result = await post("login", { email: " MEMBER@example.com ", password: index === 0 ? password : "WrongPassword123" }, fresh); // 첫 성공 포함 허용 시도
                assert.equal(result.response.status, index === 0 ? 200 : 401); // 성공·실패 모두 허용
            }
            const before = sql("SELECT SUM(attempts) FROM auth_rate_limits"); // 누적 시도 수
            const blocked = await post("login", { email: member.email, password }, await guest(), { "X-Forwarded-For": "203.0.113.100" }); // 새 세션과 위조 IP
            expectError(blocked, 429, "RATE_LIMITED"); // 이메일 여섯 번째 차단
            assert.match(blocked.response.headers.get("retry-after"), /^[1-9]\d*$/); // 양의 재시도 초
            assert.equal(sql("SELECT SUM(attempts) FROM auth_rate_limits"), before); // 차단 요청 미누적
            const keys = sql("SELECT bucket_key FROM auth_rate_limits"); // 실제 익명화 키
            assert.ok(keys.split(/\r?\n/).every((value) => /^[a-f0-9]{64}$/.test(value))); // 운영체제 개행과 원문 미저장 HMAC 형식
            sql("UPDATE auth_rate_limits SET window_started_at=UTC_TIMESTAMP()-INTERVAL 901 SECOND"); // 15분 창 만료
            expectError(await post("login", { email: member.email, password: "WrongPassword123" }, await guest()), 401, "INVALID_CREDENTIALS"); // 창 만료 후 재허용
            assert.equal(sql("SELECT SUM(attempts) FROM auth_rate_limits"), "2"); // 두 버킷 새 창 한 번씩
        }); // 이메일 제한 검증 종료
        await context.test("접속 IP 30회·프록시 헤더 무시·차단의 횟수 보존", async () => // 이메일 변경과 위조 IP의 제한 우회 포착
        {
            sql("DELETE FROM auth_rate_limits"); // 전용 시나리오 제한 초기화
            const fresh = await guest(); // 재사용 가능한 게스트
            for (let index = 0; index < 30; index++) // 접속 IP 허용 서른 번
            {
                expectError(await post("login", { email: "missing" + index + "@example.com", password }, fresh, { "X-Forwarded-For": "203.0.113." + index }), 401, "INVALID_CREDENTIALS"); // IP 위조 무시
            }
            const total = sql("SELECT SUM(attempts) FROM auth_rate_limits"); // 차단 전 누적 수
            const blocked = await post("login", { email: "another@example.com", password }, await guest()); // 서른한 번째 IP 시도
            expectError(blocked, 429, "RATE_LIMITED"); // IP 제한
            assert.equal(sql("SELECT SUM(attempts) FROM auth_rate_limits"), total); // 양쪽 버킷 미누적
            assert.equal(sql("SELECT MAX(attempts) FROM auth_rate_limits WHERE scope='login_ip'"), "30"); // IP 상한 유지
        }); // IP 제한 검증 종료
        await context.test("네 PHP 프로세스의 동시 이메일 제한 원자성", async () => // 읽기 후 쓰기의 동시 초과 허용 포착
        {
            sql("DELETE FROM auth_rate_limits"); // 독립 동시성 시나리오 초기화
            const guests = await Promise.all(Array.from({ length: 12 }, (_, index) => guest(index % 4))); // 서로 다른 실제 세션
            const results = await Promise.all(guests.map((fresh, index) => post("login", { email: "parallel@example.com", password }, fresh, {}, index % 4))); // 네 서버 동시 로그인
            assert.equal(results.filter((value) => value.response.status === 401).length, 5); // 정확히 다섯 번만 허용
            assert.equal(results.filter((value) => value.response.status === 429).length, 7); // 나머지 제한
            assert.equal(sql("SELECT attempts FROM auth_rate_limits WHERE scope='login_email'"), "5"); // 이메일 실제 누적 상한
            assert.equal(sql("SELECT attempts FROM auth_rate_limits WHERE scope='login_ip'"), "5"); // 차단의 IP 미누적
        }); // 동시 제한 검증 종료
    }
    finally // 테스트 자원 정리
    {
        for (const server of servers) // 이 테스트에서 시작한 서버만 종료
        {
            if (server.exitCode === null) // 실행 중 프로세스 확인
            {
                server.kill(); // 전용 PHP 종료
                await new Promise((resolve) => server.once("exit", resolve)); // 프로세스 종료 확인
            }
        }
        sql("DROP DATABASE " + database, false); // 검증한 무작위 테스트 DB만 제거
    }
}); // 전체 실제 인증 검증 종료
