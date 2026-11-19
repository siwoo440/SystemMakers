import assert from 'node:assert/strict'; // 결과 검사
import test from 'node:test'; // 검사 도구
import { realtimeUrlForLocation } from '../frontend/realtime.mjs'; // 실시간 주소 생성
test('같은 출처의 로컬 및 사설 IPv4에 실시간 주소 연결', () => // 내부 주소 검사
{
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '127.0.0.6' }), 'ws://127.0.0.6:8090/Team006/realtime'); // 기존 주소 보존
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '10.0.10.58' }), 'ws://10.0.10.58:8090/Team006/realtime'); // 같은 와이파이 연결
    assert.equal(realtimeUrlForLocation({ protocol: 'http:', hostname: '8.8.8.8' }), null); // 공개 주소 차단
    assert.equal(realtimeUrlForLocation({ protocol: 'https:', hostname: '10.0.10.58', host: '10.0.10.58' }), 'wss://10.0.10.58/Team006/realtime'); // 같은 출처 보안 연결
});
test('HTTPS의 도메인과 포트 및 IPv6를 같은 출처 WSS로 연결', () => // 공개 보안 주소 검사
{
    assert.equal(realtimeUrlForLocation(new URL('https://chat.example.com/Team006/')), 'wss://chat.example.com/Team006/realtime'); // 도메인 연결
    assert.equal(realtimeUrlForLocation(new URL('https://chat.example.com:8443/')), 'wss://chat.example.com:8443/Team006/realtime'); // 공개 포트 보존
    assert.equal(realtimeUrlForLocation(new URL('https://[2001:db8::1]:8443/')), 'wss://[2001:db8::1]:8443/Team006/realtime'); // IPv6 연결
    assert.equal(realtimeUrlForLocation({ protocol: 'https:', hostname: 'chat.example.com', host: 'evil.example.com' }), null); // 호스트 불일치 거절
    assert.equal(realtimeUrlForLocation({ protocol: 'https:', hostname: 'chat.example.com', host: 'chat.example.com/path' }), null); // 경로 주입 거절
    assert.equal(realtimeUrlForLocation(new URL('http://chat.example.com/')), null); // 공개 평문 연결 거절
});
