import assert from 'node:assert/strict'; // 실제 응답 검사
import { randomBytes, createHash } from 'node:crypto'; // 독립 계정과 첨부 해시
import test from 'node:test'; // 통합 검사 도구
import { openWebsocket, until } from './helpers/websocket.mjs'; // 실제 WSS 검사 경계
const origin = process.env.DOCKER_INTEGRATION_URL; // 격리된 검사 주소
test('Docker HTTPS·WSS의 인증·CSRF·권한·첨부와 세션 공유', { skip: !origin, timeout: 90000 }, async (context) => // 운영 컨테이너의 실제 흐름
{
    const suffix = randomBytes(4).toString('hex'); // 검사 계정 구분
    const sockets = []; // 정리할 WSS 연결
    context.after(() => sockets.forEach((socket) => socket.close())); // 모든 연결 정리
    function client() // 계정별 독립 브라우저 상태
    {
        const session = { cookie: '', token: '', id: '' }; // 인증 관찰 상태
        session.request = async (endpoint, body = null, headers = {}) => // 공개 API 요청
        {
            const response = await fetch(`${origin}/Team006/backend/api/${endpoint}`, { method: body === null ? 'GET' : 'POST', headers: { Cookie: session.cookie, ...(session.id ? { 'X-Expected-User-Id': session.id } : {}), ...(body === null ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.token }), ...headers }, body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) }); // 실제 TLS와 세션 요청
            const cookie = response.headers.get('set-cookie'); // 서버 쿠키 교체
            if (cookie) // 새 쿠키 존재 여부
            {
                assert.match(cookie, /; secure/iu); // 운영 Secure 속성 유지
                assert.match(cookie, /; HttpOnly/iu); // 스크립트 접근 차단
                assert.match(cookie, /; SameSite=Lax/iu); // 기존 출처 정책
                session.cookie = cookie.split(';')[0]; // 새 세션 식별자 보관
            }
            const result = await response.json(); // 실제 API 본문
            session.token = result.data?.csrf_token || session.token; // 최신 CSRF 보관
            return { status: response.status, ...result }; // 검사 가능한 응답
        }; // 요청 경계 끝
        return session; // 독립 사용자 상태
    }
    async function account(role) // 실제 가입과 로그인
    {
        const session = client(); // 게스트 상태 준비
        const username = `docker_${role}_${suffix}`; // 독립 검사 사용자
        const password = 'ContainerTest123!'; // 격리된 검사 전용 비밀번호
        assert.equal((await session.request('csrf.php')).status, 200); // 실제 세션 발급
        assert.equal((await session.request('register.php', { username, email: `${username}@example.test`, password })).status, 201); // 실제 계정 생성
        const login = await session.request('login.php', { email: `${username}@example.test`, password }); // 기존 로그인 처리
        assert.equal(login.status, 200); // 로그인 성공 확인
        session.id = login.data.user.id; // 실제 사용자 번호
        return session; // 인증된 브라우저 상태
    }
    async function subscribe(session, subscription, allowedOrigin = origin) // 웹 세션으로 WSS 구독
    {
        const socket = await openWebsocket(origin.replace(/^https:/u, 'wss:') + '/Team006/realtime', session.cookie, allowedOrigin); // 실제 TLS 업그레이드
        sockets.push(socket); // 실패 시 정리 대상
        if (!socket.closed) // 열린 연결 여부
        {
            socket.send(subscription); // 인증된 구독 요청
        }
        return socket; // 연결 상태 반환
    }
    const page = await fetch(`${origin}/Team006/index.html`); // 실제 운영 진입점
    assert.equal(page.status, 200); // Apache 라우팅 성공
    assert.ok(page.headers.get('content-security-policy').includes(origin.replace(/^https:/u, 'wss:'))); // 명시적 운영 WSS 허용
    for (const hidden of ['.git/config', '.runtime/web-env.json', 'backend/config/database.php', 'backend/sql/schema.sql', 'docker/php.ini', 'tests/docker-flow.test.mjs', '%2e%2e/backend/config/database.php']) // 비공개 경로 목록
    {
        assert.equal((await fetch(`${origin}/Team006/${hidden}`)).status, 404, hidden); // 직접 파일 노출 차단
    }
    const owner = await account('owner'); // 소유자 로그인
    const member = await account('member'); // 참여자 로그인
    const outsider = await account('outside'); // 미소속 로그인
    assert.equal((await owner.request('create_server.php', { name: '위조 요청' }, { 'X-CSRF-Token': 'wrong' })).status, 403); // 기존 CSRF 거절
    const created = await owner.request('create_server.php', { name: '컨테이너 검사' }); // 실제 서버와 기본 채널
    assert.equal(created.status, 201); // 역할과 DB 저장 확인
    const channelId = created.data.channel.id; // 권한 검사 대상
    assert.equal((await outsider.request(`get_messages.php?channel_id=${channelId}`)).status, 403); // 미소속 조회 거절
    const invite = await owner.request('create_server_invite.php', { server_id: created.data.server.id }); // 실제 초대 발급
    assert.equal((await member.request('join_server.php', { code: invite.data.code })).status, 201); // 멤버십 생성
    const subscription = { type: 'subscribe', channel_id: channelId, after_id: '0' }; // 기존 구독 계약
    const memberSocket = await subscribe(member, subscription); // 공유 세션으로 실시간 연결
    const outsideSocket = await subscribe(outsider, subscription); // 미소속 구독 검사
    const foreignSocket = await subscribe(member, subscription, 'https://foreign.example.com'); // 위조 출처 검사
    const guestSocket = await subscribe({ cookie: '' }, subscription); // 세션 누락 검사
    await until(() => memberSocket.messages.some((message) => message.type === 'subscribed') && outsideSocket.closed && foreignSocket.closed && guestSocket.closed); // 인증·출처·소속 경계
    const sent = await owner.request('send_message.php', { channel_id: channelId, content: '컨테이너 공유 세션 검사' }); // 기존 HTTP 저장
    assert.equal(sent.status, 201); // 실제 메시지 저장 확인
    await until(() => memberSocket.messages.some((message) => message.type === 'message.created')); // WSS 알림 확인
    assert.equal((await member.request(`get_messages.php?channel_id=${channelId}`)).data.messages[0].content, '컨테이너 공유 세션 검사'); // 기존 조회로 본문 확인
    const conversation = await owner.request('create_dm.php', { user_id: member.id }); // 실제 개인 대화 생성
    assert.equal(conversation.status, 201); // 참여 관계 생성
    const directSocket = await subscribe(member, { type: 'subscribe_direct', conversation_id: conversation.data.conversation.id, after_id: '0' }); // 개인 대화 WSS 권한
    await until(() => directSocket.messages.some((message) => message.type === 'subscribed')); // 개인 구독 승인
    assert.equal((await outsider.request(`get_dm_messages.php?conversation_id=${conversation.data.conversation.id}`)).status, 403); // 제삼자 개인 기록 거절
    assert.equal((await owner.request('send_dm.php', { conversation_id: conversation.data.conversation.id, content: '개인 알림' })).status, 201); // 개인 메시지 저장
    await until(() => directSocket.messages.some((message) => message.type === 'message.created')); // 개인 알림 확인
    async function upload(size) // 실제 최대 첨부 요청
    {
        const form = new FormData(); // 브라우저 파일 본문
        form.append('kind', 'channel'); // 채널 첨부 구분
        form.append('target_id', channelId); // 승인된 채널
        form.append('file', new Blob([new Uint8Array(size)]), 'container.bin'); // 바이너리 첨부
        return fetch(`${origin}/Team006/backend/api/upload_attachment.php`, { method: 'POST', headers: { Cookie: owner.cookie, 'X-Expected-User-Id': owner.id, 'X-CSRF-Token': owner.token }, body: form }); // 실제 Apache·PHP·DB 전송
    }
    assert.equal((await upload(5242881)).status, 422); // 기존 첨부 상한 초과 거절
    const uploaded = await upload(5242880); // 정확히 5 MiB 첨부
    assert.equal(uploaded.status, 201); // 컨테이너 전체 한도 확인
    const attachment = (await uploaded.json()).data.attachment; // 실제 첨부 번호
    const downloadPath = `${origin}/Team006/backend/api/download_attachment.php?id=${attachment.id}`; // 권한 확인 다운로드 주소
    assert.equal((await fetch(downloadPath, { headers: { Cookie: outsider.cookie } })).status, 403); // 외부 사용자 첨부 접근 차단
    const downloaded = await fetch(downloadPath, { headers: { Cookie: member.cookie } }); // 소속 사용자 다운로드
    assert.equal(downloaded.status, 200); // 첨부 권한 승인
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex'); // 실제 바이너리 무결성 비교
    assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())), hash(new Uint8Array(5242880))); // 바이너리 데이터 보존
    assert.equal((await member.request('logout.php', {})).status, 200); // 웹 세션 폐기
    await until(() => memberSocket.closed && directSocket.closed); // Ratchet에서 같은 로그아웃 반영
}); // 컨테이너 흐름 검사 끝
