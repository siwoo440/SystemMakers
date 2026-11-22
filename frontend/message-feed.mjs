import { validAttachment } from "./attachments-ui.mjs"; // 기록에 포함된 첨부 정보 검증
function validId(identifierValue, allowZero = false) // 정밀도를 유지하는 문자열 ID 검사
{
    return typeof identifierValue === "string" && ((allowZero && identifierValue === "0") || (/^[1-9][0-9]{0,19}$/.test(identifierValue) && (identifierValue.length < 20 || identifierValue <= "18446744073709551615"))); // 부호 없는 64비트 범위
}
function compareId(leftId, rightId) // Number 변환 없는 ID 비교
{
    return leftId.length - rightId.length || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0); // 자리 수와 사전 순서 비교
}
function validMessage(messageEntry, channelId) // 공개 메시지 계약 검사
{
    if (messageEntry && Object.hasOwn(messageEntry, "attachment") && messageEntry.attachment !== null && (!validAttachment(messageEntry.attachment) || messageEntry.attachment.message_id !== messageEntry.id)) // 다른 메시지 또는 잘못된 파일 정보
    {
        return false; // 페이지 전체 반영 거절
    }
    return messageEntry && validId(messageEntry.id) && messageEntry.channel_id === channelId && validId(messageEntry.user_id) && typeof messageEntry.username === "string" && messageEntry.username.length > 0 && typeof messageEntry.content === "string" && typeof messageEntry.created_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(messageEntry.created_at) && !Number.isNaN(Date.parse(messageEntry.created_at)); // 안전한 표시 필드와 실제 날짜
}
export function messageForDisplay(message, viewer, attachments) // 채널과 개인 대화의 공통 말풍선 자료
{
    const isOwn = message.user_id === viewer.id; // 현재 사용자의 글 여부
    return { // 말풍선에 표시할 값
        id: message.id, // 재사용할 메시지 ID
        isOwn, // 본인 말풍선 방향
        name: isOwn ? viewer.username : message.username, // 현재 작성자 이름
        timestamp: message.created_at, // 저장 시각
        text: message.content, // 원문 텍스트
        attachment: Object.hasOwn(message, "attachment") ? message.attachment : attachments?.get(message.id) // 기록의 파일 정보 또는 이전 응답의 캐시
    };
}
export function createMessageList(container, createBubble) // 대화별 말풍선 재사용
{
    let owner = null; // 현재 화면의 대화
    const rendered = new Map(); // 메시지 ID별 표시 값과 요소
    return function renderMessages(conversation, records) // ID 오름차순 목록 반영
    {
        if (owner !== conversation || !records.length) // 대화 전환 또는 접근 종료
        {
            container.replaceChildren(); // 이전 대화 내용 제거
            rendered.clear(); // 이전 요소 참조 해제
            owner = conversation; // 새 대화 경계
        }
        let anchor = null; // 다음 메시지의 화면 위치
        for (let index = records.length - 1; index >= 0; index--) // 뒤쪽 고정 위치부터 반영
        {
            const message = records[index]; // 현재 표시 자료
            const previous = rendered.get(message.id); // 이전 말풍선 상태
            const old = previous?.message; // 이전 표시 값
            let node = previous?.node; // 재사용할 화면 요소
            const sameContent = old && old.isOwn === message.isOwn && old.name === message.name && old.timestamp === message.timestamp && old.text === message.text; // 글과 작성자 표시 일치
            const sameAttachment = old?.attachment?.id === message.attachment?.id && old?.attachment?.original_name === message.attachment?.original_name && old?.attachment?.file_size === message.attachment?.file_size; // 다운로드 링크와 안내 일치
            if (!sameContent || !sameAttachment) // 새 말풍선 또는 표시 변경
            {
                node = createBubble(message); // 추가 또는 변경된 말풍선 생성
                if (previous) // 기존 메시지 변경
                {
                    container.replaceChild(node, previous.node); // 해당 말풍선만 교체
                }
                else // 새 메시지 추가
                {
                    container.insertBefore(node, anchor); // 과거·신규 기록 순서 보존
                }
                rendered.set(message.id, { message, node }); // 변경된 말풍선만 보관
            }
            anchor = node; // 앞 메시지의 삽입 기준
        }
        if (rendered.size > records.length) // 일부 기록이 빠진 목록
        {
            const visibleIds = new Set(records.map((message) => message.id)); // 남아 있는 메시지 ID
            for (const [id, entry] of rendered) // 제거할 말풍선 확인
            {
                if (!visibleIds.has(id)) // 현재 대화에서 사라진 메시지
                {
                    container.removeChild(entry.node); // 화면에서 제거
                    rendered.delete(id); // 이전 요소 참조 해제
                }
            }
        }
    };
}
export class MessageFeed // 채널 또는 개인 대화 한 곳의 기록·조회 주기 관리
{
    constructor({ channelId, request, onChange, onError, setTimer = (callback, retryDelay) => globalThis.setTimeout(callback, retryDelay), clearTimer = (timerId) => globalThis.clearTimeout(timerId) }) // 전역 호출을 유지하는 타이머 경계
    {
        Object.assign(this, { channelId, request, onChange, onError, setTimer, clearTimer }); // 전달받은 동작 연결
        this.items = new Map(); // ID별 중복 없는 메시지
        this.after = "0"; // 조회 응답으로만 전진하는 신규 커서
        this.oldest = null; // 이전 기록 조회용 최소 ID
        this.hasOlder = false; // 추가 과거 기록 여부
        this.loaded = false; // 최초 조회 성공 여부
        this.active = false; // 현재 선택한 채널 여부
        this.blocked = false; // 권한 상실 여부
        this.busy = false; // 중복 조회 차단 상태
        this.error = null; // 최근 조회 실패
        this.failures = 0; // 연속 조회 실패 횟수
        this.version = 0; // 취소된 응답 구분 번호
        this.timer = null; // 후속 조회 예약
        this.controller = null; // 진행 중 요청 취소 도구
        this.realtimeActive = false; // 실시간 구독 상태
        this.refreshRequested = false; // 조회 중 알림의 후속 확인
    }
    scheduleNext() // 현재 상태에 맞는 후속 조회 예약
    {
        this.clearTimer(this.timer); // 이전 예약 제거
        this.timer = null; // 예약 참조 초기화
        if (!this.active || this.blocked || this.busy) // 조회 불가 상태
        {
            return; // 불필요한 예약 중단
        }
        const retryDelay = this.refreshRequested ? 0 : this.failures ? Math.min(30000, 2000 * (2 ** Math.min(this.failures, 4))) : this.realtimeActive ? 15000 : 2000; // 알림·오류·연결별 대기
        this.timer = this.setTimer(() => this.run(this.loaded ? "after" : "initial"), retryDelay); // 현재 커서의 후속 조회
    }
    setRealtimeActive(available) // 실제 구독 승인 상태 변경
    {
        if (this.realtimeActive === available) // 같은 상태 여부
        {
            return; // 불필요한 예약 변경 방지
        }
        this.realtimeActive = available; // 현재 구독 상태 보관
        if (this.timer !== null) // 대기 중인 조회 여부
        {
            this.scheduleNext(); // 새 연결 상태의 간격 적용
        }
    }
    requestRealtimeRefresh() // 새 메시지 알림 처리
    {
        if (!this.active || this.blocked) // 활성 대화와 권한 확인
        {
            return; // 종료된 대화 알림 무시
        }
        if (this.busy) // 다른 조회 진행 여부
        {
            this.refreshRequested = true; // 완료 직후 재확인 요청
            return; // 기존 조회와 중복 방지
        }
        return this.run(this.loaded ? "after" : "initial"); // 현재 커서의 즉시 확인
    }
    list() // 화면 표시용 기록 목록
    {
        return [...this.items.values()].sort((leftMessage, rightMessage) => compareId(leftMessage.id, rightMessage.id)); // 큰 ID의 오름차순
    }
    renameUser(userId, username) // 같은 작성자의 메모리 표시 이름 갱신
    {
        for (const [messageId, messageEntry] of this.items) // 현재 보관한 기록
        {
            if (messageEntry.user_id === userId) // 본인 작성 기록만
            {
                this.items.set(messageId, { ...messageEntry, username }); // 대화 ID·본문·시각 보존
            }
        }
        this.onChange({ kind: "profile", added: 0, recordsChanged: true }); // 작성자 이름 표시 갱신
    }
    add(messageEntry) // 확인한 전송 성공 응답 병합
    {
        if (this.blocked) // 전송 응답 대기 중 권한 상실 여부
        {
            return; // 늦은 성공 응답의 대화 복원 차단
        }
        if (!validMessage(messageEntry, this.channelId)) // 전송 응답 계약 확인
        {
            throw new Error("저장된 메시지 응답을 확인하지 못했습니다."); // 미확인 자료 거절
        }
        const addedMessageCount = this.items.has(messageEntry.id) ? 0 : 1; // 중복된 전송 응답 구분
        this.items.set(messageEntry.id, messageEntry); // 전송 결과 보관
        this.onChange({ kind: "send", added: addedMessageCount, recordsChanged: true, messages: [messageEntry] }); // 전송 기록과 첨부 조회 대상
    }
    pause() // 채널 이동과 계정 종료의 요청 정리
    {
        this.version += 1; // 이전 응답 무효화
        this.active = false; // 추가 조회 중단
        this.clearTimer(this.timer); // 후속 조회 예약 취소
        this.timer = null; // 예약 참조 제거
        this.controller?.abort(); // 진행 중 요청 취소
        this.controller = null; // 취소 도구 참조 제거
        this.busy = false; // 이전 요청의 입력 잠금 정리
        this.refreshRequested = false; // 이전 대화 알림 정리
    }
    block(operationError) // 조회와 전송의 공통 접근 종료
    {
        this.pause(); // 활성 여부와 무관한 조회·예약 취소
        this.blocked = true; // 소속 재확인 전 접근 차단
        this.items.clear(); // 과거 대화 즉시 제거
        this.hasOlder = false; // 이전 기록 요청 차단
        this.loaded = false; // 확인된 접근 상태 폐기
        this.oldest = null; // 과거 기록 커서 제거
        this.after = "0"; // 신규 기록 커서 제거
        this.error = operationError; // 실제 거절 사유 보관
        this.onChange({ kind: "error", added: 0, recordsChanged: true }); // 접근이 끝난 기록의 화면 정리
        this.onError(operationError); // 인증 복구 또는 권한 안내
    }
    activate() // 선택한 채널의 조회 시작 또는 재개
    {
        this.pause(); // 이전 조회 수명 정리
        if (this.blocked) // 권한 상실 상태 확인
        {
            return Promise.resolve(); // 목록 재확인 전 조회 차단
        }
        this.active = true; // 현재 채널의 조회 허용
        return this.run(this.loaded ? "after" : "initial"); // 기존 커서 또는 최신 기록 조회
    }
    older() // 사용자가 요청한 과거 기록 조회
    {
        return this.loaded && this.hasOlder ? this.run("before") : Promise.resolve(); // 확인된 이전 범위만 요청
    }
    validate(responseData, fetchMode, messageCursor) // 응답 전체를 적용 전에 확인
    {
        const messageRecords = responseData?.messages; // 실제 응답 목록
        const pagination = responseData?.pagination; // 실제 응답 커서
        if (!Array.isArray(messageRecords) || messageRecords.length > 50 || !pagination || pagination.mode !== fetchMode || typeof pagination.has_more !== "boolean" || messageRecords.some((messageEntry, messageIndex) => !validMessage(messageEntry, this.channelId) || (messageIndex > 0 && compareId(messageRecords[messageIndex - 1].id, messageEntry.id) >= 0) || (fetchMode === "after" && compareId(messageEntry.id, messageCursor) <= 0) || (fetchMode === "before" && compareId(messageEntry.id, messageCursor) >= 0))) // 다른 채널과 잘못된 범위·순서 차단
        {
            throw new Error("대화 조회 응답을 확인하지 못했습니다."); // 일부 자료 적용 전 거절
        }
        const minimumMessageId = messageRecords[0]?.id ?? null; // 실제 최소 ID
        const maximumMessageId = messageRecords.at(-1)?.id ?? (fetchMode === "after" ? messageCursor : "0"); // 실제 최대 ID 또는 빈 조회 기준
        if (pagination.next_before_id !== minimumMessageId || pagination.next_after_id !== maximumMessageId || !validId(maximumMessageId, true) || (messageRecords.length === 0 && pagination.has_more)) // 실제 기록과 커서 일치 확인
        {
            throw new Error("대화 조회 기준을 확인하지 못했습니다."); // 잘못된 커서 전진 차단
        }
    }
    async run(fetchMode) // 단일 요청과 연속 신규 페이지 처리
    {
        if (!this.active || this.busy || this.blocked) // 수명과 중복 요청 검사
        {
            return; // 종료되었거나 진행 중인 조회 중단
        }
        this.clearTimer(this.timer); // 이전 후속 예약 취소
        this.timer = null; // 예약 참조 제거
        this.refreshRequested = false; // 이번 조회에 반영할 알림 정리
        const requestVersion = this.version; // 요청 당시 수명 번호
        const requestController = new AbortController(); // 이번 조회 취소 도구
        this.controller = requestController; // 외부 종료용 도구 보관
        this.busy = true; // 조회 중복 차단
        this.onChange({ kind: "loading", added: 0 }); // 조회 상태 표시
        try // 실제 조회와 응답 검증
        {
            let hasMoreMessages; // 신규 적체의 다음 페이지 여부
            do // 신규 적체 페이지 순차 소진
            {
                const messageCursor = fetchMode === "before" ? this.oldest : this.after; // 방향별 독립 커서
                const messageQuery = new URLSearchParams({ channel_id: this.channelId, limit: "50", include_attachments: "1" }); // 고정 페이지 크기
                if (fetchMode !== "initial") // 방향 커서 존재 여부
                {
                    messageQuery.set(fetchMode === "before" ? "before_id" : "after_id", messageCursor); // 배타적 조회 범위
                }
                const responseData = await this.request(messageQuery, requestController.signal); // 실제 네트워크 경계 호출
                if (requestVersion !== this.version || !this.active) // 채널 이동과 계정 변경 확인
                {
                    return; // 늦은 응답과 후속 예약 무시
                }
                this.validate(responseData, fetchMode, messageCursor); // 전체 응답의 원자적 검증
                let addedMessageCount = 0; // 새롭게 표시할 메시지 수
                for (const messageEntry of responseData.messages) // 검증된 기록 순회
                {
                    addedMessageCount += this.items.has(messageEntry.id) ? 0 : 1; // 이미 표시한 전송 결과 중복 제거
                    this.items.set(messageEntry.id, messageEntry); // 실제 조회 자료 병합
                }
                if (fetchMode === "initial" || fetchMode === "before") // 과거 범위 응답 여부
                {
                    this.oldest = responseData.pagination.next_before_id ?? this.oldest; // 확인된 최소 범위
                    this.hasOlder = responseData.pagination.has_more; // 과거 기록 버튼 기준
                }
                if (fetchMode !== "before") // 신규 커서를 바꿀 수 있는 응답 여부
                {
                    this.after = responseData.pagination.next_after_id; // 실제 조회 결과로만 전진
                    this.oldest ??= responseData.pagination.next_before_id; // 처음 생성된 메시지의 과거 기준
                }
                this.loaded = true; // 최초 기록 확인 완료
                this.error = null; // 이전 조회 오류 제거
                this.failures = 0; // 정상 연결 대기 간격 복구
                this.onChange({ kind: fetchMode, added: addedMessageCount, recordsChanged: fetchMode === "initial" || responseData.messages.length > 0, messages: responseData.messages }); // 표시 변경 여부와 이번 페이지의 첨부 조회 대상
                hasMoreMessages = fetchMode === "after" && responseData.pagination.has_more; // 신규 적체만 연속 조회
            }
            while (hasMoreMessages && requestVersion === this.version && this.active); // 같은 채널 수명에서 순차 진행
        }
        catch (operationError) // 통신과 계약 및 권한 오류
        {
            if (requestVersion !== this.version || !this.active) // 취소된 요청의 실패 여부
            {
                return; // 이전 실패가 현재 화면을 바꾸지 않도록 중단
            }
            this.error = operationError; // 실제 조회 실패 보관
            this.failures += 1; // 재연결 대기 증가
            if ([401, 403, 404].includes(operationError.status)) // 인증과 채널 권한 종료
            {
                this.block(operationError); // 조회와 전송에 같은 접근 종료 경계
                return; // 종료된 수명의 후속 예약 차단
            }
            this.onChange({ kind: "error", added: 0 }); // 실제 오류와 목록 상태 표시
            this.onError(operationError); // 인증 복구와 권한 안내 연결
        }
        finally // 현재 수명의 요청 자원 정리
        {
            if (requestVersion === this.version) // 여전히 같은 채널 수명 여부
            {
                this.busy = false; // 조회 잠금 해제
                this.controller = null; // 완료된 취소 도구 제거
                this.onChange({ kind: "state", added: 0 }); // 버튼과 갱신 상태 복구
                if (this.active && !this.blocked) // 일반 폴링 가능 여부
                {
                    this.scheduleNext(); // 연결 상태별 다음 조회 예약
                }
            }
        }
    }
}
