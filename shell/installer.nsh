; ARTEX 安装器补充脚本
;
; 背景：electron-builder 的 NSIS 模板把安装信息写进
;   ${INSTALL_REGISTRY_KEY} = Software\{APP_GUID}
; 卸载器正是靠该键下的 InstallLocation 反解 $INSTDIR（见 installUtil.nsh:169）。
; 实测本项目静默安装（/S）后该键并不存在 ⇒ Uninstall ARTEX.exe 拿不到 $INSTDIR、
; 一个文件都不删。这里用模板自己的 define 把键补上，保证「控制面板可见」与
; 「卸载器能找到目录」同时成立（不要用自定义键名：卸载器不认）。

!macro customInstall
  DetailPrint "ARTEX: writing install registry info"
  ; 卸载器定位用（模板读的就是这两个键）
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "KeepShortcuts" "true"
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "ShortcutName" "ARTEX Endfield"
  ; 控制面板「应用和功能」条目
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
  ; 模板会删它自己的键；这里兜一层，避免残留
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
!macroend

!macro customRemoveFiles
  ; ---- 0) $INSTDIR 兜底：旧版安装没写注册键时，用卸载器自身目录
  StrCmp "$INSTDIR" "" 0 dir_ok
    StrCpy $INSTDIR "$EXEDIR"
  dir_ok:
  DetailPrint "ARTEX: removal target $INSTDIR"

  ; ---- 1) 先停 PostgreSQL：否则 postgres.exe 会一直占着 5433，
  ;         下次启动被挤到别的端口，界面偏好（按 origin 隔离）就丢了。
  DetailPrint "ARTEX: stopping PostgreSQL before removal"
  IfFileExists "$INSTDIR\resources\pgdata\postmaster.pid" 0 pg_done
  IfFileExists "$INSTDIR\resources\pgsql\bin\pg_ctl.exe" 0 pg_done
  nsExec::ExecToLog '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" -D "$INSTDIR\resources\pgdata" stop -m fast -w -t 20'
  Pop $0
  DetailPrint "ARTEX: PostgreSQL stop rc=$0"
pg_done:

  ; ---- 2) 删除前自动备份用户数据（比"二次确认"更安全：怎么选都不丢）
  StrCpy $R0 "$LOCALAPPDATA\ARTEX\uninstall-backup"
  CreateDirectory "$R0"
  IfFileExists "$INSTDIR\resources\pgdata\*.*" 0 no_pg
  nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$INSTDIR\resources\pgdata" "$R0\pgdata" >NUL'
  Pop $0
  DetailPrint "ARTEX: pgdata backup rc=$0 -> $R0\pgdata"
no_pg:

  IfFileExists "$INSTDIR\resources\artex\data\*.*" 0 no_data
  nsExec::ExecToLog 'cmd /c xcopy /E /I /Y "$INSTDIR\resources\artex\data" "$R0\artex-data" >NUL'
  Pop $0
  DetailPrint "ARTEX: artex data backup rc=$0 -> $R0\artex-data"
no_data:

  DetailPrint "ARTEX: user data kept at $R0"
!macroend
