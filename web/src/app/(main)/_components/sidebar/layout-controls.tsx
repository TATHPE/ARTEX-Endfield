"use client";

import { useEffect, useState } from "react";

import { Settings } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type FontKey, fontOptions } from "@/lib/fonts/registry";
import type { ContentLayout, NavbarStyle, SidebarCollapsible, SidebarVariant } from "@/lib/preferences/layout";
import {
  applyContentLayout,
  applyFont,
  applyNavbarStyle,
  applySidebarCollapsible,
  applySidebarVariant,
} from "@/lib/preferences/layout-utils";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { persistPreference } from "@/lib/preferences/preferences-storage";
import { THEME_PRESET_OPTIONS, type ThemeMode, type ThemePreset } from "@/lib/preferences/theme";
import { applyThemePreset } from "@/lib/preferences/theme-utils";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { api } from "@/lib/api";

export function LayoutControls() {
  const [hidePenguin, setHidePenguin] = useState(false);
  const [uiLoaded, setUiLoaded] = useState(false);
  const [uiSaving, setUiSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .uiConfig()
      .then((cfg) => {
        if (!alive) return;
        setHidePenguin(cfg.hide_penguin);
        setUiLoaded(true);
      })
      .catch(() => {
        if (alive) setUiLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveHidePenguin = async (next: boolean) => {
    setUiSaving(true);
    try {
      const cfg = await api.saveUiConfig({ hide_penguin: next });
      setHidePenguin(cfg.hide_penguin);
      window.dispatchEvent(new CustomEvent("artex:ui-config", { detail: cfg }));
      toast.success(cfg.hide_penguin ? "已隐藏右下角企鹅水印" : "已显示右下角企鹅水印");
    } catch {
      toast.error("保存失败");
    } finally {
      setUiSaving(false);
    }
  };

  const themeMode = usePreferencesStore((s) => s.themeMode);
  const resolvedThemeMode = usePreferencesStore((s) => s.resolvedThemeMode);
  const setThemeMode = usePreferencesStore((s) => s.setThemeMode);
  const themePreset = usePreferencesStore((s) => s.themePreset);
  const setThemePreset = usePreferencesStore((s) => s.setThemePreset);
  const contentLayout = usePreferencesStore((s) => s.contentLayout);
  const setContentLayout = usePreferencesStore((s) => s.setContentLayout);
  const navbarStyle = usePreferencesStore((s) => s.navbarStyle);
  const setNavbarStyle = usePreferencesStore((s) => s.setNavbarStyle);
  const variant = usePreferencesStore((s) => s.sidebarVariant);
  const setSidebarVariant = usePreferencesStore((s) => s.setSidebarVariant);
  const collapsible = usePreferencesStore((s) => s.sidebarCollapsible);
  const setSidebarCollapsible = usePreferencesStore((s) => s.setSidebarCollapsible);
  const font = usePreferencesStore((s) => s.font);
  const setFont = usePreferencesStore((s) => s.setFont);

  const onThemePresetChange = (preset: ThemePreset) => {
    applyThemePreset(preset);
    setThemePreset(preset);
    void persistPreference("theme_preset", preset);
  };

  const onThemeModeChange = (mode: ThemeMode | "") => {
    if (!mode) return;
    setThemeMode(mode);
    void persistPreference("theme_mode", mode);
  };

  const onContentLayoutChange = (layout: ContentLayout | "") => {
    if (!layout) return;
    applyContentLayout(layout);
    setContentLayout(layout);
    void persistPreference("content_layout", layout);
  };

  const onNavbarStyleChange = (style: NavbarStyle | "") => {
    if (!style) return;
    applyNavbarStyle(style);
    setNavbarStyle(style);
    void persistPreference("navbar_style", style);
  };

  const onSidebarStyleChange = (value: SidebarVariant | "") => {
    if (!value) return;
    setSidebarVariant(value);
    applySidebarVariant(value);
    void persistPreference("sidebar_variant", value);
  };

  const onSidebarCollapseModeChange = (value: SidebarCollapsible | "") => {
    if (!value) return;
    setSidebarCollapsible(value);
    applySidebarCollapsible(value);
    void persistPreference("sidebar_collapsible", value);
  };

  const onFontChange = (value: FontKey | "") => {
    if (!value) return;
    applyFont(value);
    setFont(value);
    void persistPreference("font", value);
  };

  const handleRestore = () => {
    onThemePresetChange(PREFERENCE_DEFAULTS.theme_preset);
    onThemeModeChange(PREFERENCE_DEFAULTS.theme_mode);
    onContentLayoutChange(PREFERENCE_DEFAULTS.content_layout);
    onNavbarStyleChange(PREFERENCE_DEFAULTS.navbar_style);
    onSidebarStyleChange(PREFERENCE_DEFAULTS.sidebar_variant);
    onSidebarCollapseModeChange(PREFERENCE_DEFAULTS.sidebar_collapsible);
    onFontChange(PREFERENCE_DEFAULTS.font);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon">
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <h4 className="font-medium text-sm leading-none">外观与布局</h4>
            <p className="text-muted-foreground text-xs">调整工作台的配色、字体与布局。</p>
          </div>
          <div className="space-y-3 **:data-[slot=toggle-group]:w-full **:data-[slot=toggle-group-item]:flex-1 **:data-[slot=toggle-group-item]:text-xs">
            <div className="space-y-1">
              <Label className="font-medium text-xs">主题预设</Label>
              <p className="text-muted-foreground text-[11px] leading-snug">
                「默认（内置外观）」就是终末地皮肤；想换配色请选橘子／柔彩／粗野主义。
              </p>
              <Select value={themePreset} onValueChange={onThemePresetChange}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder="选择预设" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {THEME_PRESET_OPTIONS.map((preset) => (
                      <SelectItem key={preset.value} className="text-xs" value={preset.value}>
                        <span
                          className="size-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              (resolvedThemeMode ?? "light") === "dark" ? preset.primary.dark : preset.primary.light,
                          }}
                        />
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">字体</Label>
              <Select value={font} onValueChange={onFontChange}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue placeholder="选择字体" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {fontOptions.map((font) => (
                      <SelectItem key={font.key} className="text-xs" value={font.key}>
                        {font.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">外观模式</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={themeMode}
                onValueChange={onThemeModeChange}
              >
                <ToggleGroupItem value="light" aria-label="浅色">
                  浅色
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="深色">
                  深色
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label="跟随系统">
                  跟随系统
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">页面布局</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={contentLayout}
                onValueChange={onContentLayoutChange}
              >
                <ToggleGroupItem value="centered" aria-label="居中">
                  居中
                </ToggleGroupItem>
                <ToggleGroupItem value="full-width" aria-label="全宽">
                  全宽
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">导航栏行为</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={navbarStyle}
                onValueChange={onNavbarStyleChange}
              >
                <ToggleGroupItem value="sticky" aria-label="吸顶">
                  吸顶
                </ToggleGroupItem>
                <ToggleGroupItem value="scroll" aria-label="随滚动">
                  随滚动
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">侧栏样式</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={variant}
                onValueChange={onSidebarStyleChange}
              >
                <ToggleGroupItem value="inset" aria-label="内嵌">
                  内嵌
                </ToggleGroupItem>
                <ToggleGroupItem value="sidebar" aria-label="标准">
                  标准
                </ToggleGroupItem>
                <ToggleGroupItem value="floating" aria-label="悬浮">
                  悬浮
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">侧栏收起方式</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={collapsible}
                onValueChange={onSidebarCollapseModeChange}
              >
                <ToggleGroupItem value="icon" aria-label="仅图标">
                  仅图标
                </ToggleGroupItem>
                <ToggleGroupItem value="offcanvas" aria-label="抽屉">
                  抽屉
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="hide-penguin" className="font-medium text-xs">
                隐藏右下角水印
              </Label>
              <Switch
                id="hide-penguin"
                aria-label="隐藏右下角企鹅水印"
                checked={hidePenguin}
                disabled={!uiLoaded || uiSaving}
                onCheckedChange={(checked) => {
                  void saveHidePenguin(checked);
                }}
              />
            </div>

            <Button type="button" size="sm" variant="outline" className="w-full text-xs" onClick={handleRestore}>
              恢复默认
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
