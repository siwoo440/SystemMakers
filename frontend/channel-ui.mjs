export function mountChannelUI({ manager, byId, getChannel, isReady, onReload, onError, onDeleted = () => undefined, hasChannel = () => true }) // 실제 채널 관리 화면 연결
{
    const dialog = byId("channel-dialog"); // 관리 대화상자
    const form = byId("channel-manage-form"); // 단일 변경 폼
    const input = byId("channel-value"); // 새 이름 또는 확인 이름
    let mode = ""; // 명시적 관리 작업
    let target = null; // 열 때 고정한 서버·채널
    let view = 0; // 이전 대화상자 응답 구분
    function reset() // 이전 대상과 입력 폐기
    {
        view++; // 진행 중 화면 결과 무효화
        target = null; // 이전 대상 제거
        input.value = ""; // 이전 이름 확인 제거
        byId("channel-manage-error").textContent = ""; // 이전 오류 제거
    }
    function clear() // 계정 종료와 접근 상실 경계
    {
        reset(); // 이전 관리 자료 폐기
        if (dialog.open) // 열린 관리 화면
        {
            dialog.close(); // 이전 계정의 화면 종료
        }
    }
    function render() // 역할과 실제 선택별 버튼
    {
        const server = manager.servers.find((s) => s.id === manager.selected); // 확인한 현재 서버
        const allowed = Boolean(server && ["owner", "admin"].includes(server.role)); // 서버별 관리 권한
        const channel = getChannel(); // 확인한 현재 채널
        const selected = Boolean(channel?.id && channel.serverId === manager.selected); // 같은 서버의 실제 선택
        const busy = manager.busy || manager.loading || !isReady(); // 중복 요청과 미확인 화면
        byId("create-channel").hidden = !allowed; // 빈 서버 관리자 생성 버튼
        byId("rename-channel").hidden = !allowed || !selected; // 일반 회원·미선택 숨김
        byId("delete-channel").hidden = !allowed || !selected; // 삭제 대상 없는 경우 숨김
        for (const id of ["create-channel", "rename-channel", "delete-channel"]) // 관리 진입 상태
        {
            byId(id).disabled = busy; // 전송·계정 처리 중 관리 차단
        }
        const confirmed = target && (mode !== "delete" || target.previewReady && input.value.replace(/^\p{Z}+|\p{Z}+$/gu, "") === target.name); // API와 동일한 이름 확인
        byId("channel-manage-submit").disabled = busy || !allowed || !confirmed; // 확인된 한 작업만 제출
        byId("channel-manage-close").disabled = manager.busy; // 결과 확인 전 닫기 제한
        if (dialog.open && (!manager.identity || !allowed || target?.serverId !== manager.selected || target?.id && !hasChannel(target.id))) // 계정·소속·대상 상실
        {
            clear(); // 더 이상 접근할 수 없는 화면 정리
        }
    }
    async function failure(error, marker) // 현재 화면의 실제 오류 안내
    {
        if (error.code === "STALE_RESPONSE" || marker !== view) // 이전 계정·닫힌 화면의 응답
        {
            return; // 새 계정 오류 처리로 전달하지 않음
        }
        const message = await onError(error); // 기존 인증·CSRF·권한 복구
        if (marker === view && dialog.open) // 같은 화면만 갱신
        {
            byId("channel-manage-error").textContent = message || error.message; // 일반 텍스트 오류
        }
        render(); // 처리 후 버튼 상태
    }
    async function preview(marker) // 고정된 채널의 현재 삭제 영향
    {
        target.previewReady = false; // 이전 이름 확인 무효화
        input.value = ""; // 새 확인 입력 요구
        render(); // 미리보기 완료 전 삭제 차단
        const id = target.id; // 다른 선택으로 바뀌지 않는 대상
        const data = await manager.execute("get_deletion_preview", null, { resource_type: "channel", resource_id: id }); // 기존 공통 API
        if (marker !== view || !dialog.open) // 닫힌 계정 화면
        {
            return; // 늦은 영향 자료 무시
        }
        target.name = data.name; // 현재 서버 이름
        target.previewReady = true; // 실제 조회 성공
        byId("channel-manage-impact").textContent = `${target.serverName} / ${data.name} · 메시지 ${data.message_count}개. 조회 후 추가된 메시지도 영구 삭제될 수 있습니다.`; // 대상과 실제 영향
        render(); // 최신 이름을 입력해야 활성화
    }
    async function open(next) // 선택 시점의 대상을 고정한 화면
    {
        reset(); // 이전 관리 수명 제거
        const server = manager.servers.find((s) => s.id === manager.selected); // 현재 서버 확인
        const channel = getChannel(); // 현재 채널 확인
        if (!server || !["owner", "admin"].includes(server.role) || !isReady() || manager.busy || next !== "create" && (!channel || channel.serverId !== server.id)) // 미확인 진입 차단
        {
            return; // 실제 권한 화면 유지
        }
        mode = next; // 이번 변경 종류
        target = { serverId: server.id, serverName: server.name, id: next === "create" ? null : channel.id, name: next === "create" ? "" : channel.title, previewReady: false }; // 문자열 자원 ID 보관
        const marker = view; // 이번 화면 수명
        byId("channel-manage-title").textContent = { create: "채널 만들기", rename: "채널 이름 변경", delete: "채널 영구 삭제" }[next]; // 명시적 제목
        byId("channel-manage-help").textContent = next === "delete" ? "이 채널과 대화가 영구 삭제됩니다. 현재 채널 이름을 그대로 입력하세요. 마지막 채널을 삭제해도 서버는 남습니다." : "채널 이름은 앞뒤 공백 정리 후 1~100자입니다. 같은 서버의 중복 이름은 사용할 수 없습니다."; // 영향과 입력 규칙
        byId("channel-value-label").textContent = next === "delete" ? "삭제 확인 채널 이름" : "채널 이름"; // 항상 보이는 레이블
        byId("channel-manage-impact").textContent = next === "create" ? `대상 서버: ${server.name}` : `${server.name} / ${target.name}`; // ID 대신 사용자 대상 안내
        byId("channel-manage-submit").textContent = { create: "채널 생성", rename: "이름 저장", delete: "채널 영구 삭제 확인" }[next]; // 최종 실행 버튼
        input.value = next === "rename" ? target.name : ""; // 변경할 이름만 미리 입력
        dialog.showModal(); // 배경 조작 차단
        render(); // 실제 권한과 처리 상태
        if (next === "delete") // 삭제 전에 현재 영향 필수 조회
        {
            try // 최신 이름과 집계 읽기
            {
                await preview(marker); // 고정된 채널만 조회
            }
            catch (error) // 미리보기 실패
            {
                await failure(error, marker); // 실패 시 삭제 차단 유지
            }
        }
        if (marker === view && dialog.open) // 같은 화면의 입력 진입
        {
            input.focus(); // 키보드 포커스
        }
    }
    form.addEventListener("submit", async (event) => // 명시적 변경 한 번 실행
    {
        event.preventDefault(); // 페이지 이동 방지
        render(); // 최신 확인 조건
        if (!dialog.open || byId("channel-manage-submit").disabled || !form.reportValidity()) // 중복·미확인 제출 차단
        {
            return; // DB 요청 없음
        }
        const marker = view; // 제출 당시 화면
        const currentMode = mode; // 응답 중 작업 종류 변경 방지
        const operations = { create: ["create_channel", { server_id: target.serverId, name: input.value }], rename: ["update_channel", { channel_id: target.id, name: input.value }], delete: ["delete_channel", { channel_id: target.id, confirm_name: input.value }] }; // 허용한 요청 필드
        byId("channel-manage-error").textContent = ""; // 이전 실패 제거
        try // 자동 재전송 없는 관리 요청
        {
            const data = await manager.execute(...operations[currentMode]); // 공통 계정·수명 보호
            if (marker !== view) // 이전 화면 결과
            {
                return; // 선택과 목록 변경 중단
            }
            if (data.channel) // 생성·변경한 채널 선택 유지
            {
                manager.rememberChannel(data.channel.id); // 새 채널 또는 기존 ID
            }
            if (currentMode === "delete") // 삭제 성공은 후속 조회와 독립 처리
            {
                onDeleted(data.channel_id); // 확정된 대상 기록과 선택 즉시 폐기
            }
            dialog.close(); // 완료한 관리 작업 종료
            await onReload(); // 실제 목록·제목·기록 갱신
        }
        catch (error) // 거절 또는 불확실한 변경 결과
        {
            if (error.code === "NAME_MISMATCH" && marker === view) // 삭제 직전 이름 변경
            {
                try // 같은 대상의 최신 영향 재확인
                {
                    await preview(marker); // 이름 입력을 비우고 동일 ID 재조회
                    if (marker === view) // 여전히 같은 관리 화면
                    {
                        byId("channel-manage-error").textContent = "채널 이름과 삭제 영향을 다시 확인하세요."; // 명시적 재확인 안내
                    }
                }
                catch (recovery) // 재조회도 실패한 경우
                {
                    await failure(recovery, marker); // 삭제 차단 유지
                }
                return; // 오래된 확인 재사용 없음
            }
            await failure(error, marker); // 현재 계정의 실제 실패만 전달
            if (!error.status && error.code !== "STALE_RESPONSE" && marker === view) // 결과 불명확한 통신 실패
            {
                await onReload(); // 변경 재전송 없이 실제 목록 확인
            }
        }
        render(); // 현재 처리 종료 상태
    }); // 제출 연결 끝
    for (const [id, next] of [["create-channel", "create"], ["rename-channel", "rename"], ["delete-channel", "delete"]]) // 관리 진입 버튼
    {
        byId(id).addEventListener("click", () => open(next)); // 고정된 작업 열기
    }
    input.addEventListener("input", render); // 확인 이름 일치 검사
    byId("channel-manage-close").addEventListener("click", () => dialog.close()); // 취소 시 변경 없음
    dialog.addEventListener("cancel", (event) => // 요청 중 Escape 제한
    {
        if (manager.busy) // 실제 요청 진행
        {
            event.preventDefault(); // 처리 결과 전에 닫기 차단
        }
    }); // Escape 처리 끝
    dialog.addEventListener("close", reset); // 모든 종료의 확인 값 폐기
    return { render, clear }; // 계정·소속 변경 연결
}
