Set shell = CreateObject("WScript.Shell")
project = Replace(WScript.ScriptFullName, "\scripts\run-result-sync-hidden.vbs", "")
cmd = "cmd.exe /c cd /d """ & project & """ && (npm.cmd run sync:api-football || npm.cmd run refresh:results) >> "".local\result-sync.log"" 2>> "".local\result-sync.err.log"""
shell.Run cmd, 0, False
