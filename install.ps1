$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$apk = Join-Path $root "build\jarvis-debug.apk"
if (!(Test-Path $apk)) {
    & (Join-Path $root "build.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}

& adb shell am force-stop com.jarvis.app
& adb install --no-incremental -r $apk
if ($LASTEXITCODE -ne 0) { throw "Install failed. Confirm the install prompt on the phone and try again." }
& adb shell am start -n com.jarvis.app/.MainActivity
if ($LASTEXITCODE -ne 0) { throw "Launch failed." }
