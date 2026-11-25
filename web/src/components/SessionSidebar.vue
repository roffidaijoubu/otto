<script setup lang="ts">
import { MessageSquareIcon, PlusIcon } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "../types/chat";

const props = defineProps<{
  open: boolean;
  sessions: SessionSummary[];
  busy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  newChat: [];
  select: [session: SessionSummary];
}>();

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function onOpenChange(next: boolean) {
  if (!next) emit("close");
}
</script>

<template>
  <Sheet :open="props.open" @update:open="onOpenChange">
    <SheetContent side="right" class="w-full sm:max-w-sm p-0 gap-0">
      <SheetHeader class="border-b border-border px-4 py-3 pr-12">
        <div class="flex items-center justify-between gap-2">
          <SheetTitle class="font-mono text-xs font-medium tracking-wide">
            (Y)our chats.
          </SheetTitle>
          <Button size="xs" type="button" :disabled="busy" @click="emit('newChat')">
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
        </div>
        <SheetDescription class="sr-only">
          Switch between previous Otto studio chat sessions or start a new conversation.
        </SheetDescription>
      </SheetHeader>

      <ScrollArea class="flex-1 min-h-0">
        <div class="flex flex-col gap-1.5 p-3">
          <Empty v-if="sessions.length === 0" class="border-0 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageSquareIcon />
              </EmptyMedia>
              <EmptyTitle class="font-mono text-xs">No previous chats yet.</EmptyTitle>
              <EmptyDescription class="text-xs">
                Start a conversation with Otto to keep your session history here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>

          <button
            v-for="s in sessions"
            :key="s.path"
            type="button"
            :disabled="busy || s.active"
            :class="
              cn(
                'flex flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-default',
                s.active
                  ? 'bg-highlight-yellow text-foreground'
                  : 'bg-secondary/70 text-foreground hover:bg-accent'
              )
            "
            @click="emit('select', s)"
          >
            <span class="truncate text-xs font-medium">{{ s.title }}</span>
            <span class="font-mono text-[10.5px] text-muted-foreground">
              {{ formatTime(s.updatedAt) }} · {{ s.messageCount }} msgs
            </span>
          </button>
        </div>
      </ScrollArea>
    </SheetContent>
  </Sheet>
</template>
