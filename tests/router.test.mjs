import assert from "node:assert/strict"; // 응답 검증 도구
import { spawn } from "node:child_process"; // PHP 서버 실행
import { existsSync } from "node:fs"; // 라우터 구현 확인
import { createServer } from "node:net"; // 빈 포트 선택
import { fileURLToPath } from "node:url"; // 로컬 경로 계산
import test from "node:test"; // 통합 테스트 도구
const root = fileURLToPath(new URL("../", import.meta.url)); // 프로젝트 루트
test("실제 웹 라우터와 비공개 경로 차단", async (context) => // 웹 공개 범위 검사
{
    assert.ok(existsSync(root + "router.php"), "router.php 미구현"); // 라우터 구현 확인
    const socket = createServer(); // 임시 포트 검사
    await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve)); // 빈 포트 예약
    const port = socket.address().port; // 선택 포트 읽기
    await new Promise(resolve => socket.close(resolve)); // 예약 포트 해제
    const php = process.env.PHP_TEST_BIN || root + ".runtime/php/php.exe"; // PHP 실행 경로
    const child = spawn(php, ["-c", root + ".runtime/php.ini", "-S", "127.0.0.1:" + port, "-t", root + "frontend", root + "router.php"], { cwd: root, windowsHide: true, stdio: "pipe" }); // 실제 라우터 서버
    const origin = "http://127.0.0.1:" + port; // 테스트 사이트 주소
    let output = ""; // 준비·실패 진단
    child.stderr.on("data", chunk => output += chunk); // PHP 시작 로그 수집
    try // 종료 보장 범위
    {
        let ready = false; // 서버 준비 상태
        for (let attempt = 0; attempt < 50; attempt++) // 제한된 준비 확인
        {
            try // 준비 요청 시도
            {
                const probe = await fetch(origin, { signal: AbortSignal.timeout(500) }); // 실제 응답 확인
                await probe.arrayBuffer(); // 준비 응답 본문 정리
                ready = true; // 요청 가능한 상태
                break; // 준비 확인 종료
            }
            catch // 준비 전 연결 실패
            {
                await new Promise(resolve => setTimeout(resolve, 100)); // 다음 확인 간격
            }
        }
        assert.ok(ready, output); // 시작 실패 원인 보고
        await context.test("홈과 정적 파일 응답", async () => // 웹 파일 공개 확인
        {
            const home = await fetch(origin); // 홈 화면 조회
            assert.equal(home.status, 200); // 홈 응답 성공
            assert.match(await home.text(), /SystemMakers/); // 프로젝트 화면 확인
            for (const file of ["/app.css", "/app.js"]) // 화면 자원 조회
            {
                const asset = await fetch(origin + file); // 정적 자원 요청
                assert.equal(asset.status, 200); // 자원 응답 성공
                assert.equal(asset.headers.get("x-content-type-options"), "nosniff"); // MIME 해석 제한
                assert.ok((await asset.text()).length > 0); // 실제 자원 본문 확인과 정리
            }
        }); // 홈 검사 종료
        await context.test("실제 CSRF와 비로그인 응답", async () => // API 연결 검사
        {
            const token = await fetch(origin + "/api/csrf.php"); // CSRF 발급 요청
            assert.equal(token.status, 200); // 공개 발급 성공
            assert.match((await token.json()).data.csrf_token, /^[a-f0-9]{64}$/); // 토큰 형식 확인
            const current = await fetch(origin + "/api/get_current_user.php"); // 로그인 상태 조회
            assert.equal(current.status, 401); // 비로그인 상태 구분
            const missing = await fetch(origin + "/api/missing.php"); // 없는 API 조회
            assert.equal(missing.status, 404); // 없는 경로 거절
            assert.equal((await missing.json()).success, false); // 공통 오류 구조
        }); // API 검사 종료
        await context.test("SQL 설정 이력 실행 도구의 외부 접근 거절", async () => // 비공개 경로 보호
        {
            for (const path of ["/backend/sql/schema.sql", "/backend/config/database.php", "/backend/includes/auth.php", "/.git/config", "/.runtime/php.ini", "/docs/API.md", "/%2e%2e/backend/sql/schema.sql"]) // 비공개 경로 목록
            {
                const response = await fetch(origin + path); // 비공개 자원 요청
                assert.equal(response.status, 404, path); // 파일 미공개 확인
                assert.ok(!(await response.text()).includes("CREATE TABLE")); // SQL 원문 비노출
            }
        }); // 비공개 경로 검사 종료
    }
    finally // 테스트 서버 종료
    {
        child.kill(); // 소유한 PHP 서버만 종료
    }
}); // 웹 라우터 검사 종료
