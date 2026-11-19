<?php // 실제 구독 한 주기의 MySQL 조회 횟수 검사
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../../backend/config/database.php'; // 검사 전용 DB 연결
require_once __DIR__ . '/../../backend/realtime/MessageRelay.php'; // 실제 인증과 구독 처리
$input = json_decode(stream_get_contents(STDIN), true, 8, JSON_THROW_ON_ERROR); // 검사 세션과 구독 대상
$connection = new class implements Ratchet\ConnectionInterface // 전송된 알림만 기록할 연결
{
    public GuzzleHttp\Psr7\Request $httpRequest; // 실제 형식의 연결 요청
    public array $events = []; // 구독과 전달 결과
    public function send($data) // 연결로 보낸 메시지 기록
    {
        $this->events[] = json_decode($data, true, 4, JSON_THROW_ON_ERROR)['type']; // 알림 종류 보관
        return $this; // 연결 반환
    }
    public function close() // 인증 종료 기록
    {
        $this->events[] = 'closed'; // 닫힘 상태 보관
    }
};
$origin = 'http://127.0.0.6:8088'; // 검사 웹 출처
$connection->httpRequest = new GuzzleHttp\Psr7\Request('GET', $origin . '/Team006/realtime', ['Origin' => $origin, 'Cookie' => $input['cookie']]); // 로그인한 계정의 요청
$databaseConnection = db(); // 같은 MySQL 연결의 통계 사용
$relay = new MessageRelay($databaseConnection, $origin); // 실제 중계기 준비
$relay->onOpen($connection); // 세션 인증
$relay->onMessage($connection, json_encode($input['subscription'], JSON_THROW_ON_ERROR)); // 권한 있는 대화 구독
$countSelects = static fn(): int => (int) $databaseConnection->query("SHOW SESSION STATUS LIKE 'Com_select'")->fetchColumn(1); // 현재 연결의 SELECT 누계
$before = $countSelects(); // 구독 승인 후 기준값
$relay->tick(); // 메시지 한 개가 있는 대상 검사
echo json_encode(['events' => $connection->events, 'selects' => $countSelects() - $before], JSON_THROW_ON_ERROR); // 인증 결과와 조회 횟수
