import { useState } from 'react'
import { useSessionStore } from './store/sessionStore'
import { recordSession } from './utils/storage'
import Setup from './pages/Setup'
import Interview from './pages/Interview'

export default function App() {
  const { sessionId, reset } = useSessionStore()
  const [phase, setPhase] = useState<'setup' | 'interview'>('setup')

  const handleReady = () => setPhase('interview')

  const handleReset = () => {
    // Snapshot before clearing (getState() bypasses stale closure)
    const { sessionId: sid, messages, resumeId, resumeTag, jdId, jdLabel } =
      useSessionStore.getState()
    const userMsgs = messages.filter(m => m.role === 'user')
    if (sid && userMsgs.length > 0) {
      recordSession({
        id: sid,
        resumeId,
        resumeTag,
        jdId,
        jdLabel,
        questionCount: userMsgs.length,
        lastQuestion: userMsgs[userMsgs.length - 1].content,
      })
    }
    reset()
    setPhase('setup')
  }

  if (phase === 'interview' && sessionId) {
    return <Interview onReset={handleReset} />
  }

  return <Setup onReady={handleReady} />
}
