import assert from "node:assert/strict"; // 검증 도구
import test from "node:test"; // 테스트 도구
import { createRealtimeClient } from "../frontend/realtime.mjs"; // 실제 연결 모듈
function setup() // 제어 가능한 외부 연결 준비
{ // 준비 시작
    const sockets = []; // 생성된 연결 목록
    const timers = new Map(); // 예약된 재연결 목록
    const states = []; // 연결 상태 기록
    let messages = 0; // 새 메시지 신호 횟수
    let nextTimer = 0; // 예약 식별자
    let cursor = "0"; // 현재 조회 기준
    class FakeSocket // 네트워크 경계 대체
    { // 연결 대체 시작
        constructor(url) // 연결 생성
        { // 생성 시작
            this.url = url; // 요청 주소 기록
            this.closed = false; // 종료 상태
            this.sent = []; // 전송 자료 목록
            sockets.push(this); // 생성 연결 보관
        } // 생성 종료
        send(data) // 구독 요청 전송
        { // 전송 시작
            this.sent.push(JSON.parse(data)); // 전송 자료 기록
        } // 전송 끝
        close() // 브라우저 연결 종료
        { // 종료 시작
            this.closed = true; // 종료 요청 기록
        } // 종료 끝
        emit(type, data) // 브라우저 이벤트 전달
        { // 이벤트 시작
            this[`on${type}`]?.({ data }); // 등록된 처리기 호출
        } // 이벤트 끝
    } // 연결 대체 끝
    const client = createRealtimeClient({ url: "ws://localhost:8080", WebSocketImpl: FakeSocket, subscription: () => ({ channel_id: "1", after_id: cursor }), onMessage: () => messages++, onStateChange: (state) => states.push(state), setTimer: (callback, delay) => // 외부 경계 주입
    { // 예약 시작
        const id = ++nextTimer; // 새 예약 번호
        timers.set(id, { callback, delay }); // 예약 기록
        return id; // 예약 번호 전달
    }, clearTimer: (id) => timers.delete(id), minRetryMs: 100, maxRetryMs: 400 }); // 재시도 범위 설정
    function tick() // 가장 앞선 예약 실행
    { // 실행 시작
        const [id, timer] = timers.entries().next().value; // 예약 항목 선택
        timers.delete(id); // 실행 전 예약 제거
        timer.callback(); // 재연결 실행
    } // 실행 끝
    return ( // 검증 경계 반환
    { // 반환 객체 시작
        client, sockets, timers, states, tick, messageCount: () => messages, setCursor: (value) => cursor = value, // 관측 도구 목록
    }); // 반환 객체 끝
} // 준비 끝
test("정상 신호만 새 메시지 조회에 전달", () => // 잘못된 이벤트 무시 검증
{ // 검사 시작
    const fixture = setup(); // 연결 준비
    fixture.client.start(); // 최초 연결
    const socket = fixture.sockets[0]; // 현재 연결
    socket.emit("open"); // 연결 성공
    socket.emit("message", JSON.stringify({ type: "message.created" })); // 구독 승인 전 신호
    assert.equal(fixture.messageCount(), 0); // 승인 전 조회 방지
    socket.emit("message", JSON.stringify({ type: "subscribed" })); // 구독 승인
    socket.emit("message", "잘못된 JSON"); // 파싱 실패
    socket.emit("message", JSON.stringify({ type: "other" })); // 다른 이벤트
    socket.emit("message", JSON.stringify({ type: "message.created" })); // 메시지 신호
    assert.equal(fixture.messageCount(), 1); // 올바른 신호만 전달
    assert.deepEqual(fixture.states, ["connecting", "open", "subscribed"]); // 실제 연결 상태 전달
    fixture.client.stop(); // 연결 정리
}); // 검사 끝
test("연결마다 최신 채널 구독과 서버 승인 전달", () => // 구독 누락과 이전 커서 재사용 방지
{ // 검사 시작
    const fixture = setup(); // 연결 준비
    fixture.client.start(); // 최초 연결
    fixture.sockets[0].emit("open"); // 첫 연결 성공
    assert.deepEqual(fixture.sockets[0].sent, [{ type: "subscribe", channel_id: "1", after_id: "0" }]); // 최초 구독 요청
    fixture.sockets[0].emit("message", JSON.stringify({ type: "subscribed" })); // 서버 구독 승인
    assert.equal(fixture.states.at(-1), "subscribed"); // 승인 상태 전달
    fixture.sockets[0].emit("close"); // 연결 종료
    fixture.setCursor("45"); // 조회 기준 전진
    fixture.tick(); // 재연결 시작
    fixture.sockets[1].emit("open"); // 재연결 성공
    assert.deepEqual(fixture.sockets[1].sent, [{ type: "subscribe", channel_id: "1", after_id: "45" }]); // 최신 기준 재구독
    fixture.client.stop(); // 연결 정리
}); // 검사 끝
test("개인 대화 구독은 대화 ID와 최신 커서를 전송", () => // 채널과 개인 구독 구분
{
    let socket; // 생성된 연결
    class FakeSocket // 전송 경계 대체
    {
        constructor() // 연결 생성
        {
            socket = this; // 현재 연결 보관
        }
        send(data) // 구독 전송
        {
            this.sent = JSON.parse(data); // 전송 결과 보관
        }
        close() // 연결 종료
        {
        }
    }
    const client = createRealtimeClient({ url: "ws://localhost", WebSocketImpl: FakeSocket, subscription: () => ({ conversation_id: "42", after_id: "99" }) }); // 개인 대화 연결
    client.start(); // 연결 시작
    socket.onopen(); // 연결 완료
    assert.deepEqual(socket.sent, { type: "subscribe_direct", conversation_id: "42", after_id: "99" }); // 개인 대화 요청 계약
    client.stop(); // 연결 종료
}); // 개인 구독 검사 끝
test("연결 종료와 오류 뒤 재시도 간격 제한 및 성공 후 복구", () => // 재시도 폭주 방지 검증
{ // 검사 시작
    const fixture = setup(); // 연결 준비
    fixture.client.start(); // 최초 연결
    fixture.sockets[0].emit("close"); // 연결 종료
    assert.equal([...fixture.timers.values()][0].delay, 100); // 최초 대기
    fixture.tick(); // 두 번째 연결
    fixture.sockets[1].emit("error"); // 연결 오류
    fixture.sockets[1].emit("close"); // 오류 뒤 종료 이벤트
    assert.equal(fixture.timers.size, 1); // 중복 재시도 방지
    assert.equal([...fixture.timers.values()][0].delay, 200); // 증가된 대기
    fixture.tick(); // 세 번째 연결
    fixture.sockets[2].emit("close"); // 재연결 실패
    fixture.tick(); // 네 번째 연결
    fixture.sockets[3].emit("close"); // 반복 실패
    assert.equal([...fixture.timers.values()][0].delay, 400); // 최대 대기 상한
    fixture.tick(); // 다섯 번째 연결
    fixture.sockets[4].emit("open"); // 연결 복구
    fixture.sockets[4].emit("message", JSON.stringify({ type: "subscribed" })); // 구독 승인
    fixture.sockets[4].emit("close"); // 복구 이후 종료
    assert.equal([...fixture.timers.values()][0].delay, 100); // 초기 대기로 복구
    fixture.client.stop(); // 연결 정리
}); // 검사 끝
test("중단 뒤 늦은 이벤트와 예약이 연결을 되살리지 않음", () => // 종료 이후 부활 방지 검증
{ // 검사 시작
    const fixture = setup(); // 연결 준비
    fixture.client.start(); // 최초 연결
    const socket = fixture.sockets[0]; // 이전 연결
    socket.emit("close"); // 재시도 예약
    const lateRetry = [...fixture.timers.values()][0].callback; // 이미 대기열에 들어간 작업
    fixture.client.stop(); // 연결과 예약 종료
    lateRetry(); // 취소와 경합한 작업
    socket.emit("open"); // 늦은 성공 이벤트
    socket.emit("message", JSON.stringify({ type: "message.created" })); // 늦은 신호
    socket.emit("close"); // 늦은 종료 이벤트
    assert.equal(fixture.sockets.length, 1); // 새 연결 없음
    assert.equal(fixture.timers.size, 0); // 새 예약 없음
    assert.equal(fixture.messageCount(), 0); // 늦은 신호 무시
    assert.equal(fixture.states.at(-1), "closed"); // 종료 상태 유지
}); // 검사 끝
test("중복 시작은 단일 연결만 유지하고 중단 뒤 다시 시작 가능", () => // 수명 재사용 검증
{ // 검사 시작
    const fixture = setup(); // 연결 준비
    fixture.client.start(); // 첫 연결
    fixture.client.start(); // 중복 시작
    assert.equal(fixture.sockets.length, 1); // 단일 연결
    fixture.client.stop(); // 연결 중단
    assert.equal(fixture.sockets[0].closed, true); // 실제 연결 종료 요청
    fixture.client.start(); // 새 수명 시작
    assert.equal(fixture.sockets.length, 2); // 새 연결 생성
    fixture.client.stop(); // 새 연결 정리
}); // 검사 끝
