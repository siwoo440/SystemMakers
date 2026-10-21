export function mountProfileUI({ manager, byId, getUser, isReady, onUser, onError }) // 본인 프로필 화면 연결
{
    const dialog = byId("profile-dialog"); // 본인 정보 대화상자
    const input = byId("profile-username"); // 사용자명 변경 입력
    const form = byId("profile-form"); // 명시적 저장 폼
    let view = 0; // 닫힌 화면의 응답 구분
    let targetId = null; // 열 때 확인한 본인 계정
    let loaded = false; // 실제 조회 성공 여부
    function reset() // 이전 본인 정보 폐기
    {
        view++; // 진행 응답 무효화
        targetId = null; // 이전 계정 제거
        loaded = false; // 미확인 상태
        input.value = ""; // 이전 사용자명 입력 제거
        for (const id of ["profile-email", "profile-created", "profile-status", "profile-error"]) // 개인 정보와 안내
        {
            byId(id).textContent = ""; // 닫힌 정보 폐기
        }
    }
    function clear() // 로그아웃·계정 전환 정리
    {
        reset(); // 이전 프로필 자료 폐기
        if (dialog.open) // 열린 화면
        {
            dialog.close(); // 이전 계정 대화상자 종료
        }
    }
    function render() // 인증·진행 상태별 조작
    {
        const user = getUser(); // 현재 화면 계정
        const busy = manager.busy || manager.loading || !isReady(); // 공통 변경 잠금
        byId("open-profile").hidden = !user; // 게스트 진입 숨김
        byId("open-profile").disabled = busy; // 인증·다른 작업 중 진입 제한
        byId("profile-submit").disabled = busy || !loaded; // 실제 본인 조회 필수
        byId("profile-reload").disabled = busy; // 중복 조회 차단
        byId("profile-close").disabled = manager.busy; // 진행 응답 전 닫기 제한
        input.disabled = manager.busy || !loaded; // 미확인 수정 차단
        form.setAttribute("aria-busy", String(manager.busy)); // 보조 기기 진행 상태
        if (dialog.open && (!user || user.id !== targetId)) // 계정 수명 종료
        {
            clear(); // 이전 이메일 노출 차단
        }
    }
    function current(marker) // 현재 계정의 열린 화면만 허용
    {
        return marker === view && dialog.open && getUser()?.id === targetId; // 계정·화면 교차 확인
    }
    function accept(data, marker, preserveInput) // 확인된 본인 정보만 반영
    {
        if (!current(marker)) // 이전 계정 응답
        {
            return; // 화면과 작성자명 변경 중단
        }
        const user = data.user; // 공개 사용자 객체
        if (!user || user.id !== targetId || !/^[a-z0-9_]{3,32}$/.test(user.username) || typeof user.email !== "string" || !user.email || typeof user.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(user.created_at) || Number.isNaN(Date.parse(user.created_at))) // 본인 공개 계약
        {
            throw new Error("본인 프로필 응답을 확인하지 못했습니다. 다시 조회하세요."); // 미확인 변경 차단
        }
        onUser(user); // 같은 계정의 표시 이름 갱신
        byId("profile-email").textContent = user.email; // 본인에게만 이메일 표시
        byId("profile-created").textContent = new Date(user.created_at).toLocaleString("ko-KR"); // 현지 가입 시각
        if (!preserveInput) // 최초 조회와 확정 저장
        {
            input.value = user.username; // 실제 저장된 정규화 이름
        }
        byId("profile-status").textContent = `현재 저장된 사용자명: ${user.username}`; // 실제 확인한 상태
        loaded = true; // 확인한 본인만 수정 가능
    }
    async function failure(error, marker) // 현재 요청 실패 안내
    {
        if (!current(marker) || error.code === "STALE_RESPONSE") // 이전 수명 응답
        {
            return; // 새 계정 인증 처리로 전달하지 않음
        }
        const message = await onError(error); // 기존 계정·CSRF 복구
        if (current(marker)) // 복구 중 종료되지 않은 화면
        {
            byId("profile-error").textContent = [message || error.message, error.fields?.username].filter(Boolean).join(" "); // 안전한 필드 오류
        }
        render(); // 복구 후 수동 조작 상태
    }
    async function load(marker, preserveInput = true) // 실제 본인 상태 재확인
    {
        loaded = false; // 이전 확인으로 저장하지 않음
        render(); // 조회 중 입력 제한
        try // GET에는 변경 토큰·본문 없음
        {
            accept(await manager.execute("profile"), marker, preserveInput); // 기존 기대 계정·요청 수명 보호
        }
        catch (error) // 실제 조회 실패
        {
            await failure(error, marker); // 실패는 저장 차단 유지
        }
        render(); // 확인 결과별 저장 버튼
    }
    byId("open-profile").addEventListener("click", async () => // 내 프로필 진입
    {
        if (!getUser() || !isReady() || manager.busy || manager.loading) // 미확인 진입 제한
        {
            return; // 기존 화면 유지
        }
        reset(); // 이전 입력·이메일 폐기
        targetId = getUser().id; // 본인 계정 고정
        dialog.showModal(); // 키보드 포커스 제한
        const marker = view; // 이번 조회 수명
        await load(marker, false); // DB의 현재 정보 조회
        if (current(marker) && loaded) // 확인한 같은 계정
        {
            input.focus(); // 사용자명 수정 진입
        }
    }); // 진입 연결 끝
    form.addEventListener("submit", async (event) => // 명시적 사용자명 저장
    {
        event.preventDefault(); // 페이지 이동 방지
        render(); // 최신 계정·중복 상태
        if (!dialog.open || byId("profile-submit").disabled || !form.reportValidity()) // 미확인·중복 제출 차단
        {
            return; // 변경 요청 없음
        }
        const marker = view; // 제출 시점 계정 화면
        byId("profile-error").textContent = ""; // 이전 오류 제거
        try // 자동 반복 없는 PATCH
        {
            const data = await manager.execute("profile", { username: input.value }, null, "PATCH"); // 본인 이름만 변경
            accept(data, marker, false); // 커밋된 본인 정보 적용
            if (current(marker)) // 계정 수명 유지
            {
                byId("profile-status").textContent = `사용자명이 저장되었습니다: ${data.user.username}`; // 응답 후 성공 안내
            }
        }
        catch (error) // 거절 또는 결과 불확실
        {
            await failure(error, marker); // 같은 계정의 입력 보존
            if (!error.status && error.code !== "STALE_RESPONSE" && current(marker)) // 응답 유실의 결과 확인
            {
                await load(marker); // PATCH 반복 없이 실제 상태만 재조회
            }
        }
        render(); // 현재 계정만 잠금 해제
    }); // 저장 연결 끝
    byId("profile-reload").addEventListener("click", () => // 명시적 재조회
    {
        if (dialog.open && !manager.busy && !manager.loading && isReady()) // 안정된 현재 화면
        {
            byId("profile-error").textContent = ""; // 이전 조회 오류 제거
            return load(view); // 입력을 보존한 현재 상태 확인
        }
    }); // 재조회 연결 끝
    byId("profile-close").addEventListener("click", () => // 취소 또는 확인 종료
    {
        if (!manager.busy) // 처리 중 닫기 제한
        {
            dialog.close(); // 닫기 이벤트로 정보 폐기
        }
    }); // 닫기 연결 끝
    dialog.addEventListener("cancel", (event) => // Escape 수명 보호
    {
        if (manager.busy) // 변경 결과 대기
        {
            event.preventDefault(); // 처리 중 종료 차단
        }
    }); // Escape 연결 끝
    dialog.addEventListener("close", reset); // 모든 닫기에서 이메일·입력 폐기
    return { render, clear }; // 계정 수명과 연결할 경계
}
