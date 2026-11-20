import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImageIcon, X } from 'lucide-react'
import type { ChatImage } from './chat-fold'

/** Thumbnails of the images a message carries; a click shows one full size. */
export function ChatImages({ images, label }: { images: ChatImage[]; label: string }) {
  const [open, setOpen] = useState<number | null>(null)
  if (images.length === 0) return null
  const drawable = images.filter((image): image is { src: string } => image.src !== null)
  const others = images.length - drawable.length
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {drawable.map((image, i) => (
        <button
          key={i}
          onClick={() => setOpen(i)}
          title="Agrandir"
          aria-label={`${label} ${i + 1}, agrandir`}
          className="h-20 max-w-40 overflow-hidden rounded-md border border-line bg-bg hover:border-accent/60"
        >
          <img src={image.src} alt="" className="h-full w-auto object-cover" />
        </button>
      ))}
      {others > 0 && (
        <span className="flex items-center gap-1 text-caption text-faint">
          <ImageIcon size={11} />
          {others} image{others > 1 ? 's' : ''} non affichable{others > 1 ? 's' : ''}
        </span>
      )}
      {open !== null && drawable[open] && <Lightbox src={drawable[open].src} onClose={() => setOpen(null)} />}
    </div>
  )
}

// On document.body: a chat block's containment would otherwise hold the overlay inside the block.
function Lightbox({ src, onClose }: { src: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div role="dialog" aria-label="Image" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={onClose}>
      <img src={src} alt="" className="max-h-full max-w-full rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} title="Fermer (Échap)" aria-label="Fermer" className="absolute top-4 right-4 rounded-md bg-panel/80 p-1.5 text-fg hover:bg-panel">
        <X size={16} />
      </button>
    </div>,
    document.body
  )
}
