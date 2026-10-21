---
# SystemMakers UI 생성 프롬프트

생성 방식: 기본 image_gen 도구. 각 화면을 신규 생성한 뒤 수정 도구로 채팅 화면의 채널 생성 버튼을 제거하고 인증 화면의 다크 테마를 맞췄다. 초기 생성본은 최종 산출물에 포함하지 않으며 [UI-DIRECTION.md](UI-DIRECTION.md)의 두 PNG가 선택된 최종 결과물이다.

---
## 채팅 화면 초기 생성

Use case: ui-mockup
Asset type: high fidelity desktop web chat UI concept for SystemMakers, landscape 16:10, front-on flat screenshot, single complete app viewport.
Primary request: Design a restrained, implementable Korean channel chat messenger for a small development team. Reference the familiar server rail, channel sidebar and chronological message list of Discord and the legible compact team conversations of Slack, but create an original SystemMakers interface without their logos. This is an MVP visual design, not a futuristic dashboard.
Composition: three columns: narrow 64px vertical workspace rail, 232px channel sidebar, spacious conversation panel. No floating phone, no device frame, no decorative outer presentation margin. Sharp text, realistic spacing, subtle 1px dividers, 8px corners, understated charcoal/navy background, warm off-white text, subdued teal accent on selected channel and send button. No neon, no gradients, no glassmorphism, no oversize cards.
Details: top workspace label "SystemMakers" and server name "팀 프로젝트". Server rail contains simple square initials SM and TM. Sidebar title "텍스트 채널" with # 일반 selected, # 개발, # 공지. Sidebar bottom signed-in account "siwoo" and unobtrusive "로그아웃". Main header "# 일반", description "팀의 소식을 나누는 공간". Small "이전 메시지" control above the conversation. Main message list uses compact circular initial avatars, usernames "minji", "siwoo", "jun", timestamps 11:30 and 11:32, short readable Korean messages: "안녕하세요!", "오늘 작업 내용을 공유해 주세요.", "DB 구조부터 정리하고 있어요.", "확인했습니다." A subtle day divider "2026년 10월 21일". Bottom multiline composer placeholder "# 일반에 메시지 보내기", small character count "0 / 2000", muted keyboard hint "Enter 전송 · Shift+Enter 줄바꿈" and solid teal button "전송". Add one small flat notice near the top of message area "새 메시지 2개" if needed for visual hierarchy, but avoid clutter.
Constraints: realistic frontend component layout, excellent Korean glyphs, all text coherent. Only account, server/channel selection, text messages, history loading and sign-out. No member-online list, live presence, voice/video, search, attachments, emoji reaction buttons, analytics, charts, billing, AI features, admin dashboards or settings pages. User content stays short. No SQL, PHP, CSRF, endpoint labels, implementation notes or developer debug strings visible. No watermark.

---
## 채팅 화면 최종 수정

Edit this SystemMakers chat UI screenshot with one change only: remove the small plus + icon at the right side of the '텍스트 채널' heading. This MVP does not implement channel creation. Keep every other layout, all Korean text, all message content, colors, screen dimensions, all avatars, spacing and controls exactly as the source. Do not redesign, crop, add elements or change text. Preserve original flat screenshot composition.

---
## 인증 화면 초기 생성

Use case: ui-mockup
Asset type: high fidelity authentication design board, two equal full-height desktop app panels side by side, landscape 16:10, for the same Korean SystemMakers messenger.
Primary request: show a simple sign-in screen on the left and sign-up screen on the right. Original visual identity in muted charcoal/navy, warm white and understated teal, inspired by clear contemporary messenger authentication forms. This is an implementable minimal web UI, not a marketing landing page.
Composition: two clearly separated flat artboards, each has a small top-left SystemMakers wordmark and a centered narrow form (360px), generous spacing and no complex illustrations. Label the two artboards unobtrusively "로그인" and "회원가입" in their upper margin. No device frames, no 3D, no photography, no gradients, no third panel.
Exact UI left: heading "다시 만나 반가워요", short line "팀의 대화를 이어가세요.", labeled email field "이메일" showing "siwoo@example.com", password field "비밀번호" with masked dots, full-width teal button "로그인", footer "계정이 없으신가요? 회원가입". Show a small accessible error text below the password field "이메일 또는 비밀번호를 확인하세요." with muted red accent, not a popup.
Exact UI right: heading "함께 시작해요", short line "새 계정을 만들어 대화에 참여하세요.", field labels "사용자명", "이메일", "비밀번호". Under username short helper "영문·숫자·밑줄 3~32자", under password helper "12~64자 · 최대 72바이트". Teal button "회원가입", footer "이미 계정이 있으신가요? 로그인". An understated small success inline notification at the bottom of this right artboard "가입이 완료됐어요. 로그인해 주세요." should be visibly a sample state, not cover the form.
Constraints: typography and component proportions must match the desktop chat concept. Excellent legible Korean. Only email/password login and username/email/password registration. No social login, password reset, remember-me, terms checkboxes, server creation, QR login, magic links, live user counts, product slogans, extra features or unsupported controls. No code, API paths, tokens, database content or watermarks.

---
## 인증 화면 최종 수정

Edit Image 1 (the SystemMakers two-panel login / sign-up board) to use the exact dark charcoal/navy UI theme of Image 2 (the chat screen), which is a style reference only. Preserve Image 1's two-panel composition, dimensions, Korean copy, field labels, form positions, buttons, field values, error state and small success-state sample. Change white artboard backgrounds to dark navy around #171e28 and input backgrounds to #242d3a, text to off-white, secondary text to muted slate, accent buttons to restrained teal matching Image 2, error to soft coral, success message to subdued dark teal. Replace the decorative diagonal capsule mark in each auth panel with a small rounded square labeled SM, matching the workspace icon of Image 2. No gradients, no glow, no new features, no layout changes, no extra icons, no watermark. Only output the edited authentication board, not the reference chat screen. Keep all Korean spelling crisp and correct.
