' Canvas as the Prompt: opens the board as its own window.
' Starts the local server (hidden), waits until it answers, then opens an Edge app window.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
here = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
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
sh.Run "msedge --app=http://127.0.0.1:7357/ --window-size=1440,900", 1, False
