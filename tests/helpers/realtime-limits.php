<?php // 실제 Ratchet 프레임 제한 검사
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../../backend/realtime/BoundedWsServer.php'; // 검사 대상 서버
use Ratchet\ConnectionInterface; // 연결 계약
use Ratchet\MessageComponentInterface; // 메시지 계약
use Ratchet\RFC6455\Messaging\Frame; // 실제 마스킹 프레임
use GuzzleHttp\Psr7\Request; // 실제 업그레이드 요청
#[AllowDynamicProperties] // Ratchet 연결 속성 허용
final class LimitTestConnection implements ConnectionInterface // 전송 경계 대체
{
    public bool $closed = false; // 연결 종료 상태
    public function send($data): self // 서버 응답 경계
    {
        return $this; // 체인 계약 유지
    }
    public function close(): void // 연결 종료 경계
    {
        $this->closed = true; // 종료 기록
    }
}
final class LimitTestComponent implements MessageComponentInterface // 수신 확인 경계
{
    public array $received = []; // 승인된 메시지 목록
    public function onOpen(ConnectionInterface $connection): void // 연결 승인 경계
    {
    }
    public function onMessage(ConnectionInterface $connection, $message): void // 완성 메시지 수신
    {
        $this->received[] = $message; // 본문 기록
    }
    public function onClose(ConnectionInterface $connection): void // 연결 정리 경계
    {
    }
    public function onError(ConnectionInterface $connection, Exception $exception): void // 오류 경계
    {
        $connection->close(); // 오류 연결 종료
    }
}
function limit_test_frame(string $payload, bool $final = true, int $opcode = 1): string // 실제 클라이언트 프레임
{
    $frame = new Frame($payload, $final, $opcode); // 표준 프레임 생성
    $frame->maskPayload(); // 브라우저 마스킹 적용
    return $frame->getContents(); // 실제 전송 바이트
}
function limit_test_server(): array // 독립 프로토콜 준비
{
    $component = new LimitTestComponent(); // 독립 수신 상태
    $server = new BoundedWsServer($component); // 제한형 실제 서버
    $connection = new LimitTestConnection(); // 독립 연결
    $request = new Request('GET', '/Team006/realtime', ['Host' => 'chat.example.com', 'Upgrade' => 'websocket', 'Connection' => 'Upgrade', 'Sec-WebSocket-Key' => base64_encode(random_bytes(16)), 'Sec-WebSocket-Version' => '13']); // 표준 업그레이드
    $server->onOpen($connection, $request); // 실제 협상과 버퍼 생성
    return [$server, $connection, $component]; // 검사 경계 반환
}
[$normalServer, $normalConnection, $normalComponent] = limit_test_server(); // 정상 연결 준비
$normalServer->onMessage($normalConnection, limit_test_frame('hello')); // 정상 프레임 입력
[$largeServer, $largeConnection] = limit_test_server(); // 큰 프레임 준비
$largeServer->onMessage($largeConnection, substr(limit_test_frame(str_repeat('x', 1025)), 0, 140)); // 본문 완성 전 상한 거절
[$fragmentServer, $fragmentConnection] = limit_test_server(); // 분할 수신 준비
$fragmentServer->onMessage($fragmentConnection, limit_test_frame(str_repeat('x', 600), false)); // 첫 분할 수신
$fragmentServer->onMessage($fragmentConnection, limit_test_frame(str_repeat('y', 600), true, 0)); // 누적 상한 초과
[$slowServer, $slowConnection] = limit_test_server(); // 느린 연결 준비
$slowServer->onMessage($slowConnection, substr(limit_test_frame('hello'), 0, 1)); // 미완성 프레임 수신
$slowServer->expirePartialMessages(microtime(true) + 11); // 수신 마감 경과
[$emptyServer, $emptyConnection] = limit_test_server(); // 빈 분할 반복 준비
$emptyServer->onMessage($emptyConnection, limit_test_frame('', false)); // 첫 빈 분할 수신
for ($fragmentIndex = 0; $fragmentIndex < 64 && !$emptyConnection->closed; $fragmentIndex++) // 바이트 상한을 피하는 연속 분할
{
    $emptyServer->onMessage($emptyConnection, limit_test_frame('', false, 0)); // 빈 continuation 입력
}
echo json_encode(['normal' => $normalComponent->received === ['hello'] && !$normalConnection->closed, 'large' => $largeConnection->closed, 'fragmented' => $fragmentConnection->closed, 'slow' => $slowConnection->closed, 'emptyFragments' => $emptyConnection->closed]); // 결과 출력
