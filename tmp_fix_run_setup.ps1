$path = 'src\pages\SessionDetail.jsx'
$content = Get-Content $path -Raw
$regex = "\r?\n\s*\) : \(\r?\n\s*\) : \([\s\S]*?\r?\n\s*\) : \("
if ($content -notmatch $regex) { Write-Error 'Pattern not found'; exit 1 }
$content = [regex]::Replace($content, $regex, "`n            ) : (")
Set-Content -Path $path -Value $content
