; Custom NSIS steps, pulled in by electron-builder.yml's nsis.include.
;
; After an icon change (v0.1.251's yellow bat), pinned taskbar shortcuts
; could go blank: Windows keeps drawing them from its icon cache, which the
; stock installer never refreshes (its own SHChangeNotify only runs inside
; the desktop-shortcut step). So after every install/update:
;   1. tell the shell each pinned taskbar shortcut changed (SHCNE_UPDATEITEM),
;   2. broadcast "associations/icons changed" and flush (SHCNE_ASSOCCHANGED),
;   3. ask Windows to rebuild its icon cache (ie4uinit -show, Win10/11).
; All three are harmless no-ops if nothing is pinned or a step fails.

!macro customInstall
  ; %APPDATA% (not $APPDATA) so a per-machine install still reaches the
  ; signed-in user's own pinned folder.
  ExpandEnvStrings $R0 "%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
  FindFirst $R1 $R2 "$R0\*.lnk"
  ${DoWhile} $R2 != ""
    ; SHCNE_UPDATEITEM = 0x2000, SHCNF_PATHW = 0x0005
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "$R0\$R2", p 0)'
    FindNext $R1 $R2
  ${Loop}
  FindClose $R1

  ; SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_FLUSH = 0x1000
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'

  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  Pop $R0
!macroend
