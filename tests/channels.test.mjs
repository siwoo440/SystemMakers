import assert from "node:assert/strict"; // 응답과 데이터 검증
import { execFileSync, spawn, spawnSync } from "node:child_process"; // 실제 PHP와 MySQL 실행
import { randomBytes } from "node:crypto"; // 테스트 DB 고유 이름
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"; // 비공개 테스트 자료
import net from "node:net"; // 빈 서버 포트 확인
import path from "node:path"; // 운영체제 경로 조합
import { fileURLToPath } from "node:url"; // 저장소 위치 변환
import test from "node:test"; // 기본 테스트 실행
const root = fileURLToPath(new URL("../", import.meta.url)); // 저장소 루트
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // PHP 실행 위치
const client = process.env.MYSQL_TEST_CLIENT || path.join(root, ".runtime/mysql/mysql-8.4.13-winx64/bin/mysql.exe"); // 테스트 DB 도구
const port = process.env.MYSQL_TEST_PORT || "33360"; // 프로젝트 전용 DB 포트
const database = "systemmakers_channels_test_" + randomBytes(6).toString("hex"); // 삭제 대상 제한 이름
function sql(statement, selected = true) // 실제 테스트 DB 요청
{
    const args = ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4"]; // 독립 로컬 연결
    if (selected) // 테스트 DB 선택 여부
    {
        args.push(database); // 명시적인 테스트 DB
    }
    return execFileSync(client, args, { input: statement, encoding: "utf8", windowsHide: true }).trim().replaceAll("\r\n", "\n"); // 실제 결과와 줄바꿈 정규화
}
test("실제 채널 목록과 개발 데이터 준비", async (context) => // 사용자 소속 분리와 CLI 안전성 검증
{
    assert.match(database, /^systemmakers_channels_test_[a-f0-9]{12}$/); // 테스트 삭제 범위 확인
    assert.match(port, /^\d+$/); // 포트 입력 형식
    assert.notEqual(port, "3306"); // 기존 DB 기본 포트 회피
    const work = path.join(root, ".runtime", database); // 비공개 검증 폴더
    mkdirSync(path.join(work, "sessions"), { recursive: true }); // 독립 인증 저장소
    const base = root.replaceAll("\\", "/").replaceAll("'", "\\'"); // PHP 파일 경로 인용
    writeFileSync(path.join(work, "router.php"), `<?php // 비공개 채널 테스트 라우터
require '${base}/backend/includes/bootstrap.php'; // 실제 공통 API 환경
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/fixture-auth') // 테스트 전용 인증 준비
{
    start_secure_session(); // 실제 세션 시작
    $_SESSION = ['user_id' => $_GET['id'] ?? '1', 'authenticated_at' => time(), 'last_activity_at' => time()]; // 테스트 계정 인증 시각
    respond_success([]); // 실제 쿠키 발급
}
require '${base}/router.php'; // 실제 공개 라우터 실행
`); // 테스트 전용 소스 저장
    const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0" }; // 격리 실행 설정
    const probe = net.createServer(); // HTTP 포트 탐색
    await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); // 임의 포트 할당
    const httpPort = probe.address().port; // 테스트 웹 포트
    await new Promise(resolve => probe.close(resolve)); // 포트 예약 해제
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;", false); // 전용 DB 생성
    let server; // 종료할 테스트 서버
    try // 실패 시 자원 정리 보장
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 스키마 적용
        sql("INSERT INTO users (id,username,email,password_hash) VALUES (1,'owner','owner@example.com','unused'),(2,'member','member@example.com','unused'),(3,'outsider','outsider@example.com','unused');"); // 소속 없는 기존 계정 준비
        server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(work, "sessions"), "-S", "127.0.0.1:" + httpPort, "-t", work, path.join(work, "router.php")], { env, windowsHide: true, stdio: "ignore" }); // 실제 PHP 실행
        const origin = "http://127.0.0.1:" + httpPort; // 테스트 웹 주소
        async function request(route, headers = {}, method = "GET") // 실제 JSON 응답 조회
        {
            const response = await fetch(origin + route, { headers, method }); // 실제 요청
            const body = await response.json(); // 실제 JSON 읽기
            return { response, body }; // 응답 상태와 자료
        }
        let ready = false; // 서버 시작 확인
        for (let attempt = 0; attempt < 60; attempt++) // 제한된 준비 요청
        {
            try // 시작 전 연결 거절 허용
            {
                await request("/api/csrf.php"); // 실제 공통 경로 확인
                ready = true; // 시작 완료
                break; // 준비 반복 종료
            }
            catch // 아직 준비되지 않은 서버
            {
                await new Promise(resolve => setTimeout(resolve, 50)); // 짧은 재확인 간격
            }
        }
        assert.ok(ready); // 서버 준비 실패 구분
        const ownerCookie = (await request("/fixture-auth?id=1")).response.headers.get("set-cookie").split(";")[0]; // 소유자 실제 인증 쿠키
        const memberCookie = (await request("/fixture-auth?id=2")).response.headers.get("set-cookie").split(";")[0]; // 멤버 실제 인증 쿠키
        const outsiderCookie = (await request("/fixture-auth?id=3")).response.headers.get("set-cookie").split(";")[0]; // 비소속 실제 인증 쿠키
        await context.test("소속 없는 계정의 빈 채널 목록", async () => // 임의 채널 공개와 자동 가입 포착
        {
            const result = await request("/api/get_channels.php", { Cookie: ownerCookie }); // 실제 목록 요청
            assert.equal(result.response.status, 200); // 공개 경로 연결 확인
            assert.deepEqual(result.body.data.channels, []); // 소속 없는 계정의 빈 결과
            assert.equal(sql("SELECT COUNT(*) FROM server_members;"), "0"); // 조회 중 자동 가입 차단
        }); // 빈 목록 검사 종료
        await context.test("메서드·인증·조회 조건 검사", async () => // 인증 없는 목록과 입력 누락 검사 포착
        {
            assert.equal((await request("/api/get_channels.php")).response.status, 401); // 게스트 목록 차단
            assert.equal((await request("/api/get_channels.php?user_id=1")).response.status, 401); // 입력 검사보다 인증 우선
            const method = await request("/api/get_channels.php", {}, "POST"); // 잘못된 메서드 요청
            assert.equal(method.response.status, 405); // 메서드 검사 우선
            assert.equal(method.response.headers.get("allow"), "GET"); // 지원 메서드 안내
            assert.equal((await request("/api/get_channels.php?user_id=2", { Cookie: ownerCookie })).response.status, 400); // 타인 식별자 조회 거절
        }); // 공통 보호 검사 종료
        const seedArgs = ["-c", path.join(root, ".runtime/php.ini"), path.join(root, "scripts/seed-dev.php"), "--owner=owner", "--member=member"]; // 명시적인 개발 데이터 대상
        await context.test("기존 계정의 개발 서버·멤버십·채널 준비", async () => // 개발 데이터 누락과 임의 계정 생성 포착
        {
            const result = spawnSync(php, seedArgs, { env, encoding: "utf8", windowsHide: true }); // 실제 CLI 준비 실행
            assert.equal(result.status, 0, result.stderr); // 준비 성공 확인
            const prepared = JSON.parse(result.stdout); // 준비 결과 읽기
            assert.equal(prepared.success, true); // CLI 성공 구조
            assert.equal(sql("SELECT COUNT(*) FROM users;"), "3"); // 기존 계정만 사용
            assert.equal(sql("SELECT COUNT(*) FROM channels;"), "3"); // 개발 채널 세 개 준비
            assert.equal(sql("SELECT role FROM server_members WHERE user_id=1;"), "owner"); // 생성자 소속 일치
            assert.equal(sql("SELECT role FROM server_members WHERE user_id=2;"), "member"); // 지정한 멤버만 소속 추가
        }); // 개발 데이터 검사 종료
        await context.test("실제 소속별 목록·문자열 ID·순서·공개 필드", async () => // 다른 서버 목록 유출과 ID 변형 포착
        {
            sql("INSERT INTO servers (id,name,owner_id) VALUES (99,'private',3); INSERT INTO server_members (server_id,user_id,role) VALUES (99,3,'owner'); INSERT INTO channels (id,server_id,name) VALUES (99,99,'private');"); // 타인 전용 채널 준비
            const owner = await request("/api/get_channels.php", { Cookie: ownerCookie }); // 소유자 목록
            const member = await request("/api/get_channels.php", { Cookie: memberCookie }); // 같은 서버 멤버 목록
            const outsider = await request("/api/get_channels.php", { Cookie: outsiderCookie }); // 다른 서버 목록
            assert.deepEqual(owner.body.data.channels.map(channel => channel.id), ["1", "2", "3"]); // DB ID 순서 유지
            assert.deepEqual(member.body.data.channels, owner.body.data.channels); // 같은 소속의 동일 목록
            assert.deepEqual(outsider.body.data.channels.map(channel => channel.id), ["99"]); // 타인 서버 분리
            assert.deepEqual(Object.keys(owner.body.data.channels[0]).sort(), ["id", "name", "server_id", "server_name"]); // 비밀 없는 공개 필드
            assert.equal(owner.body.data.channels[0].server_id, "1"); // 문자열 서버 ID
            assert.equal(owner.response.headers.get("cache-control"), "no-store"); // 사용자 목록 캐시 차단
        }); // 소속 목록 검사 종료
        await context.test("개발 준비 재실행과 기존 대화 보존", async () => // 중복 서버 생성과 초기화 포착
        {
            sql("INSERT INTO messages (channel_id,user_id,content) VALUES (1,1,'preserved');"); // 보존할 실제 대화
            sql("UPDATE server_members SET role='admin' WHERE user_id=2;"); // 보존할 기존 관리자 역할
            const result = spawnSync(php, seedArgs, { env, encoding: "utf8", windowsHide: true }); // 같은 준비 반복
            assert.equal(result.status, 0, result.stderr); // 재실행 성공
            assert.equal(sql("SELECT COUNT(*) FROM servers;"), "2"); // 서버 중복 생성 없음
            assert.equal(sql("SELECT COUNT(*) FROM channels;"), "4"); // 기존 채널 보존
            assert.equal(sql("SELECT content FROM messages;"), "preserved"); // 메시지 초기화 없음
            assert.equal(sql("SELECT role FROM server_members WHERE user_id=2;"), "admin"); // 재실행 시 관리자 강등 없음
        }); // 재실행 검사 종료
        await context.test("운영 환경·없는 계정의 개발 데이터 생성 거절", async () => // 잘못된 실행 범위와 부분 데이터 포착
        {
            for (const options of [{ args: seedArgs, env: { ...env, APP_ENV: "production" } }, { args: [...seedArgs, "--member=missing"], env }]) // 거절할 실행 조건
            {
                const result = spawnSync(php, options.args, { env: options.env, encoding: "utf8", windowsHide: true }); // 실제 거절 실행
                assert.notEqual(result.status, 0); // 실패 종료 상태
                assert.equal(sql("SELECT COUNT(*) FROM server_members;"), "3"); // 부분 멤버십 생성 없음
                assert.equal(sql("SELECT COUNT(*) FROM channels;"), "4"); // 부분 채널 생성 없음
            }
        }); // CLI 보호 검사 종료
    }
    finally // 전용 검증 자원 정리
    {
        if (server && server.exitCode === null) // 이 검사에서 실행한 서버 여부
        {
            server.kill(); // 전용 PHP만 종료
            await new Promise(resolve => server.once("exit", resolve)); // 종료 완료 확인
        }
        sql("DROP DATABASE " + database + ";", false); // 검증한 이름의 전용 DB만 삭제
    }
}); // 전체 채널 통합 검사 종료
