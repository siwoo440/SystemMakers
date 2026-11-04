<?php // 채널과 서버 멤버십 확인
declare(strict_types=1); // 엄격한 자료형 검사
function require_channel_member(PDO $databaseConnection, string $channelId, string $userId): array // 인증된 사용자 채널 권한
{
    if (!valid_id($channelId) || !valid_id($userId)) // 내부 전달 ID 계약
    {
        throw new InvalidArgumentException('Invalid internal identifier.'); // 내부 호출 오류
    }
    $channelQuery = $databaseConnection->prepare('SELECT id, server_id FROM channels WHERE id = :id LIMIT 1'); // 채널 존재 조회
    $channelQuery->bindValue(':id', $channelId, PDO::PARAM_STR); // 채널 문자열 식별자
    $channelQuery->execute(); // 실제 채널 조회
    $channelRecord = $channelQuery->fetch(); // 채널과 소속 서버
    if ($channelRecord === false) // 없는 채널 여부
    {
        respond_error('CHANNEL_NOT_FOUND', '채널을 찾을 수 없습니다.', 404); // 존재 오류 구분
    }
    $memberQuery = $databaseConnection->prepare('SELECT 1 FROM server_members WHERE server_id = :server_id AND user_id = :user_id LIMIT 1'); // 실제 서버 소속 조회
    $memberQuery->bindValue(':server_id', (string) $channelRecord['server_id'], PDO::PARAM_STR); // 소속 서버 식별자
    $memberQuery->bindValue(':user_id', $userId, PDO::PARAM_STR); // 인증된 사용자 식별자
    $memberQuery->execute(); // 멤버십 조회 실행
    if ($memberQuery->fetchColumn() === false) // 소속 회원 여부
    {
        respond_error('FORBIDDEN', '채널에 접근할 수 없습니다.', 403); // 비회원 접근 거절
    }
    return ['id' => (string) $channelRecord['id'], 'server_id' => (string) $channelRecord['server_id']]; // 문자열 채널 정보 반환
}
