import { create } from 'zustand'
import type { SessionMessage } from '../api/client'

export interface DesignComponent {
  id: string
  name: string
  description: string
  tech: string[]
  x: number
  y: number
}

export interface DesignConnection {
  id: string
  source: string
  target: string
  label?: string
}

export interface DesignStructure {
  title: string
  summary: string
  components: DesignComponent[]
  connections: DesignConnection[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: 'basic' | 'behavioral' | 'system_design'
  mode?: 'quick' | 'long' | 'design'
  design?: DesignStructure
  streaming?: boolean
}

interface SessionState {
  sessionId: string | null
  messages: Message[]
  currentDesign: DesignStructure | null
  isStreaming: boolean
  selectedComponent: DesignComponent | null
  drillContent: string
  isDrilling: boolean
  drillDepth: number
  breadcrumb: string[]

  // Session metadata (for history)
  resumeId: string
  resumeTag: string
  jdId: string
  jdLabel: string

  // Live-input preview (SituationPanel auto-answer while user types)
  liveInputText: string
  livePreview: string
  isLivePreviewing: boolean

  // Deep dives — keyed by question text
  deepDives: Record<string, { content: string; streaming: boolean }>

  // Architecture flows — keyed by question text
  archFlows: Record<string, { content: string; streaming: boolean }>

  // Actions
  setSessionId: (id: string) => void
  setSessionMeta: (resumeId: string, resumeTag: string, jdId: string, jdLabel: string) => void
  addMessage: (msg: Message) => void
  appendToLastMessage: (text: string) => void
  setLastMessageDesign: (design: DesignStructure) => void
  finalizeLastMessage: () => void
  setCurrentDesign: (design: DesignStructure) => void
  setSelectedComponent: (comp: DesignComponent | null) => void
  appendDrillContent: (text: string) => void
  startDrill: (component: DesignComponent, depth: number) => void
  finalizeDrill: () => void
  pushBreadcrumb: (name: string) => void
  popBreadcrumb: () => void
  setLiveInput: (text: string) => void
  appendLivePreview: (text: string) => void
  clearLivePreview: () => void
  setIsLivePreviewing: (v: boolean) => void
  startDeepDive: (topic: string) => void
  appendDeepDive: (topic: string, text: string) => void
  finalizeDeepDive: (topic: string) => void
  startArchFlow: (question: string) => void
  appendArchFlow: (question: string, text: string) => void
  finalizeArchFlow: (question: string) => void
  loadSession: (id: string, meta: { resumeId: string; resumeTag: string; jdId: string; jdLabel: string }, msgs: SessionMessage[]) => void
  reset: () => void
}

const makeId = () => Math.random().toString(36).slice(2)

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  messages: [],
  currentDesign: null,
  isStreaming: false,
  selectedComponent: null,
  drillContent: '',
  isDrilling: false,
  drillDepth: 1,
  breadcrumb: [],
  resumeId: '',
  resumeTag: '',
  jdId: '',
  jdLabel: '',
  liveInputText: '',
  livePreview: '',
  isLivePreviewing: false,
  deepDives: {},
  archFlows: {},

  setSessionId: (id) => set({ sessionId: id }),
  setSessionMeta: (resumeId, resumeTag, jdId, jdLabel) => set({ resumeId, resumeTag, jdId, jdLabel }),

  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg], isStreaming: msg.streaming ?? false })),

  appendToLastMessage: (text) =>
    set((s) => {
      const msgs = [...s.messages]
      if (msgs.length === 0) return s
      const last = msgs[msgs.length - 1]
      msgs[msgs.length - 1] = { ...last, content: last.content + text }
      return { messages: msgs }
    }),

  setLastMessageDesign: (design) =>
    set((s) => {
      const msgs = [...s.messages]
      if (msgs.length === 0) return s
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], design }
      return { messages: msgs, currentDesign: design }
    }),

  finalizeLastMessage: () =>
    set((s) => {
      const msgs = [...s.messages]
      if (msgs.length === 0) return s
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], streaming: false }
      const lastType = msgs[msgs.length - 1].type
      // Clear design + drill whenever the finished answer is NOT a system_design
      // (includes undefined type — if classification event was delayed/missed)
      const clearDesign = lastType !== 'system_design'
      return {
        messages: msgs,
        isStreaming: false,
        ...(clearDesign ? { currentDesign: null, selectedComponent: null } : {}),
      }
    }),

  setCurrentDesign: (design) => set({ currentDesign: design }),

  setSelectedComponent: (comp) =>
    set({ selectedComponent: comp, drillContent: '', isDrilling: false }),

  startDrill: (component, depth) =>
    set({ selectedComponent: component, drillContent: '', isDrilling: true, drillDepth: depth }),

  appendDrillContent: (text) =>
    set((s) => ({ drillContent: s.drillContent + text })),

  finalizeDrill: () => set({ isDrilling: false }),

  pushBreadcrumb: (name) =>
    set((s) => ({ breadcrumb: [...s.breadcrumb, name] })),

  popBreadcrumb: () =>
    set((s) => ({ breadcrumb: s.breadcrumb.slice(0, -1) })),

  setLiveInput: (text) => set({ liveInputText: text }),
  appendLivePreview: (text) => set((s) => ({ livePreview: s.livePreview + text })),
  clearLivePreview: () => set({ livePreview: '', isLivePreviewing: false }),
  setIsLivePreviewing: (v) => set({ isLivePreviewing: v }),

  startDeepDive: (topic) =>
    set((s) => ({ deepDives: { ...s.deepDives, [topic]: { content: '', streaming: true } } })),

  appendDeepDive: (topic, text) =>
    set((s) => {
      const existing = s.deepDives[topic] ?? { content: '', streaming: true }
      return { deepDives: { ...s.deepDives, [topic]: { ...existing, content: existing.content + text } } }
    }),

  finalizeDeepDive: (topic) =>
    set((s) => {
      const existing = s.deepDives[topic]
      if (!existing) return s
      return { deepDives: { ...s.deepDives, [topic]: { ...existing, streaming: false } } }
    }),

  startArchFlow: (question) =>
    set((s) => ({ archFlows: { ...s.archFlows, [question]: { content: '', streaming: true } } })),

  appendArchFlow: (question, text) =>
    set((s) => {
      const existing = s.archFlows[question] ?? { content: '', streaming: true }
      return { archFlows: { ...s.archFlows, [question]: { ...existing, content: existing.content + text } } }
    }),

  finalizeArchFlow: (question) =>
    set((s) => {
      const existing = s.archFlows[question]
      if (!existing) return s
      return { archFlows: { ...s.archFlows, [question]: { ...existing, streaming: false } } }
    }),

  loadSession: (id, meta, msgs) => {
    // Convert backend messages to frontend Message format
    const messages: Message[] = msgs.map((m) => {
      const msg: Message = {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        streaming: false,
      }
      if (m.message_type) msg.type = m.message_type as Message['type']
      if (m.mode) msg.mode = m.mode as Message['mode']
      if (m.design_data) msg.design = m.design_data as unknown as DesignStructure
      return msg
    })

    // Find the latest design from messages
    let currentDesign: DesignStructure | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].design) {
        currentDesign = messages[i].design!
        break
      }
    }

    set({
      sessionId: id,
      messages,
      currentDesign,
      isStreaming: false,
      selectedComponent: null,
      drillContent: '',
      isDrilling: false,
      drillDepth: 1,
      breadcrumb: [],
      resumeId: meta.resumeId,
      resumeTag: meta.resumeTag,
      jdId: meta.jdId,
      jdLabel: meta.jdLabel,
      liveInputText: '',
      livePreview: '',
      isLivePreviewing: false,
      deepDives: {},
      archFlows: {},
    })
  },

  reset: () =>
    set({
      sessionId: null,
      messages: [],
      currentDesign: null,
      isStreaming: false,
      selectedComponent: null,
      drillContent: '',
      isDrilling: false,
      drillDepth: 1,
      breadcrumb: [],
      resumeId: '',
      resumeTag: '',
      jdId: '',
      jdLabel: '',
      liveInputText: '',
      livePreview: '',
      isLivePreviewing: false,
      deepDives: {},
      archFlows: {},
    }),
}))

export { makeId }
