import assert from "node:assert/strict"; // 화면 결과 검증
import test from "node:test"; // 검사 실행 도구
import { mountFriendsUI } from "../frontend/friends-ui.mjs"; // 실제 친구 화면
function element() // 화면 요소 대체
{
    const events = new Map(); // 등록된 사용자 동작
    const attributes = new Map(); // 접근성 속성 보관
    const item = { value: "", textContent: "", disabled: false, hidden: false, children: [], setAttribute: (name, value) => attributes.set(name, value), getAttribute: (name) => attributes.get(name), focus: () => item.focused = true }; // 기본 화면 상태
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
test("종 버튼의 미확인 요청 수와 펼침 상태", async () => // 받은 요청 확인과 새 도착 구분
{
    const bob = { id: "2", username: "bob" }; // 첫 요청 사용자
    const carol = { id: "3", username: "carol" }; // 후속 요청 사용자
    let incoming = [bob]; // 현재 받은 요청
    const harness = setup(async () => ({ friends: [], incoming, outgoing: [carol] })); // 서버 요청 목록
    harness.ui.render(); // 최초 목록 조회
    await new Promise((resolve) => setImmediate(resolve)); // 비동기 목록 반영
    const bell = harness.byId("friend-requests-toggle"); // 요청 종 버튼
    const badge = harness.byId("friend-request-count"); // 미확인 요청 수
    assert.equal(harness.byId("friend-requests").hidden, true); // 기본 요청 접힘
    assert.equal(bell.getAttribute("aria-expanded"), "false"); // 접힌 상태 안내
    assert.equal(badge.textContent, "1"); // 받은 요청만 집계
    assert.equal(badge.hidden, false); // 미확인 숫자 표시
    bell.fire("click"); // 요청 묶음 펼치기
    assert.equal(harness.byId("friend-requests").hidden, false); // 받은 요청과 보낸 요청 표시
    assert.equal(bell.getAttribute("aria-expanded"), "true"); // 펼친 상태 안내
    assert.equal(badge.hidden, true); // 확인한 요청 배지 숨김
    bell.fire("click"); // 요청 묶음 접기
    incoming = [bob, carol]; // 새 사용자 요청 도착
    await harness.ui.refresh(); // 최신 요청 반영
    assert.equal(badge.textContent, "1"); // 새 도착만 미확인 집계
    assert.match(bell.getAttribute("aria-label"), /미확인 받은 요청 1개/); // 숫자의 보조 기술 안내
    harness.ui.clear(); // 계정 종료
    assert.equal(harness.byId("friend-requests").hidden, true); // 이전 요청 접기
    assert.equal(badge.hidden, true); // 이전 계정 숫자 제거
    assert.equal(bell.disabled, true); // 게스트 요청 버튼 차단
});
test("친구 요청 Escape 닫기와 종 버튼 포커스 복귀", async () => // 모바일 키보드 요청 탐색
{
    const harness = setup(async () => ({ friends: [], incoming: [], outgoing: [] })); // 빈 서버 목록
    harness.ui.render(); // 로그인한 목록 조회
    await new Promise((resolve) => setImmediate(resolve)); // 초기 목록 반영
    harness.byId("friend-requests-toggle").fire("click"); // 요청 목록 펼치기
    let prevented = false; // 기본 키 처리 차단 상태
    let stopped = false; // 상위 모바일 목록 처리 차단 상태
    harness.byId("friend-requests").fire("keydown", { key: "Escape", preventDefault: () => prevented = true, stopPropagation: () => stopped = true }); // 요청 안쪽 닫기 키
    assert.equal(harness.byId("friend-requests").hidden, true); // 요청 목록 접기
    assert.equal(harness.byId("friend-requests-toggle").focused, true); // 요청 진입점으로 복귀
    assert.equal(prevented && stopped, true); // 모바일 친구 패널 닫힘 방지
    harness.ui.clear(); // 검사 수명 정리
});
test("받은 요청만 순차적으로 모두 수락하고 최종 목록을 한 번 확인", async () => // 스냅샷과 중복 클릭 및 일부 수락 처리
{
    const incoming = [{ id: "2", username: "bob" }, { id: "3", username: "carol" }, { id: "4", username: "dave" }, { id: "5", username: "eve" }]; // 받은 요청 네 건
    const outgoing = [{ id: "6", username: "frank" }]; // 수락 대상이 아닌 보낸 요청
    const accepted = []; // 수락 요청 기록
    let reads = 0; // 친구 목록 GET 횟수
    let finishFirst; // 첫 수락의 응답 제어
    const firstRequest = new Promise((resolve) => finishFirst = resolve); // 진행 중인 첫 수락
    const harness = setup(async (path, body) => // 실제 화면의 요청 경계
    {
        if (!body) // 목록 조회
        {
            reads++; // GET 횟수 기록
            return reads === 1 ? { friends: [], incoming, outgoing } : { friends: [incoming[0]], incoming: incoming.slice(2), outgoing }; // 확인된 변경 이후 목록
        }
        accepted.push(body); // 받은 요청에서 선택한 대상 기록
        if (body.user_id === "2") // 첫 수락 진행 중
        {
            await firstRequest; // 수락 직렬화 확인
            return {}; // 서버의 수락 성공
        }
        if (body.user_id === "3") // 다른 탭에서 처리한 요청
        {
            throw Object.assign(new Error("친구 관계를 확인하세요."), { status: 409, code: "FRIEND_STATE_CONFLICT" }); // 이어갈 수 있는 충돌
        }
        throw new Error("연결 상태를 확인하지 못했습니다."); // 후속 시도를 중단할 불확실한 응답
    });
    harness.ui.render(); // 처음 받은 요청 표시
    await new Promise((resolve) => setImmediate(resolve)); // 최초 목록 완료
    const acceptAll = harness.byId("friend-accept-all"); // 받은 요청 일괄 버튼
    assert.equal(acceptAll.disabled, true); // 종이 접힌 동안 비활성
    harness.byId("friend-requests-toggle").fire("click"); // 받은 요청 펼침
    assert.equal(acceptAll.disabled, false); // 처리할 받은 요청이 있는 상태
    const pending = acceptAll.fire("click"); // 모두 수락 시작
    await acceptAll.fire("click"); // 처리 중 추가 클릭
    assert.deepEqual(accepted.map((item) => item.user_id), ["2"]); // 첫 응답 전 다음 수락 대기
    finishFirst(); // 첫 수락 성공 확정
    await pending; // 일괄 처리와 목록 갱신 완료
    assert.deepEqual(accepted, ["2", "3", "4"].map((userId) => ({ action: "accept", user_id: userId }))); // 실패 앞의 받은 요청만 각 한 번 전송
    assert.equal(reads, 2); // 최초 목록과 일괄 처리 후 재조회
    assert.equal(harness.byId("friend-incoming").children.length, 2); // 실패하거나 미시도한 요청 유지
    assert.match(harness.byId("friend-status").textContent, /1개를 수락.*1개는 처리할 수 없.*연결 상태/); // 성공과 건너뛰기 및 중단 알림
    harness.ui.clear(); // 검사 수명 정리
});
test("모두 수락 도중 계정이 종료되면 나머지 변경과 이전 상태 안내를 차단", async () => // 계정 변경의 일괄 전송 수명
{
    const calls = []; // 조회와 수락 기록
    let finishAccept; // 첫 수락의 늦은 응답 제어
    const pendingAccept = new Promise((resolve) => finishAccept = resolve); // 진행 중인 첫 수락
    const harness = setup(async (path, body) => // 요청 경계
    {
        calls.push(body); // 이전 계정에서 전송한 요청 기록
        return body ? pendingAccept : { friends: [], incoming: [{ id: "2", username: "bob" }, { id: "3", username: "carol" }], outgoing: [] }; // 받은 요청 두 건과 지연 응답
    });
    harness.ui.render(); // 계정의 대기 요청 가져오기
    await new Promise((resolve) => setImmediate(resolve)); // 목록 반영 대기
    harness.byId("friend-requests-toggle").fire("click"); // 요청 묶음 펼치기
    const pending = harness.byId("friend-accept-all").fire("click"); // 첫 수락 요청 시작
    harness.setUser(null); // 로그아웃 확인
    harness.ui.clear(); // 이전 계정의 화면과 세대 정리
    finishAccept({}); // 이전 계정에서 전송한 첫 수락 결과 도착
    await pending; // 늦은 결과 처리 완료
    assert.deepEqual(calls, [null, { action: "accept", user_id: "2" }]); // 나머지 변경과 후속 조회 미전송
    assert.equal(harness.byId("friend-status").textContent, "로그인 후 친구를 확인하세요."); // 로그아웃 상태의 안내 유지
});
test("보낸 요청 상태 확인은 친구 목록을 갱신하고 수락을 요청하지 않음", async () => // 이미 수락된 관계의 읽기 전용 확인
{
    const friend = { id: "2", username: "bob" }; // 요청을 받은 상대방
    const bodies = []; // 상태 확인 동안 발생한 본문 기록
    const harness = setup(async (path, body) => // 실제 화면의 요청 경계
    {
        bodies.push(body); // 조회와 변경 구분
        return bodies.length === 1 ? { friends: [], incoming: [], outgoing: [friend] } : { friends: [friend], incoming: [], outgoing: [] }; // 상대의 수락 후 관계
    });
    harness.ui.render(); // 보낸 요청 최초 표시
    await new Promise((resolve) => setImmediate(resolve)); // 목록 완료
    const check = harness.byId("friend-check-status"); // 보낸 요청 상태 확인 버튼
    assert.equal(check.disabled, true); // 종이 접힌 동안 비활성
    harness.byId("friend-requests-toggle").fire("click"); // 요청 묶음 열기
    await check.fire("click"); // 보낸 요청 상태 확인
    assert.deepEqual(bodies, [null, null]); // 친구와 요청 조회 두 번만 사용
    assert.equal(harness.byId("friend-outgoing").children.length, 0); // 수락된 보낸 요청 제거
    assert.equal(harness.byId("friend-list").children.length, 1); // 수락된 친구 표시
    assert.match(harness.byId("friend-status").textContent, /보낸 요청 상태를 확인/); // 상태 확인 결과 안내
    harness.ui.clear(); // 검사 수명 정리
});
