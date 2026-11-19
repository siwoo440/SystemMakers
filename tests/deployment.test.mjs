import assert from 'node:assert/strict'; // 결과 검사
import { execFileSync, spawn } from 'node:child_process'; // 실제 PHP 실행
import { createServer } from 'node:net'; // 빈 검사 포트
import path from 'node:path'; // 저장소 경로
import test from 'node:test'; // 검사 도구
const phpBinary = process.env.PHP_TEST_BIN || path.resolve('.runtime/php83/php.exe'); // PHP 실행 위치
const phpIni = process.env.PHP_TEST_INI || path.resolve('.runtime/php83.ini'); // 확장 설정 위치
function settings(extra, expression = 'deployment_public_origin()') // 실제 운영 설정 검사
{
    const source = `require 'backend/includes/deployment.php'; try { echo json_encode(${expression}, JSON_UNESCAPED_SLASHES); } catch (Throwable $caughtException) { echo 'REJECTED'; }`; // 실제 함수 호출
    return execFileSync(phpBinary, ['-c', phpIni, '-r', source], { cwd: process.cwd(), env: { ...process.env, APP_ENV: 'production', APP_PUBLIC_ORIGIN: '', REALTIME_CONTAINER: '', REALTIME_LISTEN_HOST: '', REALTIME_LISTEN_PORT: '', REALTIME_ALLOWED_ORIGIN: '', ...extra }, encoding: 'utf8', windowsHide: true }).trim(); // 독립 환경 실행
}
test('공개 출처는 HTTPS와 정확한 주소만 허용', () => // 운영 출처 경계
{
    assert.equal(settings({ APP_PUBLIC_ORIGIN: 'https://CHAT.example.com:443' }), '"https://chat.example.com"'); // 기본 포트 정규화
    assert.equal(settings({ APP_PUBLIC_ORIGIN: 'https://[2001:db8::1]:8443' }), '"https://[2001:db8::1]:8443"'); // IPv6 포트 유지
    for (const origin of ['http://chat.example.com', 'https://user@chat.example.com', 'https://chat.example.com/', 'https://chat.example.com?q=1', 'https://chat.example.com#x', 'https://chat.example.com:0', 'https://chat.example.com:65536', 'https://chat.example.com\r\nx: y']) // 잘못된 설정 목록
    {
        assert.equal(settings({ APP_PUBLIC_ORIGIN: origin }), 'REJECTED', origin); // 잘못된 출처 차단
    }
    assert.equal(settings({ APP_ENV: 'test', APP_PUBLIC_ORIGIN: 'http://127.0.0.1:18088' }), '"http://127.0.0.1:18088"'); // 명시적 검사 환경 지원
});
test('전체 인터페이스 수신은 명시적 컨테이너 설정과 공개 출처 필요', () => // 컨테이너 수신 경계
{
    assert.equal(settings({ REALTIME_LISTEN_HOST: '0.0.0.0' }, 'realtime_configuration()'), 'REJECTED'); // 기존 기본 보호
    assert.equal(settings({ REALTIME_CONTAINER: '1', REALTIME_LISTEN_HOST: '0.0.0.0' }, 'realtime_configuration()'), 'REJECTED'); // 공개 출처 누락 거절
    const configured = JSON.parse(settings({ REALTIME_CONTAINER: '1', REALTIME_LISTEN_HOST: '0.0.0.0', APP_PUBLIC_ORIGIN: 'https://chat.example.com' }, 'realtime_configuration()')); // 완전한 운영 설정
    assert.equal(configured.host, '0.0.0.0'); // 컨테이너 내부 수신
    assert.equal(configured.origin, 'https://chat.example.com'); // 정확한 출처 사용
    assert.equal(settings({ REALTIME_CONTAINER: '1', REALTIME_LISTEN_HOST: '0.0.0.0', APP_PUBLIC_ORIGIN: 'https://chat.example.com', REALTIME_ALLOWED_ORIGIN: 'https://other.example.com' }, 'realtime_configuration()'), 'REJECTED'); // 출처 불일치 차단
});
test('공개 주소 출력 도구는 검증 상태와 정확한 링크를 표시', () => // 주소와 배포 완료 구분
{
    const result = execFileSync(phpBinary, ['-c', phpIni, 'scripts/show-public-url.php'], { env: { ...process.env, APP_ENV: 'production', APP_PUBLIC_ORIGIN: 'https://chat.example.com:8443' }, encoding: 'utf8', windowsHide: true }); // 실제 주소 출력
    assert.match(result, /웹 접속: https:\/\/chat\.example\.com:8443\/Team006\/index\.html/u); // 웹 링크 확인
    assert.match(result, /WSS 진단: wss:\/\/chat\.example\.com:8443\/Team006\/realtime/u); // 실시간 주소 확인
    assert.match(result, /실제 외부 접속 확인 필요/u); // 미검증 안내 유지
    assert.throws(() => execFileSync(phpBinary, ['-c', phpIni, 'scripts/show-public-url.php'], { env: { ...process.env, APP_PUBLIC_ORIGIN: '' }, stdio: 'pipe', windowsHide: true })); // 설정 누락의 실패 종료
});
test('실제 라우터는 운영 WSS CSP를 적용하고 잘못된 출처는 거절', async (context) => // 실제 HTTP 보안 헤더 검사
{
    for (const publicOrigin of ['https://chat.example.com:8443', 'https://chat.example.com/path']) // 정상과 잘못된 운영 설정
    {
        const probe = createServer(); // 빈 포트 탐색
        await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); // 포트 예약
        const port = probe.address().port; // 검사 포트
        await new Promise((resolve) => probe.close(resolve)); // 임시 예약 해제
        const server = spawn(phpBinary, ['-c', phpIni, '-S', `127.0.0.1:${port}`, 'router.php'], { env: { ...process.env, APP_ENV: 'production', APP_PUBLIC_ORIGIN: publicOrigin }, windowsHide: true, stdio: 'ignore' }); // 실제 운영 출처 라우터
        context.after(() => server.kill()); // 실패 시 서버 정리
        try // 시작 대기와 결과 확인
        {
            let response; // 실제 응답
            for (let attempt = 0; attempt < 50; attempt++) // 제한된 시작 대기
            {
                try // 준비 상태 요청
                {
                    response = await fetch(`http://127.0.0.1:${port}/Team006/index.html`, { headers: { Host: 'evil.example.com' }, signal: AbortSignal.timeout(500) }); // Host 주입 경계 검사
                    break; // 응답 준비 완료
                }
                catch // 서버 시작 중 연결 실패
                {
                    await new Promise((resolve) => setTimeout(resolve, 50)); // 제한된 재확인
                }
            }
            assert.ok(response, 'PHP 서버 준비 실패'); // 서버 실행 결과 확인
            if (publicOrigin.endsWith('/path')) // 잘못된 설정 여부
            {
                assert.equal(response.status, 503); // 잘못된 공개 출처 거절
                assert.equal(await response.text(), 'Service unavailable.'); // 설정 비노출
            }
            else // 정상 운영 출처
            {
                assert.equal(response.status, 200); // 정상 페이지 제공
                assert.match(response.headers.get('content-security-policy'), /connect-src 'self' wss:\/\/chat\.example\.com:8443;/u); // 검증된 출처만 허용
                assert.ok(!response.headers.get('content-security-policy').includes('evil.example.com')); // Host 주입 무시
                await response.arrayBuffer(); // 응답 본문 정리
            }
        }
        finally // 이번 서버 정리
        {
            server.kill(); // 임시 프로세스 종료
        }
    }
});
