Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

ws.Run "cmd /c taskkill /F /IM electron.exe", 0, True
ws.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :1420 ^| findstr LISTENING') do taskkill /F /PID %a", 0, True
WScript.Sleep 1000

ws.Run "node node_modules/vite/bin/vite.js", 0, False
WScript.Sleep 3000

ws.Run "node node_modules/electron/cli.js . --dev", 0, False
