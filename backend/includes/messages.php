<?php // 메시지 입력과 원자적 저장 처리
declare(strict_types=1); // 엄격한 자료형 검사
final class MessageAccessException extends RuntimeException // 롤백 이후 응답용 권한 오류
{
}
function validate_message_content(mixed $value): string // 원문 메시지 내용 검증
{
    $content = validate_string($value, 'content', 1, 2000); // UTF-8 코드 포인트와 NUL 검사
    if (preg_match('/\A[\p{Z}\x{0009}-\x{000D}\x{0085}\x{FEFF}]*\z/uD', $content) === 1) // 유니코드 공백과 BOM 전용 내용
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['content' => '공백 외의 내용을 입력하세요.']); // 빈 의미의 메시지 거절
    }
    return $content; // 공백과 개행을 유지한 원문
}
function public_message(array $row): array // 비밀 없는 메시지 응답 변환
{
    return [ // 공개 필드만 반환
        'id' => (string) $row['id'], // 메시지 식별자 문자열
        'channel_id' => (string) $row['channel_id'], // 채널 식별자 문자열
        'user_id' => (string) $row['user_id'], // 작성자 식별자 문자열
        'username' => $row['username'], // 현재 고유 사용자명
        'content' => $row['content'], // HTML 변환 없는 원문
        'created_at' => (new DateTimeImmutable($row['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z') // UTC ISO 저장 시각
    ]; // 공개 메시지 객체 종료
}
function store_message(PDO $pdo, string $channel_id, string $user_id, string $content): array // 채널 순서와 멤버십을 보장한 저장
{
    if ($pdo->inTransaction()) // 중첩 트랜잭션 오용 검사
    {
        throw new LogicException('Message transaction already active.'); // 호출 경계 오류
    }
    for ($attempt = 0; $attempt < 3; $attempt++) // 최초 시도와 최대 두 번 재시도
    {
        try // 권한 확인부터 공개 조회까지 원자적 실행
        {
            $pdo->beginTransaction(); // 전체 전송 트랜잭션 시작
            $channel_query = $pdo->prepare('SELECT id, server_id FROM channels WHERE id = :id LIMIT 1 FOR UPDATE'); // ID 발급 전 채널 배타 잠금
            $channel_query->execute(['id' => $channel_id]); // 요청 채널 잠금 취득
            $channel = $channel_query->fetch(); // 현재 채널과 서버
            if ($channel === false) // 채널 없음 검사
            {
                throw new MessageAccessException('CHANNEL_NOT_FOUND', 404); // 롤백 후 존재 오류
            }
            $member_query = $pdo->prepare('SELECT user_id FROM server_members WHERE server_id = :server_id AND user_id = :user_id LIMIT 1 FOR SHARE'); // 탈퇴와 강퇴를 막는 멤버십 공유 잠금
            $member_query->execute(['server_id' => (string) $channel['server_id'], 'user_id' => $user_id]); // 세션 사용자의 현재 소속 검사
            if ($member_query->fetchColumn() === false) // 현재 멤버십 없음 검사
            {
                throw new MessageAccessException('FORBIDDEN', 403); // 롤백 후 소속 오류
            }
            $insert = $pdo->prepare('INSERT INTO messages (channel_id, user_id, content) VALUES (:channel_id, :user_id, :content)'); // 원문 저장용 준비된 INSERT
            $insert->execute(['channel_id' => $channel_id, 'user_id' => $user_id, 'content' => $content]); // 인증된 작성자와 원문 저장
            $id = $pdo->lastInsertId(); // 정수 변환 없는 생성 ID
            $query = $pdo->prepare('SELECT m.id, m.channel_id, m.user_id, u.username, m.content, m.created_at FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = :id'); // 공개 필드와 현재 사용자명 조회
            $query->execute(['id' => $id]); // 저장된 실제 메시지 조회
            $row = $query->fetch(); // 공개 메시지 원본
            if ($row === false) // 저장 결과 누락 검사
            {
                throw new RuntimeException('Stored message unavailable.'); // 전체 작업 롤백 대상
            }
            $message = public_message($row); // 커밋 전 응답 형식 검증
            $pdo->commit(); // 채널과 멤버십 잠금 해제
            return $message; // 커밋된 메시지만 반환
        }
        catch (Throwable $exception) // 권한 오류와 모든 내부 실패
        {
            if ($pdo->inTransaction()) // 시간 초과 이후 남은 트랜잭션
            {
                $pdo->rollBack(); // 부분 작업과 전체 잠금 해제
            }
            if ($exception instanceof PDOException && in_array((int) ($exception->errorInfo[1] ?? 0), [1205, 1213], true) && $attempt < 2) // 잠금 시간 초과와 교착의 제한된 재시도
            {
                usleep(random_int(10000, 30000)); // 재충돌 완화용 짧은 대기
                continue; // 새 트랜잭션에서 권한부터 재검사
            }
            throw $exception; // 롤백 이후 호출자 오류 처리
        }
    }
    throw new LogicException('Message retry exhausted.'); // 도달 불가 방어 경계
}
