export function mountProfileUI({ manager, byId, getUser, isReady, onUser, onError }) // 본인 프로필 화면 연결
{
    const profileDialog = byId("profile-dialog"); // 본인 정보 대화상자
    const usernameInput = byId("profile-username"); // 사용자명 변경 입력
    const profileForm = byId("profile-form"); // 명시적 저장 폼
    let dialogVersion = 0; // 닫힌 화면의 응답 구분
    let targetId = null; // 열 때 확인한 본인 계정
    let profileLoaded = false; // 실제 조회 성공 여부
    function reset() // 이전 본인 정보 폐기
    {
        dialogVersion++; // 진행 응답 무효화
        targetId = null; // 이전 계정 제거
        profileLoaded = false; // 미확인 상태
        usernameInput.value = ""; // 이전 사용자명 입력 제거
        for (const elementId of ["profile-email", "profile-created", "profile-status", "profile-error"]) // 개인 정보와 안내
        {
            byId(elementId).textContent = ""; // 닫힌 정보 폐기
        }
    }
    function clear() // 로그아웃·계정 전환 정리
    {
        reset(); // 이전 프로필 자료 폐기
        if (profileDialog.open) // 열린 화면
        {
            profileDialog.close(); // 이전 계정 대화상자 종료
        }
    }
    function render() // 인증·진행 상태별 조작
    {
        const user = getUser(); // 현재 화면 계정
        const profileBusy = manager.busy || manager.loading || !isReady(); // 공통 변경 잠금
        byId("open-profile").hidden = !user; // 게스트 진입 숨김
        byId("open-profile").disabled = profileBusy; // 인증·다른 작업 중 진입 제한
        byId("profile-submit").disabled = profileBusy || !profileLoaded; // 실제 본인 조회 필수
        byId("profile-reload").disabled = profileBusy; // 중복 조회 차단
        byId("profile-close").disabled = manager.busy; // 진행 응답 전 닫기 제한
        usernameInput.disabled = manager.busy || !profileLoaded; // 미확인 수정 차단
        profileForm.setAttribute("aria-busy", String(manager.busy)); // 보조 기기 진행 상태
        if (profileDialog.open && (!user || user.id !== targetId)) // 계정 수명 종료
        {
            clear(); // 이전 이메일 노출 차단
        }
    }
    function current(requestViewVersion) // 현재 계정의 열린 화면만 허용
    {
        return requestViewVersion === dialogVersion && profileDialog.open && getUser()?.id === targetId; // 계정·화면 교차 확인
    }
    function accept(responseData, requestViewVersion, preserveInput) // 확인된 본인 정보만 반영
    {
        if (!current(requestViewVersion)) // 이전 계정 응답
        {
            return; // 화면과 작성자명 변경 중단
        }
        const user = responseData.user; // 공개 사용자 객체
        if (!user || user.id !== targetId || !/^[a-z0-9_가-힣]{2,32}$/.test(user.username) || typeof user.email !== "string" || !user.email || typeof user.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(user.created_at) || Number.isNaN(Date.parse(user.created_at))) // 본인 공개 계약
        {
            throw new Error("본인 프로필 응답을 확인하지 못했습니다. 다시 조회하세요."); // 미확인 변경 차단
        }
        onUser(user); // 같은 계정의 표시 이름 갱신
        byId("profile-email").textContent = user.email; // 본인에게만 이메일 표시
        byId("profile-created").textContent = new Date(user.created_at).toLocaleString("ko-KR"); // 현지 가입 시각
        if (!preserveInput) // 최초 조회와 확정 저장
        {
            usernameInput.value = user.username; // 실제 저장된 정규화 이름
        }
        byId("profile-status").textContent = `현재 저장된 사용자명: ${user.username}`; // 실제 확인한 상태
        profileLoaded = true; // 확인한 본인만 수정 가능
    }
    async function failure(operationError, requestViewVersion) // 현재 요청 실패 안내
    {
        if (!current(requestViewVersion) || operationError.code === "STALE_RESPONSE") // 이전 수명 응답
        {
            return; // 새 계정 인증 처리로 전달하지 않음
        }
        const message = await onError(operationError); // 기존 계정·CSRF 복구
        if (current(requestViewVersion)) // 복구 중 종료되지 않은 화면
        {
            byId("profile-error").textContent = [message || operationError.message, operationError.fields?.username].filter(Boolean).join(" "); // 안전한 필드 오류
        }
        render(); // 복구 후 수동 조작 상태
    }
    async function load(requestViewVersion, preserveInput = true) // 실제 본인 상태 재확인
    {
        profileLoaded = false; // 이전 확인으로 저장하지 않음
        render(); // 조회 중 입력 제한
        try // GET에는 변경 토큰·본문 없음
        {
            accept(await manager.execute("profile"), requestViewVersion, preserveInput); // 기존 기대 계정·요청 수명 보호
        }
        catch (operationError) // 실제 조회 실패
        {
            await failure(operationError, requestViewVersion); // 실패는 저장 차단 유지
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
        profileDialog.showModal(); // 키보드 포커스 제한
        const requestViewVersion = dialogVersion; // 이번 조회 수명
        await load(requestViewVersion, false); // DB의 현재 정보 조회
        if (current(requestViewVersion) && profileLoaded) // 확인한 같은 계정
        {
            usernameInput.focus(); // 사용자명 수정 진입
        }
    }); // 진입 연결 끝
    profileForm.addEventListener("submit", async (uiEvent) => // 명시적 사용자명 저장
    {
        uiEvent.preventDefault(); // 페이지 이동 방지
        render(); // 최신 계정·중복 상태
        if (!profileDialog.open || byId("profile-submit").disabled || !profileForm.reportValidity()) // 미확인·중복 제출 차단
        {
            return; // 변경 요청 없음
        }
        const requestViewVersion = dialogVersion; // 제출 시점 계정 화면
        byId("profile-error").textContent = ""; // 이전 오류 제거
        try // 자동 반복 없는 PATCH
        {
            const responseData = await manager.execute("profile", { username: usernameInput.value }, null, "PATCH"); // 본인 이름만 변경
            accept(responseData, requestViewVersion, false); // 커밋된 본인 정보 적용
            if (current(requestViewVersion)) // 계정 수명 유지
            {
                byId("profile-status").textContent = `사용자명이 저장되었습니다: ${responseData.user.username}`; // 응답 후 성공 안내
            }
        }
        catch (operationError) // 거절 또는 결과 불확실
        {
            await failure(operationError, requestViewVersion); // 같은 계정의 입력 보존
            if (!operationError.status && operationError.code !== "STALE_RESPONSE" && current(requestViewVersion)) // 응답 유실의 결과 확인
            {
                await load(requestViewVersion); // PATCH 반복 없이 실제 상태만 재조회
            }
        }
        render(); // 현재 계정만 잠금 해제
    }); // 저장 연결 끝
    byId("profile-reload").addEventListener("click", () => // 명시적 재조회
    {
        if (profileDialog.open && !manager.busy && !manager.loading && isReady()) // 안정된 현재 화면
        {
            byId("profile-error").textContent = ""; // 이전 조회 오류 제거
            return load(dialogVersion); // 입력을 보존한 현재 상태 확인
        }
    }); // 재조회 연결 끝
    byId("profile-close").addEventListener("click", () => // 취소 또는 확인 종료
    {
        if (!manager.busy) // 처리 중 닫기 제한
        {
            profileDialog.close(); // 닫기 이벤트로 정보 폐기
        }
    }); // 닫기 연결 끝
    profileDialog.addEventListener("cancel", (uiEvent) => // Escape 수명 보호
    {
        if (manager.busy) // 변경 결과 대기
        {
            uiEvent.preventDefault(); // 처리 중 종료 차단
        }
    }); // Escape 연결 끝
    profileDialog.addEventListener("close", reset); // 모든 닫기에서 이메일·입력 폐기
    return { render, clear }; // 계정 수명과 연결할 경계
}
