import assert from "node:assert/strict"; // 화면 결과 검사
import test from "node:test"; // 기본 검사 도구
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 관리 요청 상태
import { mountServerUI } from "../frontend/server-ui.mjs"; // 실제 화면 동작
function element() // DOM 입출력 경계
{
    const events = new Map(); // 등록한 사용자 이벤트
    const item = { value: "", textContent: "", disabled: false, hidden: false, checked: false, open: false, required: false, children: [], setAttribute: () => undefined, focus: () => undefined, select: () => undefined, reportValidity: () => true }; // 브라우저 필드 상태
    item.addEventListener = (name, action) => events.set(name, action); // 실제 핸들러 보관
    item.fire = (name, event = { preventDefault: () => undefined }) => events.get(name)?.(event); // 사용자의 한 조작
    item.replaceChildren = (...children) => item.children = children; // 실제 표시 목록
    item.showModal = () => item.open = true; // 열린 화면
    item.close = () => // 닫기 이벤트와 원문 정리
    {
        item.open = false; // 닫힌 상태
        item.fire("close"); // 실제 닫기 핸들러
    }; // 닫기 경계 종료
    return item; // 최소 DOM 요소
}
function setup(request, name = "검증 서버", onDeparted = () => undefined, onReload = async () => undefined) // 실제 모듈과 외부 DOM 연결
{
    const elements = new Map(); // 식별자별 요소
    const byId = (id) => // 동일 요소 재사용
    {
        if (!elements.has(id)) // 최초 필드 생성
        {
            elements.set(id, element()); // DOM 경계 준비
        }
        return elements.get(id); // 현재 화면 요소
    }; // 조회 경계 종료
    globalThis.document = { createElement: element }; // 서버 버튼 생성 경계
    let ui; // 실제 화면 연결
    const manager = new ServerManager({ request, getUser: () => ({ id: "1" }), onChange: () => ui?.render() }); // 실제 수명 상태
    Object.assign(manager, { identity: "1", selected: "1", servers: [{ id: "1", name, owner_id: "1", role: "owner" }] }); // 확인된 소속 자료
    ui = mountServerUI({ manager, byId, onDeparted, onReload, onSelect: async () => undefined, onError: async (error) => error.message, isReady: () => true }); // 실제 작업 핸들러
    return { byId, ui }; // 관측할 DOM 경계
}
test("재발급 응답 유실 시 이전 원문 복사 차단", async () => // 무효 코드를 계속 공유하는 오류 차단
{
    let issued = 0; // 네트워크 응답 순서
    const run = setup(async (path) => // 외부 응답 경계
    {
        if (path.includes("get_server_invite")) // 원문 없는 상태 조회
        {
            return { invite: { active: true, expires_at: "2026-10-22T00:00:00Z" } }; // 유효 상태
        }
        if (++issued === 1) // 최초 발급 성공
        {
            return { code: "a".repeat(64), expires_at: "2026-10-22T00:00:00Z" }; // 이번 원문
        }
        throw new Error("응답 유실"); // 재발급 결과 불명확
    }); // 연결 종료
    await run.byId("invite-server").fire("click"); // 초대 화면 열기
    run.byId("server-check").checked = true; // 첫 발급 확인
    await run.byId("server-form").fire("submit"); // 실제 제출
    assert.equal(run.byId("invite-code").value.length, 64); // 최초 원문 표시
    run.byId("server-check").checked = true; // 재발급 확인
    await run.byId("server-form").fire("submit"); // 응답 없는 재발급
    assert.equal(run.byId("invite-code").value, ""); // 이전 원문 폐기
    assert.equal(run.byId("copy-invite").disabled, true); // 무효 코드 복사 차단
});
test("서버 삭제 성공은 목록 재조회 전에 소속 자료 폐기", async () => // 후속 통신과 독립된 성공 경계
{
    const events = []; // 실제 처리 순서
    const run = setup(async (path) => path.includes("get_deletion_preview") ? {name:"검증 서버",channel_count:"2",member_count:"1",message_count:"2"} : {server_id:"1",deleted:true}, "검증 서버", (id) => events.push("discard:"+id), async () => events.push("reload")); // 실제 공개 응답
    await run.byId("delete-server").fire("click"); // 이름 확인 화면
    run.byId("server-value").value="검증 서버"; // 정확한 대상
    await run.byId("server-form").fire("submit"); // 삭제 커밋 응답 처리
    assert.deepEqual(events,["discard:1","reload"]); // 조회 실패 전 폐기 보장
});
test("삭제 이름 불일치는 새 미리보기와 빈 확인 입력 요구", async () => // 오래된 삭제 확인 재사용 방지
{
    let previews = 0; // 실제 미리보기 요청 수
    const run = setup(async (path) => // 권한 있는 서버 응답
    {
        if (path.includes("get_deletion_preview")) // 조회 시점 이름 변경
        {
            previews++; // 네트워크 관측
            return { name: previews === 1 ? "검증 서버" : "바뀐 서버", channel_count: "1", member_count: "1", message_count: "2" }; // 최신 영향
        }
        throw Object.assign(new Error("현재 이름 확인 필요"), { status: 409, code: "NAME_MISMATCH" }); // 변경 사이의 이름 경합
    }); // 연결 종료
    await run.byId("delete-server").fire("click"); // 삭제 영향 조회
    run.byId("server-value").value = "검증 서버"; // 이전 이름 확인
    await run.byId("server-form").fire("submit"); // 실제 삭제 요청
    assert.equal(previews, 2); // 새 영향 재조회
    assert.equal(run.byId("server-value").value, ""); // 새 명시적 확인 필요
    assert.equal(run.byId("server-submit").disabled, true); // 오래된 확인 차단
});
test("구분 공백이 아닌 FEFF를 포함한 실제 이름도 삭제 확인 가능", async () => // 브라우저와 API 정규화 일치
{
    const name = "\uFEFF검증 서버"; // API가 보존하는 실제 이름
    const run = setup(async () => ({ name, channel_count: "1", member_count: "1", message_count: "0" }), name); // 동일한 저장 이름
    await run.byId("delete-server").fire("click"); // 현재 이름 조회
    run.byId("server-value").value = name; // 정확한 코드 포인트 입력
    run.ui.render(); // 실제 제출 조건 계산
    assert.equal(run.byId("server-submit").disabled, false); // 정확한 확인 허용
});
