param # 실시간 서버 실행 인수
(
    [string]$phpPath = '', # PHP 실행 파일 경로
    [string]$phpIni = '', # PHP 설정 파일 경로
    [string]$realtimeHost = '127.0.0.6', # 실시간 서버 주소
    [int]$webPort = 8088, # 웹 서버 포트
    [switch]$allowLan # 사설망 접속 명시 허용
)
$ErrorActionPreference = 'Stop' # 오류 발생 시 종료
$projectRoot = Split-Path -Parent $PSScriptRoot # 프로젝트 루트
$localSettings = Join-Path $projectRoot '.runtime/web-env.json' # 개인 환경 설정
if (Test-Path -LiteralPath $localSettings) # 개인 설정 존재 확인
{
    $configuration = Get-Content -LiteralPath $localSettings -Raw -Encoding UTF8 | ConvertFrom-Json # 설정 읽기
    foreach ($property in $configuration.PSObject.Properties) # 실행 환경 항목 순회
    {
        [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process') # 현재 프로세스에만 적용
    }
}
if ([string]::IsNullOrWhiteSpace($phpPath)) # 기본 PHP 선택
{
    $phpPath = Join-Path $projectRoot '.runtime/php83/php.exe' # PHP 8.3 실행 파일
}
if ([string]::IsNullOrWhiteSpace($phpIni)) # 기본 PHP 설정 선택
{
    $phpIni = Join-Path $projectRoot '.runtime/php83.ini' # PHP 8.3 설정 파일
}
if (-not (Test-Path -LiteralPath $phpPath) -or -not (Test-Path -LiteralPath $phpIni)) # 실행 도구와 설정 검사
{
    throw 'PHP 8.3 실행 파일과 설정을 준비하세요.' # 누락 설정 안내
}
$autoloadPath = Join-Path $projectRoot 'backend/realtime/vendor/autoload.php' # Composer 자동 로더
if (-not (Test-Path -LiteralPath $autoloadPath)) # 외부 라이브러리 설치 검사
{
    throw 'backend/realtime에서 Composer 의존성을 설치하세요.' # 설치 안내
}
$serverPath = Join-Path $projectRoot 'backend/realtime/server.php' # 실시간 서버 진입점
$realtimeAddress = [Net.IPAddress]::None # 주소 변환 결과
if (-not [Net.IPAddress]::TryParse($realtimeHost, [ref]$realtimeAddress) -or $realtimeAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $webPort -lt 1024 -or $webPort -gt 65535) # 주소와 웹 포트 확인
{
    throw '유효한 IPv4 주소와 웹 포트를 지정하세요.' # 잘못된 실행 설정 차단
}
$realtimeOctets = $realtimeAddress.GetAddressBytes() # IPv4 네트워크 구간
$realtimePrivate = $realtimeOctets[0] -eq 10 -or ($realtimeOctets[0] -eq 172 -and $realtimeOctets[1] -ge 16 -and $realtimeOctets[1] -le 31) -or ($realtimeOctets[0] -eq 192 -and $realtimeOctets[1] -eq 168) # 사설 주소 확인
if (-not [Net.IPAddress]::IsLoopback($realtimeAddress) -and (-not $allowLan -or -not $realtimePrivate)) # 명시적 사설망 허용 확인
{
    throw '사설 IPv4 주소는 -AllowLan 지정 시에만 사용할 수 있습니다.' # 공개 주소 차단
}
$realtimeHost = $realtimeAddress.ToString() # 검사된 주소 표준화
$env:REALTIME_LISTEN_HOST = $realtimeHost # 실시간 수신 주소
$env:REALTIME_LISTEN_PORT = '8090' # 실시간 포트
$env:REALTIME_ALLOWED_ORIGIN = "http://${realtimeHost}:$webPort" # 허용 웹 출처
$env:REALTIME_ALLOW_LAN = '0' # 기본 사설망 차단
if ($allowLan) # 사설망 허용 선택
{
    $env:REALTIME_ALLOW_LAN = '1' # 사설망 수신 허용
}
Write-Output "SystemMakers WebSocket: ws://${realtimeHost}:8090/Team006/realtime" # 실제 접속 경로
& $phpPath -c $phpIni $serverPath # PHP 8.3 실시간 서버 실행
exit $LASTEXITCODE # 서버 종료 상태 전달
