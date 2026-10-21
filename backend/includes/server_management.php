<?php // 서버와 초대의 트랜잭션 업무
declare(strict_types=1); // 엄격한 자료형
class ManagementException extends RuntimeException // 공개 관리 오류
{
}
function management_time(?string $value): ?string // 공개 UTC 시각 변환
{
    return $value === null ? null : (new DateTimeImmutable($value, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z'); // 초 단위 표준 시각
}
function public_server(array $server, string $role): array // 본인 소속 서버 응답
{
    return ['id' => (string) $server['id'], 'name' => $server['name'], 'owner_id' => (string) $server['owner_id'], 'role' => $role, 'created_at' => management_time($server['created_at'])]; // 비밀 없는 객체
}
function management_server(PDO $pdo, string $id, bool $lock = true): array // 현재 서버 존재 확인
{
    $query = $pdo->prepare('SELECT id, name, owner_id, created_at FROM servers WHERE id=:id' . ($lock ? ' FOR UPDATE' : '')); // 서버 우선 잠금
    $query->execute(['id' => $id]); // 대상 서버 조회
    $server = $query->fetch(); // 실제 서버
    if ($server === false) // 삭제된 서버
    {
        throw new ManagementException('SERVER_NOT_FOUND', 404); // 존재 오류
    }
    return $server; // 확인한 서버
}
function management_actor(PDO $pdo, array $server, string $user_id, bool $owner = false, bool $lock = true): string // 소속과 소유자 불변식 확인
{
    $query = $pdo->prepare('SELECT role FROM server_members WHERE server_id=:server AND user_id=:user' . ($lock ? ' FOR SHARE' : '')); // 실제 소속 확인
    $query->execute(['server' => $server['id'], 'user' => $user_id]); // 세션 사용자로만 조회
    $role = $query->fetchColumn(); // 현재 역할
    if ($role === false) // 미참여 사용자
    {
        throw new ManagementException('FORBIDDEN', 403); // 자료 접근 차단
    }
    $check = $pdo->prepare("SELECT user_id FROM server_members WHERE server_id=:server AND role='owner'"); // 소유자 전체 검사
    $check->execute(['server' => $server['id']]); // 같은 서버 소유자
    $owners = $check->fetchAll(PDO::FETCH_COLUMN); // 실제 소유자 목록
    if (count($owners) !== 1 || (string) $owners[0] !== (string) $server['owner_id'] || (($role === 'owner') !== ($user_id === (string) $server['owner_id']))) // 교차 테이블 불변식
    {
        throw new LogicException('Owner membership mismatch.'); // 불일치 상태 변경 중단
    }
    if ($owner && $role !== 'owner') // 소유자 전용 동작
    {
        throw new ManagementException('FORBIDDEN', 403); // 관리자 포함 거절
    }
    return $role; // 검증된 역할
}
function management_transaction(PDO $pdo, callable $work): array // 관리 변경 전체 재시도
{
    for ($attempt = 0; $attempt < 3; $attempt++) // 최대 세 번의 업무 시도
    {
        try // 모든 변경의 원자성
        {
            $pdo->beginTransaction(); // 업무 시작
            $result = $work(); // 매번 현재 상태 재확인
            $pdo->commit(); // 성공한 업무만 확정
            return $result; // 커밋 후 응답 자료
        }
        catch (Throwable $error) // 실패 작업 취소
        {
            if ($pdo->inTransaction()) // 미완료 트랜잭션
            {
                $pdo->rollBack(); // 부분 변경 제거
            }
            if ($error instanceof PDOException && in_array((int) ($error->errorInfo[1] ?? 0), [1205, 1213], true) && $attempt < 2) // 재시도 가능한 잠금 충돌
            {
                continue; // 집계 중복 없는 업무 재시도
            }
            throw $error; // 도메인 또는 실제 DB 오류
        }
    }
    throw new LogicException('Unreachable transaction state.'); // 내부 계약 방어
}
function management_invite(PDO $pdo, string $server_id, bool $lock = true): array|false // 서버당 현재 초대
{
    $query = $pdo->prepare('SELECT server_id, token_hash, created_at, expires_at, revoked_at FROM server_invites WHERE server_id=:id' . ($lock ? ' FOR UPDATE' : '')); // 서버 다음 초대 잠금
    $query->execute(['id' => $server_id]); // 현재 상태 읽기
    return $query->fetch(); // 미발급이면 false
}
function management_preview(PDO $pdo, string $user_id, array $input): array // 일관된 삭제 영향 조회
{
    return management_transaction($pdo, function () use ($pdo, $user_id, $input): array // 단일 스냅샷 조회
    {
        $channel = null; // 서버 또는 채널 대상
        $server_id = $input['resource_id']; // 기본 서버 대상
        if ($input['resource_type'] === 'channel') // 채널 영향 조회
        {
            $query = $pdo->prepare('SELECT id, server_id, name FROM channels WHERE id=:id'); // 채널 후보 조회
            $query->execute(['id' => $input['resource_id']]); // 실제 채널
            $channel = $query->fetch(); // 대상 정보
            if ($channel === false) // 채널 존재 확인
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 존재 오류
            }
            $server_id = (string) $channel['server_id']; // 서버 권한 확인 대상
        }
        $server = management_server($pdo, $server_id, false); // 읽기 스냅샷 서버
        $role = management_actor($pdo, $server, $user_id, $channel === null, false); // 대상별 관리 권한
        if ($channel !== null && !in_array($role, ['owner', 'admin'], true)) // 채널 일반 회원 차단
        {
            throw new ManagementException('FORBIDDEN', 403); // 관리 권한 거절
        }
        $query = $pdo->prepare('SELECT COUNT(*) FROM messages m JOIN channels c ON c.id=m.channel_id WHERE ' . ($channel === null ? 'c.server_id' : 'c.id') . '=:id'); // 실제 삭제 대화 수
        $query->execute(['id' => $input['resource_id']]); // 필터된 집계
        $data = ['resource_type' => $input['resource_type'], 'resource_id' => $input['resource_id'], 'name' => $channel === null ? $server['name'] : $channel['name'], 'message_count' => (string) $query->fetchColumn()]; // 공통 미리보기
        if ($channel === null) // 서버의 추가 영향
        {
            foreach (['channel_count' => 'channels', 'member_count' => 'server_members'] as $key => $table) // 고정 내부 테이블만 사용
            {
                $query = $pdo->prepare('SELECT COUNT(*) FROM ' . $table . ' WHERE server_id=:id'); // 같은 스냅샷 집계
                $query->execute(['id' => $server_id]); // 대상 서버만 집계
                $data[$key] = (string) $query->fetchColumn(); // 큰 집계 문자열 유지
            }
        }
        return ['data' => $data, 'status' => 200]; // 스냅샷 종료 뒤 반환
    }); // 미리보기 업무 종료
}
function run_management(PDO $pdo, string $operation, string $user_id, array $input): array // 공개 진입점의 단일 업무 계약
{
    if ($operation === 'list_servers') // 채널과 독립된 서버 목록
    {
        $query = $pdo->prepare('SELECT s.id, s.name, s.owner_id, s.created_at, m.role FROM server_members m JOIN servers s ON s.id=m.server_id WHERE m.user_id=:user ORDER BY s.id'); // 빈 서버도 보존
        $query->execute(['user' => $user_id]); // 본인 소속만 조회
        return ['data' => ['servers' => array_map(fn(array $row): array => public_server($row, $row['role']), $query->fetchAll())], 'status' => 200]; // 순서 있는 목록
    }
    if ($operation === 'get_deletion_preview') // 관리 영향 조회
    {
        return management_preview($pdo, $user_id, $input); // 별도 읽기 업무
    }
    return management_transaction($pdo, function () use ($pdo, $operation, $user_id, $input): array // 권한과 변경을 같은 트랜잭션으로 처리
    {
        if ($operation === 'create_server') // 새 서버와 기본 소속
        {
            $query = $pdo->prepare('INSERT INTO servers (name, owner_id) VALUES (:name, :owner)'); // 사용자 소유 서버
            $query->execute(['name' => $input['name'], 'owner' => $user_id]); // 서버 삽입
            $id = $pdo->lastInsertId(); // 문자열 식별자
            $query = $pdo->prepare("INSERT INTO server_members (server_id, user_id, role) VALUES (:server, :user, 'owner')"); // 유일 소유자 소속
            $query->execute(['server' => $id, 'user' => $user_id]); // 같은 업무에 등록
            $query = $pdo->prepare("INSERT INTO channels (server_id, name) VALUES (:server, '일반')"); // 기본 대화방
            $query->execute(['server' => $id]); // 원자적 채널 생성
            $channel_id = $pdo->lastInsertId(); // 기본 채널 ID
            return ['data' => ['server' => public_server(management_server($pdo, $id), 'owner'), 'channel' => ['id' => $channel_id, 'server_id' => $id, 'server_name' => $input['name'], 'name' => '일반']], 'status' => 201]; // 완전한 생성 결과
        }
        if ($operation === 'join_server') // 코드로 현재 서버 찾기
        {
            $query = $pdo->prepare('SELECT server_id FROM server_invites WHERE token_hash=:hash'); // 해시 후보만 조회
            $query->execute(['hash' => hash('sha256', $input['code'], true)]); // 원문 DB 전달 방지
            $candidate = $query->fetchColumn(); // 검증 전 후보
            if ($candidate === false) // 알 수 없는 코드
            {
                throw new ManagementException('INVALID_INVITE', 400); // 같은 무효 안내
            }
            $input['server_id'] = (string) $candidate; // 서버 잠금 대상
        }
        $server = management_server($pdo, $input['server_id'], $operation !== 'get_server_invite'); // 서버 우선 잠금
        if ($operation === 'delete_server') // CASCADE 전 잠금 순서 보장
        {
            $query = $pdo->prepare('SELECT id FROM channels WHERE server_id=:id ORDER BY id FOR UPDATE'); // 전송이 가진 채널부터 대기
            $query->execute(['id' => $server['id']]); // 서버의 모든 채널 선점
            $query->fetchAll(); // 전체 잠금 확보
        }
        $invite = in_array($operation, ['join_server', 'create_server_invite', 'revoke_server_invite', 'get_server_invite', 'delete_server'], true) ? management_invite($pdo, (string) $server['id'], $operation !== 'get_server_invite') : false; // 소속 전 초대 잠금
        if ($operation === 'join_server') // 잠금 후 최신 초대 확인
        {
            $query = $pdo->prepare('SELECT role FROM server_members WHERE server_id=:server AND user_id=:user FOR UPDATE'); // 만료 판정 전 본인 소속 잠금
            $query->execute(['server' => $server['id'], 'user' => $user_id]); // 실제 사용자 소속
            $existing = $query->fetchColumn(); // 중복 참여 여부
            $now = $pdo->query('SELECT UTC_TIMESTAMP()')->fetchColumn(); // 잠금 후 만료 경계
            if ($invite === false || !hash_equals($invite['token_hash'], hash('sha256', $input['code'], true)) || $invite['revoked_at'] !== null || strcmp($now, $invite['expires_at']) >= 0) // 교체·폐기·만료 검사
            {
                throw new ManagementException('INVALID_INVITE', 400); // 정보 없는 무효 응답
            }
            if ($existing === false) // 새 소속만 삽입
            {
                $query = $pdo->prepare("INSERT INTO server_members (server_id,user_id,role) VALUES (:server,:user,'member')"); // 최소 권한 참여
                $query->execute(['server' => $server['id'], 'user' => $user_id]); // 멤버십 삽입
            }
            $role = management_actor($pdo, $server, $user_id); // 소유자 불변식 포함 재검사
            return ['data' => ['server' => public_server($server, $role), 'already_member' => $existing !== false], 'status' => $existing === false ? 201 : 200]; // 기존 역할 보존
        }
        if ($operation === 'delete_server') // 소속 전체 잠금
        {
            $query = $pdo->prepare('SELECT user_id FROM server_members WHERE server_id=:id ORDER BY user_id FOR UPDATE'); // CASCADE 전에 소속 선점
            $query->execute(['id' => $server['id']]); // 순서 있는 멤버 잠금
            $query->fetchAll(); // 전체 상태 확보
        }
        $owner_only = in_array($operation, ['create_server_invite', 'revoke_server_invite', 'get_server_invite', 'delete_server'], true); // 소유자 전용 작업
        $role = management_actor($pdo, $server, $user_id, $owner_only, $operation !== 'get_server_invite'); // 현재 소속과 역할
        if ($operation === 'get_server_invite') // 원문 복구 없는 상태 조회
        {
            $now = $pdo->query('SELECT UTC_TIMESTAMP()')->fetchColumn(); // 현재 UTC 시각
            return ['data' => ['invite' => ['server_id' => (string) $server['id'], 'active' => $invite !== false && $invite['revoked_at'] === null && strcmp($now, $invite['expires_at']) < 0, 'expires_at' => $invite === false ? null : management_time($invite['expires_at']), 'revoked_at' => $invite === false ? null : management_time($invite['revoked_at'])]], 'status' => 200]; // 해시와 원문 제외
        }
        if ($operation === 'create_server_invite') // 현재 코드 교체
        {
            for ($collision = 0; $collision < 3; $collision++) // 해시 충돌 제한 재발급
            {
                $code = bin2hex(random_bytes(32)); // 추측 어려운 원문
                try // 고유 키와 함께 저장
                {
                    $sql = $invite === false ? 'INSERT INTO server_invites (server_id, token_hash, created_by, created_at, expires_at, revoked_at) VALUES (:server, :hash, :user, UTC_TIMESTAMP(), UTC_TIMESTAMP()+INTERVAL 1 DAY, NULL)' : 'UPDATE server_invites SET token_hash=:hash, created_by=:user, created_at=UTC_TIMESTAMP(), expires_at=UTC_TIMESTAMP()+INTERVAL 1 DAY, revoked_at=NULL WHERE server_id=:server'; // 해시 충돌이 다른 서버를 갱신하지 않는 분기
                    $query = $pdo->prepare($sql); // 실제 대상 서버만 변경
                    $hash = hash('sha256', $code, true); // 원문 없는 바이너리 해시
                    $query->execute(['server' => $server['id'], 'hash' => $hash, 'user' => $user_id]); // 발급·교체 반영
                    $current = management_invite($pdo, (string) $server['id']); // 확정할 만료 시각
                    return ['data' => ['server_id' => (string) $server['id'], 'code' => $code, 'expires_at' => management_time($current['expires_at'])], 'status' => 201]; // 이번 응답만 원문 공개
                }
                catch (PDOException $error) // 해시 고유 키 충돌
                {
                    if ((int) ($error->errorInfo[1] ?? 0) !== 1062 || $collision === 2) // 다른 오류 또는 최종 실패
                    {
                        throw $error; // 전체 업무 롤백
                    }
                }
            }
        }
        if ($operation === 'revoke_server_invite') // 코드 폐기
        {
            $query = $pdo->prepare('UPDATE server_invites SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()) WHERE server_id=:id'); // 반복 폐기 상태 유지
            $query->execute(['id' => $server['id']]); // 미발급도 성공
            return ['data' => ['server_id' => (string) $server['id'], 'revoked' => true], 'status' => 200]; // 멱등 결과
        }
        if ($operation === 'leave_server') // 본인 소속 제거
        {
            if ($role === 'owner') // 소유자 탈퇴 차단
            {
                throw new ManagementException('OWNER_CANNOT_LEAVE', 409); // 이전 기능 전 거절
            }
            $query = $pdo->prepare('DELETE FROM server_members WHERE server_id=:server AND user_id=:user'); // 계정과 대화 보존
            $query->execute(['server' => $server['id'], 'user' => $user_id]); // 본인 소속만 삭제
            return ['data' => ['server_id' => (string) $server['id'], 'left' => true], 'status' => 200]; // 탈퇴 완료
        }
        if ($operation === 'delete_server') // 확인한 서버 영구 삭제
        {
            if (!hash_equals($server['name'], $input['confirm_name'])) // 정확한 현재 이름 비교
            {
                throw new ManagementException('NAME_MISMATCH', 409); // 최신 영향 재확인 필요
            }
            $query = $pdo->prepare('DELETE FROM servers WHERE id=:id'); // 정해진 외래 키 CASCADE
            $query->execute(['id' => $server['id']]); // 계정과 다른 서버 보존
            return ['data' => ['server_id' => (string) $server['id'], 'deleted' => true], 'status' => 200]; // 삭제 완료
        }
        throw new LogicException('Unknown management operation.'); // 내부 분기 누락
    }); // 업무 트랜잭션 종료
}
