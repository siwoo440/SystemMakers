import assert from "node:assert/strict"; // 화면 결과 검증
import test from "node:test"; // 검사 실행 도구
import { mountFriendsUI } from "../frontend/friends-ui.mjs"; // 실제 친구 화면
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
    }; // 조회 함수 끝
    globalThis.document = { createElement: element }; // 버튼과 칸 생성 경계
    globalThis.window = { setTimeout: () => 1, clearTimeout: () => undefined }; // 자동 갱신 예약 경계
    let user = { id: "1", username: "alice" }; // 로그인 계정
    const opened = []; // 선택한 친구
    const ui = mountFriendsUI({ byId, request, getUser: () => user, isReady: () => Boolean(user), onOpen: (friend) => opened.push(friend), onError: async (error) => error.message }); // 실제 화면 연결
    return { byId, ui, opened, setUser: (next) => user = next }; // 검사 제어
}
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
    }); // 서버 경계 끝
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
}); // 친구 화면 검사 끝
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
}); // 수명 검사 끝
