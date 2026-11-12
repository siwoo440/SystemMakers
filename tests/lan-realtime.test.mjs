import assert from 'node:assert/strict'; // 결과 검사
import test from 'node:test'; // 검사 도구
import { realtimeUrlForLocation } from '../frontend/realtime.mjs'; // 실시간 주소 생성
test('같은 출처의 로컬 및 사설 IPv4에 실시간 주소 연결', () => // 내부 주소 검사
{
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '127.0.0.6' }), 'ws://127.0.0.6:8090/Team006/realtime'); // 기존 주소 보존
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '10.0.10.58' }), 'ws://10.0.10.58:8090/Team006/realtime'); // 같은 와이파이 연결
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '8.8.8.8' }), null); // 공개 주소 차단
    assert.equal(realtimeUrlForLocation({ protocol: 'https:', hostname: '10.0.10.58' }), null); // 미구성 보안 연결 차단
}); // 검사 종료
