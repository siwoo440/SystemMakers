export function mountProfileUI({ manager, byId, getUser, isReady, onUser, onError }) // 본인 프로필 화면 연결
{
    const profileDialog = byId("profile-dialog"); // 본인 정보 대화상자
    const usernameInput = byId("profile-username"); // 사용자명 변경 입력
    const profileForm = byId("profile-form"); // 명시적 저장 폼
    let dialogVersion = 0; // 닫힌 화면의 응답 구분
    let targetId = null; // 열 때 확인한 본인 계정
    let profileLoaded = false; // 실제 조회 성공 여부
    let extraLoaded = false; // 확장 정보 확인 여부
    function reset() // 이전 본인 정보 폐기
    {
        dialogVersion++; // 진행 응답 무효화
        targetId = null; // 이전 계정 제거
        profileLoaded = false; // 미확인 상태
        extraLoaded = false; // 확장 정보 폐기
        for (const elementId of ["profile-message", "profile-picture-file", "profile-block-search", "profile-block-results", "profile-block-list", "profile-extra-status"]) // 추가 입력과 결과
        {
            byId(elementId).value = ""; // 이전 계정 입력 제거
            if (["profile-block-results", "profile-block-list", "profile-extra-status"].includes(elementId)) // 목록과 안내
            {
                byId(elementId).textContent = ""; // 이전 계정 자료 제거
            }
        }
        byId("profile-picture-preview").hidden = true; // 이전 계정 사진 숨김
        byId("profile-picture-preview").src = ""; // 이전 사진 주소 제거
        for (const elementId of ["profile-message-feedback", "profile-picture-feedback", "profile-block-feedback"]) // 카드별 이전 결과
        {
            byId(elementId).textContent = ""; // 이전 계정의 결과 제거
        }
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
        byId("profile-close-top").disabled = manager.busy; // 상단 닫기 제한
        usernameInput.disabled = manager.busy || !profileLoaded; // 미확인 수정 차단
        byId("profile-extra-load").disabled = profileBusy || !profileLoaded; // 본인 확인 후 추가 정보 조회
        for (const elementId of ["profile-message", "profile-message-save", "profile-picture-file", "profile-picture-save", "profile-picture-delete", "profile-block-search", "profile-block-find", "profile-block-results", "profile-block-add", "profile-block-list", "profile-block-remove"]) // 확장 조작
        {
            byId(elementId).disabled = profileBusy || !extraLoaded; // 조회와 진행 상태 보호
        }
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
    function showPicture(hasPicture) // 확인한 본인 사진 표시
    {
        const preview = byId("profile-picture-preview"); // 사진 표시 요소
        preview.hidden = !hasPicture; // 사진 존재 여부
        preview.src = hasPicture ? "./backend/api/profile_picture.php?user_id=" + encodeURIComponent(targetId) : ""; // 같은 출처 사진 주소
    }
    function fillUsers(elementId, users) // 서버가 확인한 사용자 선택지
    {
        const select = byId(elementId); // 대상 선택 요소
        select.textContent = ""; // 이전 선택지 제거
        if (!Array.isArray(users)) // 목록 응답 검사
        {
            throw new Error("사용자 목록을 확인하지 못했습니다."); // 잘못된 응답 차단
        }
        for (const user of users) // 사용자별 선택지
        {
            if (typeof user.id !== "string" || !/^[1-9][0-9]{0,19}$/.test(user.id) || typeof user.username !== "string") // 공개 사용자 검사
            {
                throw new Error("사용자 목록을 확인하지 못했습니다."); // 잘못된 응답 차단
            }
            const option = document.createElement("option"); // 안전한 DOM 요소
            option.value = user.id; // 문자열 계정 ID
            option.textContent = user.username; // 사용자명 텍스트
            select.append(option); // 확인한 선택지 추가
        }
    }
    async function extraAction(action, feedbackId = null) // 같은 계정의 명시적 추가 작업
    {
        const requestViewVersion = dialogVersion; // 요청 시작 화면 수명
        if (!current(requestViewVersion) || manager.busy || manager.loading || !isReady()) // 닫힘과 중복 요청 차단
        {
            return; // 요청 중단
        }
        byId("profile-error").textContent = ""; // 이전 오류 제거
        byId("profile-extra-status").setAttribute("data-state", "normal"); // 이전 오류 강조 해제
        if (feedbackId) // 카드별 결과 안내 여부
        {
            byId(feedbackId).textContent = ""; // 이전 카드 결과 제거
            byId(feedbackId).setAttribute("data-state", "normal"); // 이전 카드 오류 강조 해제
        }
        try // 실제 요청과 응답 처리
        {
            await action(requestViewVersion); // 개별 작업 실행
            if (feedbackId && current(requestViewVersion)) // 같은 화면의 카드 동작
            {
                byId(feedbackId).textContent = byId("profile-extra-status").textContent; // 처리 결과를 해당 카드에 표시
            }
        }
        catch (operationError) // 현재 계정의 실패 안내
        {
            await failure(operationError, requestViewVersion); // 공통 인증 오류 처리
            if (current(requestViewVersion)) // 현재 프로필 화면 확인
            {
                byId("profile-extra-status").textContent = byId("profile-error").textContent || "설정을 처리하지 못했습니다."; // 추가 설정 위치에 오류 표시
                byId("profile-extra-status").setAttribute("data-state", "error"); // 오류 안내 구분
                if (feedbackId) // 개별 카드의 오류 여부
                {
                    byId(feedbackId).textContent = byId("profile-extra-status").textContent; // 조작한 카드에 오류 표시
                    byId(feedbackId).setAttribute("data-state", "error"); // 카드 오류 색상 적용
                }
            }
        }
        render(); // 최신 조작 상태 반영
    }
    byId("profile-extra-load").addEventListener("click", () => extraAction(async (requestViewVersion) => // 추가 정보 확인
    {
        const details = await manager.execute("profile_details", null, { user_id: targetId }); // 본인 확장 상태 조회
        if (!current(requestViewVersion)) // 이전 계정 응답
        {
            return; // 적용 중단
        }
        if (details.profile?.id !== targetId || typeof details.profile.status_message !== "string" || typeof details.profile.has_picture !== "boolean") // 확장 상태 계약 검사
        {
            throw new Error("프로필 상태를 확인하지 못했습니다."); // 잘못된 응답 차단
        }
        const blocks = await manager.execute("user_blocks"); // 본인 차단 목록 조회
        if (!current(requestViewVersion)) // 이전 계정 응답
        {
            return; // 적용 중단
        }
        fillUsers("profile-block-list", blocks.users); // 실제 차단 목록 반영
        byId("profile-message").value = details.profile.status_message; // 저장 상태 표시
        showPicture(details.profile.has_picture); // 사진 상태 표시
        extraLoaded = true; // 조회 확인
        byId("profile-extra-status").textContent = "추가 정보를 확인했습니다."; // 확인 결과 안내
    })); // 조회 연결 끝
    byId("profile-message-save").addEventListener("click", () => extraAction(async (requestViewVersion) => // 상태 메시지 변경
    {
        if (!extraLoaded) // 미확인 상태
        {
            return; // 변경 차단
        }
        const statusMessage = byId("profile-message").value; // 작성한 상태
        const result = await manager.execute("profile_details", { status_message: statusMessage }, null, "PATCH"); // 명시적 저장
        if (current(requestViewVersion) && result.status_message === statusMessage) // 확인한 저장 결과
        {
            byId("profile-extra-status").textContent = "상태 메시지가 저장되었습니다."; // 저장 안내
        }
    }, "profile-message-feedback")); // 상태 저장 연결 끝
    byId("profile-picture-save").addEventListener("click", () => extraAction(async (requestViewVersion) => // 본인 사진 저장
    {
        const file = byId("profile-picture-file").files?.[0]; // 선택한 파일
        if (!extraLoaded || !file) // 파일과 사전 조회 확인
        {
            throw new Error("사진 파일을 선택하세요."); // 선택 안내
        }
        const formData = new FormData(); // multipart 요청 본문
        formData.append("picture", file); // 선택한 사진
        const result = await manager.execute("profile_picture", formData); // 사진 전송
        if (current(requestViewVersion) && result.has_picture === true) // 확인된 저장
        {
            showPicture(true); // 저장 사진 다시 조회
            byId("profile-picture-file").value = ""; // 전송 파일 선택 제거
            byId("profile-extra-status").textContent = "사진이 저장되었습니다."; // 저장 안내
        }
    }, "profile-picture-feedback")); // 사진 저장 연결 끝
    byId("profile-picture-delete").addEventListener("click", () => extraAction(async (requestViewVersion) => // 본인 사진 삭제
    {
        if (!extraLoaded) // 미확인 상태
        {
            return; // 변경 차단
        }
        const result = await manager.execute("profile_picture", {}, null, "DELETE"); // 본인 사진 삭제
        if (current(requestViewVersion) && result.has_picture === false) // 확인된 삭제
        {
            showPicture(false); // 사진 숨김
            byId("profile-extra-status").textContent = "사진이 삭제되었습니다."; // 삭제 안내
        }
    }, "profile-picture-feedback")); // 사진 삭제 연결 끝
    byId("profile-block-find").addEventListener("click", () => extraAction(async (requestViewVersion) => // 차단 대상 검색
    {
        if (!extraLoaded) // 미확인 상태
        {
            return; // 조회 차단
        }
        const result = await manager.execute("search_users", null, { q: byId("profile-block-search").value }); // 공개 사용자명 검색
        if (current(requestViewVersion)) // 같은 계정 응답
        {
            fillUsers("profile-block-results", result.users); // 검증된 선택지 표시
            byId("profile-extra-status").textContent = "검색 결과를 확인했습니다."; // 조회 안내
        }
    }, "profile-block-feedback")); // 사용자 검색 연결 끝
    async function changeBlock(method, selectId) // 선택 사용자 차단 또는 해제
    {
        await extraAction(async (requestViewVersion) => // 같은 계정 작업
        {
            const userId = byId(selectId).value; // 선택한 사용자 ID
            if (!extraLoaded || !/^[1-9][0-9]{0,19}$/.test(userId)) // 선택과 사전 조회 확인
            {
                throw new Error("사용자를 선택하세요."); // 선택 안내
            }
            await manager.execute("user_blocks", { user_id: userId }, null, method); // 본인 차단 변경
            if (!current(requestViewVersion)) // 이전 계정 응답
            {
                return; // 목록 갱신 중단
            }
            const result = await manager.execute("user_blocks"); // 실제 차단 목록 재조회
            if (current(requestViewVersion)) // 같은 계정 응답
            {
                fillUsers("profile-block-list", result.users); // 현재 차단 목록 반영
                byId("profile-extra-status").textContent = method === "POST" ? "사용자를 차단했습니다." : "차단을 해제했습니다."; // 확인 결과
            }
        }, "profile-block-feedback"); // 차단 작업 끝
    }
    byId("profile-block-add").addEventListener("click", () => changeBlock("POST", "profile-block-results")); // 선택 사용자 차단
    byId("profile-block-remove").addEventListener("click", () => changeBlock("DELETE", "profile-block-list")); // 선택 사용자 해제
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
    byId("profile-close-top").addEventListener("click", () => // 왼쪽 위 닫기
    {
        if (!manager.busy) // 처리 중 닫기 제한
        {
            profileDialog.close(); // 닫기 이벤트로 정보 폐기
        }
    }); // 상단 닫기 연결 끝
    profileDialog.addEventListener("click", (uiEvent) => // 바깥 배경 선택
    {
        if (manager.busy || uiEvent.target !== profileDialog) // 진행 중 또는 내부 선택
        {
            return; // 닫기 처리 생략
        }
        const dialogBounds = profileDialog.getBoundingClientRect(); // 실제 대화상자 경계
        if (uiEvent.clientX < dialogBounds.left || uiEvent.clientX > dialogBounds.right || uiEvent.clientY < dialogBounds.top || uiEvent.clientY > dialogBounds.bottom) // 실제 배경 영역 확인
        {
            profileDialog.close(); // 바깥 선택 시 창 닫기
        }
    }); // 배경 닫기 연결 끝
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
