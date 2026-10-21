<?php // 채널별 이전 기록과 신규 메시지 조회
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/messages.php'; // 공개 메시지 변환과 권한 오류
function read_messages(PDO $pdo, string $channel_id, string $user_id, int $limit, ?string $before, ?string $after): array // 권한과 페이지를 함께 확인하는 조회
{
    if ($pdo->inTransaction()) // 중첩 트랜잭션 검사
    {
        throw new LogicException('History transaction already active.'); // 내부 호출 오류
    }
    $mode = $before !== null ? 'before' : ($after !== null ? 'after' : 'initial'); // 조회 방향 결정
    try // 권한 잠금과 조회 결과의 원자적 처리
    {
        $pdo->beginTransaction(); // 권한 확인과 조회 시작
        $channel_query = $pdo->prepare('SELECT id, server_id FROM channels WHERE id = :id LIMIT 1 FOR SHARE'); // 조회 중 채널 삭제 방지
        $channel_query->execute(['id' => $channel_id]); // 실제 채널 공유 잠금
        $channel = $channel_query->fetch(); // 현재 채널과 서버
        if ($channel === false) // 채널 존재 확인
        {
            throw new MessageAccessException('CHANNEL_NOT_FOUND', 404); // 롤백 후 존재 오류
        }
        $member_query = $pdo->prepare('SELECT user_id FROM server_members WHERE server_id = :server AND user_id = :user LIMIT 1 FOR SHARE'); // 조회 중 탈퇴와 강퇴 방지
        $member_query->execute(['server' => (string) $channel['server_id'], 'user' => $user_id]); // 현재 소속 공유 잠금
        if ($member_query->fetchColumn() === false) // 현재 소속 확인
        {
            throw new MessageAccessException('FORBIDDEN', 403); // 롤백 후 접근 거절
        }
        $condition = $before !== null ? ' AND m.id < :cursor' : ($after !== null ? ' AND m.id > :cursor' : ''); // 검증한 방향의 고정 SQL
        $order = $mode === 'after' ? 'ASC' : 'DESC'; // 가까운 이전 또는 신규 기록 선택
        $query = $pdo->prepare('SELECT m.id, m.channel_id, m.user_id, u.username, m.content, m.created_at FROM messages m JOIN users u ON u.id = m.user_id WHERE m.channel_id = :channel' . $condition . ' ORDER BY m.id ' . $order . ' LIMIT :count'); // 채널과 인덱스 범위 조회
        $query->bindValue(':channel', $channel_id, PDO::PARAM_STR); // 큰 채널 ID 정밀도 유지
        if ($mode !== 'initial') // 범위 커서 존재 여부
        {
            $query->bindValue(':cursor', $before ?? $after, PDO::PARAM_STR); // 큰 메시지 ID 정밀도 유지
        }
        $query->bindValue(':count', $limit + 1, PDO::PARAM_INT); // 다음 페이지 판정용 한 개 추가
        $query->execute(); // 실제 메시지 범위 조회
        $rows = $query->fetchAll(); // 선택한 범위의 원문 기록
        $has_more = count($rows) > $limit; // 같은 방향의 남은 기록 여부
        if ($has_more) // 추가 판정 행 존재 여부
        {
            array_pop($rows); // 응답 개수 상한 유지
        }
        if ($mode !== 'after') // 이전 방향으로 선택한 기록 여부
        {
            $rows = array_reverse($rows); // 화면 표시용 ID 오름차순
        }
        $messages = array_map('public_message', $rows); // 비밀 없는 공개 메시지 변환
        $pagination = ['mode' => $mode, 'has_more' => $has_more, 'next_before_id' => $messages === [] ? null : $messages[0]['id'], 'next_after_id' => $messages === [] ? ($after ?? '0') : $messages[count($messages) - 1]['id']]; // 실제 반환 목록의 최소·최대 커서
        $pdo->commit(); // 응답 전 전체 잠금 해제
        return ['messages' => $messages, 'pagination' => $pagination]; // 권한이 확인된 페이지 반환
    }
    catch (Throwable $exception) // 권한과 DB 및 변환 실패
    {
        if ($pdo->inTransaction()) // 남은 조회 트랜잭션 확인
        {
            $pdo->rollBack(); // 모든 실패의 잠금 해제
        }
        throw $exception; // 공통 응답 처리기로 전달
    }
}
