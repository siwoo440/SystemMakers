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
    const attachments = new Map(); // 메시지별 첨부 정보
    async function load(messages) // 표시한 메시지의 첨부 조회
    {
        const invocationVersion = version; // 조회를 요청한 대화 수명
        if (pending) // 현재 조회 진행 여부
        {
            await pending; // 앞선 조회 종료 대기
        }
        if (invocationVersion !== version || getUser()?.id !== userId) // 종료된 대화 또는 계정 여부
        {
            return; // 다른 계정 조회 차단
        }
        const ids = [...new Set(messages.map((message) => message.id))].filter((id) => validId(id) && !checked.has(id)); // 아직 확인하지 않은 메시지
        if (!ids.length) // 추가 조회 대상 없음
        {
            return; // 불필요한 요청 중단
        }
        const requestVersion = version; // 현재 대화 수명
        const requestController = new AbortController(); // 이번 요청 취소 도구
        controller = requestController; // 전환 시 취소 연결
        pending = (async () => // 최대 50개씩 순차 확인
        {
            try // 권한을 포함한 첨부 조회
            {
                for (let offset = 0; offset < ids.length; offset += 50) // 서버 조회 상한
                {
                    const batch = ids.slice(offset, offset + 50); // 현재 메시지 묶음
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
                    onChange(); // 현재 화면의 링크 갱신
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
    }
    return { load, stop, add, get: (messageId) => attachments.get(messageId) || null }; // 조회와 표시 경계
}
export async function uploadAttachment({ kind, targetId, userId, file, request }) // 선택한 파일 한 번 전송
{
    if (!["channel", "direct"].includes(kind) || !validId(targetId) || !validId(userId) || !file || file.size < 1 || file.size > 5242880) // 대화와 실제 파일 크기 검사
    {
        throw new Error("파일은 1바이트부터 5 MiB까지 선택할 수 있습니다."); // 업로드 제한 안내
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
