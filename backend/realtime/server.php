<?php // 로컬 실시간 알림 서버 실행

declare(strict_types=1); // 엄격한 자료형 검사
ini_set('display_errors', '0'); // 내부 오류의 화면 노출 차단
error_reporting(E_ALL); // 전체 오류 감지
require_once __DIR__ . '/../config/database.php'; // 기존 DB 연결 설정
require_once __DIR__ . '/MessageRelay.php'; // 인증된 메시지 변경 중계
require_once __DIR__ . '/../includes/deployment.php'; // 수신과 공개 출처 검증
require_once __DIR__ . '/BoundedWsServer.php'; // 프레임 크기와 수신 시간 제한
use Ratchet\Http\HttpServer; // HTTP 업그레이드 처리
use Ratchet\Server\IoServer; // Ratchet 서버
use React\EventLoop\Loop; // 단일 이벤트 루프
use React\Socket\SocketServer; // TCP 수신 소켓
try // 설정과 서버의 안전한 시작
{
    $configuration = realtime_configuration(); // 검증된 수신 설정
    $listenHost = $configuration['host']; // 승인된 수신 주소
    $listenPort = $configuration['port']; // 승인된 수신 포트
    $allowedOrigin = $configuration['origin']; // 정확한 브라우저 출처
    $relay = new MessageRelay(db(), $allowedOrigin); // 실제 DB와 허용 출처 연결
    $loop = Loop::get(); // React 공통 이벤트 루프
    $socket = new SocketServer($listenHost . ':' . $listenPort, [], $loop); // 지정 주소 수신
    $wsServer = new BoundedWsServer($relay); // 제한형 WebSocket 처리
    $wsServer->enableKeepAlive($loop, 30); // 유휴 프록시 연결과 응답 검사
    $server = new IoServer(new HttpServer($wsServer), $socket, $loop); // HTTP와 WebSocket 처리 결합
    $loop->addPeriodicTimer(0.5, static function () use ($relay, $wsServer): void // 주기적인 권한과 변경 확인
    {
        $wsServer->expirePartialMessages(); // 느린 수신 연결 정리
        $relay->tick(); // 활성 구독 갱신
    });
    $loop->addPeriodicTimer(5, static function (): void // 장기 실행 DB 연결 감시
    {
        db()->query('SELECT 1')->fetchColumn(); // 실패 시 바깥 예외 처리와 재시작
    });
    $server->run(); // 실시간 서버 대기
}
catch (Throwable $exception) // 설정과 실행 실패의 안전한 종료
{
    error_log('Realtime server unavailable.'); // 자격 증명 없는 진단
    exit(1); // 실패 상태 반환
}
