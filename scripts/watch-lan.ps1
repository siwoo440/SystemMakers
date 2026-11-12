param # 감시기 실행 옵션
(
    [int]$intervalSeconds = 15 # 상태 확인 간격
)
$ErrorActionPreference = 'Stop' # 준비 실패 즉시 중단
$projectRoot = Split-Path -Parent $PSScriptRoot # 프로젝트 기준 폴더
. (Join-Path $PSScriptRoot 'lan-supervisor-utils.ps1') # 와이파이와 포트 검사 함수
$runtimeDirectory = Join-Path $projectRoot '.runtime' # 개인 실행 폴더
$localSettings = Join-Path $runtimeDirectory 'web-env.json' # 개인 DB 설정
$phpPath = Join-Path $runtimeDirectory 'php83/php.exe' # 프로젝트 PHP 실행 파일
$phpIni = Join-Path $runtimeDirectory 'php83.ini' # 프로젝트 PHP 설정
$mysqlPath = Join-Path $runtimeDirectory 'mysql/mysql-8.4.13-winx64/bin/mysqld.exe' # 프로젝트 MySQL 실행 파일
$mysqlData = Join-Path $runtimeDirectory 'mysql-data' # 기존 DB 자료 폴더
$routerPath = Join-Path $projectRoot 'router.php' # 웹 공개 경로 라우터
$realtimePath = Join-Path $projectRoot 'backend/realtime/server.php' # 실시간 서버 진입점
$statusPath = Join-Path $runtimeDirectory 'lan-status.json' # 개인 접속 상태 기록
if ($intervalSeconds -lt 5 -or -not (Test-Path -LiteralPath $localSettings) -or -not (Test-Path -LiteralPath $phpPath) -or -not (Test-Path -LiteralPath $phpIni)) # 필수 실행 조건
{
    throw '개인 DB 설정과 PHP 실행 환경을 확인하세요.' # 준비 누락 안내
}
$settings = Get-Content -LiteralPath $localSettings -Raw -Encoding UTF8 | ConvertFrom-Json # 개인 환경 읽기
foreach ($setting in $settings.PSObject.Properties) # DB와 세션 환경 설정
{
    [Environment]::SetEnvironmentVariable($setting.Name, [string]$setting.Value, 'Process') # 자식 프로세스 전달
}
$singleInstance = [Threading.Mutex]::new($false, 'Local\SystemMakersLanWatchdog') # 사용자 세션 중복 방지
try # 단일 감시기 확보
{
    $hasMutex = $singleInstance.WaitOne(0) # 중복 실행 확인
}
catch [Threading.AbandonedMutexException] # 비정상 종료 뒤 소유권 복구
{
    $hasMutex = $true # 이전 감시기 종료 확인
}
if (-not $hasMutex) # 기존 감시기 존재
{
    $singleInstance.Dispose() # 중복 핸들 정리
    exit 0 # 두 번째 감시기 종료
}
$managedWeb = $null # 감시기가 실행한 웹 서버
$managedRealtime = $null # 감시기가 실행한 실시간 서버
$managedDatabase = $null # 감시기가 실행한 DB 서버
$activeAddress = $null # 이전 와이파이 주소
try # 상태 감시 시작
{
    while ($true) # 사용자가 로그인한 동안 반복
    {
        try # 일시적인 네트워크 오류 복구
        {
            $wifiAddress = Get-SystemMakersWifiAddress # 현재 사설 와이파이 주소
            if ($wifiAddress -and $wifiAddress -ne $activeAddress) # 새 주소 연결 확인
            {
                foreach ($managedProcess in @($managedWeb, $managedRealtime)) # 직접 실행한 이전 서버만 정리
                {
                    if ($null -ne $managedProcess -and -not $managedProcess.HasExited) # 감시기 소유 실행 상태
                    {
                        Stop-Process -Id $managedProcess.Id -ErrorAction SilentlyContinue # 이전 주소 서버 종료
                    }
                }
                $managedWeb = $null # 새 웹 서버 대기
                $managedRealtime = $null # 새 실시간 서버 대기
                $activeAddress = $wifiAddress # 새 주소 보관
            }
            $databaseReady = Test-SystemMakersListener -Address '127.0.0.1' -Port 33360 # 기존 DB 수신 검사
            if (-not $databaseReady -and ($null -eq $managedDatabase -or $managedDatabase.HasExited) -and $env:MYSQL_HOST -in @('127.0.0.1', 'localhost') -and $env:MYSQL_PORT -eq '33360' -and (Test-Path -LiteralPath $mysqlPath) -and (Test-Path -LiteralPath $mysqlData)) # 기존 로컬 DB만 복구
            {
                $mysqlArguments = @('--no-defaults', "--datadir=`"$mysqlData`"", '--bind-address=127.0.0.1', '--port=33360', '--mysqlx=0', '--console') # 기존 자료와 로컬 수신 설정
                $managedDatabase = Start-Process -FilePath $mysqlPath -ArgumentList $mysqlArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'lan-watch-mysql-out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'lan-watch-mysql-error.log') # 별도 DB 초기화 없는 실행
            }
            if ($wifiAddress -and $databaseReady) # 현재 와이파이와 DB 준비
            {
                if (-not (Test-SystemMakersListener -Address $wifiAddress -Port 8088)) # 웹 수신 종료 확인
                {
                    $env:REALTIME_PUBLIC_HOST = $wifiAddress # CSP의 실시간 호스트
                    $webArguments = @('-c', "`"$phpIni`"", '-d', 'upload_max_filesize=6M', '-d', 'post_max_size=7M', '-S', "${wifiAddress}:8088", '-t', "`"$projectRoot`"", "`"$routerPath`"") # 웹 실행 설정
                    $managedWeb = Start-Process -FilePath $phpPath -ArgumentList $webArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'lan-watch-web-out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'lan-watch-web-error.log') # 웹 서버 시작
                }
                if (-not (Test-SystemMakersListener -Address $wifiAddress -Port 8090)) # 실시간 수신 종료 확인
                {
                    $env:REALTIME_LISTEN_HOST = $wifiAddress # 실시간 수신 주소
                    $env:REALTIME_LISTEN_PORT = '8090' # 실시간 수신 포트
                    $env:REALTIME_ALLOWED_ORIGIN = "http://${wifiAddress}:8088" # 허용된 웹 출처
                    $env:REALTIME_ALLOW_LAN = '1' # 명시적 사설망 허용
                    $realtimeArguments = @('-c', "`"$phpIni`"", "`"$realtimePath`"") # 실시간 서버 실행 설정
                    $managedRealtime = Start-Process -FilePath $phpPath -ArgumentList $realtimeArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'lan-watch-realtime-out.log') -RedirectStandardError (Join-Path $runtimeDirectory 'lan-watch-realtime-error.log') # 실시간 서버 시작
                }
            }
            $siteUrl = $null # 연결 전 공유 주소
            if ($wifiAddress) # 와이파이 주소 존재
            {
                $siteUrl = "http://${wifiAddress}:8088/Team006/index.html" # 현재 공유 주소
            }
            $status = [ordered]@{ updatedAt = (Get-Date).ToString('o'); address = $wifiAddress; url = $siteUrl; databaseListening = $databaseReady } # 비밀 없는 상태
            $status | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8 # 사용자용 주소 기록
        }
        catch # 일시적 실행 실패 기록
        {
            "$(Get-Date -Format o) 서버 상태 확인 실패: $($_.Exception.Message)" | Add-Content -LiteralPath (Join-Path $runtimeDirectory 'lan-watch-error.log') -Encoding UTF8 # 재시도 진단
        }
        Start-Sleep -Seconds $intervalSeconds # 다음 상태 확인 대기
    }
}
finally # 감시기 종료 시 잠금 해제
{
    $singleInstance.ReleaseMutex() # 단일 실행 잠금 해제
    $singleInstance.Dispose() # 잠금 자원 정리
}
