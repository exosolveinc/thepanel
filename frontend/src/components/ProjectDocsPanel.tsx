/**
 * ProjectDocsPanel — global project document store.
 * Upload PDFs once; they're semantically chunked, embedded via Bedrock Titan,
 * and available to HMV + HMT via RAG across all sessions.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, FileText, Trash2, Loader2, FolderOpen } from 'lucide-react'
import { uploadProjectDoc, listProjectDocs, deleteProjectDoc } from '../api/client'

interface StoredDoc {
  doc_id: string
  filename: string
  created_at: string
}

export default function ProjectDocsPanel() {
  const [docs, setDocs]             = useState<StoredDoc[]>([])
  const [loading, setLoading]       = useState(true)
  const [uploading, setUploading]   = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError]           = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listProjectDocs()
      .then(setDocs)
      .finally(() => setLoading(false))
  }, [])

  const handleFiles = useCallback(async (files: File[]) => {
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) { setError('Only PDF files are accepted.'); return }
    setError('')
    setUploading(true)
    for (const file of pdfs) {
      try {
        const res = await uploadProjectDoc(file)
        if (!res.existed) {
          setDocs(prev => [
            { doc_id: res.doc_id, filename: res.filename, created_at: new Date().toISOString() },
            ...prev,
          ])
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : `Failed to upload ${file.name}.`)
        break
      }
    }
    setUploading(false)
  }, [])

  const handleDelete = async (docId: string) => {
    setDeletingId(docId)
    try {
      await deleteProjectDoc(docId)
      setDocs(prev => prev.filter(d => d.doc_id !== docId))
    } catch {
      setError('Failed to delete document.')
    }
    setDeletingId(null)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-12 border-b border-zinc-800/50 shrink-0">
        <FolderOpen size={13} className="text-violet-400" />
        <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Project Docs</span>
        <span className="text-[10px] text-zinc-600">· used by HMV and HMT for RAG-powered answers</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 min-h-0">

        {/* Upload zone */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={[
            'border-2 border-dashed rounded-xl px-6 py-8 text-center transition-colors',
            uploading ? 'cursor-default border-violet-600/40 bg-violet-500/5' :
              isDragging ? 'cursor-pointer border-violet-500/60 bg-violet-500/5' :
                'cursor-pointer border-zinc-700 hover:border-zinc-600 hover:bg-zinc-900/40',
          ].join(' ')}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={20} className="text-violet-400 animate-spin" />
              <p className="text-[11px] text-zinc-400">Processing and embedding chunks…</p>
            </div>
          ) : (
            <>
              <Upload size={20} className="mx-auto mb-2 text-zinc-600" />
              <p className="text-[11px] text-zinc-400">
                Drop PDFs here or <span className="text-violet-400">click to browse</span>
              </p>
              <p className="text-[10px] text-zinc-600 mt-1">PDF only · max 10 MB · multiple files OK</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={e => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
          />
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        {/* Stored docs */}
        <div className="space-y-2">
          <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
            Stored Documents {!loading && `(${docs.length})`}
          </p>

          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-zinc-900/60 animate-pulse" />
            ))
          ) : docs.length === 0 ? (
            <p className="text-[11px] text-zinc-600 italic py-2">No documents uploaded yet</p>
          ) : (
            docs.map(doc => (
              <div
                key={doc.doc_id}
                className="flex items-center gap-2.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2"
              >
                <FileText size={11} className="text-violet-400 shrink-0" />
                <span className="text-[11px] text-zinc-300 flex-1 truncate">{doc.filename}</span>
                <span className="text-[9px] text-zinc-600 shrink-0">
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDelete(doc.doc_id)}
                  disabled={deletingId === doc.doc_id}
                  className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                  title="Delete document"
                >
                  {deletingId === doc.doc_id
                    ? <Loader2 size={10} className="animate-spin" />
                    : <Trash2 size={10} />
                  }
                </button>
              </div>
            ))
          )}
        </div>

        <p className="text-[10px] text-zinc-700 leading-relaxed">
          Uploaded PDFs are chunked semantically, embedded with AWS Bedrock Titan, and stored in Supabase.
          HMV and HMT surface only the most relevant excerpts when answering each question.
        </p>
      </div>
    </div>
  )
}
