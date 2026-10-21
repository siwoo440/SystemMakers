import assert from "node:assert/strict"; // 실제 조회 결과 검증
import { execFileSync, spawn } from "node:child_process"; // 실제 DB와 PHP 실행
import { randomBytes } from "node:crypto"; // 독립 DB 이름 생성
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"; // 비공개 검증 파일 관리
import { createServer } from "node:net"; // 빈 HTTP 포트 선택
import path from "node:path"; // 실행 경로 처리
import { fileURLToPath } from "node:url"; // 프로젝트 경로 변환
import test from "node:test"; // 기본 테스트 도구
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
const database = "systemmakers_history_test_" + randomBytes(6).toString("hex"); // 독립 테스트 DB
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // 실제 PHP 경로
const client = process.env.MYSQL_TEST_CLIENT || "mysql"; // 실제 MySQL 접속 도구
const port = process.env.MYSQL_TEST_PORT || "33361"; // 독립 테스트 서버 포트
function sql(statement, selected = true) // 실제 테스트 DB 요청
{
    return execFileSync(client, ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4", ...(selected ? [database] : [])], { input: statement, encoding: "utf8", windowsHide: true }).trim(); // 실제 SQL 결과
}
test("실제 메시지 최초·이전·신규 HTTP 조회", async (context) => // 누락과 권한 노출 포착
{
    assert.match(database, /^systemmakers_history_test_[a-f0-9]{12}$/); // 삭제 대상 제한
    assert.match(port, /^\d+$/); // 포트 형식 확인
    assert.notEqual(port, "3306"); // 기존 기본 DB 차단
    const work = path.join(root, ".runtime", database); // 비공개 검증 폴더
    mkdirSync(path.join(work, "sessions"), { recursive: true }); // 독립 세션 저장소
    const base = root.replaceAll("\\", "/").replaceAll("'", "\\'"); // PHP 문자열 경로 인용
    writeFileSync(path.join(work, "router.php"), `<?php // 비공개 조회 테스트 라우터
require '${base}/backend/includes/bootstrap.php'; // 실제 공통 처리
$route = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); // 요청 경로
if ($route === '/session') // 검증 계정의 서버 세션 준비
{
    start_secure_session(); // 실제 세션 시작
    $_SESSION = ['user_id' => '1', 'authenticated_at' => time(), 'last_activity_at' => time()]; // 검증 계정 인증
    respond_success([]); // 세션 쿠키 반환
}
require '${base}/router.php'; // 실제 공개 라우터 실행
`); // 테스트 전용 라우터 저장
    const probe = createServer(); // 빈 포트 탐색
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 임의 포트 할당
    const httpPort = probe.address().port; // HTTP 포트 보관
    await new Promise((resolve) => probe.close(resolve)); // 예약 해제
    let server; // 정리할 PHP 서버
    let cookie; // 실제 인증 쿠키
    const origin = "http://127.0.0.1:" + httpPort; // 실제 테스트 주소
    async function request(query, authenticated = true, method = "GET") // 실제 공개 API 요청
    {
        const response = await fetch(origin + "/api/get_messages.php" + query, { method, headers: authenticated ? { Cookie: cookie } : {}, signal: AbortSignal.timeout(5000) }); // 실제 HTTP 조회
        assert.match(response.headers.get("content-type"), /application\/json/); // 공통 JSON 응답
        assert.equal(response.headers.get("cache-control"), "no-store"); // 개인 대화 캐시 차단
        return { status: response.status, body: await response.json() }; // HTTP 상태와 실제 결과
    }
    async function page(query) // 정상 조회 결과 확인
    {
        const result = await request(query); // 실제 API 호출
        assert.equal(result.status, 200, JSON.stringify(result.body)); // 미구현과 조회 실패 포착
        return result.body.data; // 검증할 페이지
    }
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci", false); // 독립 DB 생성
    try // 실패 시 전용 자원 정리
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 스키마
        sql("INSERT INTO users(id,username,email,password_hash) VALUES(1,'history_user','history@example.com','unused'),(2,'other_user','other@example.com','unused'); INSERT INTO servers(id,name,owner_id) VALUES(1,'first',1),(2,'second',2); INSERT INTO server_members(server_id,user_id,role) VALUES(1,1,'owner'),(2,2,'owner'); INSERT INTO channels(id,server_id,name) VALUES(1,1,'general'),(2,1,'empty'),(3,2,'private');"); // 격리된 권한과 빈 채널
        sql("INSERT INTO messages(id,channel_id,user_id,content) VALUES " + Array.from({ length: 125 }, (_, index) => "(" + (index * 2 + 2) + ",1,1,'history-" + (index + 1) + "')").join(",") + "; INSERT INTO messages(id,channel_id,user_id,content) VALUES(999,3,2,'private');"); // 틈이 있는 ID와 다른 채널
        const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0" }; // 독립 DB 실행 설정
        server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(work, "sessions"), "-S", "127.0.0.1:" + httpPort, "-t", work, path.join(work, "router.php")], { env, windowsHide: true, stdio: "ignore" }); // 실제 PHP 실행
        for (let attempt = 0; attempt < 50; attempt++) // 제한된 시작 확인
        {
            try // 실제 서버 연결
            {
                const response = await fetch(origin + "/session"); // 인증 세션 발급
                cookie = response.headers.get("set-cookie").split(";")[0]; // 쿠키만 보관
                break; // 준비 확인 종료
            }
            catch // 시작 전 연결 실패
            {
                await new Promise((resolve) => setTimeout(resolve, 50)); // 짧은 준비 대기
            }
        }
        assert.ok(cookie, "실제 PHP 세션 준비 필요"); // 테스트 환경 준비 확인
        await context.test("최신 50개와 이전 페이지의 실제 결과 커서", async () => // 최신 선택과 역순 반환 오류 포착
        {
            const latest = await page("?channel_id=1"); // 기본 최초 조회
            assert.equal(latest.messages.length, 50); // 기본 개수
            assert.equal(latest.messages[0].id, "152"); // 최신 50개 중 첫 ID
            assert.equal(latest.messages.at(-1).id, "250"); // 다른 채널 ID 제외
            assert.deepEqual(latest.pagination, { mode: "initial", has_more: true, next_before_id: "152", next_after_id: "250" }); // 실제 결과 커서
            const older = await page("?channel_id=1&before_id=152&limit=100"); // 이전 기록 추가 조회
            assert.equal(older.messages.length, 75); // 남은 이전 메시지 수
            assert.equal(older.messages[0].id, "2"); // 최초 기록
            assert.equal(older.messages.at(-1).id, "150"); // 배타적 이전 커서
            assert.deepEqual(older.pagination, { mode: "before", has_more: false, next_before_id: "2", next_after_id: "150" }); // 이전 결과 방향
            assert.deepEqual(Object.keys(latest.messages[0]).sort(), ["channel_id", "content", "created_at", "id", "user_id", "username"]); // 이메일과 비밀 필드 비노출
        }); // 최초·이전 검사 종료
        await context.test("100개 초과 신규 적체의 누락과 중복 없는 페이지", async () => // 전체 최댓값 커서 오류 포착
        {
            const first = await page("?channel_id=1&after_id=0&limit=100"); // 처음부터 신규 조회
            assert.equal(first.messages.length, 100); // 최대 페이지 크기
            assert.deepEqual(first.pagination, { mode: "after", has_more: true, next_before_id: "2", next_after_id: "200" }); // 반환된 최대 ID 기준
            const next = await page("?channel_id=1&after_id=200&limit=100"); // 다음 적체 페이지
            assert.equal(next.messages.length, 25); // 누락 없는 남은 페이지
            assert.equal(next.messages[0].id, "202"); // 첫 페이지와 중복 없음
            assert.equal(next.messages.at(-1).id, "250"); // 마지막 메시지 도달
            assert.equal(next.pagination.has_more, false); // 적체 소진
        }); // 신규 적체 검사 종료
        await context.test("빈 최초·이전·신규 페이지와 존재하지 않는 범위 커서", async () => // 빈 결과의 잘못된 커서 초기화 포착
        {
            for (const [query, mode, after] of [["?channel_id=2", "initial", "0"], ["?channel_id=1&before_id=1", "before", "0"], ["?channel_id=1&after_id=777", "after", "777"]]) // 독립적인 빈 결과 계약
            {
                const result = await page(query); // 실제 빈 조회
                assert.deepEqual(result, { messages: [], pagination: { mode, has_more: false, next_before_id: null, next_after_id: after } }); // 정확한 빈 페이지 응답
            }
        }); // 빈 결과 검사 종료
        await context.test("메서드·인증·잘못된 조회·채널 권한", async () => // 인증 우회와 잘못된 입력 허용 포착
        {
            assert.equal((await request("", false, "POST")).status, 405); // 메서드 우선
            assert.equal((await request("?invalid=1", false)).status, 401); // 입력보다 인증 우선
            for (const query of ["", "?channel_id=01", "?channel_id=1&limit=0", "?channel_id=1&limit=101", "?channel_id=1&limit=01", "?channel_id=1&limit=1.0", "?channel_id=1&before_id=0", "?channel_id=1&after_id=18446744073709551616", "?channel_id=1&before_id=2&after_id=0", "?channel_id=1&channel_id=2", "?channel_id[]=1", "?channel_id=1&user_id=2"]) // 잘못된 조회 값 목록
            {
                const result = await request(query); // 실제 조회 거절 확인
                assert.equal(result.status, 400, query); // 잘못된 조건 거절
                assert.equal(result.body.error.code, "INVALID_QUERY"); // 공통 입력 오류
            }
            assert.equal((await request("?channel_id=3")).status, 403); // 다른 서버의 메시지 차단
            assert.equal((await request("?channel_id=999")).status, 404); // 없는 채널 구분
            sql("DELETE FROM server_members WHERE server_id=1 AND user_id=1"); // 조회 후 실제 탈퇴
            assert.equal((await request("?channel_id=1&after_id=0")).status, 403); // 현재 소속 재검사
            sql("INSERT INTO server_members(server_id,user_id,role) VALUES(1,1,'owner')"); // 뒤 검사 소속 복원
        }); // 접근과 입력 검사 종료
        await context.test("큰 문자열 ID와 한글·태그·개행 원문", async () => // 정수 정밀도와 HTML 변형 포착
        {
            sql("INSERT INTO messages(id,channel_id,user_id,content) VALUES(9007199254740993,1,1,CONVERT(0x" + Buffer.from("<b>한글 😀</b>\n원문").toString("hex") + " USING utf8mb4)),(9007199254740995,1,1,'last')"); // 안전 정수 밖의 실제 자료
            const result = await page("?channel_id=1&after_id=9007199254740992&limit=1"); // 큰 ID 범위 조회
            assert.equal(result.messages[0].id, "9007199254740993"); // 문자열 정밀도 유지
            assert.equal(result.messages[0].content, "<b>한글 😀</b>\n원문"); // 원문 그대로 반환
            assert.equal(result.pagination.next_after_id, "9007199254740993"); // 실제 반환 ID 커서
            assert.equal(result.pagination.has_more, true); // 다음 큰 ID 존재
        }); // 큰 ID 검사 종료
    }
    finally // 독립 자원 정리
    {
        if (server && server.exitCode === null) // 이 테스트 서버 여부
        {
            server.kill(); // 테스트 PHP 종료
            await new Promise((resolve) => server.once("exit", resolve)); // 종료 확인
        }
        sql("DROP DATABASE " + database, false); // 무작위 테스트 DB만 삭제
    }
}); // 실제 조회 전체 검사 종료
