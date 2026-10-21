import assert from "node:assert/strict"; // 동작 결과 검사
import test from "node:test"; // 기본 회귀 검사 도구
import { readFileSync } from "node:fs"; // 실제 화면 코드 읽기
import vm from "node:vm"; // 독립 브라우저 실행 영역
import { MessageFeed } from "../frontend/message-feed.mjs"; // 실제 메시지 상태 관리
const source = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8"); // 검사 대상 원본
const noChange = () => undefined; // 상태 변화 없는 브라우저 경계
function element() // 브라우저 요소의 외부 경계
{
    return { value: "", disabled: false, hidden: false, textContent: "", dataset: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, classList: { toggle: noChange, add: noChange, remove: noChange }, setAttribute: noChange, removeAttribute: noChange, setCustomValidity: noChange, addEventListener: noChange, replaceChildren: noChange, append: noChange, reset: noChange, focus: noChange, close: noChange, showModal: noChange }; // 화면 입출력 최소 대체
}
function setup(handler) // 실제 화면 함수와 가상 네트워크 연결
{
    const elements = new Map(); // 식별자별 화면 요소
    const calls = []; // 실제 요청 순서 기록
    const timers = new Map(); // 실행하지 않는 가상 예약
    let serial = 0; // 예약 식별자
    const setTimer = (callback, delay) => timers.set(++serial, { callback, delay }) && serial; // 예약 기록용 시계
    const clearTimer = (id) => timers.delete(id); // 예약 해제
    class BrowserFeed extends MessageFeed // 실제 상태 관리의 시계 경계
    {
        constructor(options) // 브라우저 타이머 연결
        {
            super({ ...options, setTimer, clearTimer }); // 실제 조회 동작 유지
        }
    }
    const context = vm.createContext({ // 독립 화면 전역 준비
        MessageFeed: BrowserFeed, AbortController, URLSearchParams, Date, console, // 표준 브라우저 도구
        window: { matchMedia: () => ({ matches: false }), setTimeout: setTimer, clearTimeout: clearTimer }, // 화면 크기와 시계 경계
        document: { getElementById: (id) => // 식별자별 동일 요소 반환
        {
            if (!elements.has(id)) // 최초 요소 조회
            {
                elements.set(id, element()); // 독립 요소 준비
            }
            return elements.get(id); // 기존 화면 요소 반환
        }, createElement: element, querySelector: () => null }, // DOM 생성 경계
        fetch: async (url, options) => // 실제 요청 함수의 네트워크 경계
        {
            const call = { url, headers: options.headers, body: options.body === undefined ? null : JSON.parse(options.body) }; // 전송된 사용자와 본문 관측
            calls.push(call); // 자동 재전송 여부 기록
            const result = await handler(call); // 상황별 API 응답
            return { ok: result.status < 400, status: result.status, headers: { get: () => null }, json: async () => result.status < 400 ? { success: true, data: result.data } : { success: false, error: { code: result.code, message: result.code } } }; // 실제 JSON 응답 형태
        } // 네트워크 경계 끝
    }); // 독립 전역 준비 끝
    const boot = source.indexOf('byId("retry-channels").addEventListener'); // 화면 이벤트 등록 경계
    assert.ok(boot > 0); // 실제 화면 초기화 지점 확인
    vm.runInContext(source.slice(0, boot).replace(/^import .*;.*$/m, ""), context); // 원본 함수와 상태 실행
    vm.runInContext(` // 실제 로그인 화면 자료 준비
        authInitializing = false; // 초기화 완료 상태
        currentUser = { id: "1", username: "user_a" }; // 화면에 로그인한 A 계정
        csrfToken = "a".repeat(64); // A 계정 보호 토큰
        activeChannel = "1"; // 선택한 실제 채널
        channels["1"] = { title: "general", serverName: "server", messages: [], draft: "A private draft", scroll: null, unread: 0, feedback: "", error: false }; // 채널과 초안
        channels["1"].feed = createChannelFeed("1", channels["1"], "1"); // 실제 화면과 조회 상태 연결
        channels["1"].feed.add({ id: "1", channel_id: "1", user_id: "1", username: "user_a", content: "old private message", created_at: "2026-10-21T00:00:00Z" }); // 이전 저장 기록
        messageInput.value = "A private draft"; // 현재 작성 중인 초안
        updateComposer(); // 실제 제출 가능 상태 계산
    `, context); // 로그인 자료 준비 끝
    const evaluate = (code) => vm.runInContext(code, context); // 실제 화면 함수 실행 도구
    const state = () => JSON.parse(evaluate('JSON.stringify({ userId: currentUser?.id ?? null, channelIds: Object.keys(channels), draft: messageInput.value })')); // 계정 자료의 외부 관측
    const send = () => evaluate("sendMessage({ preventDefault: () => undefined })"); // 실제 폼 제출 경로
    return { calls, evaluate, state, send, stop: () => evaluate("pauseMessageFeeds()") }; // 검사 경계 반환
}
test("다른 탭의 계정 변경은 전송 중단과 이전 계정 자료 삭제", async (context) => // 다른 작성자의 초안 저장 방지
{
    const run = setup((call) => call.url === "/api/csrf.php" ? { status: 200, data: { csrf_token: "b".repeat(64) } } : { status: 403, code: "SESSION_CHANGED" }); // B 세션의 사용자 불일치 응답
    context.after(run.stop); // 검사 후 조회 종료
    await run.send(); // A 화면에서 실제 제출
    assert.equal(run.calls[0].headers["X-Expected-User-Id"], "1"); // 제출 의도 계정 전달
    assert.deepEqual(run.state(), { userId: null, channelIds: [], draft: "" }); // 이전 계정 자료 전체 정리
    await run.send(); // 정리된 화면의 추가 제출 시도
    assert.equal(run.calls.filter((call) => call.url === "/api/send_message.php").length, 1); // 자동 및 빈 화면 재전송 차단
}); // 계정 변경 검사 끝
test("CSRF 복구 중 다른 계정 확인 시 기존 초안 재전송 차단", async (context) => // 토큰만 교체하는 계정 혼동 포착
{
    let stored = 0; // B 계정의 실제 저장 횟수
    let sends = 0; // 메시지 제출 횟수
    const run = setup((call) => // 공유 쿠키가 B로 바뀐 API 경계
    {
        if (call.url === "/api/send_message.php") // 메시지 제출 여부
        {
            sends += 1; // 실제 제출 수 집계
            if (sends === 1) // 오래된 A 토큰의 최초 제출
            {
                return { status: 403, code: "CSRF_INVALID" }; // 보호 토큰 불일치
            }
            stored += 1; // 위험한 B 계정 저장 관측
            return { status: 201, data: { message: { id: "2", channel_id: "1", user_id: "2", username: "user_b", content: call.body.content, created_at: "2026-10-21T00:00:00Z" } } }; // 잘못된 작성자의 저장 응답
        }
        if (call.url === "/api/csrf.php") // 현재 공유 세션 토큰 조회
        {
            return { status: 200, data: { csrf_token: "b".repeat(64) } }; // B 계정 보호 토큰
        }
        return { status: 403, code: "SESSION_CHANGED" }; // A 기대 계정과 B 실제 계정 차이
    }); // API 경계 준비 끝
    context.after(run.stop); // 검사 후 조회 종료
    await run.send(); // 최초 보호 토큰 오류와 복구
    await run.send(); // 사용자 수동 재제출 경로
    assert.equal(stored, 0); // B 작성자로 저장된 A 초안 없음
    assert.equal(run.state().userId, null); // 계정 변경 후 로그인 재확인 상태
    assert.equal(run.state().draft, ""); // 다른 계정에 초안 노출 없음
}); // CSRF 계정 변경 검사 끝
test("같은 계정의 CSRF 교체는 초안 보존과 수동 재전송", async (context) => // 계정 보호 수정의 정상 복구 차단 포착
{
    let sends = 0; // 실제 전송 시도 수
    const run = setup((call) => // 같은 사용자의 세션 교체 상황
    {
        if (call.url === "/api/csrf.php") // 새 보호 토큰 조회
        {
            return { status: 200, data: { csrf_token: "c".repeat(64) } }; // 같은 계정의 새 토큰
        }
        if (call.url === "/api/get_current_user.php") // 현재 계정 재확인
        {
            return { status: 200, data: { user: { id: "1", username: "user_a", email: "a@example.com", created_at: "2026-10-21T00:00:00Z" } } }; // 원래 사용자 정보
        }
        sends += 1; // 실제 전송 시도 관측
        return sends === 1 ? { status: 403, code: "CSRF_INVALID" } : { status: 201, data: { message: { id: "2", channel_id: "1", user_id: "1", username: "user_a", content: call.body.content, created_at: "2026-10-21T00:00:00Z" } } }; // 첫 보호 오류와 수동 재제출 성공
    }); // 실제 화면 요청 경계 종료
    context.after(run.stop); // 검사 종료 후 수명 정리
    await run.send(); // 최초 전송과 보호 정보 복구
    assert.equal(sends, 1); // POST 자동 반복 없음
    assert.deepEqual(run.state(), { userId: "1", channelIds: ["1"], draft: "A private draft" }); // 같은 계정 초안과 소속 보존
    await run.send(); // 사용자의 수동 재전송
    assert.equal(sends, 2); // 명시적 추가 전송 한 건
    assert.equal(run.state().draft, ""); // 확인된 저장 이후 초안 비움
    assert.equal(run.evaluate('channels["1"].feed.list().length'), 2); // 기존 기록과 새 기록의 중복 없는 표시
}); // 같은 계정 복구 검사 종료
test("비활성 채널의 전송 권한 상실은 과거 기록과 늦은 응답 차단", async (context) => // 중단된 폴링에 의존하는 권한 처리 포착
{
    let rejectSend; // 지연된 접근 거절 응답
    const run = setup(() => new Promise((resolveRequest) => rejectSend = resolveRequest)); // 전송 중 채널 이동 상황
    context.after(run.stop); // 검사 후 조회 종료
    const pending = run.send(); // A 채널 전송 시작
    run.evaluate('channels["1"].feed.pause(); activeChannel = null; messageInput.value = "";'); // 다른 채널로 이동한 뒤의 비활성 상태
    rejectSend({ status: 403, code: "FORBIDDEN" }); // 원래 채널의 실제 멤버십 상실
    await pending; // 접근 거절 처리 완료
    assert.equal(run.evaluate('channels["1"].feed.blocked'), true); // 폴링 없는 채널도 접근 차단
    assert.equal(run.evaluate('channels["1"].messages.length'), 0); // 화면의 이전 대화 제거
    assert.equal(run.evaluate('channels["1"].feed.list().length'), 0); // 조회 저장소의 이전 대화 제거
}); // 비활성 채널 권한 검사 끝
