<?php // 본인 프로필 조회·사용자명 변경 API
declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/../includes/bootstrap.php'; // 기존 인증·보호·JSON 경계
require_once __DIR__ . '/../includes/accounts.php'; // 가입과 동일한 사용자명 규칙
require_method(['GET', 'PATCH']); // 조회와 명시적 부분 변경
$pdo = db(); // 실제 계정 저장 연결
$user = require_user($pdo); // 세션과 기대 계정 확인
if ($_SERVER['REQUEST_METHOD'] === 'GET') // 본인 정보 조회
{
    require_query_fields([]); // 대상 ID와 미허용 조회 조건 차단
    close_session(); // 읽은 세션 잠금 해제
    respond_success(['user' => $user]); // 본인 공개 정보만
}
$body = read_json_body(); // 크기·JSON·문자 검증
require_csrf(); // 상태 변경 요청 보호
require_body_fields($body, ['username']); // 본인 사용자명만 허용
$username = validate_username($body['username']); // 기존 가입 정규화
close_session(); // DB 잠금 전 세션 해제
try // 변경과 응답 자료의 원자성
{
    $pdo->beginTransaction(); // 변경 시작
    $query = $pdo->prepare('SELECT id FROM users WHERE id=:id FOR UPDATE'); // 같은 계정 변경 직렬화
    $query->execute(['id' => $user['id']]); // 세션의 본인 ID
    if ($query->fetchColumn() === false) // 인증 확인 뒤 계정 삭제
    {
        $pdo->rollBack(); // 변경 없는 종료
        respond_error('UNAUTHORIZED', '로그인이 필요합니다.', 401); // 삭제된 계정 사용 차단
    }
    $query = $pdo->prepare('UPDATE users SET username=:username WHERE id=:id'); // ID·이메일·암호·가입일 유지
    $query->execute(['username' => $username, 'id' => $user['id']]); // UNIQUE 제약으로 경쟁 중복 보호
    $query = $pdo->prepare('SELECT id,username,email,created_at FROM users WHERE id=:id'); // 커밋할 실제 공개 정보
    $query->execute(['id' => $user['id']]); // 같은 잠금 안 본인 조회
    $updated = public_account($query->fetch()); // 문자열 ID와 UTC 시각
    $pdo->commit(); // 성공한 변경만 확정
}
catch (Throwable $error) // 부분 변경과 DB 실패 정리
{
    if ($pdo->inTransaction()) // 아직 미확정인 변경
    {
        $pdo->rollBack(); // 전체 변경 취소
    }
    if ($error instanceof PDOException && (int) ($error->errorInfo[1] ?? 0) === 1062) // 사용자명 고유 값 충돌
    {
        respond_error('USERNAME_TAKEN', '이미 사용 중인 사용자명입니다.', 409, ['username' => '다른 사용자명을 입력하세요.']); // 필드별 중복 안내
    }
    throw $error; // 공통 내부 오류 변환
}
respond_success(['user' => $updated]); // 같은 이름 재저장도 정상 200
