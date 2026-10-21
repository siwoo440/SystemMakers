function validId(value, zero = false) // 정밀도를 유지하는 문자열 ID 검사
{
    return typeof value === "string" && ((zero && value === "0") || (/^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"))); // 부호 없는 64비트 범위
}
function compareId(left, right) // Number 변환 없는 ID 비교
{
    return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0); // 자리 수와 사전 순서 비교
}
function validMessage(item, channelId) // 공개 메시지 계약 검사
{
    return item && validId(item.id) && item.channel_id === channelId && validId(item.user_id) && typeof item.username === "string" && item.username.length > 0 && typeof item.content === "string" && typeof item.created_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(item.created_at) && !Number.isNaN(Date.parse(item.created_at)); // 안전한 표시 필드와 실제 날짜
}
export class MessageFeed // 채널 하나의 기록과 조회 수명 관리
{
    constructor({ channelId, request, onChange, onError, setTimer = (callback, delay) => globalThis.setTimeout(callback, delay), clearTimer = (id) => globalThis.clearTimeout(id) }) // 전역 호출을 유지하는 타이머 경계
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
    }
    list() // 화면 표시용 기록 목록
    {
        return [...this.items.values()].sort((left, right) => compareId(left.id, right.id)); // 큰 ID의 오름차순
    }
    renameUser(userId, username) // 같은 작성자의 메모리 표시 이름 갱신
    {
        for (const [id, item] of this.items) // 현재 보관한 기록
        {
            if (item.user_id === userId) // 본인 작성 기록만
            {
                this.items.set(id, { ...item, username }); // 대화 ID·본문·시각 보존
            }
        }
        this.onChange({ kind: "profile", added: 0 }); // 조회 커서와 예약을 유지한 표시 갱신
    }
    add(item) // 확인한 전송 성공 응답 병합
    {
        if (this.blocked) // 전송 응답 대기 중 권한 상실 여부
        {
            return; // 늦은 성공 응답의 대화 복원 차단
        }
        if (!validMessage(item, this.channelId)) // 전송 응답 계약 확인
        {
            throw new Error("저장된 메시지 응답을 확인하지 못했습니다."); // 미확인 자료 거절
        }
        const added = this.items.has(item.id) ? 0 : 1; // 중복된 전송 응답 구분
        this.items.set(item.id, item); // 전송 결과 보관
        this.onChange({ kind: "send", added }); // 조회 커서를 변경하지 않는 화면 갱신
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
    }
    block(error) // 조회와 전송의 공통 접근 종료
    {
        this.pause(); // 활성 여부와 무관한 조회·예약 취소
        this.blocked = true; // 소속 재확인 전 접근 차단
        this.items.clear(); // 과거 대화 즉시 제거
        this.hasOlder = false; // 이전 기록 요청 차단
        this.loaded = false; // 확인된 접근 상태 폐기
        this.oldest = null; // 과거 기록 커서 제거
        this.after = "0"; // 신규 기록 커서 제거
        this.error = error; // 실제 거절 사유 보관
        this.onChange({ kind: "error", added: 0 }); // 비활성 채널도 기록 정리 반영
        this.onError(error); // 인증 복구 또는 권한 안내
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
    validate(data, mode, cursor) // 응답 전체를 적용 전에 확인
    {
        const records = data?.messages; // 실제 응답 목록
        const pagination = data?.pagination; // 실제 응답 커서
        if (!Array.isArray(records) || records.length > 50 || !pagination || pagination.mode !== mode || typeof pagination.has_more !== "boolean" || records.some((item, index) => !validMessage(item, this.channelId) || (index > 0 && compareId(records[index - 1].id, item.id) >= 0) || (mode === "after" && compareId(item.id, cursor) <= 0) || (mode === "before" && compareId(item.id, cursor) >= 0))) // 다른 채널과 잘못된 범위·순서 차단
        {
            throw new Error("대화 조회 응답을 확인하지 못했습니다."); // 일부 자료 적용 전 거절
        }
        const minimum = records[0]?.id ?? null; // 실제 최소 ID
        const maximum = records.at(-1)?.id ?? (mode === "after" ? cursor : "0"); // 실제 최대 ID 또는 빈 조회 기준
        if (pagination.next_before_id !== minimum || pagination.next_after_id !== maximum || !validId(maximum, true) || (records.length === 0 && pagination.has_more)) // 실제 기록과 커서 일치 확인
        {
            throw new Error("대화 조회 기준을 확인하지 못했습니다."); // 잘못된 커서 전진 차단
        }
    }
    async run(mode) // 단일 요청과 연속 신규 페이지 처리
    {
        if (!this.active || this.busy || this.blocked) // 수명과 중복 요청 검사
        {
            return; // 종료되었거나 진행 중인 조회 중단
        }
        this.clearTimer(this.timer); // 이전 후속 예약 취소
        this.timer = null; // 예약 참조 제거
        const version = this.version; // 요청 당시 수명 번호
        const controller = new AbortController(); // 이번 조회 취소 도구
        this.controller = controller; // 외부 종료용 도구 보관
        this.busy = true; // 조회 중복 차단
        this.onChange({ kind: "loading", added: 0 }); // 조회 상태 표시
        try // 실제 조회와 응답 검증
        {
            let more; // 신규 적체의 다음 페이지 여부
            do // 신규 적체 페이지 순차 소진
            {
                const cursor = mode === "before" ? this.oldest : this.after; // 방향별 독립 커서
                const query = new URLSearchParams({ channel_id: this.channelId, limit: "50" }); // 고정 페이지 크기
                if (mode !== "initial") // 방향 커서 존재 여부
                {
                    query.set(mode === "before" ? "before_id" : "after_id", cursor); // 배타적 조회 범위
                }
                const data = await this.request(query, controller.signal); // 실제 네트워크 경계 호출
                if (version !== this.version || !this.active) // 채널 이동과 계정 변경 확인
                {
                    return; // 늦은 응답과 후속 예약 무시
                }
                this.validate(data, mode, cursor); // 전체 응답의 원자적 검증
                let added = 0; // 새롭게 표시할 메시지 수
                for (const item of data.messages) // 검증된 기록 순회
                {
                    added += this.items.has(item.id) ? 0 : 1; // 이미 표시한 전송 결과 중복 제거
                    this.items.set(item.id, item); // 실제 조회 자료 병합
                }
                if (mode === "initial" || mode === "before") // 과거 범위 응답 여부
                {
                    this.oldest = data.pagination.next_before_id ?? this.oldest; // 확인된 최소 범위
                    this.hasOlder = data.pagination.has_more; // 과거 기록 버튼 기준
                }
                if (mode !== "before") // 신규 커서를 바꿀 수 있는 응답 여부
                {
                    this.after = data.pagination.next_after_id; // 실제 조회 결과로만 전진
                    this.oldest ??= data.pagination.next_before_id; // 처음 생성된 메시지의 과거 기준
                }
                this.loaded = true; // 최초 기록 확인 완료
                this.error = null; // 이전 조회 오류 제거
                this.failures = 0; // 정상 연결 대기 간격 복구
                this.onChange({ kind: mode, added }); // 검증된 기록과 상태 표시
                more = mode === "after" && data.pagination.has_more; // 신규 적체만 연속 조회
            }
            while (more && version === this.version && this.active); // 같은 채널 수명에서 순차 진행
        }
        catch (error) // 통신과 계약 및 권한 오류
        {
            if (version !== this.version || !this.active) // 취소된 요청의 실패 여부
            {
                return; // 이전 실패가 현재 화면을 바꾸지 않도록 중단
            }
            this.error = error; // 실제 조회 실패 보관
            this.failures += 1; // 재연결 대기 증가
            if ([401, 403, 404].includes(error.status)) // 인증과 채널 권한 종료
            {
                this.block(error); // 조회와 전송에 같은 접근 종료 경계
                return; // 종료된 수명의 후속 예약 차단
            }
            this.onChange({ kind: "error", added: 0 }); // 실제 오류와 목록 상태 표시
            this.onError(error); // 인증 복구와 권한 안내 연결
        }
        finally // 현재 수명의 요청 자원 정리
        {
            if (version === this.version) // 여전히 같은 채널 수명 여부
            {
                this.busy = false; // 조회 잠금 해제
                this.controller = null; // 완료된 취소 도구 제거
                this.onChange({ kind: "state", added: 0 }); // 버튼과 갱신 상태 복구
                if (this.active && !this.blocked) // 일반 폴링 가능 여부
                {
                    const delay = Math.min(30000, 2000 * (2 ** Math.min(this.failures, 4))); // 최대 30초 오류 대기
                    this.timer = this.setTimer(() => this.run(this.loaded ? "after" : "initial"), delay); // 완료 후 다음 조회 예약
                }
            }
        }
    }
}
