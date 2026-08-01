param(
  [Parameter(Mandatory = $true)][string]$ScoopDir,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$d = $ScoopDir
$app = Join-Path $d 'apps\scoop\current'
$bucket = Join-Path $d 'buckets\main'
$shims = Join-Path $d 'shims'
New-Item -Force -ItemType Directory -Path $app, $bucket, $shims | Out-Null

$scoopZip = Join-Path $d 'scoop.zip'
Invoke-WebRequest -Uri 'https://github.com/ScoopInstaller/Scoop/archive/master.zip' -OutFile $scoopZip -UseBasicParsing
Expand-Archive -Path $scoopZip -DestinationPath (Join-Path $d '_tmp1') -Force
Copy-Item (Join-Path $d '_tmp1\Scoop-*\*') $app -Recurse -Force

$mainZip = Join-Path $d 'main.zip'
Invoke-WebRequest -Uri 'https://github.com/ScoopInstaller/Main/archive/master.zip' -OutFile $mainZip -UseBasicParsing
Expand-Archive -Path $mainZip -DestinationPath (Join-Path $d '_tmp2') -Force
Copy-Item (Join-Path $d '_tmp2\Main-*\*') $bucket -Recurse -Force

$ps1 = Join-Path $app 'bin\scoop.ps1'
@(
  '# scoop shim',
  "`$path = Join-Path `$PSScriptRoot '..\apps\scoop\current\bin\scoop.ps1'",
  'if ($MyInvocation.ExpectingInput) { $input | & $path @args } else { & $path @args }',
  'exit $LASTEXITCODE'
) | Set-Content (Join-Path $shims 'scoop.ps1') -Encoding UTF8

@(
  '@rem scoop',
  '@echo off',
  'powershell -noprofile -ex unrestricted -file "%~dp0..\apps\scoop\current\bin\scoop.ps1" %*'
) | Set-Content (Join-Path $shims 'scoop.cmd') -Encoding ASCII

Remove-Item $scoopZip, $mainZip, (Join-Path $d '_tmp1'), (Join-Path $d '_tmp2') -Recurse -Force -ErrorAction SilentlyContinue
'zip install ok' | Out-File $LogPath -Append -Encoding utf8
