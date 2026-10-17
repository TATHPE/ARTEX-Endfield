; ARTEX 安装器补充脚本
;
; 注册键：electron-builder 把安装信息写进 ${INSTALL_REGISTRY_KEY} = Software\${APP_GUID}，
; 卸载器靠该键的 InstallLocation 反解 $INSTDIR。本项目实测该键缺失（静默安装路径），
; 于是 Uninstall ARTEX.exe 里 $INSTDIR 为空、RMDir 全部空转（0.9 秒退出、一个文件不删）。
; 这里做两件事：
;   1) 用模板自己的 define 补写安装/卸载注册项（控制面板可见）；
;   2) 在 customRemoveFiles 里**自己完成目录删除** —— 该宏执行时 $INSTDIR 有效（备份能成功
;      就是证明），但模板随后会重置它，所以删除不能依赖模板。卸载器自身 exe 在运行期占锁，
;      因此写一个临时脚本在卸载器退出后再 rmdir。

!macro customInstall
  DetailPrint "ARTEX: writing install registry info"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KeepShortcuts" "true"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "ShortcutName" "ARTEX Endfield"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayName" "ARTEX Endfield"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "UninstallString" '"$INSTDIR\Uninstall ARTEX.exe"'
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\ARTEX.exe,0"
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "Publisher" "ARTEX"
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "NoModify" 1
  WriteRegDWORD SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "NoRepair" 1
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
!macroend

!macro customRemoveFiles
  ; ---- 0) $INSTDIR 兜底
  StrCmp "$INSTDIR" "" 0 dir_ok
    StrCpy $INSTDIR "$EXEDIR"
  dir_ok:

  ; ---- 1) 先停 PostgreSQL（否则 postgres.exe 会一直占着 5433）
  DetailPrint "ARTEX: stopping PostgreSQL before removal"
  IfFileExists "$INSTDIR\resources\pgdata\postmaster.pid" 0 pg_done
  IfFileExists "$INSTDIR\resources\pgsql\bin\pg_ctl.exe" 0 pg_done
  nsExec::ExecToLog '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" -D "$INSTDIR\resources\pgdata" stop -m fast -w -t 20'
  Pop $0
  DetailPrint "ARTEX: PostgreSQL stop rc=$0"
pg_done:

  ; ---- 2) 删除前备份用户数据
  StrCpy $R0 "$LOCALAPPDATA\ARTEX\uninstall-backup"
  CreateDirectory "$R0"
  IfFileExists "$INSTDIR\resources\pgdata\*.*" 0 no_pg
  nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$INSTDIR\resources\pgdata" "$R0\pgdata" >NUL'
  Pop $0
  DetailPrint "ARTEX: pgdata backup rc=$0"
no_pg:
  IfFileExists "$INSTDIR\resources\artex\data\*.*" 0 no_data
  nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$INSTDIR\resources\artex\data" "$R0\artex-data" >NUL'
  Pop $0
  DetailPrint "ARTEX: artex data backup rc=$0"
no_data:
  DetailPrint "ARTEX: user data kept at $R0"

  ; ---- 3) 自己删目录（模板的删除依赖会被重置的 $INSTDIR，不可靠）
  DetailPrint "ARTEX: scheduling removal of $INSTDIR"
  StrCpy $R2 "$TEMP\artex-uninstall-$RANDOM.cmd"
  ClearErrors
  FileOpen $R3 "$R2" w
  IfErrors del_failed
    FileWrite $R3 "@echo off$\r$\n"
    FileWrite $R3 "ping -n 3 127.0.0.1 >NUL$\r$\n"
    FileWrite $R3 "rmdir /s /q $\"$INSTDIR$\"$\r$\n"
    FileWrite $R3 "del /f /q $\"$R2$\"$\r$\n"
    FileClose $R3
    nsExec::ExecToLog 'cmd /c start "" /min "$R2"'
    Pop $0
    DetailPrint "ARTEX: removal scheduled rc=$0 -> $R2"
    Goto del_done
  del_failed:
    DetailPrint "ARTEX: could not write removal script, falling back to RMDir"
    RMDir /r /REBOOTOK "$INSTDIR"
  del_done:
!macroend
