<?php // 서버와 초대의 트랜잭션 업무
declare(strict_types=1); // 엄격한 자료형
class ManagementException extends RuntimeException // 공개 관리 오류
{
}
function management_time(?string $inputValue): ?string // 공개 UTC 시각 변환
{
    return $inputValue === null ? null : (new DateTimeImmutable($inputValue, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z'); // 초 단위 표준 시각
}
function public_server(array $serverRecord, string $memberRole): array // 본인 소속 서버 응답
{
    return ['id' => (string) $serverRecord['id'], 'name' => $serverRecord['name'], 'owner_id' => (string) $serverRecord['owner_id'], 'role' => $memberRole, 'created_at' => management_time($serverRecord['created_at'])]; // 비밀 없는 객체
}
function management_server(PDO $databaseConnection, string $targetServerId, bool $shouldLock = true): array // 현재 서버 존재 확인
{
    $databaseQuery = $databaseConnection->prepare('SELECT id, name, owner_id, created_at FROM servers WHERE id=:id' . ($shouldLock ? ' FOR UPDATE' : '')); // 서버 우선 잠금
    $databaseQuery->execute(['id' => $targetServerId]); // 대상 서버 조회
    $serverRecord = $databaseQuery->fetch(); // 실제 서버
    if ($serverRecord === false) // 삭제된 서버
    {
        throw new ManagementException('SERVER_NOT_FOUND', 404); // 존재 오류
    }
    return $serverRecord; // 확인한 서버
}
function management_actor(PDO $databaseConnection, array $serverRecord, string $userId, bool $isOwner = false, bool $shouldLock = true): string // 소속과 소유자 불변식 확인
{
    $databaseQuery = $databaseConnection->prepare('SELECT role FROM server_members WHERE server_id=:server AND user_id=:user' . ($shouldLock ? ' FOR SHARE' : '')); // 실제 소속 확인
    $databaseQuery->execute(['server' => $serverRecord['id'], 'user' => $userId]); // 세션 사용자로만 조회
    $memberRole = $databaseQuery->fetchColumn(); // 현재 역할
    if ($memberRole === false) // 미참여 사용자
    {
        throw new ManagementException('FORBIDDEN', 403); // 자료 접근 차단
    }
    $ownerQuery = $databaseConnection->prepare("SELECT user_id FROM server_members WHERE server_id=:server AND role='owner'" . ($shouldLock ? ' FOR SHARE' : '')); // 잠금 뒤 최신 소유자 전체 검사
    $ownerQuery->execute(['server' => $serverRecord['id']]); // 같은 서버 소유자
    $ownerIds = $ownerQuery->fetchAll(PDO::FETCH_COLUMN); // 실제 소유자 목록
    if (count($ownerIds) !== 1 || (string) $ownerIds[0] !== (string) $serverRecord['owner_id'] || (($memberRole === 'owner') !== ($userId === (string) $serverRecord['owner_id']))) // 교차 테이블 불변식
    {
        throw new LogicException('Owner membership mismatch.'); // 불일치 상태 변경 중단
    }
    if ($isOwner && $memberRole !== 'owner') // 소유자 전용 동작
    {
        throw new ManagementException('FORBIDDEN', 403); // 관리자 포함 거절
    }
    return $memberRole; // 검증된 역할
}
function management_transaction(PDO $databaseConnection, callable $transactionWork): array // 관리 변경 전체 재시도
{
    for ($attempt = 0; $attempt < 3; $attempt++) // 최대 세 번의 업무 시도
    {
        try // 모든 변경의 원자성
        {
            $databaseConnection->beginTransaction(); // 업무 시작
            $transactionResult = $transactionWork(); // 매번 현재 상태 재확인
            $databaseConnection->commit(); // 성공한 업무만 확정
            return $transactionResult; // 커밋 후 응답 자료
        }
        catch (Throwable $caughtException) // 실패 작업 취소
        {
            if ($databaseConnection->inTransaction()) // 미완료 트랜잭션
            {
                $databaseConnection->rollBack(); // 부분 변경 제거
            }
            if ($caughtException instanceof PDOException && in_array((int) ($caughtException->errorInfo[1] ?? 0), [1205, 1213], true) && $attempt < 2) // 재시도 가능한 잠금 충돌
            {
                continue; // 집계 중복 없는 업무 재시도
            }
            throw $caughtException; // 도메인 또는 실제 DB 오류
        }
    }
    throw new LogicException('Unreachable transaction state.'); // 내부 계약 방어
}
function management_invite(PDO $databaseConnection, string $serverId, bool $shouldLock = true): array|false // 서버당 현재 초대
{
    $databaseQuery = $databaseConnection->prepare('SELECT server_id, token_hash, created_at, expires_at, revoked_at FROM server_invites WHERE server_id=:id' . ($shouldLock ? ' FOR UPDATE' : '')); // 서버 다음 초대 잠금
    $databaseQuery->execute(['id' => $serverId]); // 현재 상태 읽기
    return $databaseQuery->fetch(); // 미발급이면 false
}
function management_preview(PDO $databaseConnection, string $userId, array $requestInput): array // 일관된 삭제 영향 조회
{
    return management_transaction($databaseConnection, function () use ($databaseConnection, $userId, $requestInput): array // 단일 스냅샷 조회
    {
        $channelRecord = null; // 서버 또는 채널 대상
        $serverId = $requestInput['resource_id']; // 기본 서버 대상
        if ($requestInput['resource_type'] === 'channel') // 채널 영향 조회
        {
            $databaseQuery = $databaseConnection->prepare('SELECT id, server_id, name FROM channels WHERE id=:id'); // 채널 후보 조회
            $databaseQuery->execute(['id' => $requestInput['resource_id']]); // 실제 채널
            $channelRecord = $databaseQuery->fetch(); // 대상 정보
            if ($channelRecord === false) // 채널 존재 확인
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 존재 오류
            }
            $serverId = (string) $channelRecord['server_id']; // 서버 권한 확인 대상
        }
        $serverRecord = management_server($databaseConnection, $serverId, false); // 읽기 스냅샷 서버
        $memberRole = management_actor($databaseConnection, $serverRecord, $userId, $channelRecord === null, false); // 대상별 관리 권한
        if ($channelRecord !== null && !in_array($memberRole, ['owner', 'admin'], true)) // 채널 일반 회원 차단
        {
            throw new ManagementException('FORBIDDEN', 403); // 관리 권한 거절
        }
        $databaseQuery = $databaseConnection->prepare('SELECT COUNT(*) FROM messages m JOIN channels c ON c.id=m.channel_id WHERE ' . ($channelRecord === null ? 'c.server_id' : 'c.id') . '=:id'); // 실제 삭제 대화 수
        $databaseQuery->execute(['id' => $requestInput['resource_id']]); // 필터된 집계
        $responseData = ['resource_type' => $requestInput['resource_type'], 'resource_id' => $requestInput['resource_id'], 'name' => $channelRecord === null ? $serverRecord['name'] : $channelRecord['name'], 'message_count' => (string) $databaseQuery->fetchColumn()]; // 공통 미리보기
        if ($channelRecord === null) // 서버의 추가 영향
        {
            foreach (['channel_count' => 'channels', 'member_count' => 'server_members'] as $countField => $tableName) // 고정 내부 테이블만 사용
            {
                $databaseQuery = $databaseConnection->prepare('SELECT COUNT(*) FROM ' . $tableName . ' WHERE server_id=:id'); // 같은 스냅샷 집계
                $databaseQuery->execute(['id' => $serverId]); // 대상 서버만 집계
                $responseData[$countField] = (string) $databaseQuery->fetchColumn(); // 큰 집계 문자열 유지
            }
        }
        return ['data' => $responseData, 'status' => 200]; // 스냅샷 종료 뒤 반환
    }); // 미리보기 업무 종료
}
function run_management(PDO $databaseConnection, string $operation, string $userId, array $requestInput): array // 공개 진입점의 단일 업무 계약
{
    if ($operation === 'list_servers') // 채널과 독립된 서버 목록
    {
        $databaseQuery = $databaseConnection->prepare('SELECT s.id, s.name, s.owner_id, s.created_at, m.role FROM server_members m JOIN servers s ON s.id=m.server_id WHERE m.user_id=:user ORDER BY s.id'); // 빈 서버도 보존
        $databaseQuery->execute(['user' => $userId]); // 본인 소속만 조회
        return ['data' => ['servers' => array_map(fn(array $databaseRow): array => public_server($databaseRow, $databaseRow['role']), $databaseQuery->fetchAll())], 'status' => 200]; // 순서 있는 목록
    }
    if ($operation === 'get_deletion_preview') // 관리 영향 조회
    {
        return management_preview($databaseConnection, $userId, $requestInput); // 별도 읽기 업무
    }
    return management_transaction($databaseConnection, function () use ($databaseConnection, $operation, $userId, $requestInput): array // 권한과 변경을 같은 트랜잭션으로 처리
    {
        if ($operation === 'create_server') // 새 서버와 기본 소속
        {
            $databaseQuery = $databaseConnection->prepare('INSERT INTO servers (name, owner_id) VALUES (:name, :owner)'); // 사용자 소유 서버
            $databaseQuery->execute(['name' => $requestInput['name'], 'owner' => $userId]); // 서버 삽입
            $createdServerId = $databaseConnection->lastInsertId(); // 문자열 식별자
            $databaseQuery = $databaseConnection->prepare("INSERT INTO server_members (server_id, user_id, role) VALUES (:server, :user, 'owner')"); // 유일 소유자 소속
            $databaseQuery->execute(['server' => $createdServerId, 'user' => $userId]); // 같은 업무에 등록
            $databaseQuery = $databaseConnection->prepare("INSERT INTO channels (server_id, name) VALUES (:server, '일반')"); // 기본 대화방
            $databaseQuery->execute(['server' => $createdServerId]); // 원자적 채널 생성
            $channelId = $databaseConnection->lastInsertId(); // 기본 채널 ID
            return ['data' => ['server' => public_server(management_server($databaseConnection, $createdServerId), 'owner'), 'channel' => ['id' => $channelId, 'server_id' => $createdServerId, 'server_name' => $requestInput['name'], 'name' => '일반']], 'status' => 201]; // 완전한 생성 결과
        }
        if ($operation === 'join_server') // 코드로 현재 서버 찾기
        {
            $databaseQuery = $databaseConnection->prepare('SELECT server_id FROM server_invites WHERE token_hash=:hash'); // 해시 후보만 조회
            $databaseQuery->execute(['hash' => hash('sha256', $requestInput['code'], true)]); // 원문 DB 전달 방지
            $candidateServerId = $databaseQuery->fetchColumn(); // 검증 전 후보
            if ($candidateServerId === false) // 알 수 없는 코드
            {
                throw new ManagementException('INVALID_INVITE', 400); // 같은 무효 안내
            }
            $requestInput['server_id'] = (string) $candidateServerId; // 서버 잠금 대상
        }
        $serverRecord = management_server($databaseConnection, $requestInput['server_id'], $operation !== 'get_server_invite'); // 서버 우선 잠금
        if ($operation === 'delete_server') // CASCADE 전 잠금 순서 보장
        {
            $databaseQuery = $databaseConnection->prepare('SELECT id FROM channels WHERE server_id=:id ORDER BY id FOR UPDATE'); // 전송이 가진 채널부터 대기
            $databaseQuery->execute(['id' => $serverRecord['id']]); // 서버의 모든 채널 선점
            $databaseQuery->fetchAll(); // 전체 잠금 확보
        }
        $invite = in_array($operation, ['join_server', 'create_server_invite', 'revoke_server_invite', 'get_server_invite', 'delete_server'], true) ? management_invite($databaseConnection, (string) $serverRecord['id'], $operation !== 'get_server_invite') : false; // 소속 전 초대 잠금
        if ($operation === 'join_server') // 잠금 후 최신 초대 확인
        {
            $databaseQuery = $databaseConnection->prepare('SELECT role FROM server_members WHERE server_id=:server AND user_id=:user FOR UPDATE'); // 만료 판정 전 본인 소속 잠금
            $databaseQuery->execute(['server' => $serverRecord['id'], 'user' => $userId]); // 실제 사용자 소속
            $existingRole = $databaseQuery->fetchColumn(); // 중복 참여 여부
            $currentTime = $databaseConnection->query('SELECT UTC_TIMESTAMP()')->fetchColumn(); // 잠금 후 만료 경계
            if ($invite === false || !hash_equals($invite['token_hash'], hash('sha256', $requestInput['code'], true)) || $invite['revoked_at'] !== null || strcmp($currentTime, $invite['expires_at']) >= 0) // 교체·폐기·만료 검사
            {
                throw new ManagementException('INVALID_INVITE', 400); // 정보 없는 무효 응답
            }
            if ($existingRole === false) // 새 소속만 삽입
            {
                $databaseQuery = $databaseConnection->prepare("INSERT INTO server_members (server_id,user_id,role) VALUES (:server,:user,'member')"); // 최소 권한 참여
                $databaseQuery->execute(['server' => $serverRecord['id'], 'user' => $userId]); // 멤버십 삽입
            }
            $memberRole = management_actor($databaseConnection, $serverRecord, $userId); // 소유자 불변식 포함 재검사
            return ['data' => ['server' => public_server($serverRecord, $memberRole), 'already_member' => $existingRole !== false], 'status' => $existingRole === false ? 201 : 200]; // 기존 역할 보존
        }
        if ($operation === 'delete_server') // 소속 전체 잠금
        {
            $databaseQuery = $databaseConnection->prepare('SELECT user_id FROM server_members WHERE server_id=:id ORDER BY user_id FOR UPDATE'); // CASCADE 전에 소속 선점
            $databaseQuery->execute(['id' => $serverRecord['id']]); // 순서 있는 멤버 잠금
            $databaseQuery->fetchAll(); // 전체 상태 확보
        }
        $ownerOnly = in_array($operation, ['create_server_invite', 'revoke_server_invite', 'get_server_invite', 'delete_server'], true); // 소유자 전용 작업
        $memberRole = management_actor($databaseConnection, $serverRecord, $userId, $ownerOnly, $operation !== 'get_server_invite'); // 현재 소속과 역할
        if ($operation === 'get_server_invite') // 원문 복구 없는 상태 조회
        {
            $currentTime = $databaseConnection->query('SELECT UTC_TIMESTAMP()')->fetchColumn(); // 현재 UTC 시각
            return ['data' => ['invite' => ['server_id' => (string) $serverRecord['id'], 'active' => $invite !== false && $invite['revoked_at'] === null && strcmp($currentTime, $invite['expires_at']) < 0, 'expires_at' => $invite === false ? null : management_time($invite['expires_at']), 'revoked_at' => $invite === false ? null : management_time($invite['revoked_at'])]], 'status' => 200]; // 해시와 원문 제외
        }
        if ($operation === 'create_server_invite') // 현재 코드 교체
        {
            for ($collisionCount = 0; $collisionCount < 3; $collisionCount++) // 해시 충돌 제한 재발급
            {
                $code = bin2hex(random_bytes(32)); // 추측 어려운 원문
                try // 고유 키와 함께 저장
                {
                    $sqlStatement = $invite === false ? 'INSERT INTO server_invites (server_id, token_hash, created_by, created_at, expires_at, revoked_at) VALUES (:server, :hash, :user, UTC_TIMESTAMP(), UTC_TIMESTAMP()+INTERVAL 1 DAY, NULL)' : 'UPDATE server_invites SET token_hash=:hash, created_by=:user, created_at=UTC_TIMESTAMP(), expires_at=UTC_TIMESTAMP()+INTERVAL 1 DAY, revoked_at=NULL WHERE server_id=:server'; // 해시 충돌이 다른 서버를 갱신하지 않는 분기
                    $databaseQuery = $databaseConnection->prepare($sqlStatement); // 실제 대상 서버만 변경
                    $inviteHash = hash('sha256', $code, true); // 원문 없는 바이너리 해시
                    $databaseQuery->execute(['server' => $serverRecord['id'], 'hash' => $inviteHash, 'user' => $userId]); // 발급·교체 반영
                    $currentInvite = management_invite($databaseConnection, (string) $serverRecord['id']); // 확정할 만료 시각
                    return ['data' => ['server_id' => (string) $serverRecord['id'], 'code' => $code, 'expires_at' => management_time($currentInvite['expires_at'])], 'status' => 201]; // 이번 응답만 원문 공개
                }
                catch (PDOException $caughtException) // 해시 고유 키 충돌
                {
                    if ((int) ($caughtException->errorInfo[1] ?? 0) !== 1062 || $collisionCount === 2) // 다른 오류 또는 최종 실패
                    {
                        throw $caughtException; // 전체 업무 롤백
                    }
                }
            }
        }
        if ($operation === 'revoke_server_invite') // 코드 폐기
        {
            $databaseQuery = $databaseConnection->prepare('UPDATE server_invites SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()) WHERE server_id=:id'); // 반복 폐기 상태 유지
            $databaseQuery->execute(['id' => $serverRecord['id']]); // 미발급도 성공
            return ['data' => ['server_id' => (string) $serverRecord['id'], 'revoked' => true], 'status' => 200]; // 멱등 결과
        }
        if ($operation === 'leave_server') // 본인 소속 제거
        {
            if ($memberRole === 'owner') // 소유자 탈퇴 차단
            {
                throw new ManagementException('OWNER_CANNOT_LEAVE', 409); // 이전 기능 전 거절
            }
            $databaseQuery = $databaseConnection->prepare('DELETE FROM server_members WHERE server_id=:server AND user_id=:user'); // 계정과 대화 보존
            $databaseQuery->execute(['server' => $serverRecord['id'], 'user' => $userId]); // 본인 소속만 삭제
            return ['data' => ['server_id' => (string) $serverRecord['id'], 'left' => true], 'status' => 200]; // 탈퇴 완료
        }
        if ($operation === 'delete_server') // 확인한 서버 영구 삭제
        {
            if (!hash_equals($serverRecord['name'], $requestInput['confirm_name'])) // 정확한 현재 이름 비교
            {
                throw new ManagementException('NAME_MISMATCH', 409); // 최신 영향 재확인 필요
            }
            $databaseQuery = $databaseConnection->prepare('DELETE FROM servers WHERE id=:id'); // 정해진 외래 키 CASCADE
            $databaseQuery->execute(['id' => $serverRecord['id']]); // 계정과 다른 서버 보존
            return ['data' => ['server_id' => (string) $serverRecord['id'], 'deleted' => true], 'status' => 200]; // 삭제 완료
        }
        throw new LogicException('Unknown management operation.'); // 내부 분기 누락
    }); // 업무 트랜잭션 종료
}
