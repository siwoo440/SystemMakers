import assert from "node:assert/strict"; // 실제 전체 흐름 검증
import { execFileSync, spawn } from "node:child_process"; // PHP와 MySQL 실행
import { randomBytes } from "node:crypto"; // 무작위 검증 DB
import { mkdirSync, readFileSync } from "node:fs"; // 스키마와 세션 준비
import { createServer } from "node:net"; // 빈 웹 포트
import path from "node:path"; // 실행 경로 처리
import { fileURLToPath } from "node:url"; // 프로젝트 주소 변환
import test from "node:test"; // 기본 검사 도구
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // 실제 PHP
const mysql = process.env.MYSQL_TEST_CLIENT || "mysql"; // 실제 DB 도구
const port = process.env.MYSQL_TEST_PORT || "33361"; // 독립 MySQL 서버
const database = "systemmakers_acceptance_" + randomBytes(6).toString("hex"); // 무작위 전용 DB
function sql(statement, selected = true) // 독립 실제 SQL 요청
{
    return execFileSync(mysql, ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4", ...(selected ? [database] : [])], { input: statement, encoding: "utf8", windowsHide: true }).trim(); // 실제 결과 반환
}
test("공개 웹 API의 가입부터 로그아웃까지 전체 인수 흐름", async (context) => // 개별 API 사이의 계약 연결 오류 포착
{
    assert.match(database, /^systemmakers_acceptance_[a-f0-9]{12}$/); // 정리 대상 이름 제한
    assert.match(port, /^\d+$/); // DB 포트 형식
    assert.notEqual(port, "3306"); // 기존 기본 DB 차단
    const work = path.join(root, ".runtime", database); // 비공개 세션 경로
    mkdirSync(work, { recursive: true }); // 독립 세션 저장소
    const probe = createServer(); // 임의 HTTP 포트
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 빈 포트 확보
    const httpPort = probe.address().port; // 선택된 포트
    await new Promise((resolve) => probe.close(resolve)); // 예약 해제
    const origin = "http://127.0.0.1:" + httpPort; // 실제 라우터 주소
    const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0", AUTH_RATE_LIMIT_KEY: "acceptance-only-secret-key-at-least-32-bytes" }; // 독립 DB와 인증 설정
    let server; // 정리할 서버
    function client() // 브라우저와 같은 쿠키 세션 경계
    {
        const session = { cookie: "", token: "" }; // 세션별 쿠키와 CSRF
        session.request = async (endpoint, body = null, extra = {}) => // 실제 공개 API 호출
        {
            const headers = { Cookie: session.cookie, ...(body === null ? {} : { "Content-Type": "application/json", "X-CSRF-Token": session.token }), ...extra }; // 실제 인증과 요청 보호
            const response = await fetch(origin + "/api/" + endpoint, { method: body === null ? "GET" : "POST", headers, body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }); // 실제 HTTP와 PHP
            const cookie = response.headers.get("set-cookie"); // 서버 쿠키 교체
            if (cookie) // 실제 쿠키 갱신 여부
            {
                session.cookie = cookie.split(";")[0]; // 브라우저와 같은 최신 쿠키
            }
            const payload = await response.json(); // 실제 JSON 응답
            if (payload.data?.csrf_token) // 새 보호 토큰 여부
            {
                session.token = payload.data.csrf_token; // 인증 교체 후 최신 토큰
            }
            return { status: response.status, ...payload }; // 실제 상태와 공개 자료
        }; // 실제 요청 경계 종료
        return session; // 독립 로그인 세션
    }
    const password = "AcceptancePass123!"; // 검증 전용 비밀번호
    const owner = client(); // 서버 소유자 세션
    const member = client(); // 같은 채널 참여자
    const outsider = client(); // 미참여 계정
    let ownerUser; // 서버가 발급한 소유자
    let memberUser; // 서버가 발급한 참여자
    let channel; // 실제 개발 채널
    let saved; // 실제 저장 메시지
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci", false); // 빈 검증 DB
    try // 모든 테스트 자원 정리 보장
    {
        sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 실제 테이블 생성
        server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + work, "-S", "127.0.0.1:" + httpPort, "-t", path.join(root, "frontend"), path.join(root, "router.php")], { env, windowsHide: true, stdio: "ignore" }); // 실제 공개 라우터 실행
        for (let attempt = 0; attempt < 50; attempt++) // 제한된 시작 확인
        {
            try // 실제 DB 연결 상태 요청
            {
                if ((await owner.request("health.php")).status === 200) // 실제 준비 완료
                {
                    break; // 다음 흐름 진행
                }
            }
            catch // 시작 전 연결 실패
            {
                await new Promise((resolve) => setTimeout(resolve, 50)); // 짧은 준비 대기
            }
        }
        await context.test("가입·중복·실패 로그인·정상 인증·빈 소속", async () => // 가입 자동 로그인과 잘못된 계정 복원 포착
        {
            for (const [session, username] of [[owner, "accept_owner"], [member, "accept_member"], [outsider, "accept_outsider"]]) // 서로 다른 실제 계정
            {
                assert.equal((await session.request("csrf.php")).status, 200); // 로그인 전 보호 정보
                const registered = await session.request("register.php", { username, email: username + "@example.com", password }); // 실제 가입
                assert.equal(registered.status, 201); // 계정 생성 성공
                assert.equal((await session.request("get_current_user.php")).status, 401); // 가입만으로 인증 없음
                assert.equal((await session.request("register.php", { username, email: username + "@example.com", password })).status, 409); // 중복 계정 거절
                assert.equal((await session.request("login.php", { email: username + "@example.com", password: "WrongPassword123!" })).status, 401); // 잘못된 비밀번호 거절
                const logged = await session.request("login.php", { email: username + "@example.com", password }); // 실제 해시 인증
                assert.equal(logged.status, 200); // 정상 로그인
                session.user = logged.data.user; // 서버의 실제 사용자
                assert.deepEqual((await session.request("get_channels.php")).data.channels, []); // 가입 직후 빈 소속
            }
            ownerUser = owner.user; // 실제 소유자 보관
            memberUser = member.user; // 실제 참여자 보관
        }); // 가입과 인증 검사 종료
        await context.test("명시적 개발 소속·채널·원문 전송·다른 회원 조회", async () => // 개발 데이터와 실제 웹 계약 연결 포착
        {
            execFileSync(php, ["-c", path.join(root, ".runtime/php.ini"), path.join(root, "scripts/seed-dev.php"), "--owner=accept_owner", "--member=accept_member"], { env, windowsHide: true }); // 기존 계정만 개발 서버 연결
            const channels = (await owner.request("get_channels.php")).data.channels; // 실제 소속 목록
            assert.deepEqual(channels.map((item) => item.name), ["일반", "개발", "공지"]); // 실제 준비 결과
            channel = channels[0].id; // 첫 실제 채널 ID
            assert.deepEqual((await owner.request("get_messages.php?channel_id=" + channel)).data.messages, []); // 최초 빈 기록
            const posted = await owner.request("send_message.php", { channel_id: channel, content: "  <b>원문</b>\n한글 😀  " }); // 원문 전송
            assert.equal(posted.status, 201); // 실제 저장 성공
            saved = posted.data.message; // 저장된 메시지
            assert.equal(saved.user_id, ownerUser.id); // 세션 작성자
            const viewed = await member.request("get_messages.php?channel_id=" + channel + "&after_id=0"); // 다른 회원의 신규 조회
            assert.deepEqual(viewed.data.messages, [saved]); // DB 원문과 공개 응답 일치
            assert.deepEqual((await member.request("get_messages.php?channel_id=" + channel + "&after_id=" + saved.id)).data.messages, []); // 후속 폴링의 중복 없음
            assert.deepEqual((await owner.request("get_messages.php?channel_id=" + channel)).data.messages, [saved]); // 새 화면의 기록 복원
        }); // 소속과 메시지 검사 종료
        await context.test("CSRF·타인 채널·없는 채널·작성자 위조의 무저장", async () => // 보호 검사 연결 누락 포착
        {
            const before = sql("SELECT COUNT(*) FROM messages"); // 실패 전 저장 수
            assert.equal((await owner.request("send_message.php", { channel_id: channel, content: "invalid" }, { "X-CSRF-Token": "bad" })).status, 403); // 요청 보호 거절
            assert.equal((await outsider.request("get_messages.php?channel_id=" + channel)).status, 403); // 미참여 조회 거절
            assert.equal((await outsider.request("send_message.php", { channel_id: channel, content: "forbidden" })).status, 403); // 미참여 저장 거절
            assert.equal((await owner.request("get_messages.php?channel_id=18446744073709551615")).status, 404); // 없는 채널 구분
            assert.equal((await owner.request("send_message.php", { channel_id: channel, content: "forged", user_id: memberUser.id })).status, 422); // 작성자 위조 입력 거절
            assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 실패 전체의 저장 없음
        }); // 권한과 입력 검사 종료
        await context.test("공유 쿠키 계정 변경의 저장·조회·로그아웃 사전 거절", async () => // 새 CSRF로 다른 작성자의 초안 저장 포착
        {
            const before = sql("SELECT COUNT(*) FROM messages"); // 기존 대화 수
            const expectedOwner = { "X-Expected-User-Id": ownerUser.id }; // 오래된 화면의 기대 계정
            const changed = await member.request("send_message.php", { channel_id: channel, content: "old owner draft" }, expectedOwner); // 새 계정 쿠키와 유효 CSRF지만 이전 화면 사용자
            assert.equal(changed.status, 403); // 저장 전에 계정 변경 거절
            assert.equal(changed.error.code, "SESSION_CHANGED"); // 권한 상실과 다른 안내
            for (const endpoint of ["get_current_user.php", "get_channels.php", "get_messages.php?channel_id=" + channel]) // 보호된 조회 연결
            {
                assert.equal((await member.request(endpoint, null, expectedOwner)).error.code, "SESSION_CHANGED"); // 다른 계정 자료 적용 차단
            }
            assert.equal((await member.request("logout.php", {}, expectedOwner)).error.code, "SESSION_CHANGED"); // 다른 계정 로그아웃 차단
            assert.equal((await member.request("get_current_user.php")).data.user.id, memberUser.id); // 새 계정 인증 보존
            for (const expected of ["", "01", "+1", "18446744073709551616"]) // 명시된 잘못된 기대 계정 헤더
            {
                assert.equal((await member.request("get_current_user.php", null, { "X-Expected-User-Id": expected })).error.code, "SESSION_CHANGED"); // 생략과 잘못된 값 구분
            }
            assert.equal(sql("SELECT COUNT(*) FROM messages"), before); // 다른 작성자로 저장 없음
            assert.equal((await member.request("send_message.php", { channel_id: channel, content: "member own message" }, { "X-Expected-User-Id": memberUser.id })).status, 201); // 일치한 계정은 정상 전송
        }); // 계정 변경 검사 종료
        await context.test("탈퇴 뒤 조회·전송 차단과 로그아웃 후 복원 불가", async () => // 기존 소속과 폐기 쿠키의 재사용 포착
        {
            sql("DELETE FROM server_members WHERE user_id=" + memberUser.id); // 실제 테스트 계정 탈퇴
            assert.deepEqual((await member.request("get_channels.php")).data.channels, []); // 현재 소속 재조회
            assert.equal((await member.request("get_messages.php?channel_id=" + channel)).status, 403); // 과거 접근 권한 폐기
            assert.equal((await member.request("send_message.php", { channel_id: channel, content: "left" })).status, 403); // 탈퇴 후 저장 거절
            const previousCookie = owner.cookie; // 종료 전 인증 쿠키
            assert.equal((await owner.request("logout.php", {})).status, 200); // 실제 로그아웃
            assert.equal((await owner.request("get_current_user.php")).status, 401); // 게스트 전환
            owner.cookie = previousCookie; // 폐기된 쿠키 재사용 시도
            assert.equal((await owner.request("get_messages.php?channel_id=" + channel)).status, 401); // 폐기 인증 복원 불가
            assert.equal(sql("SELECT COUNT(*) FROM messages WHERE id=" + saved.id), "1"); // 로그아웃과 탈퇴의 기존 대화 보존
        }); // 종료 흐름 검사 종료
    }
    finally // 무작위 테스트 자원 정리
    {
        if (server && server.exitCode === null) // 이번 PHP 서버만 선택
        {
            server.kill(); // 검증 서버 종료
            await new Promise((resolve) => server.once("exit", resolve)); // 종료 확인
        }
        sql("DROP DATABASE " + database, false); // 이름을 검증한 독립 DB만 삭제
    }
}); // 전체 인수 흐름 종료
