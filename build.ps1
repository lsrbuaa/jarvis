$ErrorActionPreference = "Stop"

$sdk = $env:ANDROID_SDK_ROOT
if ([string]::IsNullOrWhiteSpace($sdk)) { $sdk = $env:ANDROID_HOME }
if ([string]::IsNullOrWhiteSpace($sdk)) { $sdk = "F:\Android\sdk" }

$buildTools = Join-Path $sdk "build-tools\35.0.0"
$androidJar = Join-Path $sdk "platforms\android-35\android.jar"
$aapt2 = Join-Path $buildTools "aapt2.exe"
$d8 = Join-Path $buildTools "d8.bat"
$zipalign = Join-Path $buildTools "zipalign.exe"
$apksigner = Join-Path $buildTools "apksigner.bat"

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner, $androidJar)) {
    if (!(Test-Path $tool)) { throw "Missing Android build tool: $tool" }
}

function Run-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $root "build"
$compiled = Join-Path $build "compiled"
$generated = Join-Path $build "generated"
$classes = Join-Path $build "classes"
$dex = Join-Path $build "dex"
$classesJar = Join-Path $build "classes.jar"
$unsigned = Join-Path $build "jarvis-unsigned.apk"
$aligned = Join-Path $build "jarvis-aligned.apk"
$signed = Join-Path $build "jarvis-debug.apk"
$keystore = Join-Path $root "debug.keystore"

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $build
New-Item -ItemType Directory -Force -Path $compiled, $generated, $classes, $dex | Out-Null

Run-Checked $aapt2 @("compile", "--dir", (Join-Path $root "src\main\res"), "-o", (Join-Path $compiled "res.zip"))
Run-Checked $aapt2 @(
    "link",
    "-o", $unsigned,
    "-I", $androidJar,
    "--manifest", (Join-Path $root "AndroidManifest.xml"),
    "-R", (Join-Path $compiled "res.zip"),
    "--java", $generated,
    "-A", (Join-Path $root "src\main\assets"),
    "--auto-add-overlay"
)

$javaFiles = Get-ChildItem -Path (Join-Path $root "src\main\java"), $generated -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$javacArgs = @("-encoding", "UTF-8", "-source", "8", "-target", "8", "-classpath", "$androidJar;$generated", "-d", $classes) + $javaFiles
Run-Checked "javac" $javacArgs
Run-Checked "jar" @("cf", $classesJar, "-C", $classes, ".")
Run-Checked $d8 @("--lib", $androidJar, "--output", $dex, $classesJar)

Push-Location $dex
Run-Checked "jar" @("uf", $unsigned, "classes.dex")
Pop-Location

Run-Checked $zipalign @("-p", "4", $unsigned, $aligned)

if (!(Test-Path $keystore)) {
    Run-Checked "keytool" @(
        "-genkeypair",
        "-keystore", $keystore,
        "-storepass", "android",
        "-alias", "androiddebugkey",
        "-keypass", "android",
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=Android Debug,O=Jarvis,C=US"
    )
}

Run-Checked $apksigner @(
    "sign",
    "--ks", $keystore,
    "--ks-pass", "pass:android",
    "--key-pass", "pass:android",
    "--ks-key-alias", "androiddebugkey",
    "--out", $signed,
    $aligned
)

Run-Checked $apksigner @("verify", $signed)
Write-Host "Built $signed"
