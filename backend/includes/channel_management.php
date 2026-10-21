<?php // 채널 생성·이름 변경·삭제 업무
declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/server_management.php'; // 공통 역할과 트랜잭션
function run_channel_management(PDO $pdo, string $operation, string $user_id, array $input): array // 검증한 관리 요청 실행
{
    return management_transaction($pdo, function () use ($pdo, $operation, $user_id, $input): array // 현재 권한과 변경의 원자성
    {
        $channel = null; // 생성과 기존 채널 구분
        $server_id = $input['server_id'] ?? null; // 생성할 서버
        if ($operation !== 'create_channel') // 변경 대상의 부모 후보 조회
        {
            $query = $pdo->prepare('SELECT server_id FROM channels WHERE id=:id'); // 잠금 순서 전 부모 후보
            $query->execute(['id' => $input['channel_id']]); // 문자열 채널 ID
            $server_id = $query->fetchColumn(); // 후보 서버
            if ($server_id === false) // 없는 채널
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 존재 오류
            }
        }
        $server = management_server($pdo, (string) $server_id); // 서버 우선 잠금
        if ($operation !== 'create_channel') // 부모 다음 실제 채널 잠금
        {
            $query = $pdo->prepare('SELECT id, server_id, name FROM channels WHERE id=:id FOR UPDATE'); // 현재 채널 재확인
            $query->execute(['id' => $input['channel_id']]); // 대상 채널만 잠금
            $channel = $query->fetch(); // 현재 자원
            if ($channel === false || (string) $channel['server_id'] !== (string) $server['id']) // 후보 조회 뒤 삭제·부모 불일치
            {
                throw new ManagementException('CHANNEL_NOT_FOUND', 404); // 오래된 대상 사용 차단
            }
        }
        $role = management_actor($pdo, $server, $user_id); // 잠금 뒤 현재 역할 재검사
        if (!in_array($role, ['owner', 'admin'], true)) // 관리자와 소유자만 허용
        {
            throw new ManagementException('FORBIDDEN', 403); // 일반 회원 관리 차단
        }
        if ($operation === 'delete_channel') // 이름 확인 뒤 영구 삭제
        {
            if (!hash_equals($channel['name'], $input['confirm_name'])) // 정확한 현재 이름
            {
                throw new ManagementException('NAME_MISMATCH', 409); // 최신 영향 재확인
            }
            $query = $pdo->prepare('DELETE FROM channels WHERE id=:id'); // 메시지 CASCADE
            $query->execute(['id' => $channel['id']]); // 같은 서버의 다른 자료 보존
            return ['data' => ['channel_id' => (string) $channel['id'], 'deleted' => true], 'status' => 200]; // 마지막 채널도 삭제 허용
        }
        try // 기존 고유 키로 동시 중복 차단
        {
            if ($operation === 'create_channel') // 새 채널 생성
            {
                $query = $pdo->prepare('INSERT INTO channels(server_id,name) VALUES(:server,:name)'); // 서버 소속 채널
                $query->execute(['server' => $server['id'], 'name' => $input['name']]); // 이름 정규화 완료 값
                $id = $pdo->lastInsertId(); // 큰 ID 문자열
            }
            else // 현재 채널 이름 변경
            {
                $query = $pdo->prepare('UPDATE channels SET name=:name WHERE id=:id'); // ID와 대화 관계 유지
                $query->execute(['name' => $input['name'], 'id' => $channel['id']]); // 동일 이름도 성공
                $id = (string) $channel['id']; // 기존 식별자 보존
            }
        }
        catch (PDOException $error) // 고유 키 위반의 공개 오류
        {
            if ((int) ($error->errorInfo[1] ?? 0) === 1062) // 같은 서버 채널명 중복
            {
                throw new ManagementException('CHANNEL_NAME_TAKEN', 409); // 트랜잭션 취소 후 응답
            }
            throw $error; // 실제 DB 실패 처리
        }
        return ['data' => ['channel' => ['id' => $id, 'server_id' => (string) $server['id'], 'server_name' => $server['name'], 'name' => $input['name']]], 'status' => $operation === 'create_channel' ? 201 : 200]; // 기존 목록과 같은 공개 객체
    }); // 전체 업무 종료
}
