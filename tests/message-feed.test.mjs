import assert from "node:assert/strict"; // 실제 조회 상태 검증
import test from "node:test"; // 기본 테스트 도구
import { pathToFileURL } from "node:url"; // 브라우저 모듈 주소 변환
import { resolve } from "node:path"; // 모듈 절대 경로
function message(id, channel = "1") // 완전한 API 메시지 자료
{
    return { id, channel_id: channel, user_id: "1", username: "member", content: "본문 " + id, created_at: "2026-10-21T00:00:00Z" }; // 실제 공개 계약
}
function page(ids, mode, more = false, emptyAfter = "0") // 독립적인 응답 자료
{
    return { messages: ids.map((id) => message(id)), pagination: { mode, has_more: more, next_before_id: ids[0] || null, next_after_id: ids.at(-1) || emptyAfter } }; // 완전한 페이지 계약
}
async function setup(handler) // 실제 조회 모듈과 제어 가능한 외부 경계
{
    const { MessageFeed } = await import(pathToFileURL(resolve("frontend/message-feed.mjs"))); // 브라우저와 같은 실제 모듈
    const timers = new Map(); // 브라우저 타이머 대체 경계
    const calls = []; // 실제 조회 요청 조건
    const changes = []; // 화면에 전달된 결과
    let serial = 0; // 타이머 식별자
    const feed = new MessageFeed({ channelId: "1", request: async (query, signal) => // 네트워크 경계 주입
    {
        calls.push({ query: Object.fromEntries(query), signal }); // 조회 커서와 취소 상태 관측
        return handler(calls.length, query, signal); // 상황별 완전한 서버 응답
    }, onChange: (change) => changes.push(change), onError: () => undefined, setTimer: (callback, delay) => // 실제 상태 전이와 가상 시계 연결
    {
        const id = ++serial; // 독립 타이머 ID
        timers.set(id, { callback, delay }); // 예약된 작업 기록
        return id; // 취소용 ID 반환
    }, clearTimer: (id) => timers.delete(id) }); // 예약 작업 취소
    async function tick() // 다음 예약 작업 실행
    {
        const [id, timer] = timers.entries().next().value; // 실제 예약된 다음 작업
        timers.delete(id); // 실행된 작업 제거
        await timer.callback(); // 비동기 요청 완료까지 확인
    }
    return { feed, calls, timers, changes, tick }; // 동작 관측 도구
}
test("최초 조회 완료 후 2초 예약과 요청 중 추가 예약 없음", async () => // setInterval 중복 요청 포착
{
    let release; // 지연된 요청 완료 도구
    const run = await setup((count) => count === 1 ? page(["2"], "initial") : new Promise((resolveRequest) => release = resolveRequest)); // 지연된 신규 요청
    await run.feed.activate(); // 최초 기록 불러오기
    assert.equal(run.timers.size, 1); // 단일 후속 예약
    assert.equal([...run.timers.values()][0].delay, 2000); // 요청 완료 후 2초
    const pending = run.tick(); // 실제 신규 조회 시작
    assert.equal(run.timers.size, 0); // 미완료 요청 중 예약 없음
    await run.feed.older(); // 같은 시점의 이전 조회 시도
    assert.equal(run.calls.length, 2); // 겹치는 조회 차단
    release(page([], "after", false, "2")); // 실제 신규 조회 완료
    await pending; // 완료와 재예약 확인
    assert.equal(run.timers.size, 1); // 완료 이후에만 다음 예약
    run.feed.pause(); // 브라우저 수명 종료
}); // 예약 검사 종료
test("내 전송이 앞서 표시돼도 신규 조회 커서 유지와 적체 소진", async () => // 전송 응답의 커서 건너뛰기 포착
{
    const run = await setup((count) => count === 1 ? page(["1"], "initial") : count === 2 ? page(["2", "3"], "after", true) : page(["4", "5"], "after")); // 조회 전 도착한 다른 사용자 메시지
    await run.feed.activate(); // 최초 커서 1 준비
    run.feed.add(message("5")); // 내 전송 성공이 먼저 도착
    await run.tick(); // 신규 적체 전체 조회
    assert.equal(run.calls[1].query.after_id, "1"); // 전송 응답으로 커서 전진 없음
    assert.equal(run.calls[2].query.after_id, "3"); // 실제 조회 결과로 다음 페이지
    assert.deepEqual(run.feed.list().map((item) => item.id), ["1", "2", "3", "4", "5"]); // 빠짐과 중복 없는 오름차순
    assert.equal(run.feed.after, "5"); // 적체 소진 후 커서
    assert.equal(run.timers.size, 1); // 소진 후 일반 폴링 복귀
    run.feed.pause(); // 작업 종료
}); // 전송과 신규 경합 검사 종료
test("이전 조회의 폴링 커서 보존과 큰 문자열 ID 정렬", async () => // 이전 커서 덮어쓰기와 Number 변환 포착
{
    const run = await setup((count) => count === 1 ? page(["9007199254740993", "9007199254740995"], "initial", true) : count === 2 ? page(["9007199254740991"], "before") : page([], "after", false, "9007199254740995")); // 큰 ID의 이전과 신규 응답
    await run.feed.activate(); // 최신 큰 ID 준비
    await run.feed.older(); // 과거 기록 추가 조회
    assert.equal(run.calls[1].query.before_id, "9007199254740993"); // 실제 최소 ID로 이전 조회
    assert.equal(run.feed.after, "9007199254740995"); // 이전 결과로 신규 커서 변경 없음
    run.feed.add(message("9007199254740994")); // 응답 순서가 다른 전송
    assert.deepEqual(run.feed.list().map((item) => item.id), ["9007199254740991", "9007199254740993", "9007199254740994", "9007199254740995"]); // 정밀도 유지 정렬
    await run.tick(); // 정상 신규 확인
    assert.equal(run.calls[2].query.after_id, "9007199254740995"); // 실제 최신 조회 커서
    run.feed.pause(); // 작업 종료
}); // 이전 조회 검사 종료
test("채널 이동과 로그아웃 이후 지연된 응답·오류 무시", async () => // 취소 이후 화면과 타이머 부활 포착
{
    let release; // 지연 응답 제어
    const run = await setup(() => new Promise((resolveRequest) => release = resolveRequest)); // 진행 중 최초 요청
    const pending = run.feed.activate(); // 실제 요청 시작
    run.feed.pause(); // 채널 이동 또는 계정 종료
    assert.equal(run.calls[0].signal.aborted, true); // 요청 취소 전달
    release(page(["1"], "initial")); // 취소를 무시한 늦은 네트워크 응답
    await pending; // 이전 요청 종료
    assert.deepEqual(run.feed.list(), []); // 이전 응답 적용 없음
    assert.equal(run.timers.size, 0); // 종료 후 폴링 재예약 없음
}); // 수명 검사 종료
test("오류 간격 상한과 성공 복구 후 2초 예약", async () => // 실패 폭주와 복구 지연 포착
{
    let succeed = false; // 실제 응답 성공 전환
    const run = await setup(() => // 상황별 네트워크 응답
    {
        if (!succeed) // 통신 실패 상황
        {
            throw new Error("offline"); // 실제 실패 경로
        }
        return page([], "initial"); // 정상 빈 채널 복구
    }); // 외부 경계 준비 완료
    await run.feed.activate(); // 최초 실패
    assert.equal([...run.timers.values()][0].delay, 4000); // 첫 오류 대기 증가
    for (let attempt = 0; attempt < 5; attempt++) // 반복 연결 실패
    {
        await run.tick(); // 실제 실패 경로 재실행
    }
    assert.equal([...run.timers.values()][0].delay, 30000); // 최대 대기 상한
    succeed = true; // 연결 복구
    await run.tick(); // 실제 성공 경로
    assert.equal([...run.timers.values()][0].delay, 2000); // 정상 간격 복귀
    run.feed.pause(); // 작업 종료
}); // 오류 복구 검사 종료
test("권한 상실의 기록 제거와 폴링 종료", async () => // 사라진 접근 권한의 대화 노출 포착
{
    const run = await setup((count) => // 순차 권한 응답
    {
        if (count === 1) // 권한이 있을 때
        {
            return page(["1"], "initial"); // 조회된 기록
        }
        throw Object.assign(new Error("forbidden"), { status: 403 }); // 실제 권한 상실
    }); // 권한 상황 준비 완료
    await run.feed.activate(); // 최초 기록 확인
    await run.tick(); // 현재 소속 재확인
    assert.deepEqual(run.feed.list(), []); // 기존 대화 제거
    assert.equal(run.feed.blocked, true); // 접근 차단 상태
    assert.equal(run.timers.size, 0); // 폴링 종료
    run.feed.add(message("2")); // 권한 확인 뒤 도착한 이전 전송 성공
    assert.deepEqual(run.feed.list(), []); // 늦은 저장 응답으로 대화 부활 없음
}); // 권한 검사 종료
test("잘못된 채널과 커서 응답의 원자적 거절", async () => // 잘못된 응답의 일부 반영 포착
{
    const run = await setup((count) => count === 1 ? page(["1"], "initial") : { messages: [message("2"), message("3", "9")], pagination: { mode: "after", has_more: false, next_before_id: "2", next_after_id: "3" } }); // 다른 채널이 섞인 응답
    await run.feed.activate(); // 확인된 기록 준비
    await run.tick(); // 잘못된 신규 응답 수신
    assert.deepEqual(run.feed.list().map((item) => item.id), ["1"]); // 일부 응답도 적용 없음
    assert.equal(run.feed.after, "1"); // 확인되지 않은 커서 사용 없음
    run.feed.pause(); // 작업 종료
}); // 응답 검사 종료
test("브라우저 기본 타이머의 전역 호출 대상 유지", async () => // Window 타이머의 Illegal invocation 포착
{
    const { MessageFeed } = await import(pathToFileURL(resolve("frontend/message-feed.mjs"))); // 실제 브라우저 모듈
    const originalSet = globalThis.setTimeout; // 실제 예약 함수 보관
    const originalClear = globalThis.clearTimeout; // 실제 취소 함수 보관
    let scheduled = false; // 정상 예약 관측
    globalThis.setTimeout = function () // 브라우저의 호출 대상 제약 재현
    {
        assert.equal(this, globalThis, "전역 타이머 호출 대상 필요"); // Window 동작 경계
        scheduled = true; // 실제 예약 성공 확인
        return 1; // 테스트 예약 식별자
    }; // 예약 경계 설정 종료
    globalThis.clearTimeout = function () // 브라우저의 취소 호출 제약 재현
    {
        assert.equal(this, globalThis, "전역 취소 호출 대상 필요"); // Window 동작 경계
    }; // 취소 경계 설정 종료
    try // 전역 경계 복구 보장
    {
        const feed = new MessageFeed({ channelId: "1", request: async () => page([], "initial"), onChange: () => undefined, onError: () => undefined }); // 기본 타이머를 사용하는 실제 조회
        await feed.activate(); // 최초 조회와 후속 예약
        assert.equal(scheduled, true); // 실제 기본 예약 경로 확인
        feed.pause(); // 기본 취소 경로 확인
    }
    finally // 다른 검사에 영향 없는 원상 복구
    {
        globalThis.setTimeout = originalSet; // 예약 함수 복원
        globalThis.clearTimeout = originalClear; // 취소 함수 복원
    }
}); // 브라우저 타이머 검사 종료
