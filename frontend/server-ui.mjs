export function mountServerUI({ manager, byId, onReload, onSelect, onError, isReady, onDeparted = () => undefined }) // 관리 화면의 외부 연결
{
    const dialog = byId("server-dialog"); // 공통 관리 대화상자
    const form = byId("server-form"); // 단일 제출 폼
    const input = byId("server-value"); // 이름 또는 코드 입력
    let mode = ""; // 현재 명시적 작업
    let target = null; // 열 때 확인한 서버
    let view = 0; // 닫힌 화면의 늦은 결과 차단
    function clear() // 원문 코드와 이전 입력 정리
    {
        view++; // 기존 비동기 화면 무효화
        input.value = ""; // 이름과 붙여넣은 코드 제거
        byId("invite-code").value = ""; // 발급 원문 제거
        byId("server-error").textContent = ""; // 이전 오류 제거
        byId("server-check").checked = false; // 새 확인 필요
    }
    function render() // 실제 인증·권한별 관리 버튼
    {
        const server = manager.servers.find((s) => s.id === manager.selected); // 확인한 현재 소속
        const busy = manager.busy || manager.loading || !isReady(); // 처리 중 전체 관리 잠금
        const list = byId("server-list"); // 실제 서버 탐색
        list.replaceChildren(...manager.servers.map((s) => // 빈 서버도 탐색 가능
        {
            const button = document.createElement("button"); // 키보드 접근 버튼
            button.type = "button"; // 기본 제출 방지
            button.className = "server-choice"; // 서버 선택 스타일
            button.textContent = Array.from(s.name).slice(0, 2).join(""); // 짧은 공간 이름
            button.title = s.name; // 전체 이름 안내
            button.setAttribute("aria-label", s.name + " 서버 선택"); // 의미 있는 탐색 이름
            button.setAttribute("aria-pressed", String(s.id === manager.selected)); // 현재 서버 상태
            button.disabled = busy || dialog.open; // 진행 작업의 대상 변경 차단
            button.addEventListener("click", async () => // 확인한 서버 전환
            {
                manager.select(s.id); // 선택 ID 저장
                await onSelect(); // 선택한 서버의 채널 표시
            }); // 전환 연결 끝
            return button; // 완성한 탐색 요소
        })); // 서버 버튼 준비 끝
        byId("selected-server").textContent = server?.name || "참여 서버 없음"; // 실제 서버 제목
        byId("server-status").textContent = manager.loading ? "서버 확인 중…" : server ? `내 역할: ${server.role === "owner" ? "소유자" : server.role === "admin" ? "관리자" : "일반 회원"}` : "서버를 만들거나 초대 코드로 참여하세요."; // 소속 상태
        for (const id of ["create-server", "join-server", "refresh-servers"]) // 로그인 후 공통 동작
        {
            byId(id).disabled = busy; // 게스트와 처리 중 차단
        }
        byId("invite-server").hidden = server?.role !== "owner"; // 소유자 전용 초대
        byId("delete-server").hidden = server?.role !== "owner"; // 소유자 전용 삭제
        byId("leave-server").hidden = !server; // 소속 없는 화면 정리
        byId("leave-server").disabled = busy || server?.role === "owner"; // 소유자 탈퇴 차단
        byId("leave-server").title = server?.role === "owner" ? "소유자는 서버에서 탈퇴할 수 없습니다." : "작성한 대화는 보존됩니다."; // 비활성 이유
        byId("invite-server").disabled = busy; // 발급 중 중복 클릭 차단
        byId("delete-server").disabled = busy; // 삭제 중 중복 클릭 차단
        byId("server-submit").disabled = manager.busy || (mode === "delete" && input.value.replace(/^\p{Z}+|\p{Z}+$/gu, "") !== target?.name) || (mode === "invite" && !byId("server-check").checked); // API와 같은 구분 공백 정리와 확인
        byId("server-close").disabled = manager.busy; // 응답 처리 중 닫기 차단
        byId("revoke-invite").disabled = manager.busy; // 폐기 중 중복 요청 차단
        byId("copy-invite").disabled = !byId("invite-code").value || manager.busy; // 확인한 원문만 복사
        if (!manager.identity && dialog.open) // 계정 종료 확인
        {
            clear(); // 민감한 화면 원문 제거
            dialog.close(); // 이전 계정 관리 종료
        }
    }
    async function failure(error, marker) // 실제 실패·계정 종료 연결
    {
        const message = await onError(error); // 기존 인증·CSRF 처리
        if (marker === view && dialog.open) // 아직 같은 대화상자
        {
            byId("server-error").textContent = message || error.message; // HTML 실행 없는 오류 안내
        }
        render(); // 현재 계정 버튼 갱신
    }
    async function refreshInvite(marker) // 원문 없는 현재 상태 재조회
    {
        const data = await manager.execute("get_server_invite", null, { server_id: target.id }); // 최신 발급·폐기 상태
        if (marker === view && dialog.open) // 아직 같은 화면 수명
        {
            byId("server-impact").textContent = `대상 서버: ${target.name} · ${data.invite.active ? "유효 초대 있음 · 만료 " + new Date(data.invite.expires_at).toLocaleString("ko-KR") : "유효 초대 없음"}`; // 실제 상태 안내
        }
    }
    async function open(next) // 대상이 고정된 관리 화면
    {
        clear(); // 이전 코드와 입력 정리
        mode = next; // 이번 작업 종류
        target = manager.servers.find((s) => s.id === manager.selected) || null; // 당시 실제 서버
        const marker = view; // 열린 화면 수명
        const titles = { create: "서버 만들기", join: "초대 코드로 참여", invite: "초대 관리", leave: "서버 탈퇴", delete: "서버 영구 삭제" }; // 사용자 작업 제목
        const help = { create: "팀 공간의 이름을 입력하세요. 일반 채널이 함께 만들어집니다.", join: "소유자에게 받은 64자리 초대 코드를 입력하세요.", invite: "새 코드를 발급하면 이전 코드는 즉시 무효화됩니다. 코드는 24시간 유효하며 이번 화면에서만 확인할 수 있습니다.", leave: "작성한 메시지는 남고, 탈퇴 후 이 서버의 대화에 접근할 수 없습니다.", delete: "이 서버의 모든 채널·초대·대화가 영구 삭제됩니다. 대상 이름을 그대로 입력하세요." }; // 실제 영향 설명
        byId("server-title").textContent = titles[next]; // 작업 제목
        byId("server-help").textContent = help[next]; // 범위 안내
        byId("server-input-row").hidden = ["invite", "leave"].includes(next); // 입력이 필요한 작업
        byId("server-value-label").textContent = next === "join" ? "초대 코드" : next === "delete" ? "삭제 확인 이름" : "서버 이름"; // 명시적 레이블
        input.required = !["invite", "leave"].includes(next); // 필수 입력 조건
        input.maxLength = next === "join" ? 100 : 1000; // 공백 정규화 전 입력 상한
        byId("invite-panel").hidden = next !== "invite"; // 초대 전용 영역
        byId("server-check-row").hidden = next !== "invite"; // 재발급 확인
        byId("server-impact").textContent = target ? `대상 서버: ${target.name}` : ""; // 이름으로 대상 구분
        byId("server-submit").textContent = { create: "만들기", join: "참여", invite: "새 코드 발급", leave: "탈퇴 확인", delete: "영구 삭제 확인" }[next]; // 명시적 실행 버튼
        dialog.showModal(); // 배경 조작 차단
        render(); // 권한·처리 상태 반영
        try // 현재 초대와 삭제 영향 확인
        {
            if (next === "invite") // 소유자 초대 상태
            {
                await refreshInvite(marker); // 상태 조회에 원문 포함 금지
            }
            if (next === "delete") // 영구 삭제 미리보기
            {
                const data = await manager.execute("get_deletion_preview", null, { resource_type: "server", resource_id: target.id }); // 실제 집계 요청
                if (marker === view) // 현재 확인 화면
                {
                    target = { ...target, name: data.name }; // 최신 이름으로 확인
                    byId("server-impact").textContent = `${data.name} · 채널 ${data.channel_count}개 · 참여자 ${data.member_count}명 · 메시지 ${data.message_count}개. 조회 후 추가된 메시지도 삭제될 수 있습니다.`; // 삭제 영향과 시점 설명
                }
            }
        }
        catch (error) // 미확인 영향은 안내 후 제출 차단
        {
            await failure(error, marker); // 실제 오류 처리
            if (next === "delete" && marker === view) // 미리보기 실패
            {
                target = null; // 미확인 삭제 대상 폐기
            }
        }
        render(); // 최종 제출 상태
        if (input.required) // 입력 가능한 화면
        {
            input.focus(); // 키보드 입력 진입
        }
    }
    form.addEventListener("submit", async (event) => // 단일 명시적 변경 실행
    {
        event.preventDefault(); // 폼 페이지 이동 방지
        render(); // 최신 확인 값 검사
        if (byId("server-submit").disabled || !form.reportValidity()) // 중복·필수 입력 검사
        {
            return; // 실제 변경 중단
        }
        const marker = view; // 제출 화면 수명
        byId("server-error").textContent = ""; // 이전 실패 제거
        try // 현재 작업 한 번 실행
        {
            const operations = { create: ["create_server", { name: input.value }], join: ["join_server", { code: input.value }], invite: ["create_server_invite", { server_id: target?.id }], leave: ["leave_server", { server_id: target?.id }], delete: ["delete_server", { server_id: target?.id, confirm_name: input.value }] }; // 고정 API와 허용 필드
            if (mode === "invite") // 변경 결과가 불명확해질 수 있는 코드
            {
                byId("invite-code").value = ""; // 이전 코드 즉시 폐기
            }
            const data = await manager.execute(...operations[mode]); // 자동 재전송 없는 변경
            if (marker !== view) // 닫힌 계정 화면
            {
                return; // 늦은 결과 표시 중단
            }
            if (mode === "invite") // 이번 응답에서만 코드 표시
            {
                byId("invite-code").value = data.code; // 읽기 전용 원문
                byId("server-impact").textContent = `${target.name} · 만료 ${new Date(data.expires_at).toLocaleString("ko-KR")}`; // 실제 만료 시각
                byId("server-check").checked = false; // 다음 재발급은 다시 확인
            }
            else // 소속 변화 뒤 실제 목록 갱신
            {
                if (data.server) // 생성·참여한 서버 우선 선택
                {
                    manager.selected = data.server.id; // 새 서버 ID
                    manager.channel = data.channel?.id || null; // 생성된 기본 채널
                }
                if (mode === "leave" || mode === "delete") // 확인된 소속 종료
                {
                    onDeparted(data.server_id); // 후속 목록 실패 전 이전 자료 폐기
                }
                dialog.close(); // 완료한 작업 화면 닫기
                await onReload(); // 실제 서버·채널 확인
            }
        }
        catch (error) // 업무 실패와 불확실한 결과
        {
            if (error.code === "NAME_MISMATCH" && marker === view) // 이름 경합으로 기존 확인 무효
            {
                await open("delete"); // 최신 집계와 빈 확인 입력
                byId("server-error").textContent = "현재 이름과 삭제 영향을 다시 확인하세요."; // 새 명시적 확인 안내
                return; // 오래된 확인 재사용 방지
            }
            await failure(error, marker); // 인증·CSRF·권한 처리
            if (!error.status && error.code !== "STALE_RESPONSE") // 통신 결과 불명확
            {
                await onReload(); // 재전송 없이 상태 확인
                if (mode === "invite" && marker === view && dialog.open) // 초대 업무 결과 별도 재확인
                {
                    await refreshInvite(marker).catch((recovery) => failure(recovery, marker)); // 실패해도 원문 복구 없음
                }
            }
        }
        render(); // 처리 종료 버튼 상태
    }); // 폼 제출 연결 끝
    for (const [id, next] of [["create-server", "create"], ["join-server", "join"], ["invite-server", "invite"], ["leave-server", "leave"], ["delete-server", "delete"]]) // 작업별 진입점
    {
        byId(id).addEventListener("click", () => open(next)); // 고정 작업 화면 연결
    }
    byId("refresh-servers").addEventListener("click", onReload); // 명시적 소속 재확인
    byId("server-close").addEventListener("click", () => dialog.close()); // 취소는 자료 변경 없음
    input.addEventListener("input", render); // 이름 일치 여부 갱신
    byId("server-check").addEventListener("change", render); // 재발급 확인 갱신
    byId("revoke-invite").addEventListener("click", async () => // 현재 코드 명시적 폐기
    {
        const marker = view; // 현재 화면 수명
        try // 중복 가능 폐기 실행
        {
            byId("invite-code").value = ""; // 응답 유실 전 기존 원문 제거
            await manager.execute("revoke_server_invite", { server_id: target?.id }); // 소유자 전용 요청
            byId("invite-code").value = ""; // 무효 원문 즉시 제거
            byId("server-impact").textContent = "초대를 폐기했습니다. 기존 참여자는 유지됩니다."; // 실제 결과 안내
        }
        catch (error) // 폐기 실패
        {
            await failure(error, marker); // 실제 상태 재확인 안내
            if (!error.status && marker === view && dialog.open) // 커밋 여부 불명확
            {
                await refreshInvite(marker).catch((recovery) => failure(recovery, marker)); // 실제 폐기 상태 재조회
            }
        }
        render(); // 최종 버튼 갱신
    }); // 폐기 연결 끝
    byId("copy-invite").addEventListener("click", async () => // 사용자의 명시적 코드 복사
    {
        try // 클립보드 권한 경계
        {
            await navigator.clipboard.writeText(byId("invite-code").value); // 현재 발급 원문 복사
            byId("server-error").textContent = "초대 코드를 복사했습니다."; // 복사 성공 안내
        }
        catch // 브라우저 복사 제한
        {
            byId("invite-code").select(); // 직접 복사할 원문 선택
            byId("server-error").textContent = "선택한 코드를 직접 복사하세요."; // 대체 조작 안내
        }
    }); // 복사 연결 끝
    dialog.addEventListener("cancel", (event) => // 요청 중 Escape 종료 방지
    {
        if (manager.busy) // 실제 요청 진행
        {
            event.preventDefault(); // 늦은 결과 화면 혼동 방지
        }
    }); // Escape 처리 끝
    dialog.addEventListener("close", () => // 완료·취소 뒤 원문 제거
    {
        clear(); // 코드와 입력 폐기
        render(); // 서버 탐색 다시 허용
    }); // 닫기 정리 끝
    return { render, clear }; // 계정 변경 시 연결할 경계
}
