import assert from "node:assert/strict"; // 화면 결과 검증
import { readFileSync } from "node:fs"; // 화면 문서 읽기
import test from "node:test"; // 검사 실행 도구
import { mountFriendsUI } from "../frontend/friends-ui.mjs"; // 실제 친구 화면
test("친구 요청은 바로 표시되고 팀 프로젝트 표시는 채널에만 존재", () => // 복원한 화면 구조 확인
{
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8"); // 실제 배포 화면 읽기
    const friendPanel = html.match(/<aside\b[^>]*id="friend-panel"[^>]*>([\s\S]*?)<\/aside>/)?.[1]; // 오른쪽 친구 패널 범위
    assert.ok(friendPanel); // 친구 패널 존재 확인
    assert.doesNotMatch(friendPanel, /id="friend-(?:requests-toggle|accept-all|check-status)"|\shidden(?:\s|>)/); // 항상 표시하는 개별 요청 목록 확인
    assert.match(friendPanel, /<h3>받은 요청<\/h3>[\s\S]*<h3>보낸 요청<\/h3>[\s\S]*<h3>친구 목록<\/h3>/); // 기존 구역 순서 확인
    const channel = html.match(/<main\b[^>]*id="channel-conversation"[^>]*>([\s\S]*?)<\/main>/)?.[1]; // 채널 대화 범위
    const direct = html.match(/<main\b[^>]*id="direct-conversation"[^>]*>([\s\S]*?)<\/main>/)?.[1]; // 개인 대화 범위
    assert.match(channel, /<span class="header-tag">팀 프로젝트<\/span>/); // 채널 상단 표시 확인
    assert.doesNotMatch(direct, /팀 프로젝트/); // 개인 대화 구분 확인
});
function element() // 화면 요소 대체
{
    const events = new Map(); // 등록된 사용자 동작
    const item = { value: "", textContent: "", disabled: false, children: [], setAttribute: () => undefined }; // 기본 화면 상태
    item.addEventListener = (name, action) => events.set(name, action); // 이벤트 연결
    item.fire = (name, event = { preventDefault: () => undefined }) => events.get(name)?.(event); // 사용자 동작 실행
    item.replaceChildren = (...children) => item.children = children; // 목록 교체
    item.append = (...children) => item.children.push(...children); // 사용자 칸 추가
    return item; // 독립 화면 요소
}
function setup(request) // 실제 화면과 서버 경계
{
    const elements = new Map(); // 화면 요소 보관
    const byId = (id) => // 식별자별 요소 조회
    {
        if (!elements.has(id)) // 최초 조회
        {
            elements.set(id, element()); // 새 요소 생성
        }
        return elements.get(id); // 현재 요소 반환
    };
    globalThis.document = { createElement: element }; // 버튼과 칸 생성 경계
    globalThis.window = { setTimeout: () => 1, clearTimeout: () => undefined }; // 자동 갱신 예약 경계
    let user = { id: "1", username: "alice" }; // 로그인 계정
    const opened = []; // 선택한 친구
    const ui = mountFriendsUI({ byId, request, getUser: () => user, isReady: () => Boolean(user), onOpen: (friend) => opened.push(friend), onError: async (error) => error.message }); // 실제 화면 연결
    return { byId, ui, opened, setUser: (next) => user = next }; // 검사 제어
}
test("친구 수락 후 늦은 이전 조회가 요청을 되살리지 않음", async () => // 변경과 주기 조회의 응답 순서 검사
{
    const friend = { id: "2", username: "bob" }; // 수락할 사용자
    const previous = { friends: [], incoming: [friend], outgoing: [] }; // 수락 전 목록
    let reads = 0; // 완료 시점별 조회 횟수
    let finishPrevious; // 변경 전 조회의 응답 전달
    const harness = setup(async (path, body) => // 실제 화면의 목록과 변경 요청 분기
    {
        if (body) // 관계 변경 요청
        {
            assert.equal(body.action, "accept"); // 친구 수락 동작 확인
            return {}; // 서버의 변경 성공
        }
        reads++; // 목록 조회 횟수 집계
        if (reads === 2) // 변경과 겹친 조회
        {
            return new Promise((resolve) => finishPrevious = resolve); // 이전 목록의 늦은 응답
        }
        return reads === 1 ? previous : { friends: [friend], incoming: [], outgoing: [] }; // 변경 전후의 서버 상태
    });
    harness.ui.render(); // 초기 받은 요청 표시
    await new Promise((resolve) => setImmediate(resolve)); // 초기 목록 반영 대기
    const polling = harness.ui.refresh(); // 수락 전 자동 조회 시작
    const accepting = harness.byId("friend-incoming").children[0].children[1].fire("click"); // 표시된 친구 요청 수락
    await new Promise((resolve) => setImmediate(resolve)); // 수락 처리와 후속 조회 기회
    finishPrevious(previous); // 수락 뒤 이전 결과 도착
    await Promise.all([polling, accepting]); // 관련 목록 갱신 완료
    assert.equal(reads, 3); // 수락 후 최신 목록 한 번 조회
    assert.equal(harness.byId("friend-list").children.length, 1); // 수락된 친구 표시 유지
    assert.equal(harness.byId("friend-incoming").children.length, 0); // 처리한 요청 제거
    harness.ui.clear(); // 검사 수명 정리
});
test("친구가 없어도 별도 빈 목록 안내 문구는 표시하지 않음", async () => // 요청된 빈 상태 안내 제거
{
    const harness = setup(async () => ({ friends: [], incoming: [], outgoing: [] })); // 실제 빈 목록 응답
    harness.ui.render(); // 로그인한 친구 목록 조회
    await new Promise((resolve) => setImmediate(resolve)); // 목록 반영 대기
    assert.equal(harness.byId("friend-status").textContent, ""); // 빈 목록 안내 제거
    harness.ui.clear(); // 조회 수명 정리
});
test("친구 자동 갱신에서 사용자 목록이 같으면 버튼을 유지", async () => // 반복 DOM 교체와 키보드 초점 유실 확인
{
    const bob = { id: "2", username: "bob" }; // 수락된 친구
    const carol = { id: "3", username: "carol" }; // 받은 요청 사용자
    let incoming = [carol]; // 최초 받은 요청
    const harness = setup(async () => ({ friends: [{ ...bob }], incoming: incoming.map((user) => ({ ...user })), outgoing: [] })); // 요청마다 새 객체를 반환하는 API
    harness.ui.render(); // 실제 인증 목록 조회
    await new Promise((resolve) => setImmediate(resolve)); // 최초 목록 표시 완료
    const friend = harness.byId("friend-list").children[0]; // 현재 친구 행
    const request = harness.byId("friend-incoming").children[0]; // 현재 받은 요청 행
    await harness.ui.refresh(); // 동일 목록 자동 갱신
    assert.equal(harness.byId("friend-list").children[0], friend); // 친구 행과 초점 대상 유지
    assert.equal(harness.byId("friend-incoming").children[0], request); // 받은 요청 행 유지
    incoming = [{ ...carol, username: "carol_new" }]; // 한 목록에서만 사용자명 변경
    await harness.ui.refresh(); // 변경된 목록 갱신
    assert.equal(harness.byId("friend-list").children[0], friend); // 다른 구역의 요소 유지
    assert.notEqual(harness.byId("friend-incoming").children[0], request); // 이름이 달라진 구역 갱신
    assert.equal(harness.byId("friend-incoming").children[0].children[0].textContent, "carol_new"); // 변경된 사용자명 표시
    harness.ui.clear(); // 검사 수명 정리
});
test("수락된 친구 목록과 검색 요청 화면", async () => // 친구 표시와 명시적 요청
{
    const calls = []; // 서버 요청 기록
    const friend = { id: "2", username: "bob" }; // 공개 사용자
    const harness = setup(async (path, body) => // 서버 응답 경계
    {
        calls.push({ path, body }); // 요청 기록
        if (path.includes("search_users")) // 사용자 검색
        {
            return { users: [friend] }; // 검색 결과
        }
        return { friends: [friend], incoming: [], outgoing: [] }; // 수락된 친구 목록
    });
    harness.ui.render(); // 현재 계정 최초 조회
    await new Promise((resolve) => setImmediate(resolve)); // 비동기 목록 반영
    assert.equal(harness.byId("friend-list").children.length, 1); // 수락된 친구 한 칸
    await harness.byId("friend-list").children[0].children[0].fire("click"); // 친구 선택
    assert.equal(harness.opened[0].id, "2"); // 개인 대화 대상
    harness.byId("friend-search-input").value = "bob"; // 검색 사용자명
    await harness.byId("friend-search-form").fire("submit"); // 검색 실행
    await harness.byId("friend-search-results").children[0].children[1].fire("click"); // 친구 요청
    assert.deepEqual(calls.find((call) => call.body?.action === "request").body, { action: "request", user_id: "2" }); // 선택한 사용자만 요청
    harness.ui.clear(); // 화면 수명 종료
    assert.equal(harness.byId("friend-list").children.length, 0); // 로그아웃 목록 제거
});
test("계정 종료 후 늦은 친구 응답 무시", async () => // 이전 계정 자료 노출 차단
{
    let finish; // 지연 응답 제어
    const pending = new Promise((resolve) => finish = resolve); // 보류 중인 목록
    const harness = setup(() => pending); // 지연된 서버 응답
    harness.ui.render(); // 이전 계정 조회 시작
    harness.setUser(null); // 계정 종료
    harness.ui.clear(); // 이전 화면 자료 폐기
    finish({ friends: [{ id: "2", username: "bob" }], incoming: [], outgoing: [] }); // 늦은 친구 응답
    await new Promise((resolve) => setImmediate(resolve)); // 비동기 응답 처리
    assert.equal(harness.byId("friend-list").children.length, 0); // 이전 목록 복원 차단
});
