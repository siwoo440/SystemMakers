import assert from 'node:assert/strict'; // 프로토콜 검사
import { randomBytes } from 'node:crypto'; // 프레임 마스킹 난수
import { once } from 'node:events'; // 연결 이벤트 대기
import { connect as connectTcp } from 'node:net'; // 평문 검사 연결
import { connect as connectTls } from 'node:tls'; // 인증서 검증 TLS 연결
export async function until(check, timeoutMs = 10000) // 제한된 비동기 상태 대기
{
    const deadline = Date.now() + timeoutMs; // 확인 마감 시각
    while (Date.now() < deadline) // 제한 시간 내 확인
    {
        if (check()) // 기대 상태 여부
        {
            return; // 대기 종료
        }
        await new Promise((resolve) => setTimeout(resolve, 50)); // 다음 상태 대기
    }
    assert.fail('시간 내 예상 상태 미도달'); // 구체적인 대기 실패
}
export async function openWebsocket(url, cookie, origin) // 실제 TLS와 쿠키를 사용하는 연결
{
    const address = new URL(url); // 연결 대상 해석
    const encrypted = address.protocol === 'wss:'; // TLS 연결 여부
    const options = { host: address.hostname.replace(/^\[|\]$/g, ''), port: Number(address.port || (encrypted ? 443 : 80)) }; // 명시한 대상과 포트
    const socket = encrypted ? connectTls({ ...options, servername: options.host }) : connectTcp(options); // 인증서 검사 유지
    const state = { messages: [], closed: false, upgraded: false, error: null }; // 연결 관찰 상태
    let buffer = Buffer.alloc(0); // 미완성 프레임
    function sendFrame(payload, opcode = 1) // 마스킹된 클라이언트 전송
    {
        const content = Buffer.from(payload); // 실제 본문 바이트
        const header = content.length < 126 ? Buffer.from([128 | opcode, 128 | content.length]) : Buffer.from([128 | opcode, 254, content.length >> 8, content.length & 255]); // 짧은 프레임과 16비트 길이
        const mask = randomBytes(4); // 클라이언트 마스킹 키
        const masked = content.map((value, index) => value ^ mask[index % 4]); // 본문 마스킹
        socket.write(Buffer.concat([header, mask, masked])); // 실제 프레임 전송
    }
    socket.on('error', (error) => // 연결 오류 관찰
    {
        state.error = error; // 진단 가능한 오류 보관
    }); // 오류 관찰 끝
    socket.on('close', () => // 연결 종료 관찰
    {
        state.closed = true; // 종료 상태 기록
    }); // 종료 관찰 끝
    socket.on('data', (chunk) => // 서버 프레임 처리
    {
        buffer = Buffer.concat([buffer, chunk]); // 수신 조각 결합
        if (!state.upgraded) // 업그레이드 응답 확인
        {
            const end = buffer.indexOf('\r\n\r\n'); // HTTP 헤더 끝
            if (end < 0) // 헤더 미완성 여부
            {
                return; // 다음 조각 대기
            }
            const status = buffer.subarray(0, end).toString(); // 응답 상태와 헤더
            if (!/^HTTP\/1\.1 101 /u.test(status)) // 업그레이드 실패 여부
            {
                state.error = new Error(status); // 실패 응답 보관
                socket.destroy(); // 실패 연결 정리
                return; // 프레임 해석 중단
            }
            buffer = buffer.subarray(end + 4); // HTTP 헤더 제거
            state.upgraded = true; // 실제 프로토콜 전환 기록
        }
        while (buffer.length >= 2) // 완성 프레임 순회
        {
            let size = buffer[1] & 127; // 서버 본문 길이 구분
            let offset = 2; // 기본 본문 시작
            if (size === 126) // 16비트 확장 길이
            {
                if (buffer.length < 4) // 길이 미완성 여부
                {
                    return; // 다음 조각 대기
                }
                size = buffer.readUInt16BE(2); // 확장 본문 길이
                offset = 4; // 확장 본문 시작
            }
            if (size === 127 || buffer.length < offset + size) // 큰 프레임 또는 미완성 수신
            {
                return; // 추가 자료 대기
            }
            const opcode = buffer[0] & 15; // 서버 프레임 종류
            const payload = buffer.subarray(offset, offset + size); // 실제 본문
            buffer = buffer.subarray(offset + size); // 완료 프레임 제거
            if (opcode === 1) // JSON 알림 여부
            {
                state.messages.push(JSON.parse(payload.toString())); // 구독 승인과 변경 알림 기록
            }
            if (opcode === 9) // 서버 생존 확인 여부
            {
                sendFrame(payload, 10); // 마스킹된 pong 응답
            }
            if (opcode === 8) // 정상 종료 프레임 여부
            {
                socket.end(); // 종료 절차 진행
            }
        }
    }); // 수신 관찰 끝
    await once(socket, encrypted ? 'secureConnect' : 'connect'); // 실제 연결 준비
    socket.write(`GET ${address.pathname} HTTP/1.1\r\nHost: ${address.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\n\r\n`); // 브라우저와 같은 요청
    await until(() => state.upgraded || state.error !== null); // 업그레이드 결과 대기
    if (state.error) // 연결 실패 여부
    {
        socket.destroy(); // 실패 연결 정리
        throw state.error; // 검사 실패 전달
    }
    return Object.assign(state, { send: (message) => sendFrame(JSON.stringify(message)), close: () => socket.destroy() }); // 검사 관찰과 종료 경계
}
