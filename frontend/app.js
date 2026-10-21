"use strict"; // 엄격한 자바스크립트 검사
const byId = (id) => document.getElementById(id); // 화면 요소 조회
const channels = // 채널별 독립 미리보기 자료
{
    general: { title: "일반", description: "팀의 소식을 나누는 공간", welcome: "모든 대화의 시작, # 일반", introduction: "안부부터 새로운 아이디어까지, 편하게 나눠보세요.", messages: [{ name: "minji", tone: "pink", time: "11:30", text: "안녕하세요! 👋 오늘도 함께 만들어봐요." }, { name: "siwoo", tone: "blue", time: "11:30", text: "오늘 작업 내용을 공유해 주세요." }, { name: "jun", tone: "orange", time: "11:32", text: "DB 구조부터 정리하고 있어요.\n정리되면 개발 채널에 공유할게요." }, { name: "minji", tone: "pink", time: "11:32", text: "확인했습니다. 차근차근 진행해봐요!" }], draft: "", scroll: null, unread: 0 }, // 일반 채널 예시 대화
    dev: { title: "개발", description: "구현 과정과 아이디어를 함께 나누는 공간", welcome: "함께 만드는 과정, # 개발", introduction: "작업 기록과 궁금한 점을 편하게 공유해보세요.", messages: [{ name: "jun", tone: "orange", time: "10:15", text: "메시지 테이블 구조를 정리하고 있어요." }, { name: "siwoo", tone: "blue", time: "10:18", text: "채널마다 대화가 잘 나뉘는지도 같이 확인해봐요." }, { name: "minji", tone: "pink", time: "10:24", text: "모바일 화면에서도 읽기 편한 간격으로 준비할게요." }], draft: "", scroll: null, unread: 0 }, // 개발 채널 예시 대화
    notices: { title: "공지", description: "팀에서 함께 확인할 소식을 모으는 공간", welcome: "놓치지 말아야 할 소식, # 공지", introduction: "팀의 일정과 중요한 안내를 이곳에서 확인하세요.", messages: [{ name: "siwoo", tone: "blue", time: "09:00", text: "이번 주에는 기본 채팅 화면과 공통 연결 처리를 준비합니다." }, { name: "minji", tone: "pink", time: "09:05", text: "지금 보이는 대화는 화면 확인용 예시입니다.\n직접 작성한 메시지는 새로고침하면 초기화됩니다." }], draft: "", scroll: null, unread: 0 } // 공지 채널 예시 대화
}; // 채널 자료 끝
const messageInput = byId("message-input"); // 메시지 작성 필드
const messageScroll = byId("message-scroll"); // 대화 스크롤 영역
const messages = byId("messages"); // 메시지 목록
const authDialog = byId("auth-dialog"); // 인증 대화상자
const authForm = byId("auth-form"); // 인증 미리보기 폼
const passwordInput = byId("auth-password"); // 비밀번호 입력 필드
const mobileQuery = window.matchMedia("(max-width: 760px)"); // 모바일 화면 판별
let activeChannel = "general"; // 선택한 채널
let authMode = "login"; // 현재 인증 화면 유형
let currentUser = null; // 실제 확인된 사용자
let csrfToken = null; // 메모리에만 유지하는 보호 토큰
let sidebarOpen = false; // 모바일 목록 열림 상태
let lastAuthTrigger = null; // 인증 화면 이전 포커스
function nearBottom() // 대화 하단 여부 확인
{
    return messageScroll.scrollHeight - messageScroll.clientHeight - messageScroll.scrollTop < 45; // 하단 근처 거리 판별
}
function showNewMessages() // 새 메시지 안내 갱신
{
    const unread = channels[activeChannel].unread; // 현재 채널 새 메시지 수
    byId("new-messages").hidden = unread === 0; // 새 메시지 안내 표시 여부
    byId("new-messages").textContent = `새 메시지 ${unread}개 보기 ↓`; // 안내 문구 안전한 출력
}
function scrollToBottom() // 대화 하단 이동
{
    messageScroll.scrollTop = messageScroll.scrollHeight; // 하단 스크롤 위치 설정
    channels[activeChannel].unread = 0; // 현재 채널 새 메시지 수 초기화
    showNewMessages(); // 안내 갱신
}
function createMessage(message) // 안전한 메시지 요소 생성
{
    const article = document.createElement("article"); // 개별 메시지 묶음
    article.className = "message"; // 메시지 배치 스타일
    const avatar = document.createElement("div"); // 이니셜 아바타 생성
    avatar.className = `avatar avatar-${message.tone}`; // 내부 자료의 아바타 색상
    avatar.setAttribute("aria-hidden", "true"); // 장식 이니셜 중복 읽기 방지
    avatar.textContent = Array.from(message.name)[0].toUpperCase(); // 작성자 첫 글자 안전한 출력
    const content = document.createElement("div"); // 본문 영역 생성
    content.className = "message-content"; // 본문 영역 스타일
    const meta = document.createElement("div"); // 작성 정보 영역
    meta.className = "message-meta"; // 작성 정보 스타일
    const name = document.createElement("strong"); // 작성자 이름 요소
    name.textContent = message.name; // 사용자명 안전한 출력
    const time = document.createElement("time"); // 작성 시각 요소
    time.textContent = message.time; // 시각 안전한 출력
    if (message.timestamp) // 실제 미리보기 작성 시각 여부
    {
        time.dateTime = message.timestamp; // 기계 판독용 작성 시각
    }
    meta.append(name, time); // 작성자와 시각 배치
    if (message.local) // 직접 작성한 미리보기 메시지 여부
    {
        const label = document.createElement("span"); // 미리보기 배지 생성
        label.className = "local-label"; // 미리보기 배지 스타일
        label.textContent = "미리보기"; // 미리보기 메시지 구분
        meta.append(label); // 작성 정보 뒤 배지 추가
    }
    const body = document.createElement("p"); // 메시지 본문 생성
    body.className = "message-body"; // 메시지 본문 스타일
    body.textContent = message.text; // HTML 실행 없는 사용자 본문 출력
    content.append(meta, body); // 작성 정보와 본문 배치
    article.append(avatar, content); // 아바타와 본문 배치
    return article; // 완성한 메시지 반환
}
function updateComposer() // 입력 수와 전송 상태 갱신
{
    const count = Array.from(messageInput.value).length; // 유니코드 코드 포인트 수
    const hasText = /[^\p{White_Space}\uFEFF]/u.test(messageInput.value); // 공백 외 글자 존재 여부
    const containsNull = messageInput.value.includes("\u0000"); // 지원하지 않는 빈 문자 확인
    byId("message-count").textContent = `${count.toLocaleString("ko-KR")} / 2,000`; // 현재 글자 수 출력
    byId("message-count").classList.toggle("over-limit", count > 2000); // 제한 초과 색상 표시
    byId("send-button").disabled = !hasText || count > 2000 || containsNull; // 유효한 메시지만 전송 가능
    messageInput.setAttribute("aria-invalid", String(count > 2000 || containsNull)); // 입력 제한 오류 접근성 표시
    channels[activeChannel].draft = messageInput.value; // 채널별 임시 초안 유지
    byId("composer-feedback").classList.toggle("error", count > 2000 || containsNull); // 오류 안내 색상 갱신
    byId("composer-feedback").textContent = containsNull ? "지원하지 않는 빈 문자를 제거하세요." : count > 2000 ? "메시지는 2,000자까지 입력할 수 있습니다." : "작성한 메시지는 이 화면에서만 표시됩니다."; // 입력 상태 안내
}
function selectChannel(channelId) // 채널 전환
{
    if (!channels[channelId]) // 허용된 채널 확인
    {
        return; // 알 수 없는 채널 무시
    }
    channels[activeChannel].scroll = messageScroll.scrollTop; // 이전 채널 읽는 위치 보관
    activeChannel = channelId; // 현재 채널 변경
    const channel = channels[channelId]; // 선택한 채널 자료
    byId("channel-title").textContent = channel.title; // 채널 제목 출력
    byId("channel-description").textContent = channel.description; // 채널 설명 출력
    byId("welcome-title").textContent = channel.welcome; // 채널 시작 제목 출력
    byId("welcome-description").textContent = channel.introduction; // 채널 소개 출력
    byId("message-label").textContent = `${channel.title} 채널 메시지`; // 입력 필드 레이블 변경
    messageInput.placeholder = `# ${channel.title}에 메시지 보내기`; // 채널별 작성 안내
    messageInput.value = channel.draft; // 선택한 채널 초안 복원
    messages.replaceChildren(...channel.messages.map(createMessage)); // 선택한 채널 대화 출력
    document.querySelectorAll("[data-channel]").forEach((button) => // 채널 버튼 선택 상태 갱신
    {
        const selected = button.dataset.channel === channelId; // 현재 채널 버튼 여부
        button.classList.toggle("active", selected); // 시각적 선택 표시
        button.setAttribute("aria-pressed", String(selected)); // 접근성 선택 상태 표시
    }); // 채널 버튼 갱신 끝
    updateComposer(); // 초안 글자 수 갱신
    messageScroll.scrollTop = channel.scroll === null ? messageScroll.scrollHeight : channel.scroll; // 채널 읽는 위치 복원
    if (nearBottom()) // 복원 위치 하단 여부
    {
        channel.unread = 0; // 이미 보이는 새 메시지 수 초기화
    }
    showNewMessages(); // 채널별 새 메시지 안내 갱신
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 채널 선택 후 목록 접기
    }
}
function sendMessage(event) // 로컬 미리보기 메시지 전송
{
    event.preventDefault(); // 실제 폼 전송 차단
    updateComposer(); // 최신 입력 유효성 확인
    if (byId("send-button").disabled) // 공백 또는 초과 입력 여부
    {
        return; // 유효하지 않은 메시지 중단
    }
    const keepBottom = nearBottom(); // 작성 전 읽는 위치 판별
    const now = new Date(); // 미리보기 작성 시각
    const message = { name: currentUser ? currentUser.username : "게스트", tone: "teal", time: now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }), timestamp: now.toISOString(), text: messageInput.value, local: true }; // 저장 없는 미리보기 자료
    channels[activeChannel].messages.push(message); // 현재 메모리 대화에 추가
    messages.append(createMessage(message)); // 안전한 새 메시지 출력
    messageInput.value = ""; // 전송한 초안 비우기
    updateComposer(); // 글자 수와 전송 상태 초기화
    byId("composer-feedback").textContent = "미리보기 메시지가 추가되었습니다. 새로고침하면 초기화됩니다."; // 실제 처리 범위 안내
    if (keepBottom) // 하단을 읽던 사용자 여부
    {
        scrollToBottom(); // 하단을 읽던 경우만 새 메시지 이동
    }
    else // 이전 대화를 읽던 경우
    {
        channels[activeChannel].unread += 1; // 화면 아래 새 메시지 집계
        showNewMessages(); // 이동 가능한 안내 표시
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
        document.querySelector(".channel-button.active").focus(); // 선택한 채널로 포커스 이동
    }
    else if (mobileQuery.matches) // 모바일 목록 닫기 여부
    {
        byId("sidebar-toggle").focus(); // 목록 열기 버튼으로 포커스 복원
    }
}
function switchAuth(mode) // 인증 화면 유형 전환
{
    authMode = mode; // 현재 인증 유형 변경
    const register = mode === "register"; // 가입 화면 여부
    authForm.reset(); // 이전 입력과 비밀번호 초기화
    passwordInput.setCustomValidity(""); // 이전 입력 오류 제거
    byId("username-field").hidden = !register; // 가입 사용자명 필드 표시
    byId("auth-username").required = register; // 가입 시 사용자명 필수
    byId("auth-username").disabled = !register; // 로그인에서 사용자명 검사 제외
    byId("password-help").hidden = false; // 공통 비밀번호 규칙 표시
    passwordInput.autocomplete = register ? "new-password" : "current-password"; // 화면별 비밀번호 입력 안내
    byId("auth-title").textContent = register ? "함께 시작해요" : "다시 만나 반가워요"; // 인증 제목 전환
    byId("auth-description").textContent = register ? "새 계정을 위한 화면을 미리 살펴보세요." : "팀의 대화를 이어가세요."; // 인증 설명 전환
    byId("auth-switch-prompt").textContent = register ? "이미 계정이 있으신가요?" : "계정이 없으신가요?"; // 전환 안내 문구
    byId("switch-auth").textContent = register ? "로그인" : "회원가입"; // 전환 버튼 문구
    byId("auth-feedback").textContent = ""; // 이전 입력 확인 안내 제거
    if (authDialog.open) // 열린 대화상자 여부
    {
        byId(register ? "auth-username" : "auth-email").focus(); // 새 화면 첫 필드 포커스
    }
}
function openAuth() // 인증 미리보기 열기
{
    lastAuthTrigger = byId("open-auth"); // 닫은 뒤 복원할 버튼
    if (sidebarOpen) // 모바일 목록 열림 여부
    {
        setSidebar(false); // 인증 화면 전에 목록 접기
    }
    switchAuth("login"); // 로그인 화면으로 시작
    authDialog.showModal(); // 기본 포커스 제한 대화상자 열기
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
async function readEndpoint(path) // 공통 읽기 전용 요청
{
    const response = await fetch(path, { method: "GET", credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" }); // 같은 출처 세션으로 실제 상태 확인
    if (response.status === 401) // 정상 비로그인 응답 여부
    {
        return { guest: true }; // 비로그인 상태 반환
    }
    if (!response.ok) // 실패 응답 여부
    {
        throw new Error("연결 확인 실패"); // 내부 정보 없는 요청 실패
    }
    const payload = await response.json(); // 서버 JSON 응답 읽기
    if (payload.success !== true || !payload.data) // 합의된 응답 구조 확인
    {
        throw new Error("응답 확인 필요"); // 예상 밖 응답 처리
    }
    return payload.data; // 실제 확인된 자료 반환
}
async function checkConnections() // 실제 공통 연결 상태 확인
{
    const [csrf] = await Promise.allSettled([readEndpoint("/api/csrf.php")]); // 첫 세션 쿠키와 보호 토큰 발급
    if (csrf.status === "fulfilled" && typeof csrf.value.csrf_token === "string") // 실제 보호 토큰 응답 여부
    {
        csrfToken = csrf.value.csrf_token; // 브라우저 메모리에만 토큰 보관
    }
    const [session, health] = await Promise.allSettled([readEndpoint("/api/get_current_user.php"), readEndpoint("/api/health.php")]); // 세션 쿠키 설정 이후 상태 확인
    if (session.status === "fulfilled" && session.value.guest) // 실제 비로그인 응답 확인
    {
        byId("current-user").textContent = "게스트"; // 비로그인 사용자 표시
        byId("session-state").textContent = "로그인 전 · 미리보기"; // 정상 게스트 상태 안내
    }
    else if (session.status === "fulfilled" && session.value.user && typeof session.value.user.username === "string" && session.value.user.username.length > 0) // 실제 세션 사용자 자료 여부
    {
        currentUser = session.value.user; // 실제 사용자 자료 보관
        byId("current-user").textContent = currentUser.username; // 실제 사용자명 안전한 출력
        byId("user-avatar").textContent = Array.from(currentUser.username)[0].toUpperCase(); // 실제 사용자 이니셜 출력
        byId("session-state").textContent = "세션 확인됨 · 미리보기"; // 확인한 세션 범위 안내
        byId("open-auth").hidden = true; // 확인한 세션의 로그인 버튼 숨김
    }
    else // 세션 상태 확인 실패
    {
        byId("session-state").textContent = "세션 확인 필요"; // 인증 성공 추정 없는 안내
    }
    const databaseReady = health.status === "fulfilled" && health.value.status === "ok"; // 실제 DB 연결 확인 결과
    const protectionReady = csrfToken !== null; // 보호 토큰 발급 확인 결과
    byId("connection-status").textContent = `${databaseReady ? "DB 연결 확인됨" : "DB 연결 확인 필요"} · ${protectionReady ? "화면 보호 준비됨" : "화면 보호 확인 필요"}`; // 제한된 실제 연결 범위 안내
}
document.querySelectorAll("[data-channel]").forEach((button) => button.addEventListener("click", () => selectChannel(button.dataset.channel))); // 채널 선택 연결
messageInput.addEventListener("input", updateComposer); // 입력 수 실시간 갱신
byId("message-form").addEventListener("submit", sendMessage); // 미리보기 전송 연결
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
        const focusable = [...byId("channel-sidebar").querySelectorAll("button:not([hidden])")]; // 사용 가능한 목록 버튼
        const index = focusable.indexOf(document.activeElement); // 현재 목록 포커스 위치
        if ((event.shiftKey && index === 0) || (!event.shiftKey && index === focusable.length - 1)) // 목록 경계 이동 여부
        {
            event.preventDefault(); // 목록 바깥 포커스 이동 방지
            focusable[event.shiftKey ? focusable.length - 1 : 0].focus(); // 목록 안 첫쪽 또는 끝쪽 이동
        }
    }
}); // 모바일 목록 키보드 제어 끝
byId("open-auth").addEventListener("click", openAuth); // 인증 화면 열기 연결
byId("close-auth").addEventListener("click", () => authDialog.close()); // 인증 화면 닫기 연결
byId("switch-auth").addEventListener("click", () => switchAuth(authMode === "login" ? "register" : "login")); // 인증 화면 전환 연결
passwordInput.addEventListener("input", validatePassword); // 가입 비밀번호 규칙 갱신
authForm.addEventListener("submit", (event) => // 전송 없는 인증 입력 확인
{
    event.preventDefault(); // 자격 증명 네트워크 전송 차단
    validatePassword(); // 현재 비밀번호 규칙 확인
    if (authForm.reportValidity()) // 실제 필드 유효성 확인
    {
        byId("auth-feedback").textContent = "입력 형식을 확인했습니다. 회원 기능 준비 중으로 로그인·가입은 진행되지 않습니다."; // 가짜 인증 성공 없는 결과 안내
        passwordInput.value = ""; // 확인한 비밀번호 즉시 제거
    }
}); // 인증 입력 확인 끝
authDialog.addEventListener("close", () => // 인증 화면 닫힌 뒤 정리
{
    authForm.reset(); // 입력한 자격 증명 제거
    passwordInput.setCustomValidity(""); // 입력 오류 상태 제거
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
    if (event.target === authDialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) // 모달 외부 배경 클릭 여부
    {
        authDialog.close(); // 인증 화면 닫기
    }
}); // 모달 바깥 클릭 처리 끝
selectChannel("general"); // 첫 일반 채널 출력
checkConnections(); // 실제 공통 API 상태 확인 시작
