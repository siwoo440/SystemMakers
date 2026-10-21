import assert from "node:assert/strict"; // 화면 상태 결과 검사
import test from "node:test"; // 기본 검사 도구
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 관리 상태 모듈
function setup(request) // 브라우저 바깥 경계
{
    let user = { id: "1" }; // 현재 화면 계정
    const values = new Map(); // 선택 ID 저장소
    const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; // 실제 영구 저장 경계 대체
    const manager = new ServerManager({ request, getUser: () => user, storage }); // 실제 모듈
    return { manager, values, change: (value) => user = value }; // 제어 가능한 인증 경계
}
const servers = [{ id: "9007199254740993", name: "빈 서버", owner_id: "1", role: "owner", created_at: "2026-10-21T00:00:00Z" }]; // 큰 문자열 ID
test("채널이 없는 서버도 선택·저장·복원", async () => // 채널 목록에 의존한 서버 누락 포착
{
    const state = setup(async () => ({ servers })); // 실제 서버 목록 응답
    await state.manager.sync(); // 목록 확인
    assert.equal(state.manager.selected, servers[0].id); // 큰 ID 그대로 선택
    state.manager.rememberChannel("42"); // 선택 채널 저장
    assert.deepEqual(JSON.parse([...state.values.values()][0]), { serverId: servers[0].id, channelId: "42" }); // ID만 영구 보관
    state.manager.selected = null; // 화면 재선택 조건
    await state.manager.sync(); // 저장된 선택 복원
    assert.equal(state.manager.selected, servers[0].id); // 유효한 서버 유지
});
test("다른 계정으로 바뀐 뒤 도착한 서버·변경 응답 무시", async () => // 늦은 자료의 계정 혼합 차단
{
    let finish; // 지연된 네트워크 완료 경계
    const state = setup(() => new Promise((resolve) => finish = resolve)); // 실제 모듈의 지연 요청
    const pending = state.manager.sync(); // A 계정 조회
    state.change({ id: "2" }); // 다른 탭 계정 변경
    state.manager.reset(); // 기존 계정 자료 정리
    finish({ servers }); // 늦은 응답 도착
    await pending; // 응답 처리 완료
    assert.deepEqual(state.manager.servers, []); // 이전 목록 없음
    assert.equal(state.manager.selected, null); // 이전 선택 없음
});
test("동시 제출 차단과 실패 뒤 자동 재전송 없음", async () => // 중복 서버 생성 방지
{
    let fail; // 실제 네트워크 실패 경계
    let calls = 0; // 호출 횟수
    const state = setup(() => // 지연되는 요청
    {
        calls++; // 실제 요청 관측
        return new Promise((resolve, reject) => fail = reject); // 외부 실패 대기
    });
    const pending = state.manager.execute("create_server", { name: "첫 서버" }); // 첫 요청
    await assert.rejects(state.manager.execute("create_server", { name: "두 번째" }), /처리 중/); // 중복 제출 거절
    fail(new Error("연결 중단")); // 결과 불명확한 실패
    await assert.rejects(pending, /연결 중단/); // 실패 전달
    assert.equal(calls, 1); // 자동 재전송 없음
    assert.equal(state.manager.busy, false); // 다시 조작 가능한 상태
});
test("로그아웃은 선택·코드·진행 응답 수명 정리", async () => // 이전 계정의 영구 선택 제거
{
    const state = setup(async () => ({ servers })); // 정상 서버 목록
    await state.manager.sync(); // 본인 목록 준비
    state.manager.rememberChannel("42"); // 선택 저장
    state.manager.reset(); // 계정 종료
    assert.equal(state.values.size, 0); // 이전 ID 저장 제거
    assert.deepEqual(state.manager.servers, []); // 메모리 자료 정리
});
test("이전 계정의 늦은 실패는 새 계정의 세션 종료로 전달하지 않음", async () => // 실패 경로의 수명 검사
{
    let fail; // 지연된 실패 경계
    const state = setup(() => new Promise((resolve, reject) => fail = reject)); // 실제 요청 실패 대기
    const pending = state.manager.execute("create_server", { name: "이전 계정" }); // A의 변경 요청
    state.change({ id: "2" }); // 새 계정으로 전환
    state.manager.reset(); // 이전 화면 종료
    fail(Object.assign(new Error("이전 세션 만료"), { status: 401, code: "UNAUTHORIZED" })); // A 요청의 늦은 실패
    await assert.rejects(pending, (error) => error.code === "STALE_RESPONSE" && error.status !== 401); // 새 계정 종료 오류와 구분
});
