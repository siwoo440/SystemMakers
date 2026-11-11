import assert from 'node:assert/strict'; // 결과 검증
import { randomBytes } from 'node:crypto'; // 마스킹 난수
import { execFileSync, spawn } from 'node:child_process'; // 실제 서버와 변경 실행
import { connect, createServer } from 'node:net'; // 실제 WebSocket 연결
import path from 'node:path'; // 실행 경로
import test from 'node:test'; // 검사 도구
import { fixture } from './helpers/management-fixture.mjs'; // 독립 인증과 DB
async function freePort() // 빈 로컬 포트 선택
{
    const probe = createServer(); // 임시 TCP 서버
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); // 임의 포트 예약
    const port = probe.address().port; // 예약된 포트
    await new Promise((resolve) => probe.close(resolve)); // 예약 해제
    return port; // 사용 가능한 포트
}
async function websocket(port, cookie, origin) // 실제 WebSocket 클라이언트
{
    const socket = connect(port, '127.0.0.1'); // 실제 TCP 연결
    const messages = []; // 수신한 텍스트 메시지
    let buffer = Buffer.alloc(0); // 미처리 데이터
    let upgraded = false; // HTTP 업그레이드 상태
    let closed = false; // 연결 종료 상태
    socket.on('close', () => // 연결 종료 처리
    {
        closed = true; // 종료 상태 기록
    }); // 종료 처리 등록
    socket.on('error', () => // 연결 오류 처리
    {
        closed = true; // 오류 상태 기록
    }); // 오류 처리 등록
    socket.on('data', (chunk) => // 수신 데이터 처리
    {
        buffer = Buffer.concat([buffer, chunk]); // 미완성 데이터 연결
        if (!upgraded) // 최초 HTTP 응답
        {
            const end = buffer.indexOf('\r\n\r\n'); // 헤더 끝 위치
            if (end < 0) // 미완성 헤더
            {
                return; // 다음 데이터 대기
            }
            assert.match(buffer.subarray(0, end).toString(), /^HTTP\/1\.1 101 /); // 업그레이드 성공
            buffer = buffer.subarray(end + 4); // 헤더 제거
            upgraded = true; // 업그레이드 완료
        }
        while (buffer.length >= 2) // 완성 프레임 검사
        {
            const size = buffer[1] & 127; // 짧은 서버 메시지 길이
            if (size >= 126 || buffer.length < size + 2) // 미완성 또는 지원 외 프레임
            {
                break; // 추가 데이터 대기
            }
            const opcode = buffer[0] & 15; // 프레임 종류
            const payload = buffer.subarray(2, size + 2); // 프레임 본문
            buffer = buffer.subarray(size + 2); // 처리 프레임 제거
            if (opcode === 1) // 텍스트 메시지
            {
                messages.push(JSON.parse(payload.toString())); // JSON 알림 보관
            }
            if (opcode === 8) // 종료 프레임
            {
                socket.end(); // 클라이언트 연결 종료
            }
        }
    }); // 데이터 처리 등록
    await new Promise((resolve, reject) => // 연결 대기
    {
        socket.once('connect', resolve); // 연결 성공 처리
        socket.once('error', reject); // 연결 오류 처리
    }); // 연결 대기 종료
    socket.write(`GET /Team006/realtime HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\n\r\n`); // 브라우저와 같은 업그레이드 요청
    for (let attempt = 0; attempt < 100 && !upgraded && !closed; attempt++) // 제한된 핸드셰이크 대기
    {
        await new Promise((resolve) => setTimeout(resolve, 20)); // 짧은 대기
    }
    assert.equal(upgraded, true); // 실제 프로토콜 전환 확인
    const client = // 검사 클라이언트 경계
    {
        messages, // 수신 메시지 목록
        isClosed: () => closed, // 종료 상태 조회
        close: () => socket.destroy(), // 테스트 연결 폐기
        send(value) // 검사 프레임 전송
        {
            const payload = Buffer.from(JSON.stringify(value)); // JSON 본문
            const mask = randomBytes(4); // 클라이언트 필수 마스크
            const frame = Buffer.alloc(6 + payload.length); // 짧은 텍스트 프레임
            frame[0] = 0x81; // 최종 텍스트 프레임
            frame[1] = 0x80 | payload.length; // 마스크와 길이
            mask.copy(frame, 2); // 마스크 복사
            for (let index = 0; index < payload.length; index++) // 본문 마스킹
            {
                frame[6 + index] = payload[index] ^ mask[index % 4]; // 각 바이트 마스킹
            }
            socket.write(frame); // 실제 프레임 전송
        } // 전송 처리 종료
    }; // 클라이언트 생성 종료
    return client; // 클라이언트 반환
}
async function until(check) // 제한된 비동기 상태 대기
{
    for (let attempt = 0; attempt < 100; attempt++) // 최대 5초 확인
    {
        if (check()) // 기대 상태 도달
        {
            return; // 확인 종료
        }
        await new Promise((resolve) => setTimeout(resolve, 50)); // 다음 상태 대기
    }
    assert.fail('시간 내 예상 상태 미도달'); // 시간 초과 보고
}
test('실제 멤버만 새 메시지 알림을 받고 로그아웃 이후 연결 종료', async (context) => // 실제 인증과 릴레이 통합
{
    const environment = await fixture(context); // 전용 테스트 DB와 HTTP
    environment.migrate(); // 초대와 제한 테이블 적용
    const owner = await environment.account('realtime_owner'); // 소유자 세션
    const member = await environment.account('realtime_member'); // 참여자 세션
    const outsider = await environment.account('realtime_outside'); // 미소속 세션
    const server = (await owner.request('create_server.php', { name: '실시간' })).data.server; // 테스트 서버
    const channel = (await owner.request('create_channel.php', { server_id: server.id, name: '대화' })).data.channel; // 테스트 채널
    const invite = (await owner.request('create_server_invite.php', { server_id: server.id })).data.code; // 참여 코드
    await member.request('join_server.php', { code: invite }); // 실제 멤버십
    const port = await freePort(); // 독립 릴레이 포트
    const settings = { ...environment.env, REALTIME_LISTEN_HOST: '127.0.0.1', REALTIME_LISTEN_PORT: String(port), REALTIME_ALLOWED_ORIGIN: 'http://127.0.0.6:8088' }; // 테스트 설정
    const sessionDirectory = path.join(environment.root, '.runtime', environment.env.MYSQL_DATABASE); // HTTP와 같은 전용 세션
    const relay = spawn(environment.php, ['-c', process.env.PHP_TEST_INI || path.join(environment.root, '.runtime/php.ini'), '-d', 'session.save_path=' + sessionDirectory, path.join(environment.root, 'backend/realtime/server.php')], { env: settings, windowsHide: true, stdio: 'inherit' }); // 실제 Ratchet 서버
    context.after(() => relay.kill()); // 테스트 서버 종료
    await new Promise((resolve) => setTimeout(resolve, 2500)); // 릴레이 시작 대기
    const ownSocket = await websocket(port, owner.cookie, 'http://127.0.0.6:8088'); // 소유자 실시간 연결
    const memberSocket = await websocket(port, member.cookie, 'http://127.0.0.6:8088'); // 참여자 실시간 연결
    const outsideSocket = await websocket(port, outsider.cookie, 'http://127.0.0.6:8088'); // 미소속 연결
    const foreignSocket = await websocket(port, member.cookie, 'http://foreign.example'); // 다른 출처 연결
    context.after(() => [ownSocket, memberSocket, outsideSocket, foreignSocket].forEach((socket) => socket.close())); // 검사 연결 종료
    const subscription = { type: 'subscribe', channel_id: channel.id, after_id: '0' }; // 공통 채널 구독
    ownSocket.send(subscription); // 소유자 구독
    memberSocket.send(subscription); // 참여자 구독
    outsideSocket.send(subscription); // 미소속 구독 시도
    await until(() => outsideSocket.isClosed() && foreignSocket.isClosed() && ownSocket.messages.length === 1 && memberSocket.messages.length === 1); // 미소속과 출처 차단 및 승인 확인
    assert.deepEqual(memberSocket.messages.shift(), { type: 'subscribed' }); // 참여자 승인 확인
    assert.deepEqual(ownSocket.messages.shift(), { type: 'subscribed' }); // 소유자 승인 확인
    assert.equal((await owner.request('send_message.php', { channel_id: channel.id, content: '첫 알림' })).status, 201); // 실제 메시지 저장
    await until(() => ownSocket.messages.length === 1 && memberSocket.messages.length === 1); // 두 멤버 알림 대기
    assert.deepEqual(memberSocket.messages, [{ type: 'message.created' }]); // 민감정보 없는 알림
    assert.equal((await member.request('leave_server.php', { server_id: server.id })).status, 200); // 실제 멤버십 폐기
    await until(() => memberSocket.isClosed()); // 연결 중 멤버십 폐기 반영
    assert.equal((await member.request('join_server.php', { code: invite })).status, 201); // 멤버십 복구
    const renewedSocket = await websocket(port, member.cookie, 'http://127.0.0.6:8088'); // 다시 승인받은 연결
    context.after(() => renewedSocket.close()); // 추가 연결 종료
    renewedSocket.send(subscription); // 다시 승인 요청
    await until(() => renewedSocket.messages.length >= 1); // 구독 승인 대기
    assert.equal(renewedSocket.messages[0].type, 'subscribed'); // 재가입 구독 확인
    assert.equal((await member.request('logout.php', {})).status, 200); // 실제 세션 폐기
    await until(() => renewedSocket.isClosed()); // 연결 중 로그아웃 반영
    assert.equal((await owner.request('send_message.php', { channel_id: channel.id, content: '둘째 알림' })).status, 201); // 다음 메시지 저장
    await until(() => ownSocket.messages.length === 2); // 유지된 연결 알림
    assert.equal(memberSocket.messages.length, 1); // 폐기된 연결 알림 차단
}); // 실제 통합 검사 종료

test('개인 대화 참여자만 본문 없는 알림을 받고 세션 종료 시 연결 폐기', async (context) => // 개인 대화 실시간 권한 검사
{
    const environment = await fixture(context); // 독립 DB와 인증 세션
    execFileSync(environment.php, ['-c', process.env.PHP_TEST_INI || path.join(environment.root, '.runtime/php.ini'), path.join(environment.root, 'scripts/migrate-002.php')], { env: environment.env, windowsHide: true }); // 개인 대화 스키마 적용
    const alice = await environment.account('relay_dm_alice'); // 첫 참여자
    const bob = await environment.account('relay_dm_bob'); // 둘째 참여자
    const outsider = await environment.account('relay_dm_outside'); // 제3자
    const conversationId = (await alice.request('create_dm.php', { user_id: bob.id })).data.conversation.id; // 실제 개인 대화
    const port = await freePort(); // 독립 실시간 포트
    const settings = { ...environment.env, REALTIME_LISTEN_HOST: '127.0.0.1', REALTIME_LISTEN_PORT: String(port), REALTIME_ALLOWED_ORIGIN: 'http://127.0.0.6:8088' }; // 검사 전용 서버 설정
    const sessionDirectory = path.join(environment.root, '.runtime', environment.env.MYSQL_DATABASE); // HTTP와 공유할 세션
    const relay = spawn(environment.php, ['-c', process.env.PHP_TEST_INI || path.join(environment.root, '.runtime/php.ini'), '-d', 'session.save_path=' + sessionDirectory, path.join(environment.root, 'backend/realtime/server.php')], { env: settings, windowsHide: true, stdio: 'ignore' }); // 실제 Ratchet 프로세스
    context.after(() => relay.kill()); // 실시간 서버 종료
    await new Promise((resolve) => setTimeout(resolve, 2500)); // 서버 시작 대기
    const aliceSocket = await websocket(port, alice.cookie, 'http://127.0.0.6:8088'); // 첫 참여자 연결
    const bobSocket = await websocket(port, bob.cookie, 'http://127.0.0.6:8088'); // 둘째 참여자 연결
    const outsideSocket = await websocket(port, outsider.cookie, 'http://127.0.0.6:8088'); // 제3자 연결
    context.after(() => [aliceSocket, bobSocket, outsideSocket].forEach((socket) => socket.close())); // 검사 연결 종료
    const subscription = { type: 'subscribe_direct', conversation_id: conversationId, after_id: '0' }; // 개인 대화 구독
    aliceSocket.send(subscription); // 첫 참여자 구독
    bobSocket.send(subscription); // 둘째 참여자 구독
    outsideSocket.send(subscription); // 제3자 구독 시도
    await until(() => outsideSocket.isClosed() && aliceSocket.messages.length === 1 && bobSocket.messages.length === 1); // 승인과 제3자 거절
    assert.deepEqual(aliceSocket.messages.shift(), { type: 'subscribed' }); // 첫 참여자 승인
    assert.deepEqual(bobSocket.messages.shift(), { type: 'subscribed' }); // 둘째 참여자 승인
    assert.equal((await alice.request('send_dm.php', { conversation_id: conversationId, content: '비공개 본문' })).status, 201); // 실제 개인 메시지
    await until(() => aliceSocket.messages.length === 1 && bobSocket.messages.length === 1); // 두 참여자 알림
    assert.deepEqual(bobSocket.messages, [{ type: 'message.created' }]); // 본문 없는 신호
    const futureSocket = await websocket(port, alice.cookie, 'http://127.0.0.6:8088'); // 미래 커서 연결
    context.after(() => futureSocket.close()); // 추가 연결 종료
    futureSocket.send({ type: 'subscribe_direct', conversation_id: conversationId, after_id: '18446744073709551615' }); // 최신보다 큰 커서
    await until(() => futureSocket.messages.length === 1); // 구독 승인 대기
    assert.deepEqual(futureSocket.messages.shift(), { type: 'subscribed' }); // 구독 승인
    assert.equal((await bob.request('send_dm.php', { conversation_id: conversationId, content: '다음 메시지' })).status, 201); // 추가 메시지 저장
    await until(() => futureSocket.messages.length === 1); // 미래 커서 보정 확인
    assert.deepEqual(futureSocket.messages, [{ type: 'message.created' }]); // 보정 후 신규 알림
    environment.sql('INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (' + bob.id + ',' + alice.id + ')'); // 참여자 차단
    await new Promise((resolve) => setTimeout(resolve, 700)); // 권한 재검사 주기
    assert.equal(aliceSocket.isClosed(), false); // 차단 중 기존 대화 조회 유지
    assert.equal(bobSocket.isClosed(), false); // 차단한 참여자 조회 유지
    assert.equal((await bob.request('logout.php', {})).status, 200); // 실제 세션 폐기
    await until(() => bobSocket.isClosed()); // 로그아웃 연결 종료
    environment.sql('DELETE FROM direct_conversations WHERE id=' + conversationId); // 대화 제거 경합
    await until(() => aliceSocket.isClosed()); // 삭제된 대화 구독 종료
}); // 개인 대화 실시간 검사 끝
