# Generate Android release signing keystore (local only, never commit)
param(
  [string]$StoreDir = "D:\ciji\android\keystore",
  [string]$Alias = "ciji",
  [string]$StorePass = "",
  [string]$KeyPass = "",
  [int]$ValidityDays = 36500
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $StoreDir | Out-Null
$keystore = Join-Path $StoreDir "ciji-release.jks"
$props = Join-Path $StoreDir "keystore.properties"
$keytool = "D:\java\jdk-21\bin\keytool.exe"
if (-not (Test-Path $keytool)) { $keytool = "keytool" }

if (-not $StorePass) {
  $chars = 48..57 + 65..90 + 97..122
  $StorePass = -join ((1..24 | ForEach-Object { $chars | Get-Random | ForEach-Object { [char]$_ } }))
}
if (-not $KeyPass) { $KeyPass = $StorePass }

if (-not (Test-Path $keystore)) {
  & $keytool -genkeypair -v -keystore $keystore -alias $Alias -keyalg RSA -keysize 2048 -validity $ValidityDays -storepass $StorePass -keypass $KeyPass -dname "CN=Ciji, OU=Personal, O=Ciji, L=Earth, ST=NA, C=CN"
  Write-Host "Created keystore: $keystore"
} else {
  Write-Host "Keystore already exists: $keystore"
}

@(
  "storeFile=keystore/ciji-release.jks"
  "storePassword=$StorePass"
  "keyAlias=$Alias"
  "keyPassword=$KeyPass"
) | Set-Content -Path $props -Encoding ASCII

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore))
$b64Path = Join-Path $StoreDir "ciji-release.jks.base64.txt"
$b64 | Set-Content -Path $b64Path -Encoding ASCII

Write-Host ""
Write-Host "=== CRITICAL BACKUP (losing this key blocks future overwrite upgrades) ==="
Write-Host "Keystore : $keystore"
Write-Host "Alias    : $Alias"
Write-Host "Base64   : $b64Path"
Write-Host "props    : $props (contains passwords, do NOT commit)"
Write-Host ""
Write-Host "GitHub Secrets to set:"
Write-Host "  ANDROID_KEYSTORE_BASE64   <- content of $b64Path"
Write-Host "  ANDROID_KEYSTORE_ALIAS    = $Alias"
Write-Host "  ANDROID_KEYSTORE_PASSWORD = see storePassword in props"
Write-Host "  ANDROID_KEY_PASSWORD      = see keyPassword in props"
Write-Host ""
Write-Host "Copy the entire $StoreDir folder to offline backup (USB/cloud private)."
