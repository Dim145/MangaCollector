import { useEffect } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  children,
  popupOpen,
  additionalClasses = "",
  handleClose,
}) {
  useEffect(() => {
    if (!popupOpen) return;

    const handleKeyUp = (e) => {
      if (e.key === "Escape" && typeof handleClose === "function") {
        handleClose();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [popupOpen, handleClose]);

  if (!popupOpen) return null;
  if (typeof document === "undefined") return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 flex items-center justify-center bg-ink-0/80 backdrop-blur-md p-4 animate-fade-in"
      // Inline style z-index to escape any stacking context traps from
      // ancestors (DefaultBackground's `isolate`, transformed elements, etc.)
      // Portaled to document.body as belt-and-braces.
      style={{ zIndex: 2147483630 }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        handleClose?.();
      }}
    >
      {/* Close button */}
      {handleClose && (
        <button
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full border border-border bg-ink-1/80 text-washi backdrop-blur transition hover:bg-hanko hover:border-hanko"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      <div
        className={`relative max-h-[calc(100dvh-2rem)] max-w-full overflow-auto animate-fade-up ${additionalClasses}`}
      >
        {children}
      </div>
    </div>
  );

  // Portal into <body> so DefaultBackground's `isolate` (and any other
  // ancestor stacking context) can't trap the overlay under the header
  // or adjacent sections.
  return createPortal(overlay, document.body);
}
