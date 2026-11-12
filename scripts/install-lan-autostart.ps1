$ErrorActionPreference = 'Stop' # 설정 오류 즉시 중단
$taskName = 'SystemMakers-LAN' # 사용자 로그인 작업 이름
$watchPath = Join-Path $PSScriptRoot 'watch-lan.ps1' # 서버 감시기 경로
$powerShellPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe' # Windows 기본 PowerShell
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name # 현재 로그인 계정
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) # 기존 이름 사용 여부
{
    throw '같은 이름의 예약 작업이 이미 있습니다. 기존 설정을 확인하세요.' # 다른 작업 덮어쓰기 방지
}
$taskArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchPath`"" # 감시기 실행 인수
$taskAction = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArguments # 숨김 감시기 실행
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser # 현재 사용자 로그인 시 시작
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited # 현재 사용자 권한
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) # 장시간 실행과 오류 복구
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'SystemMakers 같은 Wi-Fi 개발 서버 감시' | Out-Null # 사용자 자동 실행 등록
Start-ScheduledTask -TaskName $taskName # 현재 로그인에서도 즉시 시작
Write-Output 'SystemMakers-LAN 자동 실행을 등록했습니다.' # 등록 완료 안내
