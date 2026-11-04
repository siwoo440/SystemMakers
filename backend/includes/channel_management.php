<?php // 채널 생성·이름 변경·삭제 업무
declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/server_management.php'; // 공통 역할과 트랜잭션
function run_channel_management(PDO $databaseConnection, string $operation, string $userId, array $requestInput): array // 검증한 관리 요청 실행
{
    return management_transaction($databaseConnection, function () use ($databaseConnection, $operation, $userId, $requestInput): array // 현재 권한과 변경의 원자성
    {
        $channelRecord = null; // 생성과 기존 채널 구분
        $serverId = $requestInput['server_id'] ?? null; // 생성할 서버
        if ($operation !== 'create_channel') // 변경 대상의 부모 후보 조회
        {
            $databaseQuery = $databaseConnection->prepare('SELECT server_id FROM channels WHERE id=:id'); // 잠금 순서 전 부모 후보
            $databaseQuery->execute(['id' => $requestInput['channel_id']]); // 문자열 채널 ID
            $serverId = $databaseQuery->fetchColumn(); // 후보 서버
            if ($serverId === false) // 없는 채널
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 존재 오류
            }
        }
        $serverRecord = management_server($databaseConnection, (string) $serverId); // 서버 우선 잠금
        if ($operation !== 'create_channel') // 부모 다음 실제 채널 잠금
        {
            $databaseQuery = $databaseConnection->prepare('SELECT id, server_id, name FROM channels WHERE id=:id FOR UPDATE'); // 현재 채널 재확인
            $databaseQuery->execute(['id' => $requestInput['channel_id']]); // 대상 채널만 잠금
            $channelRecord = $databaseQuery->fetch(); // 현재 자원
            if ($channelRecord === false || (string) $channelRecord['server_id'] !== (string) $serverRecord['id']) // 후보 조회 뒤 삭제·부모 불일치
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 오래된 대상 사용 차단
            }
        }
        $memberRole = management_actor($databaseConnection, $serverRecord, $userId); // 잠금 뒤 현재 역할 재검사
        if (!in_array($memberRole, ['owner', 'admin'], true)) // 관리자와 소유자만 허용
        {
            throw new ManagementException('FORBIDDEN', 403); // 일반 회원 관리 차단
        }
        if ($operation === 'delete_channel') // 이름 확인 뒤 영구 삭제
        {
            if (!hash_equals($channelRecord['name'], $requestInput['confirm_name'])) // 정확한 현재 이름
            {
                throw new ManagementException('NAME_MISMATCH', 409); // 최신 영향 재확인
            }
            $databaseQuery = $databaseConnection->prepare('DELETE FROM channels WHERE id=:id'); // 메시지 CASCADE
            $databaseQuery->execute(['id' => $channelRecord['id']]); // 같은 서버의 다른 자료 보존
            return ['data' => ['channel_id' => (string) $channelRecord['id'], 'deleted' => true], 'status' => 200]; // 마지막 채널도 삭제 허용
        }
        try // 기존 고유 키로 동시 중복 차단
        {
            if ($operation === 'create_channel') // 새 채널 생성
            {
                $databaseQuery = $databaseConnection->prepare('INSERT INTO channels(server_id,name) VALUES(:server,:name)'); // 서버 소속 채널
                $databaseQuery->execute(['server' => $serverRecord['id'], 'name' => $requestInput['name']]); // 이름 정규화 완료 값
                $savedChannelId = $databaseConnection->lastInsertId(); // 큰 ID 문자열
            }
            else // 현재 채널 이름 변경
            {
                $databaseQuery = $databaseConnection->prepare('UPDATE channels SET name=:name WHERE id=:id'); // ID와 대화 관계 유지
                $databaseQuery->execute(['name' => $requestInput['name'], 'id' => $channelRecord['id']]); // 동일 이름도 성공
                $savedChannelId = (string) $channelRecord['id']; // 기존 식별자 보존
            }
        }
        catch (PDOException $caughtException) // 고유 키 위반의 공개 오류
        {
            if ((int) ($caughtException->errorInfo[1] ?? 0) === 1062) // 같은 서버 채널명 중복
            {
                throw new ManagementException('CHANNEL_NAME_TAKEN', 409); // 트랜잭션 취소 후 응답
            }
            throw $caughtException; // 실제 DB 실패 처리
        }
        return ['data' => ['channel' => ['id' => $savedChannelId, 'server_id' => (string) $serverRecord['id'], 'server_name' => $serverRecord['name'], 'name' => $requestInput['name']]], 'status' => $operation === 'create_channel' ? 201 : 200]; // 기존 목록과 같은 공개 객체
    }); // 전체 업무 종료
}
