import { execFileSync, spawn } from "node:child_process"; // 실제 PHP와 DB 실행
import { querySql } from "./sql-query.mjs"; // 안정적인 실제 DB 조회
import { randomBytes } from "node:crypto"; // 독립 DB 식별자
import { mkdirSync, readFileSync } from "node:fs"; // 파일과 세션 준비
import { createServer } from "node:net"; // 빈 포트 확보
import path from "node:path"; // 실행 경로 연결
import { fileURLToPath } from "node:url"; // 프로젝트 경로
export async function fixture(context) // 독립 공개 API 검사 환경
{
    const root = fileURLToPath(new URL("../../", import.meta.url)); // 저장소 루트
    const database = "systemmakers_management_" + randomBytes(6).toString("hex"); // 정리 범위 제한
    const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // PHP 실행 파일
    const port = process.env.MYSQL_TEST_PORT || "33361"; // 검사 전용 포트
    const locks = []; // 실패 시 해제할 독립 잠금 연결
    let server = null; // 정리할 웹 서버
    if (port !== "33361") // 개발 DB 오접속 방지
    {
        throw new Error("관리 검사는 전용 33361 포트 필요"); // 안전한 실행 조건
    }
    const sql = (input, selected = true) => querySql(port, selected ? database : "", input); // 실제 SQL 결과
    sql("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci", false); // 무작위 검사 DB 생성
    context.after(() => // 잠금 연결부터 정리하는 종료 경계
    {
        locks.forEach((connection) => connection.kill()); // 실패로 남은 잠금 해제
        server?.kill(); // 추가 HTTP 처리 종료
        sql("DROP DATABASE " + database, false); // 해당 DB만 정리
    }); // 검사 종료 처리 끝
    sql(readFileSync(path.join(root, "backend/sql/schema.sql"), "utf8")); // 기존 스키마 적용
    const work = path.join(root, ".runtime", database); // 독립 세션 폴더
    mkdirSync(work, { recursive: true }); // 검사 저장소 준비
    const env = { ...process.env, MYSQL_HOST: "127.0.0.1", MYSQL_PORT: port, MYSQL_DATABASE: database, MYSQL_USER: "root", MYSQL_PASSWORD: "", APP_ENV: "test", SESSION_COOKIE_SECURE: "0", AUTH_RATE_LIMIT_KEY: "management-test-key-at-least-32-bytes-only" }; // 독립 설정
    const probe = createServer(); // 빈 포트 확인
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 임의 포트 배정
    const address = probe.address().port; // 배정된 포트
    await new Promise((resolve) => probe.close(resolve)); // 포트 예약 종료
    const origin = "http://127.0.0.1:" + address; // 공개 라우터 주소
    server = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-d", "session.save_path=" + work, "-S", "127.0.0.1:" + address, path.join(root, "router.php")], { env, windowsHide: true, stdio: "ignore" }); // 실제 PHP 웹 서버
    function client() // 독립 회원 쿠키 경계
    {
        const session = { cookie: "", token: "", id: "" }; // 실제 인증 상태
        session.request = async (endpoint, body = null, extra = {}, method = body === null ? "GET" : "POST") => // 공개 API와 명시한 변경 메서드
        {
            const response = await fetch(origin + "/api/" + endpoint, { method, headers: { Cookie: session.cookie, ...(session.id ? { "X-Expected-User-Id": session.id } : {}), ...(body === null ? {} : { "Content-Type": "application/json", "X-CSRF-Token": session.token }), ...extra }, body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) }); // 실제 HTTP
            const cookie = response.headers.get("set-cookie"); // 서버 쿠키 교체
            if (cookie) // 새 쿠키 존재 여부
            {
                session.cookie = cookie.split(";")[0]; // 최신 쿠키 보관
            }
            const payload = await response.json(); // 실제 JSON 응답
            session.token = payload.data?.csrf_token || session.token; // CSRF 갱신
            return { status: response.status, retry: response.headers.get("retry-after"), ...payload }; // 검사 결과
        }; // 요청 함수 종료
        return session; // 독립 클라이언트
    }
    for (let attempt = 0; attempt < 50; attempt++) // 제한된 시작 확인
    {
        try // 실제 준비 상태 확인
        {
            if ((await client().request("health.php")).status === 200) // DB 연결 성공
            {
                break; // 준비 종료
            }
        }
        catch // 서버 시작 중 연결 실패
        {
            await new Promise((resolve) => setTimeout(resolve, 50)); // 짧은 준비 대기
        }
    }
    async function account(username) // 실제 가입과 로그인
    {
        const session = client(); // 새 쿠키 경계
        await session.request("csrf.php"); // 가입 전 토큰
        const password = "ManagementTest123!"; // 검사 전용 비밀번호
        const registered = await session.request("register.php", { username, email: username + "@example.test", password }); // 실제 계정 생성
        if (registered.status !== 201) // 초기 자료 오류 확인
        {
            throw new Error(JSON.stringify(registered)); // 구체적 검사 실패
        }
        const login = await session.request("login.php", { email: username + "@example.test", password }); // 실제 로그인
        session.id = login.data.user.id; // 실제 사용자 ID
        return session; // 인증된 클라이언트
    }
    const migrate = () => execFileSync(php, ["-c", path.join(root, ".runtime/php.ini"), path.join(root, "scripts/migrate.php")], { env, encoding: "utf8", windowsHide: true }); // 실제 변경 실행 도구
    async function hold(statement, after = "") // 별도 연결에서 실제 잠금 유지
    {
        const source = 'require ' + JSON.stringify(path.join(root, 'backend/config/database.php')) + '; $pdo=db(); $pdo->beginTransaction(); $pdo->query(' + JSON.stringify(statement) + ')->fetchAll(); echo "LOCKED\\n"; fflush(STDOUT); fgets(STDIN); ' + (after ? '$pdo->exec(' + JSON.stringify(after) + '); ' : '') + '$pdo->commit();'; // 실제 잠금과 명시적 해제
        const process = spawn(php, ["-c", path.join(root, ".runtime/php.ini"), "-r", source], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); // 실제 독립 DB 연결
        locks.push(process); // DB 제거 전에 잠금 연결 정리
        await new Promise((resolve, reject) => // 잠금 획득 신호
        {
            process.stdout.once("data", resolve); // 잠금 이후 신호
            process.once("error", reject); // 실행 실패
            process.once("exit", (code) => code && reject(new Error("잠금 연결 실패"))); // 조기 종료 확인
        }); // 신호 확인 끝
        return async () => // 명시적 커밋 경계
        {
            process.stdin.end("release\n"); // 잠금 해제 지시
            await new Promise((resolve) => process.once("exit", resolve)); // 커밋 완료 확인
        }; // 해제 함수 종료
    }
    return { root, env, php, sql, client, account, migrate, hold }; // 검사 경계 반환
}
