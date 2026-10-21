"use strict"; // 엄격한 자바스크립트 검사
const byId = (id) => document.getElementById(id); // 화면 요소 조회
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
function validId(value) // 큰 정수 문자열 계약 검사
{
    return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 부호 없는 64비트 범위 확인
}
function nearBottom() // 대화 하단 여부 확인
{
    return messageScroll.scrollHeight - messageScroll.clientHeight - messageScroll.scrollTop < 45; // 하단까지 남은 거리
}
function showNewMessages() // 새 메시지 안내 갱신
{
    const unread = channels[activeChannel]?.unread || 0; // 선택한 채널의 읽지 않은 수
    byId("new-messages").hidden = unread === 0; // 새 메시지 안내 표시
    byId("new-messages").textContent = `새 메시지 ${unread}개 보기 ↓`; // 안전한 안내 출력
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
    const article = document.createElement("article"); // 메시지 묶음
    article.className = "message"; // 메시지 배치 스타일
    const avatar = document.createElement("div"); // 작성자 이니셜
    avatar.className = "avatar avatar-teal"; // 작성자 아바타 스타일
    avatar.setAttribute("aria-hidden", "true"); // 장식 중복 읽기 방지
    avatar.textContent = Array.from(message.name)[0].toUpperCase(); // 사용자 첫 글자 출력
    const content = document.createElement("div"); // 메시지 내용 영역
    content.className = "message-content"; // 본문 배치 스타일
    const meta = document.createElement("div"); // 작성 정보 영역
    meta.className = "message-meta"; // 작성 정보 스타일
    const name = document.createElement("strong"); // 사용자 이름
    name.textContent = message.name; // 일반 텍스트 사용자명
    const time = document.createElement("time"); // 저장 시각
    time.dateTime = message.timestamp; // 기계 판독 시각
    time.textContent = new Date(message.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }); // 사용자 시간대 표시
    const label = document.createElement("span"); // 확인된 저장 배지
    label.className = "local-label"; // 배지 스타일
    label.textContent = "저장됨"; // 실제 성공 응답 구분
    meta.append(name, time, label); // 작성 정보 배치
    const body = document.createElement("p"); // 메시지 본문
    body.className = "message-body"; // 원문 줄바꿈 스타일
    body.textContent = message.text; // HTML 실행 없는 원문 출력
    content.append(meta, body); // 작성 정보와 본문 배치
    article.append(avatar, content); // 메시지 요소 조립
    return article; // 완성한 메시지 반환
}
function updateComposer() // 인증과 초안에 따른 입력 상태 갱신
{
    const channel = channels[activeChannel]; // 선택한 실제 채널
    const count = Array.from(messageInput.value).length; // 원문 코드 포인트 수
    const hasText = /[^\p{White_Space}\uFEFF]/u.test(messageInput.value); // 공백 외 글자 여부
    const containsNull = messageInput.value.includes("\u0000"); // 저장 불가능한 빈 문자
    const available = Boolean(currentUser && channel && csrfToken && !authBusy && !authInitializing && !channelLoading && !channelError); // 실제 전송 준비 상태
    messageInput.disabled = !available; // 게스트와 미확인 채널 입력 차단
    byId("message-count").textContent = `${count.toLocaleString("ko-KR")} / 2,000`; // 원문 길이 표시
    byId("message-count").classList.toggle("over-limit", count > 2000); // 초과 길이 표시
    byId("send-button").disabled = !available || Boolean(sendRequest) || !hasText || count > 2000 || containsNull; // 중복 제출과 잘못된 입력 차단
    byId("open-auth").disabled = authBusy || authInitializing || Boolean(sendRequest); // 저장 결과 확인 전 계정 변경 차단
    byId("send-button").textContent = sendRequest ? "저장 중…" : "전송 ↗"; // 실제 저장 요청 상태
    byId("message-form").setAttribute("aria-busy", String(Boolean(sendRequest))); // 보조 기기 요청 상태
    messageInput.setAttribute("aria-invalid", String(count > 2000 || containsNull)); // 입력 오류 접근성 상태
    if (channel) // 실제 채널 선택 여부
    {
        channel.draft = messageInput.value; // 채널별 작성 원문 보관
    }
    const feedback = containsNull ? "지원하지 않는 빈 문자를 제거하세요." : count > 2000 ? "메시지는 2,000자까지 입력할 수 있습니다." : !currentUser ? "로그인 후 참여 중인 채널에 메시지를 보낼 수 있습니다." : channelLoading ? "참여 중인 채널을 확인하는 중입니다." : channelError ? channelError : !channel ? "참여 중인 채널이 없습니다. 서버 참여 후 사용할 수 있습니다." : !csrfToken ? "화면 보호 정보를 확인하지 못했습니다. 다시 로그인하세요." : channel.feedback || "새로고침 후에도 DB에 저장됩니다. 이전 대화 조회는 다음 단계입니다."; // 확인된 기능 범위와 오류 안내
    byId("composer-feedback").textContent = feedback; // 안전한 상태 문구 출력
    byId("composer-feedback").classList.toggle("error", count > 2000 || containsNull || Boolean(channel?.error) || Boolean(channelError)); // 실패 상태 색상
}
function renderChannels() // 실제 소속 채널 목록 생성
{
    const list = byId("channel-list"); // 동적 채널 버튼 영역
    const items = Object.entries(channels).map(([id, channel]) => // 소속 채널 순서 유지
    {
        const button = document.createElement("button"); // 키보드 접근 가능한 채널 버튼
        button.type = "button"; // 폼 제출 방지
        button.className = "channel-button"; // 기존 채널 디자인
        button.dataset.channel = id; // 문자열 식별자 보관
        button.textContent = `# ${channel.title} · ${channel.serverName}`; // 같은 이름의 서버별 채널 구분
        button.title = `${channel.serverName} / ${channel.title}`; // 전체 채널 이름 안내
        button.setAttribute("aria-pressed", String(id === activeChannel)); // 현재 채널 선택 상태
        button.classList.toggle("active", id === activeChannel); // 현재 채널 강조
        button.addEventListener("click", () => selectChannel(id)); // 확인한 식별자로만 채널 선택
        return button; // 완성한 탐색 버튼
    }); // 채널 버튼 생성 끝
    list.replaceChildren(...items); // 이전 계정 목록 제거 후 교체
    byId("channel-count").textContent = String(items.length).padStart(2, "0"); // 실제 채널 수
    byId("channel-status").hidden = items.length > 0 && !channelLoading && !channelError; // 비어 있거나 실패한 목록 안내
    byId("channel-status").textContent = !currentUser ? "로그인 후 참여 채널이 표시됩니다." : channelLoading ? "채널을 확인하는 중입니다." : channelError || "참여 중인 채널이 없습니다. 서버 참여 후 사용할 수 있습니다."; // 실제 참여 상태 안내
    byId("retry-channels").hidden = !currentUser || !channelError; // 조회 실패 시 재시도 제공
    byId("retry-channels").disabled = channelLoading || authBusy; // 중복 조회 차단
}
function renderEmptyConversation() // 선택 가능한 채널 없는 화면
{
    byId("channel-title").textContent = "채널 선택"; // 미확인 채널 제목 제거
    byId("channel-description").textContent = "참여 중인 채널에서 대화를 시작하세요"; // 실제 이용 조건
    byId("welcome-title").textContent = currentUser ? "참여 채널을 확인하세요" : "로그인하고 대화를 시작하세요"; // 사용자별 빈 상태 제목
    byId("welcome-description").textContent = currentUser ? channelError || "참여 중인 채널이 없습니다. 서버 참여 후 사용할 수 있습니다." : "계정으로 로그인하면 참여 중인 채널을 확인할 수 있습니다."; // 가짜 대화 없는 빈 상태
    byId("message-label").textContent = "메시지 작성"; // 기본 입력 레이블
    messageInput.placeholder = currentUser ? "참여 중인 채널을 선택하세요" : "로그인 후 메시지를 작성하세요"; // 실제 입력 조건
    messages.replaceChildren(); // 이전 대화 표시 제거
    showNewMessages(); // 새 메시지 안내 초기화
    updateComposer(); // 입력 잠금과 안내 갱신
}
function selectChannel(channelId) // 실제 소속 채널 전환
{
    if (!channels[channelId]) // 서버에서 확인한 채널 여부
    {
        return; // 미확인 채널 선택 중단
    }
    if (channels[activeChannel]) // 이전 선택 존재 여부
    {
        channels[activeChannel].scroll = messageScroll.scrollTop; // 이전 읽는 위치 보관
        channels[activeChannel].draft = messageInput.value; // 이동 직전 초안 보관
    }
    activeChannel = channelId; // 문자열 채널 식별자 유지
    const channel = channels[channelId]; // 선택한 채널 자료
    byId("channel-title").textContent = channel.title; // 실제 채널 이름
    byId("channel-description").textContent = channel.serverName; // 실제 소속 서버 이름
    byId("welcome-title").textContent = `# ${channel.title}에 오신 것을 환영해요`; // 채널 시작 안내
    byId("welcome-description").textContent = "이 화면에서 저장에 성공한 메시지를 표시합니다. 이전 대화 조회·자동 갱신은 다음 단계입니다."; // 구현 범위 안내
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
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 선택 후 대화 화면 복귀
    }
}
async function expireMessageSession() // 보호된 메시지 기능의 세션 만료 처리
{
    authGeneration += 1; // 이전 계정의 응답 무효화
    sessionNotice = "세션 만료 · 다시 로그인하세요"; // 확인된 인증 만료 안내
    clearSessionView(true); // 미전송 초안만 같은 계정 복원용 보관
    await refreshCsrf().catch(ignoreConnectionFailure); // 새 세션의 보호 정보 준비
    if (!authInitializing && !authBusy) // 인증 화면 표시 가능한 상태
    {
        openAuth(); // 실제 로그인 화면 열기
        showAuthError("세션이 만료되었습니다. 다시 로그인하세요."); // 만료 이유 안내
    }
}
async function loadChannels() // 로그인 사용자의 실제 소속 채널 조회
{
    if (!currentUser) // 인증되지 않은 사용자 여부
    {
        return; // 게스트 조회 중단
    }
    const generation = authGeneration; // 요청 당시 계정 상태
    const userId = currentUser.id; // 요청 당시 사용자 식별자
    const version = ++channelLoadVersion; // 최신 조회 식별 번호
    channelLoading = true; // 실제 조회 진행 상태
    channelError = ""; // 이전 오류 초기화
    renderChannels(); // 조회 중 목록 안내
    updateComposer(); // 조회 중 전송 차단
    try // 실제 소속 채널과 응답 계약 확인
    {
        const data = await requestEndpoint("/api/get_channels.php"); // 쿼리 없는 실제 조회 요청
        if (generation !== authGeneration || version !== channelLoadVersion || currentUser?.id !== userId) // 늦은 이전 계정 응답 여부
        {
            return; // 이전 계정 목록 적용 중단
        }
        if (!Array.isArray(data.channels) || data.channels.some((item) => !item || !validId(item.id) || !validId(item.server_id) || typeof item.name !== "string" || !item.name || typeof item.server_name !== "string" || !item.server_name) || new Set(data.channels.map((item) => item.id)).size !== data.channels.length) // 실제 채널 계약 검사
        {
            throw requestError("참여 채널 정보를 확인하지 못했습니다. 채널 목록을 다시 확인하세요."); // 미확인 식별자 사용 차단
        }
        const nextChannels = Object.create(null); // 새로 확인한 소속 채널
        data.channels.forEach((item) => // 실제 응답 순서대로 채널 준비
        {
            const previous = channels[item.id]; // 같은 계정의 기존 채널 자료
            const recovered = savedDrafts?.userId === userId ? savedDrafts.values[item.id] || "" : ""; // 같은 계정의 만료 전 초안
            nextChannels[item.id] = { title: item.name, serverName: item.server_name, messages: previous?.messages || [], draft: previous?.draft || recovered, scroll: previous?.scroll ?? null, unread: previous?.unread || 0, feedback: previous?.feedback || "", error: previous?.error || false }; // 확인된 채널과 현재 화면 자료
        }); // 소속 채널 준비 끝
        savedDrafts = null; // 확인 후 만료 전 초안 참조 제거
        channels = nextChannels; // 확인한 소속 채널만 유지
        channelLoading = false; // 채널 조회 완료
        const selected = channels[activeChannel] ? activeChannel : data.channels[0]?.id || null; // 실제 응답의 첫 채널 선택
        activeChannel = null; // 이전 선택의 초안 덮어쓰기 방지
        if (selected) // 참여 채널 존재 여부
        {
            selectChannel(selected); // 실제 채널 화면 표시
        }
        else // 참여 중인 채널 없는 사용자
        {
            messageInput.value = ""; // 이전 채널 초안 표시 제거
            renderEmptyConversation(); // 정확한 미참여 안내
        }
    }
    catch (error) // 조회 오류와 인증 만료 처리
    {
        if (generation !== authGeneration || version !== channelLoadVersion) // 이미 교체된 조회 상태
        {
            return; // 이전 실패 응답 무시
        }
        if (error.status === 401) // 실제 로그인 만료 응답
        {
            await expireMessageSession(); // 계정 화면 정리와 로그인 안내
            return; // 만료 계정 조회 종료
        }
        channelError = "참여 채널을 확인하지 못했습니다. 채널 목록 다시 확인을 눌러주세요."; // 성공 추정 없는 실패 안내
    }
    finally // 최신 요청의 화면 상태 갱신
    {
        if (generation === authGeneration && version === channelLoadVersion) // 현재 계정의 마지막 조회 여부
        {
            channelLoading = false; // 조회 잠금 해제
            renderChannels(); // 재시도 버튼과 결과 표시
            updateComposer(); // 실제 입력 가능 상태 갱신
        }
    }
}
async function sendMessage(event) // 실제 데이터베이스 메시지 저장
{
    event.preventDefault(); // 기본 폼 페이지 이동 차단
    updateComposer(); // 최신 입력과 계정 상태 검사
    if (byId("send-button").disabled) // 입력 오류 또는 중복 요청 여부
    {
        return; // 전송 불가능한 요청 중단
    }
    const channelId = activeChannel; // 제출한 실제 채널 식별자
    const channel = channels[channelId]; // 응답을 적용할 채널 자료
    const request = { generation: authGeneration, userId: currentUser.id, content: messageInput.value }; // 제출 당시 계정과 원문
    sendRequest = request; // 중복 전송 잠금
    channel.feedback = "메시지를 저장하는 중입니다."; // 실제 요청 진행 안내
    channel.error = false; // 이전 실패 상태 제거
    updateComposer(); // 전송 버튼과 접근성 상태 갱신
    try // 실제 저장 성공 응답 확인
    {
        const data = await requestEndpoint("/api/send_message.php", { channel_id: channelId, content: request.content }); // 최신 보호 토큰과 원문 전송
        if (request.generation !== authGeneration || currentUser?.id !== request.userId || channels[channelId] !== channel) // 계정이나 채널 자료 교체 여부
        {
            return; // 이전 계정의 늦은 성공 무시
        }
        const result = data.message; // 실제 저장된 메시지 객체
        if (!result || !validId(result.id) || result.channel_id !== channelId || result.user_id !== request.userId || typeof result.username !== "string" || !result.username || result.content !== request.content || typeof result.created_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result.created_at) || Number.isNaN(Date.parse(result.created_at))) // 저장 응답의 계약과 원문 확인
        {
            throw requestError("저장 응답을 확인하지 못했습니다."); // 불완전한 성공 응답 거절
        }
        const keepBottom = activeChannel === channelId && nearBottom(); // 현재 표시 중인 하단 여부
        const message = { id: result.id, name: result.username, timestamp: result.created_at, text: result.content }; // 확인된 응답만 화면 자료로 변환
        if (!channel.messages.some((item) => item.id === message.id)) // 같은 성공 응답의 중복 표시 방지
        {
            channel.messages.push(message); // 원래 채널에만 저장 결과 추가
        }
        if (channel.draft === request.content) // 제출 이후 수정하지 않은 초안 여부
        {
            channel.draft = ""; // 확정된 제출 초안만 제거
            if (activeChannel === channelId && messageInput.value === request.content) // 현재 화면도 같은 초안 여부
            {
                messageInput.value = ""; // 사용자가 새로 작성한 내용 보호
            }
        }
        channel.feedback = "메시지가 저장되었습니다. 새로고침 후에도 DB에 남습니다."; // 확인된 저장 결과 안내
        channel.error = false; // 성공 상태 복원
        if (activeChannel === channelId) // 제출한 채널이 현재 화면인 경우
        {
            messages.replaceChildren(...channel.messages.map(createMessage)); // 확인한 원래 채널 메시지 출력
            if (keepBottom) // 기존 대화 하단을 읽던 경우
            {
                scrollToBottom(); // 저장한 메시지 위치 표시
            }
            else // 이전 대화를 읽던 경우
            {
                channel.unread += 1; // 하단 새 메시지 집계
            }
        }
        else // 응답 도착 전에 채널을 이동한 경우
        {
            channel.unread += 1; // 원래 채널의 새 메시지 수
        }
    }
    catch (error) // 저장 실패와 불확실한 결과 처리
    {
        if (request.generation !== authGeneration || currentUser?.id !== request.userId || channels[channelId] !== channel) // 이전 계정 요청 여부
        {
            return; // 이전 실패가 현재 계정을 변경하지 않도록 중단
        }
        if (error.status === 401) // 실제 인증 만료 응답
        {
            await expireMessageSession(); // 초안 보관과 인증 화면 전환
            return; // 만료 계정 처리 종료
        }
        if (error.code === "CSRF_INVALID") // 보호 토큰 불일치 응답
        {
            try // 다음 수동 제출용 보호 정보 확인
            {
                await refreshCsrf(request.generation); // 자동 전송 없는 최신 토큰 조회
                channel.feedback = "화면 보호 정보를 갱신했습니다. 초안을 확인하고 다시 전송하세요."; // 명시적 사용자 재제출 안내
            }
            catch // 보호 정보 복구 실패
            {
                channel.feedback = "화면 보호 정보를 갱신하지 못했습니다. 다시 로그인하세요."; // 복구 실패 안내
            }
        }
        else // 저장 거절 또는 통신 결과 미확인
        {
            channel.feedback = error.status === 403 ? "이 채널에 메시지를 보낼 권한이 없습니다. 참여 상태를 확인하세요." : error.status === 404 ? "채널을 찾을 수 없습니다. 채널 목록을 다시 확인하세요." : error.status === 0 ? "저장 결과를 확인하지 못했습니다. 이미 저장되었을 수 있습니다. 다시 전송하면 중복 저장될 수 있으니 주의하세요. 자동 재전송은 하지 않습니다." : error.message; // 실제 실패 종류별 안내
        }
        if (error.status === 404 || error.code === "FORBIDDEN") // 사라졌거나 참여 상태가 바뀐 채널
        {
            channelError = channel.feedback; // 목록 재확인이 필요한 실제 오류
            renderChannels(); // 채널 목록 재시도 버튼 표시
        }
        channel.error = true; // 초안을 유지한 실패 표시
    }
    finally // 현재 요청 잠금과 화면 정리
    {
        if (sendRequest === request) // 현재 계정의 동일 요청 여부
        {
            sendRequest = null; // 전송 중복 잠금 해제
            updateComposer(); // 남아 있는 초안과 상태 갱신
            showNewMessages(); // 현재 채널 새 메시지 안내
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
        const retry = byId("retry-channels"); // 실제 목록 복구 버튼
        const target = document.querySelector(".channel-button.active") || (!retry.hidden && !retry.disabled ? retry : !byId("open-auth").disabled ? byId("open-auth") : byId("channel-sidebar")); // 빈 목록에서도 보이는 포커스 대상
        target.focus(); // 사용 가능한 목록 요소로 포커스 이동
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
        const length = Array.from(passwordInput.value).length; // 비밀번호 코드 포인트 수
        const bytes = new TextEncoder().encode(passwordInput.value).length; // 비밀번호 UTF-8 바이트 수
        if (length < 12 || length > 64 || bytes > 72 || passwordInput.value.includes("\u0000")) // 공통 비밀번호 제한 확인
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
    const username = byId("auth-username"); // 가입 사용자명 입력
    const email = byId("auth-email"); // 공통 이메일 입력
    username.value = username.value.trim().toLowerCase(); // 사용자명 공백 제거와 소문자 정규화
    email.value = email.value.trim().toLowerCase(); // 이메일 공백 제거와 소문자 정규화
    if (authMode === "register" && !/^[a-z0-9_]{3,32}$/.test(username.value)) // 사용자명 허용 범위 확인
    {
        username.setCustomValidity("사용자명은 영문·숫자·밑줄 3~32자로 입력하세요."); // 사용자명 입력 규칙 안내
    }
    if (email.value.length > 254 || /[^\x00-\x7F]/.test(email.value)) // 이메일 ASCII와 길이 확인
    {
        email.setCustomValidity("이메일은 영문 주소 기준 최대 254자로 입력하세요."); // 계약에 맞는 이메일 제한 안내
    }
    validatePassword(); // 원문 비밀번호 글자 수와 바이트 검사
    return authForm.reportValidity(); // 첫 오류 안내와 최종 입력 확인
}
function renderAuthState() // 실제 사용자 상태 표시
{
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
function validUser(user) // 실제 사용자 응답 기본 검사
{
    return user && validId(user.id) && typeof user.username === "string" && user.username.length > 0; // 렌더링에 필요한 사용자 자료 검사
}
function requestError(message, status = 0, code = "", fields = {}, retryAfter = null) // 안전한 요청 오류 생성
{
    const error = new Error(message); // 사용자 안내 오류 객체
    Object.assign(error, { status, code, fields, retryAfter }); // HTTP 상태와 계약 오류 정보 보관
    return error; // 화면 처리용 오류 반환
}
function ignoreConnectionFailure() // 선택적 연결 확인 실패 처리
{
    return undefined; // 확인하지 못한 상태 유지
}
async function requestEndpoint(path, body = null) // 동일 출처 JSON API 요청
{
    const controller = new AbortController(); // 오래 걸리는 요청 취소 도구
    const timeout = window.setTimeout(() => controller.abort(), 15000); // 연결 확인 대기 시간 제한
    const headers = { Accept: "application/json" }; // JSON 응답 요청
    if (body !== null) // 실제 상태 변경 요청 여부
    {
        headers["Content-Type"] = "application/json"; // 표준 JSON 요청 형식
        headers["X-CSRF-Token"] = csrfToken; // 메모리의 최신 보호 토큰
    }
    try // 응답과 실패 정보 확인
    {
        const response = await fetch(path, { method: body === null ? "GET" : "POST", credentials: "same-origin", headers, body: body === null ? undefined : JSON.stringify(body), cache: "no-store", signal: controller.signal }); // 세션 쿠키를 사용한 실제 API 호출
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
    catch (error) // 통신 또는 계약 오류 처리
    {
        if (typeof error.status === "number") // 이미 확인한 API 오류 여부
        {
            throw error; // 서버 오류 정보 유지
        }
        throw requestError(body === null ? "연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요." : "응답을 확인하지 못했습니다. 처리되었을 수 있으니 계정 상태를 확인한 뒤 다시 시도하세요."); // 통신 실패의 불확실성 안내
    }
    finally // 요청 자원 정리
    {
        window.clearTimeout(timeout); // 완료한 요청의 대기 제한 제거
    }
}
async function refreshCsrf(generation = authGeneration) // 실제 세션 보호 토큰 재조회
{
    csrfToken = null; // 이전 토큰 사용 중단
    const data = await requestEndpoint("/api/csrf.php"); // 현재 세션의 보호 토큰 조회
    if (typeof data.csrf_token !== "string" || !/^[a-f0-9]{64}$/.test(data.csrf_token)) // 보호 토큰 계약 확인
    {
        throw requestError("화면 보호 정보를 확인하지 못했습니다. 다시 시도하세요."); // 유효하지 않은 토큰 거절
    }
    if (generation !== authGeneration) // 이전 세션의 토큰 응답 여부
    {
        return; // 이전 보호 정보 무시
    }
    csrfToken = data.csrf_token; // 브라우저 메모리에만 새 토큰 보관
    renderAuthState(); // 보호 준비 상태 갱신
}
function clearSessionView(preserveDrafts = false) // 종료된 계정 자료 정리
{
    savedDrafts = preserveDrafts && currentUser ? { userId: currentUser.id, values: Object.fromEntries(Object.entries(channels).map(([id, channel]) => [id, channel.draft])) } : null; // 같은 계정 재로그인용 초안
    currentUser = null; // 이전 사용자 제거
    csrfToken = null; // 이전 보호 정보 제거
    channelLoadVersion += 1; // 이전 채널 조회 무효화
    channelLoading = false; // 이전 채널 조회 상태 해제
    channelError = ""; // 이전 조회 오류 제거
    sendRequest = null; // 이전 계정의 전송 잠금 해제
    channels = Object.create(null); // 이전 계정 채널과 메시지 제거
    activeChannel = null; // 이전 채널 선택 제거
    messageInput.value = ""; // 이전 초안 표시 제거
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
        const data = await requestEndpoint("/api/get_current_user.php"); // 실제 로그인 세션 조회
        if (generation !== authGeneration) // 최신 인증 상태와 조회 순서 비교
        {
            return; // 이전 상태의 늦은 응답 무시
        }
        if (!validUser(data.user)) // 사용자 응답 자료 확인
        {
            throw requestError("사용자 정보를 확인하지 못했습니다."); // 잘못된 인증 자료 거절
        }
        currentUser = data.user; // 실제 사용자 자료 보관
        sessionNotice = "로그인됨"; // 소속 권한과 구분한 인증 상태
        await loadChannels(); // 확인된 사용자 소속 채널 조회
    }
    catch (error) // 비로그인과 연결 실패 구분
    {
        if (generation !== authGeneration) // 최신 인증 상태와 조회 순서 비교
        {
            return; // 이전 상태의 늦은 실패 무시
        }
        if (error.status === 401) // 실제 비로그인 확인
        {
            currentUser = null; // 미확인 사용자 정보 제거
            sessionNotice = "로그인 후 채널 이용 가능"; // 확인된 게스트 상태
            await refreshCsrf(); // 만료로 교체된 세션의 토큰 갱신
        }
        else // 통신 또는 응답 실패
        {
            sessionNotice = "세션 확인 필요"; // 인증 성공 추정 없는 상태
            throw error; // 호출 화면에 실패 전달
        }
    }
    renderAuthState(); // 확인된 세션 상태 출력
}
async function handleAuthFailure(error) // 실제 인증 실패 안내 구성
{
    if (error.code === "CSRF_INVALID") // 세션 보호 토큰 만료 또는 불일치
    {
        try // 새 보호 토큰 확인
        {
            await refreshCsrf(); // 사용자의 다음 요청을 위한 재발급
            return "화면 보호 정보를 갱신했습니다. 입력을 확인하고 다시 제출하세요."; // 자동 재전송 없는 명시적 안내
        }
        catch // 보호 토큰 재발급 실패
        {
            return "화면 보호 정보를 갱신하지 못했습니다. 연결을 확인하고 다시 시도하세요."; // 복구 실패 안내
        }
    }
    if (error.status === 429) // 실제 로그인 시도 제한
    {
        const seconds = /^\d+$/.test(error.retryAfter || "") ? Number(error.retryAfter) : null; // 유효한 재시도 대기 시간
        return seconds === null ? "로그인 시도가 많습니다. 잠시 후 다시 시도하세요." : `로그인 시도가 많습니다. ${seconds.toLocaleString("ko-KR")}초 후 다시 시도하세요.`; // 접근 가능한 제한 안내
    }
    return error.message; // 서버에서 확인한 일반 오류
}
async function submitAuth(event) // 실제 가입 또는 로그인 처리
{
    event.preventDefault(); // 기본 폼 이동 차단
    if (authBusy || authInitializing || !validateAuthForm()) // 중복 요청과 입력 오류 확인
    {
        return; // 처리할 수 없는 제출 중단
    }
    const mode = authMode; // 요청 시작 시 인증 유형 보관
    const body = { email: byId("auth-email").value, password: passwordInput.value }; // 실제 인증 입력 자료
    if (mode === "register") // 가입 요청 여부
    {
        body.username = byId("auth-username").value; // 가입용 정규화 사용자명 추가
    }
    authGeneration += 1; // 이전 세션 확인 응답 무효화
    setAuthBusy(true); // 요청 중 중복 입력과 화면 전환 차단
    byId("auth-feedback").textContent = mode === "register" ? "계정을 만드는 중입니다." : "로그인 정보를 확인하는 중입니다."; // 실제 진행 상태 안내
    let registrationEmail = null; // 성공 후 로그인 이메일 보관
    let loginSucceeded = false; // 실제 로그인 성공 여부
    let failure = null; // 잠금 해제 후 표시할 오류
    try // 보호 토큰과 실제 인증 응답 확인
    {
        if (!csrfToken) // 사용할 보호 토큰 존재 여부
        {
            await refreshCsrf(); // 다음 요청의 실제 보호 토큰 발급
        }
        const data = await requestEndpoint(`/api/${mode}.php`, body); // 실제 가입 또는 로그인 POST
        if (!validUser(data.user) || (mode === "login" && !/^[a-f0-9]{64}$/.test(data.csrf_token || ""))) // 성공 응답의 사용자와 새 토큰 확인
        {
            throw requestError("서버 응답을 확인하지 못했습니다. 계정 상태를 확인한 뒤 다시 시도하세요."); // 불완전한 응답의 성공 추정 방지
        }
        if (mode === "register") // 실제 가입 성공 여부
        {
            registrationEmail = body.email; // 별도 로그인을 위한 이메일 보관
        }
        else // 실제 로그인 성공
        {
            currentUser = data.user; // 실제 로그인한 사용자 보관
            csrfToken = data.csrf_token; // 로그인 후 교체된 보호 토큰 보관
            sessionNotice = "로그인됨"; // 실제 인증 성공 상태
            loginSucceeded = true; // 성공 응답 확인 표시
        }
    }
    catch (error) // 실제 인증 실패 또는 불확실한 응답
    {
        const message = await handleAuthFailure(error); // 토큰 복구 또는 시도 제한 안내
        failure = { message, fields: error.fields || {} }; // 잠금 해제 후 안전한 실패 표시 자료
        if (error.code === "ALREADY_AUTHENTICATED") // 다른 화면에서 이미 로그인한 세션
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
        body.password = ""; // 요청 자료의 비밀번호 참조 정리
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
    if (authBusy || authInitializing || sendRequest || !currentUser) // 중복 요청과 저장 진행 및 인증 상태 확인
    {
        return; // 처리할 수 없는 로그아웃 중단
    }
    authGeneration += 1; // 이전 사용자 조회 응답 무효화
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
        await requestEndpoint("/api/logout.php", {}); // 빈 JSON 객체로 실제 로그아웃
        sessionNotice = "로그아웃됨"; // 실제 세션 종료 안내
        clearSessionView(); // 이전 사용자와 대화 및 초안 제거
        await refreshCsrf().catch(ignoreConnectionFailure); // 새 게스트 세션 보호 토큰 발급 시도
    }
    catch (error) // 로그아웃 실패 또는 세션 만료
    {
        if (error.status === 401) // 서버에서 실제 세션 만료 확인
        {
            sessionNotice = "세션 만료 · 다시 로그인하세요"; // 다시 로그인할 상태 안내
            clearSessionView(); // 만료된 사용자 화면 자료 제거
            await refreshCsrf().catch(ignoreConnectionFailure); // 로그인 전 새 보호 토큰 발급 시도
            expired = true; // 로그인 화면 재표시 준비
        }
        else // 실제 종료를 확인하지 못한 경우
        {
            sessionNotice = await handleAuthFailure(error); // 사용자 상태 유지와 실제 실패 안내
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
}
async function checkConnections() // 최초 세션과 실제 연결 확인
{
    const generation = authGeneration; // 최초 확인 요청의 상태 번호
    await refreshCsrf().catch(ignoreConnectionFailure); // 병렬 조회 전 최초 세션 쿠키 발급 시도
    const health = requestEndpoint("/api/health.php").then((data) => // 독립적인 데이터베이스 상태 확인
    {
        databaseReady = data.status === "ok"; // 실제 연결 성공 여부 보관
        renderAuthState(); // 확인한 연결 상태 표시
    }).catch(ignoreConnectionFailure); // 연결 실패의 준비 완료 추정 방지
    try // 세션 쿠키 발급 후 인증 상태 확인
    {
        await restoreCurrentUser(generation); // 실제 현재 사용자 확인
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
byId("retry-channels").addEventListener("click", loadChannels); // 소속 채널 조회 재시도
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
messageInput.addEventListener("keydown", (event) => // 키보드 전송 처리
{
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) // 한글 조합 제외 단독 Enter
    {
        event.preventDefault(); // 기본 줄바꿈 차단
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
byId("sidebar-backdrop").addEventListener("click", () => setSidebar(false)); // 목록 바깥 클릭 닫기
mobileQuery.addEventListener("change", () => setSidebar(false)); // 화면 크기 변경 시 목록 정리
document.addEventListener("keydown", (event) => // 모바일 목록 키보드 제어
{
    if (!sidebarOpen || authDialog.open) // 목록 전용 제어 여부
    {
        return; // 다른 화면 키보드 처리 유지
    }
    if (event.key === "Escape") // 목록 닫기 키 여부
    {
        event.preventDefault(); // 기본 Escape 동작 차단
        setSidebar(false); // 모바일 목록 접기
    }
    if (event.key === "Tab") // 목록 포커스 순환 여부
    {
        const focusable = [...byId("channel-sidebar").querySelectorAll("button:not([hidden]):not(:disabled)")]; // 사용 가능한 목록 버튼
        const index = focusable.indexOf(document.activeElement); // 현재 목록 포커스 위치
        if (focusable.length === 0) // 초기 조회 중 사용할 버튼 없는 상태
        {
            event.preventDefault(); // 비활성 대화 영역으로 이동 차단
            byId("channel-sidebar").focus(); // 목록 영역 포커스 유지
            return; // 빈 목록 순환 종료
        }
        if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === focusable.length - 1)) // 목록 경계 이동 여부
        {
            event.preventDefault(); // 목록 바깥 포커스 이동 방지
            focusable[event.shiftKey ? focusable.length - 1 : 0].focus(); // 목록 안 첫쪽 또는 끝쪽 이동
        }
    }
}); // 모바일 목록 키보드 제어 끝
byId("open-auth").addEventListener("click", () => currentUser ? logout() : openAuth()); // 현재 인증 상태별 로그인과 로그아웃 연결
byId("close-auth").addEventListener("click", () => authDialog.close()); // 요청 대기 중 비활성화된 닫기 버튼 연결
byId("switch-auth").addEventListener("click", () => switchAuth(authMode === "login" ? "register" : "login")); // 인증 화면 전환 연결
authForm.addEventListener("input", (event) => // 수정한 필드의 이전 오류 정리
{
    const field = event.target.name; // 수정한 인증 입력 이름
    if (["username", "email", "password"].includes(field)) // 허용된 인증 필드 여부
    {
        event.target.setCustomValidity(""); // 수정 전 입력 오류 제거
        event.target.removeAttribute("aria-invalid"); // 수정 전 접근성 오류 상태 제거
        byId(`${field}-error`).textContent = ""; // 수정한 필드의 오류 문구 제거
    }
}); // 인증 입력 오류 정리 끝
authForm.addEventListener("submit", submitAuth); // 실제 가입과 로그인 제출 연결
authDialog.addEventListener("cancel", (event) => // 요청 중 Escape 닫기 제어
{
    if (authBusy) // 실제 요청 진행 여부
    {
        event.preventDefault(); // 응답 처리 전 모달 닫기 차단
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
authDialog.addEventListener("click", (event) => // 모달 바깥 클릭 처리
{
    const bounds = authDialog.getBoundingClientRect(); // 모달 실제 화면 위치
    if (!authBusy && event.target === authDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) // 요청 대기 외 모달 배경 클릭 여부
    {
        authDialog.close(); // 인증 화면 닫기
    }
}); // 모달 바깥 클릭 처리 끝
renderChannels(); // 실제 조회 전 빈 채널 목록
renderEmptyConversation(); // 로그인 필요 초기 화면
checkConnections(); // 실제 공통 API 상태 확인 시작
