!macro customRemoveFiles
  ; ---- 1) 先停 PostgreSQL：否则 postgres.exe 会一直占着 5433，
  ;         下次启动被挤到别的端口，界面偏好（按 origin 隔离）就丢了。
  DetailPrint "ARTEX: stopping PostgreSQL before removal"
  IfFileExists "$INSTDIR\resources\pgdata\postmaster.pid" 0 pg_done
  IfFileExists "$INSTDIR\resources\pgsql\bin\pg_ctl.exe" 0 pg_done
  nsExec::ExecToLog '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" -D "$INSTDIR\resources\pgdata" stop -m fast -w -t 20'
  Pop $0
  DetailPrint "ARTEX: PostgreSQL stop rc=$0"
pg_done:

  ; ---- 2) 删除前自动备份用户数据（等同“二次确认”的安全版：无论用户怎么选都不丢数据）
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
