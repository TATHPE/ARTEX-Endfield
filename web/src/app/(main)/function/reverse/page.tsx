"use client";

import * as React from "react";

import {
  CpuIcon,
  FileSearchIcon,
  FileTextIcon,
  Loader2Icon,
  PlayIcon,
  PlugIcon,
  RefreshCwIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toneClasses } from "@/lib/status";
import type { CommandRecord, MCPServer, MCPTool, Task, TaskNode, WorkspaceEntry, WorkspaceFile } from "@/lib/types";
import { cn } from "@/lib/utils";

// 逆向分析：把「自有样本 → REA MCP 只读静态分析 → 结论与证据入库」串成一条可视化流程。
// 本页不新增后端接口：MCP 状态用 /api/mcp，结论用 /api/exploration/nodes，
// 证据文件用 /api/workspace/*，工具调用用 /api/commands。

const TERMINAL_TASK_STATUS = new Set(["done", "failed", "stopped", "archived"]);

function fmtTime(ts: string) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtSize(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 节点 payload 是后端存的 JSON 字符串；优先取 detail/summary/report 这类人读字段。
function nodeText(node: TaskNode): string {
  const raw = node.payload ?? "";
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ["detail", "report", "summary", "goal", "text"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v;
    }
    return JSON.stringify(obj, null, 2);
  } catch {
    return raw;
  }
}

// 被延迟执行的 MCP 工具，其真实名字在 ExecuteExtraTool 的入参里：实测字段为
// {"params":{…},"tool_name":"mcp__rea__…"}（兼容 name 写法）。
function innerToolName(cmd: CommandRecord): string {
  if (cmd.tool.startsWith("mcp__")) return cmd.tool;
  try {
    const obj = JSON.parse(cmd.command) as { tool_name?: string; name?: string };
    for (const key of ["tool_name", "name"] as const) {
      const v = obj[key];
      if (typeof v === "string" && v) return v;
    }
  } catch {
    /* 非 JSON 入参 */
  }
  return cmd.tool;
}

type ReaCall = { tool: string; total: number; errors: number };

function aggregateReaCalls(cmds: CommandRecord[]): ReaCall[] {
  const byTool = new Map<string, ReaCall>();
  for (const cmd of cmds) {
    const name = innerToolName(cmd);
    if (!name.startsWith("mcp__rea__")) continue;
    const rec = byTool.get(name) ?? { tool: name, total: 0, errors: 0 };
    rec.total += 1;
    if (cmd.is_error) rec.errors += 1;
    byTool.set(name, rec);
  }
  return [...byTool.values()].sort((a, b) => b.total - a.total);
}

// REA 在 provider 不可用时会给出结构化诊断：details.rejections[] 逐个引擎带上
// provider_id / code / reason / diagnostics（含 Java 探测结果）。解析它就能在不装
// Ghidra 的情况下说清"缺什么、为什么"。
type ProviderStatus = {
  id: string;
  code: string;
  reason: string;
  platform?: string;
  javaVersion?: string;
  javaCommand?: string;
};

type ProviderDiag = { providers: ProviderStatus[]; at?: string };

function parseProviderStatus(cmds: CommandRecord[]): ProviderDiag {
  for (const cmd of cmds) {
    const out = cmd.output || "";
    if (!out.includes("provider_id") || !out.includes("rejections")) continue;
    const start = out.indexOf("{");
    if (start < 0) continue;
    try {
      const doc = JSON.parse(out.slice(start)) as {
        error?: { details?: { rejections?: Array<Record<string, unknown>> } };
      };
      const rejections = doc.error?.details?.rejections;
      if (!Array.isArray(rejections) || rejections.length === 0) continue;
      const providers = rejections.map((r) => {
        const d = (r.diagnostics ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
        return {
          id: String(r.provider_id ?? "?"),
          code: String(r.code ?? "unknown"),
          reason: String(r.reason ?? ""),
          platform: str(d.platform),
          javaVersion: str(d.java_version),
          javaCommand: str(d.java_command),
        };
      });
      return { providers, at: cmd.created_at };
    } catch {
      /* 结构不同就继续找下一条 */
    }
  }
  return { providers: [] };
}

const PROVIDER_LABEL: Record<string, string> = {
  ghidra: "Ghidra",
  ida: "IDA",
  hopper: "Hopper",
  rizin: "rizin",
  cutter: "Cutter",
  jadx: "JADX",
  apktool: "apktool",
  frida: "Frida",
};

// 未就绪的原因码 → 颜色：能靠"配置/安装"解决的用琥珀，平台不支持的用中性。
function providerTone(code: string): string {
  if (code === "not_configured" || code === "executable_missing" || code === "version_unresolved") {
    return toneClasses.amber;
  }
  if (code === "unsupported_host") return toneClasses.slate;
  return toneClasses.neutral;
}

// 非 ASCII 检测：不用正则（Biome 的 noControlCharactersInRegex 会拦），直接看码点。
const hasNonAscii = (s: string) => [...s].some((ch) => ch.charCodeAt(0) > 127);

const DEFAULT_GOAL = (sample: string) =>
  [
    `Statically analyze the self-authored sample at ${sample}.`,
    "Work plan:",
    "(1) first load the skill 'reverse-engineer-anything' so the REA MCP tools become available;",
    "(2) then use REA MCP tools (names start with mcp__rea__) to establish file identity (size and SHA256), format and architecture, PE sections and imports, notable strings, and the structure of the sample's own functions;",
    "(3) write the conclusions into this task's facts and evidence with concrete file offsets or verbatim strings as proof, and register at least one finding with report_finding.",
    "Constraints: read-only static analysis of that single sample only. Do not execute it, do not touch the network, do not modify or delete it, no exploitation.",
    "Explicitly report which REA tools you called, which ones failed, and whether each failure was caused by a missing external provider (for example Ghidra or IDA).",
  ].join(" ");

export default function ReversePage() {
  // ---- REA MCP 状态 ----
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [serversLoading, setServersLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [tools, setTools] = React.useState<MCPTool[]>([]);
  const [toolsLoading, setToolsLoading] = React.useState(false);
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [toolQuery, setToolQuery] = React.useState("");

  // ---- 样本与任务 ----
  const [samplePath, setSamplePath] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [goalEdited, setGoalEdited] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // ---- 任务与结果 ----
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState("");
  const [nodes, setNodes] = React.useState<TaskNode[]>([]);
  const [nodesLoading, setNodesLoading] = React.useState(false);
  const [evidencePath, setEvidencePath] = React.useState("");
  const [evidence, setEvidence] = React.useState<WorkspaceEntry[]>([]);
  const [evidenceLoading, setEvidenceLoading] = React.useState(false);
  const [openFile, setOpenFile] = React.useState<WorkspaceFile | null>(null);
  const [fileLoading, setFileLoading] = React.useState(false);
  const [commands, setCommands] = React.useState<CommandRecord[]>([]);
  const [commandsLoading, setCommandsLoading] = React.useState(false);
  const [callDetail, setCallDetail] = React.useState<CommandRecord | null>(null);
  // 引擎状态卡不依赖选中任务：始终扫一遍最近的工具调用，从中找 REA 的 provider 诊断。
  const [globalCommands, setGlobalCommands] = React.useState<CommandRecord[]>([]);
  const [globalLoading, setGlobalLoading] = React.useState(false);

  const rea = React.useMemo(() => servers.find((s) => s.name.toLowerCase() === "rea") ?? null, [servers]);
  const loadGlobalCommands = React.useCallback(() => {
    setGlobalLoading(true);
    api
      .commands({ size: 300 })
      .then((r) => setGlobalCommands(r.commands ?? []))
      .catch(() => setGlobalCommands([]))
      .finally(() => setGlobalLoading(false));
  }, []);
  const engineDiag = React.useMemo(
    () => parseProviderStatus(commands.length > 0 ? commands : globalCommands),
    [commands, globalCommands],
  );
  const javaPathNonAscii = engineDiag.providers.some((p) => !!p.javaCommand && hasNonAscii(p.javaCommand));

  const loadServers = React.useCallback(() => {
    setServersLoading(true);
    api
      .mcpServers()
      .then(setServers)
      .catch((e) => toast.error(`读取 MCP 服务失败：${(e as Error).message}`))
      .finally(() => setServersLoading(false));
  }, []);

  const loadTools = React.useCallback((id: number) => {
    setToolsLoading(true);
    api
      .mcpTools(id)
      .then(setTools)
      .catch((e) => toast.error(`读取工具清单失败：${(e as Error).message}`))
      .finally(() => setToolsLoading(false));
  }, []);

  const loadTasks = React.useCallback(() => {
    setTasksLoading(true);
    api
      .tasks()
      .then((r) => setTasks(r.tasks))
      .catch((e) => toast.error(`读取任务失败：${(e as Error).message}`))
      .finally(() => setTasksLoading(false));
  }, []);

  const loadNodes = React.useCallback((id: string) => {
    if (!id) {
      setNodes([]);
      return;
    }
    setNodesLoading(true);
    api
      .explorationNodes(id, { kinds: ["fact", "intent", "goal"], size: 100, order: "desc" })
      .then((r) => setNodes(r.items ?? []))
      .catch((e) => toast.error(`读取结论失败：${(e as Error).message}`))
      .finally(() => setNodesLoading(false));
  }, []);

  const loadEvidence = React.useCallback((path: string) => {
    if (!path) {
      setEvidence([]);
      return;
    }
    setEvidenceLoading(true);
    api
      .workspaceList(path)
      .then((r) => {
        setEvidence(r.entries ?? []);
        setEvidencePath(r.path);
      })
      .catch(() => setEvidence([]))
      .finally(() => setEvidenceLoading(false));
  }, []);

  const loadCommands = React.useCallback((id: string) => {
    if (!id) {
      setCommands([]);
      return;
    }
    setCommandsLoading(true);
    api
      .commands({ task: id, size: 200 })
      .then((r) => setCommands(r.commands ?? []))
      .catch((e) => toast.error(`读取工具调用失败：${(e as Error).message}`))
      .finally(() => setCommandsLoading(false));
  }, []);

  React.useEffect(() => {
    loadServers();
    loadTasks();
    loadGlobalCommands();
  }, [loadServers, loadTasks, loadGlobalCommands]);

  React.useEffect(() => {
    if (rea) loadTools(rea.id);
  }, [rea, loadTools]);

  // 选中任务后拉取「结论 / 证据 / 工具调用」三块。
  React.useEffect(() => {
    loadNodes(selectedId);
    loadCommands(selectedId);
    const root = selectedId ? `tasks/${selectedId}` : "";
    setEvidencePath(root);
    if (root) loadEvidence(root);
    else setEvidence([]);
  }, [selectedId, loadNodes, loadCommands, loadEvidence]);

  // 任务未终态时轮询，跑完自动停。
  React.useEffect(() => {
    if (!selectedId) return;
    const current = tasks.find((t) => t.id === selectedId);
    if (current && TERMINAL_TASK_STATUS.has(current.status)) return;
    const timer = window.setInterval(() => {
      loadNodes(selectedId);
      loadCommands(selectedId);
      loadTasks();
      if (evidencePath) loadEvidence(evidencePath);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selectedId, tasks, evidencePath, loadNodes, loadCommands, loadTasks, loadEvidence]);

  const updateGoalFromSample = (path: string) => {
    setSamplePath(path);
    if (!goalEdited) setGoal(DEFAULT_GOAL(path));
  };

  const onPickFile = async (picked: File | null) => {
    setFile(picked);
    if (!picked) return;
    setUploading(true);
    try {
      // 样本先进共享工作目录，再由 Agent 按工作空间相对路径解析。
      await api.workspaceUpload("uploads", [picked]);
      updateGoalFromSample(`uploads/${picked.name}`);
      toast.success(`样本已上传：uploads/${picked.name}`);
    } catch (e) {
      // 上传失败不阻断：允许直接手填本机绝对路径。
      updateGoalFromSample(samplePath);
      toast.error(`上传失败，可改填本机绝对路径：${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!samplePath.trim()) {
      toast.error("请先选择样本或填写样本路径");
      return;
    }
    setCreating(true);
    try {
      const created = await api.createTask({
        description: "REA smoke test: read-only static analysis (self-authored sample)",
        goal: goal.trim() || DEFAULT_GOAL(samplePath.trim()),
      });
      toast.success(`分析任务已创建：#${created.id}`);
      setSelectedId(created.id);
      loadTasks();
    } catch (e) {
      toast.error(`创建任务失败：${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const refreshTools = async () => {
    if (!rea) return;
    setRefreshing(true);
    try {
      const list = await api.refreshMcpServer(rea.id);
      setTools(list);
      loadServers();
      toast.success(`已刷新：发现 ${list.length} 个工具`);
    } catch (e) {
      toast.error(`刷新失败：${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const openEvidenceFile = async (path: string) => {
    setFileLoading(true);
    try {
      setOpenFile(await api.workspaceRead(path));
    } catch (e) {
      toast.error(`读取文件失败：${(e as Error).message}`);
    } finally {
      setFileLoading(false);
    }
  };

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const reaCalls = React.useMemo(() => aggregateReaCalls(commands), [commands]);
  const reaCallTotal = reaCalls.reduce((n, c) => n + c.total, 0);
  const reaCallErrors = reaCalls.reduce((n, c) => n + c.errors, 0);
  // 缺外部分析引擎（Ghidra/IDA）是这类失败的主因，单独拎出来提示，别让用户以为整合坏了。
  const providerFailures = React.useMemo(
    () =>
      commands.filter((c) => c.is_error && /provider_unavailable|capability_unavailable/.test(c.output ?? "")).length,
    [commands],
  );
  const filteredTools = React.useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
  }, [tools, toolQuery]);

  const evidenceCrumbs = evidencePath.split("/").filter(Boolean);

  return (
    <div className="flex flex-1 flex-col gap-4 md:gap-6">
      <div>
        <h1 className="font-semibold text-xl tracking-tight">逆向分析</h1>
        <p className="text-muted-foreground text-sm">自有样本只读静态分析 · 经 REA MCP 调用逆向工具 · 结论与证据汇总</p>
      </div>

      {/* REA MCP 状态 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <PlugIcon className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-base">REA MCP 服务</CardTitle>
            {serversLoading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" disabled={!rea || refreshing} onClick={refreshTools}>
                {refreshing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                刷新工具清单
              </Button>
              <Button variant="outline" size="sm" className="h-8" disabled={!rea} onClick={() => setToolsOpen(true)}>
                <FileSearchIcon />
                查看工具
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {serversLoading ? (
            <span className="text-muted-foreground text-sm">加载中…</span>
          ) : !rea ? (
            <>
              <span className={cn("rounded-md border px-2 py-0.5 font-medium text-xs", toneClasses.amber)}>
                未找到名为 rea 的 MCP 服务
              </span>
              <a className="text-sm underline underline-offset-4" href="/system/mcp">
                去 MCP 页面配置
              </a>
            </>
          ) : (
            <>
              <Badge variant="outline" className="uppercase">
                {rea.transport}
              </Badge>
              <span
                className={cn(
                  "rounded-md border px-2 py-0.5 font-medium text-xs",
                  rea.enabled ? toneClasses.green : toneClasses.slate,
                )}
              >
                {rea.enabled ? "已启用" : "已停用"}
              </span>
              <span className="text-muted-foreground text-sm">
                {toolsLoading ? "读取工具…" : `${tools.length} 个工具`}
              </span>
              {rea.tools?.length ? (
                <span className="text-muted-foreground text-sm">缓存 {rea.tools.length} 条</span>
              ) : null}
              <code className="max-w-full truncate font-mono text-muted-foreground text-xs">
                {rea.command} {(rea.args ?? []).join(" ")}
              </code>
            </>
          )}
        </CardContent>
      </Card>

      {/* 分析引擎（REA provider）状态：诊断取自失败详情，不需要装 Ghidra 也能看到缺什么 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CpuIcon className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-base">分析引擎（REA provider）</CardTitle>
            {globalLoading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
            <span className="ml-auto text-muted-foreground text-xs">
              {engineDiag.at ? `诊断来自 ${fmtTime(engineDiag.at)} 的一次调用` : "尚无诊断"}
            </span>
            <Button variant="ghost" size="icon" className="size-8" title="重新探测" onClick={loadGlobalCommands}>
              <RefreshCwIcon className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {engineDiag.providers.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              还没有可解析的引擎诊断：跑一次分析任务后，REA 会把各引擎的可用性与缺失原因写进失败详情，这里会自动显示 ——
              不装 Ghidra 也能看清"缺什么、为什么"。
            </span>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {engineDiag.providers.map((p) => (
                  <span
                    key={p.id}
                    className={cn("rounded-md border px-2 py-0.5 font-medium text-xs", providerTone(p.code))}
                    title={p.reason}
                  >
                    {PROVIDER_LABEL[p.id] ?? p.id}：
                    {p.code === "unsupported_host" ? "平台不支持" : p.code === "not_configured" ? "未配置" : "未就绪"}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {engineDiag.providers.map((p) => (
                  <p key={p.id} className="text-muted-foreground text-xs">
                    <span className="font-mono">{p.id}</span> → <span className="font-mono">{p.code}</span>
                    {p.reason ? <span>：{p.reason}</span> : null}
                    {p.javaVersion ? <span>（Java {p.javaVersion} 已检测到）</span> : null}
                  </p>
                ))}
              </div>
              <span className="text-muted-foreground text-xs">
                启用深度反编译：解压 Ghidra 到<strong>纯 ASCII 路径</strong>并设{" "}
                <code className="font-mono">GHIDRA_INSTALL_DIR</code>（绝对值）+{" "}
                <code className="font-mono">JAVA_HOME</code>，然后重启 ARTEX。Ghidra/IDA 不随安装包分发。
              </span>
              {javaPathNonAscii ? (
                <span className={cn("rounded-md border px-2 py-0.5 font-medium text-xs", toneClasses.amber)}>
                  检测到的 Java 路径含非 ASCII 字符，启用 Ghidra 前建议换成纯 ASCII 的 JDK 目录
                </span>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* 发起分析 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">发起分析</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              选择样本上传
            </Button>
            {file ? <span className="font-mono text-sm">{file.name}</span> : null}
            <span className="text-muted-foreground text-xs">上传后写入工作空间 uploads/，也可直接填写本机绝对路径</span>
          </div>

          <Input
            placeholder="样本路径（本机绝对路径，或工作空间相对路径）"
            value={samplePath}
            onChange={(e) => updateGoalFromSample(e.target.value)}
            className="font-mono text-sm"
          />

          <Textarea
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setGoalEdited(true);
            }}
            rows={6}
            className="font-mono text-xs"
            placeholder="分析目标（只读、单文件、不执行、不联网、不利用）"
          />

          <div className="flex items-center gap-2">
            <Button disabled={creating || !samplePath.trim()} onClick={submit}>
              {creating ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              创建分析任务
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGoalEdited(false);
                setGoal(DEFAULT_GOAL(samplePath.trim()));
              }}
            >
              重置目标模板
            </Button>
            <span className="text-muted-foreground text-xs">会消耗 LLM 额度；样本仅做只读静态分析</span>
          </div>
        </CardContent>
      </Card>

      {/* 分析任务 */}
      <Card className="overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <CardTitle className="text-base">分析任务</CardTitle>
          {tasksLoading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
          <Button variant="ghost" size="icon" className="ml-auto size-8" title="刷新" onClick={loadTasks}>
            <RefreshCwIcon className="size-4" />
          </Button>
        </div>
        <div className="max-h-[22rem] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-[70px]">任务</TableHead>
                <TableHead>描述</TableHead>
                <TableHead className="w-[110px]">状态</TableHead>
                <TableHead className="w-[90px]">目标</TableHead>
                <TableHead className="w-[140px]">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground text-sm">
                    {tasksLoading ? "加载中…" : "暂无任务"}
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((t) => (
                  <TableRow
                    key={t.id}
                    className={cn("cursor-pointer", selectedId === t.id && "bg-accent hover:bg-accent")}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <TableCell className="font-mono text-xs">#{t.id}</TableCell>
                    <TableCell className="max-w-0">
                      <span className="block truncate text-sm">{t.description || "（无描述）"}</span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge domain="task" value={t.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {t.goals_met ?? 0}/{t.goals_total ?? 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {fmtTime(t.last_activity ?? t.created_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* 结果：结论 / 证据 / 工具调用 */}
      <Tabs defaultValue="facts" className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="facts">结论</TabsTrigger>
            <TabsTrigger value="evidence">证据文件</TabsTrigger>
            <TabsTrigger value="calls">REA 工具调用</TabsTrigger>
          </TabsList>
          <span className="text-muted-foreground text-xs">
            {selectedTask ? `任务 #${selectedTask.id} · ${selectedTask.status}` : "在上方选择一个任务查看结果"}
          </span>
        </div>

        <TabsContent value="facts" className="mt-0">
          <Card className="overflow-hidden py-0">
            <div className="max-h-[32rem] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-[90px]">类型</TableHead>
                    <TableHead className="w-[110px]">状态</TableHead>
                    <TableHead className="w-[130px]">时间</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground text-sm">
                        {nodesLoading ? "加载中…" : selectedId ? "该任务暂无结论节点" : "请先选择任务"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    nodes.map((n) => (
                      <TableRow key={`${n.type}-${n.id}`}>
                        <TableCell>
                          <Badge variant="outline" className="uppercase">
                            {n.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            domain={n.type === "goal" ? "goal" : n.type === "intent" ? "intent" : "node"}
                            value={n.state}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs tabular-nums">{fmtTime(n.ts)}</TableCell>
                        <TableCell className="max-w-0">
                          <div className="max-h-40 overflow-auto">
                            <Markdown text={nodeText(n)} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="mt-0">
          <Card className="overflow-hidden py-0">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
              <FileTextIcon className="size-4 text-muted-foreground" />
              {evidenceCrumbs.length === 0 ? (
                <span className="text-muted-foreground">未选择任务</span>
              ) : (
                evidenceCrumbs.map((seg, i) => {
                  const target = evidenceCrumbs.slice(0, i + 1).join("/");
                  return (
                    <React.Fragment key={target}>
                      {i > 0 ? <span className="text-muted-foreground">/</span> : null}
                      <button
                        type="button"
                        className="font-mono text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() => loadEvidence(target)}
                      >
                        {seg}
                      </button>
                    </React.Fragment>
                  );
                })
              )}
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                title="刷新"
                disabled={!evidencePath}
                onClick={() => loadEvidence(evidencePath)}
              >
                <RefreshCwIcon className="size-3.5" />
              </Button>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead className="w-[100px]">大小</TableHead>
                    <TableHead className="w-[140px]">修改时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground text-sm">
                        {evidenceLoading ? "加载中…" : selectedId ? "该任务暂无证据文件" : "请先选择任务"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    evidence.map((entry) => (
                      <TableRow
                        key={entry.path}
                        className="cursor-pointer"
                        onClick={() => (entry.dir ? loadEvidence(entry.path) : openEvidenceFile(entry.path))}
                      >
                        <TableCell className="font-mono text-xs">
                          {entry.dir ? "📁 " : "📄 "}
                          {entry.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs tabular-nums">
                          {entry.dir ? "-" : fmtSize(entry.size)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs tabular-nums">
                          {fmtTime(new Date(entry.mtime).toISOString())}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="calls" className="mt-0">
          <Card className="overflow-hidden py-0">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <CardTitle className="text-base">REA 工具调用</CardTitle>
              <Badge variant="secondary">{reaCallTotal}</Badge>
              {reaCallErrors > 0 ? <Badge variant="destructive">失败 {reaCallErrors}</Badge> : null}
              {providerFailures > 0 ? (
                <span className={cn("rounded-md border px-2 py-0.5 font-medium text-xs", toneClasses.amber)}>
                  缺外部引擎致败 {providerFailures}（Ghidra/IDA 未装，非整合故障）
                </span>
              ) : null}
              {(() => {
                // 失败原因按 REA/门控 的原文错误码归类，避免把"没按顺序调工具"或"技能没加载"
                // 误读成整合坏了。
                const buckets: Array<[string, RegExp]> = [
                  ["需先 open_binary", /target_unavailable/],
                  ["技能未加载被门控", /not unlocked in this session/],
                  ["参数错误", /Input validation error/],
                ];
                const parts = buckets
                  .map(
                    ([label, re]) =>
                      [label, commands.filter((c) => c.is_error && re.test(c.output ?? "")).length] as [string, number],
                  )
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => `${label} ${n}`);
                if (parts.length === 0) return null;
                return <span className="text-muted-foreground text-xs">其余失败：{parts.join(" · ")}</span>;
              })()}
              {commandsLoading ? <Loader2Icon className="size-4 animate-spin text-muted-foreground" /> : null}
              <span className="ml-auto text-muted-foreground text-xs">
                真实工具名取自 ExecuteExtraTool 的入参（MCP 工具 schema 延迟检索）
              </span>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>REA 工具</TableHead>
                    <TableHead className="w-[80px]">调用</TableHead>
                    <TableHead className="w-[80px]">失败</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reaCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground text-sm">
                        {commandsLoading ? "加载中…" : selectedId ? "该任务尚未调用 REA 工具" : "请先选择任务"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    reaCalls.map((c) => (
                      <TableRow key={c.tool}>
                        <TableCell className="font-mono text-xs">{c.tool}</TableCell>
                        <TableCell className="text-xs tabular-nums">{c.total}</TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {c.errors > 0 ? <span className="text-red-600 dark:text-red-400">{c.errors}</span> : 0}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {commands.length > 0 ? (
              <div className="max-h-[18rem] overflow-auto border-t">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-[130px]">时间</TableHead>
                      <TableHead className="w-[90px]">Worker</TableHead>
                      <TableHead className="w-[110px]">工具</TableHead>
                      <TableHead>输入</TableHead>
                      <TableHead className="w-[60px]">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commands
                      .filter((c) => innerToolName(c).startsWith("mcp__rea__"))
                      .slice(0, 60)
                      .map((c) => (
                        <TableRow key={c.id} className="cursor-pointer" onClick={() => setCallDetail(c)}>
                          <TableCell className="text-muted-foreground text-xs tabular-nums">
                            {fmtTime(c.created_at)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">
                              {c.worker || "-"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono text-xs">
                              {innerToolName(c)}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-0">
                            <code className="block truncate font-mono text-xs">{c.command}</code>
                          </TableCell>
                          <TableCell>
                            {c.is_error ? (
                              <Badge variant="destructive" className="text-xs">
                                失败
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-emerald-600 text-xs">
                                成功
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      {/* 工具清单抽屉 */}
      <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
        <SheetContent className="flex w-full flex-col gap-3 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>REA 工具清单</SheetTitle>
            <SheetDescription>{tools.length} 个工具（名称 + 描述来自缓存）</SheetDescription>
          </SheetHeader>
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索工具名 / 描述…"
              value={toolQuery}
              onChange={(e) => setToolQuery(e.target.value)}
              className="h-8 pl-8"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            {toolsLoading ? (
              <p className="p-4 text-muted-foreground text-sm">加载中…</p>
            ) : filteredTools.length === 0 ? (
              <p className="p-4 text-muted-foreground text-sm">无匹配工具</p>
            ) : (
              filteredTools.map((t) => (
                <div key={t.name} className="border-b px-3 py-2 last:border-b-0">
                  <code className="font-mono text-xs">{t.name}</code>
                  <p className="mt-0.5 text-muted-foreground text-xs">{t.description}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* 证据文件抽屉 */}
      <Sheet open={!!openFile || fileLoading} onOpenChange={(open) => (!open ? setOpenFile(null) : undefined)}>
        <SheetContent className="flex w-full flex-col gap-3 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">{openFile?.path ?? "读取中…"}</SheetTitle>
            <SheetDescription>
              {openFile ? `${fmtSize(openFile.size)}${openFile.binary ? " · 二进制" : ""}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border p-3">
            {fileLoading ? (
              <p className="text-muted-foreground text-sm">读取中…</p>
            ) : openFile?.binary ? (
              <p className="text-muted-foreground text-sm">二进制文件不内联展示，请用工作空间页下载。</p>
            ) : openFile?.too_large ? (
              <p className="text-muted-foreground text-sm">文件过大，未内联展示。</p>
            ) : openFile?.path.endsWith(".md") ? (
              <Markdown text={openFile.content ?? ""} />
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{openFile?.content ?? ""}</pre>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* 单次调用详情 */}
      <Sheet open={!!callDetail} onOpenChange={(open) => (!open ? setCallDetail(null) : undefined)}>
        <SheetContent className="flex w-full flex-col gap-3 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">{callDetail ? innerToolName(callDetail) : ""}</SheetTitle>
            <SheetDescription>
              {callDetail ? `${callDetail.worker} · ${fmtTime(callDetail.created_at)}` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <div className="border-b px-3 py-2">
              <p className="mb-1 text-muted-foreground text-xs">入参</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{callDetail?.command ?? ""}</pre>
            </div>
            <div className="px-3 py-2">
              <p className="mb-1 text-muted-foreground text-xs">输出{callDetail?.is_error ? "（失败）" : ""}</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs">{callDetail?.output ?? ""}</pre>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
