<?php // 첨부 파일 권한과 공개 정보
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/direct_messages.php'; // 개인 대화 권한 검사
function attachment_access(PDO $databaseConnection, string $kind, string $targetId, string $userId, bool $forWrite): void // 대화 권한과 잠금
{
    if ($kind === 'direct') // 개인 대화 여부
    {
        direct_access($databaseConnection, $targetId, $userId, $forWrite); // 참여자와 차단 확인
        return; // 개인 대화 검사 종료
    }
    $channelQuery = $databaseConnection->prepare('SELECT server_id FROM channels WHERE id = :id ' . ($forWrite ? 'FOR UPDATE' : 'FOR SHARE')); // 채널 잠금
    $channelQuery->execute(['id' => $targetId]); // 대상 채널 확인
    $serverId = $channelQuery->fetchColumn(); // 소속 서버 식별자
    if ($serverId === false) // 채널 존재 여부
    {
        throw new MessageAccessException('CHANNEL_NOT_FOUND', 404); // 없는 채널
    }
    $memberQuery = $databaseConnection->prepare('SELECT user_id FROM server_members WHERE server_id = :server AND user_id = :user FOR SHARE'); // 소속 잠금
    $memberQuery->execute(['server' => $serverId, 'user' => $userId]); // 현재 회원 확인
    if ($memberQuery->fetchColumn() === false) // 소속 여부
    {
        throw new MessageAccessException('FORBIDDEN', 403); // 외부 접근 차단
    }
}
function attachment_public(array $row): array // 첨부 공개 필드
{
    return ['id' => (string) $row['id'], 'message_id' => (string) $row['message_id'], 'original_name' => $row['original_name'], 'file_size' => (int) $row['file_size']]; // 파일 내용 제외
}
function attachment_failure(Throwable $caughtException): never // 트랜잭션 종료 후 권한 오류
{
    if ($caughtException instanceof MessageAccessException || $caughtException instanceof DirectAccessException) // 권한 오류 여부
    {
        respond_error($caughtException->getMessage(), '대화에 접근할 수 없습니다.', $caughtException->getCode()); // 구체적인 내부 정보 비공개
    }
    throw $caughtException; // 나머지 내부 오류 전달
}
