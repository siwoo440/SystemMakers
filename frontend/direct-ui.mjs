import { MessageFeed, createMessageList, messageForDisplay } from "./message-feed.mjs"; // 검증된 기록과 조회 수명
import { ATTACHMENT_LIMIT_TEXT, createAttachmentView, uploadAttachment } from "./attachments-ui.mjs"; // 첨부 한도와 정보 및 업로드
const validId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 문자열 식별자 검사
const validUser = (user) => user && validId(user.id) && typeof user.username === "string" && user.username.length > 0; // 공개 사용자 검사
const validConversation = (conversation) => conversation && validId(conversation.id) && validUser(conversation.other_user); // 공개 대화 검사
const compareId = (leftId, rightId) => leftId.length - rightId.length || (leftId > rightId ? 1 : leftId < rightId ? -1 : 0); // 큰 식별자의 문자열 비교
export function mountDirectUI({ byId, request, getUser, isReady, onOpen, onError, createMessage, onBusyChange = () => undefined, startRealtime = () => null, setTimer, clearTimer, setListTimer = (callback, delay) => globalThis.setTimeout(callback, delay), clearListTimer = (timer) => globalThis.clearTimeout(timer) }) // 개인 대화 화면 연결
{
    let identity = null; // 확인된 계정 식별자
    let version = 0; // 계정과 대화 수명
    let searchVersion = 0; // 검색 순서
    let selectionVersion = 0; // 대화 선택 순서
    let searchController = null; // 검색 취소 도구
    let listController = null; // 목록 취소 도구
    let listTimer = null; // 계정 단위 자동 갱신 예약
    let suspended = false; // 페이지 이탈과 로그아웃 경계
    let navigationOpen = false; // 개인 대화 목록 표시 여부
    let conversations = []; // 확인된 대화 목록
    let selected = null; // 선택한 개인 대화
    let sending = null; // 전송 중복 방지
    let creating = null; // 대화 생성 중복 방지
    let active = false; // 개인 대화 표시 여부
    let realtime = null; // 현재 개인 대화의 알림 연결
    const feeds = new Map(); // 대화별 조회 상태
    const attachmentViews = new Map(); // 대화별 첨부 조회 상태
    const drafts = new Map(); // 대화별 미전송 원문
    const latestSeen = new Map(); // 화면에 반영한 상대 메시지 기준
    const acknowledged = new Map(); // 읽음 처리가 끝난 대화별 기준
    const readRequests = new Map(); // 대화별 진행 중 읽음 요청
    let listButtons = new Map(); // 새로고침 간 같은 대화 버튼 재사용
    const renderBubbles = createMessageList(byId("direct-messages"), createMessage); // 개인 대화별 말풍선 재사용
    function showNavigation(show) // 인접한 탐색 패널 전환
    {
        if (navigationOpen !== show) // 다른 탐색 목록으로 전환
        {
            byId("sidebar-scroll").scrollTop = 0; // 새 목록의 제목과 검색부터 표시
        }
        navigationOpen = show; // 현재 탐색 모드 보관
        byId("channel-sidebar").setAttribute("aria-label", show ? "개인 대화 목록" : "채널 목록"); // 현재 패널의 접근 가능한 이름
        byId("direct-navigation").hidden = !show; // 개인 대화 목록 표시 여부
        byId("server-navigation").hidden = show; // 서버와 채널 목록 표시 여부
        byId("direct-rail").setAttribute("aria-pressed", String(show)); // 레일 선택 상태
    }
    function renderList() // 실제 대화 목록 표시
    {
        let hasUnread = false; // 레일 전체 읽지 않음 여부
        const nextButtons = new Map(); // 현재 목록의 버튼 순서
        for (const conversation of conversations) // 상대방별 선택 버튼
        {
            const conversationId = conversation.id; // 대화의 문자열 식별자
            let entry = listButtons.get(conversationId); // 기존 키보드 위치 보존
            if (!entry) // 처음 표시하는 대화
            {
                const button = document.createElement("button"); // 키보드 접근 버튼
                button.type = "button"; // 폼 제출 방지
                button.className = "channel-button direct-choice"; // 기존 탐색과 배지 스타일
                const name = document.createElement("span"); // 공개 사용자명 영역
                const badge = document.createElement("span"); // 읽지 않은 대화 배지
                badge.className = "direct-unread-badge"; // 공통 알림 모양
                badge.textContent = "!"; // 읽지 않음 표시
                badge.setAttribute("aria-hidden", "true"); // 버튼 이름에서 상태 별도 표시
                button.replaceChildren(name, badge); // 대화와 상태 표시 구성
                button.addEventListener("click", () => open(conversations.find((item) => item.id === conversationId))); // 최신 상대방 자료 사용
                entry = { button, name, badge }; // 같은 요소 재사용 자료
            }
            const { button, name, badge } = entry; // 대화 행의 화면 요소
            const unread = validId(conversation.unread_message_id) && compareId(conversation.unread_message_id, acknowledged.get(conversationId) || "0") > 0; // 확인한 읽음 이후의 새 메시지
            name.textContent = conversation.other_user.username; // 공개 사용자명
            badge.hidden = !unread; // 현재 대화의 안 읽은 상태
            hasUnread ||= unread; // 전체 레일 배지 반영
            button.setAttribute("aria-label", `${conversation.other_user.username}${unread ? " · 읽지 않은 메시지 있음" : ""}`); // 화면 낭독용 상태
            button.setAttribute("aria-pressed", String(active && selected?.id === conversation.id)); // 현재 대화 상태
            nextButtons.set(conversationId, entry); // 목록 순서에 등록
        }
        const previousIds = [...listButtons.keys()]; // 마지막 화면의 대화 순서
        if (previousIds.length !== nextButtons.size || [...nextButtons.keys()].some((id, index) => id !== previousIds[index])) // 목록의 순서나 구성 변경
        {
            byId("direct-list").replaceChildren(...[...nextButtons.values()].map((entry) => entry.button)); // 변경된 대화 탐색 목록
        }
        listButtons = nextButtons; // 표시한 대화 요소 보관
        byId("direct-rail-unread").hidden = !hasUnread; // 전체 개인 대화의 읽지 않음 표시
        byId("direct-rail").setAttribute("aria-label", hasUnread ? "개인 대화 · 읽지 않은 메시지 있음" : "개인 대화"); // 레일의 접근 가능한 알림
    }
    function render() // 로그인과 입력 상태 반영
    {
        const ready = Boolean(getUser() && isReady()); // 인증과 보호 정보 확인
        if (getUser() && byId("direct-status").textContent === "로그인 후 개인 대화를 이용하세요.") // 로그인 이후 게스트 안내
        {
            byId("direct-status").textContent = ""; // 이전 로그인 안내 제거
        }
        byId("direct-search-input").disabled = !ready; // 게스트 검색 차단
        byId("direct-search-submit").disabled = !ready; // 게스트 요청 차단
        byId("direct-refresh").disabled = !ready; // 게스트 목록 조회 차단
        const input = byId("direct-input"); // 개인 초안 입력
        const validContent = /[^\p{White_Space}\uFEFF]/u.test(input.value) && Array.from(input.value).length <= 2000 && !input.value.includes("\u0000"); // 저장 가능한 본문
        input.disabled = !ready || !active || !selected || Boolean(feeds.get(selected?.id)?.blocked); // 확인된 개인 대화만 입력
        byId("direct-send").disabled = input.disabled || Boolean(sending) || !validContent; // 중복과 빈 내용 차단
        byId("direct-file").disabled = input.disabled || Boolean(sending); // 권한 없는 파일 선택 차단
        byId("direct-upload").disabled = byId("direct-file").disabled || !byId("direct-file").files?.length; // 파일 미선택과 중복 전송 차단
        byId("direct-file-clear").disabled = byId("direct-upload").disabled; // 전송 중 선택 취소 차단
        byId("direct-file-clear").hidden = !byId("direct-file").files?.length; // 파일 선택 시에만 취소 표시
        byId("direct-older").hidden = !selected || !feeds.get(selected.id)?.hasOlder; // 과거 기록 존재 여부
        if (ready && !suspended && identity !== getUser().id) // 새 계정의 최초 목록 확인
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
        if (!userId || suspended || listController) // 계정과 중복 요청 확인
        {
            return; // 불필요한 목록 조회 중단
        }
        clearListTimer(listTimer); // 이미 예약한 목록 확인 제거
        listTimer = null; // 기존 예약 참조 정리
        if (!isReady()) // 일시적인 인증 처리와 입력 잠금
        {
            listTimer = setListTimer(refresh, 10000); // 안정된 계정에서 후속 확인
            return; // 처리 중인 계정 요청 보호
        }
        const requestVersion = version; // 계정 수명
        const controller = new AbortController(); // 이번 목록 취소 도구
        listController = controller; // 계정 종료 연결
        try // 실제 목록 확인
        {
            const response = await request("./backend/api/list_dms.php", null, controller.signal); // 인증된 목록 요청
            if (requestVersion !== version || controller.signal.aborted || getUser()?.id !== userId) // 교체된 계정 또는 목록
            {
                return; // 이전 응답 무시
            }
            if (!Array.isArray(response.conversations) || response.conversations.some((conversation) => !validConversation(conversation) || (conversation.unread_message_id != null && !validId(conversation.unread_message_id))) || new Set(response.conversations.map((conversation) => conversation.id)).size !== response.conversations.length) // 대화 목록과 알림 기준 계약
            {
                throw new Error("개인 대화 목록을 확인하지 못했습니다."); // 잘못된 목록 거절
            }
            conversations = response.conversations; // 확인한 목록 보관
            renderList(); // 목록 표시
            readShown(); // 표시 중에 발견한 상대 메시지 읽음 확인
        }
        catch (error) // 조회 실패
        {
            if (!controller.signal.aborted) // 현재 요청 실패
            {
                await report(error, requestVersion, userId); // 현재 계정 오류 표시
            }
        }
        finally // 요청 종료 후 일정한 간격의 재확인
        {
            if (listController === controller) // 같은 계정의 목록 요청
            {
                listController = null; // 완료된 요청 참조 정리
                if (!suspended && version === requestVersion && getUser()?.id === userId) // 여전히 같은 인증 계정
                {
                    listTimer = setListTimer(refresh, 10000); // 계정 전체 알림을 한 요청으로 확인
                }
            }
        }
    }
    async function readShown() // 실제 화면에 반영한 상대 메시지의 읽음 처리
    {
        const conversationId = selected?.id; // 선택한 대화의 기준
        const userId = getUser()?.id; // 표시 중인 계정
        const messageId = latestSeen.get(conversationId); // 현재 표시한 상대 메시지
        const unreadId = conversations.find((entry) => entry.id === conversationId)?.unread_message_id; // 목록에서 확인한 미확인 기록
        const lastReadId = acknowledged.get(conversationId) || "0"; // 마지막 확인한 읽음 기준
        if (!active || !userId || !isReady() || suspended || document.visibilityState === "hidden" || feeds.get(conversationId)?.blocked || !validId(messageId) || !validId(unreadId) || compareId(messageId, lastReadId) <= 0 || compareId(unreadId, lastReadId) <= 0 || readRequests.has(conversationId)) // 표시 중인 권한과 중복 처리 확인
        {
            return; // 미표시 기록과 이미 처리한 기록 보호
        }
        const scroll = byId("direct-scroll"); // 실제로 읽는 위치
        if (byId("direct-conversation").inert || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 80) // 덮인 목록이나 과거 기록 확인 중
        {
            return; // 최신 기록을 확인할 때까지 읽지 않음 유지
        }
        const requestVersion = version; // 작성할 계정의 수명
        const controller = new AbortController(); // 계정 종료용 읽음 요청 정리
        readRequests.set(conversationId, controller); // 같은 대화의 중복 쓰기 차단
        try // 확인한 대화의 읽음 상태 저장
        {
            const response = await request("./backend/api/mark_dm_read.php", { conversation_id: conversationId, message_id: messageId }, controller.signal); // 토큰과 권한으로 보호한 변경
            if (!controller.signal.aborted && version === requestVersion && getUser()?.id === userId && response.last_read_message_id === messageId) // 상태 변경 결과와 계정 확인
            {
                acknowledged.set(conversationId, messageId); // 이전 목록의 알림 복원 차단
                renderList(); // 남은 미확인 메시지 표시
            }
        }
        catch (error) // 계정 종료 또는 읽음 저장 실패
        {
            if (!controller.signal.aborted && (error.status === 401 || ["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code))) // 공통 계정 복구 조건
            {
                await report(error, requestVersion, userId); // 같은 계정의 인증 복구
            }
        }
        finally // 새 목록에서 다음 읽음 처리 가능
        {
            if (readRequests.get(conversationId) === controller) // 동일한 읽음 요청
            {
                readRequests.delete(conversationId); // 현재 요청의 잠금 해제
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
        byId("direct-file-status").textContent = ATTACHMENT_LIMIT_TEXT; // 이전 파일 상태 제거
        selected = conversation; // 현재 상대방 고정
        active = true; // 개인 대화 표시
        showNavigation(true); // 개인 대화 목록 모드 유지
        const userId = getUser().id; // 현재 계정 경계
        const requestVersion = version; // 계정 수명
        onOpen(); // 채널 조회 중단과 화면 전환
        byId("direct-title").textContent = conversation.other_user.username; // 상대방 이름 표시
        byId("direct-input").value = drafts.get(conversation.id) || ""; // 상대방별 초안 복원
        byId("direct-status").textContent = "대화를 불러오는 중입니다."; // 최초 조회 안내
        let feed = feeds.get(conversation.id); // 기존 대화 기록
        function renderMessages() // 선택 대화의 작성자와 파일 표시
        {
            const attachments = attachmentViews.get(conversation.id); // 현재 대화의 기존 첨부 정보
            renderBubbles(feed, feed.list().map((message) => messageForDisplay(message, getUser(), attachments))); // 변경된 말풍선만 반영
        }
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
                if (change.recordsChanged) // 표시 기록 변경 여부
                {
                    const scroll = byId("direct-scroll"); // 개인 기록 스크롤
                    const previousTop = scroll.scrollTop; // 현재 읽는 위치
                    const previousHeight = scroll.scrollHeight; // 이전 기록 높이
                    const nearBottom = previousHeight - previousTop - scroll.clientHeight <= 80; // 최신 기록을 읽는 상태
                    renderMessages(); // 변경된 개인 대화 표시
                    scroll.scrollTop = change.kind === "before" ? previousTop + scroll.scrollHeight - previousHeight : change.kind === "initial" || (change.kind === "after" && nearBottom) || change.kind === "send" ? scroll.scrollHeight : previousTop; // 기록 추가 뒤 읽는 위치 복원
                }
                byId("direct-status").textContent = feed.error ? "대화를 불러오지 못했습니다. 다시 확인하는 중입니다." : feed.loaded ? "대화 자동 갱신 중" : "대화를 불러오는 중입니다."; // 실제 조회 상태
                render(); // 입력과 과거 버튼 갱신
                if (change.messages && feed.active && !feed.blocked) // 현재 대화의 확인된 페이지
                {
                    const newestIncoming = change.messages.findLast((message) => message.user_id === conversation.other_user.id)?.id; // 표시한 상대방 메시지 중 가장 최신 ID
                    if (newestIncoming && compareId(newestIncoming, latestSeen.get(conversation.id) || "0") > 0) // 새로 확인한 상대방 메시지
                    {
                        latestSeen.set(conversation.id, newestIncoming); // 해당 대화에서 확인한 범위 갱신
                    }
                    readShown(); // 실제로 표시 중인 대화만 읽음 처리
                    attachmentViews.get(conversation.id)?.load(change.messages); // 새 페이지와 미완료 첨부 확인
                }
            }, onError: (error) => report(error, requestVersion, userId) }); // 인증 오류 연결
            feeds.set(conversation.id, feed); // 같은 계정의 기록 보관
            attachmentViews.set(conversation.id, createAttachmentView({ kind: "direct", targetId: conversation.id, userId, getUser, request, onChange: () => // 현재 대화의 파일 정보 반영
            {
                if (version !== requestVersion || getUser()?.id !== userId || !active || selected?.id !== conversation.id || feed.blocked) // 다른 계정 또는 상대방
                {
                    return; // 이전 파일 결과 무시
                }
                renderMessages(); // 확인된 다운로드 링크 표시
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
            } }));
        }
        renderMessages(); // 선택한 대화의 기존 기록 복원
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
        byId("direct-file-status").textContent = ATTACHMENT_LIMIT_TEXT; // 이전 파일 상태 제거
        active = false; // 채널 화면 표시
        byId("direct-conversation").hidden = true; // 개인 화면 숨김
        byId("channel-conversation").hidden = false; // 채널 화면 표시
        renderList(); // 개인 선택 강조 제거
    }
    function clear() // 계정 종료 시 민감 자료 폐기
    {
        version++; // 이전 모든 결과 무효화
        searchVersion++; // 이전 검색 결과 무효화
        selectionVersion++; // 이전 대화 생성 결과 무효화
        searchController?.abort(); // 검색 취소
        suspend(); // 계정 전체의 조회와 읽음 처리 중단
        feeds.forEach((feed) => feed.pause()); // 모든 대화의 예약 취소
        attachmentViews.forEach((view) => view.stop()); // 모든 첨부 조회 취소
        feeds.clear(); // 개인 기록 제거
        attachmentViews.clear(); // 개인 파일 정보 제거
        drafts.clear(); // 개인 초안 제거
        latestSeen.clear(); // 이전 계정의 표시 범위 제거
        acknowledged.clear(); // 이전 계정의 읽음 처리 기준 제거
        conversations = []; // 이전 계정 목록 제거
        selected = null; // 선택 상대방 제거
        identity = null; // 계정 확인 초기화
        sending = null; // 이전 전송 잠금 폐기
        creating = null; // 이전 생성 잠금 폐기
        active = false; // 개인 화면 종료
        suspended = false; // 다음 계정의 자동 확인 허용
        showNavigation(false); // 다음 계정의 서버 목록 복구
        byId("direct-input").value = ""; // 초안 화면 제거
        byId("direct-file").value = ""; // 이전 계정의 선택 파일 제거
        byId("direct-file-status").textContent = ATTACHMENT_LIMIT_TEXT; // 이전 파일 상태 제거
        byId("direct-search-input").value = ""; // 검색어 제거
        byId("direct-search-results").replaceChildren(); // 검색 결과 제거
        renderBubbles(null, []); // 계정 종료 후 말풍선과 참조 정리
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
            const existing = conversations.find((entry) => entry.id === created.conversation.id); // 기존 대화의 미확인 상태 조회
            conversations = [{ ...created.conversation, unread_message_id: existing?.unread_message_id ?? null }, ...conversations.filter((entry) => entry.id !== created.conversation.id)]; // 미확인 상태를 보존한 목록 병합
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
            }));
            byId("direct-status").textContent = response.users.length ? "사용자를 선택해 대화를 시작하세요." : "일치하는 사용자가 없습니다."; // 실제 검색 결과 안내
        }
        catch (error) // 검색 실패
        {
            if (requestOrder === searchVersion) // 최신 검색 오류
            {
                await report(error, requestVersion, userId); // 현재 계정 오류 안내
            }
        }
    });
    byId("direct-search-input").addEventListener("input", () => // 새 검색어 편집
    {
        searchVersion++; // 이전 검색 결과 무효화
        searchController?.abort(); // 진행 중인 검색 취소
        byId("direct-search-results").replaceChildren(); // 이전 검색 결과 제거
    });
    byId("direct-refresh").addEventListener("click", refresh); // 대화 목록 명시적 갱신
    byId("direct-scroll").addEventListener("scroll", readShown); // 새 상대방 메시지까지 스크롤했을 때 읽음 처리
    byId("direct-input").addEventListener("input", render); // 초안 유효성 갱신
    byId("direct-input").addEventListener("keydown", (event) => // 개인 대화 입력 단축키
    {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) // 줄바꿈과 한글 조합을 제외한 전송 키
        {
            event.preventDefault(); // 단독 Enter의 기본 줄바꿈 차단
            byId("direct-form").requestSubmit(); // 기존 검증과 잠금을 거친 폼 전송
        }
    });
    byId("direct-file").addEventListener("change", () => // 파일 선택 상태 갱신
    {
        byId("direct-file-status").textContent = byId("direct-file").files[0]?.name || ATTACHMENT_LIMIT_TEXT; // 선택한 파일 이름 안내
        render(); // 파일 전송 가능 여부 갱신
    });
    byId("direct-file-clear").addEventListener("click", () => // 선택한 개인 파일 취소
    {
        if (byId("direct-file-clear").disabled) // 전송 중 또는 선택 없음
        {
            return; // 진행 중 전송 보존
        }
        byId("direct-file").value = ""; // 선택한 파일만 제거
        byId("direct-file-status").textContent = ATTACHMENT_LIMIT_TEXT; // 기본 파일 안내 복구
        render(); // 취소와 전송 상태 갱신
    });
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
    });
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
            feeds.get(conversationId)?.add({ ...message, channel_id: message.conversation_id, attachment: null }); // 검증된 저장 결과 병합
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
    });
    function suspend() // 화면 이탈 시 조회 중단
    {
        suspended = true; // 목록과 읽음 처리 중지
        clearListTimer(listTimer); // 계정 목록 예약 취소
        listTimer = null; // 대기 중인 예약 참조 제거
        listController?.abort(); // 진행 중인 계정 목록 취소
        listController = null; // 취소한 요청 참조 제거
        readRequests.forEach((controller) => controller.abort()); // 진행 중인 읽음 처리 취소
        readRequests.clear(); // 취소한 읽음 요청 참조 제거
        feeds.get(selected?.id)?.pause(); // 현재 기록 조회 중단
        attachmentViews.get(selected?.id)?.stop(); // 현재 첨부 조회 중단
        realtime?.stop(); // 현재 알림 연결 중단
        realtime = null; // 이전 연결 제거
    }
    function resume() // 복원된 화면의 누락 기록 확인
    {
        suspended = false; // 계정 단위 확인 재개
        refresh(); // 모든 대화의 알림 재확인
        if (active && selected && getUser() && isReady()) // 같은 계정의 개인 화면
        {
            const feed = feeds.get(selected.id); // 이전 기록 조회 상태
            feed?.activate(); // 권한 검사 조회 복구
            realtime = startRealtime(selected.id, feed, getUser().id); // 알림 구독 복구
        }
    }
    function renameUser(userId, username) // 열린 개인 대화의 본인 이름 반영
    {
        feeds.get(selected?.id)?.renameUser(userId, username); // 현재 기록의 작성자 갱신
    }
    return { render, refresh, clear, close, suspend, resume, readShown, showNavigation, startConversation, renameUser, isNavigationOpen: () => navigationOpen, isActive: () => active, isBusy: () => Boolean(sending) }; // 계정과 채널 연결 경계
}
