<?php // 제한된 WebSocket 수신 버퍼
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/vendor/autoload.php'; // 잠금 파일의 외부 의존성
use Ratchet\ConnectionInterface; // TCP 연결 계약
use Ratchet\MessageComponentInterface; // 메시지 수신 계약
use Ratchet\WebSocket\WsServer; // 기존 협상과 연결 관리
use Ratchet\RFC6455\Messaging\MessageBuffer; // 표준 프레임 검사
use Ratchet\RFC6455\Messaging\CloseFrameChecker; // 종료 코드 검사
use Ratchet\RFC6455\Messaging\MessageInterface; // 완성 메시지 계약
use Ratchet\RFC6455\Messaging\FrameInterface; // 제어 프레임 계약
use Psr\Http\Message\RequestInterface; // 업그레이드 요청 계약
final class BoundedWsServer extends WsServer // 기존 Ratchet의 제한형 어댑터
{
    private SplObjectStorage $readStates; // 연결별 미완성 수신 상태
    public function __construct(private MessageComponentInterface $relayComponent) // 기존 릴레이 연결
    {
        parent::__construct($relayComponent); // 표준 업그레이드와 종료 처리
        $this->readStates = new SplObjectStorage(); // 수신 상태 준비
    }
    public function onOpen(ConnectionInterface $connection, ?RequestInterface $request = null) // 기존 협상 후 버퍼 제한
    {
        parent::onOpen($connection, $request); // 기존 핸드셰이크와 인증 실행
        if (!$this->connections->contains($connection) || $connection->WebSocket->closing) // 실패하거나 종료된 연결
        {
            return; // 미승인 연결 처리 중단
        }
        $context = $this->connections[$connection]; // Ratchet 0.4.4 연결 맥락
        $wsConnection = $context->connection; // 기존 WebSocket 래퍼
        $context->buffer = new MessageBuffer(new CloseFrameChecker(), function (MessageInterface $message) use ($wsConnection): void // 제한형 표준 메시지 버퍼
        {
            $this->relayComponent->onMessage($wsConnection, $message->getPayload()); // 기존 인증과 구독 검사
        }, function (FrameInterface $frame) use ($wsConnection): void // 표준 제어 프레임 전달
        {
            $this->onControlFrame($frame, $wsConnection); // ping과 종료 처리 유지
        }, true, null, 1024, 1024); // 마스킹과 메시지·프레임 상한
        $this->readStates->attach($connection, ['bytes' => '', 'fragmented' => false, 'fragments' => 0, 'since' => null]); // 독립 수신 마감 상태
    }
    public function onMessage(ConnectionInterface $connection, $message) // 수신 시간과 버퍼 상한 검사
    {
        if (!$this->readStates->contains($connection) || $connection->WebSocket->closing) // 종료 또는 미승인 연결
        {
            return; // 추가 수신 차단
        }
        $state = $this->readStates[$connection]; // 현재 미완성 상태
        $state['since'] ??= microtime(true); // 첫 미완성 바이트 시각
        $state['bytes'] .= (string) $message; // 수신 조각 결합
        while (strlen($state['bytes']) >= 2) // 완성 가능한 프레임 경계 순회
        {
            $sizeCode = ord($state['bytes'][1]) & 127; // 프레임 길이 구분
            $lengthBytes = $sizeCode === 126 ? 2 : ($sizeCode === 127 ? 8 : 0); // 확장 길이 바이트 수
            $headerSize = 2 + $lengthBytes + ((ord($state['bytes'][1]) & 128) !== 0 ? 4 : 0); // 마스킹 포함 헤더 길이
            if (strlen($state['bytes']) < $headerSize) // 미완성 헤더 여부
            {
                break; // 다음 조각 대기
            }
            $payloadSize = $lengthBytes === 0 ? $sizeCode : unpack($lengthBytes === 2 ? 'n' : 'J', substr($state['bytes'], 2, $lengthBytes))[1]; // 선언된 본문 길이
            if ($payloadSize < 0 || $payloadSize > 1024) // 큰 프레임의 조기 거절
            {
                $connection->close(); // 본문 전체 수신 전 종료
                return; // 버퍼 누적 차단
            }
            if (strlen($state['bytes']) < $headerSize + $payloadSize) // 미완성 본문 여부
            {
                break; // 원래 마감 시각으로 대기
            }
            $opcode = ord($state['bytes'][0]) & 15; // 프레임 종류
            if ($opcode < 8) // 데이터 또는 분할 프레임 여부
            {
                $state['fragments'] += 1; // 빈 분할도 포함한 프레임 수
                if ($state['fragments'] > 64) // 페이로드 없는 분할 누적 상한
                {
                    $connection->close(); // 프레임 객체의 무제한 누적 차단
                    return; // 표준 버퍼 전달 중단
                }
                $state['fragmented'] = (ord($state['bytes'][0]) & 128) === 0; // 마지막 분할 여부
                if (!$state['fragmented']) // 완성된 메시지 여부
                {
                    $state['fragments'] = 0; // 다음 메시지의 독립 상한
                }
            }
            $state['bytes'] = substr($state['bytes'], $headerSize + $payloadSize); // 완료 프레임 경계 제거
        }
        if ($state['bytes'] === '' && !$state['fragmented']) // 메시지 수신 완료 여부
        {
            $state['since'] = null; // 유휴 연결과 미완성 수신 구분
        }
        $this->readStates[$connection] = $state; // 연결별 경계와 마감 보관
        parent::onMessage($connection, $message); // 표준 프로토콜·분할 누적 상한 검사
    }
    public function expirePartialMessages(?float $now = null): void // 미완성 수신 시간 제한
    {
        $now ??= microtime(true); // 실제 감시 시각
        foreach ($this->readStates as $connection) // 활성 수신 상태 순회
        {
            $since = $this->readStates[$connection]['since']; // 최초 미완성 시각
            if ($since !== null && $now - $since >= 10) // 수신 마감 경과 여부
            {
                $connection->close(); // 느린 분할 수신 종료
            }
        }
    }
    public function onClose(ConnectionInterface $connection) // 연결 상태 정리
    {
        if ($this->readStates->contains($connection)) // 등록된 수신 상태 여부
        {
            $this->readStates->detach($connection); // 미완성 데이터 폐기
        }
        parent::onClose($connection); // 기존 구독과 인증 정리
    }
}
