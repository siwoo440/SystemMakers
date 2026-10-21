import assert from "node:assert/strict"; // 결과 검증 도구
import { execFileSync, spawn } from "node:child_process"; // 실제 PHP와 MySQL 실행
import { randomBytes } from "node:crypto"; // 격리 이름 생성
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"; // 검증 전용 파일 관리
import net from "node:net"; // 빈 로컬 포트 확인
import path from "node:path"; // 운영체제 경로 처리
import { fileURLToPath } from "node:url"; // 프로젝트 경로 변환
import test from "node:test"; // 기본 테스트 도구
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // PHP 실행 파일
const client = process.env.MYSQL_TEST_CLIENT || "mysql"; // MySQL 실행 파일
const port = process.env.MYSQL_TEST_PORT || "33360"; // 격리 MySQL 포트
const database = "systemmakers_backend_test_" + randomBytes(6).toString("hex"); // 전용 DB 이름
function sql(statement, selectDatabase = true) // 실제 MySQL 요청
{
    const args = ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4"]; // 로컬 연결 설정
    if (selectDatabase) // DB 선택 여부
    {
        args.push(database); // 격리 DB 지정
    }
    return execFileSync(client, args, { input: statement, encoding: "utf8", windowsHide: true }).trim(); // 실제 결과 반환
}
async function vacantPort() // 빈 TCP 포트 확보
{
    const server = net.createServer(); // 포트 확인 서버
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); // 로컬 임의 포트 연결
    const number = server.address().port; // 할당 포트 확인
    await new Promise((resolve) => server.close(resolve)); // 확인 서버 종료
    return number; // 검증 포트 반환
}
test("실제 PHP·MySQL 공통 API 계약", async (context) => // 공통 계층 통합 검증
{
    for (const file of ["backend/includes/bootstrap.php", "backend/api/csrf.php", "backend/api/get_current_user.php", "backend/api/health.php"]) // 필수 구현 경로
    {
        assert.ok(existsSync(path.join(root, file)), file + " 미구현"); // 누락 구현 실패
    }
    assert.ok(existsSync(php), "PHP_TEST_BIN 또는 portable PHP 준비 필요"); // 실행 환경 확인
    assert.match(port, /^\d+$/); // 포트 형식 제한
    assert.notEqual(port, "3306"); // 기존 기본 DB 접근 방지
    assert.match(database, /^systemmakers_backend_test_[a-f0-9]{12}$/); // 삭제 대상 제한
    const work = path.join(root, ".runtime", database); // 비공개 검증 폴더
    mkdirSync(path.join(work, "sessions"), { recursive: true }); // 독립 세션 저장소
    const basePhp = root.replaceAll("\\", "/").replaceAll("'", "\\'"); // PHP 경로 인용
    const router = `<?php // 검증 전용 라우터
require '${basePhp}/backend/includes/bootstrap.php'; // 실제 공통 처리
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); // 요청 경로
if ($route === '/ready') // 서버 준비 확인
{
    respond_success(['ready' => true]); // 준비 응답
}
if ($route === '/fixture-auth') // 비공개 인증 시나리오
{
    start_secure_session(); // 실제 세션 시작
    $_SESSION['user_id'] = $_GET['id'] ?? '1'; // 검증 사용자
    $_SESSION['authenticated_at'] = time() - (int) ($_GET['age'] ?? '0'); // 검증 로그인 시각
    $_SESSION['last_activity_at'] = time() - (int) ($_GET['idle'] ?? '0'); // 검증 활동 시각
    $state = ['user_id' => $_SESSION['user_id'], 'authenticated_at' => $_SESSION['authenticated_at'], 'last_activity_at' => $_SESSION['last_activity_at']]; // 실제 저장 예정 인증 상태
    session_write_close(); // 세션 잠금 해제
    respond_success($state); // 실제 인증 준비 결과
}
if ($route === '/validate') // 실제 본문 검증 경로
{
    require_method(['POST']); // 메서드 검증
    $body = read_json_body(); // 입력 객체 검증
    require_csrf(); // 실제 토큰 검사
    require_body_fields($body, ['id'], ['text']); // 인증 보호 후 필드 검사
    $id = validate_id($body['id'], 'id'); // ID 범위 검사
    if (array_key_exists('text', $body)) // 선택 문자열 여부
    {
        validate_string($body['text'], 'text', 1, 4); // 문자 수와 NUL 검사
    }
    close_session(); // 세션 잠금 해제
    respond_success(['id' => $id]); // 검증 결과
}
if ($route === '/id') // 조회 ID 검증
{
    require_query_fields(['value', 'zero']); // 알 수 없는 필드 검사
    respond_success(['id' => validate_id($_GET['value'] ?? null, 'value', isset($_GET['zero']), true)]); // 조회 ID 검증
}
if ($route === '/secure-cookie') // 운영 쿠키 보안 확인
{
    putenv('APP_ENV=production'); // 운영 환경 조건
    putenv('SESSION_COOKIE_SECURE=0'); // 잘못된 해제 설정 조건
    require '${basePhp}/backend/api/csrf.php'; // 실제 토큰 API 실행
}
if ($route === '/member') // 실제 채널 권한 검사
{
    respond_success(require_channel_member(db(), $_GET['channel'] ?? '1', $_GET['user'] ?? '1')); // DB 소속 판정
}
if ($route === '/db') // 실제 PDO 연결 확인
{
    $pdo = db(); // 실제 DB 연결
    $row = $pdo->query('SELECT @@session.time_zone AS timezone, @@character_set_connection AS charset')->fetch(); // 연결 속성 조회
    respond_success(['timezone' => $row['timezone'], 'charset' => $row['charset'], 'emulated' => $pdo->getAttribute(PDO::ATTR_EMULATE_PREPARES), 'exception_mode' => $pdo->getAttribute(PDO::ATTR_ERRMODE)]); // 실제 연결 속성
}
if ($route === '/db-failure') // 잘못된 DB 설정 시나리오
{
    putenv('MYSQL_DATABASE=missing_sensitive_database'); // 연결 실패 유도
    require '${basePhp}/backend/api/health.php'; // 실제 상태 API 실행
}
if ($route === '/config-missing') // 필수 DB 설정 누락
{
    putenv('MYSQL_DATABASE'); // DB 이름 제거
    db(); // 필수 설정 검사
}
if ($route === '/boom') // 내부 예외 시나리오
{
    throw new RuntimeException('sensitive SQL password internal path'); // 내부 오류 유도
}
if ($route === '/warning') // 내부 경고 시나리오
{
    trigger_error('sensitive warning secret', E_USER_WARNING); // 경고 유도
}
$routes = ['/api/csrf.php' => 'csrf.php', '/api/get_current_user.php' => 'get_current_user.php', '/api/health.php' => 'health.php']; // 공개 API 목록
if (isset($routes[$route])) // 허용 API 확인
{
    require '${basePhp}/backend/api/' . $routes[$route]; // 실제 엔드포인트 실행
}
respond_error('NOT_FOUND', '경로 없음', 404); // 그 외 요청 거절
`; // 검증 전용 PHP 소스
    writeFileSync(path.join(work, "router.php"), router); // 공개 경로 밖 fixture 저장
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;", false); // 무작위 전용 DB 생성
    let server; // 종료 대상 PHP 프로세스
    let stderr = ""; // 실패 진단 기록
    try // 실패 시에도 정리 보장
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 스키마 적용
        sql("INSERT INTO users (id,username,email,password_hash) VALUES (1,'member','member@example.com','unused'),(2,'outsider','outsider@example.com','unused'); INSERT INTO servers (id,name,owner_id) VALUES (1,'test',1); INSERT INTO server_members (server_id,user_id,role) VALUES (1,1,'owner'); INSERT INTO channels (id,server_id,name) VALUES (1,1,'general');"); // 실제 계정과 소속 준비
        const httpPort = await vacantPort(); // 검증 전용 HTTP 포트
        const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "development", SESSION_COOKIE_SECURE: "0" }; // 격리 연결 환경
        server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(work, "sessions"), "-S", "127.0.0.1:" + httpPort, "-t", work, path.join(work, "router.php")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }); // 숨김 PHP 서버 시작
        server.stderr.on("data", (chunk) => // 실행 오류 기록
        {
            stderr += chunk; // 실패 진단 누적
        }); // 로그 수집 종료
        const origin = "http://127.0.0.1:" + httpPort; // 로컬 HTTP 주소
        async function request(route, options = {}) // 실제 HTTP JSON 요청
        {
            const response = await fetch(origin + route, options); // 실제 PHP 요청
            const body = await response.json(); // 응답 객체 읽기
            assert.match(response.headers.get("content-type"), /^application\/json; charset=utf-8$/i); // JSON 응답 유형
            assert.equal(response.headers.get("cache-control"), "no-store"); // 인증 응답 캐시 차단
            return { response, body }; // 상태와 본문 반환
        }
        let ready = false; // 서버 준비 상태
        for (let retry = 0; retry < 60; retry++) // 짧은 준비 대기
        {
            try // 연결 준비 확인
            {
                await request("/ready"); // 실제 준비 요청
                ready = true; // 준비 완료
                break; // 대기 종료
            }
            catch // 시작 중 연결 거절
            {
                await new Promise((resolve) => setTimeout(resolve, 50)); // 짧은 재시도 간격
            }
        }
        assert.ok(ready, stderr); // 서버 시작 실패 진단
        const first = await request("/api/csrf.php"); // 첫 세션 토큰
        const cookie = first.response.headers.get("set-cookie").split(";")[0]; // 세션 쿠키 보관
        const token = first.body.data.csrf_token; // 첫 CSRF 토큰
        const authHeaders = { Cookie: cookie }; // 동일 세션 헤더
        const postHeaders = { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": token }; // 정상 POST 헤더
        await context.test("CSRF 유지와 세션별 분리 및 쿠키 보안", async () => // 토큰 재발급 오류 포착
        {
            assert.match(token, /^[a-f0-9]{64}$/); // 32바이트 난수 형식
            assert.match(first.response.headers.get("set-cookie"), /^systemmakers_session=/); // 고정 쿠키 이름
            assert.match(first.response.headers.get("set-cookie"), /; path=\//i); // 루트 쿠키 경로
            assert.match(first.response.headers.get("set-cookie"), /; HttpOnly/i); // 스크립트 쿠키 읽기 차단
            assert.match(first.response.headers.get("set-cookie"), /; SameSite=Lax/i); // 같은 사이트 기본 보호
            assert.equal((await request("/api/csrf.php", { headers: authHeaders })).body.data.csrf_token, token); // 같은 세션 토큰 유지
            assert.notEqual((await request("/api/csrf.php")).body.data.csrf_token, token); // 다른 세션 토큰 분리
            assert.match((await request("/secure-cookie")).response.headers.get("set-cookie"), /; secure/i); // 운영 환경 Secure 강제
        }); // CSRF 검사 종료
        await context.test("게스트 로그인 상태 조회 후 기존 CSRF 유지와 POST 허용", async () => // 일반 비로그인 조회의 토큰 폐기 회귀
        {
            const issued = await request("/api/csrf.php"); // 독립 게스트 세션 발급
            const guestCookie = issued.response.headers.get("set-cookie").split(";")[0]; // 실제 발급 게스트 쿠키
            const guestToken = issued.body.data.csrf_token; // 로그인 전 원본 토큰
            const guestHeaders = { Cookie: guestCookie }; // 동일 게스트 세션
            const current = await request("/api/get_current_user.php", { headers: guestHeaders }); // 사이트 최초 로그인 상태 조회
            assert.equal(current.response.status, 401); // 정상 비로그인 상태
            assert.equal((await request("/api/csrf.php", { headers: guestHeaders })).body.data.csrf_token, guestToken); // 원래 세션과 토큰 유지
            const submission = await request("/validate", { method: "POST", headers: { ...guestHeaders, "Content-Type": "application/json", "X-CSRF-Token": guestToken }, body: '{"id":"1"}' }); // 최초 토큰으로 실제 보호 요청
            assert.equal(submission.response.status, 200); // 기존 토큰 검증 성공
        }); // 게스트 토큰 회귀 검사 종료
        await context.test("비로그인 401과 메서드 우선 405 및 Allow", async () => // 보호 및 메서드 누락 포착
        {
            assert.equal((await request("/api/get_current_user.php")).response.status, 401); // 비로그인 보호
            for (const endpoint of ["csrf", "get_current_user", "health"]) // 공개 GET 목록
            {
                const result = await request("/api/" + endpoint + ".php", { method: "POST" }); // 잘못된 메서드
                assert.equal(result.response.status, 405); // 메서드 우선 판정
                assert.equal(result.response.headers.get("allow"), "GET"); // 지원 메서드 안내
            }
            assert.equal((await request("/api/csrf.php?unexpected=1")).response.status, 400); // GET 미허용 필드 차단
        }); // 인증 기본 검사 종료
        await context.test("PDO 실제 연결과 상태 응답", async () => // 연결 설정 누락 포착
        {
            assert.deepEqual((await request("/api/health.php")).body, { success: true, data: { status: "ok" } }); // 민감 정보 없는 상태
            assert.equal((await request("/api/health.php")).response.headers.get("x-powered-by"), null); // 런타임 버전 비노출
            assert.deepEqual((await request("/db")).body.data, { timezone: "+00:00", charset: "utf8mb4", emulated: false, exception_mode: 2 }); // UTC와 실제 prepare 속성
        }); // DB 검사 종료
        await context.test("본문 객체·크기·미디어 유형·필드·CSRF 검증", async () => // 잘못된 입력 수락 포착
        {
            const cases = [["[]", 400], ["null", 400], ["{", 400], ['{"id":1}', 422], ['{"id":18446744073709551615}', 422], ['{"id":"1","extra":1}', 422], ['{}', 422], ['{"id":"1","text":7}', 422], ['{"id":"1","text":"가나다라마"}', 422], ['{"id":"1","text":"\\u0000"}', 422], ['{"id":"1","text":"' + "x".repeat(33000) + '"}', 413]]; // 독립 오류 기대값
            for (const [body, expected] of cases) // 입력별 검사
            {
                assert.equal((await request("/validate", { method: "POST", headers: postHeaders, body })).response.status, expected, body.slice(0, 80)); // 계약 오류 상태
            }
            assert.equal((await request("/validate", { method: "POST", headers: authHeaders, body: '{}' })).response.status, 415); // 비JSON 유형 차단
            assert.equal((await request("/validate", { method: "POST", headers: { ...postHeaders, "X-CSRF-Token": "bad" }, body: '{"id":"1"}' })).response.status, 403); // 토큰 불일치 차단
            assert.equal((await request("/validate", { method: "POST", headers: { ...postHeaders, "X-CSRF-Token": "bad" }, body: '{}' })).response.status, 403); // 필드 검사보다 CSRF 우선
            assert.equal((await request("/validate", { method: "POST", headers: postHeaders, body: '{"id":"18446744073709551615","text":"가😀"}' })).body.data.id, "18446744073709551615"); // 큰 ID 문자열 보존
            assert.equal((await request("/validate", { method: "POST", headers: postHeaders, body: Buffer.from([123, 34, 105, 100, 34, 58, 34, 255, 34, 125]) })).response.status, 400); // 잘못된 UTF-8 거절
            const boundary = '{"id":"1"}' + " ".repeat(32758); // 정확히 32 KiB인 JSON 본문
            assert.equal((await request("/validate", { method: "POST", headers: postHeaders, body: boundary })).response.status, 200); // 본문 상한 경계 허용
            assert.equal((await request("/validate", { method: "POST", headers: postHeaders, body: new Blob([boundary + " "]).stream(), duplex: "half" })).response.status, 413); // 길이 헤더 없는 실제 크기 차단
        }); // 입력 검사 종료
        await context.test("정규 64비트 ID와 조회 0 커서 경계", async () => // 숫자 변환과 범위 오류 포착
        {
            for (const invalid of ["0", "01", "-1", "+1", "1.0", " 1", "18446744073709551616", "999999999999999999999", "1e2"]) // 잘못된 ID 목록
            {
                assert.equal((await request("/id?value=" + encodeURIComponent(invalid))).response.status, 400, invalid); // 잘못된 조회 ID 차단
            }
            assert.equal((await request("/id?value[]=1")).response.status, 400); // 배열 ID 차단
            assert.equal((await request("/id?value=1&value=2")).response.status, 400); // 중복 조회 키 차단
            assert.equal((await request("/id?value=1&%76alue=2")).response.status, 400); // 인코딩된 중복 키 차단
            assert.equal((await request("/id?value=0&zero=1")).body.data.id, "0"); // 명시된 초기 커서 허용
        }); // ID 검사 종료
        await context.test("실제 계정 확인과 문자열 ID", async () => // 세션 정보만 신뢰하는 오류 포착
        {
            await request("/fixture-auth", { headers: authHeaders }); // 실제 사용자 세션 준비
            const user = (await request("/api/get_current_user.php", { headers: authHeaders })).body.data.user; // 실제 사용자 조회
            assert.equal(user.id, "1"); // ID 문자열 계약
            assert.equal(user.username, "member"); // DB 계정 확인
            assert.equal(user.email, "member@example.com"); // 본인 이메일 반환
            assert.match(user.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // UTC 응답 형식
            assert.deepEqual(Object.keys(user).sort(), ["created_at", "email", "id", "username"]); // 비밀번호 해시 비노출
        }); // 사용자 검사 종료
        const authenticationCases = // 서로 독립적인 인증 수명 시나리오
        [ // 인증 사례 목록
            ["삭제 계정 인증 무효화", "999", 0, 0, 401], // 실제 DB 계정 부재
            ["유휴 30분 초과 인증 무효화", "1", 2000, 1801, 401], // 로그인 최대 수명 이내 유휴 만료
            ["로그인 12시간 초과 인증 무효화", "1", 43201, 0, 401], // 최근 활동이 있는 최대 수명 만료
            ["손상된 사용자 식별자 인증 무효화", "broken", 0, 0, 401], // 인증 메타데이터가 존재하는 손상 상태
            ["유휴 만료 직전 정상 인증 허용", "1", 2000, 1790, 200], // 유휴 만료 전 여유 10초
            ["최대 수명 만료 직전 정상 인증 허용", "1", 43190, 0, 200] // 최대 수명 만료 전 여유 10초
        ]; // 인증 사례 종료
        for (const [name, id, age, idle, expected] of authenticationCases) // 독립 인증 시나리오 순회
        {
            await context.test(name, async () => // 다른 만료 검사의 쿠키 영향 차단
            {
                const issued = await request("/api/csrf.php"); // 시나리오 전용 새 세션
                const scenarioCookie = issued.response.headers.get("set-cookie").split(";")[0]; // 시나리오 전용 실제 쿠키
                const scenarioToken = issued.body.data.csrf_token; // 시나리오 전용 원본 토큰
                const scenarioHeaders = { Cookie: scenarioCookie }; // 독립 인증 헤더
                const seeded = await request("/fixture-auth?id=" + id + "&age=" + age + "&idle=" + idle, { headers: scenarioHeaders }); // 독립 인증 상태 저장
                const now = Math.floor(Date.now() / 1000); // 실제 검사 시각
                assert.equal(seeded.body.data.user_id, id); // 준비한 사용자 식별자 확인
                assert.ok(Math.abs(now - seeded.body.data.authenticated_at - age) <= 2); // 준비한 로그인 경과 시간 확인
                assert.ok(Math.abs(now - seeded.body.data.last_activity_at - idle) <= 2); // 준비한 유휴 경과 시간 확인
                assert.equal((await request("/api/csrf.php", { headers: scenarioHeaders })).body.data.csrf_token, scenarioToken); // 인증 수명 갱신 없는 토큰 조회
                const current = await request("/api/get_current_user.php", { headers: scenarioHeaders }); // 준비한 동일 세션 인증 검사
                assert.equal(current.response.status, expected); // 독립 시나리오 기대 상태
                if (expected === 401) // 만료 또는 손상된 인증 상태
                {
                    const replacement = current.response.headers.get("set-cookie"); // 인증 폐기 후 새 쿠키
                    assert.ok(replacement, "만료·손상 인증의 세션 교체 필요"); // 이전 인증 세션 무효화 확인
                    const replacementCookie = replacement.split(";")[0]; // 실제 교체 쿠키 사용
                    assert.notEqual(replacementCookie, scenarioCookie); // 이전 세션 식별자 폐기
                    assert.notEqual((await request("/api/csrf.php", { headers: { Cookie: replacementCookie } })).body.data.csrf_token, scenarioToken); // 만료 인증의 기존 토큰 폐기
                }
                else // 만료 전의 정상 인증 상태
                {
                    assert.equal(current.body.data.user.id, "1"); // 실제 사용자 조회 성공
                    assert.equal((await request("/api/csrf.php", { headers: scenarioHeaders })).body.data.csrf_token, scenarioToken); // 유효한 인증 세션 토큰 유지
                }
            }); // 독립 인증 검사 종료
        }
        await context.test("채널 존재와 멤버십 404·403 구분", async () => // 존재와 권한 혼동 포착
        {
            assert.deepEqual((await request("/member?channel=1&user=1")).body.data, { id: "1", server_id: "1" }); // 실제 소속 허용
            assert.equal((await request("/member?channel=999&user=1")).response.status, 404); // 없는 채널 구분
            assert.equal((await request("/member?channel=1&user=2")).response.status, 403); // 다른 사용자 소속 차단
        }); // 소속 검사 종료
        await context.test("내부 예외와 DB 실패 원인 비노출", async () => // 민감 오류 유출 포착
        {
            for (const route of ["/boom", "/warning", "/db-failure", "/config-missing"]) // 실제 내부 실패 경로
            {
                const result = await request(route); // 실제 실패 응답
                assert.equal(result.response.status, 500); // 공통 내부 오류 상태
                assert.equal(result.body.error.code, "INTERNAL_ERROR"); // 안정 오류 코드
                assert.doesNotMatch(JSON.stringify(result.body), /sensitive|SQL|password|root|127\.0\.0\.1|\.php|missing_sensitive/i); // 내부 원인 비노출
            }
        }); // 오류 검사 종료
    }
    finally // 검증 자원 정리
    {
        if (server && server.exitCode === null) // 이 테스트의 서버만 종료
        {
            server.kill(); // 전용 PHP 서버 종료
            await new Promise((resolve) => server.once("exit", resolve)); // 서버 종료 확인
        }
        sql("DROP DATABASE " + database + ";", false); // 무작위 전용 DB만 삭제
    }
}); // 전체 통합 검증 종료
