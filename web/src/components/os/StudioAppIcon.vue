<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  AppWindow,
  CalendarDays,
  Contact,
  Database,
  FolderOpen,
  Globe,
  Layers,
  LayoutDashboard,
  MessageSquare,
  MonitorPlay,
  Settings,
  Sparkles,
} from "@lucide/vue";
import type { StudioAppIconName } from "@/composables/useWindowManager";

const props = withDefaults(
  defineProps<{
    icon: StudioAppIconName;
    class?: string;
  }>(),
  {
    class: "size-4",
  }
);

const ICON_MAP: Record<StudioAppIconName, Component> = {
  message: MessageSquare,
  layout: LayoutDashboard,
  folder: FolderOpen,
  layers: Layers,
  tv: MonitorPlay,
  app: AppWindow,
  globe: Globe,
  database: Database,
  sparkles: Sparkles,
  calendar: CalendarDays,
  contacts: Contact,
  settings: Settings,
};

const resolvedIcon = computed(() => ICON_MAP[props.icon] ?? LayoutDashboard);
</script>

<template>
  <component :is="resolvedIcon" :class="props.class" aria-hidden="true" />
</template>
