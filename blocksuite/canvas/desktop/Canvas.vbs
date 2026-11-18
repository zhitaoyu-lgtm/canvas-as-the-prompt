' Canvas as the Prompt: opens the board as its own window.
' Starts the local server (hidden), waits until it answers, then opens an Edge app window.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
here = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
' a real app entry: a Desktop shortcut with the Canvas icon, pointing at this folder
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
' find it the way Windows lists installed apps: Edge registers each one with an uninstall command that names
' its app id and Edge profile. (Fallback: the id computed from the start URL.)
appId = "" : profile = ""
Const HKCU = &H80000001
Set reg = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\default:StdRegProv")
base = "Software\Microsoft\Windows\CurrentVersion\Uninstall"
reg.EnumKey HKCU, base, keys
If IsArray(keys) Then
  For Each k In keys
    dn = "" : us = ""
    reg.GetStringValue HKCU, base & "\" & k, "DisplayName", dn
    reg.GetStringValue HKCU, base & "\" & k, "UninstallString", us
    If appId = "" And Not IsNull(us) And Not IsNull(dn) Then
      If InStr(1, us, "msedge", 1) > 0 And InStr(us, "--uninstall-app-id=") > 0 And Left(dn, 6) = "Canvas" Then
        appId = Mid(us, InStr(us, "--uninstall-app-id=") + 19, 32)
        p1 = InStr(us, "--profile-directory=")
        If p1 > 0 Then
          rest = Mid(us, p1 + 20)
          If Left(rest, 1) = """" Then
            profile = Mid(rest, 2, InStr(2, rest, """") - 2)
          Else
            sp = InStr(rest, " ") : If sp > 0 Then profile = Left(rest, sp - 1) Else profile = rest
          End If
        End If
        If profile = "" Then profile = "Default"
      End If
    End If
  Next
End If
If appId = "" Then
  appId = "iebdchmdinjpbeinhnmpieagcihdlfnn"
  userData = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\User Data"
  If fs.FolderExists(userData) Then
    For Each d In fs.GetFolder(userData).SubFolders
      If profile = "" And fs.FolderExists(d.Path & "\Web Applications\Manifest Resources\" & appId) Then profile = d.Name
    Next
  End If
End If
If profile <> "" Then
  sh.Run "msedge --profile-directory=""" & profile & """ --app-id=" & appId, 1, False
Else
  sh.Run "msedge --app=http://127.0.0.1:7357/ --window-size=1440,900", 1, False
End If
