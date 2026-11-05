<?php // 기존 가입 계정의 개발용 채팅 공간 준비
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    http_response_code(404); // 비공개 스크립트 상태
    exit; // 웹 호출 종료
}
if (!in_array(getenv('APP_ENV'), ['development', 'test'], true)) // 개발과 테스트 환경 제한
{
    fwrite(STDERR, "개발 또는 테스트 환경에서만 실행할 수 있습니다.\n"); // 운영 실행 거절 안내
    exit(1); // 실패 종료 상태
}
require_once __DIR__ . '/../backend/config/database.php'; // 명시적 환경 설정의 PDO 연결
$databaseConnection = null; // 롤백할 연결 보관
try // 부분 생성과 비밀 오류 노출 방지
{
    $commandOptions = getopt('', ['owner:', 'member:'], $argumentEnd); // 기존 계정 지정 옵션
    if ($argumentEnd !== count($argv) || !isset($commandOptions['owner']) || !is_string($commandOptions['owner'])) // 미지원 인수와 소유자 누락 확인
    {
        throw new InvalidArgumentException('Invalid arguments.'); // 잘못된 실행 인수 차단
    }
    $ownerName = strtolower(trim($commandOptions['owner'])); // 소유자 사용자명 정규화
    $members = $commandOptions['member'] ?? []; // 선택한 추가 멤버 목록
    $members = is_array($members) ? $members : [$members]; // 반복 옵션 자료형 통일
    $usernames = [$ownerName]; // 소유자를 포함한 대상 목록
    foreach ($members as $member) // 명시한 추가 계정 순회
    {
        if (!is_string($member)) // 잘못된 옵션 값 확인
        {
            throw new InvalidArgumentException('Invalid member.'); // 비문자 계정 차단
        }
        $usernames[] = strtolower(trim($member)); // 멤버 사용자명 정규화
    }
    $usernames = array_values(array_unique($usernames)); // 중복 계정 제거
    foreach ($usernames as $username) // 허용된 사용자명 검증
    {
        if (!preg_match('/\A[a-z0-9_가-힣]{2,32}\z/uD', $username)) // 가입 계약과 같은 사용자명 범위
        {
            throw new InvalidArgumentException('Invalid username.'); // 잘못된 계정 입력 거절
        }
    }
    $databaseConnection = db(); // 준비 대상 DB 연결
    $databaseConnection->beginTransaction(); // 전체 개발 데이터 원자성 시작
    $userLookup = $databaseConnection->prepare('SELECT id, username FROM users WHERE username IN (' . implode(',', array_fill(0, count($usernames), '?')) . ') ORDER BY id FOR UPDATE'); // 기존 계정의 일관된 잠금 순서
    $userLookup->execute($usernames); // 준비할 실제 계정 조회
    $userIdsByName = array_column($userLookup->fetchAll(), 'id', 'username'); // 사용자명별 실제 ID
    if (count($userIdsByName) !== count($usernames)) // 가입되지 않은 대상 확인
    {
        throw new RuntimeException('Account missing.'); // 임의 계정 생성 차단
    }
    $ownerId = (string) $userIdsByName[$ownerName]; // 실제 소유자 ID
    $serverName = 'SystemMakers 개발 서버'; // 개발 전용 공간 이름
    $serverLookup = $databaseConnection->prepare('SELECT id FROM servers WHERE owner_id = :owner AND name = :name ORDER BY id LIMIT 1 FOR UPDATE'); // 같은 소유자의 준비된 공간 확인
    $serverLookup->execute(['owner' => $ownerId, 'name' => $serverName]); // 반복 실행 대상 조회
    $serverId = $serverLookup->fetchColumn(); // 기존 공간 또는 없음
    if ($serverId === false) // 최초 실행 여부
    {
        $serverInsert = $databaseConnection->prepare('INSERT INTO servers (name, owner_id) VALUES (:name, :owner)'); // 개발 공간 생성 쿼리
        $serverInsert->execute(['name' => $serverName, 'owner' => $ownerId]); // 실제 소유자 지정
        $serverId = $databaseConnection->lastInsertId(); // 생성된 서버 문자열 ID
    }
    foreach ($userIdsByName as $memberId) // 지정한 기존 계정만 소속 준비
    {
        $isOwner = (string) $memberId === $ownerId; // 서버 소유자 여부
        $memberInsert = $databaseConnection->prepare('INSERT INTO server_members (server_id, user_id, role) VALUES (:server, :user, :role) ON DUPLICATE KEY UPDATE role = ' . ($isOwner ? "'owner'" : 'role')); // 기존 일반 멤버의 관리 역할 보존
        $memberInsert->execute(['server' => $serverId, 'user' => $memberId, 'role' => $isOwner ? 'owner' : 'member']); // 서버 소속 준비
    }
    foreach (['일반', '개발', '공지'] as $channelName) // 최초 개발 채널 목록
    {
        $channelInsert = $databaseConnection->prepare('INSERT INTO channels (server_id, name) VALUES (:server, :name) ON DUPLICATE KEY UPDATE name = name'); // 기존 채널을 지우지 않는 생성
        $channelInsert->execute(['server' => $serverId, 'name' => $channelName]); // 중복 없는 채널 준비
    }
    $channelQuery = $databaseConnection->prepare('SELECT id FROM channels WHERE server_id = :server ORDER BY id'); // 준비한 채널 식별자 조회
    $channelQuery->execute(['server' => $serverId]); // 실제 결과 조회
    $channelIds = array_map('strval', $channelQuery->fetchAll(PDO::FETCH_COLUMN)); // 문자열 ID 배열
    $databaseConnection->commit(); // 전체 개발 데이터 준비 확정
    fwrite(STDOUT, json_encode(['success' => true, 'data' => ['server_id' => (string) $serverId, 'channel_ids' => $channelIds]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n"); // 비밀 없는 준비 결과
}
catch (Throwable $caughtException) // 설정과 계정 및 SQL 오류 처리
{
    if ($databaseConnection instanceof PDO && $databaseConnection->inTransaction()) // 부분 데이터 생성 여부
    {
        $databaseConnection->rollBack(); // 전체 준비 취소
    }
    fwrite(STDERR, "개발 데이터 준비에 실패했습니다. 환경 설정과 기존 사용자명을 확인하세요.\n"); // 접속 정보 없는 오류 안내
    exit(1); // 실패 종료 상태
}
