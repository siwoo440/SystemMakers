import assert from "node:assert/strict"; // 동작 결과 검사
import test from "node:test"; // 기본 회귀 검사 도구
import { readFileSync } from "node:fs"; // 실제 화면 코드 읽기
import vm from "node:vm"; // 독립 브라우저 실행 영역
import { MessageFeed, createMessageList, messageForDisplay } from "../frontend/message-feed.mjs"; // 실제 메시지 상태 관리
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 서버 소속 상태
import { ATTACHMENT_LIMIT_TEXT, createAttachmentElements, createAttachmentView, uploadAttachment } from "../frontend/attachments-ui.mjs"; // 실제 파일 화면 경계
import { createRealtimeClient, realtimeUrlForLocation } from "../frontend/realtime.mjs"; // 실제 알림 연결과 주소 검사
const source = readFileSync(new URL("../frontend/app.js", import.meta.url), "utf8"); // 검사 대상 원본
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8"); // 실제 화면 구조
const noChange = () => undefined; // 상태 변화 없는 브라우저 경계
function element() // 브라우저 요소의 외부 경계
{
    return { value: "", disabled: false, hidden: false, textContent: "", dataset: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, classList: { toggle: noChange, add: noChange, remove: noChange }, setAttribute: noChange, removeAttribute: noChange, setCustomValidity: noChange, addEventListener: noChange, replaceChildren: noChange, insertBefore: noChange, replaceChild: noChange, removeChild: noChange, append: noChange, reset: noChange, focus: noChange, close: noChange, showModal: noChange }; // 화면 입출력 최소 대체
}
function setup(handler, websocketClass = undefined) // 실제 화면 함수와 가상 네트워크 연결
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
        MessageFeed: BrowserFeed, createMessageList, messageForDisplay, ServerManager, ATTACHMENT_LIMIT_TEXT, createAttachmentElements, createAttachmentView, uploadAttachment, createRealtimeClient, realtimeUrlForLocation, AbortController, URLSearchParams, FormData, File, Date, console, // 실제 상태 모듈과 표준 도구
        window: { matchMedia: () => ({ matches: false }), setTimeout: setTimer, clearTimeout: clearTimer, WebSocket: websocketClass, location: { protocol: "http:", hostname: "127.0.0.6" } }, // 화면 크기와 연결 경계
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
            const call = { url, method: options.method, headers: options.headers, body: options.body === undefined ? null : options.body instanceof FormData ? options.body : JSON.parse(options.body) }; // 전송된 사용자와 본문 관측
            calls.push(call); // 자동 재전송 여부 기록
            const result = await handler(call); // 상황별 API 응답
            return { ok: result.status < 400, status: result.status, headers: { get: () => null }, json: async () => result.status < 400 ? { success: true, data: result.data } : { success: false, error: { code: result.code, message: result.code } } }; // 실제 JSON 응답 형태
        }
    });
    const boot = source.indexOf('byId("retry-channels").addEventListener'); // 화면 이벤트 등록 경계
    assert.ok(boot > 0); // 실제 화면 초기화 지점 확인
    vm.runInContext(source.slice(0, boot).replace(/^import .*;.*$/gm, ""), context); // 원본 함수와 상태 실행
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
    return { calls, timers, evaluate, state, send, stop: () => evaluate("pauseMessageFeeds()") }; // 검사 경계 반환
}
test("초안 입력 열 번 동안 서버 목록의 렌더 횟수 0회", (context) => // 입력 중 관리 화면 갱신 회귀
{
    const harness = setup(() => ({ status: 200, data: {} })); // 로그인한 채널 화면
    context.after(harness.stop); // 메시지 조회 정리
    harness.evaluate("let renders = 0; serverUI = { render: () => renders++ };"); // 서버 목록 갱신 횟수
    harness.evaluate("let typeDraft; messageInput.addEventListener = (name, handler) => typeDraft = handler;"); // 입력 동작 연결
    const start = source.indexOf('messageInput.addEventListener("input"'); // 실제 입력 핸들러 시작
    const end = source.indexOf('byId("message-form").addEventListener("submit"'); // 다음 이벤트의 시작
    harness.evaluate(source.slice(start, end)); // 실제 입력 이벤트 등록
    for (let index = 0; index < 10; index++) // 연속 입력 열 번
    {
        harness.evaluate('messageInput.value += "가"; typeDraft();'); // 한 글자 입력 반영
    }
    assert.equal(harness.evaluate("renders"), 0); // 서버 목록 갱신 제외
    assert.equal(harness.evaluate('channels["1"].draft'), harness.state().draft); // 채널별 초안 유지
    assert.equal(harness.evaluate('byId("send-button").disabled'), false); // 정상 초안의 전송 허용
    harness.evaluate('messageInput.value = " "; typeDraft();'); // 공백 초안 입력
    assert.equal(harness.evaluate('byId("send-button").disabled'), true); // 공백 전송 차단
});
test("텍스트 50개 뒤 새 메시지 한 개는 요소 8개만 생성", (context) => // 전체 말풍선 재생성 회귀 검사
{
    const harness = setup(() => ({ status: 200, data: { attachments: [] } })); // 채널 화면 준비
    context.after(harness.stop); // 검사 후 조회 정리
    const addMessage = (id) => harness.evaluate('channels["1"].feed.add({ ...channels["1"].feed.items.get("1"), id: "' + id + '" })'); // 실제 저장 응답 반영
    for (let id = 2; id <= 50; id++) // 기존 기록 50개 준비
    {
        addMessage(id); // 표시된 기록 추가
    }
    harness.evaluate('var generated = 0; const originalElement = document.createElement; document.createElement = (...args) => (++generated, originalElement(...args));'); // 생성한 화면 요소 집계
    addMessage(51); // 신규 기록 한 개 도착
    assert.equal(harness.evaluate("generated"), 8); // 새 말풍선 요소만 생성
    addMessage(51); // 같은 저장 기록 재수신
    assert.equal(harness.evaluate("generated"), 8); // 중복 수신 시 요소 재사용
});
test("파일 없는 채널 기록은 HTTP 요청 한 번으로 표시", async (context) => // 첨부 목록의 중복 조회 방지
{
    const harness = setup(() => ({ status: 200, data: { messages: [{ id: "2", channel_id: "1", user_id: "1", username: "user_a", content: "새 기록", created_at: "2026-10-21T00:00:00Z", attachment: null }], pagination: { mode: "initial", has_more: false, next_before_id: "2", next_after_id: "2" } } })); // 첨부 여부가 포함된 기록
    context.after(harness.stop); // 검사 후 조회 종료
    await harness.evaluate('channels["1"].feed.activate()'); // 실제 화면 조회
    assert.equal(harness.calls.length, 1); // 메시지 요청만 사용
    assert.equal(new URL(harness.calls[0].url, "http://localhost").searchParams.get("include_attachments"), "1"); // 파일 정보 동시 요청
    assert.equal(harness.evaluate('channels["1"].messages.at(-1).text'), "새 기록"); // 텍스트 표시
});
test("새 기록이 없는 채널 조회는 대화 목록을 재구성하지 않음", async (context) => // 유휴 채널의 화면 작업 수 검사
{
    const harness = setup(() => ({ status: 200, data: { messages: [], pagination: { mode: "after", has_more: false, next_before_id: null, next_after_id: "1" } } })); // 빈 신규 페이지
    context.after(harness.stop); // 조회 예약 정리
    harness.evaluate('channels["1"].feed.loaded = true; channels["1"].feed.after = "1";'); // 기존 기록 조회 완료
    const displayed = harness.evaluate('channels["1"].messages'); // 기존 표시 목록
    await harness.evaluate('channels["1"].feed.activate()'); // 실제 갱신 주기 실행
    assert.equal(harness.evaluate('channels["1"].messages'), displayed); // 기록 변환과 교체 생략
});
test("서버 선택은 개인 대화를 닫은 뒤 서버 채널을 불러옴", async (context) => // 개인 대화에서 서버 복귀
{
    const harness = setup(() => ({ status: 200, data: {} })); // 화면 실행 환경
    context.after(harness.stop); // 예약 정리
    harness.evaluate('var transitions = []; directUI = { showNavigation: (open) => transitions.push(open ? "direct" : "channels"), close: () => transitions.push("close") }; loadChannels = async () => transitions.push("load");'); // 탐색 목록과 대화 전환 관측
    await harness.evaluate("selectServerConversation()"); // 실제 서버 전환 함수
    assert.equal(harness.evaluate('transitions.join(",")'), "channels,close,load"); // 채널 목록 복원과 개인 대화 종료
});
test("계정 아이콘은 로그인 상태에 맞는 설명과 그림을 표시", (context) => // 아이콘의 접근성과 인증 상태
{
    const harness = setup(() => ({ status: 200, data: {} })); // 인증 화면 경계
    context.after(harness.stop); // 조회 수명 정리
    harness.evaluate('byId("open-auth").setAttribute = (name, value) => byId("open-auth")[name] = value; renderAuthState();'); // 로그인 상태 반영
    assert.equal(harness.evaluate('byId("open-auth")["aria-label"]'), "로그아웃"); // 로그아웃 설명
    assert.equal(harness.evaluate('byId("auth-logout-icon").hidden'), false); // 로그아웃 아이콘
    harness.evaluate('currentUser = null; renderAuthState();'); // 게스트 상태 반영
    assert.equal(harness.evaluate('byId("open-auth")["aria-label"]'), "로그인"); // 로그인 설명
    assert.equal(harness.evaluate('byId("auth-login-icon").hidden'), false); // 로그인 아이콘
});
test("채널과 친구 목록은 각각 열리고 닫을 때 두 대화의 입력 잠금이 풀림", (context) => // 반응형 목록의 독립 상태
{
    const harness = setup(noChange); // 독립 화면 준비
    context.after(harness.stop); // 메시지 조회 정리
    harness.evaluate(` // 두 목록 버튼의 접근성 상태 관측
        const toggles = ["navigation-panel", "friend-panel"].map(id => // 서버와 친구 목록 준비
        {
            byId(id).id = id; // 실제 목록 식별자 지정
            return { getAttribute: () => id, setAttribute: (name, value) => byId(id).expanded = value }; // 각 목록 버튼의 펼침 상태
        });
        document.querySelectorAll = () => toggles; // 실제 함수의 버튼 탐색 연결
    `); // 목록 경계 준비 끝
    harness.evaluate('setSidebar(byId("navigation-panel")); setSidebar(byId("friend-panel"));'); // 서버 목록에서 친구 목록으로 전환
    assert.equal(harness.evaluate('byId("navigation-panel").expanded'), "false"); // 이전 목록 닫힘
    assert.equal(harness.evaluate('byId("navigation-panel").inert'), true); // 친구 목록 뒤 서버 선택 차단
    assert.equal(harness.evaluate('byId("friend-panel").expanded'), "true"); // 선택한 목록 열림
    assert.equal(harness.evaluate('byId("direct-conversation").inert'), true); // 개인 대화의 배경 입력 차단
    harness.evaluate("setSidebar(null)"); // 목록 닫기
    assert.equal(harness.evaluate('byId("sidebar-backdrop").hidden'), true); // 닫기 배경 해제
    assert.equal(harness.evaluate('byId("navigation-panel").inert'), false); // 서버 탐색 조작 복원
    assert.equal(harness.evaluate('byId("channel-conversation").inert'), false); // 채널 대화 입력 복원
    assert.equal(harness.evaluate('byId("direct-conversation").inert'), false); // 개인 대화 입력 복원
});
test("채널과 개인 대화의 모바일 서버·친구 버튼이 서로 다른 패널 제어", () => // 첨부 시안의 독립된 목록 버튼 확인
{
    for (const conversation of ["channel-conversation", "direct-conversation"]) // 두 종류의 대화 화면 검사
    {
        const header = page.match(new RegExp(`id="${conversation}"[^>]*>[^]*?<header[^>]*>([^]*?)</header>`))?.[1]; // 현재 대화의 상단 영역
        assert.match(header, /<button[^>]+aria-controls="navigation-panel"[^>]+aria-label="서버 목록"[^>]*><svg/); // 왼쪽 서버 목록 아이콘
        assert.match(header, /<button[^>]+aria-controls="friend-panel"[^>]+aria-label="친구 목록"[^>]*><svg/); // 오른쪽 친구 목록 아이콘
    }
    assert.match(page, /id="navigation-panel"[^>]*>[^]*?class="server-rail"[^]*?id="channel-sidebar"/); // 왼쪽 패널의 서버 선택과 채널 목록
});
test("로그인과 회원가입을 전환하면 창의 스타일과 사용자명 입력이 함께 변경", (context) => // 인증 모드와 화면 일치
{
    const harness = setup(() => ({ status: 200, data: {} })); // 인증 화면 준비
    context.after(harness.stop); // 조회 예약 정리
    for (const mode of ["register", "login"]) // 두 방향의 인증 화면 전환
    {
        harness.evaluate(`switchAuth("${mode}")`); // 실제 인증 창 전환
        assert.equal(harness.evaluate("authDialog.dataset.mode"), mode); // 화면별 스타일 선택 확인
        assert.equal(harness.evaluate('byId("username-field").hidden'), mode === "login"); // 가입 전용 입력 표시 확인
    }
});
test("비로그인 바로가기는 지정한 인증 창을 열고 가입에서 로그인으로 주소를 갱신", (context) => // 인증 화면 바로가기 확인
{
    const harness = setup(() => ({ status: 200, data: {} })); // 세션과 화면 준비
    context.after(harness.stop); // 조회 예약 정리
    harness.evaluate('window.location.hash = "#signup-window"; authDialog.showModal = () => authDialog.open = true;'); // 회원가입 주소로 접속
    harness.evaluate("syncAuthLink()"); // 로그인 상태에서 바로가기 확인
    assert.ok(!harness.evaluate("authDialog.open")); // 로그인한 사용자의 창 열기 방지
    harness.evaluate("currentUser = null; syncAuthLink();"); // 게스트의 같은 주소 접속
    assert.equal(harness.evaluate("authDialog.dataset.mode"), "register"); // 회원가입 화면 표시
    harness.evaluate('window.history = { replaceState: (state, title, hash) => window.location.hash = hash }; switchAuth("login");'); // 같은 창에서 로그인으로 전환
    assert.equal(harness.evaluate("window.location.hash"), "#login-window"); // 새로고침 주소 일치
    harness.evaluate('authDialog.close = () => authDialog.open = false; window.location.hash = ""; syncAuthLink();'); // 인증 주소에서 뒤로 가기
    assert.equal(harness.evaluate("authDialog.open"), false); // 돌아온 메인 화면 확인
    harness.evaluate('window.location.hash = "#invite=" + "a".repeat(64); openAuth();'); // 서버 초대에서 로그인 진입
    assert.equal(harness.evaluate("window.location.hash"), "#invite=" + "a".repeat(64)); // 로그인 후 사용할 초대 코드 보존
});
test("선택한 채널이 없으면 별도 선택 안내를 표시하지 않음", (context) => // 빈 채널 안내 제거
{
    const harness = setup(() => ({ status: 200, data: {} })); // 로그인 화면 준비
    context.after(harness.stop); // 조회 수명 정리
    harness.evaluate('activeChannel = null; updateHistoryControls();'); // 채널 없는 상태
    assert.equal(harness.evaluate('byId("history-status").textContent'), ""); // 선택 안내 제거
});
test("채널 구독 승인과 연결 종료가 실제 조회 예약에 반영", async (context) => // 화면과 구독 상태 연결 검사
{
    let socket; // 생성된 연결 관찰
    class TestSocket // 브라우저 소켓 경계
    {
        constructor() // 소켓 생성 경계
        {
            socket = this; // 현재 연결 보관
        }
        send() // 구독 요청 전달 경계
        {
        }
        close() // 연결 종료 경계
        {
        }
    }
    const harness = setup(() => ({ status: 200, data: { messages: [], pagination: { mode: "initial", has_more: false, next_before_id: null, next_after_id: "0" } } }), TestSocket); // 정상 빈 조회 응답
    context.after(harness.stop); // 검사 후 연결 정리
    await harness.evaluate('channels["1"].feed.activate()'); // 실제 최초 조회
    harness.evaluate('startRealtime("1")'); // 채널 알림 연결
    socket.onopen(); // 구독 요청 전송
    socket.onmessage({ data: '{"type":"subscribed"}' }); // 서버 구독 승인
    assert.equal([...harness.timers.values()].some((timer) => timer.delay === 15000), true); // 승인된 안전망 간격
    socket.onclose(); // 실시간 연결 종료
    assert.equal([...harness.timers.values()].some((timer) => timer.delay === 2000), true); // 즉시 기존 간격 복구
});
test("비밀번호 입력은 문자 길이만 검사하고 긴 한글도 허용", (context) => // 브라우저의 바이트 제한 제거 확인
{
    const harness = setup(() => ({ status: 200, data: {} })); // 인증 화면 준비
    context.after(harness.stop); // 조회 수명 정리
    harness.evaluate('passwordInput.setCustomValidity = (value) => passwordInput.validationMessage = value; passwordInput.value = "가".repeat(25); validatePassword();'); // 72바이트를 넘는 한글 입력
    assert.equal(harness.evaluate('passwordInput.validationMessage'), ""); // 유효한 한글 비밀번호
    harness.evaluate('passwordInput.value = "12345678"; validatePassword();'); // 8자 숫자 비밀번호
    assert.equal(harness.evaluate('passwordInput.validationMessage'), ""); // 조합 제한 없는 최소 길이
    harness.evaluate('passwordInput.value = "1234567"; validatePassword();'); // 7자 미달 입력
    assert.notEqual(harness.evaluate('passwordInput.validationMessage'), ""); // 최소 길이 오류
});
test("채널에서 선택한 파일을 전송 전에 취소", (context) => // 파일 선택 취소 동작
{
    const harness = setup(() => ({ status: 200, data: {} })); // 로그인된 채널 준비
    context.after(harness.stop); // 예약 정리
    harness.evaluate('var chosenFiles = [new File(["data"], "예시.txt")]; Object.defineProperty(byId("channel-file"), "files", { get: () => chosenFiles }); Object.defineProperty(byId("channel-file"), "value", { set: (value) => { if (value === "") chosenFiles = []; } }); updateComposer();'); // 실제 선택 상태 모의
    assert.equal(harness.evaluate('byId("channel-file-clear").disabled'), false); // 취소 가능 상태
    harness.evaluate('clearChannelFile()'); // 사용자 취소 동작
    assert.equal(harness.evaluate('byId("channel-file").files.length'), 0); // 선택 파일 제거
    assert.equal(harness.evaluate('byId("channel-upload").disabled'), true); // 파일 전송 차단
    assert.equal(harness.evaluate('byId("channel-file-status").textContent'), ATTACHMENT_LIMIT_TEXT); // 안내 복구
    assert.equal(harness.calls.length, 0); // 서버 요청 없음
});
test("파일 본문은 보호 헤더를 유지하며 multipart로 직접 전송", async (context) => // 파일 본문의 JSON 변환과 경계 누락 차단
{
    const harness = setup(() => ({ status: 200, data: { saved: true } })); // 성공 응답 경계
    context.after(harness.stop); // 조회 수명 종료
    await harness.evaluate('requestEndpoint("./backend/api/profile_image.php", new FormData())'); // 실제 multipart 요청
    assert.ok(harness.calls[0].body instanceof FormData); // 브라우저 본문 유지
    assert.equal(harness.calls[0].headers["Content-Type"], undefined); // 브라우저 multipart 경계 생성
    assert.equal(harness.calls[0].headers["X-Expected-User-Id"], "1"); // 요청 계정 보호
    assert.equal(harness.calls[0].headers["X-CSRF-Token"], "a".repeat(64)); // 기존 보호 토큰 유지
});
test("채팅 첨부에만 긴 전송 시간을 허용하고 프록시 크기 오류를 표시", async (context) => // 느린 업로드와 일반 API 시간 경계
{
    const harness = setup(() => ({ status: 413 })); // 프록시 본문 크기 초과 응답
    context.after(harness.stop); // 타이머와 조회 정리
    const attachmentRequest = harness.evaluate('requestEndpoint("./backend/api/upload_attachment.php", new FormData())'); // 채팅 파일의 실제 전송 경로
    assert.ok([...harness.timers.values()].some(({ delay }) => delay === 900000)); // 200 MB 전송을 위한 시간 확보
    await assert.rejects(attachmentRequest, { status: 413, message: "서버가 파일 크기를 허용하지 않습니다. 첨부 한도와 서버 설정을 확인하세요." }); // 원인에 맞는 실패 안내
    const profileRequest = harness.evaluate('requestEndpoint("./backend/api/profile_picture.php", new FormData())'); // 일반 multipart 요청
    assert.ok([...harness.timers.values()].some(({ delay }) => delay === 15000)); // 일반 요청의 시간 경계 유지
    await assert.rejects(profileRequest, { status: 413 }); // 공통 오류 계약 보존
});
test("채널 파일 전송은 선택한 채널의 저장 메시지에 첨부 표시", async (context) => // 채널과 파일 연결 누락 차단
{
    const harness = setup((call) => // 실제 업로드 응답
    {
        if (call.url.includes("upload_attachment")) // 파일 업로드 요청
        {
            return { status: 201, data: { message: { id: "2", channel_id: "1", user_id: "1", username: "user_a", content: "파일: 문서.txt", created_at: "2026-10-21T00:00:00Z" }, attachment: { id: "9", message_id: "2", original_name: "문서.txt", file_size: 4 } } }; // 확인된 메시지와 파일
        }
        return { status: 200, data: { attachments: [] } }; // 첨부 없는 기록
    });
    context.after(harness.stop); // 조회 수명 종료
    harness.evaluate('byId("channel-file").files = [new File(["data"], "문서.txt")]; updateComposer();'); // 실제 파일 선택
    await harness.evaluate("sendChannelFile()"); // 사용자 파일 전송
    const upload = harness.calls.find((call) => call.url.includes("upload_attachment")); // 실제 업로드 요청
    assert.equal(upload.body.get("kind"), "channel"); // 채널 대화 유형
    assert.equal(upload.body.get("target_id"), "1"); // 확인한 채널 대상
    assert.equal(harness.evaluate('channels["1"].messages.find((message) => message.id === "2").attachment.original_name'), "문서.txt"); // 저장된 메시지의 파일 정보
});
test("다른 탭의 계정 변경은 전송 중단과 이전 계정 자료 삭제", async (context) => // 다른 작성자의 초안 저장 방지
{
    const testHarness = setup((call) => call.url === "./backend/api/csrf.php" ? { status: 200, data: { csrf_token: "b".repeat(64) } } : { status: 403, code: "SESSION_CHANGED" }); // B 세션의 사용자 불일치 응답
    context.after(testHarness.stop); // 검사 후 조회 종료
    await testHarness.send(); // A 화면에서 실제 제출
    assert.equal(testHarness.calls[0].headers["X-Expected-User-Id"], "1"); // 제출 의도 계정 전달
    assert.deepEqual(testHarness.state(), { userId: null, channelIds: [], draft: "" }); // 이전 계정 자료 전체 정리
    await testHarness.send(); // 정리된 화면의 추가 제출 시도
    assert.equal(testHarness.calls.filter((call) => call.url === "./backend/api/send_message.php").length, 1); // 자동 및 빈 화면 재전송 차단
});
test("CSRF 복구 중 다른 계정 확인 시 기존 초안 재전송 차단", async (context) => // 토큰만 교체하는 계정 혼동 포착
{
    let stored = 0; // B 계정의 실제 저장 횟수
    let sends = 0; // 메시지 제출 횟수
    const testHarness = setup((call) => // 공유 쿠키가 B로 바뀐 API 경계
    {
        if (call.url === "./backend/api/send_message.php") // 메시지 제출 여부
        {
            sends += 1; // 실제 제출 수 집계
            if (sends === 1) // 오래된 A 토큰의 최초 제출
            {
                return { status: 403, code: "CSRF_INVALID" }; // 보호 토큰 불일치
            }
            stored += 1; // 위험한 B 계정 저장 관측
            return { status: 201, data: { message: { id: "2", channel_id: "1", user_id: "2", username: "user_b", content: call.body.content, created_at: "2026-10-21T00:00:00Z" } } }; // 잘못된 작성자의 저장 응답
        }
        if (call.url === "./backend/api/csrf.php") // 현재 공유 세션 토큰 조회
        {
            return { status: 200, data: { csrf_token: "b".repeat(64) } }; // B 계정 보호 토큰
        }
        return { status: 403, code: "SESSION_CHANGED" }; // A 기대 계정과 B 실제 계정 차이
    });
    context.after(testHarness.stop); // 검사 후 조회 종료
    await testHarness.send(); // 최초 보호 토큰 오류와 복구
    await testHarness.send(); // 사용자 수동 재제출 경로
    assert.equal(stored, 0); // B 작성자로 저장된 A 초안 없음
    assert.equal(testHarness.state().userId, null); // 계정 변경 후 로그인 재확인 상태
    assert.equal(testHarness.state().draft, ""); // 다른 계정에 초안 노출 없음
});
test("같은 계정의 CSRF 교체는 초안 보존과 수동 재전송", async (context) => // 계정 보호 수정의 정상 복구 차단 포착
{
    let sends = 0; // 실제 전송 시도 수
    const testHarness = setup((call) => // 같은 사용자의 세션 교체 상황
    {
        if (call.url === "./backend/api/csrf.php") // 새 보호 토큰 조회
        {
            return { status: 200, data: { csrf_token: "c".repeat(64) } }; // 같은 계정의 새 토큰
        }
        if (call.url === "./backend/api/get_current_user.php") // 현재 계정 재확인
        {
            return { status: 200, data: { user: { id: "1", username: "user_a", email: "a@example.com", created_at: "2026-10-21T00:00:00Z" } } }; // 원래 사용자 정보
        }
        sends += 1; // 실제 전송 시도 관측
        return sends === 1 ? { status: 403, code: "CSRF_INVALID" } : { status: 201, data: { message: { id: "2", channel_id: "1", user_id: "1", username: "user_a", content: call.body.content, created_at: "2026-10-21T00:00:00Z" } } }; // 첫 보호 오류와 수동 재제출 성공
    });
    context.after(testHarness.stop); // 검사 종료 후 수명 정리
    await testHarness.send(); // 최초 전송과 보호 정보 복구
    assert.equal(sends, 1); // POST 자동 반복 없음
    assert.deepEqual(testHarness.state(), { userId: "1", channelIds: ["1"], draft: "A private draft" }); // 같은 계정 초안과 소속 보존
    await testHarness.send(); // 사용자의 수동 재전송
    assert.equal(sends, 2); // 명시적 추가 전송 한 건
    assert.equal(testHarness.state().draft, ""); // 확인된 저장 이후 초안 비움
    assert.equal(testHarness.evaluate('channels["1"].feed.list().length'), 2); // 기존 기록과 새 기록의 중복 없는 표시
});
test("이전 채널 삭제 응답 뒤에도 현재 채널에서 초안 전송 가능", async (context) => // 채널 이동 중 늦은 오류 격리
{
    let finishSend; // 이전 채널의 응답 전달
    const harness = setup((call) => // 전송과 조회 응답 구분
    {
        if (call.url.includes("send_message")) // 이전 채널 전송
        {
            return new Promise((resolve) => finishSend = resolve); // 삭제 판정까지 응답 보류
        }
        return { status: 200, data: { messages: [], pagination: { mode: "initial", next_before_id: null, next_after_id: "0", has_more: false } } }; // 현재 채널의 정상 조회
    });
    context.after(harness.stop); // 조회 예약 정리
    harness.evaluate('channels["1"].serverId = "11";'); // 같은 서버의 이전 채널
    harness.evaluate('channels["2"] = { serverId: "11", title: "공지", messages: [], draft: "새 초안", unread: 0 };'); // 정상 채널과 독립 초안
    harness.evaluate('channels["2"].feed = createChannelFeed("2", channels["2"], "1");'); // 정상 채널의 조회 연결
    const pending = harness.send(); // 이전 채널 전송 시작
    harness.evaluate('selectChannel("2")'); // 응답 전 정상 채널 선택
    finishSend({ status: 404, code: "CHANNEL_NOT_FOUND" }); // 이전 채널 삭제 확정
    await pending; // 전송 잠금 해제
    assert.equal(harness.evaluate('byId("send-button").disabled'), false); // 현재 채널의 전송 가능 상태
    assert.equal(harness.evaluate('byId("channel-title").textContent'), "공지"); // 현재 대화 제목 유지
    assert.deepEqual(harness.state(), { userId: "1", channelIds: ["2"], draft: "새 초안" }); // 삭제된 채널만 정리
});
test("비활성 채널의 전송 권한 상실은 과거 기록과 늦은 응답 차단", async (context) => // 중단된 폴링에 의존하는 권한 처리 포착
{
    let rejectSend; // 지연된 접근 거절 응답
    const testHarness = setup(() => new Promise((resolveRequest) => rejectSend = resolveRequest)); // 전송 중 채널 이동 상황
    context.after(testHarness.stop); // 검사 후 조회 종료
    const pending = testHarness.send(); // A 채널 전송 시작
    testHarness.evaluate('channels["1"].feed.pause(); activeChannel = null; messageInput.value = "";'); // 다른 채널로 이동한 뒤의 비활성 상태
    rejectSend({ status: 403, code: "FORBIDDEN" }); // 원래 채널의 실제 멤버십 상실
    await pending; // 접근 거절 처리 완료
    assert.equal(testHarness.evaluate('channels["1"].feed.blocked'), true); // 폴링 없는 채널도 접근 차단
    assert.equal(testHarness.evaluate('channels["1"].messages.length'), 0); // 화면의 이전 대화 제거
    assert.equal(testHarness.evaluate('channels["1"].feed.list().length'), 0); // 조회 저장소의 이전 대화 제거
});
test("마지막 채널 제거 후 초안·기록·선택 ID와 예약 정리", async (context) => // 실제 화면의 빈 서버 전환
{
    const testHarness = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id: "1", name: "서버", owner_id: "1", role: "owner", created_at: "2026-10-21T00:00:00Z" }] } } : { status: 200, data: { channels: [] } }); // 서버는 유지하고 채널만 삭제된 응답
    context.after(testHarness.stop); // 검사 자원 정리
    testHarness.evaluate('serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; globalThis.deletedFeed=channels["1"].feed;'); // 기존 선택과 기록
    await testHarness.evaluate("loadChannels()"); // 실제 소속 재조회 경로
    assert.deepEqual(testHarness.state(), { userId: "1", channelIds: [], draft: "" }); // 이전 자료 표시 제거
    assert.equal(testHarness.evaluate("serverManager.selected"), "1"); // 빈 서버 선택 유지
    assert.equal(testHarness.evaluate("serverManager.channel"), null); // 삭제된 영구 선택 제거
    assert.equal(testHarness.evaluate("deletedFeed.active"), false); // 이전 폴링 종료
});
test("삭제 확정 뒤 목록 오류에도 기록·초안·선택 폐기", async (context) => // 후속 통신 실패의 삭제 자료 노출 방지
{
    const testHarness = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id: "1", name: "서버", owner_id: "1", role: "owner", created_at: "2026-10-21T00:00:00Z" }] } } : { status: 500, code: "INTERNAL_ERROR" }); // 삭제 후 조회 실패
    context.after(testHarness.stop); // 검사 자원 정리
    testHarness.evaluate('serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; globalThis.deletedFeed=channels["1"].feed; discardDeletedChannel("1");'); // 확인한 삭제 응답 경계
    await testHarness.evaluate("loadChannels()"); // 실패하는 후속 조회
    assert.deepEqual(testHarness.state(), { userId: "1", channelIds: [], draft: "" }); // 삭제 자료 재노출 없음
    assert.equal(testHarness.evaluate("serverManager.selected"), "1"); // 서버 보존
    assert.equal(testHarness.evaluate("serverManager.channel"), null); // 저장 선택 제거
    assert.equal(testHarness.evaluate("deletedFeed.list().length"), 0); // 기록 저장소 제거
    assert.equal(testHarness.evaluate("deletedFeed.active"), false); // 조회 예약 종료
});
test("프로필 PATCH는 기대 계정·CSRF·실제 변경 메서드 전달", async (context) => // 공통 요청 확장 회귀
{
    const testHarness = setup(() => ({ status: 200, data: { user: { id: "1", username: "new_name" } } })); // 실제 성공 응답 경계
    context.after(testHarness.stop); // 검사 조회 정리
    await testHarness.evaluate('requestEndpoint("./backend/api/profile.php", { username: "new_name" }, null, "PATCH")'); // 실제 화면 요청
    assert.equal(testHarness.calls[0].method, "PATCH"); // POST로 잘못 변경되는 문제 포착
    assert.equal(testHarness.calls[0].headers["X-Expected-User-Id"], "1"); // 본인 의도 계정
    assert.equal(testHarness.calls[0].headers["X-CSRF-Token"], "a".repeat(64)); // 기존 보호 토큰
});
test("프로필 반영은 본인 메시지 이름만 갱신·초안·기록·커서 유지", (context) => // 기존 대화 보존
{
    const testHarness = setup(() => ({ status: 200, data: {} })); // 요청 없는 표시 변경
    context.after(testHarness.stop); // 예약 정리
    testHarness.evaluate('channels["1"].feed.add({ id:"2",channel_id:"1",user_id:"2",username:"other_user",content:"other message",created_at:"2026-10-21T00:00:00Z" }); channels["1"].feed.after="2"; channels["1"].feed.oldest="1"; applyProfile({id:"1",username:"new_name",email:"a@example.test",created_at:"2026-10-21T00:00:00Z"});'); // 실제 프로필 적용
    assert.deepEqual(testHarness.state(), { userId: "1", channelIds: ["1"], draft: "A private draft" }); // 계정·목록·초안 보존
    assert.equal(testHarness.evaluate('channels["1"].messages[0].name'), "new_name"); // 본인 표시 이름
    assert.equal(testHarness.evaluate('channels["1"].messages[1].name'), "other_user"); // 타인 이름 유지
    assert.equal(testHarness.evaluate('channels["1"].messages[0].isOwn'), true); // 본인 대화 표시 구분
    assert.equal(testHarness.evaluate('channels["1"].messages[1].isOwn'), false); // 상대방 대화 표시 구분
    assert.equal(testHarness.evaluate('channels["1"].feed.list()[0].username'), "new_name"); // 캐시 이름 갱신
    assert.equal(testHarness.evaluate('channels["1"].feed.after'), "2"); // 신규 커서 유지
    assert.equal(testHarness.evaluate('channels["1"].feed.oldest'), "1"); // 과거 커서 유지
    testHarness.evaluate('applyProfile({id:"2",username:"wrong_user"})'); // 늦은 다른 계정 응답
    assert.equal(testHarness.evaluate('currentUser.username'), "new_name"); // 계정 교체 차단
});
test("프로필 CSRF 복구의 늦은 실패는 새 로그인 계정 유지", async (context) => // 중첩 인증 복구 수명 회귀
{
    let release; // 지연된 계정 확인
    let entered; // 복구 요청 시작 신호
    const waiting = new Promise((resolve) => entered = resolve); // 실제 대기 경계
    const testHarness = setup((call) => // 실제 토큰 복구의 네트워크 경계
    {
        if (call.url === "./backend/api/csrf.php") // 새 보호 토큰
        {
            return { status: 200, data: { csrf_token: "b".repeat(64) } }; // 같은 계정 복구 시작
        }
        entered(); // 기대 계정 확인 요청 진입
        return new Promise((resolve) => release = resolve); // 늦은 인증 실패
    });
    context.after(testHarness.stop); // 실제 예약 정리
    const pending = testHarness.evaluate('serverFailure(requestError("보호 오류",403,"CSRF_INVALID"))'); // 프로필의 공통 인증 복구
    await waiting; // 현재 계정 확인 대기 상태
    testHarness.evaluate('authGeneration++; clearSessionView(); currentUser={id:"2",username:"user_b"}; csrfToken="c".repeat(64);'); // 이전 계정 종료 뒤 새 로그인
    release({ status: 401, code: "UNAUTHORIZED" }); // 이전 복구의 늦은 실패
    await pending; // 중첩 실패 처리 종료
    assert.equal(testHarness.state().userId, "2"); // 새 계정 종료 차단
    assert.equal(testHarness.evaluate("csrfToken"), "c".repeat(64)); // 새 보호 토큰 보존
});
test("다른 탭 탈퇴·채널 삭제 확인은 초안까지 폐기", (context) => // 같은 계정 재참여의 이전 초안 복원 차단
{
    const testHarness = setup(() => ({ status: 200, data: {} })); // 네트워크 없는 접근 종료 경계
    context.after(testHarness.stop); // 조회 예약 정리
    testHarness.evaluate('channels["1"].feed.block(requestError("접근 종료",403,"FORBIDDEN"))'); // 다른 탭 탈퇴 뒤 실제 조회 거절
    assert.equal(testHarness.state().draft, ""); // 현재 입력의 이전 소속 자료 제거
    assert.equal(testHarness.evaluate('channels["1"].draft'), ""); // 채널 초안 저장소도 제거
    assert.equal(testHarness.evaluate('channels["1"].feed.list().length'), 0); // 과거 대화 제거
});
test("접근 차단 채널 재조회 성공도 이전 초안 복원 없음", async (context) => // 재참여와 목록 갱신 경계
{
    const testHarness = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id:"1",name:"서버",owner_id:"2",role:"member",created_at:"2026-10-22T00:00:00Z" }] } } : call.url.includes("get_channels") ? { status:200,data:{ channels:[{id:"1",server_id:"1",server_name:"서버",name:"일반"}] } } : {status:200,data:{messages:[],pagination:{next_before_id:null,next_after_id:"0",has_more:false}}}); // 같은 서버 재참여 뒤 실제 목록
    context.after(testHarness.stop); // 수명 정리
    testHarness.evaluate('serverManager.identity="1"; serverManager.selected="1"; channels["1"].feed.block(requestError("채널 접근 종료",404,"CHANNEL_NOT_FOUND"));'); // 차단 상태
    await testHarness.evaluate("loadChannels()"); // 실제 소속 재확인
    assert.equal(testHarness.state().draft, ""); // 차단된 초안 복구 금지
    assert.equal(testHarness.evaluate('channels["1"].draft'), ""); // 새 채널 상태도 빈 초안
});
test("서버 탈퇴·삭제 확정은 목록 실패 전에 모든 소속 채널 폐기", async (context) => // 조회 실패에도 접근 종료 자료 비노출
{
    const testHarness = setup(() => ({status:500,code:"INTERNAL_ERROR"})); // 후속 서버 목록 실패
    context.after(testHarness.stop); // 조회 예약 정리
    testHarness.evaluate('channels["1"].serverId="1"; serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; serverManager.servers=[{id:"1",name:"종료",owner_id:"1",role:"owner"}]; globalThis.endedFeed=channels["1"].feed; discardDepartedServer("1");'); // 실제 성공 응답 경계
    await testHarness.evaluate("loadChannels()"); // 후속 통신 실패
    assert.deepEqual(testHarness.state(),{userId:"1",channelIds:[],draft:""}); // 이전 소속 자료 전체 폐기
    assert.equal(testHarness.evaluate("serverManager.selected"),null); // 종료된 서버 선택 제거
    assert.equal(testHarness.evaluate("serverManager.channel"),null); // 종료된 채널 선택 제거
    assert.equal(testHarness.evaluate("endedFeed.list().length"),0); // 참조가 남아도 기록 제거
    assert.equal(testHarness.evaluate("endedFeed.active"),false); // 조회 수명 종료
});
test("전송 CSRF 복구의 늦은 실패는 새 계정·토큰 보존", async (context) => // 관리 복구 밖의 전송 인증 경계
{
    let release; // 오래된 계정 확인 응답
    let entered; // 요청 진입 신호
    const waiting=new Promise((resolve)=>entered=resolve); // 실제 비동기 복구 대기
    const testHarness=setup((call)=> // 실제 전송·토큰·계정 조회 연결
    {
        if(call.url==="./backend/api/send_message.php") // 처음 제출
        {
            return {status:403,code:"CSRF_INVALID"}; // 토큰 복구 시작
        }
        if(call.url==="./backend/api/csrf.php") // 새 토큰
        {
            return {status:200,data:{csrf_token:"b".repeat(64)}}; // 현재 계정 확인 전 대기
        }
        entered(); // 계정 조회 도착
        return new Promise((resolve)=>release=resolve); // 늦은 401
    });
    context.after(testHarness.stop); // 수명 정리
    const pending=testHarness.send(); // 실제 전송 복구
    await waiting; // 원래 요청 대기 상태
    testHarness.evaluate('authGeneration++; clearSessionView(); currentUser={id:"2",username:"user_b"}; csrfToken="c".repeat(64);'); // 다른 로그인 완료
    release({status:401,code:"UNAUTHORIZED"}); // 이전 복구의 늦은 실패
    await pending; // 실제 화면 처리 종료
    assert.equal(testHarness.state().userId,"2"); // 새 로그인 보존
    assert.equal(testHarness.evaluate("csrfToken"),"c".repeat(64)); // 새 토큰 보존
});
test("서버 목록이 소속 종료를 확인하면 채널 조회 실패에도 자료 폐기", async (context) => // 창 복귀와 타 탭 탈퇴 경계
{
    const testHarness=setup((call)=>call.url.includes("list_servers")?{status:200,data:{servers:[]}}:{status:500,code:"INTERNAL_ERROR"}); // 소속은 확인하고 채널만 실패
    context.after(testHarness.stop); // 예약 정리
    testHarness.evaluate('channels["1"].serverId="1"; serverManager.identity="1"; serverManager.selected="1"; serverManager.servers=[{id:"1",name:"기존",owner_id:"2",role:"member"}]; globalThis.endedFeed=channels["1"].feed;'); // 이전 소속 자료
    await testHarness.evaluate("loadChannels()"); // 실제 목록 연결
    assert.deepEqual(testHarness.state(),{userId:"1",channelIds:[],draft:""}); // 확인된 탈퇴 자료 비노출
    assert.equal(testHarness.evaluate("endedFeed.list().length"),0); // 기록 저장소 폐기
    assert.equal(testHarness.evaluate("serverManager.selected"),null); // 실제 빈 소속
});
test("서버 소속 403은 비활성 채널 초안도 재참여 전 폐기", async (context) => // 여러 채널 서버의 소속 상실 범위
{
    const testHarness=setup((call)=>call.url.includes("list_servers")?{status:200,data:{servers:[{id:"1",name:"서버",owner_id:"2",role:"member"}]}}:call.url.includes("get_channels")?{status:200,data:{channels:[{id:"1",server_id:"1",server_name:"서버",name:"일반"},{id:"2",server_id:"1",server_name:"서버",name:"개발"}]}}:{status:200,data:{messages:[],pagination:{next_before_id:null,next_after_id:"0",has_more:false}}}); // 재참여 뒤 같은 소속
    context.after(testHarness.stop); // 예약 정리
    testHarness.evaluate('channels["1"].serverId="1"; channels["2"]={serverId:"1",title:"개발",serverName:"서버",messages:[],draft:"비활성 비공개 초안",unread:0}; channels["2"].feed=createChannelFeed("2",channels["2"],"1"); serverManager.identity="1"; serverManager.selected="1"; serverManager.servers=[{id:"1",name:"서버",owner_id:"2",role:"member"}]; channels["1"].feed.block(requestError("소속 없음",403,"FORBIDDEN"));'); // 활성 조회로 서버 소속 상실 확인
    assert.deepEqual(testHarness.state().channelIds,[]); // 같은 서버 전체 채널 폐기
    await testHarness.evaluate("loadChannels()"); // 실제 재참여 후 목록 조회
    testHarness.evaluate('selectChannel("2")'); // 이전 비활성 채널 선택
    assert.equal(testHarness.state().draft,""); // 이전 소속의 초안 재복원 없음
});
