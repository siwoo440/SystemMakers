"use strict"; // 엄격한 자바스크립트 검사
import { MessageFeed } from "./message-feed.mjs"; // 채널 기록과 자동 갱신 수명 관리
import { ServerManager } from "./server-manager.mjs"; // 실제 서버 소속 상태
import { mountServerUI } from "./server-ui.mjs"; // 명시적 관리 화면
import { mountChannelUI } from "./channel-ui.mjs"; // 역할별 채널 관리 화면
import { mountProfileUI } from "./profile-ui.mjs"; // 본인 정보 조회·사용자명 수정
import { createRealtimeClient } from "./realtime.mjs"; // 인증된 새 메시지 알림
import { mountDirectUI } from "./direct-ui.mjs"; // 개인 대화 화면과 조회 수명
import { mountFriendsUI } from "./friends-ui.mjs"; // 친구 요청과 목록 화면
import { createAttachmentView, uploadAttachment } from "./attachments-ui.mjs"; // 첨부 조회와 명시적 전송
const byId = (elementId) => document.getElementById(elementId); // 화면 요소 조회
let channels = Object.create(null); // 서버에서 확인한 채널별 화면 자료
const messageInput = byId("message-input"); // 메시지 작성 필드
const messageScroll = byId("message-scroll"); // 대화 스크롤 영역
const messages = byId("messages"); // 메시지 목록
const authDialog = byId("auth-dialog"); // 인증 대화상자
const authForm = byId("auth-form"); // 실제 인증 요청 폼
const passwordInput = byId("auth-password"); // 비밀번호 입력 필드
const mobileQuery = window.matchMedia("(max-width: 760px)"); // 모바일 화면 판별
let activeChannel = null; // 실제 선택한 채널 식별자
let authMode = "login"; // 인증 화면 유형
let currentUser = null; // 서버에서 확인한 사용자
let csrfToken = null; // 메모리의 최신 보호 토큰
let sidebarOpen = false; // 모바일 목록 열림 상태
let lastAuthTrigger = null; // 인증 이전 포커스
let authBusy = false; // 인증 요청 진행 상태
let authInitializing = true; // 최초 세션 확인 상태
let authGeneration = 0; // 계정 상태 변경 번호
let sessionNotice = "세션 확인 중"; // 사용자 상태 안내
let databaseReady = false; // 실제 데이터베이스 연결 결과
let channelLoading = false; // 소속 채널 조회 상태
let channelError = ""; // 소속 채널 조회 실패 안내
let channelLoadVersion = 0; // 늦은 채널 조회 응답 구분
let sendRequest = null; // 현재 메시지 전송 요청
let savedDrafts = null; // 만료된 같은 계정의 미전송 초안
let serverUI = null; // 초기화한 관리 화면 연결
let channelUI = null; // 초기화한 채널 관리 연결
let profileUI = null; // 초기화한 본인 프로필 화면
let directUI = null; // 개인 대화 화면 연결
let friendsUI = null; // 친구 목록 화면 연결
let realtimeClient = null; // 선택 채널의 실시간 연결
let realtimeStatus = "closed"; // WebSocket 구독 상태
const serverManager = new ServerManager({ request: requestEndpoint, getUser: () => currentUser, storage: selectionStorage(), onChange: renderManagementUI }); // 계정별 서버 관리 수명
function renderManagementUI() // 서버·채널 관리의 같은 처리 상태
{
    serverUI?.render(); // 소유자 서버 관리 상태
    channelUI?.render(); // 역할과 현재 채널 상태
    profileUI?.render(); // 본인 정보와 공통 요청 잠금
    directUI?.render(); // 개인 대화 인증과 입력 상태
    friendsUI?.render(); // 친구 목록 인증과 입력 상태
}
function selectionStorage() // 차단될 수 있는 선택 저장소
{
    try // 비공개 창과 저장소 권한 경계
    {
        return window.localStorage; // ID 선택에만 사용하는 저장소
    }
    catch // 저장소 제한
    {
        return null; // 메모리 선택으로 계속 사용
    }
}
function pauseMessageFeeds() // 계정과 채널 전환 전 조회 중단
{
    realtimeClient?.stop(); // 이전 실시간 연결 종료
    realtimeClient = null; // 이전 연결 참조 제거
    Object.values(channels).forEach((channel) => channel.feed?.pause()); // 예약과 진행 중 요청 취소
    Object.values(channels).forEach((channel) => channel.attachments?.stop()); // 이전 첨부 조회 취소
}
function startRealtime(channelId) // 선택 채널의 실시간 알림 연결
{
    if (!window.location || window.location.protocol !== "http:" || window.location.hostname !== "127.0.0.6" || typeof window.WebSocket !== "function") // 지원하는 로컬 실시간 환경 확인
    {
        return; // 기존 주기 조회 유지
    }
    const channel = channels[channelId]; // 선택한 채널 상태
    const userId = currentUser?.id; // 연결을 시작한 사용자
    realtimeClient = createRealtimeClient({ url: "ws://127.0.0.6:8090/Team006/realtime", WebSocketImpl: window.WebSocket, subscription: () => ({ channel_id: channelId, after_id: channel.feed.after }), onStateChange: (status) => // 현재 채널 커서로 구독
    {
        realtimeStatus = status; // 실제 연결 상태 보관
        updateHistoryControls(); // 조회 방식 화면 갱신
    }, onMessage: () => // 실시간 알림의 조회 연결
    {
        if (currentUser?.id === userId && activeChannel === channelId && channels[channelId] === channel && !channel.feed.blocked) // 계정과 채널 수명 확인
        {
            channel.feed.run(channel.feed.loaded ? "after" : "initial"); // 기존 권한 검사 조회로 신규 메시지 확인
        }
    } }); // 실시간 연결 준비 끝
    realtimeClient.start(); // 선택 채널의 알림 구독 시작
}
function updateHistoryControls() // 기록 조회 버튼과 갱신 상태 표시
{
    const channelFeed = channels[activeChannel]?.feed; // 현재 채널 조회 상태
    byId("load-older").hidden = !channelFeed?.loaded || !channelFeed.hasOlder || channelFeed.blocked; // 남은 이전 기록 표시
    byId("load-older").disabled = Boolean(channelFeed?.busy); // 조회 중 겹치는 이전 요청 차단
    byId("retry-messages").hidden = !channelFeed?.error || channelFeed.blocked; // 통신 실패의 수동 재시도
    byId("retry-messages").disabled = Boolean(channelFeed?.busy); // 재연결 중 중복 요청 차단
    byId("history-status").textContent = !channelFeed ? currentUser ? "선택할 채널이 없습니다." : "로그인 후 대화를 불러옵니다." : channelFeed.blocked ? "채널 접근을 확인하세요." : channelFeed.error ? "대화를 갱신하지 못했습니다. 다시 연결하는 중입니다." : !channelFeed.loaded ? "이전 대화를 불러오는 중입니다." : channelFeed.busy ? "대화 확인 중…" : realtimeStatus === "subscribed" ? "실시간 연결됨 · 자동 갱신" : "대화 연결됨 · 2초 간격 자동 갱신"; // 실제 연결 상태 구분
}
function createChannelFeed(channelId, channel, userId) // 실제 소속 채널의 조회 연결
{
    const channelFeed = new MessageFeed({ channelId, request: (messageQuery, abortSignal) => requestEndpoint("./backend/api/get_messages.php?" + messageQuery, null, abortSignal), onChange: (feedChange) => // 동일 출처의 취소 가능한 기록 조회
    {
        if (currentUser?.id !== userId || channels[channelId] !== channel) // 이전 계정과 교체된 채널 응답
        {
            return; // 현재 화면 변경 차단
        }
        channel.messages = channelFeed.list().map((messageEntry) => ({ id: messageEntry.id, name: messageEntry.user_id === currentUser?.id ? currentUser.username : messageEntry.username, timestamp: messageEntry.created_at, text: messageEntry.content, attachment: channel.attachments?.get(messageEntry.id) })); // 본인 이름과 확인한 파일 표시
        if (activeChannel !== channelId) // 현재 표시하지 않는 채널
        {
            channel.unread += feedChange.added; // 원래 채널의 새 메시지 수 유지
            return; // 다른 채널 화면 변경 차단
        }
        if (!["loading", "state"].includes(feedChange.kind)) // 실제 기록이 바뀐 경우
        {
            const previousScrollTop = messageScroll.scrollTop; // 기존 읽는 위치
            const previousScrollHeight = messageScroll.scrollHeight; // 이전 기록 높이
            const keepBottom = nearBottom(); // 새 메시지 자동 이동 조건
            messages.replaceChildren(...channel.messages.map(createMessage)); // 중복 없는 실제 기록 표시
            if (feedChange.kind === "initial" || (feedChange.kind !== "before" && keepBottom)) // 최초 진입 또는 하단에서 신규 수신
            {
                scrollToBottom(); // 최신 대화 위치 표시
            }
            else // 과거 기록을 읽는 중인 상태
            {
                messageScroll.scrollTop = feedChange.kind === "before" ? previousScrollTop + messageScroll.scrollHeight - previousScrollHeight : previousScrollTop; // 이전 기록 추가 시 현재 메시지 위치 보존
                if (["after", "send"].includes(feedChange.kind)) // 하단에 새로 추가된 기록
                {
                    channel.unread += feedChange.added; // 실제 새 기록만 안내
                }
            }
            channel.scroll = messageScroll.scrollTop; // 복원할 위치 갱신
            showNewMessages(); // 새 메시지 이동 버튼 갱신
        }
        updateHistoryControls(); // 조회 진행과 오류 안내
        updateComposer(); // 권한 변경에 따른 전송 상태
        if (channelFeed.active && !channelFeed.blocked && !directUI?.isActive()) // 현재 채널의 확인된 기록
        {
            channel.attachments?.load(channelFeed.list()); // 표시된 메시지의 파일 정보 조회
        }
    }, onError: (operationError) => // 실제 조회 오류의 인증과 권한 처리
    {
        if (currentUser?.id !== userId || channels[channelId] !== channel) // 이전 계정 오류 여부
        {
            return; // 늦은 오류 무시
        }
        if (operationError.status === 401 || operationError.code === "SESSION_CHANGED") // 세션 만료 또는 다른 탭 계정 변경
        {
            expireMessageSession(operationError.code === "SESSION_CHANGED").catch(ignoreConnectionFailure); // 계정 자료 정리와 로그인 화면 복구
        }
        else if ([403, 404].includes(operationError.status)) // 현재 채널 소속 또는 존재 상실
        {
            if (operationError.status === 403 && operationError.code === "FORBIDDEN" && channel.serverId) // 현재 계약의 서버 소속 상실
            {
                discardDepartedServer(channel.serverId); // 비활성 채널의 초안·대화도 함께 폐기
                channelError = "서버에 접근할 수 없습니다. 참여 상태와 목록을 다시 확인하세요."; // 소속 종료 안내
                renderChannels(); // 실제 목록 재확인 제공
                renderEmptyConversation(); // 종료된 서버 기록 표시 제거
                return; // 채널 하나만 정리하는 경로 사용 중단
            }
            channel.draft = ""; // 권한 없는 채널의 이전 초안 폐기
            channel.scroll = null; // 이전 읽는 위치 제거
            channel.unread = 0; // 접근할 수 없는 새 기록 안내 제거
            if (savedDrafts?.values) // 만료 전 복원 자료 존재
            {
                delete savedDrafts.values[channelId]; // 재참여 때 이전 초안 복원 차단
            }
            if (activeChannel === channelId) // 화면에 표시 중인 접근 종료
            {
                messageInput.value = ""; // 이전 소속의 입력 원문 폐기
                showNewMessages(); // 이전 기록 이동 버튼 정리
            }
            channelUI?.clear(); // 미확인 채널 관리 입력 폐기
            channel.feedback = "채널에 접근할 수 없습니다. 채널 목록을 다시 확인하세요."; // 실제 접근 오류 안내
            channel.error = true; // 접근 실패 표시
            channelError = channel.feedback; // 소속 목록 재확인 제공
            renderChannels(); // 재확인 버튼 표시
            updateComposer(); // 권한 없는 전송 차단
        }
    } }); // 조회 경계 연결 종료
    channel.attachments = createAttachmentView({ kind: "channel", targetId: channelId, userId, getUser: () => currentUser, request: requestEndpoint, onChange: () => // 권한 확인된 파일 정보 표시
    {
        if (currentUser?.id !== userId || channels[channelId] !== channel || activeChannel !== channelId || channelFeed.blocked || directUI?.isActive()) // 이전 계정 또는 화면
        {
            return; // 늦은 첨부 결과 무시
        }
        channel.messages = channelFeed.list().map((messageEntry) => ({ id: messageEntry.id, name: messageEntry.user_id === userId ? currentUser.username : messageEntry.username, timestamp: messageEntry.created_at, text: messageEntry.content, attachment: channel.attachments.get(messageEntry.id) })); // 메시지별 안전한 파일 정보
        const previousScrollTop = messageScroll.scrollTop; // 기존 읽는 위치
        messages.replaceChildren(...channel.messages.map(createMessage)); // 다운로드 링크 갱신
        messageScroll.scrollTop = previousScrollTop; // 읽던 위치 보존
    }, onError: (error) => // 파일 정보 실패 안내
    {
        if (currentUser?.id !== userId || channels[channelId] !== channel || activeChannel !== channelId || directUI?.isActive()) // 이전 화면의 오류
        {
            return; // 현재 화면 변경 차단
        }
        if (error.status === 401 || error.code === "SESSION_CHANGED") // 실제 인증 만료
        {
            expireMessageSession(error.code === "SESSION_CHANGED").catch(ignoreConnectionFailure); // 이전 계정 자료 폐기
        }
        else if ([403, 404].includes(error.status)) // 채널 접근 상실
        {
            channelFeed.block(error); // 이전 기록과 조회 폐기
        }
        else // 일시적인 파일 정보 실패
        {
            byId("channel-file-status").textContent = "파일 정보를 확인하지 못했습니다. 다시 확인합니다."; // 자동 조회 복구 안내
        }
    } }); // 첨부 조회 연결 끝
    return channelFeed; // 채널별 독립 조회 상태 반환
}
function validId(identifierValue) // 큰 정수 문자열 계약 검사
{
    return typeof identifierValue === "string" && /^[1-9][0-9]{0,19}$/.test(identifierValue) && (identifierValue.length < 20 || identifierValue <= "18446744073709551615"); // 부호 없는 64비트 범위 확인
}
function nearBottom() // 대화 하단 여부 확인
{
    return messageScroll.scrollHeight - messageScroll.clientHeight - messageScroll.scrollTop < 45; // 하단까지 남은 거리
}
function showNewMessages() // 새 메시지 안내 갱신
{
    const unreadCount = channels[activeChannel]?.unread || 0; // 선택한 채널의 읽지 않은 수
    byId("new-messages").hidden = unreadCount === 0; // 새 메시지 안내 표시
    byId("new-messages").textContent = `새 메시지 ${unreadCount}개 보기 ↓`; // 안전한 안내 출력
}
function scrollToBottom() // 대화 하단 이동
{
    messageScroll.scrollTop = messageScroll.scrollHeight; // 마지막 메시지 위치
    if (channels[activeChannel]) // 실제 선택한 채널 존재 여부
    {
        channels[activeChannel].unread = 0; // 읽은 메시지 수 초기화
    }
    showNewMessages(); // 새 메시지 안내 갱신
}
function createMessage(message) // HTML 실행 없는 저장 메시지 생성
{
    const messageArticle = document.createElement("article"); // 메시지 묶음
    messageArticle.className = "message"; // 메시지 배치 스타일
    const authorAvatar = document.createElement("div"); // 작성자 이니셜
    authorAvatar.className = "avatar avatar-teal"; // 작성자 아바타 스타일
    authorAvatar.setAttribute("aria-hidden", "true"); // 장식 중복 읽기 방지
    authorAvatar.textContent = Array.from(message.name)[0].toUpperCase(); // 사용자 첫 글자 출력
    const messageContent = document.createElement("div"); // 메시지 내용 영역
    messageContent.className = "message-content"; // 본문 배치 스타일
    const messageMetadata = document.createElement("div"); // 작성 정보 영역
    messageMetadata.className = "message-meta"; // 작성 정보 스타일
    const authorName = document.createElement("strong"); // 사용자 이름
    authorName.textContent = message.name; // 일반 텍스트 사용자명
    const messageTime = document.createElement("time"); // 저장 시각
    messageTime.dateTime = message.timestamp; // 기계 판독 시각
    messageTime.textContent = new Date(message.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); // 사용자 시간대 표시
    const savedLabel = document.createElement("span"); // 확인된 저장 배지
    savedLabel.className = "local-label"; // 배지 스타일
    savedLabel.textContent = "저장됨"; // 실제 성공 응답 구분
    messageMetadata.append(authorName, messageTime, savedLabel); // 작성 정보 배치
    const messageBody = document.createElement("p"); // 메시지 본문
    messageBody.className = "message-body"; // 원문 줄바꿈 스타일
    messageBody.textContent = message.text; // HTML 실행 없는 원문 출력
    messageContent.append(messageMetadata, messageBody); // 작성 정보와 본문 배치
    if (message.attachment) // 권한을 확인한 첨부 정보
    {
        const attachmentLink = document.createElement("a"); // 일반 다운로드 링크
        attachmentLink.className = "attachment-link"; // 첨부 링크 스타일
        attachmentLink.href = "./backend/api/download_attachment.php?id=" + encodeURIComponent(message.attachment.id); // 같은 출처의 권한 확인 경로
        attachmentLink.textContent = `${message.attachment.original_name} 다운로드 (${message.attachment.file_size.toLocaleString("ko-KR")}바이트)`; // 안전한 파일 이름과 크기
        messageContent.append(attachmentLink); // 메시지에 첨부 연결
    }
    messageArticle.append(authorAvatar, messageContent); // 메시지 요소 조립
    return messageArticle; // 완성한 메시지 반환
}
function updateComposer() // 인증과 초안에 따른 입력 상태 갱신
{
    const channel = channels[activeChannel]; // 선택한 실제 채널
    const characterCount = Array.from(messageInput.value).length; // 원문 코드 포인트 수
    const hasText = /[^\p{White_Space}\uFEFF]/u.test(messageInput.value); // 공백 외 글자 여부
    const containsNull = messageInput.value.includes("\u0000"); // 저장 불가능한 빈 문자
    const composerAvailable = Boolean(currentUser && channel && !channel.feed?.blocked && csrfToken && !authBusy && !authInitializing && !channelLoading && !channelError); // 실제 전송 준비 상태
    messageInput.disabled = !composerAvailable; // 게스트와 미확인 채널 입력 차단
    byId("message-count").textContent = `${characterCount.toLocaleString("ko-KR")} / 2,000`; // 원문 길이 표시
    byId("message-count").classList.toggle("over-limit", characterCount > 2000); // 초과 길이 표시
    byId("send-button").disabled = !composerAvailable || Boolean(sendRequest) || !hasText || characterCount > 2000 || containsNull; // 중복 제출과 잘못된 입력 차단
    byId("channel-file").disabled = !composerAvailable || Boolean(sendRequest) || Boolean(directUI?.isBusy()); // 권한 없는 파일 선택 차단
    byId("channel-upload").disabled = byId("channel-file").disabled || !byId("channel-file").files?.length; // 파일 미선택과 중복 전송 차단
    byId("open-auth").disabled = authBusy || authInitializing || Boolean(sendRequest) || Boolean(directUI?.isBusy()); // 저장 결과 확인 전 계정 변경 차단
    byId("send-button").textContent = sendRequest ? "저장 중…" : "전송 ↗"; // 실제 저장 요청 상태
    byId("message-form").setAttribute("aria-busy", String(Boolean(sendRequest))); // 보조 기기 요청 상태
    messageInput.setAttribute("aria-invalid", String(characterCount > 2000 || containsNull)); // 입력 오류 접근성 상태
    if (channel) // 실제 채널 선택 여부
    {
        channel.draft = messageInput.value; // 채널별 작성 원문 보관
    }
    const feedback = containsNull ? "지원하지 않는 빈 문자를 제거하세요." : characterCount > 2000 ? "메시지는 2,000자까지 입력할 수 있습니다." : !currentUser ? "로그인 후 참여 중인 채널에 메시지를 보낼 수 있습니다." : channelLoading ? "참여 중인 채널을 확인하는 중입니다." : channelError ? channelError : !channel ? serverManager.selected ? emptyChannelHint() : "서버를 만들거나 초대 코드로 참여하세요." : !csrfToken ? "화면 보호 정보를 확인하지 못했습니다. 다시 로그인하세요." : channel.feedback || "대화는 DB에 저장되며 새 메시지를 자동으로 확인합니다."; // 확인된 기능 범위와 오류 안내
    byId("composer-feedback").textContent = feedback; // 안전한 상태 문구 출력
    byId("composer-feedback").classList.toggle("error", characterCount > 2000 || containsNull || Boolean(channel?.error) || Boolean(channelError)); // 실패 상태 색상
    renderManagementUI(); // 전송 중 서버·채널 관리 잠금
}
function emptyChannelHint() // 빈 서버의 역할별 다음 조작
{
    const serverRole = serverManager.servers.find((server) => server.id === serverManager.selected)?.role; // 확인된 소속 역할
    return ["owner", "admin"].includes(serverRole) ? "채널 만들기 버튼으로 첫 대화방을 준비하세요." : "관리자가 채널을 준비하면 목록을 다시 확인하세요."; // 생성 권한별 안내
}
function renderChannels() // 실제 소속 채널 목록 생성
{
    const channelList = byId("channel-list"); // 동적 채널 버튼 영역
    const channelButtons = Object.entries(channels).filter(([, channel]) => !serverManager.identity || channel.serverId === serverManager.selected).map(([channelId, channel]) => // 선택한 서버의 채널 순서
    {
        const channelButton = document.createElement("button"); // 키보드 접근 가능한 채널 버튼
        channelButton.type = "button"; // 폼 제출 방지
        channelButton.className = "channel-button"; // 기존 채널 디자인
        channelButton.dataset.channel = channelId; // 문자열 식별자 보관
        channelButton.textContent = `# ${channel.title} · ${channel.serverName}`; // 같은 이름의 서버별 채널 구분
        channelButton.title = `${channel.serverName} / ${channel.title}`; // 전체 채널 이름 안내
        channelButton.setAttribute("aria-pressed", String(channelId === activeChannel && !directUI?.isActive())); // 현재 채널 선택 상태
        channelButton.classList.toggle("active", channelId === activeChannel && !directUI?.isActive()); // 현재 채널 강조
        channelButton.addEventListener("click", () => selectChannel(channelId)); // 확인한 식별자로만 채널 선택
        return channelButton; // 완성한 탐색 버튼
    }); // 채널 버튼 생성 끝
    channelList.replaceChildren(...channelButtons); // 이전 계정 목록 제거 후 교체
    byId("channel-count").textContent = String(channelButtons.length).padStart(2, "0"); // 실제 채널 수
    byId("channel-status").hidden = channelButtons.length > 0 && !channelLoading && !channelError; // 비어 있거나 실패한 목록 안내
    byId("channel-status").textContent = !currentUser ? "로그인 후 참여 채널이 표시됩니다." : channelLoading ? "채널을 확인하는 중입니다." : channelError || (serverManager.selected ? emptyChannelHint() : "서버를 만들거나 초대 코드로 참여하세요."); // 빈 서버와 미소속 구분
    byId("retry-channels").hidden = !currentUser || !channelError; // 조회 실패 시 재시도 제공
    byId("retry-channels").disabled = channelLoading || authBusy; // 중복 조회 차단
}
function renderEmptyConversation() // 선택 가능한 채널 없는 화면
{
    byId("channel-title").textContent = "채널 선택"; // 미확인 채널 제목 제거
    byId("channel-description").textContent = "참여 중인 채널에서 대화를 시작하세요"; // 실제 이용 조건
    byId("welcome-title").textContent = currentUser ? serverManager.selected ? "이 서버에는 채널이 없습니다" : "서버를 만들거나 참여하세요" : "로그인하고 대화를 시작하세요"; // 사용자별 빈 상태 제목
    byId("welcome-description").textContent = currentUser ? channelError || (serverManager.selected ? emptyChannelHint() : "서버 만들기 또는 초대로 참여 버튼으로 시작하세요.") : "계정으로 로그인하면 참여 중인 채널을 확인할 수 있습니다."; // 빈 상태의 실제 다음 조작
    byId("message-label").textContent = "메시지 작성"; // 기본 입력 레이블
    messageInput.placeholder = currentUser ? "참여 중인 채널을 선택하세요" : "로그인 후 메시지를 작성하세요"; // 실제 입력 조건
    messages.replaceChildren(); // 이전 대화 표시 제거
    showNewMessages(); // 새 메시지 안내 초기화
    updateComposer(); // 입력 잠금과 안내 갱신
    updateHistoryControls(); // 빈 화면 기록 조회 상태 초기화
}
function selectChannel(channelId) // 실제 소속 채널 전환
{
    if (!channels[channelId]) // 서버에서 확인한 채널 여부
    {
        return; // 미확인 채널 선택 중단
    }
    if (channelId !== activeChannel || directUI?.isActive()) // 다른 대화 진입 여부
    {
        byId("channel-file").value = ""; // 이전 대상의 선택 파일 제거
        byId("channel-file-status").textContent = "최대 5 MiB"; // 이전 파일 결과 제거
    }
    directUI?.close(); // 개인 조회 중단과 채널 화면 복귀
    pauseMessageFeeds(); // 이전 채널 요청 취소와 늦은 응답 무효화
    if (channels[activeChannel]) // 이전 선택 존재 여부
    {
        channels[activeChannel].scroll = messageScroll.scrollTop; // 이전 읽는 위치 보관
        channels[activeChannel].draft = messageInput.value; // 이동 직전 초안 보관
    }
    activeChannel = channelId; // 문자열 채널 식별자 유지
    serverManager.rememberChannel(channelId); // 현재 계정의 실제 채널 선택 저장
    const channel = channels[channelId]; // 선택한 채널 자료
    byId("channel-title").textContent = channel.title; // 실제 채널 이름
    byId("channel-description").textContent = channel.serverName; // 실제 소속 서버 이름
    byId("welcome-title").textContent = `# ${channel.title}에 오신 것을 환영해요`; // 채널 시작 안내
    byId("welcome-description").textContent = "저장된 대화를 불러오고 새 메시지를 자동으로 확인합니다."; // 실제 기록 조회 안내
    byId("message-label").textContent = `${channel.title} 채널 메시지`; // 채널별 입력 레이블
    messageInput.placeholder = `# ${channel.title}에 메시지 보내기`; // 채널별 입력 안내
    messageInput.value = channel.draft; // 채널별 초안 복원
    messages.replaceChildren(...channel.messages.map(createMessage)); // 해당 채널의 확인된 저장 메시지
    renderChannels(); // 실제 버튼 선택 표시 갱신
    updateComposer(); // 선택한 초안 상태 갱신
    messageScroll.scrollTop = channel.scroll === null ? messageScroll.scrollHeight : channel.scroll; // 기존 읽는 위치 복원
    if (nearBottom()) // 현재 하단을 읽는 상태
    {
        channel.unread = 0; // 확인한 새 메시지 수 초기화
    }
    showNewMessages(); // 선택 채널의 새 메시지 안내
    channel.feed.activate(); // 최초 조회 또는 기존 커서의 신규 확인
    startRealtime(channelId); // 현재 채널의 실시간 연결 시작
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 선택 후 대화 화면 복귀
    }
}
async function expireMessageSession(changed = false) // 만료되거나 다른 계정으로 바뀐 화면 정리
{
    authGeneration += 1; // 이전 계정의 응답 무효화
    sessionNotice = changed ? "계정 변경 · 다시 로그인 정보를 확인하세요" : "세션 만료 · 다시 로그인하세요"; // 실제 계정 종료 사유
    clearSessionView(true); // 미전송 초안만 같은 계정 복원용 보관
    await refreshCsrf().catch(ignoreConnectionFailure); // 새 세션의 보호 정보 준비
    if (!authInitializing && !authBusy) // 인증 화면 표시 가능한 상태
    {
        openAuth(); // 실제 로그인 화면 열기
        showAuthError(changed ? "로그인 계정이 변경되었습니다. 이전 초안은 자동 전송하지 않습니다. 현재 계정을 확인하세요." : "세션이 만료되었습니다. 다시 로그인하세요."); // 실제 종료 이유 안내
    }
}
function discardDepartedServer(serverId) // 탈퇴·서버 삭제 확정 자료의 즉시 폐기
{
    serverManager.servers = serverManager.servers.filter((server) => server.id !== serverId); // 종료 소속 목록 제거
    if (serverManager.selected === serverId) // 선택 중인 종료 서버
    {
        serverUI?.clear(); // 종료 서버의 초대 원문과 확인 입력 폐기
        byId("server-dialog").close(); // 접근할 수 없는 관리 화면 종료
        channelUI?.clear(); // 종료 서버 채널 관리 대상 폐기
        serverManager.selected = null; // 미확인 다른 서버 자동 선택 지연
        serverManager.channel = null; // 종료 서버의 채널 선택 제거
    }
    serverManager.persist(); // 영구 선택도 종료 반영
    for (const [channelId, channel] of Object.entries(channels)) // 확인된 같은 서버의 모든 채널
    {
        if (channel.serverId === serverId) // 종료한 소속 범위
        {
            discardDeletedChannel(channelId); // 기록·초안·예약·복원 자료 폐기
        }
    }
    renderManagementUI(); // 소속 종료를 버튼과 제목에 반영
}
function discardDeletedChannel(channelId) // 삭제 확정 자료의 즉시 폐기
{
    channels[channelId]?.feed.block(requestError("삭제된 채널입니다.")); // 기록·진행 조회·예약 종료
    delete channels[channelId]; // 초안과 채널 참조 제거
    if (savedDrafts?.values) // 만료 복원용 초안 존재
    {
        delete savedDrafts.values[channelId]; // 삭제 대상 초안 복원 차단
    }
    if (serverManager.channel === channelId) // 저장된 삭제 대상 선택
    {
        serverManager.rememberChannel(null); // 영구 선택 제거
    }
    if (activeChannel === channelId) // 표시 중인 삭제 대상
    {
        activeChannel = null; // 더 이상 선택할 수 없는 채널
        messageInput.value = ""; // 삭제된 대화의 입력 제거
        renderEmptyConversation(); // 후속 통신 실패에도 기록 미노출
    }
    renderChannels(); // 남은 목록만 표시
}
async function loadChannels() // 로그인 사용자의 실제 소속 채널 조회
{
    if (!currentUser) // 인증되지 않은 사용자 여부
    {
        return; // 게스트 조회 중단
    }
    const requestGeneration = authGeneration; // 요청 당시 계정 상태
    const userId = currentUser.id; // 요청 당시 사용자 식별자
    const requestVersion = ++channelLoadVersion; // 최신 조회 식별 번호
    pauseMessageFeeds(); // 목록 교체 중 기존 기록 요청 중단
    channelLoading = true; // 실제 조회 진행 상태
    channelError = ""; // 이전 오류 초기화
    renderChannels(); // 조회 중 목록 안내
    updateComposer(); // 조회 중 전송 차단
    try // 실제 소속 채널과 응답 계약 확인
    {
        await serverManager.sync(); // 채널이 없는 소속 서버도 먼저 확인
        if (requestGeneration !== authGeneration || requestVersion !== channelLoadVersion || currentUser?.id !== userId) // 소속 확인 중 계정 교체
        {
            return; // 새 계정 자료 정리와 후속 조회 중단
        }
        const serverIds = new Set(serverManager.servers.map((server) => server.id)); // 방금 확인한 현재 소속
        for (const serverId of new Set(Object.values(channels).map((channel) => channel.serverId).filter(Boolean))) // 기존 채널의 부모 소속
        {
            if (!serverIds.has(serverId)) // 실제 소속 목록에서 종료 확인
            {
                discardDepartedServer(serverId); // 채널 조회 실패 전 종료 자료 폐기
            }
        }
        const responseData = await requestEndpoint("./backend/api/get_channels.php"); // 쿼리 없는 실제 조회 요청
        if (requestGeneration !== authGeneration || requestVersion !== channelLoadVersion || currentUser?.id !== userId) // 늦은 이전 계정 응답 여부
        {
            return; // 이전 계정 목록 적용 중단
        }
        if (!Array.isArray(responseData.channels) || responseData.channels.some((channelEntry) => !channelEntry || !validId(channelEntry.id) || !validId(channelEntry.server_id) || typeof channelEntry.name !== "string" || !channelEntry.name || typeof channelEntry.server_name !== "string" || !channelEntry.server_name) || new Set(responseData.channels.map((channelEntry) => channelEntry.id)).size !== responseData.channels.length) // 실제 채널 계약 검사
        {
            throw requestError("참여 채널 정보를 확인하지 못했습니다. 채널 목록을 다시 확인하세요."); // 미확인 식별자 사용 차단
        }
        const nextChannels = Object.create(null); // 새로 확인한 소속 채널
        responseData.channels.forEach((channelEntry) => // 실제 응답 순서대로 채널 준비
        {
            const previousChannel = channels[channelEntry.id]; // 같은 계정의 기존 채널 자료
            const recoveredDraft = savedDrafts?.userId === userId ? savedDrafts.values[channelEntry.id] || "" : ""; // 같은 계정의 만료 전 초안
            const channel = previousChannel && !previousChannel.feed?.blocked ? previousChannel : { messages: [], draft: previousChannel?.feed?.blocked ? "" : previousChannel?.draft || recoveredDraft, scroll: null, unread: 0, feedback: "", error: false }; // 접근 종료 자료는 초안도 복원하지 않음
            channel.title = channelEntry.name; // 현재 채널 이름
            channel.serverName = channelEntry.server_name; // 현재 소속 서버 이름
            channel.serverId = channelEntry.server_id; // 서버별 독립 탐색 조건
            channel.feed ??= createChannelFeed(channelEntry.id, channel, userId); // 계정과 채널별 독립 기록 상태
            nextChannels[channelEntry.id] = channel; // 확인한 소속 채널 보관
        }); // 소속 채널 준비 끝
        savedDrafts = null; // 확인 후 만료 전 초안 참조 제거
        channels = nextChannels; // 확인한 소속 채널만 유지
        channelLoading = false; // 채널 조회 완료
        const candidateChannels = responseData.channels.filter((channelEntry) => channelEntry.server_id === serverManager.selected); // 선택 서버의 확인한 채널
        const preferredChannelId = serverManager.channel || activeChannel; // 새로고침 전 또는 현재 선택
        const selectedChannelId = candidateChannels.some((channelEntry) => channelEntry.id === preferredChannelId) ? preferredChannelId : candidateChannels[0]?.id || null; // 유효한 선택 또는 첫 채널
        activeChannel = null; // 이전 선택의 초안 덮어쓰기 방지
        if (selectedChannelId && directUI?.isActive()) // 개인 화면을 유지할 목록 갱신
        {
            activeChannel = selectedChannelId; // 채널 복귀를 위한 선택 보관
            renderChannels(); // 개인 화면의 채널 강조 제거
        }
        else if (selectedChannelId) // 참여 채널 존재 여부
        {
            selectChannel(selectedChannelId); // 실제 채널 화면 표시
        }
        else // 참여 중인 채널 없는 사용자
        {
            serverManager.rememberChannel(null); // 삭제된 채널의 영구 선택 제거
            messageInput.value = ""; // 이전 채널 초안 표시 제거
            renderEmptyConversation(); // 정확한 미참여 안내
        }
    }
    catch (operationError) // 조회 오류와 인증 만료 처리
    {
        if (requestGeneration !== authGeneration || requestVersion !== channelLoadVersion) // 이미 교체된 조회 상태
        {
            return; // 이전 실패 응답 무시
        }
        if (operationError.status === 401 || operationError.code === "SESSION_CHANGED") // 실제 로그인 만료와 계정 변경 응답
        {
            await expireMessageSession(operationError.code === "SESSION_CHANGED"); // 이전 계정 목록과 기록 정리
            return; // 만료 계정 조회 종료
        }
        channelError = "참여 채널을 확인하지 못했습니다. 채널 목록 다시 확인을 눌러주세요."; // 성공 추정 없는 실패 안내
    }
    finally // 최신 요청의 화면 상태 갱신
    {
        if (requestGeneration === authGeneration && requestVersion === channelLoadVersion) // 현재 계정의 마지막 조회 여부
        {
            channelLoading = false; // 조회 잠금 해제
            renderChannels(); // 재시도 버튼과 결과 표시
            updateComposer(); // 실제 입력 가능 상태 갱신
        }
    }
}
async function sendMessage(uiEvent) // 실제 데이터베이스 메시지 저장
{
    uiEvent.preventDefault(); // 기본 폼 페이지 이동 차단
    updateComposer(); // 최신 입력과 계정 상태 검사
    if (byId("send-button").disabled) // 입력 오류 또는 중복 요청 여부
    {
        return; // 전송 불가능한 요청 중단
    }
    const channelId = activeChannel; // 제출한 실제 채널 식별자
    const channel = channels[channelId]; // 응답을 적용할 채널 자료
    const messageRequest = { generation: authGeneration, userId: currentUser.id, content: messageInput.value }; // 제출 당시 계정과 원문
    sendRequest = messageRequest; // 중복 전송 잠금
    channel.feedback = "메시지를 저장하는 중입니다."; // 실제 요청 진행 안내
    channel.error = false; // 이전 실패 상태 제거
    updateComposer(); // 전송 버튼과 접근성 상태 갱신
    try // 실제 저장 성공 응답 확인
    {
        const responseData = await requestEndpoint("./backend/api/send_message.php", { channel_id: channelId, content: messageRequest.content }); // 최신 보호 토큰과 원문 전송
        if (messageRequest.generation !== authGeneration || currentUser?.id !== messageRequest.userId || channels[channelId] !== channel || channel.feed.blocked) // 계정·채널 교체와 조회 중 권한 상실 여부
        {
            return; // 이전 계정의 늦은 성공 무시
        }
        const savedMessage = responseData.message; // 실제 저장된 메시지 객체
        if (!savedMessage || !validId(savedMessage.id) || savedMessage.channel_id !== channelId || savedMessage.user_id !== messageRequest.userId || typeof savedMessage.username !== "string" || !savedMessage.username || savedMessage.content !== messageRequest.content || typeof savedMessage.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(savedMessage.created_at) || Number.isNaN(Date.parse(savedMessage.created_at))) // 저장 응답의 계약과 원문 확인
        {
            throw requestError("저장 응답을 확인하지 못했습니다."); // 불완전한 성공 응답 거절
        }
        channel.feed.add(savedMessage); // 신규 조회 커서를 유지한 전송 결과 중복 제거
        if (channel.draft === messageRequest.content) // 제출 이후 수정하지 않은 초안 여부
        {
            channel.draft = ""; // 확정된 제출 초안만 제거
            if (activeChannel === channelId && messageInput.value === messageRequest.content) // 현재 화면도 같은 초안 여부
            {
                messageInput.value = ""; // 사용자가 새로 작성한 내용 보호
            }
        }
        channel.feedback = "메시지가 저장되었습니다. 새로고침 후에도 DB에 남습니다."; // 확인된 저장 결과 안내
        channel.error = false; // 성공 상태 복원
    }
    catch (operationError) // 저장 실패와 불확실한 결과 처리
    {
        if (messageRequest.generation !== authGeneration || currentUser?.id !== messageRequest.userId || channels[channelId] !== channel) // 이전 계정 요청 여부
        {
            return; // 이전 실패가 현재 계정을 변경하지 않도록 중단
        }
        if (operationError.status === 401 || operationError.code === "SESSION_CHANGED") // 실제 인증 만료와 계정 변경 응답
        {
            await expireMessageSession(operationError.code === "SESSION_CHANGED"); // 같은 계정 초안만 보관하고 이전 화면 종료
            return; // 만료 계정 처리 종료
        }
        if (operationError.code === "CSRF_INVALID") // 보호 토큰 불일치 응답
        {
            try // 다음 수동 제출용 보호 정보 확인
            {
                await refreshCsrf(messageRequest.generation); // 자동 전송 없는 최신 토큰 조회
                if (messageRequest.generation !== authGeneration || currentUser?.id !== messageRequest.userId || channels[channelId] !== channel) // 복구 중 종료된 요청
                {
                    return; // 이전 복구의 안내 적용 중단
                }
                channel.feedback = "화면 보호 정보를 갱신했습니다. 초안을 확인하고 다시 전송하세요."; // 명시적 사용자 재제출 안내
            }
            catch (recoveryError) // 보호 정보 또는 계정 확인 실패
            {
                if (messageRequest.generation !== authGeneration || currentUser?.id !== messageRequest.userId || channels[channelId] !== channel) // 이전 계정의 중첩 실패
                {
                    return; // 새 로그인 계정과 토큰 보존
                }
                if (recoveryError.status === 401 || recoveryError.code === "SESSION_CHANGED") // 복구 중 세션 만료나 다른 계정 확인
                {
                    await expireMessageSession(recoveryError.code === "SESSION_CHANGED"); // 새 계정으로 이전 초안 전달 차단
                    return; // 이전 채널의 복구 안내 적용 중단
                }
                channel.feedback = "화면 보호 정보를 갱신하지 못했습니다. 다시 로그인하세요."; // 복구 실패 안내
            }
        }
        else // 저장 거절 또는 통신 결과 미확인
        {
            channel.feedback = operationError.status === 403 ? "이 채널에 메시지를 보낼 권한이 없습니다. 참여 상태를 확인하세요." : operationError.status === 404 ? "채널을 찾을 수 없습니다. 채널 목록을 다시 확인하세요." : operationError.status === 0 ? "저장 결과를 확인하지 못했습니다. 이미 저장되었을 수 있습니다. 다시 전송하면 중복 저장될 수 있으니 주의하세요. 자동 재전송은 하지 않습니다." : operationError.message; // 실제 실패 종류별 안내
        }
        if (operationError.status === 404 || operationError.code === "FORBIDDEN") // 사라졌거나 참여 상태가 바뀐 채널
        {
            channel.feed.block(operationError); // 비활성 채널도 과거 기록과 조회 수명 제거
            return; // 공통 차단 경계의 권한 안내 유지
        }
        channel.error = true; // 초안을 유지한 실패 표시
    }
    finally // 현재 요청 잠금과 화면 정리
    {
        if (sendRequest === messageRequest) // 현재 계정의 동일 요청 여부
        {
            sendRequest = null; // 전송 중복 잠금 해제
            updateComposer(); // 남아 있는 초안과 상태 갱신
            showNewMessages(); // 현재 채널 새 메시지 안내
        }
    }
}
async function sendChannelFile() // 선택한 채널 파일 전송
{
    updateComposer(); // 최신 계정과 전송 조건 확인
    if (byId("channel-upload").disabled) // 파일과 권한 또는 중복 검사
    {
        return; // 처리할 수 없는 전송 중단
    }
    const channelId = activeChannel; // 제출한 채널 식별자
    const channel = channels[channelId]; // 제출한 채널 수명
    const file = byId("channel-file").files[0]; // 사용자가 선택한 파일
    const fileRequest = { generation: authGeneration, userId: currentUser.id }; // 제출 당시 계정
    sendRequest = fileRequest; // 기존 메시지와 공통 잠금
    byId("channel-file-status").textContent = "파일을 전송하는 중입니다."; // 전송 진행 안내
    updateComposer(); // 중복 전송과 계정 전환 차단
    try // 명시적 업로드 한 번 실행
    {
        const response = await uploadAttachment({ kind: "channel", targetId: channelId, userId: fileRequest.userId, file, request: requestEndpoint }); // 같은 출처 multipart 전송
        if (fileRequest.generation !== authGeneration || currentUser?.id !== fileRequest.userId || channels[channelId] !== channel || activeChannel !== channelId || directUI?.isActive() || channel.feed.blocked) // 계정과 대화 전환 검사
        {
            return; // 이전 대화 결과 표시 중단
        }
        channel.attachments.add(response.attachment); // 확인된 파일 정보 보관
        channel.feed.add(response.message); // 실제 저장 메시지 표시
        byId("channel-file").value = ""; // 성공한 파일 선택 제거
        byId("channel-file-status").textContent = "파일을 저장했습니다."; // 확인된 업로드 결과
    }
    catch (error) // 거절 또는 전송 결과 미확인
    {
        if (fileRequest.generation !== authGeneration || currentUser?.id !== fileRequest.userId || channels[channelId] !== channel) // 이전 계정 또는 삭제된 대화
        {
            return; // 이전 계정 오류 차단
        }
        if (error.status === 401 || ["SESSION_CHANGED", "CSRF_INVALID"].includes(error.code)) // 계정 또는 보호 토큰 복구
        {
            const message = await serverFailure(error, fileRequest.generation, fileRequest.userId); // 자동 재전송 없는 복구
            if (fileRequest.generation === authGeneration && currentUser?.id === fileRequest.userId && activeChannel === channelId && !directUI?.isActive()) // 복구 중 계정과 대화 확인
            {
                byId("channel-file-status").textContent = message; // 현재 화면의 복구 안내
            }
        }
        else if (activeChannel !== channelId || directUI?.isActive()) // 다른 대화의 일반 실패
        {
            return; // 현재 화면의 파일 상태 변경 차단
        }
        else if ([403, 404].includes(error.status)) // 채널 접근 상실
        {
            channel.feed.block(error); // 기존 기록과 조회 폐기
        }
        else // 일반 실패 또는 불확실한 결과
        {
            byId("channel-file-status").textContent = error.message || "파일 결과를 확인하지 못했습니다."; // 실제 실패 안내
        }
    }
    finally // 현재 요청의 잠금만 해제
    {
        if (sendRequest === fileRequest) // 동일한 전송 여부
        {
            sendRequest = null; // 공통 전송 잠금 해제
            updateComposer(); // 현재 입력 상태 복구
        }
    }
}
function setSidebar(open) // 모바일 목록 표시 설정
{
    sidebarOpen = open && mobileQuery.matches; // 모바일에서만 목록 열기
    document.body.classList.toggle("sidebar-open", sidebarOpen); // 목록 열림 스타일 적용
    byId("sidebar-backdrop").hidden = !sidebarOpen; // 목록 바깥 닫기 버튼 표시
    byId("sidebar-toggle").setAttribute("aria-expanded", String(sidebarOpen)); // 펼침 상태 접근성 갱신
    byId("sidebar-toggle").setAttribute("aria-label", sidebarOpen ? "채널 목록 닫기" : "채널 목록 열기"); // 메뉴 버튼 설명 갱신
    document.querySelector(".conversation").inert = sidebarOpen; // 목록 열린 동안 대화 포커스 제한
    if (sidebarOpen) // 목록 열기 요청 여부
    {
        const retryButton = byId("retry-channels"); // 실제 목록 복구 버튼
        const focusTarget = document.querySelector(".channel-button.active") || (!retryButton.hidden && !retryButton.disabled ? retryButton : !byId("open-auth").disabled ? byId("open-auth") : byId("channel-sidebar")); // 빈 목록에서도 보이는 포커스 대상
        focusTarget.focus(); // 사용 가능한 목록 요소로 포커스 이동
    }
    else if (mobileQuery.matches) // 모바일 목록 닫기 여부
    {
        byId("sidebar-toggle").focus(); // 목록 열기 버튼으로 포커스 복원
    }
}
function switchAuth(mode) // 인증 화면 유형 전환
{
    if (authBusy) // 진행 중인 요청 보호
    {
        return; // 요청 중 화면 전환 중단
    }
    authMode = mode; // 현재 인증 유형 변경
    const register = mode === "register"; // 가입 화면 여부
    authForm.reset(); // 이전 입력과 비밀번호 초기화
    clearAuthErrors(); // 이전 입력 오류 제거
    byId("username-field").hidden = !register; // 가입 사용자명 필드 표시
    byId("auth-username").required = register; // 가입 시 사용자명 필수
    byId("auth-username").disabled = !register; // 로그인에서 사용자명 검사 제외
    passwordInput.autocomplete = register ? "new-password" : "current-password"; // 화면별 비밀번호 입력 안내
    byId("auth-title").textContent = register ? "함께 시작해요" : "다시 만나 반가워요"; // 인증 제목 전환
    byId("auth-description").textContent = register ? "새 계정을 만들고 로그인하세요." : "등록한 계정으로 로그인하세요."; // 실제 인증 설명
    byId("auth-switch-prompt").textContent = register ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"; // 전환 안내 문구
    byId("switch-auth").textContent = register ? "로그인" : "회원가입"; // 전환 버튼 문구
    byId("auth-submit").textContent = register ? "회원가입" : "로그인"; // 실제 요청 버튼 문구
    if (authDialog.open) // 열린 대화상자 여부
    {
        byId(register ? "auth-username" : "auth-email").focus(); // 새 화면 첫 필드 포커스
    }
}
function openAuth() // 실제 로그인 화면 열기
{
    if (authBusy || authInitializing) // 중복 처리 또는 초기 확인 여부
    {
        return; // 요청 상태 확정 전 열기 중단
    }
    lastAuthTrigger = byId("open-auth"); // 닫은 뒤 복원할 버튼
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 인증 화면 전에 목록 접기
    }
    switchAuth("login"); // 로그인 화면으로 시작
    if (!authDialog.open) // 중복 대화상자 열기 방지
    {
        authDialog.showModal(); // 기본 포커스 제한 대화상자 열기
    }
    byId("auth-email").focus(); // 이메일 필드 포커스
}
function validatePassword() // 공통 비밀번호 규칙 검사
{
    passwordInput.setCustomValidity(""); // 이전 규칙 오류 초기화
    if (passwordInput.value) // 비밀번호 입력 여부
    {
        const characterCount = Array.from(passwordInput.value).length; // 비밀번호 코드 포인트 수
        const byteCount = new TextEncoder().encode(passwordInput.value).length; // 비밀번호 UTF-8 바이트 수
        if (characterCount < 12 || characterCount > 64 || byteCount > 72 || passwordInput.value.includes("\u0000")) // 공통 비밀번호 제한 확인
        {
            passwordInput.setCustomValidity("비밀번호는 12~64자, UTF-8 기준 최대 72바이트로 입력하세요."); // 명확한 입력 오류 안내
        }
    }
}
function clearAuthErrors() // 인증 입력 오류와 안내 초기화
{
    ["username", "email", "password"].forEach((field) => // 인증 입력 필드 순회
    {
        byId(`auth-${field}`).setCustomValidity(""); // 브라우저 입력 오류 초기화
        byId(`auth-${field}`).removeAttribute("aria-invalid"); // 이전 오류 접근성 상태 제거
        byId(`${field}-error`).textContent = ""; // 필드 오류 안전한 초기화
    }); // 인증 입력 필드 순회 끝
    byId("auth-feedback").textContent = ""; // 이전 처리 결과 초기화
    byId("auth-feedback").classList.remove("success"); // 성공 안내 색상 초기화
}
function showAuthError(message, fields = {}) // 실제 실패와 필드 오류 표시
{
    let firstInvalid = null; // 첫 오류 필드 보관
    ["username", "email", "password"].forEach((field) => // 허용된 필드만 검사
    {
        if (typeof fields[field] === "string" && !byId(`auth-${field}`).disabled) // 현재 화면의 실제 오류 여부
        {
            byId(`${field}-error`).textContent = fields[field]; // HTML 실행 없는 오류 출력
            byId(`auth-${field}`).setAttribute("aria-invalid", "true"); // 오류 접근성 상태 표시
            firstInvalid = firstInvalid || byId(`auth-${field}`); // 첫 오류 필드 선택
        }
    }); // 오류 필드 처리 끝
    byId("auth-feedback").textContent = message; // 실제 실패 안내 안전한 출력
    byId("auth-feedback").classList.remove("success"); // 오류 안내 색상 복원
    if (authDialog.open) // 인증 대화상자 표시 여부
    {
        (firstInvalid || byId("auth-feedback")).focus(); // 오류 필드 또는 안내로 이동
    }
}
function validateAuthForm() // 실제 API 계약에 맞는 입력 검사
{
    clearAuthErrors(); // 이전 오류 상태 초기화
    const usernameInput = byId("auth-username"); // 가입 사용자명 입력
    const emailInput = byId("auth-email"); // 공통 이메일 입력
    usernameInput.value = usernameInput.value.trim().toLowerCase(); // 사용자명 공백 제거와 소문자 정규화
    emailInput.value = emailInput.value.trim().toLowerCase(); // 이메일 공백 제거와 소문자 정규화
    if (authMode === "register" && !/^[a-z0-9_가-힣]{2,32}$/.test(usernameInput.value)) // 사용자명 허용 범위 확인
    {
        usernameInput.setCustomValidity("사용자명은 한글·영문·숫자·밑줄 2~32자로 입력하세요."); // 사용자명 입력 규칙 안내
    }
    if (emailInput.value.length > 254 || /[^\x00-\x7F]/.test(emailInput.value)) // 이메일 ASCII와 길이 확인
    {
        emailInput.setCustomValidity("이메일은 영문 주소 기준 최대 254자로 입력하세요."); // 계약에 맞는 이메일 제한 안내
    }
    validatePassword(); // 원문 비밀번호 글자 수와 바이트 검사
    return authForm.reportValidity(); // 첫 오류 안내와 최종 입력 확인
}
function renderAuthState() // 실제 사용자 상태 표시
{
    renderManagementUI(); // 현재 계정의 관리 버튼 상태
    byId("current-user").textContent = currentUser ? currentUser.username : "게스트"; // 본인 사용자명 안전한 출력
    byId("user-avatar").textContent = currentUser ? Array.from(currentUser.username)[0].toUpperCase() : "G"; // 현재 사용자 이니셜
    byId("session-state").textContent = sessionNotice; // 실제 인증 확인 범위 안내
    byId("open-auth").textContent = authBusy ? "처리 중…" : currentUser ? "로그아웃" : "로그인"; // 인증 상태별 버튼 문구
    byId("open-auth").disabled = authBusy || authInitializing; // 중복 요청과 초기 확인 중 클릭 차단
    updateComposer(); // 실제 인증 상태별 입력 갱신
    byId("connection-status").textContent = `${databaseReady ? "DB 연결 확인됨" : "DB 연결 확인 필요"} · ${csrfToken ? "화면 보호 준비됨" : "화면 보호 확인 필요"}`; // 실제 확인한 공통 연결 범위
}
function setAuthBusy(busy) // 인증 요청 중 화면 보호
{
    authBusy = busy; // 현재 요청 진행 상태 보관
    authForm.setAttribute("aria-busy", String(busy)); // 보조 기기 처리 상태 안내
    byId("auth-username").disabled = busy || authMode !== "register"; // 사용자명 변경과 숨긴 입력 차단
    byId("auth-email").disabled = busy; // 요청 중 이메일 변경 차단
    passwordInput.disabled = busy; // 요청 중 비밀번호 변경 차단
    byId("auth-submit").disabled = busy; // 중복 제출 차단
    byId("auth-submit").textContent = busy ? "처리 중…" : authMode === "register" ? "회원가입" : "로그인"; // 처리 상태 버튼 안내
    byId("switch-auth").disabled = busy; // 요청 중 인증 화면 전환 차단
    byId("close-auth").disabled = busy; // 요청 중 모달 닫기 차단
    renderAuthState(); // 사용자 버튼 상태 갱신
}
function applyProfile(user) // 같은 계정의 확인된 프로필 반영
{
    if (!currentUser || user.id !== currentUser.id) // 다른 계정의 늦은 결과
    {
        return; // 본인 정보 교체 차단
    }
    currentUser = user; // 계정 번호를 유지한 본인 정보
    Object.values(channels).forEach((channel) => channel.feed?.renameUser(user.id, user.username)); // 초안·대화·커서를 유지한 이름 갱신
    renderAuthState(); // 현재 사용자명과 이니셜 갱신
}
function validUser(user) // 실제 사용자 응답 기본 검사
{
    return user && validId(user.id) && typeof user.username === "string" && user.username.length > 0; // 렌더링에 필요한 사용자 자료 검사
}
function requestError(message, status = 0, code = "", fields = {}, retryAfter = null) // 안전한 요청 오류 생성
{
    const operationError = new Error(message); // 사용자 안내 오류 객체
    Object.assign(operationError, { status, code, fields, retryAfter }); // HTTP 상태와 계약 오류 정보 보관
    return operationError; // 화면 처리용 오류 반환
}
function ignoreConnectionFailure() // 선택적 연결 확인 실패 처리
{
    return undefined; // 확인하지 못한 상태 유지
}
async function requestEndpoint(path, body = null, signal = null, method = null) // 동일 출처의 취소 가능한 JSON API 요청
{
    const requestController = new AbortController(); // 오래 걸리는 요청 취소 도구
    const cancel = () => requestController.abort(); // 채널 수명 종료의 요청 취소
    signal?.addEventListener("abort", cancel, { once: true }); // 채널 이동과 로그아웃 연결
    if (signal?.aborted) // 요청 직전 이미 취소된 수명
    {
        requestController.abort(); // 종료된 조회의 네트워크 시작 차단
    }
    const requestTimeout = window.setTimeout(() => requestController.abort(), 15000); // 연결 확인 대기 시간 제한
    const headers = { Accept: "application/json" }; // JSON 응답 요청
    if (currentUser) // 화면이 확인한 사용자 존재 여부
    {
        headers["X-Expected-User-Id"] = currentUser.id; // 다른 탭 계정 변경의 서버 사전 검사
    }
    const multipart = typeof FormData !== "undefined" && body instanceof FormData; // 브라우저 multipart 본문 여부
    if (body !== null) // 실제 상태 변경 요청 여부
    {
        if (!multipart) // JSON 본문 여부
        {
            headers["Content-Type"] = "application/json"; // 표준 JSON 요청 형식
        }
        headers["X-CSRF-Token"] = csrfToken; // 메모리의 최신 보호 토큰
    }
    try // 응답과 실패 정보 확인
    {
        const response = await fetch(path, { method: method || (body === null ? "GET" : "POST"), credentials: "same-origin", headers, body: body === null ? undefined : multipart ? body : JSON.stringify(body), cache: "no-store", signal: requestController.signal }); // 기존 인증과 본문 형식 유지
        const payload = await response.json(); // 표준 JSON 응답 읽기
        if (!response.ok || payload.success !== true) // 서버 실패 응답 여부
        {
            const failure = payload.error || {}; // 합의된 오류 정보
            throw requestError(typeof failure.message === "string" ? failure.message : "요청을 처리하지 못했습니다.", response.status, failure.code, failure.fields, response.headers.get("Retry-After")); // 안전한 계약 오류 전달
        }
        if (!payload.data || typeof payload.data !== "object") // 성공 응답 자료 확인
        {
            throw requestError("서버 응답을 확인하지 못했습니다. 처리 여부를 확인한 뒤 다시 시도하세요."); // 불확실한 처리 결과 안내
        }
        return payload.data; // 실제 응답 자료 반환
    }
    catch (operationError) // 통신 또는 계약 오류 처리
    {
        if (typeof operationError.status === "number") // 이미 확인한 API 오류 여부
        {
            throw operationError; // 서버 오류 정보 유지
        }
        throw requestError(body === null ? "연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요." : "응답을 확인하지 못했습니다. 처리되었을 수 있으니 계정 상태를 확인한 뒤 다시 시도하세요."); // 통신 실패의 불확실성 안내
    }
    finally // 요청 자원 정리
    {
        window.clearTimeout(requestTimeout); // 완료한 요청의 대기 제한 제거
        signal?.removeEventListener("abort", cancel); // 완료한 요청의 취소 연결 제거
    }
}
async function refreshCsrf(generation = authGeneration) // 실제 세션 보호 토큰 재조회
{
    csrfToken = null; // 이전 토큰 사용 중단
    const responseData = await requestEndpoint("./backend/api/csrf.php"); // 현재 세션의 보호 토큰 조회
    if (typeof responseData.csrf_token !== "string" || !/^[a-f0-9]{64}$/.test(responseData.csrf_token)) // 보호 토큰 계약 확인
    {
        throw requestError("화면 보호 정보를 확인하지 못했습니다. 다시 시도하세요."); // 유효하지 않은 토큰 거절
    }
    if (generation !== authGeneration) // 이전 세션의 토큰 응답 여부
    {
        return; // 이전 보호 정보 무시
    }
    const expectedUserId = currentUser?.id; // 토큰을 적용할 화면 계정
    if (expectedUserId) // 로그인 상태에서 보호 정보 교체 여부
    {
        const identity = await requestEndpoint("./backend/api/get_current_user.php"); // 새 토큰 조회 뒤 현재 세션과 기대 계정 확인
        if (!validUser(identity.user) || identity.user.id !== expectedUserId) // 계정 응답의 추가 일치 검사
        {
            throw requestError("로그인 계정이 변경되었습니다. 다시 확인하세요.", 403, "SESSION_CHANGED"); // 다른 계정 토큰의 초안 사용 차단
        }
        if (generation !== authGeneration) // 계정 확인 중 교체된 수명
        {
            return; // 이전 토큰 적용 차단
        }
    }
    csrfToken = responseData.csrf_token; // 브라우저 메모리에만 새 토큰 보관
    renderAuthState(); // 보호 준비 상태 갱신
}
function clearSessionView(preserveDrafts = false) // 종료된 계정 자료 정리
{
    pauseMessageFeeds(); // 종료된 계정의 조회와 예약 제거
    serverUI?.clear(); // 이전 초대 코드와 관리 입력 폐기
    channelUI?.clear(); // 이전 채널 관리 대상과 입력 제거
    profileUI?.clear(); // 이전 이메일·사용자명 입력과 응답 폐기
    serverManager.reset(); // 서버·영구 선택·진행 결과 수명 제거
    savedDrafts = preserveDrafts && currentUser ? { userId: currentUser.id, values: Object.fromEntries(Object.entries(channels).map(([channelId, channel]) => [channelId, channel.draft])) } : null; // 같은 계정 재로그인용 초안
    currentUser = null; // 이전 사용자 제거
    directUI?.clear(); // 이전 개인 대화와 조회 수명 제거
    friendsUI?.clear(); // 이전 친구와 요청 목록 제거
    csrfToken = null; // 이전 보호 정보 제거
    channelLoadVersion += 1; // 이전 채널 조회 무효화
    channelLoading = false; // 이전 채널 조회 상태 해제
    channelError = ""; // 이전 조회 오류 제거
    sendRequest = null; // 이전 계정의 전송 잠금 해제
    channels = Object.create(null); // 이전 계정 채널과 메시지 제거
    activeChannel = null; // 이전 채널 선택 제거
    messageInput.value = ""; // 이전 초안 표시 제거
    byId("channel-file").value = ""; // 이전 계정의 선택 파일 제거
    byId("channel-file-status").textContent = "최대 5 MiB"; // 이전 파일 상태 제거
    authForm.reset(); // 인증 입력 제거
    clearAuthErrors(); // 이전 인증 오류 제거
    renderChannels(); // 비운 채널 목록 표시
    renderEmptyConversation(); // 로그인 필요 안내 표시
    renderAuthState(); // 게스트 상태 표시
}
async function restoreCurrentUser(generation) // 실제 로그인 세션 복원
{
    try // 현재 사용자 응답 확인
    {
        const responseData = await requestEndpoint("./backend/api/get_current_user.php"); // 실제 로그인 세션 조회
        if (generation !== authGeneration) // 최신 인증 상태와 조회 순서 비교
        {
            return; // 이전 상태의 늦은 응답 무시
        }
        if (!validUser(responseData.user)) // 사용자 응답 자료 확인
        {
            throw requestError("사용자 정보를 확인하지 못했습니다."); // 잘못된 인증 자료 거절
        }
        if (currentUser && currentUser.id !== responseData.user.id) // 실제 계정이 바뀐 복원 응답
        {
            authGeneration += 1; // 이전 계정 요청 무효화
            generation = authGeneration; // 이번 복원 수명 갱신
            clearSessionView(); // 이전 계정의 채널·초안·기록 제거
        }
        currentUser = responseData.user; // 실제 사용자 자료 보관
        sessionNotice = "로그인됨"; // 소속 권한과 구분한 인증 상태
        await loadChannels(); // 확인된 사용자 소속 채널 조회
    }
    catch (operationError) // 비로그인과 연결 실패 구분
    {
        if (generation !== authGeneration) // 최신 인증 상태와 조회 순서 비교
        {
            return; // 이전 상태의 늦은 실패 무시
        }
        if (operationError.code === "SESSION_CHANGED") // 복원 중 다른 탭 계정 변경
        {
            await expireMessageSession(true); // 이전 계정 자료를 남기지 않는 복구
            return; // 사용자 교체를 성공으로 추정하지 않도록 종료
        }
        if (operationError.status === 401) // 실제 비로그인 확인
        {
            clearSessionView(true); // 이전 기록 제거와 같은 계정 초안만 보관
            sessionNotice = "로그인 후 채널 이용 가능"; // 확인된 게스트 상태
            await refreshCsrf(); // 만료로 교체된 세션의 토큰 갱신
        }
        else // 통신 또는 응답 실패
        {
            sessionNotice = "세션 확인 필요"; // 인증 성공 추정 없는 상태
            throw operationError; // 호출 화면에 실패 전달
        }
    }
    renderAuthState(); // 확인된 세션 상태 출력
}
async function handleAuthFailure(operationError) // 실제 인증 실패 안내 구성
{
    if (operationError.code === "CSRF_INVALID") // 세션 보호 토큰 만료 또는 불일치
    {
        try // 새 보호 토큰 확인
        {
            await refreshCsrf(); // 사용자의 다음 요청을 위한 재발급
            return "화면 보호 정보를 갱신했습니다. 입력을 확인하고 다시 제출하세요."; // 자동 재전송 없는 명시적 안내
        }
        catch (recoveryError) // 보호 토큰과 계정 재확인 실패
        {
            if (recoveryError.status === 401 || recoveryError.code === "SESSION_CHANGED") // 실제 계정 종료 확인
            {
                await expireMessageSession(recoveryError.code === "SESSION_CHANGED"); // 이전 계정 화면과 토큰 제거
                return "로그인 상태가 변경되었습니다. 현재 계정을 다시 확인하세요."; // 자동 재전송 없는 상태 안내
            }
            return "화면 보호 정보를 갱신하지 못했습니다. 연결을 확인하고 다시 시도하세요."; // 복구 실패 안내
        }
    }
    if (operationError.status === 429) // 실제 로그인 시도 제한
    {
        const seconds = /^\d+$/.test(operationError.retryAfter || "") ? Number(operationError.retryAfter) : null; // 유효한 재시도 대기 시간
        return seconds === null ? "로그인 시도가 많습니다. 잠시 후 다시 시도하세요." : `로그인 시도가 많습니다. ${seconds.toLocaleString("ko-KR")}초 후 다시 시도하세요.`; // 접근 가능한 제한 안내
    }
    return operationError.message; // 서버에서 확인한 일반 오류
}
async function submitAuth(uiEvent) // 실제 가입 또는 로그인 처리
{
    uiEvent.preventDefault(); // 기본 폼 이동 차단
    if (authBusy || authInitializing || !validateAuthForm()) // 중복 요청과 입력 오류 확인
    {
        return; // 처리할 수 없는 제출 중단
    }
    const requestMode = authMode; // 요청 시작 시 인증 유형 보관
    const authBody = { email: byId("auth-email").value, password: passwordInput.value }; // 실제 인증 입력 자료
    if (requestMode === "register") // 가입 요청 여부
    {
        authBody.username = byId("auth-username").value; // 가입용 정규화 사용자명 추가
    }
    authGeneration += 1; // 이전 세션 확인 응답 무효화
    setAuthBusy(true); // 요청 중 중복 입력과 화면 전환 차단
    byId("auth-feedback").textContent = requestMode === "register" ? "계정을 만드는 중입니다." : "로그인 정보를 확인하는 중입니다."; // 실제 진행 상태 안내
    let registrationEmail = null; // 성공 후 로그인 이메일 보관
    let loginSucceeded = false; // 실제 로그인 성공 여부
    let failure = null; // 잠금 해제 후 표시할 오류
    try // 보호 토큰과 실제 인증 응답 확인
    {
        if (!csrfToken) // 사용할 보호 토큰 존재 여부
        {
            await refreshCsrf(); // 다음 요청의 실제 보호 토큰 발급
        }
        const responseData = await requestEndpoint(`./backend/api/${requestMode}.php`, authBody); // 실제 가입 또는 로그인 POST
        if (!validUser(responseData.user) || (requestMode === "login" && !/^[a-f0-9]{64}$/.test(responseData.csrf_token || ""))) // 성공 응답의 사용자와 새 토큰 확인
        {
            throw requestError("서버 응답을 확인하지 못했습니다. 계정 상태를 확인한 뒤 다시 시도하세요."); // 불완전한 응답의 성공 추정 방지
        }
        if (requestMode === "register") // 실제 가입 성공 여부
        {
            registrationEmail = authBody.email; // 별도 로그인을 위한 이메일 보관
        }
        else // 실제 로그인 성공
        {
            currentUser = responseData.user; // 실제 로그인한 사용자 보관
            csrfToken = responseData.csrf_token; // 로그인 후 교체된 보호 토큰 보관
            sessionNotice = "로그인됨"; // 실제 인증 성공 상태
            loginSucceeded = true; // 성공 응답 확인 표시
        }
    }
    catch (operationError) // 실제 인증 실패 또는 불확실한 응답
    {
        const message = await handleAuthFailure(operationError); // 토큰 복구 또는 시도 제한 안내
        failure = { message, fields: operationError.fields || {} }; // 잠금 해제 후 안전한 실패 표시 자료
        if (operationError.code === "ALREADY_AUTHENTICATED") // 다른 화면에서 이미 로그인한 세션
        {
            csrfToken = null; // 다른 화면에서 교체되었을 이전 토큰 제거
            try // 현재 사용자와 보호 토큰의 실제 복구 확인
            {
                await restoreCurrentUser(authGeneration); // 현재 실제 세션 사용자 재확인
                if (!validUser(currentUser)) // 확인된 로그인 사용자 존재 여부
                {
                    throw requestError("현재 로그인 정보를 확인하지 못했습니다. 다시 로그인하세요."); // 게스트 또는 확인 실패의 성공 추정 방지
                }
                await refreshCsrf(); // 복원한 사용자 세션의 최신 보호 토큰 조회
                loginSucceeded = true; // 사용자와 보호 토큰이 모두 확인된 복구
                failure = null; // 실제 복구된 인증 충돌 안내 제거
            }
            catch (recoveryError) // 사용자 또는 보호 정보 복구 실패
            {
                failure = { message: recoveryError.message, fields: {} }; // 실제 확인 실패의 안전한 안내
            }
        }
    }
    finally // 요청 종료 후 자격 증명과 입력 잠금 정리
    {
        authBody.password = ""; // 요청 자료의 비밀번호 참조 정리
        passwordInput.value = ""; // 화면에 남은 비밀번호 제거
        setAuthBusy(false); // 입력과 화면 전환 복구
    }
    if (registrationEmail !== null) // 실제 가입 완료 확인
    {
        switchAuth("login"); // 자동 로그인 없이 로그인 화면 전환
        byId("auth-email").value = registrationEmail; // 가입한 이메일만 미리 입력
        byId("auth-feedback").textContent = "회원가입이 완료되었습니다. 비밀번호를 입력하고 로그인하세요."; // 실제 가입 성공 안내
        byId("auth-feedback").classList.add("success"); // 성공 안내 색상 적용
        passwordInput.focus(); // 별도 로그인 비밀번호로 이동
    }
    else if (loginSucceeded) // 실제 로그인 성공 확인
    {
        authDialog.close(); // 로그인 완료 후 인증 화면 닫기
        await loadChannels(); // 로그인과 최신 보호 정보 확인 뒤 실제 채널 조회
    }
    else if (failure) // 실제 실패 안내 존재 여부
    {
        showAuthError(failure.message, failure.fields); // 안전한 오류 출력과 포커스 이동
    }
}
async function logout() // 실제 로그인 세션 종료
{
    if (authBusy || authInitializing || sendRequest || directUI?.isBusy() || !currentUser) // 중복 요청과 저장 진행 및 인증 상태 확인
    {
        return; // 처리할 수 없는 로그아웃 중단
    }
    authGeneration += 1; // 이전 사용자 조회 응답 무효화
    pauseMessageFeeds(); // 로그아웃 요청 전 기존 대화 조회 중단
    directUI?.suspend(); // 개인 대화 조회와 알림 중단
    setAuthBusy(true); // 중복 로그아웃 요청 차단
    sessionNotice = "로그아웃 중…"; // 실제 요청 진행 안내
    renderAuthState(); // 사용자 영역 상태 갱신
    let expired = false; // 서버에서 확인한 세션 만료 여부
    try // 서버 로그아웃 응답 확인
    {
        if (!csrfToken) // 보호 토큰 존재 여부
        {
            await refreshCsrf(); // 누락된 토큰 재발급
        }
        await requestEndpoint("./backend/api/logout.php", {}); // 빈 JSON 객체로 실제 로그아웃
        sessionNotice = "로그아웃됨"; // 실제 세션 종료 안내
        clearSessionView(); // 이전 사용자와 대화 및 초안 제거
        await refreshCsrf().catch(ignoreConnectionFailure); // 새 게스트 세션 보호 토큰 발급 시도
    }
    catch (operationError) // 로그아웃 실패 또는 세션 만료
    {
        if (operationError.status === 401 || operationError.code === "SESSION_CHANGED") // 서버에서 세션 만료 또는 계정 변경 확인
        {
            sessionNotice = operationError.code === "SESSION_CHANGED" ? "계정 변경 · 다시 확인하세요" : "세션 만료 · 다시 로그인하세요"; // 현재 세션 종료 이유
            clearSessionView(); // 만료된 사용자 화면 자료 제거
            await refreshCsrf().catch(ignoreConnectionFailure); // 로그인 전 새 보호 토큰 발급 시도
            expired = true; // 로그인 화면 재표시 준비
        }
        else // 실제 종료를 확인하지 못한 경우
        {
            sessionNotice = await handleAuthFailure(operationError); // 사용자 상태 유지와 실제 실패 안내
        }
    }
    finally // 로그아웃 요청 잠금 해제
    {
        setAuthBusy(false); // 실제 상태에 맞는 버튼 복구
    }
    if (expired) // 서버에서 세션 만료가 확인된 경우
    {
        openAuth(); // 다시 로그인할 화면 표시
        showAuthError("세션이 만료되었습니다. 다시 로그인하세요."); // 만료 이유 접근성 안내
    }
    else if (currentUser) // 로그아웃 실패로 기존 세션이 유지된 경우
    {
        if (directUI?.isActive()) // 개인 대화가 열린 상태
        {
            directUI.resume(); // 개인 대화 조회 복구
        }
        else if (channels[activeChannel]) // 기존 채널 화면
        {
            channels[activeChannel].feed.activate(); // 실제 남아 있는 계정의 조회 복구
        }
    }
}
async function checkConnections() // 최초 세션과 실제 연결 확인
{
    const requestGeneration = authGeneration; // 최초 확인 요청의 상태 번호
    await refreshCsrf().catch(ignoreConnectionFailure); // 병렬 조회 전 최초 세션 쿠키 발급 시도
    const health = requestEndpoint("./backend/api/health.php").then((responseData) => // 독립적인 데이터베이스 상태 확인
    {
        databaseReady = responseData.status === "ok"; // 실제 연결 성공 여부 보관
        renderAuthState(); // 확인한 연결 상태 표시
    }).catch(ignoreConnectionFailure); // 연결 실패의 준비 완료 추정 방지
    try // 세션 쿠키 발급 후 인증 상태 확인
    {
        await restoreCurrentUser(requestGeneration); // 실제 현재 사용자 확인
    }
    catch // 초기 세션 조회 또는 보호 정보 확인 실패
    {
        sessionNotice = "세션 확인 필요 · 로그인으로 다시 확인"; // 연결 실패를 인증 성공으로 표시하지 않는 안내
    }
    finally // 첫 세션 확인 종료
    {
        authInitializing = false; // 사용자의 실제 인증 요청 허용
        renderAuthState(); // 확인한 사용자와 로그인 버튼 표시
        if (sessionNotice === "세션 만료 · 다시 로그인하세요") // 최초 채널 확인 중 인증 만료
        {
            openAuth(); // 초기 조회 종료 후 로그인 화면 표시
            showAuthError("세션이 만료되었습니다. 다시 로그인하세요."); // 확인된 만료 이유
        }
    }
    await health; // 실제 데이터베이스 확인 종료 대기
}
async function serverFailure(operationError, generation = authGeneration, userId = currentUser?.id) // 관리·프로필 복구의 계정 수명
{
    if (operationError.code === "STALE_RESPONSE" || generation !== authGeneration || userId !== currentUser?.id) // 중첩 복구도 이전 계정 결과 폐기
    {
        return "로그인 상태를 다시 확인하세요."; // 이전 자료 표시 중단
    }
    if (operationError.status === 401 || operationError.code === "SESSION_CHANGED") // 실제 계정 종료
    {
        await expireMessageSession(operationError.code === "SESSION_CHANGED"); // 기존 계정 화면 정리
        return "현재 계정으로 다시 로그인하세요."; // 수동 재확인 안내
    }
    if (operationError.code === "CSRF_INVALID") // 계정 확인을 포함한 토큰 복구
    {
        try // 자동 변경 재전송 없는 복구
        {
            await refreshCsrf(); // 기존 계정 일치 검사
            return "화면 보호 정보를 갱신했습니다. 내용을 확인하고 다시 제출하세요."; // 명시적 재제출
        }
        catch (recovery) // 복구 중 계정 변경
        {
            return serverFailure(recovery, generation, userId); // 복구 시작 계정의 종료 경계 유지
        }
    }
    if ([403, 404].includes(operationError.status)) // 소속 또는 자원 상실
    {
        serverUI?.clear(); // 이전 초대와 입력 제거
        byId("server-dialog").close(); // 접근하지 못하는 관리 화면 종료
        channelUI?.clear(); // 접근을 잃은 채널 관리 화면 종료
        await loadChannels(); // 실제 서버·채널 목록 재확인
    }
    return operationError.status === 429 ? `요청이 많습니다. ${operationError.retryAfter || 600}초 후 다시 시도하세요.` : operationError.message; // 실제 오류와 제한 안내
}
byId("retry-channels").addEventListener("click", loadChannels); // 소속 채널 조회 재시도
serverUI = mountServerUI({ manager: serverManager, byId, onDeparted: discardDepartedServer, onReload: loadChannels, onSelect: loadChannels, onError: serverFailure, isReady: () => Boolean(currentUser && csrfToken && !authBusy && !authInitializing && !sendRequest) }); // 실제 관리 화면 연결
channelUI = mountChannelUI({ manager: serverManager, byId, getChannel: () => activeChannel && channels[activeChannel] ? { ...channels[activeChannel], id: activeChannel } : null, hasChannel: (channelId) => Boolean(channels[channelId]), onDeleted: discardDeletedChannel, onReload: loadChannels, onError: serverFailure, isReady: () => Boolean(currentUser && csrfToken && !authBusy && !authInitializing && !sendRequest && !channelLoading && !channelError) }); // 실제 채널과 권한별 관리 연결
profileUI = mountProfileUI({ manager: serverManager, byId, getUser: () => currentUser, onUser: applyProfile, onError: serverFailure, isReady: () => Boolean(currentUser && csrfToken && !authBusy && !authInitializing && !sendRequest) }); // 기존 인증·요청 수명으로 본인 프로필 연결
directUI = mountDirectUI({ byId, request: requestEndpoint, getUser: () => currentUser, isReady: () => Boolean(currentUser && csrfToken && !authBusy && !authInitializing && !sendRequest), onError: serverFailure, createMessage, onBusyChange: updateComposer, onOpen: () => // 기존 채널과 개인 화면 분리
{
    if (channels[activeChannel]) // 현재 채널의 초안 존재
    {
        channels[activeChannel].draft = messageInput.value; // 채널 초안 보존
        channels[activeChannel].scroll = messageScroll.scrollTop; // 채널 읽기 위치 보존
    }
    pauseMessageFeeds(); // 채널의 조회와 알림 중단
    byId("channel-conversation").hidden = true; // 채널 화면 숨김
    byId("direct-conversation").hidden = false; // 개인 화면 표시
    renderChannels(); // 채널 선택 강조 해제
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 대화 화면 복귀
    }
}, startRealtime: (conversationId, feed, userId) => // 개인 대화의 본문 없는 알림 연결
{
    if (!window.location || window.location.protocol !== "http:" || window.location.hostname !== "127.0.0.6" || typeof window.WebSocket !== "function") // 지원하는 로컬 실시간 환경
    {
        return null; // HTTP 조회 유지
    }
    const client = createRealtimeClient({ url: "ws://127.0.0.6:8090/Team006/realtime", WebSocketImpl: window.WebSocket, subscription: () => ({ conversation_id: conversationId, after_id: feed.after }), onStateChange: () => undefined, onMessage: () => // 현재 대화 커서로 구독
    {
        if (currentUser?.id === userId && feed.active && !feed.blocked) // 계정과 대화 수명 확인
        {
            feed.run(feed.loaded ? "after" : "initial"); // 권한 검사 후 신규 기록 조회
        }
    } }); // 알림 클라이언트 준비 끝
    client.start(); // 개인 알림 연결
    return client; // 대화 전환 시 종료할 연결
} }); // 개인 대화 연결 끝
friendsUI = mountFriendsUI({ byId, request: requestEndpoint, getUser: () => currentUser, isReady: () => Boolean(currentUser && csrfToken && !authBusy && !authInitializing && !sendRequest), onOpen: (user) => directUI.startConversation(user), onError: serverFailure }); // 친구 요청과 개인 대화 연결
document.addEventListener("visibilitychange", () => // 빈 서버를 포함한 창 복귀 갱신
{
    if (document.visibilityState === "visible" && currentUser && !authInitializing && !serverManager.busy && !channelLoading) // 안정된 로그인 화면
    {
        loadChannels(); // 서버 목록의 별도 폴링 없는 재확인
    }
}); // 창 복귀 연결 끝
byId("load-older").addEventListener("click", () => channels[activeChannel]?.feed.older()); // 현재 채널의 이전 기록 추가
byId("retry-messages").addEventListener("click", () => channels[activeChannel]?.feed.activate()); // 확인하지 못한 대화 수동 재조회
window.addEventListener("pagehide", () => // 화면 종료 시 모든 대화 조회 정리
{
    pauseMessageFeeds(); // 채널 조회 중단
    directUI?.suspend(); // 개인 조회 중단
}); // 화면 종료 연결 끝
window.addEventListener("pageshow", (uiEvent) => // 뒤로 가기 캐시에서 복구된 화면
{
    if (uiEvent.persisted && currentUser && directUI?.isActive()) // 복원된 개인 대화
    {
        directUI.resume(); // 개인 기록과 알림 복구
    }
    else if (uiEvent.persisted && currentUser && channels[activeChannel]) // 로그인한 기존 채널 복구 여부
    {
        channels[activeChannel].feed.activate(); // 남은 신규 기록 확인 재개
        startRealtime(activeChannel); // 현재 채널의 알림 연결 복구
    }
}); // 화면 수명 복구 연결 종료
messageInput.addEventListener("input", () => // 입력 수정 상태 처리
{
    if (channels[activeChannel]) // 선택한 실제 채널 여부
    {
        channels[activeChannel].feedback = ""; // 이전 제출 결과 제거
        channels[activeChannel].error = false; // 이전 오류 색상 제거
    }
    updateComposer(); // 최신 초안과 글자 수 갱신
}); // 입력 수정 처리 끝
byId("message-form").addEventListener("submit", sendMessage); // 실제 메시지 저장 연결
byId("channel-file").addEventListener("change", () => // 파일 선택 상태 반영
{
    byId("channel-file-status").textContent = byId("channel-file").files[0]?.name || "최대 5 MiB"; // 선택한 파일 이름 안내
    updateComposer(); // 파일 전송 가능 여부 갱신
}); // 파일 선택 처리 끝
byId("channel-upload").addEventListener("click", sendChannelFile); // 사용자 명시적 파일 전송
messageInput.addEventListener("keydown", (uiEvent) => // 키보드 전송 처리
{
    if (uiEvent.key === "Enter" && !uiEvent.shiftKey && !uiEvent.isComposing && uiEvent.keyCode !== 229) // 한글 조합 제외 단독 Enter
    {
        uiEvent.preventDefault(); // 기본 줄바꿈 차단
        byId("message-form").requestSubmit(); // 동일한 유효성 경로로 전송
    }
}); // 키보드 전송 처리 끝
messageScroll.addEventListener("scroll", () => // 사용자의 대화 읽기 위치 추적
{
    if (!channels[activeChannel]) // 선택한 채널 없는 상태
    {
        return; // 비어 있는 목록 스크롤 무시
    }
    channels[activeChannel].scroll = messageScroll.scrollTop; // 채널별 읽는 위치 갱신
    if (nearBottom()) // 하단까지 읽었는지 확인
    {
        channels[activeChannel].unread = 0; // 확인한 새 메시지 수 초기화
        showNewMessages(); // 새 메시지 안내 갱신
    }
}); // 읽기 위치 추적 끝
byId("new-messages").addEventListener("click", scrollToBottom); // 새 메시지로 직접 이동
byId("sidebar-toggle").addEventListener("click", () => setSidebar(!sidebarOpen)); // 모바일 목록 전환
byId("direct-sidebar-toggle").addEventListener("click", () => setSidebar(!sidebarOpen)); // 개인 화면의 모바일 목록 전환
byId("sidebar-backdrop").addEventListener("click", () => setSidebar(false)); // 목록 바깥 클릭 닫기
mobileQuery.addEventListener("change", () => setSidebar(false)); // 화면 크기 변경 시 목록 정리
document.addEventListener("keydown", (uiEvent) => // 모바일 목록 키보드 제어
{
    if (!sidebarOpen || authDialog.open) // 목록 전용 제어 여부
    {
        return; // 다른 화면 키보드 처리 유지
    }
    if (uiEvent.key === "Escape") // 목록 닫기 키 여부
    {
        uiEvent.preventDefault(); // 기본 Escape 동작 차단
        setSidebar(false); // 모바일 목록 접기
    }
    if (uiEvent.key === "Tab") // 목록 포커스 순환 여부
    {
        const focusableButtons = [...byId("channel-sidebar").querySelectorAll("button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled)"), ...byId("friend-panel").querySelectorAll("button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled)")]; // 두 목록의 조작 가능한 요소
        const focusIndex = focusableButtons.indexOf(document.activeElement); // 현재 목록 포커스 위치
        if (focusableButtons.length === 0) // 초기 조회 중 사용할 버튼 없는 상태
        {
            uiEvent.preventDefault(); // 비활성 대화 영역으로 이동 차단
            byId("channel-sidebar").focus(); // 목록 영역 포커스 유지
            return; // 빈 목록 순환 종료
        }
        if (focusIndex < 0 || (uiEvent.shiftKey && focusIndex === 0) || (!uiEvent.shiftKey && focusIndex === focusableButtons.length - 1)) // 목록 경계 이동 여부
        {
            uiEvent.preventDefault(); // 목록 바깥 포커스 이동 방지
            focusableButtons[uiEvent.shiftKey ? focusableButtons.length - 1 : 0].focus(); // 목록 안 첫쪽 또는 끝쪽 이동
        }
    }
}); // 모바일 목록 키보드 제어 끝
byId("open-auth").addEventListener("click", () => currentUser ? logout() : openAuth()); // 현재 인증 상태별 로그인과 로그아웃 연결
byId("close-auth").addEventListener("click", () => authDialog.close()); // 요청 대기 중 비활성화된 닫기 버튼 연결
byId("switch-auth").addEventListener("click", () => switchAuth(authMode === "login" ? "register" : "login")); // 인증 화면 전환 연결
authForm.addEventListener("input", (uiEvent) => // 수정한 필드의 이전 오류 정리
{
    const fieldName = uiEvent.target.name; // 수정한 인증 입력 이름
    if (["username", "email", "password"].includes(fieldName)) // 허용된 인증 필드 여부
    {
        uiEvent.target.setCustomValidity(""); // 수정 전 입력 오류 제거
        uiEvent.target.removeAttribute("aria-invalid"); // 수정 전 접근성 오류 상태 제거
        byId(`${fieldName}-error`).textContent = ""; // 수정한 필드의 오류 문구 제거
    }
}); // 인증 입력 오류 정리 끝
authForm.addEventListener("submit", submitAuth); // 실제 가입과 로그인 제출 연결
authDialog.addEventListener("cancel", (uiEvent) => // 요청 중 Escape 닫기 제어
{
    if (authBusy) // 실제 요청 진행 여부
    {
        uiEvent.preventDefault(); // 응답 처리 전 모달 닫기 차단
    }
}); // 요청 중 Escape 닫기 제어 끝
authDialog.addEventListener("close", () => // 인증 화면 닫힌 뒤 정리
{
    authForm.reset(); // 입력한 자격 증명 제거
    clearAuthErrors(); // 입력 오류 상태 제거
    if (mobileQuery.matches) // 모바일 닫기 포커스 위치
    {
        byId("sidebar-toggle").focus(); // 숨겨지지 않은 메뉴 버튼 포커스
    }
    else if (lastAuthTrigger) // 이전 인증 버튼 존재 여부
    {
        lastAuthTrigger.focus(); // 이전 인증 버튼 포커스 복원
    }
}); // 인증 닫기 정리 끝
authDialog.addEventListener("click", (uiEvent) => // 모달 바깥 클릭 처리
{
    const dialogBounds = authDialog.getBoundingClientRect(); // 모달 실제 화면 위치
    if (!authBusy && uiEvent.target === authDialog && (uiEvent.clientX < dialogBounds.left || uiEvent.clientX > dialogBounds.right || uiEvent.clientY < dialogBounds.top || uiEvent.clientY > dialogBounds.bottom)) // 요청 대기 외 모달 배경 클릭 여부
    {
        authDialog.close(); // 인증 화면 닫기
    }
}); // 모달 바깥 클릭 처리 끝
renderChannels(); // 실제 조회 전 빈 채널 목록
renderEmptyConversation(); // 로그인 필요 초기 화면
checkConnections(); // 실제 공통 API 상태 확인 시작
