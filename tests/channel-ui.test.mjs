import assert from "node:assert/strict"; // 화면 동작 검사
import test from "node:test"; // 기본 검사 도구
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 요청 수명
import { mountChannelUI } from "../frontend/channel-ui.mjs"; // 실제 채널 관리 화면
function element() // 최소 DOM 입출력 경계
{
    const events = new Map(); // 실제 등록 핸들러
    const item = { value: "", textContent: "", disabled: false, hidden: false, open: false, required: false, focus: () => undefined, reportValidity: () => true }; // 브라우저 상태
    item.addEventListener = (name, handler) => events.set(name, handler); // 이벤트 보관
    item.fire = (name) => events.get(name)?.({ preventDefault: () => undefined }); // 사용자 조작
    item.showModal = () => item.open = true; // 명시적 대화상자
    item.close = () => // 실제 닫기 이벤트
    {
        item.open = false; // 닫힌 상태
        item.fire("close"); // 입력 정리 경계
    }; // 닫기 동작 끝
    return item; // 독립 요소
}
function setup(request, role = "owner", initial = { id: "2", title: "개발", serverId: "1" }) // 실제 화면과 인증 경계
{
    const elements = new Map(); // 동일 식별자 요소
    const byId = (id) => // DOM 조회
    {
        if (!elements.has(id)) // 최초 조회
        {
            elements.set(id, element()); // 요소 준비
        }
        return elements.get(id); // 같은 화면 객체
    }; // 조회 함수 종료
    let active = initial; // 현재 선택 채널
    let user = { id: "1" }; // 인증한 계정
    let ui; // 실제 화면 연결
    let reloads = 0; // 실제 목록 재조회 경계
    let failures = 0; // 인증 오류 전달 경계
    const deleted = []; // 조회 전 삭제 확정 대상
    const manager = new ServerManager({ request, getUser: () => user, onChange: () => ui?.render() }); // 실제 관리 상태
    Object.assign(manager, { identity: "1", selected: "1", servers: [{ id: "1", name: "팀", owner_id: "1", role }] }); // 확인한 서버 소속
    ui = mountChannelUI({ manager, byId, getChannel: () => active, isReady: () => Boolean(user), onDeleted: (id) => deleted.push({ id, reloads }), onReload: async () => reloads++, onError: async (error) => // 실제 외부 경계
    {
        failures++; // 전달한 현재 오류만 집계
        return error.message; // 사용자 오류 안내
    } }); // 실제 화면 초기화
    return { ui, manager, byId, deleted, reloads: () => reloads, failures: () => failures, select: (value) => active = value, changeUser: (value) => user = value }; // 검사 제어 경계
}
test("일반 회원 관리 버튼 숨김과 빈 서버의 관리자 생성", () => // 권한과 빈 서버 진입
{
    const member = setup(async () => ({}), "member"); // 일반 소속
    member.ui.render(); // 실제 권한 계산
    assert.equal(member.byId("create-channel").hidden, true); // 생성 미노출
    assert.equal(member.byId("rename-channel").hidden, true); // 변경 미노출
    assert.equal(member.byId("delete-channel").hidden, true); // 삭제 미노출
    const admin = setup(async () => ({}), "admin", null); // 채널 없는 서버
    admin.ui.render(); // 빈 서버 상태
    assert.equal(admin.byId("create-channel").hidden, false); // 관리자 생성 경로
    assert.equal(admin.byId("create-channel").disabled, false); // 실제 생성 가능
    assert.equal(admin.byId("rename-channel").hidden, true); // 미확인 대상 변경 금지
});
test("생성 성공은 새 채널 선택과 목록 재확인", async () => // 확인한 응답만 선택 반영
{
    const calls = []; // 전송 계약 관측
    const run = setup(async (path, body) => // 실제 네트워크 경계
    {
        calls.push({ path, body }); // 요청 한 번 기록
        return { channel: { id: "7", server_id: "1", server_name: "팀", name: "새 채널" } }; // 실제 생성 응답
    }, "admin", null); // 빈 서버의 관리자
    await run.byId("create-channel").fire("click"); // 생성 화면
    run.byId("channel-value").value = "새 채널"; // 이름 입력
    await run.byId("channel-manage-form").fire("submit"); // 실제 요청
    assert.deepEqual(calls, [{ path: "/api/create_channel.php", body: { server_id: "1", name: "새 채널" } }]); // 허용 필드만 전달
    assert.equal(run.manager.channel, "7"); // 새 채널 선택
    assert.equal(run.reloads(), 1); // 실제 목록 확인
});
test("삭제 이름 변경은 같은 대상의 새 미리보기 요구", async () => // 다른 채널로 재확인 대상 변경 방지
{
    const ids = []; // 조회한 대상 목록
    const run = setup(async (path) => // 이름 변경 경합
    {
        if (path.includes("get_deletion_preview")) // 실제 영향 조회
        {
            ids.push(new URL(path, "http://local").searchParams.get("resource_id")); // 대상 ID 관측
            return { name: ids.length === 1 ? "개발" : "새 개발", message_count: "3" }; // 조회 시점 이름
        }
        run.select({ id: "99", title: "다른 채널", serverId: "1" }); // 외부 선택 변경
        throw Object.assign(new Error("이름 불일치"), { status: 409, code: "NAME_MISMATCH" }); // 실제 삭제 거절
    }); // 네트워크 경계 끝
    await run.byId("delete-channel").fire("click"); // 첫 미리보기
    run.byId("channel-value").value = "개발"; // 당시 이름 확인
    await run.byId("channel-manage-form").fire("submit"); // 삭제 요청
    assert.deepEqual(ids, ["2", "2"]); // 같은 대상 재조회
    assert.equal(run.byId("channel-value").value, ""); // 이전 확인 폐기
    assert.equal(run.byId("channel-manage-submit").disabled, true); // 새 명시적 확인
});
test("미리보기 실패는 삭제 차단·취소는 변경 요청 없음", async () => // 미확인 영향으로 삭제 방지
{
    let calls = 0; // 네트워크 관측
    const run = setup(async () => // 조회 실패
    {
        calls++; // 조회 한 번
        throw new Error("연결 실패"); // 결과 미확인
    });
    await run.byId("delete-channel").fire("click"); // 영향 확인 시도
    run.byId("channel-value").value = "개발"; // 이름만 입력한 상태
    run.ui.render(); // 실제 제출 조건
    assert.equal(run.byId("channel-manage-submit").disabled, true); // 미리보기 필수
    await run.byId("channel-manage-close").fire("click"); // 취소
    assert.equal(calls, 1); // 삭제 자동 재전송 없음
});
test("구분 공백과 FEFF 이름의 삭제 확인은 API와 동일", async () => // 유효한 이름을 삭제할 수 있는 상태
{
    const name = "\uFEFF개발"; // API가 보존하는 이름
    const run = setup(async () => ({ name, message_count: "0" }), "owner", { id: "2", title: name, serverId: "1" }); // 실제 채널
    await run.byId("delete-channel").fire("click"); // 영향 확인
    run.byId("channel-value").value = "　" + name + "　"; // 유니코드 구분 공백
    run.ui.render(); // 삭제 확인 조건
    assert.equal(run.byId("channel-manage-submit").disabled, false); // 정확한 이름 허용
});
test("이전 계정의 지연 실패는 새 화면 오류로 전달하지 않음", async () => // 늦은 응답의 계정 혼합 차단
{
    let reject; // 네트워크 실패 대기
    const run = setup(() => new Promise((resolve, fail) => reject = fail)); // 실제 지연 요청
    await run.byId("rename-channel").fire("click"); // 변경 화면
    run.byId("channel-value").value = "바꿀 이름"; // 새 이름
    const pending = run.byId("channel-manage-form").fire("submit"); // 이전 계정 제출
    run.changeUser({ id: "3" }); // 다른 계정으로 전환
    run.manager.reset(); // 이전 계정 수명 종료
    reject(Object.assign(new Error("세션 변경"), { status: 403, code: "SESSION_CHANGED" })); // 이전 요청의 실패
    await pending; // 실제 처리 완료
    assert.equal(run.failures(), 0); // 새 계정 인증 복구 미호출
    assert.equal(run.byId("channel-dialog").open, false); // 이전 관리 화면 정리
});
test("삭제 성공은 목록 조회 전에 확정 대상 정리", async () => // 후속 통신에 의존하지 않는 폐기
{
    const run = setup(async (path) => path.includes("get_deletion_preview") ? { name: "개발", message_count: "1" } : { channel_id: "2", deleted: true }); // 실제 삭제 응답
    await run.byId("delete-channel").fire("click"); // 삭제 영향 확인
    run.byId("channel-value").value = "개발"; // 정확한 이름 입력
    await run.byId("channel-manage-form").fire("submit"); // 확정 응답 처리
    assert.deepEqual(run.deleted, [{ id: "2", reloads: 0 }]); // 조회 전 같은 대상 폐기
    assert.equal(run.reloads(), 1); // 이후 실제 목록 확인
});
