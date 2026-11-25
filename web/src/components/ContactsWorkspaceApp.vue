<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { toast } from "vue-sonner";
import {
  ArrowLeftIcon,
  CheckIcon,
  ContactIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "@lucide/vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface StudioContact {
  id: string;
  name: string;
  role: "artist" | "clipper" | "editor" | "rigger" | "collab" | "sponsor" | "mod";
  handle: string;
  platform: string;
  status: "prospect" | "pitched" | "active" | "paused";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const ROLE_GROUPS: Array<{ id: "all" | StudioContact["role"]; label: string }> = [
  { id: "all", label: "All Contacts" },
  { id: "artist", label: "Artists" },
  { id: "clipper", label: "Clippers" },
  { id: "editor", label: "Editors" },
  { id: "rigger", label: "Riggers" },
  { id: "collab", label: "Collabs" },
  { id: "sponsor", label: "Sponsors" },
  { id: "mod", label: "Mods" },
];

const ROLE_LABELS: Record<StudioContact["role"], string> = {
  artist: "Thumbnail Artist",
  clipper: "Clipper",
  editor: "Editor",
  rigger: "Live2D / 3D Rigger",
  collab: "Collab Partner",
  sponsor: "Sponsor",
  mod: "Moderator",
};

const ROLE_AVATAR_CLASS: Record<StudioContact["role"], string> = {
  artist: "bg-amber-100 text-amber-900 border-amber-200",
  clipper: "bg-sky-100 text-sky-900 border-sky-200",
  editor: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rigger: "bg-purple-100 text-purple-900 border-purple-200",
  collab: "bg-violet-100 text-violet-900 border-violet-200",
  sponsor: "bg-rose-100 text-rose-900 border-rose-200",
  mod: "bg-slate-200 text-slate-900 border-slate-300",
};

const STATUS_BADGE_CLASS: Record<StudioContact["status"], string> = {
  active: "bg-emerald-100 text-emerald-800 border-emerald-200",
  prospect: "bg-secondary text-foreground border-border",
  pitched: "bg-[#f9f5a2] text-[#303030] border-[#e6e07d]",
  paused: "bg-muted text-muted-foreground border-border",
};

const props = defineProps<{
  refreshTick?: number;
}>();

const emit = defineEmits<{
  askPrompt: [prompt: string];
  contactsUpdated: [count: number];
}>();

const contacts = ref<StudioContact[]>([]);
const loading = ref(false);
const activeRole = ref<"all" | StudioContact["role"]>("all");
const statusFilter = ref<"all" | StudioContact["status"]>("all");
const searchQuery = ref("");
const selectedId = ref<string | null>(null);
const mobileDetailOpen = ref(false);

// Inline editing state
const editing = ref(false);
const editName = ref("");
const editRole = ref<StudioContact["role"]>("artist");
const editStatus = ref<StudioContact["status"]>("active");
const editHandle = ref("");
const editPlatform = ref("");
const editNotes = ref("");
const savingEdit = ref(false);

// New contact modal state
const newModalOpen = ref(false);
const newName = ref("");
const newRole = ref<StudioContact["role"]>("artist");
const newStatus = ref<StudioContact["status"]>("active");
const newHandle = ref("");
const newPlatform = ref("");
const newNotes = ref("");
const creating = ref(false);

// Delete confirm state
const pendingDelete = ref<StudioContact | null>(null);
const deleting = ref(false);

const roleCounts = computed(() => {
  const counts: Record<string, number> = { all: contacts.value.length };
  for (const r of ROLE_GROUPS) {
    if (r.id !== "all") counts[r.id] = 0;
  }
  for (const c of contacts.value) {
    counts[c.role] = (counts[c.role] || 0) + 1;
  }
  return counts;
});

const activeCount = computed(
  () => contacts.value.filter((c) => c.status === "active").length
);

const filteredContacts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return contacts.value
    .filter((c) => {
      if (activeRole.value !== "all" && c.role !== activeRole.value) return false;
      if (statusFilter.value !== "all" && c.status !== statusFilter.value) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q) ||
        c.platform.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
});

const selectedContact = computed(
  () => contacts.value.find((c) => c.id === selectedId.value) || null
);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

async function fetchContacts() {
  loading.value = true;
  try {
    const res = await fetch("/api/db/contacts");
    if (res.ok) {
      const data = (await res.json()) as { contacts?: StudioContact[] };
      contacts.value = Array.isArray(data.contacts) ? data.contacts : [];
      emit("contactsUpdated", contacts.value.length);
      if (selectedId.value && !contacts.value.some((c) => c.id === selectedId.value)) {
        selectedId.value = filteredContacts.value[0]?.id ?? null;
      } else if (!selectedId.value && filteredContacts.value.length > 0) {
        selectedId.value = filteredContacts.value[0].id;
      }
    }
  } finally {
    loading.value = false;
  }
}

function selectContact(c: StudioContact) {
  selectedId.value = c.id;
  editing.value = false;
  mobileDetailOpen.value = true;
}

function startEditing(c: StudioContact) {
  editName.value = c.name;
  editRole.value = c.role;
  editStatus.value = c.status;
  editHandle.value = c.handle;
  editPlatform.value = c.platform;
  editNotes.value = c.notes;
  editing.value = true;
}

async function saveEdit() {
  if (!selectedContact.value || !editName.value.trim() || savingEdit.value) return;
  savingEdit.value = true;
  try {
    const res = await fetch(`/api/db/contacts/${encodeURIComponent(selectedContact.value.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.value.trim(),
        role: editRole.value,
        status: editStatus.value,
        handle: editHandle.value.trim(),
        platform: editPlatform.value.trim(),
        notes: editNotes.value.trim(),
      }),
    });
    if (!res.ok) {
      toast.error("Could not update contact");
      return;
    }
    editing.value = false;
    toast.success(`Updated ${editName.value.trim()}`);
    await fetchContacts();
  } finally {
    savingEdit.value = false;
  }
}

async function patchStatus(c: StudioContact, nextStatus: StudioContact["status"]) {
  const res = await fetch(`/api/db/contacts/${encodeURIComponent(c.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: nextStatus }),
  });
  if (res.ok) {
    await fetchContacts();
  }
}

function openNewContactModal() {
  newName.value = "";
  newRole.value = activeRole.value === "all" ? "artist" : activeRole.value;
  newStatus.value = "active";
  newHandle.value = "";
  newPlatform.value = "";
  newNotes.value = "";
  newModalOpen.value = true;
}

async function submitNewContact() {
  if (!newName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    const res = await fetch("/api/db/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.value.trim(),
        role: newRole.value,
        status: newStatus.value,
        handle: newHandle.value.trim(),
        platform: newPlatform.value.trim(),
        notes: newNotes.value.trim(),
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      contact?: StudioContact;
      error?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      toast.error(data?.error || "Could not create contact");
      return;
    }
    newModalOpen.value = false;
    toast.success(`Added ${newName.value.trim()}`);
    await fetchContacts();
    if (data.contact?.id) {
      selectedId.value = data.contact.id;
      mobileDetailOpen.value = true;
    }
  } finally {
    creating.value = false;
  }
}

async function confirmDelete() {
  if (!pendingDelete.value || deleting.value) return;
  deleting.value = true;
  const target = pendingDelete.value;
  try {
    const res = await fetch(`/api/db/contacts/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      pendingDelete.value = null;
      if (selectedId.value === target.id) {
        selectedId.value = null;
        mobileDetailOpen.value = false;
      }
      toast.success(`Removed ${target.name}`);
      await fetchContacts();
    }
  } finally {
    deleting.value = false;
  }
}

async function copyHandle(handle: string) {
  if (!handle) return;
  try {
    await navigator.clipboard.writeText(handle);
    toast.success(`Copied ${handle}`);
  } catch {
    toast.error("Clipboard copy denied");
  }
}

function draftOutreach(c: StudioContact) {
  emit(
    "askPrompt",
    `Draft a clear, zero-friction ${c.role === "collab" ? "collab pitch" : "brief / outreach message"} for ${c.name} (${c.role}${c.handle ? `, ${c.handle}` : ""}${c.platform ? ` on ${c.platform}` : ""}).`
  );
}

watch(
  () => props.refreshTick,
  () => {
    void fetchContacts();
  },
  { immediate: true }
);

onMounted(() => {
  void fetchContacts();
});

defineExpose({ fetchContacts, openNewContactModal });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white select-none">
    <!-- TOP OS CONTACTS TOOLBAR -->
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[#ededed] bg-[#fafafa] px-3.5 py-2 shrink-0">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <InputGroup class="w-full max-w-xs h-8 rounded-lg bg-white border-[#e3e3e3]">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            v-model="searchQuery"
            type="text"
            placeholder="Search contacts, @handles, platforms…"
            class="text-xs h-8"
          />
          <InputGroupAddon v-if="searchQuery" align="inline-end">
            <InputGroupButton
              size="icon-xs"
              variant="ghost"
              aria-label="Clear search"
              @click="searchQuery = ''"
            >
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <Select v-model="statusFilter">
          <SelectTrigger class="h-8 w-28 rounded-lg bg-white text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="pitched">Pitched</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          class="h-8 rounded-lg"
          @click="openNewContactModal"
        >
          <PlusIcon class="size-3.5" />
          <span>New Contact</span>
        </Button>
      </div>
    </div>

    <!-- 3-PANE OS CONTACTS BODY -->
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <!-- PANE 1: GROUPS SIDEBAR -->
      <aside class="hidden md:flex w-48 shrink-0 flex-col border-r border-[#ededed] bg-[#f7f7f8]">
        <div class="px-3.5 pt-3 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Groups
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
          <button
            v-for="group in ROLE_GROUPS"
            :key="group.id"
            type="button"
            :class="
              cn(
                'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                activeRole === group.id
                  ? 'bg-black/[0.08] font-medium text-[#141414]'
                  : 'text-[#525252] hover:bg-black/[0.04] hover:text-[#141414]'
              )
            "
            @click="activeRole = group.id"
          >
            <span class="truncate">{{ group.label }}</span>
            <span class="font-mono text-[10.5px] text-muted-foreground">
              {{ roleCounts[group.id] ?? 0 }}
            </span>
          </button>
        </div>
        <div class="shrink-0 border-t border-[#ededed] px-3 py-2 font-mono text-[10.5px] text-muted-foreground flex items-center justify-between">
          <span>{{ contacts.length }} total</span>
          <span>{{ activeCount }} active</span>
        </div>
      </aside>

      <!-- PANE 2: CONTACT LIST -->
      <div
        :class="
          cn(
            'w-full md:w-64 lg:w-72 shrink-0 border-r border-[#ededed] bg-white flex-col min-h-0',
            mobileDetailOpen && selectedContact ? 'hidden md:flex' : 'flex'
          )
        "
      >
        <!-- Mobile group strip -->
        <div class="flex md:hidden items-center gap-1 overflow-x-auto border-b border-[#ededed] bg-[#fafafa] px-3 py-1.5 shrink-0">
          <button
            v-for="group in ROLE_GROUPS"
            :key="`mob-${group.id}`"
            type="button"
            :class="
              cn(
                'shrink-0 rounded-md px-2 py-1 font-mono text-[11px] transition-colors',
                activeRole === group.id
                  ? 'bg-[#303030] text-white font-medium'
                  : 'text-muted-foreground hover:bg-black/5'
              )
            "
            @click="activeRole = group.id"
          >
            {{ group.label }} ({{ roleCounts[group.id] ?? 0 }})
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f3f3f4]">
          <div
            v-if="filteredContacts.length === 0"
            class="flex h-full min-h-[220px] flex-col items-center justify-center p-6 text-center gap-2.5"
          >
            <UsersIcon class="size-7 text-muted-foreground/45" />
            <div class="text-xs font-medium text-[#303030]">
              {{ searchQuery.trim() ? "No matching contacts" : "No contacts in this group" }}
            </div>
            <p class="text-[11.5px] text-muted-foreground max-w-[200px]">
              Add thumbnail artists, clippers, editors, riggers, collabs, or sponsors.
            </p>
            <Button type="button" size="xs" variant="outline" @click="openNewContactModal">
              <PlusIcon class="size-3" />
              New Contact
            </Button>
          </div>

          <button
            v-for="c in filteredContacts"
            :key="c.id"
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
                selectedContact?.id === c.id
                  ? 'bg-[#f9f5a2]/60'
                  : 'hover:bg-[#f6f6f7]'
              )
            "
            @click="selectContact(c)"
          >
            <span
              :class="
                cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold',
                  ROLE_AVATAR_CLASS[c.role]
                )
              "
            >
              {{ initials(c.name) }}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-1.5">
                <span class="truncate text-xs font-semibold text-[#141414]">{{ c.name }}</span>
                <span class="font-mono text-[10px] uppercase text-muted-foreground shrink-0">
                  {{ c.role }}
                </span>
              </div>
              <div class="truncate font-mono text-[11px] text-muted-foreground">
                {{ c.handle || c.platform || ROLE_LABELS[c.role] }}
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- PANE 3: CONTACT CARD DETAIL / EDITOR -->
      <div
        :class="
          cn(
            'flex-1 min-w-0 min-h-0 flex-col bg-white overflow-y-auto',
            mobileDetailOpen && selectedContact ? 'flex' : 'hidden md:flex'
          )
        "
      >
        <div v-if="selectedContact" class="flex flex-col p-5 sm:p-7 max-w-2xl w-full mx-auto gap-6">
          <!-- Mobile Back button -->
          <div class="md:hidden -mt-1 -mb-2">
            <Button type="button" size="xs" variant="ghost" @click="mobileDetailOpen = false">
              <ArrowLeftIcon class="size-3.5" />
              All Contacts
            </Button>
          </div>

          <!-- Contact Card Header -->
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="flex items-center gap-4 min-w-0">
              <span
                :class="
                  cn(
                    'flex size-16 shrink-0 items-center justify-center rounded-full border text-lg font-mono font-semibold',
                    ROLE_AVATAR_CLASS[selectedContact.role]
                  )
                "
              >
                {{ initials(selectedContact.name) }}
              </span>
              <div class="min-w-0 space-y-1">
                <h2 class="text-lg font-semibold text-[#141414] truncate">
                  {{ selectedContact.name }}
                </h2>
                <div class="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" class="font-mono text-[10.5px]">
                    {{ ROLE_LABELS[selectedContact.role] }}
                  </Badge>
                  <span
                    :class="
                      cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] capitalize',
                        STATUS_BADGE_CLASS[selectedContact.status]
                      )
                    "
                  >
                    {{ selectedContact.status }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <Button
                v-if="!editing"
                type="button"
                size="xs"
                variant="outline"
                @click="startEditing(selectedContact)"
              >
                <PencilIcon class="size-3" />
                Edit
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                class="text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete contact"
                @click="pendingDelete = selectedContact"
              >
                <Trash2Icon class="size-3.5" />
              </Button>
            </div>
          </div>

          <!-- Quick Action Row -->
          <div v-if="!editing" class="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" @click="draftOutreach(selectedContact)">
              <SparklesIcon class="size-3.5" />
              Draft Outreach with Otto
            </Button>
            <Button
              v-if="selectedContact.handle"
              type="button"
              size="sm"
              variant="outline"
              @click="copyHandle(selectedContact.handle)"
            >
              <CopyIcon class="size-3.5" />
              Copy {{ selectedContact.handle }}
            </Button>
            <Select
              :model-value="selectedContact.status"
              @update:model-value="(val) => { if (typeof val === 'string' && selectedContact) patchStatus(selectedContact, val as StudioContact['status']); }"
            >
              <SelectTrigger class="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="prospect">Prospect</SelectItem>
                  <SelectItem value="pitched">Pitched</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <!-- View Mode: Structured OS Contact Fields -->
          <div
            v-if="!editing"
            class="rounded-2xl border border-[#ededed] bg-[#fafafa] divide-y divide-[#ededed] overflow-hidden"
          >
            <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-3 text-xs">
              <span class="font-mono text-muted-foreground">Handle / Email</span>
              <span class="font-mono text-[#141414] break-all">
                {{ selectedContact.handle || "—" }}
              </span>
            </div>
            <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-3 text-xs">
              <span class="font-mono text-muted-foreground">Platform</span>
              <span class="text-[#141414]">{{ selectedContact.platform || "—" }}</span>
            </div>
            <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-3 text-xs">
              <span class="font-mono text-muted-foreground">Role</span>
              <span class="text-[#141414]">{{ ROLE_LABELS[selectedContact.role] }}</span>
            </div>
            <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-3 text-xs">
              <span class="font-mono text-muted-foreground">Notes</span>
              <span class="text-[#141414] whitespace-pre-wrap leading-relaxed">
                {{ selectedContact.notes || "No rates or notes added yet." }}
              </span>
            </div>
            <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-2.5 text-[11px]">
              <span class="font-mono text-muted-foreground">Updated</span>
              <span class="font-mono text-muted-foreground">
                {{ formatDate(selectedContact.updatedAt) }}
              </span>
            </div>
          </div>

          <!-- Inline Edit Mode -->
          <form v-else class="rounded-2xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3" @submit.prevent="saveEdit">
            <FieldGroup>
              <Field>
                <FieldLabel class="font-mono text-xs">Name</FieldLabel>
                <Input v-model="editName" type="text" required class="bg-white text-xs" />
              </Field>
              <div class="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel class="font-mono text-xs">Role</FieldLabel>
                  <Select v-model="editRole">
                    <SelectTrigger class="w-full bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="artist">Artist</SelectItem>
                        <SelectItem value="clipper">Clipper</SelectItem>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="rigger">Rigger</SelectItem>
                        <SelectItem value="collab">Collab</SelectItem>
                        <SelectItem value="sponsor">Sponsor</SelectItem>
                        <SelectItem value="mod">Mod</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel class="font-mono text-xs">Status</FieldLabel>
                  <Select v-model="editStatus">
                    <SelectTrigger class="w-full bg-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="prospect">Prospect</SelectItem>
                        <SelectItem value="pitched">Pitched</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="paused">Paused</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel class="font-mono text-xs">Handle / Email</FieldLabel>
                  <Input v-model="editHandle" type="text" placeholder="@handle or email" class="bg-white text-xs" />
                </Field>
                <Field>
                  <FieldLabel class="font-mono text-xs">Platform</FieldLabel>
                  <Input v-model="editPlatform" type="text" placeholder="X, VGen, Discord, YT" class="bg-white text-xs" />
                </Field>
              </div>
              <Field>
                <FieldLabel class="font-mono text-xs">Notes</FieldLabel>
                <Textarea v-model="editNotes" rows="3" placeholder="Rates, turnaround, vibe, links…" class="bg-white text-xs" />
              </Field>
            </FieldGroup>

            <div class="flex items-center justify-end gap-2 pt-1">
              <Button type="button" size="sm" variant="ghost" :disabled="savingEdit" @click="editing = false">
                Cancel
              </Button>
              <Button type="submit" size="sm" :disabled="!editName.trim() || savingEdit">
                <CheckIcon class="size-3.5" />
                {{ savingEdit ? "Saving…" : "Save Changes" }}
              </Button>
            </div>
          </form>
        </div>

        <!-- Empty Detail Pane -->
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center p-8 text-center gap-3"
        >
          <div class="flex size-12 items-center justify-center rounded-2xl bg-[#f5f5f7] border border-[#ededed]">
            <ContactIcon class="size-6 text-[#303030]" />
          </div>
          <div class="text-sm font-semibold text-[#141414]">Studio Contacts</div>
          <p class="text-xs text-muted-foreground max-w-xs leading-relaxed">
            Keep your human thumbnail artists, clippers, editors, riggers, collabs, and sponsors in one place.
          </p>
          <Button type="button" size="sm" @click="openNewContactModal">
            <PlusIcon class="size-3.5" />
            New Contact
          </Button>
        </div>
      </div>
    </div>

    <!-- NEW CONTACT DIALOG -->
    <Dialog v-model:open="newModalOpen">
      <DialogContent class="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle class="text-sm font-semibold">New Contact</DialogTitle>
          <DialogDescription class="text-xs">
            Add a collaborator, artist, clipper, editor, sponsor, or moderator to your studio rolodex.
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="submitNewContact">
          <FieldGroup>
            <Field>
              <FieldLabel for="contact-new-name" class="font-mono text-xs">Name</FieldLabel>
              <Input
                id="contact-new-name"
                v-model="newName"
                type="text"
                placeholder="e.g. Himeko"
                required
                autofocus
              />
            </Field>
            <div class="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel class="font-mono text-xs">Role</FieldLabel>
                <Select v-model="newRole">
                  <SelectTrigger class="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="artist">Artist</SelectItem>
                      <SelectItem value="clipper">Clipper</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="rigger">Rigger</SelectItem>
                      <SelectItem value="collab">Collab</SelectItem>
                      <SelectItem value="sponsor">Sponsor</SelectItem>
                      <SelectItem value="mod">Mod</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel class="font-mono text-xs">Status</FieldLabel>
                <Select v-model="newStatus">
                  <SelectTrigger class="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="prospect">Prospect</SelectItem>
                      <SelectItem value="pitched">Pitched</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel class="font-mono text-xs">Handle / Email</FieldLabel>
                <Input v-model="newHandle" type="text" placeholder="@handle / email" class="text-xs" />
              </Field>
              <Field>
                <FieldLabel class="font-mono text-xs">Platform</FieldLabel>
                <Input v-model="newPlatform" type="text" placeholder="X, VGen, Discord" class="text-xs" />
              </Field>
            </div>
            <Field>
              <FieldLabel class="font-mono text-xs">Notes (optional)</FieldLabel>
              <Textarea v-model="newNotes" rows="2" placeholder="Rates, turnaround, vibe…" class="text-xs" />
            </Field>
          </FieldGroup>
          <DialogFooter class="pt-2">
            <Button type="button" variant="secondary" size="sm" :disabled="creating" @click="newModalOpen = false">
              Cancel
            </Button>
            <Button type="submit" size="sm" :disabled="!newName.trim() || creating">
              {{ creating ? "Saving…" : "Save Contact" }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- DELETE CONFIRM DIALOG -->
    <AlertDialog :open="Boolean(pendingDelete)" @update:open="(open) => { if (!open) pendingDelete = null; }">
      <AlertDialogContent class="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle class="text-sm font-semibold">
            Delete {{ pendingDelete?.name }}?
          </AlertDialogTitle>
          <AlertDialogDescription class="text-xs">
            This removes <strong>{{ pendingDelete?.name }}</strong> from your Studio Contacts rolodex. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" :disabled="deleting" @click.prevent="confirmDelete">
            {{ deleting ? "Deleting…" : "Delete" }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
