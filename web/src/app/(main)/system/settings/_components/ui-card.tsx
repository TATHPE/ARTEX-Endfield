"use client";

import { useCallback, useEffect, useState } from "react";

import { PaletteIcon } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export function UiCard() {
  const [hidePenguin, setHidePenguin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const cfg = await api.uiConfig();
      setHidePenguin(cfg.hide_penguin);
      setLoaded(true);
    } catch (e) {
      setError(`读取失败：${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: boolean) => {
    setSaving(true);
    setError("");
    try {
      const cfg = await api.saveUiConfig({ hide_penguin: next });
      setHidePenguin(cfg.hide_penguin);
      // Apply immediately, without a page reload.
      window.dispatchEvent(new CustomEvent("artex:ui-config", { detail: cfg }));
      toast.success(cfg.hide_penguin ? "已隐藏右下角企鹅水印" : "已显示右下角企鹅水印");
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`);
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4 break-inside-avoid md:mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PaletteIcon className="size-4" />
          界面
        </CardTitle>
        <CardDescription>外观相关的开关。改动即时生效，不需要刷新页面。</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">隐藏右下角企鹅水印</p>
          <p className="text-muted-foreground text-xs">
            只影响工作台右下角的水印图；皮肤的背景与叠层效果保持不变。
          </p>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
        <Switch
          aria-label="隐藏右下角企鹅水印"
          checked={hidePenguin}
          disabled={!loaded || saving}
          onCheckedChange={(checked) => {
            void save(checked);
          }}
        />
      </CardContent>
    </Card>
  );
}
