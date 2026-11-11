<?php // 실시간 메시지 변경 알림

declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/vendor/autoload.php'; // Ratchet 자동 로더
require_once __DIR__ . '/../includes/session.php'; // 기존 보안 세션
require_once __DIR__ . '/../includes/request.php'; // 기존 식별자 검증
require_once __DIR__ . '/../includes/auth.php'; // 기존 인증 수명 검증
use Ratchet\ConnectionInterface; // 연결 인터페이스
use Ratchet\MessageComponentInterface; // 메시지 처리 인터페이스
function realtime_compare_ids(string $left, string $right): int // 정수 변환 없는 커서 비교
{
    $lengthOrder = strlen($left) <=> strlen($right); // 자릿수 비교
    return $lengthOrder !== 0 ? $lengthOrder : (strcmp($left, $right) <=> 0); // 정규 십진수 순서 반환
}
final class MessageRelay implements MessageComponentInterface // 연결별 최소 알림 중계
{
    private SplObjectStorage $connections; // 인증 연결 저장소
    public function __construct(private PDO $databaseConnection, private string $allowedOrigin) // 연결 설정
    {
        $this->connections = new SplObjectStorage(); // 독립 연결 상태 준비
    }
    private function authenticatedUser(string $sessionId): ?array // 기존 세션 상태 재검사
    {
        if (session_status() === PHP_SESSION_ACTIVE) // 잘못된 세션 중첩 검사
        {
            throw new RuntimeException('Session already active.'); // 다른 연결 정보 혼합 차단
        }
        session_id($sessionId); // 브라우저의 실제 세션 식별자 선택
        try // 세션 잠금 해제 보장
        {
            start_secure_session(); // 기존 보안 설정과 엄격 모드 적용
            if (!hash_equals($sessionId, session_id())) // 삭제되거나 미발급된 식별자 검사
            {
                return null; // 새 임시 세션의 인증 차단
            }
            return current_user($this->databaseConnection, false); // 활동 갱신 없는 만료와 계정 확인
        }
        finally // 모든 인증 분기의 잠금 해제
        {
            close_session(); // 다른 HTTP 요청과 연결의 대기 해제
        }
    }
    private function latestForMember(string $channelId, string $userId): ?string // 현재 소속과 채널 최신 커서
    {
        $query = $this->databaseConnection->prepare('SELECT COALESCE((SELECT id FROM messages WHERE channel_id = c.id ORDER BY id DESC LIMIT 1), 0) AS latest_id FROM channels c INNER JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = :user_id WHERE c.id = :channel_id LIMIT 1'); // 채널과 현재 멤버십의 한 번에 조회
        $query->execute(['user_id' => $userId, 'channel_id' => $channelId]); // 인증된 사용자와 채널 결합
        $latest = $query->fetchColumn(); // 최신 ID 또는 접근 불가
        return $latest === false ? null : (string) $latest; // 접근 불가와 빈 채널 구분
    }
    private function latestForDirectMember(string $conversationId, string $userId): ?string // 참여 관계와 개인 대화 최신 커서
    {
        $query = $this->databaseConnection->prepare('SELECT COALESCE((SELECT id FROM direct_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1), 0) AS latest_id FROM direct_conversations c WHERE c.id = :conversation_id AND (c.user_a_id = :user_a OR c.user_b_id = :user_b) LIMIT 1'); // 대화 참여자와 최신 메시지 확인
        $query->execute(['conversation_id' => $conversationId, 'user_a' => $userId, 'user_b' => $userId]); // 인증된 참여자 연결
        $latest = $query->fetchColumn(); // 최신 ID 또는 접근 불가
        return $latest === false ? null : (string) $latest; // 접근 불가와 빈 대화 구분
    }
    private function isAuthenticated(array $connectionState): bool // 원래 계정 유지 검사
    {
        $user = $this->authenticatedUser($connectionState['session_id']); // 실제 세션 재조회
        return $user !== null && hash_equals($connectionState['user_id'], $user['id']); // 로그아웃과 계정 변경 차단
    }
    public function onOpen(ConnectionInterface $connection): void // 최초 접속 검사
    {
        try // 잘못된 접속의 안전한 종료
        {
            $request = $connection->httpRequest; // 실제 업그레이드 요청
            $origins = $request->getHeader('Origin'); // 중복을 보존한 출처 헤더
            if (count($origins) !== 1 || !hash_equals($this->allowedOrigin, $origins[0]) || $request->getUri()->getPath() !== '/Team006/realtime' || count($this->connections) >= 256) // 명시 출처와 연결 수 제한
            {
                $connection->close(); // 허용되지 않은 접속 차단
                return; // 처리 종료
            }
            $cookies = $request->getHeaderLine('Cookie'); // 브라우저 쿠키 원문
            preg_match_all('/(?:^|;\s*)systemmakers_session=([a-zA-Z0-9,-]{1,128})(?=;|$)/', $cookies, $matches); // 유효한 세션 쿠키 추출
            if (count($matches[1]) !== 1) // 누락과 중복 쿠키 차단
            {
                $connection->close(); // 인증 없는 접속 종료
                return; // 처리 종료
            }
            $sessionId = $matches[1][0]; // 원래 브라우저 세션 ID
            $user = $this->authenticatedUser($sessionId); // 기존 인증 검사
            if ($user === null) // 비로그인과 만료 세션
            {
                $connection->close(); // 인증 실패 종료
                return; // 처리 종료
            }
            $this->connections->attach($connection, ['session_id' => $sessionId, 'user_id' => $user['id'], 'channel_id' => null, 'conversation_id' => null, 'cursor' => '0', 'opened_at' => time(), 'message_at' => 0.0]); // 연결별 인증과 구독 상태
        }
        catch (Throwable $exception) // 내부 오류의 비공개 처리
        {
            $connection->close(); // 오류 연결 종료
        }
    }
    public function onMessage(ConnectionInterface $connection, $message): void // 단일 채널 구독 요청
    {
        try // 잘못된 요청과 내부 오류 차단
        {
            if (!$this->connections->contains($connection)) // 미인증 연결 검사
            {
                $connection->close(); // 등록되지 않은 연결 종료
                return; // 처리 종료
            }
            $state = $this->connections[$connection]; // 현재 연결 상태
            $now = microtime(true); // 요청 제한 기준 시각
            if ($now - $state['message_at'] < 0.1 || strlen((string) $message) > 1024) // 과도한 요청과 큰 프레임 차단
            {
                $connection->close(); // 비정상 연결 종료
                return; // 처리 종료
            }
            $state['message_at'] = $now; // 마지막 요청 시각 기록
            $request = json_decode((string) $message, true, 8, JSON_THROW_ON_ERROR); // 제한된 JSON 해석
            $isChannel = is_array($request) && ($request['type'] ?? null) === 'subscribe' && valid_id($request['channel_id'] ?? null); // 채널 구독 형식
            $isDirect = is_array($request) && ($request['type'] ?? null) === 'subscribe_direct' && valid_id($request['conversation_id'] ?? null); // 개인 대화 구독 형식
            if (!is_array($request) || count($request) !== 3 || (!$isChannel && !$isDirect) || !valid_id($request['after_id'] ?? null, true) || !$this->isAuthenticated($state)) // 정확한 구독 형식과 현재 인증
            {
                $connection->close(); // 위조와 잘못된 입력 차단
                return; // 처리 종료
            }
            $latest = $isDirect ? $this->latestForDirectMember($request['conversation_id'], $state['user_id']) : $this->latestForMember($request['channel_id'], $state['user_id']); // 현재 참여 권한 검사
            if ($latest === null) // 삭제 채널과 미소속 사용자
            {
                $connection->close(); // 권한 없는 구독 차단
                return; // 처리 종료
            }
            $state['channel_id'] = $isChannel ? $request['channel_id'] : null; // 승인된 채널 저장
            $state['conversation_id'] = $isDirect ? $request['conversation_id'] : null; // 승인된 개인 대화 저장
            $state['cursor'] = realtime_compare_ids($request['after_id'], $latest) > 0 ? $latest : $request['after_id']; // 미래 커서로 인한 누락 방지
            $this->connections[$connection] = $state; // 검증된 구독 반영
            $connection->send('{"type":"subscribed"}'); // 구독 승인 확인
        }
        catch (Throwable $exception) // 오류 내용과 자격 정보 비노출
        {
            $connection->close(); // 실패 연결 종료
        }
    }
    public function tick(): void // 인증과 메시지 변경 확인
    {
        foreach (iterator_to_array($this->connections) as $connection) // 연결 변경에 안전한 복사본 순회
        {
            try // 연결 하나의 오류 격리
            {
                if (!$this->connections->contains($connection)) // 이미 종료된 연결 검사
                {
                    continue; // 다음 연결 검사
                }
                $state = $this->connections[$connection]; // 연결별 승인 상태
                if (!$this->isAuthenticated($state) || ($state['channel_id'] === null && $state['conversation_id'] === null && time() - $state['opened_at'] >= 15)) // 인증 폐기와 구독 지연 검사
                {
                    $connection->close(); // 만료 연결 종료
                    continue; // 다음 연결 검사
                }
                if ($state['channel_id'] === null && $state['conversation_id'] === null) // 아직 구독하지 않은 연결
                {
                    continue; // 채널 정보 조회 생략
                }
                $latest = $state['conversation_id'] !== null ? $this->latestForDirectMember($state['conversation_id'], $state['user_id']) : $this->latestForMember($state['channel_id'], $state['user_id']); // 알림 직전 참여 권한 검사
                if ($latest === null) // 채널 또는 멤버십 제거
                {
                    $connection->close(); // 권한 상실 연결 종료
                    continue; // 다음 연결 검사
                }
                if (realtime_compare_ids($latest, $state['cursor']) > 0) // 승인된 채널의 신규 메시지
                {
                    $connection->send('{"type":"message.created"}'); // 내용과 식별자 없는 변경 알림
                    $state['cursor'] = $latest; // 알림 범위의 단조 증가 커서
                    $this->connections[$connection] = $state; // 다음 감시 기준 반영
                }
            }
            catch (Throwable $exception) // 세션과 DB 오류의 안전한 격리
            {
                $connection->close(); // 불확실한 권한의 연결 종료
            }
        }
    }
    public function onClose(ConnectionInterface $connection): void // 접속 종료 정리
    {
        if ($this->connections->contains($connection)) // 등록된 연결 여부
        {
            $this->connections->detach($connection); // 인증 상태와 구독 제거
        }
    }
    public function onError(ConnectionInterface $connection, Exception $exception): void // 전송 오류 처리
    {
        $connection->close(); // 오류 내용 비노출과 연결 종료
    }
}
