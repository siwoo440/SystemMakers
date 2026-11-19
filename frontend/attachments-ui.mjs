const validId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 정밀한 문자열 식별자
function validAttachment(attachment) // 공개 첨부 정보 검사
{
    return attachment && validId(attachment.id) && validId(attachment.message_id) && typeof attachment.original_name === "string" && attachment.original_name.length > 0 && Number.isInteger(attachment.file_size) && attachment.file_size > 0 && attachment.file_size <= 5242880; // 안전한 이름과 크기
}
export function createAttachmentView({ kind, targetId, userId, getUser, request, onChange, onError }) // 한 대화의 첨부 조회 수명
{
    let version = 0; // 종료된 요청 구분
    let pending = null; // 중복 조회 차단
    let controller = null; // 요청 취소 도구
    const checked = new Set(); // 확인한 메시지 ID
    const queued = new Set(); // 파일 조회를 기다리는 메시지 ID
    const attachments = new Map(); // 메시지별 첨부 정보
    async function load(messages) // 표시한 메시지의 첨부 조회
    {
        if (getUser()?.id !== userId) // 계정 전환 여부
        {
            return; // 다른 계정의 파일 조회 차단
        }
        for (const message of messages) // 이번 페이지의 기록
        {
            if (validId(message.id) && !checked.has(message.id)) // 확인하지 않은 메시지
            {
                queued.add(message.id); // 중복 없는 조회 대기열
            }
        }
        if (pending || !queued.size) // 기존 조회 또는 빈 대기열
        {
            return pending; // 진행 중인 조회 공유
        }
        const requestVersion = version; // 현재 대화 수명
        const requestController = new AbortController(); // 이번 요청 취소 도구
        controller = requestController; // 전환 시 취소 연결
        pending = (async () => // 최대 50개씩 순차 확인
        {
            try // 권한을 포함한 첨부 조회
            {
                while (queued.size && requestVersion === version && getUser()?.id === userId) // 현재 계정의 미완료 기록
                {
                    const batch = []; // 현재 조회 묶음
                    for (const messageId of queued) // 오래된 요청부터 선택
                    {
                        batch.push(messageId); // 묶음에 메시지 추가
                        if (batch.length === 50) // 서버의 조회 상한
                        {
                            break; // 다음 묶음으로 나머지 이월
                        }
                    }
                    const query = new URLSearchParams({ kind, target_id: targetId, message_ids: batch.join(",") }); // 공개 조회 조건
                    const response = await request("./backend/api/list_attachments.php?" + query, null, requestController.signal); // 현재 계정 권한 확인
                    if (requestVersion !== version || getUser()?.id !== userId) // 다른 계정 또는 대화 수명
                    {
                        return; // 이전 결과 무시
                    }
                    if (!Array.isArray(response.attachments) || response.attachments.some((attachment) => !validAttachment(attachment) || !batch.includes(attachment.message_id)) || new Set(response.attachments.map((attachment) => attachment.message_id)).size !== response.attachments.length) // 대상과 공개 계약 확인
                    {
                        throw new Error("파일 정보를 확인하지 못했습니다."); // 잘못된 응답 거절
                    }
                    response.attachments.forEach((attachment) => attachments.set(attachment.message_id, attachment)); // 확인된 파일 정보 보관
                    batch.forEach((id) => checked.add(id)); // 첨부 없는 기록도 확인 완료
                    batch.forEach((id) => queued.delete(id)); // 성공한 묶음만 대기열에서 제거
                    if (response.attachments.length) // 표시할 파일 존재 여부
                    {
                        onChange(); // 현재 화면의 링크 갱신
                    }
                }
            }
            catch (error) // 통신 또는 권한 실패
            {
                if (requestVersion === version && getUser()?.id === userId) // 현재 계정의 실패
                {
                    onError(error); // 자동 재시도 전 실제 오류 안내
                }
            }
        })(); // 실제 비동기 조회 시작
        await pending; // 묶음 조회 종료
        if (requestVersion === version) // 현재 수명의 요청 정리
        {
            pending = null; // 다음 메시지 조회 허용
            controller = null; // 완료된 취소 도구 제거
        }
    }
    function stop() // 계정 또는 대화 전환
    {
        version++; // 늦은 응답 무효화
        controller?.abort(); // 진행 조회 취소
        controller = null; // 취소 도구 제거
        pending = null; // 새 수명의 조회 허용
    }
    function add(attachment) // 확정된 업로드 결과 보관
    {
        if (!validAttachment(attachment)) // 공개 첨부 정보 검사
        {
            throw new Error("파일 저장 결과를 확인하지 못했습니다."); // 잘못된 결과 거절
        }
        attachments.set(attachment.message_id, attachment); // 해당 메시지에 파일 연결
        checked.add(attachment.message_id); // 같은 정보 중복 조회 방지
        queued.delete(attachment.message_id); // 대기 중인 업로드 결과 정리
    }
    return { load, stop, add, get: (messageId) => attachments.get(messageId) || null }; // 조회와 표시 경계
}
export async function uploadAttachment({ kind, targetId, userId, file, request }) // 선택한 파일 한 번 전송
{
    if (!["channel", "direct"].includes(kind) || !validId(targetId) || !validId(userId) || !file || file.size < 1 || file.size > 5242880) // 대화와 실제 파일 크기 검사
    {
        throw new Error("파일은 1바이트부터 약 5.24 MB까지 선택할 수 있습니다."); // 업로드 제한 안내
    }
    const body = new FormData(); // 브라우저 multipart 본문
    body.append("kind", kind); // 대화 유형
    body.append("target_id", targetId); // 대화 식별자
    body.append("file", file); // 선택한 실제 파일
    const response = await request("./backend/api/upload_attachment.php", body); // 인증과 CSRF 보호 전송
    const message = response.message; // 실제 저장 메시지
    const attachment = response.attachment; // 실제 저장 파일
    if (!validAttachment(attachment) || !message || !validId(message.id) || message.id !== attachment.message_id || message.user_id !== userId || message[kind === "channel" ? "channel_id" : "conversation_id"] !== targetId || attachment.original_name !== file.name || attachment.file_size !== file.size) // 응답 대상과 파일 일치 검사
    {
        throw new Error("파일 저장 결과를 확인하지 못했습니다."); // 불확실한 결과 안내
    }
    return response; // 확인된 저장 결과
}
