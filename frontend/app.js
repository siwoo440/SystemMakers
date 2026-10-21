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
const authForm = byId("auth-form"); // 실제 인증 요청 폼
const passwordInput = byId("auth-password"); // 비밀번호 입력 필드
const mobileQuery = window.matchMedia("(max-width: 760px)"); // 모바일 화면 판별
let activeChannel = "general"; // 선택한 채널
let authMode = "login"; // 현재 인증 화면 유형
let currentUser = null; // 실제 확인된 사용자
let csrfToken = null; // 메모리에만 유지하는 보호 토큰
let sidebarOpen = false; // 모바일 목록 열림 상태
let lastAuthTrigger = null; // 인증 화면 이전 포커스
let authBusy = false; // 인증 요청 진행 상태
let authInitializing = true; // 최초 세션 확인 진행 상태
let authGeneration = 0; // 이전 세션 응답 구분 번호
let sessionNotice = "세션 확인 중"; // 사용자 영역 상태 안내
let databaseReady = false; // 실제 데이터베이스 연결 확인 결과
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
    return user && typeof user.id === "string" && typeof user.username === "string" && user.username.length > 0; // 렌더링에 필요한 사용자 자료 검사
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
async function refreshCsrf() // 실제 세션 보호 토큰 재조회
{
    csrfToken = null; // 이전 토큰 사용 중단
    const data = await requestEndpoint("/api/csrf.php"); // 현재 세션의 보호 토큰 조회
    if (typeof data.csrf_token !== "string" || !/^[a-f0-9]{64}$/.test(data.csrf_token)) // 보호 토큰 계약 확인
    {
        throw requestError("화면 보호 정보를 확인하지 못했습니다. 다시 시도하세요."); // 유효하지 않은 토큰 거절
    }
    csrfToken = data.csrf_token; // 브라우저 메모리에만 새 토큰 보관
    renderAuthState(); // 보호 준비 상태 갱신
}
function clearSessionView() // 종료된 계정의 화면 자료 정리
{
    currentUser = null; // 사용자 정보 제거
    csrfToken = null; // 이전 세션 보호 토큰 제거
    Object.values(channels).forEach((channel) => // 채널별 미리보기 자료 순회
    {
        channel.messages = []; // 이전 계정의 화면 대화 제거
        channel.draft = ""; // 이전 계정의 초안 제거
        channel.scroll = null; // 이전 읽는 위치 제거
        channel.unread = 0; // 새 메시지 안내 초기화
    }); // 채널 자료 정리 끝
    authForm.reset(); // 남은 인증 입력 제거
    clearAuthErrors(); // 이전 인증 오류 제거
    selectChannel(activeChannel); // 비운 대화와 초안 표시
    renderAuthState(); // 게스트 사용자 상태 표시
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
        sessionNotice = "로그인됨 · 대화 미리보기"; // 확인된 로그인 안내
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
            sessionNotice = "로그인 전 · 대화 미리보기"; // 확인된 게스트 상태
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
            sessionNotice = "로그인됨 · 대화 미리보기"; // 실제 로그인 결과 안내
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
    }
    else if (failure) // 실제 실패 안내 존재 여부
    {
        showAuthError(failure.message, failure.fields); // 안전한 오류 출력과 포커스 이동
    }
}
async function logout() // 실제 로그인 세션 종료
{
    if (authBusy || authInitializing || !currentUser) // 중복 요청과 인증 상태 확인
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
        sessionNotice = "로그아웃됨 · 대화 미리보기"; // 실제 세션 종료 안내
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
    }
    await health; // 실제 데이터베이스 확인 종료 대기
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
selectChannel("general"); // 첫 일반 채널 출력
checkConnections(); // 실제 공통 API 상태 확인 시작
