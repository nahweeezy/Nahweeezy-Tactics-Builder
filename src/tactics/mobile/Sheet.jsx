import { useEffect, useRef, useState } from 'react';

/**
 * Bottom sheet, presented the way iOS presents one: slides up over a dimmed
 * backdrop, rounded top corners, a grabber you can actually drag down to
 * dismiss, and a body that scrolls without rubber-banding the page behind it.
 */
export default function Sheet({ open, title, subtitle, onClose, children, detent = 'auto' }) {
  const [drag, setDrag] = useState(0);
  const startY = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset any residual drag offset between presentations.
  useEffect(() => { if (open) setDrag(0); }, [open]);

  if (!open) return null;

  const onGrabStart = (e) => {
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onGrabMove = (e) => {
    if (startY.current == null) return;
    // Downward only — dragging up shouldn't lift the sheet off its detent.
    setDrag(Math.max(0, e.clientY - startY.current));
  };
  const onGrabEnd = () => {
    if (startY.current == null) return;
    const shouldClose = drag > 110;
    startY.current = null;
    if (shouldClose) onClose(); else setDrag(0);
  };

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/55 backdrop-fade"
        onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ios-sheet"
        style={{
          height: detent === 'tall' ? '86dvh' : undefined,
          transform: drag ? `translateY(${drag}px)` : undefined,
          transition: startY.current == null ? 'transform 0.25s cubic-bezier(0.32,0.72,0,1)' : 'none',
        }}
      >
        <div
          className="flex-none touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={onGrabStart}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabEnd}
          onPointerCancel={onGrabEnd}
        >
          <div className="ios-sheet-grabber" />
          <div className="flex items-center justify-between px-4 pb-2.5 pt-0.5">
            <div className="min-w-0">
              <div className="text-[17px] font-extrabold text-ink truncate"
                style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '1px', fontStyle: 'italic' }}>
                {title}
              </div>
              {subtitle && <div className="text-[11px] text-mute truncate">{subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Close"
              className="ios-tap flex-none -mr-1 flex items-center justify-center rounded-full
                         w-8 h-8 bg-ink/10 text-mute active:bg-ink/20">
              <span className="text-[17px] leading-none">×</span>
            </button>
          </div>
        </div>
        <div className="ios-sheet-body px-4">{children}</div>
      </div>
    </>
  );
}
