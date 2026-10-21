const validId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 문자열 ID 계약
export class ServerManager // 계정별 서버 목록과 변경 요청 수명
{
    constructor({ request, getUser, storage = null, onChange = () => undefined }) // 외부 경계 연결
    {
        Object.assign(this, { request, getUser, storage, onChange, servers: [], selected: null, channel: null, identity: null, version: 0, busy: false, loading: false }); // 독립 상태
    }
    storageRead(userId) // 사용자별 선택 ID 복원
    {
        try // 저장소 제한 대응
        {
            const value = JSON.parse(this.storage?.getItem("systemmakers.selection." + userId) || "null"); // 인증 자료 없는 선택
            return value && validId(value.serverId) ? value : null; // 검증한 선택만 사용
        }
        catch // 손상 또는 접근 차단
        {
            return null; // 첫 서버 선택으로 복구
        }
    }
    persist() // 서버·채널 ID만 저장
    {
        try // 비공개 창 저장소 제한 대응
        {
            if (this.identity && this.selected) // 현재 선택 존재 여부
            {
                this.storage?.setItem("systemmakers.selection." + this.identity, JSON.stringify({ serverId: this.selected, channelId: this.channel })); // 최소 선택 값
            }
        }
        catch // 저장 실패 시 메모리 상태 유지
        {
            return; // 채팅 사용은 계속 가능
        }
    }
    reset() // 종료된 계정의 자료와 요청 수명 제거
    {
        try // 이전 선택 삭제
        {
            if (this.identity) // 이전 인증 계정 여부
            {
                this.storage?.removeItem("systemmakers.selection." + this.identity); // 이전 계정 선택 폐기
            }
        }
        catch // 저장소 삭제 거절
        {
            this.storage = null; // 이후 영구 저장 사용 중단
        }
        this.version++; // 이전 비동기 결과 무효화
        Object.assign(this, { identity: null, servers: [], selected: null, channel: null, busy: false, loading: false }); // 계정 자료 초기화
        this.onChange(); // 빈 화면 반영
    }
    async sync() // 실제 소속 서버 전체 확인
    {
        const userId = this.getUser()?.id; // 요청 계정 경계
        if (!userId || this.busy) // 인증 없음 또는 변경 처리 중
        {
            return; // 중복 화면 수명 교체 방지
        }
        if (this.identity !== userId) // 새 계정의 최초 조회
        {
            if (this.identity) // 이전 계정 자료 존재
            {
                this.reset(); // 이전 선택 폐기
            }
            this.identity = userId; // 확인 중인 현재 계정
            const saved = this.storageRead(userId); // 새로고침 전 선택
            this.selected = saved?.serverId || null; // 유효성은 응답으로 재검사
            this.channel = validId(saved?.channelId) ? saved.channelId : null; // 저장된 채널 ID
        }
        const version = ++this.version; // 조회 순서
        this.loading = true; // 목록 조회 상태
        this.onChange(); // 대기 화면
        try // 목록 검증과 적용
        {
            const data = await this.request("/api/list_servers.php"); // 실제 서버 목록
            if (version !== this.version || this.getUser()?.id !== userId) // 이전 계정·순서 결과
            {
                return; // 늦은 응답 폐기
            }
            if (!Array.isArray(data.servers) || data.servers.some((s) => !validId(s?.id) || !validId(s.owner_id) || typeof s.name !== "string" || !s.name || !["owner", "admin", "member"].includes(s.role)) || new Set(data.servers.map((s) => s.id)).size !== data.servers.length) // 공개 객체 검사
            {
                throw new Error("서버 목록을 확인하지 못했습니다."); // 잘못된 계약 사용 차단
            }
            this.servers = data.servers; // 확인한 소속만 보관
            if (!this.servers.some((s) => s.id === this.selected)) // 탈퇴·삭제된 선택
            {
                this.selected = this.servers[0]?.id || null; // 실제 첫 서버
                this.channel = null; // 이전 서버 채널 제거
            }
            this.persist(); // 확인된 선택 저장
        }
        finally // 최신 조회의 잠금만 해제
        {
            if (version === this.version) // 현재 수명 확인
            {
                this.loading = false; // 조회 종료
                this.onChange(); // 최신 서버 화면
            }
        }
    }
    select(id) // 실제 소속 서버 선택
    {
        if (!this.servers.some((s) => s.id === id) || this.busy) // 확인하지 않은 서버 차단
        {
            return; // 현재 선택 유지
        }
        this.selected = id; // 문자열 서버 ID
        this.channel = null; // 다른 서버 채널 제거
        this.persist(); // 선택 복원 자료
        this.onChange(); // 버튼 상태 반영
    }
    rememberChannel(id) // 실제 선택 채널 기억
    {
        this.channel = validId(id) ? id : null; // 잘못된 ID 배제
        this.persist(); // 채널 ID만 저장
    }
    async execute(operation, body = null, query = null) // 사용자 한 번의 명시적 변경
    {
        if (this.busy) // 중복 생성과 삭제 차단
        {
            throw new Error("요청 처리 중입니다."); // 단일 요청 경계
        }
        const userId = this.getUser()?.id; // 현재 계정
        const version = this.version; // 계정 요청 수명
        if (!userId) // 게스트 요청 차단
        {
            throw new Error("로그인이 필요합니다."); // 화면 안내
        }
        this.busy = true; // 즉시 제출 잠금
        this.onChange(); // 처리 중 화면
        try // 자동 재전송 없는 실제 요청
        {
            const suffix = query ? "?" + new URLSearchParams(query).toString() : ""; // 검증된 조회 조건
            const data = await this.request("/api/" + operation + ".php" + suffix, body); // 같은 출처 API
            if (version !== this.version || this.getUser()?.id !== userId) // 계정 종료 뒤 늦은 결과
            {
                throw Object.assign(new Error("로그인 상태가 변경되었습니다."), { code: "STALE_RESPONSE" }); // 이전 결과 사용 중단
            }
            return data; // 실제 성공 결과만 전달
        }
        catch (error) // 늦은 실패에도 같은 계정 경계
        {
            if (version !== this.version || this.getUser()?.id !== userId) // 이전 수명의 인증 실패
            {
                throw Object.assign(new Error("로그인 상태가 변경되었습니다."), { code: "STALE_RESPONSE" }); // 새 계정 종료로 전달하지 않음
            }
            throw error; // 현재 계정의 실제 실패만 전달
        }
        finally // 현재 수명만 잠금 해제
        {
            if (version === this.version) // 이전 요청의 영향 차단
            {
                this.busy = false; // 제출 완료
                this.onChange(); // 다시 조작 가능한 화면
            }
        }
    }
}
