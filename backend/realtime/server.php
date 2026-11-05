<?php // 로컬 실시간 알림 서버 실행

declare(strict_types=1); // 엄격한 자료형 검사
ini_set('display_errors', '0'); // 내부 오류의 화면 노출 차단
error_reporting(E_ALL); // 전체 오류 감지
require_once __DIR__ . '/../config/database.php'; // 기존 DB 연결 설정
require_once __DIR__ . '/MessageRelay.php'; // 인증된 메시지 변경 중계
use Ratchet\Http\HttpServer; // HTTP 업그레이드 처리
use Ratchet\Server\IoServer; // Ratchet 서버
use Ratchet\WebSocket\WsServer; // WebSocket 프레임 처리
use React\EventLoop\Loop; // 단일 이벤트 루프
use React\Socket\SocketServer; // TCP 수신 소켓
try // 설정과 서버의 안전한 시작
{
    $listenHost = getenv('REALTIME_LISTEN_HOST') ?: '127.0.0.6'; // 기본 로컬 수신 주소
    $listenPort = getenv('REALTIME_LISTEN_PORT') ?: '8090'; // 기본 실시간 포트
    $allowedOrigin = getenv('REALTIME_ALLOWED_ORIGIN') ?: 'http://127.0.0.6:8088'; // 명시된 브라우저 출처
    if (filter_var($listenHost, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false || !str_starts_with($listenHost, '127.') || !preg_match('/\A[0-9]{1,5}\z/D', $listenPort) || (int) $listenPort < 1 || (int) $listenPort > 65535 || !preg_match('/\Ahttps?:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?\z/D', $allowedOrigin)) // 수신과 출처 설정 형식 검사
    {
        throw new RuntimeException('Invalid realtime configuration.'); // 잘못된 실행 설정 차단
    }
    $relay = new MessageRelay(db(), $allowedOrigin); // 실제 DB와 허용 출처 연결
    $loop = Loop::get(); // React 공통 이벤트 루프
    $socket = new SocketServer($listenHost . ':' . $listenPort, [], $loop); // 지정 주소 수신
    $server = new IoServer(new HttpServer(new WsServer($relay)), $socket, $loop); // HTTP와 WebSocket 처리 결합
    $loop->addPeriodicTimer(0.5, static function () use ($relay): void // 주기적인 권한과 변경 확인
    {
        $relay->tick(); // 활성 구독 갱신
    }); // 감시 타이머 등록
    $server->run(); // 실시간 서버 대기
}
catch (Throwable $exception) // 설정과 실행 실패의 안전한 종료
{
    error_log('Realtime server unavailable.'); // 자격 증명 없는 진단
    exit(1); // 실패 상태 반환
}
