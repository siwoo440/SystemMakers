import { MessageFeed } from "./message-feed.mjs"; // 검증된 기록과 조회 수명
import { createAttachmentView, uploadAttachment } from "./attachments-ui.mjs"; // 첨부 정보와 명시적 업로드
const validId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 문자열 식별자 검사
const validUser = (user) => user && validId(user.id) && typeof user.username === "string" && user.username.length > 0; // 공개 사용자 검사
const validConversation = (conversation) => conversation && validId(conversation.id) && validUser(conversation.other_user); // 공개 대화 검사
export function mountDirectUI({ byId, request, getUser, isReady, onOpen, onError, createMessage, onBusyChange = () => undefined, startRealtime = () => null, setTimer, clearTimer }) // 개인 대화 화면 연결
{
    let identity = null; // 확인된 계정 식별자
    let version = 0; // 계정과 대화 수명
    let searchVersion = 0; // 검색 순서
    let listVersion = 0; // 목록 순서
    let selectionVersion = 0; // 대화 선택 순서
    let searchController = null; // 검색 취소 도구
    let listController = null; // 목록 취소 도구
    let conversations = []; // 확인된 대화 목록
    let selected = null; // 선택한 개인 대화
    let sending = null; // 전송 중복 방지
    let creating = null; // 대화 생성 중복 방지
    let active = false; // 개인 대화 표시 여부
    let realtime = null; // 현재 개인 대화의 알림 연결
    const feeds = new Map(); // 대화별 조회 상태
    const attachmentViews = new Map(); // 대화별 첨부 조회 상태
    const drafts = new Map(); // 대화별 미전송 원문
    function renderList() // 실제 대화 목록 표시
    {
        byId("direct-list").replaceChildren(...conversations.map((conversation) => // 상대방별 선택 버튼
        {
            const button = document.createElement("button"); // 키보드 접근 버튼
            button.type = "button"; // 폼 제출 방지
            button.className = "channel-button"; // 기존 탐색 스타일
            button.textContent = conversation.other_user.username; // 공개 사용자명
            button.setAttribute("aria-pressed", String(active && selected?.id === conversation.id)); // 현재 대화 상태
            button.addEventListener("click", () => open(conversation)); // 확인한 대화 선택
            return button; // 생성한 버튼
        })); // 목록 교체 끝
    }
    function render() // 로그인과 입력 상태 반영
    {
        const ready = Boolean(getUser() && isReady()); // 인증과 보호 정보 확인
        byId("direct-search-input").disabled = !ready; // 게스트 검색 차단
        byId("direct-search-submit").disabled = !ready; // 게스트 요청 차단
        byId("direct-refresh").disabled = !ready; // 게스트 목록 조회 차단
        const input = byId("direct-input"); // 개인 초안 입력
        const validContent = /[^\p{White_Space}\uFEFF]/u.test(input.value) && Array.from(input.value).length <= 2000 && !input.value.includes("\u0000"); // 저장 가능한 본문
        input.disabled = !ready || !active || !selected || Boolean(feeds.get(selected?.id)?.blocked); // 확인된 개인 대화만 입력
        byId("direct-send").disabled = input.disabled || Boolean(sending) || !validContent; // 중복과 빈 내용 차단
        byId("direct-file").disabled = input.disabled || Boolean(sending); // 권한 없는 파일 선택 차단
        byId("direct-upload").disabled = byId("direct-file").disabled || !byId("direct-file").files?.length; // 파일 미선택과 중복 전송 차단
        byId("direct-older").hidden = !selected || !feeds.get(selected.id)?.hasOlder; // 과거 기록 존재 여부
        if (ready && identity !== getUser().id) // 새 계정의 최초 목록 확인
        {
            identity = getUser().id; // 중복 조회 방지
            refresh(); // 확인된 계정의 대화 목록
        }
    }
    async function report(error, requestVersion, userId) // 계정 수명 내 오류 안내
    {
        if (requestVersion !== version || getUser()?.id !== userId) // 이전 계정 또는 화면
        {
            return; // 늦은 오류 무시
        }
        const message = error.status === 403 && !["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code) ? "요청을 처리할 수 없습니다." : await onError(error); // 차단 여부의 상세 사유 비노출
        if (requestVersion === version && getUser()?.id === userId) // 오류 처리 중 계정 확인
        {
            byId("direct-status").textContent = message || "요청을 처리하지 못했습니다."; // 확인된 실패 안내
        }
    }
    async function refresh() // 현재 계정의 대화 목록 조회
    {
        const userId = getUser()?.id; // 요청 계정
        if (!userId || !isReady()) // 인증과 보호 정보 확인
        {
            return; // 게스트 조회 중단
        }
        const requestVersion = version; // 계정 수명
        const requestOrder = ++listVersion; // 최신 목록 순서
        listController?.abort(); // 이전 목록 요청 취소
        const controller = new AbortController(); // 이번 목록 취소 도구
        listController = controller; // 계정 종료 연결
        try // 실제 목록 확인
        {
            const response = await request("./backend/api/list_dms.php", null, controller.signal); // 인증된 목록 요청
            if (requestVersion !== version || requestOrder !== listVersion || getUser()?.id !== userId) // 교체된 계정 또는 목록
            {
                return; // 이전 응답 무시
            }
            if (!Array.isArray(response.conversations) || response.conversations.some((conversation) => !validConversation(conversation)) || new Set(response.conversations.map((conversation) => conversation.id)).size !== response.conversations.length) // 대화 목록 계약
            {
                throw new Error("개인 대화 목록을 확인하지 못했습니다."); // 잘못된 목록 거절
            }
            conversations = response.conversations; // 확인한 목록 보관
            renderList(); // 목록 표시
        }
        catch (error) // 조회 실패
        {
            if (requestOrder === listVersion) // 최신 요청 실패
            {
                await report(error, requestVersion, userId); // 현재 계정 오류 표시
            }
        }
    }
    async function open(conversation) // 확인한 상대방 대화 선택
    {
        if (!validConversation(conversation) || !getUser() || !isReady()) // 대화와 계정 확인
        {
            return; // 미확인 선택 중단
        }
        selectionVersion++; // 이전 대화 생성 결과 무효화
        if (selected) // 이전 대화 존재
        {
            drafts.set(selected.id, byId("direct-input").value); // 이전 초안 보존
            feeds.get(selected.id)?.pause(); // 이전 조회와 예약 취소
            attachmentViews.get(selected.id)?.stop(); // 이전 첨부 조회 취소
            realtime?.stop(); // 이전 대화의 알림 중단
            realtime = null; // 이전 알림 연결 제거
        }
        byId("direct-file").value = ""; // 이전 대화의 선택 파일 제거
        byId("direct-file-status").textContent = "최대 5 MiB"; // 이전 파일 상태 제거
        selected = conversation; // 현재 상대방 고정
        active = true; // 개인 대화 표시
        const userId = getUser().id; // 현재 계정 경계
        const requestVersion = version; // 계정 수명
        onOpen(); // 채널 조회 중단과 화면 전환
        byId("direct-title").textContent = conversation.other_user.username; // 상대방 이름 표시
        byId("direct-input").value = drafts.get(conversation.id) || ""; // 상대방별 초안 복원
        byId("direct-status").textContent = "대화를 불러오는 중입니다."; // 최초 조회 안내
        let feed = feeds.get(conversation.id); // 기존 대화 기록
        if (!feed) // 최초 선택
        {
            feed = new MessageFeed({ channelId: conversation.id, setTimer, clearTimer, request: async (query, signal) => // 검증된 기록 조회 재사용
            {
                query.delete("channel_id"); // 채널 전용 필드 제거
                query.set("conversation_id", conversation.id); // 개인 대화 식별자
                const response = await request("./backend/api/get_dm_messages.php?" + query, null, signal); // 인증된 개인 기록 조회
                return { ...response, messages: Array.isArray(response.messages) ? response.messages.map((message) => ({ ...message, channel_id: message.conversation_id })) : response.messages }; // 공통 조회 검증 연결
            }, onChange: (change) => // 확인된 기록과 상태 표시
            {
                if (version !== requestVersion || getUser()?.id !== userId || !active || selected?.id !== conversation.id) // 다른 계정 또는 상대방
                {
                    return; // 이전 화면 갱신 차단
                }
                const scroll = byId("direct-scroll"); // 개인 기록 스크롤
                const previousTop = scroll.scrollTop; // 현재 읽는 위치
                const previousHeight = scroll.scrollHeight; // 이전 기록 높이
                const nearBottom = previousHeight - previousTop - scroll.clientHeight <= 80; // 최신 기록을 읽는 상태
                byId("direct-messages").replaceChildren(...feed.list().map((message) => createMessage({ name: message.user_id === userId ? getUser().username : message.username, timestamp: message.created_at, text: message.content, attachment: attachmentViews.get(conversation.id)?.get(message.id) }))); // 안전한 기록과 파일 표시
                scroll.scrollTop = change.kind === "before" ? previousTop + scroll.scrollHeight - previousHeight : change.kind === "initial" || (change.kind === "after" && nearBottom) || change.kind === "send" ? scroll.scrollHeight : previousTop; // 이전 위치와 최신 기록 이동
                byId("direct-status").textContent = feed.error ? "대화를 불러오지 못했습니다. 다시 확인하는 중입니다." : feed.loaded ? "대화 자동 갱신 중" : "대화를 불러오는 중입니다."; // 실제 조회 상태
                render(); // 입력과 과거 버튼 갱신
                if (feed.active && !feed.blocked) // 현재 대화의 확인된 기록
                {
                    attachmentViews.get(conversation.id)?.load(feed.list()); // 메시지별 첨부 정보 조회
                }
            }, onError: (error) => report(error, requestVersion, userId) }); // 인증 오류 연결
            feeds.set(conversation.id, feed); // 같은 계정의 기록 보관
            attachmentViews.set(conversation.id, createAttachmentView({ kind: "direct", targetId: conversation.id, userId, getUser, request, onChange: () => // 현재 대화의 파일 정보 반영
            {
                if (version !== requestVersion || getUser()?.id !== userId || !active || selected?.id !== conversation.id || feed.blocked) // 다른 계정 또는 상대방
                {
                    return; // 이전 파일 결과 무시
                }
                byId("direct-messages").replaceChildren(...feed.list().map((message) => createMessage({ name: message.user_id === userId ? getUser().username : message.username, timestamp: message.created_at, text: message.content, attachment: attachmentViews.get(conversation.id)?.get(message.id) }))); // 확인된 다운로드 링크 표시
            }, onError: (error) => // 실제 첨부 조회 실패
            {
                if (version !== requestVersion || getUser()?.id !== userId || !active || selected?.id !== conversation.id) // 이전 대화의 실패
                {
                    return; // 새 화면 변경 차단
                }
                if (error.status === 401 || error.code === "SESSION_CHANGED") // 실제 인증 종료
                {
                    report(error, requestVersion, userId); // 세션 복구 연결
                }
                else if ([403, 404].includes(error.status)) // 개인 대화 접근 상실
                {
                    feed.block(error); // 이전 기록과 조회 제거
                }
                else // 파일 정보 조회 오류
                {
                    byId("direct-file-status").textContent = "파일 정보를 확인하지 못했습니다. 다시 확인합니다."; // 후속 조회 안내
                }
            } })); // 개인 첨부 조회 연결 끝
        }
        byId("direct-messages").replaceChildren(...feed.list().map((message) => createMessage({ name: message.user_id === userId ? getUser().username : message.username, timestamp: message.created_at, text: message.content, attachment: attachmentViews.get(conversation.id)?.get(message.id) }))); // 기존 상대방 기록만 표시
        renderList(); // 선택 상태 갱신
        render(); // 현재 입력 상태
        const loading = feed.activate(); // 최초 조회와 이후 자동 갱신
        realtime = startRealtime(conversation.id, feed, userId); // 본문 없는 개인 알림 구독
        await loading; // 최초 조회 완료 대기
    }
    function close() // 채널 화면으로 복귀
    {
        selectionVersion++; // 이전 생성 결과의 화면 전환 방지
        if (selected) // 현재 개인 대화 존재
        {
            drafts.set(selected.id, byId("direct-input").value); // 전환 직전 초안 보관
            feeds.get(selected.id)?.pause(); // 개인 조회 중단
            attachmentViews.get(selected.id)?.stop(); // 개인 첨부 조회 중단
        }
        realtime?.stop(); // 개인 대화의 알림 중단
        realtime = null; // 이전 연결 제거
        byId("direct-file").value = ""; // 이전 대상 파일 선택 제거
        byId("direct-file-status").textContent = "최대 5 MiB"; // 이전 파일 상태 제거
        active = false; // 채널 화면 표시
        byId("direct-conversation").hidden = true; // 개인 화면 숨김
        byId("channel-conversation").hidden = false; // 채널 화면 표시
        renderList(); // 개인 선택 강조 제거
    }
    function clear() // 계정 종료 시 민감 자료 폐기
    {
        version++; // 이전 모든 결과 무효화
        searchVersion++; // 이전 검색 결과 무효화
        listVersion++; // 이전 목록 결과 무효화
        selectionVersion++; // 이전 대화 생성 결과 무효화
        searchController?.abort(); // 검색 취소
        listController?.abort(); // 목록 취소
        feeds.forEach((feed) => feed.pause()); // 모든 조회와 예약 취소
        attachmentViews.forEach((view) => view.stop()); // 모든 첨부 조회 취소
        realtime?.stop(); // 이전 계정의 알림 중단
        realtime = null; // 이전 계정의 연결 제거
        feeds.clear(); // 개인 기록 제거
        attachmentViews.clear(); // 개인 파일 정보 제거
        drafts.clear(); // 개인 초안 제거
        conversations = []; // 이전 계정 목록 제거
        selected = null; // 선택 상대방 제거
        identity = null; // 계정 확인 초기화
        sending = null; // 이전 전송 잠금 폐기
        creating = null; // 이전 생성 잠금 폐기
        active = false; // 개인 화면 종료
        byId("direct-input").value = ""; // 초안 화면 제거
        byId("direct-file").value = ""; // 이전 계정의 선택 파일 제거
        byId("direct-file-status").textContent = "최대 5 MiB"; // 이전 파일 상태 제거
        byId("direct-search-input").value = ""; // 검색어 제거
        byId("direct-search-results").replaceChildren(); // 검색 결과 제거
        byId("direct-messages").replaceChildren(); // 기록 화면 제거
        byId("direct-title").textContent = "개인 대화"; // 상대방 이름 제거
        byId("direct-status").textContent = "로그인 후 개인 대화를 이용하세요."; // 게스트 안내
        byId("direct-conversation").hidden = true; // 개인 화면 숨김
        byId("channel-conversation").hidden = false; // 채널 화면 복구
        renderList(); // 이전 목록 제거
    }
    async function startConversation(user) // 확인한 사용자와 개인 대화 시작
    {
        const userId = getUser()?.id; // 요청 계정 식별자
        const requestVersion = version; // 현재 계정 수명
        if (!validUser(user) || !userId || !isReady() || creating || user.id === userId) // 계정과 대상 및 중복 검사
        {
            return; // 확인하지 않은 생성 중단
        }
        const creation = {}; // 이번 생성 식별자
        creating = creation; // 중복 생성 잠금
        const selectionOrder = ++selectionVersion; // 최초 대상의 선택 순서
        try // 현재 계정의 대화 생성
        {
            const created = await request("./backend/api/create_dm.php", { user_id: user.id }); // 기존 대화 재사용
            if (requestVersion !== version || selectionOrder !== selectionVersion || getUser()?.id !== userId || !validConversation(created.conversation) || created.conversation.other_user.id !== user.id) // 계정과 대상 검사
            {
                return; // 이전 계정 또는 잘못된 대상 무시
            }
            conversations = [created.conversation, ...conversations.filter((entry) => entry.id !== created.conversation.id)]; // 중복 없는 목록 병합
            byId("direct-search-results").replaceChildren(); // 이전 검색 결과 제거
            await open(created.conversation); // 생성한 대화 표시
        }
        catch (error) // 대화 생성 실패
        {
            await report(error, requestVersion, userId); // 현재 계정 오류 안내
        }
        finally // 이번 생성 잠금 정리
        {
            if (creating === creation) // 현재 생성 여부
            {
                creating = null; // 중복 생성 잠금 해제
            }
        }
    }
    byId("direct-search-form").addEventListener("submit", async (event) => // 사용자 명시적 검색
    {
        event.preventDefault(); // 페이지 이동 방지
        const userId = getUser()?.id; // 요청 계정
        const term = byId("direct-search-input").value.trim(); // 사용자 검색어
        if (!userId || !isReady() || !/^[a-zA-Z0-9_가-힣]{1,32}$/u.test(term)) // API 검색 형식
        {
            byId("direct-status").textContent = "사용자명을 확인하세요."; // 검색 조건 안내
            return; // 잘못된 검색 중단
        }
        const requestVersion = version; // 계정 수명
        const requestOrder = ++searchVersion; // 검색 순서
        searchController?.abort(); // 이전 검색 취소
        const controller = new AbortController(); // 이번 검색 취소 도구
        searchController = controller; // 종료 시 취소 연결
        try // 실제 사용자 검색
        {
            const response = await request("./backend/api/search_users.php?" + new URLSearchParams({ q: term }), null, controller.signal); // 검색어 인코딩
            if (requestVersion !== version || requestOrder !== searchVersion || getUser()?.id !== userId) // 오래된 검색 결과
            {
                return; // 이전 결과 무시
            }
            if (!Array.isArray(response.users) || response.users.some((user) => !validUser(user) || user.id === userId)) // 공개 검색 결과 검사
            {
                throw new Error("검색 결과를 확인하지 못했습니다."); // 잘못된 사용자 거절
            }
            byId("direct-search-results").replaceChildren(...response.users.map((user) => // 공개 사용자 버튼
            {
                const button = document.createElement("button"); // 검색 결과 버튼
                button.type = "button"; // 폼 제출 방지
                button.className = "channel-button"; // 탐색 버튼 스타일
                button.textContent = user.username; // 안전한 사용자명 표시
                button.addEventListener("click", () => requestVersion === version && getUser()?.id === userId ? startConversation(user) : undefined); // 확인한 계정의 대화 시작
                return button; // 검색 결과 반환
            })); // 검색 결과 교체 끝
            byId("direct-status").textContent = response.users.length ? "사용자를 선택해 대화를 시작하세요." : "일치하는 사용자가 없습니다."; // 실제 검색 결과 안내
        }
        catch (error) // 검색 실패
        {
            if (requestOrder === searchVersion) // 최신 검색 오류
            {
                await report(error, requestVersion, userId); // 현재 계정 오류 안내
            }
        }
    }); // 검색 연결 끝
    byId("direct-search-input").addEventListener("input", () => // 새 검색어 편집
    {
        searchVersion++; // 이전 검색 결과 무효화
        searchController?.abort(); // 진행 중인 검색 취소
        byId("direct-search-results").replaceChildren(); // 이전 검색 결과 제거
    }); // 검색어 편집 연결 끝
    byId("direct-refresh").addEventListener("click", refresh); // 대화 목록 명시적 갱신
    byId("direct-input").addEventListener("input", render); // 초안 유효성 갱신
    byId("direct-file").addEventListener("change", () => // 파일 선택 상태 갱신
    {
        byId("direct-file-status").textContent = byId("direct-file").files[0]?.name || "최대 5 MiB"; // 선택한 파일 이름 안내
        render(); // 파일 전송 가능 여부 갱신
    }); // 파일 선택 처리 끝
    byId("direct-upload").addEventListener("click", async () => // 명시적 개인 파일 전송
    {
        render(); // 계정과 전송 가능 여부 확인
        if (byId("direct-upload").disabled) // 파일 미선택 또는 전송 중
        {
            return; // 중복 요청 차단
        }
        const conversationId = selected.id; // 제출한 개인 대화
        const userId = getUser().id; // 제출한 계정
        const requestVersion = version; // 현재 계정 수명
        const file = byId("direct-file").files[0]; // 사용자가 선택한 파일
        const submission = {}; // 이번 전송 식별자
        sending = submission; // 메시지와 공통 전송 잠금
        byId("direct-file-status").textContent = "파일을 전송하는 중입니다."; // 진행 안내
        render(); // 중복 전송 차단
        onBusyChange(); // 계정 전환 잠금 갱신
        try // 사용자 요청 한 번 전송
        {
            const response = await uploadAttachment({ kind: "direct", targetId: conversationId, userId, file, request }); // 보호된 multipart 요청
            if (requestVersion !== version || getUser()?.id !== userId || sending !== submission || !active || selected?.id !== conversationId) // 계정과 대화 수명 확인
            {
                return; // 이전 대화 결과 무시
            }
            attachmentViews.get(conversationId).add(response.attachment); // 확인된 파일 정보 보관
            feeds.get(conversationId).add({ ...response.message, channel_id: conversationId }); // 저장된 메시지 표시
            byId("direct-file").value = ""; // 성공한 파일 선택 제거
            byId("direct-file-status").textContent = "파일을 저장했습니다."; // 확인된 결과 안내
        }
        catch (error) // 거절 또는 불확실한 결과
        {
            if (requestVersion !== version || getUser()?.id !== userId) // 이전 계정 실패
            {
                return; // 이전 계정 오류 차단
            }
            if (error.status === 401 || ["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code)) // 세션 또는 보호 정보 복구
            {
                const message = await onError(error); // 자동 재전송 없는 계정 확인
                if (requestVersion === version && getUser()?.id === userId && active && selected?.id === conversationId) // 복구 중 계정과 대상 확인
                {
                    byId("direct-file-status").textContent = message || "파일 결과를 확인하지 못했습니다."; // 현재 대화의 복구 안내
                }
                return; // 계정 복구 처리 종료
            }
            if (!active || selected?.id !== conversationId) // 다른 대화의 일반 실패
            {
                return; // 다른 화면 표시 차단
            }
            const message = error.status === 403 && !["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code) ? "파일을 전송할 수 없습니다." : await onError(error); // 차단 상세 비노출과 보호 정보 복구
            if (requestVersion === version && getUser()?.id === userId && active && selected?.id === conversationId) // 오류 처리 중 대화 확인
            {
                byId("direct-file-status").textContent = message || "파일 결과를 확인하지 못했습니다."; // 재전송 없는 실패 안내
            }
        }
        finally // 동일 요청 잠금 해제
        {
            if (sending === submission) // 현재 전송 여부
            {
                sending = null; // 전송 잠금 해제
                render(); // 파일과 메시지 입력 복구
                onBusyChange(); // 계정 전환 잠금 해제
            }
        }
    }); // 개인 파일 전송 연결 끝
    byId("direct-older").addEventListener("click", () => selected && feeds.get(selected.id)?.older()); // 명시적 이전 기록 조회
    byId("direct-form").addEventListener("submit", async (event) => // 사용자 명시적 전송
    {
        event.preventDefault(); // 페이지 이동 방지
        render(); // 최신 전송 조건 계산
        if (byId("direct-send").disabled) // 비활성 입력 또는 중복 요청
        {
            return; // 전송 차단
        }
        const conversationId = selected.id; // 제출한 대화
        const userId = getUser().id; // 제출한 계정
        const requestVersion = version; // 계정 수명
        const content = byId("direct-input").value; // 제출한 본문
        const submission = {}; // 이번 전송 식별자
        sending = submission; // 중복 전송 잠금
        render(); // 버튼 잠금 표시
        onBusyChange(); // 계정 전환 잠금 갱신
        try // 실제 저장 한 번 실행
        {
            const response = await request("./backend/api/send_dm.php", { conversation_id: conversationId, content }); // 인증과 CSRF 보호 전송
            if (requestVersion !== version || getUser()?.id !== userId || sending !== submission) // 이전 계정 응답
            {
                return; // 늦은 응답 무시
            }
            const message = response.message; // 실제 저장 메시지
            if (!message || message.conversation_id !== conversationId || message.user_id !== userId || message.content !== content) // 응답 대상과 원문 검사
            {
                throw new Error("저장 결과를 확인하지 못했습니다."); // 불확실한 저장 안내
            }
            feeds.get(conversationId)?.add({ ...message, channel_id: message.conversation_id }); // 검증된 저장 결과 병합
            if (selected?.id === conversationId && byId("direct-input").value === content) // 제출 후 수정 없는 현재 초안
            {
                byId("direct-input").value = ""; // 확인한 초안 제거
            }
            if (drafts.get(conversationId) === content) // 전환 중 보관한 동일 초안
            {
                drafts.delete(conversationId); // 성공한 이전 초안 제거
            }
            if (active && selected?.id === conversationId) // 여전히 같은 대화
            {
                byId("direct-status").textContent = "메시지를 저장했습니다."; // 확인된 저장 안내
            }
        }
        catch (error) // 실제 실패 또는 결과 미확인
        {
            if ((!active || selected?.id !== conversationId) && error.status !== 401 && !["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code)) // 다른 대화의 일반 실패
            {
                return; // 현재 상대방의 안내 변경 차단
            }
            await report(error, requestVersion, userId); // 자동 재전송 없는 오류 안내
        }
        finally // 동일 요청의 잠금만 해제
        {
            if (sending === submission) // 현재 전송 여부
            {
                sending = null; // 전송 잠금 해제
                render(); // 입력 가능 상태 갱신
                onBusyChange(); // 계정 전환 잠금 해제
            }
        }
    }); // 전송 연결 끝
    function suspend() // 화면 이탈 시 조회 중단
    {
        feeds.get(selected?.id)?.pause(); // 현재 기록 조회 중단
        attachmentViews.get(selected?.id)?.stop(); // 현재 첨부 조회 중단
        realtime?.stop(); // 현재 알림 연결 중단
        realtime = null; // 이전 연결 제거
    }
    function resume() // 복원된 화면의 누락 기록 확인
    {
        if (active && selected && getUser() && isReady()) // 같은 계정의 개인 화면
        {
            const feed = feeds.get(selected.id); // 이전 기록 조회 상태
            feed?.activate(); // 권한 검사 조회 복구
            realtime = startRealtime(selected.id, feed, getUser().id); // 알림 구독 복구
        }
    }
    return { render, refresh, clear, close, suspend, resume, startConversation, isActive: () => active, isBusy: () => Boolean(sending) }; // 계정과 채널 연결 경계
}
