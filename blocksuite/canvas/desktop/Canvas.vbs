' Canvas as the Prompt: opens the board as its own window.
' Starts the local server (hidden), waits until it answers, then opens an Edge app window.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
here = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' a real app entry: Desktop and Start menu shortcuts with the Canvas icon, pointing at this folder
Sub MakeLink(p)
  Set l = sh.CreateShortcut(p)
  l.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
  l.Arguments = """" & here & "\Canvas.vbs"""
  l.WorkingDirectory = here
  l.IconLocation = here & "\canvas.ico,0"
  l.Description = "Canvas as the Prompt"
  l.Save
End Sub
On Error Resume Next
MakeLink sh.SpecialFolders("Desktop") & "\Canvas.lnk"
MakeLink sh.SpecialFolders("Programs") & "\Canvas.lnk"
Err.Clear
On Error GoTo 0
sh.Run """" & here & "\node\node.exe"" """ & here & "\server.mjs"" --app", 0, False
ready = False
For i = 1 To 40
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", "http://127.0.0.1:7357/", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ready = True
  End If
  Err.Clear
  On Error GoTo 0
  If ready Then Exit For
  WScript.Sleep 250
Next
' installed as an Edge app (Install Canvas in Edge, once)? then open that: its own crisp taskbar icon and title bar
appId = "iebdchmdinjpbeinhnmpieagcihdlfnn"
userData = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\User Data"
profile = ""
If fs.FolderExists(userData) Then
  For Each d In fs.GetFolder(userData).SubFolders
    If profile = "" And fs.FolderExists(d.Path & "\Web Applications\Manifest Resources\" & appId) Then profile = d.Name
  Next
End If
If profile <> "" Then
  sh.Run "msedge --profile-directory=""" & profile & """ --app-id=" & appId, 1, False
Else
  sh.Run "msedge --app=http://127.0.0.1:7357/ --window-size=1440,900", 1, False
End If
