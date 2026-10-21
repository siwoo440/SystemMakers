import assert from "node:assert/strict"; // 메시지 계약 검증
import { execFileSync, spawn } from "node:child_process"; // 실제 PHP와 MySQL 실행
import { randomBytes } from "node:crypto"; // 독립 DB 이름 생성
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"; // 비공개 테스트 파일 관리
import net from "node:net"; // 임시 HTTP 포트 확보
import path from "node:path"; // 운영체제 경로 처리
import { fileURLToPath } from "node:url"; // 프로젝트 경로 변환
import test from "node:test"; // 기본 테스트 실행
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // 실제 PHP 실행 파일
const client = process.env.MYSQL_TEST_CLIENT || path.join(root, ".runtime/mysql/mysql-8.4.13-winx64/bin/mysql.exe"); // 실제 MySQL 클라이언트
const port = process.env.MYSQL_TEST_PORT || "33360"; // 격리된 테스트 MySQL 포트
const database = "systemmakers_messages_test_" + randomBytes(6).toString("hex"); // 삭제 가능한 독립 DB
function mysqlArgs(selected = true) // 테스트 DB 전용 연결 인수
{
    return ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4", ...(selected ? [database] : [])]; // 테스트 연결 설정
}
function sql(statement, selected = true) // 실제 SQL 실행
{
    return execFileSync(client, mysqlArgs(selected), { input: statement, encoding: "utf8", windowsHide: true }).trim(); // 실제 결과 반환
}
async function waitUntil(predicate, description, timeout = 10000) // 관측 가능한 조건 대기
{
    const deadline = Date.now() + timeout; // 제한 시각
    while (Date.now() < deadline) // 제한 시간 내 반복
    {
        if (await predicate()) // 실제 조건 충족 여부
        {
            return; // 관측 성공 종료
        }
        await new Promise((resolve) => setTimeout(resolve, 25)); // 다음 관측 간격
    }
    assert.fail(description); // 조건 미충족 실패
}
async function vacantPort() // 사용 가능한 HTTP 포트 확보
{
    const probe = net.createServer(); // 임시 포트 탐색 서버
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 임의 포트 할당
    const value = probe.address().port; // 할당된 포트
    await new Promise((resolve) => probe.close(resolve)); // 포트 탐색 종료
    return value; // 사용 가능한 포트 반환
}
function hex(value) // SQL 원문 비교용 UTF-8 바이트
{
    return Buffer.from(value).toString("hex").toUpperCase(); // 안전한 16진수 표현
}
test("실제 PHP·MySQL 메시지 저장 계약", async (context) => // 모의 구현 없는 HTTP 검증
{
    assert.match(database, /^systemmakers_messages_test_[a-f0-9]{12}$/); // 삭제 대상 이름 제한
    assert.match(port, /^\d+$/); // 포트 형식 제한
    assert.notEqual(port, "3306"); // 기본 DB 사용 차단
    const work = path.join(root, ".runtime", database); // 독립 비공개 검증 폴더
    mkdirSync(path.join(work, "sessions"), { recursive: true }); // 독립 세션 저장소
    const base = root.replaceAll("\\", "/").replaceAll("'", "\\'"); // PHP 경로 인용
    const fixture = `<?php // 비공개 메시지 검증 라우터
require '${base}/backend/includes/bootstrap.php'; // 실제 공통 계층
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); // 요청 경로
if ($route === '/ready') // 서버 준비 경로
{
    respond_success(['ready' => true]); // 실제 준비 응답
}
if ($route === '/limited-wait') // 테스트 전용 짧은 잠금 제한
{
    db()->exec('SET SESSION innodb_lock_wait_timeout = 1'); // 테스트 연결의 대기 제한
    $route = '/api/send_message.php'; // 실제 메시지 API 경로
}
if ($route === '/connection-failure') // 연결 오류 비노출 검사
{
    putenv('MYSQL_DATABASE=missing_messages_database'); // 요청 전용 없는 DB
    $route = '/api/send_message.php'; // 실제 메시지 API 경로
}
$name = basename((string) $route, '.php'); // API 이름
if (in_array($name, ['csrf', 'register', 'login', 'get_current_user', 'send_message'], true) && is_file('${base}/backend/api/' . $name . '.php')) // 실제 API 허용 목록
{
    require '${base}/backend/api/' . $name . '.php'; // 실제 구현 실행
}
respond_error('NOT_FOUND', '경로 없음', 404); // 미구현 경로 응답
`; // 검증용 PHP 소스 종료
    writeFileSync(path.join(work, "router.php"), fixture); // 공개 경로 밖 라우터 저장
    const servers = []; // 테스트 PHP 프로세스 목록
    const connections = []; // 직접 잠금 제어 연결 목록
    const origins = []; // 서버 접속 주소 목록
    let logs = ""; // 서버 시작 진단
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci", false); // 독립 DB 생성
    try // 실패 시 자원 정리 보장
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 스키마 적용
        for (let index = 0; index < 4; index++) // 실제 네 PHP 프로세스
        {
            const httpPort = await vacantPort(); // 프로세스별 포트
            const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0", AUTH_RATE_LIMIT_KEY: "messages-test-only-key-at-least-32-bytes" }; // 격리된 테스트 환경
            const server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(work, "sessions"), "-S", "127.0.0.1:" + httpPort, "-t", work, path.join(work, "router.php")], { cwd: root, env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }); // 실제 서버 시작
            server.stderr.on("data", (value) => // 서버 오류 수집
            {
                logs += value; // 시작 실패 원인 보관
            }); // 오류 수집 등록 종료
            servers.push(server); // 종료 대상 등록
            origins.push("http://127.0.0.1:" + httpPort); // 접속 주소 등록
        }
        async function request(route, options = {}, index = 0) // 실제 HTTP 요청
        {
            const response = await fetch(origins[index] + route, { signal: AbortSignal.timeout(15000), ...options }); // 무한 대기를 막는 실제 PHP 요청
            const body = await response.json(); // 실제 응답 JSON
            assert.match(response.headers.get("content-type"), /^application\/json; charset=utf-8$/i); // JSON 형식 계약
            assert.equal(response.headers.get("cache-control"), "no-store"); // 응답 캐시 차단
            return { response, body }; // 실제 상태와 본문
        }
        for (let index = 0; index < origins.length; index++) // 전체 서버 준비 검사
        {
            await waitUntil(async () => // HTTP 준비 조건
            {
                try // 시작 중 연결 실패 허용
                {
                    return (await request("/ready", {}, index)).response.status === 200; // 실제 준비 응답
                }
                catch // 아직 시작 전 상태
                {
                    return false; // 재확인 대상
                }
            }, logs || "PHP 서버 준비 실패"); // 제한된 준비 대기
        }
        async function guest() // 실제 게스트 세션 발급
        {
            const issued = await request("/api/csrf.php"); // CSRF 발급 요청
            return { cookie: issued.response.headers.get("set-cookie").split(";")[0], token: issued.body.data.csrf_token }; // 세션 쿠키와 토큰
        }
        async function post(endpoint, body, session, extra = {}, index = 0) // 실제 보호 POST 요청
        {
            return request(endpoint.startsWith("/") ? endpoint : "/api/" + endpoint + ".php", { method: "POST", headers: { Cookie: session.cookie, "Content-Type": "application/json", "X-CSRF-Token": session.token, ...extra }, body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) }, index); // 원문과 인증 헤더 전달
        }
        function expectError(result, status, code) // 공통 오류 응답 검증
        {
            assert.equal(result.response.status, status, JSON.stringify(result.body)); // HTTP 상태 비교
            assert.equal(result.body.error.code, code); // 오류 분기 코드 비교
        }
        async function account(username) // 실제 가입과 로그인 준비
        {
            const fresh = await guest(); // 로그인 전 세션
            const input = { username, email: username + "@example.com", password: "MessagesPass123!" }; // 독립 테스트 회원
            const registered = await post("register", input, fresh); // 실제 사용자 저장
            assert.equal(registered.response.status, 201); // 가입 성공 확인
            const logged = await post("login", { email: input.email, password: input.password }, fresh); // 실제 해시 인증
            assert.equal(logged.response.status, 200); // 로그인 성공 확인
            return { cookie: logged.response.headers.get("set-cookie").split(";")[0], token: logged.body.data.csrf_token, user: logged.body.data.user }; // 실제 인증 정보
        }
        async function openConnection() // 유지되는 실제 MySQL 연결
        {
            const process = spawn(client, [...mysqlArgs(), "--unbuffered", "--raw"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); // 잠금 제어 전용 연결
            const connection = { process, output: "", errors: "", serial: 0 }; // 연결 관측 상태
            process.stdout.on("data", (value) => // 결과 스트림 관측
            {
                connection.output += value; // SQL 완료 표식 수집
            }); // 표식 수집 등록 종료
            process.stderr.on("data", (value) => // 실제 SQL 오류 관측
            {
                connection.errors += value; // 실패 진단 수집
            }); // 오류 수집 등록 종료
            connection.command = async (statement) => // 표식 기반 SQL 완료 대기
            {
                const marker = "done_" + (++connection.serial); // 연결별 고유 완료 표식
                process.stdin.write(statement + "; SELECT '" + marker + "';\n"); // SQL과 완료 표식 전송
                await waitUntil(() => connection.output.split(/\r?\n/).includes(marker), "SQL 완료 실패: " + connection.errors); // 실제 완료 관측
            }; // 명령 함수 등록 종료
            connections.push(connection); // 정리 대상 등록
            await connection.command("SET SESSION time_zone='+00:00'"); // UTC 연결 준비
            return connection; // 실제 연결 반환
        }
        const member = await account("message_member"); // 서버 회원 준비
        const outsider = await account("message_outsider"); // 다른 서버 회원 준비
        sql("INSERT INTO servers (id,name,owner_id) VALUES (1,'first'," + member.user.id + "),(2,'second'," + outsider.user.id + "); INSERT INTO server_members (server_id,user_id,role) VALUES (1," + member.user.id + ",'owner'),(2," + outsider.user.id + ",'owner'); INSERT INTO channels (id,server_id,name) VALUES (1,1,'general'),(2,2,'general'),(3,1,'other')"); // 서로 다른 서버와 채널
        let firstMessage; // 최초 실제 메시지
        await context.test("실제 저장·작성자·채널·공개 필드·원문 보존", async () => // 작성자 위조와 HTML 변형 포착
        {
            const content = "  <script>alert('x')</script>\n한글 😀\r\n끝  "; // 공백과 HTML 포함 원문
            const result = await post("send_message", { channel_id: "1", content }, member); // 실제 메시지 전송
            assert.equal(result.response.status, 201, JSON.stringify(result.body)); // 커밋 후 생성 응답
            firstMessage = result.body.data.message; // 공개 메시지 결과
            assert.deepEqual(Object.keys(firstMessage).sort(), ["channel_id", "content", "created_at", "id", "user_id", "username"]); // 공개 필드 정확성
            assert.equal(firstMessage.channel_id, "1"); // 선택 채널 일치
            assert.equal(firstMessage.user_id, member.user.id); // 세션 작성자 일치
            assert.equal(firstMessage.username, member.user.username); // 현재 사용자명 일치
            assert.equal(firstMessage.content, content); // 응답 원문 일치
            for (const key of ["id", "channel_id", "user_id"]) // 문자열 ID 목록
            {
                assert.match(firstMessage[key], /^[1-9]\d*$/); // 양의 십진수 문자열
            }
            assert.match(firstMessage.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // UTC ISO 시각
            assert.equal(sql("SELECT CONCAT(channel_id,':',user_id,':',HEX(content)) FROM messages WHERE id=" + firstMessage.id), "1:" + member.user.id + ":" + hex(content)); // 실제 DB 원문과 소속
            assert.equal(sql("SELECT COUNT(*) FROM messages WHERE channel_id IN (2,3)"), "0"); // 다른 채널 오염 없음
        }); // 실제 저장 검증 종료
        if (!firstMessage) // 미구현의 최초 실패 이후 중단
        {
            return; // 누락 기능 실패 유지
        }
        await context.test("메서드·인증·본문·CSRF·필드 순서와 실패 무저장", async () => // 검증 전 DB 쓰기 포착
        {
            const before = sql("SELECT COUNT(*) FROM messages"); // 실패 전 메시지 수
            const wrongMethod = await request("/api/send_message.php"); // 비로그인 GET
            expectError(wrongMethod, 405, "METHOD_NOT_ALLOWED"); // 메서드 우선 검사
            assert.equal(wrongMethod.response.headers.get("allow"), "POST"); // 허용 메서드 계약
            expectError(await post("send_message", "{", await guest()), 401, "UNAUTHORIZED"); // 본문보다 인증 우선
            expectError(await post("send_message", " ".repeat(32769), member, { "X-CSRF-Token": "bad" }), 413, "PAYLOAD_TOO_LARGE"); // 크기 우선 검사
            expectError(await post("send_message", "{}", member, { "Content-Type": "text/plain", "X-CSRF-Token": "bad" }), 415, "UNSUPPORTED_MEDIA_TYPE"); // MIME 우선 검사
            for (const raw of ["{", "[]", "null", Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])]) // 잘못된 JSON과 UTF-8
            {
                expectError(await post("send_message", raw, member), 400, "INVALID_JSON"); // 구문과 문자 오류 거절
            }
            expectError(await post("send_message", {}, member, { "X-CSRF-Token": "" }), 403, "CSRF_INVALID"); // 필드보다 CSRF 우선
            for (const body of [{}, { channel_id: "1" }, { channel_id: "1", content: "hello", user_id: outsider.user.id }]) // 누락과 작성자 위조
            {
                expectError(await post("send_message", body, member), 422, "VALIDATION_ERROR"); // 미허용 입력 거절
            }
            expectError(await post("send_message", { channel_id: "2", content: "no" }, member), 403, "FORBIDDEN"); // 다른 서버 접근 거절
            expectError(await post("send_message", { channel_id: "18446744073709551615", content: "no" }, member), 404, "CHANNEL_NOT_FOUND"); // 최대 ID의 없는 채널
            assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 모든 실패의 저장 없음
        }); // 검증 순서 검사 종료
        await context.test("ID 형식·유니코드 경계·공백·NUL·원문 길이", async () => // UTF-16과 바이트 길이 혼동 포착
        {
            for (const channel_id of [1, null, "0", "01", "+1", " 1", "1.0", "18446744073709551616", [], "-1"]) // 잘못된 ID 목록
            {
                expectError(await post("send_message", { channel_id, content: "valid" }, member), 422, "VALIDATION_ERROR"); // 공통 ID 규칙
            }
            const before = sql("SELECT COUNT(*) FROM messages"); // 내용 오류 전 저장 수
            for (const content of ["", " ", "\t\n\r", "\u00a0\u1680\u2000\u2028\u202f\u205f\u3000\ufeff", "x\0y", "😀".repeat(2001), " " + "가".repeat(2000), 123, null, []]) // 내용 오류 경계
            {
                expectError(await post("send_message", { channel_id: "1", content }, member), 422, "VALIDATION_ERROR"); // 잘못된 내용 거절
            }
            assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 경계 실패 무저장
            for (const content of ["가", "😀".repeat(2000), "  \n끝\n  ", "\u200b"]) // 허용 문자와 코드 포인트 경계
            {
                const result = await post("send_message", { channel_id: "3", content }, member); // 같은 서버의 다른 채널
                assert.equal(result.response.status, 201, JSON.stringify(result.body)); // 정상 내용 저장
                assert.equal(result.body.data.message.content, content); // 앞뒤 개행 포함 원문 유지
                assert.equal(sql("SELECT HEX(content) FROM messages WHERE id=" + result.body.data.message.id), hex(content)); // 실제 DB 바이트 일치
            }
        }); // 입력 경계 검사 종료
        await context.test("DB 쓰기 실패 롤백과 연결 오류 비노출", async () => // 부분 저장과 내부 오류 누출 포착
        {
            const before = sql("SELECT COUNT(*) FROM messages"); // 오류 전 저장 수
            sql("CREATE TRIGGER messages_test_failure BEFORE INSERT ON messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_messages_test_failure'"); // 테스트 DB 전용 실제 오류
            try // 오류 후 트리거 정리 보장
            {
                const result = await post("send_message", { channel_id: "1", content: "failure" }, member); // 실제 INSERT 실패
                expectError(result, 500, "INTERNAL_ERROR"); // 공통 내부 오류 응답
                assert.doesNotMatch(JSON.stringify(result.body), /private|SQL|PDO|\.php|password|messages_test/i); // 내부 상세 비노출
                assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 실패 저장 롤백
                sql("START TRANSACTION; SELECT id FROM channels WHERE id=1 FOR UPDATE NOWAIT; ROLLBACK"); // 실패 후 채널 잠금 해제
            }
            finally // 테스트 장애 제거
            {
                sql("DROP TRIGGER messages_test_failure"); // 독립 DB 트리거 제거
            }
            expectError(await post("/connection-failure", { channel_id: "1", content: "failure" }, member), 500, "INTERNAL_ERROR"); // 연결 오류 공통 처리
            assert.equal((await post("send_message", { channel_id: "1", content: "recovered" }, member)).response.status, 201); // 다음 요청 정상 저장
        }); // 실제 DB 오류 검사 종료
        await context.test("네 PHP 프로세스의 같은 세션 잠금 해제와 채널 직렬화", async () => // 세션 잠금과 ID 선할당 포착
        {
            const blocker = await openConnection(); // 채널 선점 연결
            await blocker.command("START TRANSACTION; SELECT id FROM channels WHERE id=1 FOR UPDATE"); // 채널 배타 잠금
            const before = sql("SELECT COUNT(*) FROM messages WHERE channel_id=1"); // 직렬화 전 저장 수
            const requests = [0, 1, 2, 3].map((index) => post("send_message", { channel_id: "1", content: "parallel_" + index }, member, {}, index)); // 같은 세션의 실제 동시 요청
            try // 관측 실패 시 잠금 해제
            {
                await waitUntil(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='" + database + "' AND l.OBJECT_NAME='channels'")) >= 4, "네 요청의 채널 잠금 대기 미관측"); // 세션 해제 후 전체 요청 진입
                assert.equal(sql("SELECT COUNT(*) FROM messages WHERE channel_id=1"), before); // 잠금 전 INSERT 없음
            }
            finally // 동시 요청 진행 허용
            {
                await blocker.command("COMMIT"); // 선점 채널 잠금 해제
            }
            const results = await Promise.all(requests); // 네 실제 커밋 응답
            assert.ok(results.every((value) => value.response.status === 201), JSON.stringify(results.map((value) => value.body))); // 모든 저장 성공
            const ids = results.map((value) => value.body.data.message.id).sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1); // 손실 없는 ID 정렬
            assert.equal(new Set(ids).size, 4); // 네 고유 ID
            assert.equal(sql("SELECT GROUP_CONCAT(id ORDER BY id) FROM messages WHERE content LIKE 'parallel_%'"), ids.join(",")); // 모든 커밋 ID 조회 가능
        }); // 채널 동시성 검사 종료
        await context.test("앞선 INSERT 지연 중 후속 ID 발급 차단과 커밋 순서", async () => // 작은 ID의 뒤늦은 커밋 포착
        {
            const userLock = await openConnection(); // 첫 INSERT 지연용 연결
            await userLock.command("START TRANSACTION; SELECT id FROM users WHERE id=" + member.user.id + " FOR UPDATE"); // 외래 키 검사 지연
            const first = post("send_message", { channel_id: "1", content: "ordered_first" }, member, {}, 1); // 먼저 채널 잠금을 취득할 전송
            let second; // 후속 실제 전송
            try // 관측 실패 시 사용자 잠금 해제
            {
                await waitUntil(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='" + database + "' AND l.OBJECT_NAME='users'")) >= 1, "첫 INSERT의 외래 키 잠금 대기 미관측"); // 첫 요청의 INSERT 진입 확인
                second = post("send_message", { channel_id: "1", content: "ordered_second" }, member, {}, 2); // 후속 같은 채널 전송
                await waitUntil(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='" + database + "' AND l.OBJECT_NAME='channels'")) >= 1, "후속 전송의 채널 잠금 대기 미관측"); // 앞선 커밋 전 후속 INSERT 차단
                assert.equal(sql("SELECT COUNT(*) FROM messages WHERE content IN ('ordered_first','ordered_second')"), "0"); // 두 메시지 모두 커밋 전 상태
            }
            finally // 앞선 커밋의 진행 허용
            {
                await userLock.command("COMMIT"); // 외래 키 지연 제거
            }
            const earlier = await first; // 앞선 실제 저장 결과
            const later = await second; // 후속 실제 저장 결과
            assert.equal(earlier.response.status, 201); // 앞선 커밋 성공
            assert.equal(later.response.status, 201); // 후속 커밋 성공
            assert.ok(BigInt(earlier.body.data.message.id) < BigInt(later.body.data.message.id)); // 채널 커밋 순서와 ID 증가 일치
            assert.equal(sql("SELECT content FROM messages WHERE channel_id=1 AND id>" + earlier.body.data.message.id + " ORDER BY id"), "ordered_second"); // 신규 커서 기준 후속 메시지 보존
        }); // ID와 커밋 순서 검사 종료
        await context.test("전송 중 멤버십 공유 잠금과 탈퇴 경쟁", async () => // 권한 검사 후 탈퇴의 중간 커밋 포착
        {
            const userLock = await openConnection(); // 외래 키 쓰기 지연 연결
            const revoke = await openConnection(); // 실제 멤버십 제거 연결
            await userLock.command("START TRANSACTION; SELECT id FROM users WHERE id=" + member.user.id + " FOR UPDATE"); // INSERT 외래 키 검사 지연
            const sending = post("send_message", { channel_id: "1", content: "before_revoke" }, member, {}, 1); // 실제 전송 진입
            try // 오류 시 사용자 잠금 해제
            {
                await waitUntil(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_locks WHERE OBJECT_SCHEMA='" + database + "' AND OBJECT_NAME='server_members' AND LOCK_STATUS='GRANTED' AND LOCK_TYPE='RECORD' AND LOCK_MODE LIKE 'S%'")) >= 1, "전송의 멤버십 공유 잠금 미관측"); // 실제 공유 잠금 확인
                revoke.process.stdin.write("START TRANSACTION; DELETE FROM server_members WHERE server_id=1 AND user_id=" + member.user.id + "; COMMIT; SELECT 'revoked';\n"); // 실제 탈퇴 요청
                await waitUntil(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='" + database + "' AND l.OBJECT_NAME='server_members'")) >= 1, "탈퇴의 공유 잠금 대기 미관측"); // 전송 완료 전 탈퇴 대기
            }
            finally // 전송 완료 허용
            {
                await userLock.command("COMMIT"); // 외래 키 잠금 해제
            }
            assert.equal((await sending).response.status, 201); // 권한 보유 전송 커밋
            await waitUntil(() => revoke.output.includes("revoked"), "탈퇴 커밋 미관측"); // 전송 이후 탈퇴 완료
            expectError(await post("send_message", { channel_id: "1", content: "after_revoke" }, member), 403, "FORBIDDEN"); // 탈퇴 후 신규 전송 거절
            assert.equal(sql("SELECT COUNT(*) FROM messages WHERE content='before_revoke'"), "1"); // 탈퇴 전 전송 보존
            sql("INSERT INTO server_members (server_id,user_id,role) VALUES (1," + member.user.id + ",'owner')"); // 독립 시나리오 권한 복원
        }); // 멤버십 경쟁 검사 종료
        async function observeAttempts(attempts, required) // 실제 잠금 대기 트랜잭션 관측
        {
            await waitUntil(() => // 새 트랜잭션 ID의 증가 관측
            {
                const waiting = sql("SELECT DISTINCT l.ENGINE_TRANSACTION_ID FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA='" + database + "' AND l.OBJECT_NAME='channels'"); // 현재 채널 잠금 대기 트랜잭션
                for (const id of waiting.split(/\r?\n/).filter(Boolean)) // 비어 있지 않은 트랜잭션 목록
                {
                    attempts.add(id); // 서로 다른 실제 재시도 ID
                }
                return attempts.size >= required; // 요구한 새 트랜잭션 수
            }, "새 전송 트랜잭션 " + required + "회 미관측", 6000); // 시간 제한 관측
        }
        await context.test("시간 초과 후 새 트랜잭션 재시도의 정상 저장", async () => // 잠금 실패의 즉시 포기 포착
        {
            const blocker = await openConnection(); // 최초 잠금 실패 유도 연결
            await blocker.command("START TRANSACTION; SELECT id FROM channels WHERE id=1 FOR UPDATE"); // 채널 선점
            const attempts = new Set(); // 실제 전송 트랜잭션 ID 목록
            const sending = post("/limited-wait", { channel_id: "1", content: "retry_recovered" }, member); // 시간 초과 후 재시도 대상
            try // 관측 실패 시에도 잠금 해제
            {
                await observeAttempts(attempts, 2); // 첫 롤백 이후 새 트랜잭션 확인
            }
            finally // 두 번째 시도의 진행 허용
            {
                await blocker.command("COMMIT"); // 채널 잠금 해제
            }
            assert.equal((await sending).response.status, 201); // 새 트랜잭션 커밋 성공
            assert.equal(sql("SELECT COUNT(*) FROM messages WHERE content='retry_recovered'"), "1"); // 재시도의 단일 저장
        }); // 재시도 복구 검사 종료
        await context.test("잠금 시간 초과의 제한된 재시도와 전체 롤백", async () => // 끝없는 재시도와 잠금 잔류 포착
        {
            const blocker = await openConnection(); // 채널 장기 잠금 연결
            await blocker.command("START TRANSACTION; SELECT id FROM channels WHERE id=1 FOR UPDATE"); // 전송 잠금 지연
            const before = sql("SELECT COUNT(*) FROM messages"); // 실패 전 저장 수
            const attempts = new Set(); // 실제 실패 트랜잭션 ID 목록
            const sending = post("/limited-wait", { channel_id: "1", content: "timeout" }, member); // 실제 짧은 잠금 제한
            try // 시간 초과 후 잠금 정리
            {
                await observeAttempts(attempts, 3); // 최초 시도와 두 재시도 확인
                const result = await sending; // 제한된 재시도의 최종 응답
                expectError(result, 500, "INTERNAL_ERROR"); // 제한 초과 공통 오류
                assert.equal(attempts.size, 3); // 정확히 세 개의 새 트랜잭션
                assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 전체 실패 무저장
            }
            finally // 테스트 선점 잠금 정리
            {
                await blocker.command("COMMIT"); // 채널 잠금 해제
            }
            assert.equal((await post("send_message", { channel_id: "1", content: "after_timeout" }, member)).response.status, 201); // 잠금 실패 이후 정상 복구
        }); // 시간 초과 검사 종료
    }
    finally // 테스트 전용 자원 정리
    {
        for (const connection of connections) // 이 테스트의 DB 연결만 종료
        {
            connection.process.stdin.end("ROLLBACK;\n"); // 미완료 트랜잭션 롤백
            if (connection.process.exitCode === null) // 실행 중 연결 확인
            {
                await new Promise((resolve) => connection.process.once("exit", resolve)); // 연결 종료 확인
            }
        }
        for (const server of servers) // 이 테스트의 PHP만 종료
        {
            if (server.exitCode === null) // 실행 중 서버 확인
            {
                server.kill(); // 전용 PHP 종료
                await new Promise((resolve) => server.once("exit", resolve)); // 서버 종료 확인
            }
        }
        sql("DROP DATABASE " + database, false); // 확인된 무작위 테스트 DB만 제거
    }
}); // 전체 메시지 저장 검증 종료
