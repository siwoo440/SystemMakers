import assert from "node:assert/strict"; // 동작 결과 검사
import test from "node:test"; // 기본 회귀 검사 도구
import { readFileSync } from "node:fs"; // 실제 화면 코드 읽기
import vm from "node:vm"; // 독립 브라우저 실행 영역
import { MessageFeed } from "../frontend/message-feed.mjs"; // 실제 메시지 상태 관리
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 서버 소속 상태
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
        MessageFeed: BrowserFeed, ServerManager, AbortController, URLSearchParams, Date, console, // 실제 상태 모듈과 표준 도구
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
            const call = { url, method: options.method, headers: options.headers, body: options.body === undefined ? null : JSON.parse(options.body) }; // 전송된 사용자와 본문 관측
            calls.push(call); // 자동 재전송 여부 기록
            const result = await handler(call); // 상황별 API 응답
            return { ok: result.status < 400, status: result.status, headers: { get: () => null }, json: async () => result.status < 400 ? { success: true, data: result.data } : { success: false, error: { code: result.code, message: result.code } } }; // 실제 JSON 응답 형태
        } // 네트워크 경계 끝
    }); // 독립 전역 준비 끝
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
test("마지막 채널 제거 후 초안·기록·선택 ID와 예약 정리", async (context) => // 실제 화면의 빈 서버 전환
{
    const run = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id: "1", name: "서버", owner_id: "1", role: "owner", created_at: "2026-10-21T00:00:00Z" }] } } : { status: 200, data: { channels: [] } }); // 서버는 유지하고 채널만 삭제된 응답
    context.after(run.stop); // 검사 자원 정리
    run.evaluate('serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; globalThis.deletedFeed=channels["1"].feed;'); // 기존 선택과 기록
    await run.evaluate("loadChannels()"); // 실제 소속 재조회 경로
    assert.deepEqual(run.state(), { userId: "1", channelIds: [], draft: "" }); // 이전 자료 표시 제거
    assert.equal(run.evaluate("serverManager.selected"), "1"); // 빈 서버 선택 유지
    assert.equal(run.evaluate("serverManager.channel"), null); // 삭제된 영구 선택 제거
    assert.equal(run.evaluate("deletedFeed.active"), false); // 이전 폴링 종료
}); // 빈 서버 화면 검사 종료
test("삭제 확정 뒤 목록 오류에도 기록·초안·선택 폐기", async (context) => // 후속 통신 실패의 삭제 자료 노출 방지
{
    const run = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id: "1", name: "서버", owner_id: "1", role: "owner", created_at: "2026-10-21T00:00:00Z" }] } } : { status: 500, code: "INTERNAL_ERROR" }); // 삭제 후 조회 실패
    context.after(run.stop); // 검사 자원 정리
    run.evaluate('serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; globalThis.deletedFeed=channels["1"].feed; discardDeletedChannel("1");'); // 확인한 삭제 응답 경계
    await run.evaluate("loadChannels()"); // 실패하는 후속 조회
    assert.deepEqual(run.state(), { userId: "1", channelIds: [], draft: "" }); // 삭제 자료 재노출 없음
    assert.equal(run.evaluate("serverManager.selected"), "1"); // 서버 보존
    assert.equal(run.evaluate("serverManager.channel"), null); // 저장 선택 제거
    assert.equal(run.evaluate("deletedFeed.list().length"), 0); // 기록 저장소 제거
    assert.equal(run.evaluate("deletedFeed.active"), false); // 조회 예약 종료
}); // 후속 오류 검사 종료
test("프로필 PATCH는 기대 계정·CSRF·실제 변경 메서드 전달", async (context) => // 공통 요청 확장 회귀
{
    const run = setup(() => ({ status: 200, data: { user: { id: "1", username: "new_name" } } })); // 실제 성공 응답 경계
    context.after(run.stop); // 검사 조회 정리
    await run.evaluate('requestEndpoint("/api/profile.php", { username: "new_name" }, null, "PATCH")'); // 실제 화면 요청
    assert.equal(run.calls[0].method, "PATCH"); // POST로 잘못 변경되는 문제 포착
    assert.equal(run.calls[0].headers["X-Expected-User-Id"], "1"); // 본인 의도 계정
    assert.equal(run.calls[0].headers["X-CSRF-Token"], "a".repeat(64)); // 기존 보호 토큰
}); // PATCH 요청 검사 끝
test("프로필 반영은 본인 메시지 이름만 갱신·초안·기록·커서 유지", (context) => // 기존 대화 보존
{
    const run = setup(() => ({ status: 200, data: {} })); // 요청 없는 표시 변경
    context.after(run.stop); // 예약 정리
    run.evaluate('channels["1"].feed.add({ id:"2",channel_id:"1",user_id:"2",username:"other_user",content:"other message",created_at:"2026-10-21T00:00:00Z" }); channels["1"].feed.after="2"; channels["1"].feed.oldest="1"; applyProfile({id:"1",username:"new_name",email:"a@example.test",created_at:"2026-10-21T00:00:00Z"});'); // 실제 프로필 적용
    assert.deepEqual(run.state(), { userId: "1", channelIds: ["1"], draft: "A private draft" }); // 계정·목록·초안 보존
    assert.equal(run.evaluate('channels["1"].messages[0].name'), "new_name"); // 본인 표시 이름
    assert.equal(run.evaluate('channels["1"].messages[1].name'), "other_user"); // 타인 이름 유지
    assert.equal(run.evaluate('channels["1"].feed.list()[0].username'), "new_name"); // 캐시 이름 갱신
    assert.equal(run.evaluate('channels["1"].feed.after'), "2"); // 신규 커서 유지
    assert.equal(run.evaluate('channels["1"].feed.oldest'), "1"); // 과거 커서 유지
    run.evaluate('applyProfile({id:"2",username:"wrong_user"})'); // 늦은 다른 계정 응답
    assert.equal(run.evaluate('currentUser.username'), "new_name"); // 계정 교체 차단
}); // 프로필 표시 검사 끝
test("프로필 CSRF 복구의 늦은 실패는 새 로그인 계정 유지", async (context) => // 중첩 인증 복구 수명 회귀
{
    let release; // 지연된 계정 확인
    let entered; // 복구 요청 시작 신호
    const waiting = new Promise((resolve) => entered = resolve); // 실제 대기 경계
    const run = setup((call) => // 실제 토큰 복구의 네트워크 경계
    {
        if (call.url === "/api/csrf.php") // 새 보호 토큰
        {
            return { status: 200, data: { csrf_token: "b".repeat(64) } }; // 같은 계정 복구 시작
        }
        entered(); // 기대 계정 확인 요청 진입
        return new Promise((resolve) => release = resolve); // 늦은 인증 실패
    });
    context.after(run.stop); // 실제 예약 정리
    const pending = run.evaluate('serverFailure(requestError("보호 오류",403,"CSRF_INVALID"))'); // 프로필의 공통 인증 복구
    await waiting; // 현재 계정 확인 대기 상태
    run.evaluate('authGeneration++; clearSessionView(); currentUser={id:"2",username:"user_b"}; csrfToken="c".repeat(64);'); // 이전 계정 종료 뒤 새 로그인
    release({ status: 401, code: "UNAUTHORIZED" }); // 이전 복구의 늦은 실패
    await pending; // 중첩 실패 처리 종료
    assert.equal(run.state().userId, "2"); // 새 계정 종료 차단
    assert.equal(run.evaluate("csrfToken"), "c".repeat(64)); // 새 보호 토큰 보존
}); // 중첩 복구 검사 끝
test("다른 탭 탈퇴·채널 삭제 확인은 초안까지 폐기", (context) => // 같은 계정 재참여의 이전 초안 복원 차단
{
    const run = setup(() => ({ status: 200, data: {} })); // 네트워크 없는 접근 종료 경계
    context.after(run.stop); // 조회 예약 정리
    run.evaluate('channels["1"].feed.block(requestError("접근 종료",403,"FORBIDDEN"))'); // 다른 탭 탈퇴 뒤 실제 조회 거절
    assert.equal(run.state().draft, ""); // 현재 입력의 이전 소속 자료 제거
    assert.equal(run.evaluate('channels["1"].draft'), ""); // 채널 초안 저장소도 제거
    assert.equal(run.evaluate('channels["1"].feed.list().length'), 0); // 과거 대화 제거
}); // 소속 상실 초안 검사 끝
test("접근 차단 채널 재조회 성공도 이전 초안 복원 없음", async (context) => // 재참여와 목록 갱신 경계
{
    const run = setup((call) => call.url.includes("list_servers") ? { status: 200, data: { servers: [{ id:"1",name:"서버",owner_id:"2",role:"member",created_at:"2026-10-22T00:00:00Z" }] } } : call.url.includes("get_channels") ? { status:200,data:{ channels:[{id:"1",server_id:"1",server_name:"서버",name:"일반"}] } } : {status:200,data:{messages:[],pagination:{next_before_id:null,next_after_id:"0",has_more:false}}}); // 같은 서버 재참여 뒤 실제 목록
    context.after(run.stop); // 수명 정리
    run.evaluate('serverManager.identity="1"; serverManager.selected="1"; channels["1"].feed.block(requestError("채널 접근 종료",404,"CHANNEL_NOT_FOUND"));'); // 차단 상태
    await run.evaluate("loadChannels()"); // 실제 소속 재확인
    assert.equal(run.state().draft, ""); // 차단된 초안 복구 금지
    assert.equal(run.evaluate('channels["1"].draft'), ""); // 새 채널 상태도 빈 초안
}); // 재참여 초안 검사 끝
test("서버 탈퇴·삭제 확정은 목록 실패 전에 모든 소속 채널 폐기", async (context) => // 조회 실패에도 접근 종료 자료 비노출
{
    const run = setup(() => ({status:500,code:"INTERNAL_ERROR"})); // 후속 서버 목록 실패
    context.after(run.stop); // 조회 예약 정리
    run.evaluate('channels["1"].serverId="1"; serverManager.identity="1"; serverManager.selected="1"; serverManager.channel="1"; serverManager.servers=[{id:"1",name:"종료",owner_id:"1",role:"owner"}]; globalThis.endedFeed=channels["1"].feed; discardDepartedServer("1");'); // 실제 성공 응답 경계
    await run.evaluate("loadChannels()"); // 후속 통신 실패
    assert.deepEqual(run.state(),{userId:"1",channelIds:[],draft:""}); // 이전 소속 자료 전체 폐기
    assert.equal(run.evaluate("serverManager.selected"),null); // 종료된 서버 선택 제거
    assert.equal(run.evaluate("serverManager.channel"),null); // 종료된 채널 선택 제거
    assert.equal(run.evaluate("endedFeed.list().length"),0); // 참조가 남아도 기록 제거
    assert.equal(run.evaluate("endedFeed.active"),false); // 조회 수명 종료
}); // 소속 종료 확정 검사 끝
test("전송 CSRF 복구의 늦은 실패는 새 계정·토큰 보존", async (context) => // 관리 복구 밖의 전송 인증 경계
{
    let release; // 오래된 계정 확인 응답
    let entered; // 요청 진입 신호
    const waiting=new Promise((resolve)=>entered=resolve); // 실제 비동기 복구 대기
    const run=setup((call)=> // 실제 전송·토큰·계정 조회 연결
    {
        if(call.url==="/api/send_message.php") // 처음 제출
        {
            return {status:403,code:"CSRF_INVALID"}; // 토큰 복구 시작
        }
        if(call.url==="/api/csrf.php") // 새 토큰
        {
            return {status:200,data:{csrf_token:"b".repeat(64)}}; // 현재 계정 확인 전 대기
        }
        entered(); // 계정 조회 도착
        return new Promise((resolve)=>release=resolve); // 늦은 401
    });
    context.after(run.stop); // 수명 정리
    const pending=run.send(); // 실제 전송 복구
    await waiting; // 원래 요청 대기 상태
    run.evaluate('authGeneration++; clearSessionView(); currentUser={id:"2",username:"user_b"}; csrfToken="c".repeat(64);'); // 다른 로그인 완료
    release({status:401,code:"UNAUTHORIZED"}); // 이전 복구의 늦은 실패
    await pending; // 실제 화면 처리 종료
    assert.equal(run.state().userId,"2"); // 새 로그인 보존
    assert.equal(run.evaluate("csrfToken"),"c".repeat(64)); // 새 토큰 보존
}); // 전송 복구 검사 끝
test("서버 목록이 소속 종료를 확인하면 채널 조회 실패에도 자료 폐기", async (context) => // 창 복귀와 타 탭 탈퇴 경계
{
    const run=setup((call)=>call.url.includes("list_servers")?{status:200,data:{servers:[]}}:{status:500,code:"INTERNAL_ERROR"}); // 소속은 확인하고 채널만 실패
    context.after(run.stop); // 예약 정리
    run.evaluate('channels["1"].serverId="1"; serverManager.identity="1"; serverManager.selected="1"; serverManager.servers=[{id:"1",name:"기존",owner_id:"2",role:"member"}]; globalThis.endedFeed=channels["1"].feed;'); // 이전 소속 자료
    await run.evaluate("loadChannels()"); // 실제 목록 연결
    assert.deepEqual(run.state(),{userId:"1",channelIds:[],draft:""}); // 확인된 탈퇴 자료 비노출
    assert.equal(run.evaluate("endedFeed.list().length"),0); // 기록 저장소 폐기
    assert.equal(run.evaluate("serverManager.selected"),null); // 실제 빈 소속
}); // 소속 조회 성공 경계 검사 끝
test("서버 소속 403은 비활성 채널 초안도 재참여 전 폐기", async (context) => // 여러 채널 서버의 소속 상실 범위
{
    const run=setup((call)=>call.url.includes("list_servers")?{status:200,data:{servers:[{id:"1",name:"서버",owner_id:"2",role:"member"}]}}:call.url.includes("get_channels")?{status:200,data:{channels:[{id:"1",server_id:"1",server_name:"서버",name:"일반"},{id:"2",server_id:"1",server_name:"서버",name:"개발"}]}}:{status:200,data:{messages:[],pagination:{next_before_id:null,next_after_id:"0",has_more:false}}}); // 재참여 뒤 같은 소속
    context.after(run.stop); // 예약 정리
    run.evaluate('channels["1"].serverId="1"; channels["2"]={serverId:"1",title:"개발",serverName:"서버",messages:[],draft:"비활성 비공개 초안",unread:0}; channels["2"].feed=createChannelFeed("2",channels["2"],"1"); serverManager.identity="1"; serverManager.selected="1"; serverManager.servers=[{id:"1",name:"서버",owner_id:"2",role:"member"}]; channels["1"].feed.block(requestError("소속 없음",403,"FORBIDDEN"));'); // 활성 조회로 서버 소속 상실 확인
    assert.deepEqual(run.state().channelIds,[]); // 같은 서버 전체 채널 폐기
    await run.evaluate("loadChannels()"); // 실제 재참여 후 목록 조회
    run.evaluate('selectChannel("2")'); // 이전 비활성 채널 선택
    assert.equal(run.state().draft,""); // 이전 소속의 초안 재복원 없음
}); // 비활성 초안 범위 검사 끝
