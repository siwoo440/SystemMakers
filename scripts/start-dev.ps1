param # 개발 서버 인수
( # 인수 목록 시작
    [int]$port = 8088, # 로컬 웹 포트
    [string]$phpPath = '', # 별도 PHP 실행 경로
    [string]$phpIni = '', # PHP 8.3 실행 설정 경로
    [string]$webHost = '127.0.0.6' # 웹 서버 로컬 주소
) # 인수 목록 종료
$ErrorActionPreference = 'Stop' # 실행 오류 즉시 중단
$siteProjectRoot = Split-Path -Parent $PSScriptRoot # 저장소 루트 계산
$siteLocalSettings = Join-Path $siteProjectRoot '.runtime/web-env.json' # 개인 실행 설정 위치
if (Test-Path -LiteralPath $siteLocalSettings) # 개인 설정 존재 여부
{
    $siteConfiguration = Get-Content -LiteralPath $siteLocalSettings -Raw -Encoding UTF8 | ConvertFrom-Json # 개인 설정 읽기
    foreach ($siteProperty in $siteConfiguration.PSObject.Properties) # 실행 설정 순회
    {
        [Environment]::SetEnvironmentVariable($siteProperty.Name, [string]$siteProperty.Value, 'Process') # 현재 프로세스에만 적용
    }
}
if ([string]::IsNullOrWhiteSpace($phpPath)) # PHP 경로 자동 선택
{
    $phpPath = Join-Path $siteProjectRoot '.runtime/php83/php.exe' # 프로젝트 전용 PHP 8.3 선택
}
if (-not (Test-Path -LiteralPath $phpPath)) # 실행 도구 확인
{
    throw 'PHP 실행 경로를 -PhpPath 인수로 지정하세요.' # 누락된 도구 안내
}
if ($port -lt 1024 -or $port -gt 65535) # 웹 포트 범위 확인
{
    throw '웹 포트는 1024~65535 사이여야 합니다.' # 포트 입력 오류 안내
}
$webAddress = [Net.IPAddress]::None # 웹 주소 변환 결과
if (-not [Net.IPAddress]::TryParse($webHost, [ref]$webAddress) -or $webAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or -not [Net.IPAddress]::IsLoopback($webAddress)) # IPv4 로컬 주소 검사
{
    throw '웹 주소는 127.0.0.6과 같은 IPv4 루프백 주소여야 합니다.' # 외부 공개와 잘못된 주소 차단
}
$webHost = $webAddress.ToString() # 검사된 웹 주소 표준화
$sitePortProbe = [Net.Sockets.TcpListener]::new($webAddress, $port) # 실제 웹 주소의 포트 검사
try # 포트 사용 가능 여부 확인
{
    $sitePortProbe.Start() # 임시 포트 예약
}
catch [Net.Sockets.SocketException] # 포트 예약 오류 확인
{
    if ($_.Exception.SocketErrorCode -eq [Net.Sockets.SocketError]::AddressAlreadyInUse) # 기존 서버의 포트 점유
    {
        throw "포트 $port 사용 중입니다. -Port 인수로 다른 포트를 지정하세요." # 기존 서버 충돌 방지
    }
    throw # 다른 연결 오류 전달
}
finally # 포트 검사 종료
{
    $sitePortProbe.Stop() # 임시 예약 해제
}
$sitePhpArguments = @() # PHP 실행 옵션
$sitePhpIni = $phpIni # 전달받은 PHP 설정 경로
if ([string]::IsNullOrWhiteSpace($sitePhpIni)) # 별도 설정 미지정
{
    $sitePhpIni = Join-Path $siteProjectRoot '.runtime/php83.ini' # PHP 8.3 전용 설정 선택
}
if (Test-Path -LiteralPath $sitePhpIni) # 별도 PHP 설정 여부
{
    $sitePhpArguments += @('-c', $sitePhpIni) # MySQL 확장과 세션 설정 적용
}
$sitePhpArguments += @('-S', "${webHost}:$port", '-t', $siteProjectRoot, (Join-Path $siteProjectRoot 'router.php')) # 로컬 주소와 허용 목록 라우터
Write-Output "SystemMakers: http://${webHost}:$port/Team006/index.html" # 사용자 접속 주소
& $phpPath @sitePhpArguments # PHP 개발 서버 실행
exit $LASTEXITCODE # 서버 종료 상태 전달
