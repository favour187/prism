import { useEffect, useRef, useState } from 'react';

export default function RegionSelector({ frame, onDone, onCancel }) {
  const overlayRef = useRef(null);
  const imgRef = useRef(null);
  const [natural, setNatural] = useState({ w: frame.width ?? 0, h: frame.height ?? 0 });
  const [drag, setDrag] = useState(null);
  const [box, setBox] = useState(null);

  const point = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const toRect = (d) => ({
    x: Math.min(d.x1, d.x2),
    y: Math.min(d.y1, d.y2),
    w: Math.abs(d.x2 - d.x1),
    h: Math.abs(d.y2 - d.y1),
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (box ?? drag)) commit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, box, drag]);

  const commit = () => {
    const d = box ?? drag;
    if (!d) return;
    const { x, y, w, h } = toRect(d);
    if (w < 8 || h < 8) return onCancel();
    const iw = natural.w || frame.width || imgRef.current?.naturalWidth;
    const ih = natural.h || frame.height || imgRef.current?.naturalHeight;
    if (!iw || !ih) return onCancel();
    const overlay = overlayRef.current.getBoundingClientRect();
    const scale = Math.min(overlay.width / iw, overlay.height / ih);
    const drawnW = iw * scale;
    const drawnH = ih * scale;
    const offsetX = (overlay.width - drawnW) / 2;
    const offsetY = (overlay.height - drawnH) / 2;

    const sx = Math.max(0, (x - offsetX) / scale);
    const sy = Math.max(0, (y - offsetY) / scale);
    const sw = Math.max(1, Math.min(w / scale, iw - sx));
    const sh = Math.max(1, Math.min(h / scale, ih - sy));

    const src = new Image();
    src.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      canvas.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      onDone(canvas.toDataURL('image/png'));
    };
    src.src = frame.dataUrl;
  };

  const rect = (box ?? drag) ? toRect(box ?? drag) : null;

  return (
    <div
      className="region-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        const p = point(e);
        setBox(null);
        setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      }}
      onMouseMove={(e) => {
        if (!drag || box) return;
        const p = point(e);
        setDrag((d) => ({ ...d, x2: p.x, y2: p.y }));
      }}
      onMouseUp={() => {
        if (drag && !box) setBox(drag);
      }}
      role="dialog"
      aria-label="Select region to capture"
    >
      <img
        ref={imgRef}
        src={frame.dataUrl}
        alt="Captured frame — drag to select a region"
        className="region-frame"
        draggable="false"
        onLoad={(e) => {
          if (!frame.width && e.currentTarget.naturalWidth) {
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          }
        }}
      />
      <div className="region-hint">Drag to select · <kbd>Enter</kbd> to capture · <kbd>Esc</kbd> to cancel</div>
      {rect && rect.w > 0 && (
        <>
          <div className="region-dim" style={{ left: 0, top: 0, width: '100%', height: rect.y }} />
          <div className="region-dim" style={{ left: 0, top: rect.y, width: rect.x, height: rect.h }} />
          <div className="region-dim" style={{ left: rect.x + rect.w, top: rect.y, width: `calc(100% - ${rect.x + rect.w}px)`, height: rect.h }} />
          <div className="region-dim" style={{ left: 0, top: rect.y + rect.h, width: '100%', height: `calc(100% - ${rect.y + rect.h}px)` }} />
          <div className="region-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
          <div className="region-actions" style={{ left: rect.x, top: Math.max(8, rect.y - 44) }}>
            <button className="btn primary small" onClick={commit}>✂ Capture {rect.w}×{rect.h}</button>
            <button className="btn ghost small" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
